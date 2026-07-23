/**
 * 라이브 + WebSocket E2E — 인프로세스 Nest(app.listen(0)) + socket.io-client 실 TCP 왕복.
 *
 * 인프라 조달(정직 보고 규약):
 *  - Postgres: 기존 e2e 하네스(global-setup) 재사용(describeWithDb).
 *  - WS 어댑터: 기본 in-memory(단일 인스턴스) — 핵심 왕복엔 Redis 불요(견고·비플래키).
 *  - 댓글: CommentMockAdapter(배포 기본, 외부 네트워크 0). 실 SNS 미호출.
 *  - 수집기: app.get(CommentCollectorService).collectOnce(id) 직접 호출(인터벌 비의존).
 *
 * 라이브 세션·comment_read 채널은 스펙 내 인라인 생성(runSeed/resetDb 무변경, 구성적 무회귀).
 */
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

const waitFor = <T = unknown>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`이벤트 ${event} 타임아웃`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const waitConnect = (socket: Socket): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect 타임아웃')), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

d('live + ws (withDb + in-memory adapter + comment mock)', () => {
  let app: INestApplication | null = null;
  let prisma: PrismaClient | null = null;
  let url = '';
  let adminToken = '';
  let centerId = '';
  let commentChannelId = '';
  let sessionId = '';
  const sockets: Socket[] = [];

  const http = () => request(app!.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const connect = async (opts: Record<string, unknown>): Promise<Socket> => {
    const s = io(url, { transports: ['websocket'], forceNew: true, auth: opts });
    sockets.push(s);
    await waitConnect(s);
    return s;
  };

  beforeAll(async () => {
    // 댓글 수집 백그라운드 인터벌을 사실상 비활성(1시간)으로 — start()가 무장하는 실 setInterval이
    // 스위트 진행 중 틱을 쏘면 목 배치를 먼저 소진(prompted)해, 프롬프터 테스트의 수동 collectOnce가
    // 0을 반환하는 타이밍 의존 플레이크가 난다. createE2eApp(=config 로드) 이전에 고정해야 반영된다.
    process.env.LIVE_COMMENT_POLL_INTERVAL_MS = '3600000';

    const { createE2eApp, resetDb } = await import('./e2e-app');
    await resetDb();
    app = await createE2eApp();
    await app.listen(0);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    url = `http://127.0.0.1:${port}`;
    prisma = new PrismaClient();

    const login = await http()
      .post('/v1/auth/login')
      .send({ email: e2eDb().adminEmail, password: e2eDb().adminPassword })
      .expect(200);
    adminToken = login.body.tokens.accessToken;

    const stations = await http().get('/v1/stations').set(auth(adminToken)).expect(200);
    centerId = stations.body.items.find((s: { code: string }) => s.code === 'center').id;

    // comment_read 유튜브 채널 인라인 생성(프롬프터 수집 대상 — 목 어댑터가 처리)
    commentChannelId = uuidv7();
    await prisma.channelAccount.create({
      data: {
        id: commentChannelId,
        platform: 'youtube',
        stationId: centerId,
        name: '센터 유튜브(테스트)',
        externalChannelId: 'yt-center-e2e',
        credentialRef: 'youtube:center',
        capabilities: ['comment_read', 'live_publish'],
        status: 'connected',
      },
    });

    // 세션 생성(news) → prepare → start (REST)
    const created = await http()
      .post('/v1/live-sessions')
      .set(auth(adminToken))
      .send({
        type: 'news',
        title: '주간뉴스 라이브 E2E',
        scheduledAt: '2026-07-25T10:00:00.000Z',
        targetChannelAccountIds: [commentChannelId],
      })
      .expect(201);
    sessionId = created.body.id;
    expect(created.body.status).toBe('scheduled');

    await http().post(`/v1/live-sessions/${sessionId}/prepare`).set(auth(adminToken)).send({}).expect(200);
    const started = await http()
      .post(`/v1/live-sessions/${sessionId}/start`)
      .set(auth(adminToken))
      .send({})
      .expect(200);
    expect(started.body.status).toBe('live');
  }, 120000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    // app.listen(0) + supertest keep-alive 소켓이 close를 붙잡을 수 있어 레이스로 상한(forceExit 보완)
    await Promise.race([
      app?.close().catch(() => undefined) ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
    await prisma?.$disconnect().catch(() => undefined);
    delete process.env.LIVE_COMMENT_POLL_INTERVAL_MS;
  }, 20000);

  it('채팅 왕복 — join(LiveJoinAck·streamKeyRef 미유출)·chat.send→broadcast·DB 영속·viewer_count', async () => {
    const a = await connect({ nickname: '시청자A' });
    const b = await connect({ nickname: '시청자B' });

    const joinA = await a.timeout(5000).emitWithAck('live.join', { liveSessionId: sessionId });
    expect(joinA.ok).toBe(true);
    expect(joinA.data.session.id).toBe(sessionId);
    expect(joinA.data.session.streamKeyRef).toBeUndefined(); // 화이트리스트 투영
    expect(joinA.data.session.viewerCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(joinA.data.recentChat)).toBe(true);

    const bViewer = waitFor<{ total: number }>(b, 'live.viewer_count');
    const joinB = await b.timeout(5000).emitWithAck('live.join', { liveSessionId: sessionId });
    expect(joinB.ok).toBe(true);
    expect((await bViewer).total).toBeGreaterThanOrEqual(2);

    // A 전송 → A ack ChatMessage + B가 chat.new 수신(동일 message)
    const bChat = waitFor<{ id: string; message: string }>(b, 'chat.new');
    const sendAck = await a.timeout(5000).emitWithAck('chat.send', {
      liveSessionId: sessionId,
      message: '안녕하세요 애월에서',
    });
    expect(sendAck.ok).toBe(true);
    expect(sendAck.data.message).toBe('안녕하세요 애월에서');
    const received = await bChat;
    expect(received.id).toBe(sendAck.data.id);
    expect(received.message).toBe('안녕하세요 애월에서');

    // DB 영속 확인
    const row = await prisma!.chatMessage.findUnique({ where: { id: sendAck.data.id } });
    expect(row?.message).toBe('안녕하세요 애월에서');
    expect(row?.visibility).toBe('visible');

    a.disconnect();
    b.disconnect();
  }, 30000);

  it('레이트리밋 — capacity 초과 연사 → ok=false·error.details.reason=rate_limited', async () => {
    const c = await connect({ nickname: '연사자' });
    await c.timeout(5000).emitWithAck('live.join', { liveSessionId: sessionId });

    const acks: Array<{ ok: boolean; error?: { details?: { reason?: string } } }> = [];
    for (let i = 0; i < 8; i++) {
      acks.push(await c.timeout(5000).emitWithAck('chat.send', { liveSessionId: sessionId, message: `연사 ${i}` }));
    }
    const limited = acks.find((a) => !a.ok && a.error?.details?.reason === 'rate_limited');
    expect(limited).toBeDefined();

    c.disconnect();
  }, 30000);

  it('프롬프터 — 스태프 prompter.join·collectOnce 배치 수신(postedAt 오름차순)·prompted·재호출 dedup·익명 forbidden', async () => {
    const { CommentCollectorService } = await import('../src/live/comment-collector.service');
    const collector = app!.get(CommentCollectorService);

    const staff = await connect({ token: adminToken });
    const joinAck = await staff.timeout(5000).emitWithAck('prompter.join', { liveSessionId: sessionId });
    expect(joinAck.ok).toBe(true);

    const batch = waitFor<{ comments: Array<{ postedAt: string; status: string }> }>(staff, 'prompter.comments');
    const pushed = await collector.collectOnce(sessionId);
    expect(pushed).toBeGreaterThan(0);
    const payload = await batch;
    expect(payload.comments.length).toBe(pushed);
    // postedAt 오름차순
    for (let i = 1; i < payload.comments.length; i++) {
      expect(Date.parse(payload.comments[i]!.postedAt)).toBeGreaterThanOrEqual(
        Date.parse(payload.comments[i - 1]!.postedAt),
      );
    }

    // 행 prompted 마킹 확인
    const promptedCount = await prisma!.liveComment.count({
      where: { liveSessionId: sessionId, status: 'prompted' },
    });
    expect(promptedCount).toBeGreaterThan(0);

    // 재호출 dedup — 신규 0
    const again = await collector.collectOnce(sessionId);
    expect(again).toBe(0);

    // 익명 prompter.join → forbidden
    const anon = await connect({ nickname: '익명' });
    const anonAck = await anon.timeout(5000).emitWithAck('prompter.join', { liveSessionId: sessionId });
    expect(anonAck.ok).toBe(false);
    expect(['forbidden', 'unauthorized']).toContain(anonAck.error.code);

    staff.disconnect();
    anon.disconnect();
  }, 30000);

  it('공개 GET /v1/live/sessions — LiveSessionPublic(streamKeyRef 미유출)', async () => {
    const res = await http().get('/v1/live/sessions').expect(200);
    const found = res.body.find((s: { id: string }) => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.status).toBe('live');
    expect(found.streamKeyRef).toBeUndefined();
    expect(found.rtmpIngestUrl).toBeUndefined();
    expect(found.createdByUserId).toBeUndefined();
    expect(found.hlsUrl).toContain('/index.m3u8');
  }, 30000);

  it('채팅 숨김 — REST hide → 참가 소켓들 chat.moderated 수신·DB visibility=hidden', async () => {
    const a = await connect({ nickname: '숨김대상' });
    const b = await connect({ nickname: '관전자' });
    await a.timeout(5000).emitWithAck('live.join', { liveSessionId: sessionId });
    await b.timeout(5000).emitWithAck('live.join', { liveSessionId: sessionId });

    const sendAck = await a.timeout(5000).emitWithAck('chat.send', { liveSessionId: sessionId, message: '숨겨질 메시지' });
    expect(sendAck.ok).toBe(true);
    const messageId = sendAck.data.id;

    const bModerated = waitFor<{ chatMessageId: string; visibility: string }>(b, 'chat.moderated');
    await http()
      .post(`/v1/live-sessions/${sessionId}/chat/${messageId}/hide`)
      .set(auth(adminToken))
      .send({})
      .expect(200);
    const mod = await bModerated;
    expect(mod.chatMessageId).toBe(messageId);
    expect(mod.visibility).toBe('hidden');

    const row = await prisma!.chatMessage.findUnique({ where: { id: messageId } });
    expect(row?.visibility).toBe('hidden');
    expect(row?.moderatedByUserId).toBeTruthy();

    a.disconnect();
    b.disconnect();
  }, 30000);

  it('종료 — end → live.status_changed(ended) 브로드캐스트', async () => {
    const a = await connect({ nickname: '종료관전' });
    await a.timeout(5000).emitWithAck('live.join', { liveSessionId: sessionId });

    const statusChanged = waitFor<{ to: string }>(a, 'live.status_changed');
    const ended = await http().post(`/v1/live-sessions/${sessionId}/end`).set(auth(adminToken)).send({}).expect(200);
    expect(ended.body.status).toBe('ended');
    expect((await statusChanged).to).toBe('ended');

    a.disconnect();
  }, 30000);
});
