import {
  CAPTION_EDITABLE_CONTENT_STATUSES,
  ContentStatus,
  ProgramCategory,
  isCaptionEditableStatus,
} from '@gachinol/shared';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { REVIEW_POLICY_DEFAULTS } from '../config/review-policy.config';
import {
  adminUser,
  centerOperatorUser,
  contentRow,
  makePrismaMock,
  reporterUser,
  sceneJson,
} from '../test-support/fixtures';
import { MediaAssetsService } from '../media/media-assets.service';
import { ContentsService } from './contents.service';

describe('ContentsService', () => {
  const setup = () => {
    const prisma = makePrismaMock();
    // create/update는 입력을 그대로 반영한 행을 돌려주는 에코 mock
    prisma.content.create.mockImplementation(async ({ data }: any) => ({
      ...contentRow(),
      ...data,
    }));
    prisma.content.update.mockImplementation(async ({ data }: any) => ({
      ...contentRow(),
      ...data,
    }));
    const assets = new MediaAssetsService(prisma, { bucket: 'gachinol-media' } as never);
    const aiAnalyses = { findCurrent: jest.fn().mockResolvedValue(null) };
    const publications = { listForContent: jest.fn().mockResolvedValue([]) };
    return {
      prisma,
      service: new ContentsService(prisma, assets, aiAnalyses as never, publications as never),
    };
  };

  const draftDto = (over: Record<string, unknown> = {}) => ({
    title: '테스트',
    category: 'news',
    scenes: [
      { order: 0, caption: '오프닝', startSec: null, endSec: null },
      { order: 1, caption: '본문', startSec: 0, endSec: 10 },
    ],
    ...over,
  });

  describe('createDraft — 생성 규칙', () => {
    it('emergency는 priority=urgent, 그 외 normal', async () => {
      const { prisma, service } = setup();
      await service.createDraft(reporterUser(), draftDto({ category: 'emergency' }) as never);
      expect(prisma.content.create.mock.calls[0][0].data.priority).toBe('urgent');

      await service.createDraft(reporterUser(), draftDto({ category: 'news' }) as never);
      expect(prisma.content.create.mock.calls[1][0].data.priority).toBe('normal');
    });

    it.each(Object.values(ProgramCategory))('reviewPolicy 기본 매핑: %s', async (category) => {
      const { prisma, service } = setup();
      const dto = draftDto({
        category,
        cultureTopics: category === 'culture' ? ['food'] : undefined,
      });
      await service.createDraft(reporterUser(), dto as never);
      expect(prisma.content.create.mock.calls[0][0].data.reviewPolicy).toBe(
        REVIEW_POLICY_DEFAULTS[category],
      );
    });

    it('scenes에 서버가 id(uuid v7)를 부여하고, station·reporter는 토큰에서 온다', async () => {
      const { prisma, service } = setup();
      await service.createDraft(reporterUser(), draftDto() as never);
      const data = prisma.content.create.mock.calls[0][0].data;
      expect(data.stationId).toBe('s-aewol');
      expect(data.reporterId).toBe('u-reporter');
      expect(data.origin).toBe('reporter_upload');
      expect(data.status).toBe('draft');
      expect(data.generation).toBe(1);
      for (const scene of data.scenes) {
        expect(scene.id).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('기자가 아니면 403 (admin 수퍼롤도 초안 생성은 불가)', async () => {
      const { service } = setup();
      await expect(service.createDraft(adminUser(), draftDto() as never)).rejects.toMatchObject({
        code: 'forbidden',
      });
    });
  });

  describe('createDraft — hasMinorSubject 초기값(T-W2-23)', () => {
    it('미전송 시 false로 저장 (미전송=false 규약)', async () => {
      const { prisma, service } = setup();
      await service.createDraft(reporterUser(), draftDto() as never);
      expect(prisma.content.create.mock.calls[0][0].data.hasMinorSubject).toBe(false);
    });

    it('true 전송 시 그대로 저장', async () => {
      const { prisma, service } = setup();
      await service.createDraft(reporterUser(), draftDto({ hasMinorSubject: true }) as never);
      expect(prisma.content.create.mock.calls[0][0].data.hasMinorSubject).toBe(true);
    });
  });

  describe('createDraft — remakeOfContentId 재작업 원본 검증(T-W2-20)', () => {
    it('remakeOfContentId 없이 생성 — 기존 경로 무영향, null로 저장', async () => {
      const { prisma, service } = setup();
      await service.createDraft(reporterUser(), draftDto() as never);
      expect(prisma.content.findUnique).not.toHaveBeenCalled();
      expect(prisma.content.create.mock.calls[0][0].data.remakeOfContentId).toBeNull();
    });

    it('유효한 참조(같은 지사·rejected)로 생성 → DB에 기록', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ id: 'c-source', stationId: 's-aewol', status: 'rejected' }),
      );
      const result = await service.createDraft(
        reporterUser(),
        draftDto({ remakeOfContentId: 'c-source' }) as never,
      );
      expect(prisma.content.findUnique).toHaveBeenCalledWith({ where: { id: 'c-source' } });
      expect(prisma.content.create.mock.calls[0][0].data.remakeOfContentId).toBe('c-source');
      expect(result.remakeOfContentId).toBe('c-source');
    });

    it('유효한 참조(같은 지사·canceled)로도 생성 허용', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ id: 'c-source', stationId: 's-aewol', status: 'canceled' }),
      );
      await service.createDraft(
        reporterUser(),
        draftDto({ remakeOfContentId: 'c-source' }) as never,
      );
      expect(prisma.content.create.mock.calls[0][0].data.remakeOfContentId).toBe('c-source');
    });

    it('참조 대상이 존재하지 않으면 404 not_found', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(null);
      const err = await service
        .createDraft(reporterUser(), draftDto({ remakeOfContentId: 'c-ghost' }) as never)
        .then(
          () => null,
          (e) => e,
        );
      expect(err).toMatchObject({ code: 'not_found' });
      expect(prisma.content.create).not.toHaveBeenCalled();
    });

    it('참조 대상이 다른 지사 소속이면 403 forbidden', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ id: 'c-other', stationId: 's-jeju', status: 'rejected' }),
      );
      const err = await service
        .createDraft(reporterUser(), draftDto({ remakeOfContentId: 'c-other' }) as never)
        .then(
          () => null,
          (e) => e,
        );
      expect(err).toMatchObject({ code: 'forbidden' });
      expect(prisma.content.create).not.toHaveBeenCalled();
    });

    /**
     * 순서 판별 케이스: 위 테스트("다른 지사 + rejected")는 지사 검증·상태 검증 어느 쪽을 먼저 해도
     * 결과가 forbidden으로 같아 검증 순서를 가르지 못한다. "다른 지사 + 비허용 상태(draft)"만이
     * 두 순서의 결과가 갈리는 유일한 조합(지사 우선=forbidden, 상태 우선=validation_failed) —
     * 이 테스트가 실제로 지사 경계를 먼저 판정함(=타 지사 콘텐츠의 상태를 노출하지 않음)을 회귀로 고정한다.
     */
    it('다른 지사 + 비허용 상태(draft) — 지사 경계가 상태 확인보다 먼저 판정되어 forbidden (validation_failed 아님, 상태 유출 없음)', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ id: 'c-other', stationId: 's-jeju', status: 'draft' }),
      );
      const err = await service
        .createDraft(reporterUser(), draftDto({ remakeOfContentId: 'c-other' }) as never)
        .then(
          () => null,
          (e) => e,
        );
      expect(err).toMatchObject({ code: 'forbidden' });
      // details에 참조 대상 status가 실리지 않음 — 지사 경계 판정이 상태 확인 이전에 끝났다는 증거
      expect(err.details).not.toHaveProperty('status');
      expect(prisma.content.create).not.toHaveBeenCalled();
    });

    it.each(['draft', 'published', 'archived', 'awaiting_reporter_review'])(
      '참조 대상 상태가 %s면 400 validation_failed (rejected|canceled만 허용)',
      async (status) => {
        const { prisma, service } = setup();
        prisma.content.findUnique.mockResolvedValue(
          contentRow({ id: 'c-source', stationId: 's-aewol', status }),
        );
        const err = await service
          .createDraft(reporterUser(), draftDto({ remakeOfContentId: 'c-source' }) as never)
          .then(
            () => null,
            (e) => e,
          );
        expect(err).toMatchObject({ code: 'validation_failed' });
        expect(prisma.content.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('update — 상태 제한·SceneId 보존', () => {
    it('draft·revision_requested 외 상태는 409 conflict', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ status: 'published' }));
      const err = await service.update(reporterUser(), 'c-1', { title: '수정' } as never).then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(DomainException);
      expect(err.code).toBe('conflict');
      expect(err.details).toMatchObject({ status: 'published' });
    });

    it('order가 같으면 기존 SceneId 보존, 신규 장면은 새 id', async () => {
      const keepId = uuidv7();
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'draft', scenes: [sceneJson(0, keepId)] }),
      );

      await service.update(reporterUser(), 'c-1', {
        scenes: [
          { order: 0, caption: '수정된 오프닝', startSec: null, endSec: null },
          { order: 1, caption: '추가 장면', startSec: null, endSec: null },
        ],
      } as never);

      const saved = prisma.content.update.mock.calls[0][0].data.scenes;
      expect(saved[0].id).toBe(keepId); // sceneNotes 참조 안정성
      expect(saved[1].id).not.toBe(keepId);
    });

    it('센터·관리자는 targetChannelAccountIds만 수정 가능', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ status: 'draft' }));
      await expect(
        service.update(adminUser(), 'c-1', { title: '제목 변경' } as never),
      ).rejects.toMatchObject({ code: 'forbidden' });

      await service.update(adminUser(), 'c-1', { targetChannelAccountIds: [uuidv7()] } as never);
      expect(prisma.content.update).toHaveBeenCalled();
    });

    it('culture↔cultureTopics 병합 불변식 검증', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'draft', category: 'news', cultureTopics: [] }),
      );
      await expect(
        service.update(reporterUser(), 'c-1', { category: 'culture' } as never),
      ).rejects.toMatchObject({ code: 'validation_failed' });
    });

    it('category=culture 재전송(topics 생략) 시 기존 cultureTopics 보존 — 검증한 병합값 그대로 저장', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'draft', category: 'culture', cultureTopics: ['food'] }),
      );

      await service.update(reporterUser(), 'c-1', { category: 'culture' } as never);

      const data = prisma.content.update.mock.calls[0][0].data;
      expect(data.category).toBe('culture');
      expect(data.cultureTopics).toEqual(['food']); // 조용한 소실([]) 금지
    });

    it('culture→다른 분류 변경 시 topics 명시 전송 없이도 통과하고 []로 비운다', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'draft', category: 'culture', cultureTopics: ['food'] }),
      );

      await service.update(reporterUser(), 'c-1', { category: 'news' } as never);

      const data = prisma.content.update.mock.calls[0][0].data;
      expect(data.category).toBe('news');
      expect(data.cultureTopics).toEqual([]);
    });
  });

  describe('update — hasMinorSubject 쓰기·D3 fail-closed 불변식(T-W2-23)', () => {
    it('기자가 false→true로 켤 수 있다', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'draft', hasMinorSubject: false }),
      );
      await service.update(reporterUser(), 'c-1', { hasMinorSubject: true } as never);
      expect(prisma.content.update.mock.calls[0][0].data.hasMinorSubject).toBe(true);
    });

    it.each([
      ['admin', adminUser],
      ['center_operator', centerOperatorUser],
    ])('센터·관리자는 hasMinorSubject를 못 만진다 — %s (targetChannelAccountIds만 허용 규칙에 포함)', async (_label, userFactory) => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ status: 'draft' }));
      await expect(
        service.update(userFactory(), 'c-1', { hasMinorSubject: true } as never),
      ).rejects.toMatchObject({ code: 'forbidden' });
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    // (이력) D3 fail-closed(true→false 시 확인 기록 동반 삭제) 테스트들은 확인 개념과 함께 T-W2-36으로 제거.
  });

  // (이력) 舊 confirmMinorConsent/withdrawMinorConsent 스위트(T-W2-23·#116)는 T-W2-36으로 제거.

  describe('list — reporter 지사 강제', () => {
    it('reporter의 쿼리 stationId는 자기 소속으로 덮어쓴다', async () => {
      const { prisma, service } = setup();
      prisma.content.count.mockResolvedValue(0);
      prisma.content.findMany.mockResolvedValue([]);

      await service.list(reporterUser(), {
        page: 1,
        pageSize: 20,
        stationId: 's-other',
      } as never);

      expect(prisma.content.findMany.mock.calls[0][0].where.stationId).toBe('s-aewol');
    });
  });

  /**
   * 대장 #118 — 미성년자 게이트가 막은 콘텐츠의 발견 경로. reviewPolicy='reporter_only'는 센터
   * 검토를 안 거쳐 status 필터로는 골라낼 수 없다 → 목록 쿼리에 직교 필터가 있어야 한다.
   */
  // (이력) 舊 minorConsent 필터 스위트(T-W2-27)는 T-W2-36으로 제거.

  describe('읽기 범위 정합 — 목록(지사)과 상세(지사)는 같은 범위, 쓰기는 담당 기자만', () => {
    it('같은 지사 다른 기자의 콘텐츠 — 상세 조회는 허용(목록과 정합)', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ stationId: 's-aewol', reporterId: 'u-other-reporter' }),
      );
      await expect(service.getDetail(reporterUser(), 'c-1')).resolves.toBeDefined();
    });

    it('다른 지사 콘텐츠 — 상세 조회 403', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ stationId: 's-jeju', reporterId: 'u-other-reporter' }),
      );
      await expect(service.getDetail(reporterUser(), 'c-1')).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('같은 지사 다른 기자의 콘텐츠 — 수정(쓰기)은 여전히 403', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'draft', stationId: 's-aewol', reporterId: 'u-other-reporter' }),
      );
      await expect(
        service.update(reporterUser(), 'c-1', { title: '수정' } as never),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });
  });

  /* ══════════════════════════════════════════════════════════════════════════
   * 사후 자막 보강 (T-W2-34 — 대장 #123 · 정본 03 §C-4 간단 모드)
   * ══════════════════════════════════════════════════════════════════════════ */
  describe('updateCaptions — 액터(지사 경계)', () => {
    const scenesDto = { scenes: [{ order: 0, caption: '자막', startSec: null, endSec: null }] };

    it('★ 같은 지사 다른 기자가 자막을 채울 수 있다 — 초안 수정(loadOwned)과 갈리는 지점', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'uploaded', stationId: 's-aewol', reporterId: 'u-other-reporter' }),
      );
      await expect(
        service.updateCaptions(reporterUser(), 'c-1', scenesDto as never),
      ).resolves.toBeDefined();
      expect(prisma.content.update).toHaveBeenCalled();
    });

    it('★ 타 지사 기자는 403 — 이 판정을 지우면 남의 지사 자막을 고칠 수 있게 된다', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'uploaded', stationId: 's-jeju', reporterId: 'u-other-reporter' }),
      );
      await expect(
        service.updateCaptions(reporterUser(), 'c-1', scenesDto as never),
      ).rejects.toMatchObject({ code: 'forbidden' });
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('담당 기자가 없는 주민 제보(reporterId=null)도 같은 지사면 채울 수 있다', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({
          status: 'uploaded',
          origin: 'resident_link',
          stationId: 's-aewol',
          reporterId: null,
          scenes: [],
        }),
      );
      await expect(
        service.updateCaptions(reporterUser(), 'c-1', scenesDto as never),
      ).resolves.toBeDefined();
    });

    it('미존재는 404', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(null);
      await expect(
        service.updateCaptions(reporterUser(), 'c-1', scenesDto as never),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('updateCaptions — 상태 게이트 (published 전까지)', () => {
    const scenesDto = { scenes: [{ order: 0, caption: '자막', startSec: null, endSec: null }] };
    const tryStatus = async (status: string) => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ status, scenes: [] }));
      return service.updateCaptions(reporterUser(), 'c-1', scenesDto as never).then(
        () => 'ok' as const,
        (e) => e as DomainException,
      );
    };

    it('전 상태에서 shared 술어와 정확히 일치한다 (사본 금지 — 맵 순회)', async () => {
      for (const status of Object.values(ContentStatus)) {
        const result = await tryStatus(status);
        if (isCaptionEditableStatus(status)) {
          expect(result).toBe('ok');
        } else {
          expect(result).toBeInstanceOf(DomainException);
          expect((result as DomainException).code).toBe('conflict');
        }
      }
    });

    it('published·종결 3종은 409 + details.status (앱이 이유를 그대로 보여줄 수 있게)', async () => {
      for (const status of ['published', 'rejected', 'canceled', 'archived'] as const) {
        const err = (await tryStatus(status)) as DomainException;
        expect(err.code).toBe('conflict');
        expect(err.details).toMatchObject({ status });
      }
    });

    it('업로드가 끝난 뒤(uploaded·processing 등)에도 열려 있다 — update()가 닫는 구간', async () => {
      for (const status of ['uploaded', 'processing', 'awaiting_reporter_review'] as const) {
        expect(await tryStatus(status)).toBe('ok');
      }
    });
  });

  describe('updateCaptions — 필드·SceneId', () => {
    it('scenes만 쓴다 — 제목·분류를 건드리는 키가 update data에 없다', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'uploaded', title: '원래 제목', category: 'news', scenes: [] }),
      );
      await service.updateCaptions(reporterUser(), 'c-1', {
        scenes: [{ order: 0, caption: '새 자막', startSec: null, endSec: null }],
      } as never);
      expect(Object.keys(prisma.content.update.mock.calls[0][0].data)).toEqual(['scenes']);
    });

    it('order가 같으면 기존 SceneId 보존 (수정 지시 sceneNotes 참조 유지 — update()와 동일 규약)', async () => {
      const keepId = uuidv7();
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'awaiting_reporter_review', scenes: [sceneJson(0, keepId)] }),
      );
      await service.updateCaptions(reporterUser(), 'c-1', {
        scenes: [
          { order: 0, caption: '고친 자막', startSec: null, endSec: null },
          { order: 1, caption: '추가 자막', startSec: null, endSec: null },
        ],
      } as never);
      const saved = prisma.content.update.mock.calls[0][0].data.scenes;
      expect(saved[0].id).toBe(keepId);
      expect(saved[1].id).not.toBe(keepId);
    });

    it('빈 배열은 자막 전량 삭제 (간단 모드로 되돌리기)', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'uploaded', scenes: [sceneJson(0, uuidv7())] }),
      );
      await service.updateCaptions(reporterUser(), 'c-1', { scenes: [] } as never);
      expect(prisma.content.update.mock.calls[0][0].data.scenes).toEqual([]);
    });
  });

  /**
   * 대장 #123 — 자막 없이 올라온 콘텐츠의 **발견 경로**. 편집 화면만 만들고 진입로가 없으면
   * 대장 #118과 같은 형태의 결함이 된다.
   */
  describe('list — 자막 대기열 필터 (T-W2-34)', () => {
    const listWith = async (query: Record<string, unknown>) => {
      const { prisma, service } = setup();
      prisma.content.count.mockResolvedValue(0);
      prisma.content.findMany.mockResolvedValue([]);
      await service.list(reporterUser(), { page: 1, pageSize: 20, ...query } as never);
      return prisma.content.findMany.mock.calls[0][0].where;
    };

    it('needed — scenes 빈 배열 ∧ 채울 수 있는 상태만', async () => {
      const where = await listWith({ captions: 'needed' });
      expect(where.scenes).toEqual({ equals: [] });
      expect(where.AND).toEqual([{ status: { in: [...CAPTION_EDITABLE_CONTENT_STATUSES] } }]);
    });

    it('상태 조건이 shared 파생과 정확히 같다 — published·종결은 대기열에 들어오지 않는다', async () => {
      const where = await listWith({ captions: 'needed' });
      const allowed: string[] = where.AND[0].status.in;
      expect(allowed).not.toContain('published');
      expect(allowed).not.toContain('rejected');
      expect(allowed).not.toContain('canceled');
      expect(allowed).not.toContain('archived');
      expect(allowed).toContain('uploaded');
      expect(allowed).toEqual(
        Object.values(ContentStatus).filter((s) => isCaptionEditableStatus(s)),
      );
    });

    it('미지정이면 자막 조건을 전혀 걸지 않는다 (기존 목록 무회귀)', async () => {
      const where = await listWith({});
      expect(where.scenes).toBeUndefined();
      expect(where.AND).toBeUndefined();
    });

    it('status와 함께 보내도 status가 덮이지 않는다 (AND 합성)', async () => {
      const where = await listWith({ captions: 'needed', status: 'uploaded' });
      expect(where.status).toBe('uploaded');
      expect(where.AND).toEqual([{ status: { in: [...CAPTION_EDITABLE_CONTENT_STATUSES] } }]);
    });

    it('reporter의 지사 강제와 함께 걸린다', async () => {
      const where = await listWith({ captions: 'needed', stationId: 's-other' });
      expect(where.stationId).toBe('s-aewol');
      expect(where.scenes).toEqual({ equals: [] });
    });

    it('count와 findMany가 같은 where를 쓴다 (totalCount 어긋남 방지)', async () => {
      const { prisma, service } = setup();
      prisma.content.count.mockResolvedValue(0);
      prisma.content.findMany.mockResolvedValue([]);
      await service.list(reporterUser(), {
        page: 1,
        pageSize: 20,
        captions: 'needed',
      } as never);
      expect(prisma.content.count.mock.calls[0][0].where).toEqual(
        prisma.content.findMany.mock.calls[0][0].where,
      );
    });
  });
});
