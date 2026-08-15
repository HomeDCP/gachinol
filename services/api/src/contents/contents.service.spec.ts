import { ProgramCategory } from '@gachinol/shared';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { REVIEW_POLICY_DEFAULTS } from '../config/review-policy.config';
import {
  adminUser,
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
