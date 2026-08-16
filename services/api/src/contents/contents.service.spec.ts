import { ProgramCategory } from '@gachinol/shared';
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

    it('D3 우회 차단: true→false로 내리면 확인 기록(확인자·시각)도 같은 update에서 함께 null로 지운다 — ' +
      '켬→센터 확인→끔→다시 켬 우회 시나리오의 절반(끔) 고정', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({
          status: 'draft',
          hasMinorSubject: true,
          minorConsentConfirmedByUserId: 'u-center',
          minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
        }),
      );

      await service.update(reporterUser(), 'c-1', { hasMinorSubject: false } as never);

      const data = prisma.content.update.mock.calls[0][0].data;
      expect(data.hasMinorSubject).toBe(false);
      expect(data.minorConsentConfirmedByUserId).toBeNull();
      expect(data.minorConsentConfirmedAt).toBeNull();
    });

    it('D3 null-안전: true→false인데 아직 미확인(지울 확인 기록이 없음)이어도 정상 처리 — null을 다시 null로 지워도 무해', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({
          status: 'draft',
          hasMinorSubject: true,
          minorConsentConfirmedByUserId: null,
          minorConsentConfirmedAt: null,
        }),
      );

      await service.update(reporterUser(), 'c-1', { hasMinorSubject: false } as never);

      const data = prisma.content.update.mock.calls[0][0].data;
      expect(data.hasMinorSubject).toBe(false);
      expect(data.minorConsentConfirmedByUserId).toBeNull();
      expect(data.minorConsentConfirmedAt).toBeNull();
    });

    it('우회 시나리오 전체(켬→확인→끔→다시 켬): 다시 켠 뒤에는 확인 기록이 비어 있어 재승인 전 재확인이 다시 필요하다', async () => {
      const { prisma, service } = setup();
      // ① 켬→확인 완료 상태에서 ② 끔(D3가 확인 기록을 지움)
      prisma.content.findUnique.mockResolvedValueOnce(
        contentRow({
          status: 'draft',
          hasMinorSubject: true,
          minorConsentConfirmedByUserId: 'u-center',
          minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
        }),
      );
      await service.update(reporterUser(), 'c-1', { hasMinorSubject: false } as never);
      const offData = prisma.content.update.mock.calls[0][0].data;
      expect(offData.minorConsentConfirmedByUserId).toBeNull();
      expect(offData.minorConsentConfirmedAt).toBeNull();

      // ③ 다시 켬 — 이번엔 DB가 이미 확인 기록이 지워진 상태(위 update 결과)를 반환한다고 가정
      prisma.content.findUnique.mockResolvedValueOnce(
        contentRow({
          status: 'draft',
          hasMinorSubject: false,
          minorConsentConfirmedByUserId: null,
          minorConsentConfirmedAt: null,
        }),
      );
      await service.update(reporterUser(), 'c-1', { hasMinorSubject: true } as never);
      const onData = prisma.content.update.mock.calls[1][0].data;
      expect(onData.hasMinorSubject).toBe(true);
      // 다시 켤 때 서버가 확인 기록을 임의로 채우지 않는다 — 우회 완성을 막는 핵심
      expect(onData).not.toHaveProperty('minorConsentConfirmedByUserId');
      expect(onData).not.toHaveProperty('minorConsentConfirmedAt');
    });

    it('false→false(무변화)면 확인 기록 필드를 건드리지 않는다', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ status: 'draft', hasMinorSubject: false }),
      );
      await service.update(reporterUser(), 'c-1', { hasMinorSubject: false } as never);
      const data = prisma.content.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('minorConsentConfirmedByUserId');
      expect(data).not.toHaveProperty('minorConsentConfirmedAt');
    });

    it('true→true(이미 켜진 채 재전송)면 확인 기록 필드를 건드리지 않는다(기존 확인 유지)', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({
          status: 'draft',
          hasMinorSubject: true,
          minorConsentConfirmedByUserId: 'u-center',
          minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
        }),
      );
      await service.update(reporterUser(), 'c-1', { hasMinorSubject: true } as never);
      const data = prisma.content.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('minorConsentConfirmedByUserId');
      expect(data).not.toHaveProperty('minorConsentConfirmedAt');
    });
  });

  describe('confirmMinorConsent — 센터 전용 동의 확인(T-W2-23)', () => {
    it('hasMinorSubject=true + 미확인 → 확인자·시각을 기록', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ hasMinorSubject: true, minorConsentConfirmedAt: null }),
      );

      const result = await service.confirmMinorConsent(centerOperatorUser(), 'c-1');

      const data = prisma.content.update.mock.calls[0][0].data;
      expect(data.minorConsentConfirmedByUserId).toBe('u-center');
      expect(data.minorConsentConfirmedAt).toBeInstanceOf(Date);
      expect(result.minorConsentConfirmedByUserId).toBe('u-center');
    });

    it('hasMinorSubject=false → validation_failed 거부(선확인 후 플래그 우회 차단)', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ hasMinorSubject: false }));

      await expect(
        service.confirmMinorConsent(centerOperatorUser(), 'c-1'),
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('이미 확인됨 → 멱등 200, 기존 확인자·시각을 유지하고 덮어쓰지 않는다', async () => {
      const { prisma, service } = setup();
      const confirmedAt = new Date('2026-08-01T00:00:00.000Z');
      prisma.content.findUnique.mockResolvedValue(
        contentRow({
          hasMinorSubject: true,
          minorConsentConfirmedByUserId: 'u-first-confirmer',
          minorConsentConfirmedAt: confirmedAt,
        }),
      );

      const result = await service.confirmMinorConsent(
        centerOperatorUser({ id: 'u-second-confirmer' } as never),
        'c-1',
      );

      expect(prisma.content.update).not.toHaveBeenCalled();
      expect(result.minorConsentConfirmedByUserId).toBe('u-first-confirmer');
      expect(result.minorConsentConfirmedAt).toBe(confirmedAt.toISOString());
    });

    it('reporter는 forbidden (센터 전용)', async () => {
      const { prisma, service } = setup();
      await expect(service.confirmMinorConsent(reporterUser(), 'c-1')).rejects.toMatchObject({
        code: 'forbidden',
      });
      expect(prisma.content.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('withdrawMinorConsent — 확인 철회(T-W2-23, D5 정정: 게이트 통과 판정은 status_transition_logs 실측)', () => {
    it('확인된 상태·게이트 전이 로그 없음 → 철회 성공, 확인 기록을 null화', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({
          hasMinorSubject: true,
          minorConsentConfirmedByUserId: 'u-center',
          minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
        }),
      );
      prisma.statusTransitionLog.findFirst.mockResolvedValue(null);

      await service.withdrawMinorConsent(centerOperatorUser(), 'c-1');

      const data = prisma.content.update.mock.calls[0][0].data;
      expect(data.minorConsentConfirmedByUserId).toBeNull();
      expect(data.minorConsentConfirmedAt).toBeNull();
    });

    it('미확인 상태 → conflict 거부(철회할 대상 없음, 로그 조회 자체를 생략)', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ minorConsentConfirmedAt: null }));

      await expect(
        service.withdrawMinorConsent(centerOperatorUser(), 'c-1'),
      ).rejects.toMatchObject({ code: 'conflict' });
      expect(prisma.content.update).not.toHaveBeenCalled();
      expect(prisma.statusTransitionLog.findFirst).not.toHaveBeenCalled();
    });

    it(
      'D5 정정 핵심 회귀: reporter_then_center + 기자 승인만 완료(approvedAt 채워짐·status=awaiting_center_review·' +
        '센터 승인 로그는 없음) → approvedAt만 보면 오판하지만 철회 허용',
      async () => {
        const { prisma, service } = setup();
        prisma.content.findUnique.mockResolvedValue(
          contentRow({
            reviewPolicy: 'reporter_then_center',
            status: 'awaiting_center_review',
            hasMinorSubject: true,
            minorConsentConfirmedByUserId: 'u-center',
            minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
            // approve()의 기자 승인 hop이 reviewPolicy 무관하게 채우는 필드 — 게이트 통과의 프록시가 아님을 실증
            approvedByUserId: 'u-reporter',
            approvedAt: new Date('2026-08-11T00:00:00.000Z'),
          }),
        );
        prisma.statusTransitionLog.findFirst.mockResolvedValue(null); // 센터 승인 로그 없음

        await service.withdrawMinorConsent(centerOperatorUser(), 'c-1');

        expect(prisma.statusTransitionLog.findFirst).toHaveBeenCalledWith({
          where: {
            entityType: 'content',
            entityId: 'c-1',
            fromStatus: 'awaiting_center_review',
            toStatus: 'center_approved',
          },
        });
        const data = prisma.content.update.mock.calls[0][0].data;
        expect(data.minorConsentConfirmedByUserId).toBeNull();
        expect(data.minorConsentConfirmedAt).toBeNull();
      },
    );

    it('reporter_then_center + 센터 승인 완료(awaiting_center_review→center_approved 로그 있음) → conflict 거부', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({
          reviewPolicy: 'reporter_then_center',
          status: 'center_approved',
          hasMinorSubject: true,
          minorConsentConfirmedByUserId: 'u-center',
          minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
          approvedByUserId: 'u-center',
          approvedAt: new Date('2026-08-12T00:00:00.000Z'),
        }),
      );
      prisma.statusTransitionLog.findFirst.mockResolvedValue({
        id: 'log-1',
        fromStatus: 'awaiting_center_review',
        toStatus: 'center_approved',
      });

      await expect(
        service.withdrawMinorConsent(centerOperatorUser(), 'c-1'),
      ).rejects.toMatchObject({ code: 'conflict' });
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('reporter_only + 기자 승인 완료(awaiting_reporter_review→reporter_approved 로그 있음) → conflict 거부', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({
          reviewPolicy: 'reporter_only',
          status: 'publishing', // afterReporterApproval(reporter_only)=publishing 자동 연쇄
          hasMinorSubject: true,
          minorConsentConfirmedByUserId: 'u-center',
          minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
          approvedByUserId: 'u-reporter',
          approvedAt: new Date('2026-08-11T00:00:00.000Z'),
        }),
      );
      prisma.statusTransitionLog.findFirst.mockResolvedValue({
        id: 'log-2',
        fromStatus: 'awaiting_reporter_review',
        toStatus: 'reporter_approved',
      });

      await expect(
        service.withdrawMinorConsent(centerOperatorUser(), 'c-1'),
      ).rejects.toMatchObject({ code: 'conflict' });
      expect(prisma.statusTransitionLog.findFirst).toHaveBeenCalledWith({
        where: {
          entityType: 'content',
          entityId: 'c-1',
          fromStatus: 'awaiting_reporter_review',
          toStatus: 'reporter_approved',
        },
      });
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('reporter는 forbidden (센터 전용)', async () => {
      const { prisma, service } = setup();
      await expect(service.withdrawMinorConsent(reporterUser(), 'c-1')).rejects.toMatchObject({
        code: 'forbidden',
      });
      expect(prisma.content.findUnique).not.toHaveBeenCalled();
    });
  });

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
  describe('list — 미성년자 동의 게이트 필터 (T-W2-27)', () => {
    const listWith = async (query: Record<string, unknown>) => {
      const { prisma, service } = setup();
      prisma.content.count.mockResolvedValue(0);
      prisma.content.findMany.mockResolvedValue([]);
      await service.list(centerOperatorUser(), { page: 1, pageSize: 20, ...query } as never);
      return prisma.content.findMany.mock.calls[0][0].where;
    };

    it('pending — hasMinorSubject=true ∧ 확인시각 null (게이트가 막고 있는 것만)', async () => {
      const where = await listWith({ minorConsent: 'pending' });
      expect(where.hasMinorSubject).toBe(true);
      expect(where.minorConsentConfirmedAt).toBeNull();
    });

    it('confirmed — hasMinorSubject=true ∧ 확인시각 not null', async () => {
      const where = await listWith({ minorConsent: 'confirmed' });
      expect(where.hasMinorSubject).toBe(true);
      expect(where.minorConsentConfirmedAt).toEqual({ not: null });
    });

    it('미지정이면 게이트 조건을 전혀 걸지 않는다 (기존 목록 무회귀)', async () => {
      const where = await listWith({});
      expect(where.hasMinorSubject).toBeUndefined();
      expect(where.minorConsentConfirmedAt).toBeUndefined();
    });

    it('status와 직교 — reporter_only가 멈추는 awaiting_reporter_review와 함께 걸린다', async () => {
      const where = await listWith({
        minorConsent: 'pending',
        status: 'awaiting_reporter_review',
      });
      expect(where.status).toBe('awaiting_reporter_review');
      expect(where.hasMinorSubject).toBe(true);
      expect(where.minorConsentConfirmedAt).toBeNull();
    });

    it('count와 findMany가 같은 where를 쓴다 (totalCount 어긋남 방지)', async () => {
      const { prisma, service } = setup();
      prisma.content.count.mockResolvedValue(0);
      prisma.content.findMany.mockResolvedValue([]);
      await service.list(centerOperatorUser(), {
        page: 1,
        pageSize: 20,
        minorConsent: 'pending',
      } as never);
      expect(prisma.content.count.mock.calls[0][0].where).toEqual(
        prisma.content.findMany.mock.calls[0][0].where,
      );
    });
  });

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
});
