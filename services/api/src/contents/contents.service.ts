import { Injectable } from '@nestjs/common';
import type {
  Content,
  ContentDetail,
  ContentStatus,
  ContentSummary,
  Paginated,
  Scene,
  SceneId,
  StatusTransitionLog,
  User,
} from '@gachinol/shared';
import {
  CAPTION_EDITABLE_CONTENT_STATUSES,
  CaptionFilter,
  MinorConsentFilter,
  isCaptionEditableStatus,
  isReporterUser,
  requiresCultureTopic,
} from '@gachinol/shared';
import type { Content as ContentRow } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { newId } from '../common/ids';
import { toPaginated, toSkipTake } from '../common/pagination/pagination.util';
import type { PageParams } from '../common/pagination/pagination.util';
import { AiAnalysesService } from '../analysis/ai-analyses.service';
import { toAiAnalysis } from '../analysis/ai-analysis.mapper';
import { REVIEW_POLICY_DEFAULTS } from '../config/review-policy.config';
import { PublicationsService } from '../distribution/publications.service';
import { toPublication } from '../distribution/publication.mapper';
import { MediaAssetsService } from '../media/media-assets.service';
import { toMediaAsset } from '../media/media-asset.mapper';
import { PrismaService } from '../prisma/prisma.service';
import {
  toContent,
  toContentDetail,
  toContentSummary,
  toStatusTransitionLog,
} from './content.mapper';
import { zScene } from './schemas/content.schemas';
import type {
  ContentListQueryDto,
  CreateContentDraftDto,
  UpdateContentCaptionsDto,
  UpdateContentDraftDto,
} from './schemas/content.schemas';

/** draft 수정이 허용되는 상태 (shared dto 주석의 서버 검증) */
const EDITABLE_STATUSES = ['draft', 'revision_requested'] as const;

@Injectable()
export class ContentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: MediaAssetsService,
    private readonly aiAnalyses: AiAnalysesService,
    private readonly publications: PublicationsService,
  ) {}

  /**
   * 초안 생성 — stationId·reporterId는 토큰에서(바디 수신 금지), origin='reporter_upload',
   * status='draft', generation=1, priority는 emergency→urgent, reviewPolicy는 서버 기본 매핑.
   */
  async createDraft(user: User, dto: CreateContentDraftDto): Promise<Content> {
    if (!isReporterUser(user)) {
      // admin 수퍼롤이 RolesGuard를 통과해도 초안 생성은 담당 기자 불변식상 기자만
      throw new DomainException('forbidden', '콘텐츠 초안 생성은 기자만 가능합니다');
    }

    if (dto.remakeOfContentId) {
      await this.assertRemakeSource(dto.remakeOfContentId, user.stationId);
    }

    const scenes: Scene[] = dto.scenes.map((s) => ({ ...s, id: newId<SceneId>() }));
    const row = await this.prisma.content.create({
      data: {
        id: newId(),
        stationId: user.stationId,
        origin: 'reporter_upload',
        reporterId: user.id,
        title: dto.title,
        description: dto.description ?? null,
        category: dto.category,
        cultureTopics: dto.cultureTopics ?? [],
        status: 'draft',
        priority: dto.category === 'emergency' ? 'urgent' : 'normal',
        reviewPolicy: REVIEW_POLICY_DEFAULTS[dto.category],
        generation: 1,
        scenes: scenes as unknown as Prisma.InputJsonValue,
        // channel_accounts 도입 시 "소속 지사 kakao 채널" 기본 규칙 활성화
        targetChannelAccountIds: [],
        tags: [],
        remakeOfContentId: dto.remakeOfContentId ?? null,
        // 미성년자 동의 게이트 (T-W2-23) — 미전송 시 false (DB 기본값과 동형, 명시)
        hasMinorSubject: dto.hasMinorSubject ?? false,
      },
    });
    return toContent(row);
  }

  /**
   * 재작업 원본(remakeOfContentId) 검증 (T-W2-20).
   * - 실재 확인(404) → 지사 경계(403, 타 지사 콘텐츠 상태 비유출 — loadReadable/loadOwned와 동일 순서) →
   *   상태 확인(400, rejected|canceled만 허용).
   * - rejected(반려)뿐 아니라 canceled(파이프라인 중단)도 허용: 둘 다 워크플로 종결 상태이면서
   *   "정상 송출 실패"라는 공통점이 있다(published→archived처럼 성공 후 종결과는 성격이 다르다).
   *   published·archived는 이미 성공적으로 나간 결과물이라 "재작업"이 아니라 신규 촬영/후속편 성격이라 제외.
   * - rejected·canceled는 전이 맵상 종결(하위 전이 없음)이라 이 확인 이후 상태가 바뀔 수 없다 —
   *   생성 트랜잭션과 별도 조회여도 TOCTOU 경합이 구조적으로 없다.
   * - 순환 참조: 참조 대상은 반드시 이 호출 이전에 이미 존재해야 하고(신규 id는 여기서 아직 미발급),
   *   remakeOfContentId는 생성 시점에만 기록되고 수정 API(UpdateContentDraftRequest)에는 필드가 없어
   *   사후 변경 경로가 없다 → 사이클이 구조적으로 불가능. 체인 길이는 상한을 두지 않는다(단일 홉 계보
   *   필드일 뿐 재귀 순회가 없어 무한 체인이어도 성능·정합 리스크가 없다).
   */
  private async assertRemakeSource(
    remakeOfContentId: string,
    reporterStationId: string,
  ): Promise<void> {
    const source = await this.prisma.content.findUnique({ where: { id: remakeOfContentId } });
    if (!source) {
      throw new DomainException('not_found', '재작업 대상 콘텐츠를 찾을 수 없습니다', {
        remakeOfContentId,
      });
    }
    if (source.stationId !== reporterStationId) {
      throw new DomainException(
        'forbidden',
        '재작업은 같은 지사 콘텐츠만 대상으로 할 수 있습니다',
        { remakeOfContentId },
      );
    }
    if (source.status !== 'rejected' && source.status !== 'canceled') {
      throw new DomainException(
        'validation_failed',
        '재작업은 반려(rejected)·취소(canceled) 상태의 콘텐츠만 대상으로 할 수 있습니다',
        { remakeOfContentId, status: source.status },
      );
    }
  }

  /**
   * 목록 — reporter는 자기 지사 강제.
   *
   * `minorConsent` 필터(T-W2-27, 대장 #118): 미성년자 게이트가 막고 있는 콘텐츠를 센터가 **발견**하는
   * 경로. status 필터로 대체할 수 없다 — `reviewPolicy='reporter_only'`(교양·날씨)는 센터 검토를 아예
   * 거치지 않아 차단된 콘텐츠가 `awaiting_reporter_review`에 멈추고, 그 외 정책은
   * `awaiting_center_review`에 멈춘다(content-workflow.service.ts policyGuard ④). 두 값 모두
   * `hasMinorSubject=true`를 전제로 하며, 판정의 원천은 `minorConsentConfirmedAt`(=shared
   * `isMinorConsentPending`이 보는 컬럼) 하나다 — `approvedAt`은 기자 승인 hop에서도 채워져 게이트
   * 통과의 프록시가 아니다.
   *
   * `captions` 필터(T-W2-34, 대장 #123): 간단 모드(03 §C-4)·주민 제보로 **자막 없이** 들어온
   * 콘텐츠를 지사 담당자가 발견하는 경로. `minorConsent`와 달리 순수 사실 필터가 아니라
   * "지금 채울 수 있는가"까지 포함한다 — 근거는 shared `CaptionFilter` 주석.
   */
  async list(user: User, query: ContentListQueryDto): Promise<Paginated<ContentSummary>> {
    // reporter는 쿼리 stationId를 서버가 자기 소속으로 덮어씀
    const stationId = isReporterUser(user) ? user.stationId : query.stationId;
    const where: Prisma.ContentWhereInput = {
      ...(stationId ? { stationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.minorConsent
        ? {
            hasMinorSubject: true,
            minorConsentConfirmedAt:
              query.minorConsent === MinorConsentFilter.Pending ? null : { not: null },
          }
        : {}),
      // 자막 대기열 (T-W2-34, 대장 #123) — "자막 0건 ∧ 지금 채울 수 있는 상태".
      // 상태 조건은 shared 파생 집합을 그대로 쓴다(쓰기 게이트 updateCaptions와 같은 원천 —
      // 어긋나면 "자막 필요"로 떠 있는 항목이 편집에서 409로 거부되는 교착이 된다).
      // `AND`로 감싸는 이유: 위 status 필터와 같은 키를 스프레드로 덮어쓰면 둘 중 하나가 조용히
      // 사라진다(status=uploaded&captions=needed 같은 조합이 잘못된 결과를 낸다).
      ...(query.captions === CaptionFilter.Needed
        ? {
            scenes: { equals: [] },
            AND: [{ status: { in: [...CAPTION_EDITABLE_CONTENT_STATUSES] } }],
          }
        : {}),
    };
    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.content.count({ where }),
      this.prisma.content.findMany({
        where,
        include: { station: { select: { name: true } }, reporter: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
    ]);
    return toPaginated(rows.map(toContentSummary), totalCount, query);
  }

  async getDetail(user: User, id: string): Promise<ContentDetail> {
    const row = await this.loadReadable(user, id);
    const revisions = await this.prisma.revisionRequest.findMany({
      where: { contentId: id },
      orderBy: { createdAt: 'desc' },
    });
    // 현 세대 산출물 (미업로드면 행 0 → assets:[])
    const assetRows = await this.assets.listForContent(id, row.generation);
    // 현 세대 AI 분석 (미분석이면 null → undefined)
    const analysisRow = await this.aiAnalyses.findCurrent(id, row.generation);
    // 채널별 송출 상태 (미송출이면 행 0 → publications:[])
    const publicationRows = await this.publications.listForContent(id);
    return toContentDetail(
      row,
      revisions,
      assetRows.map(toMediaAsset),
      analysisRow ? toAiAnalysis(analysisRow) : undefined,
      publicationRows.map(toPublication),
    );
  }

  /** 소유 reporter는 전체 필드, center_operator·admin은 targetChannelAccountIds만 */
  async update(user: User, id: string, dto: UpdateContentDraftDto): Promise<Content> {
    const row = await this.loadOwned(user, id);

    if (!(EDITABLE_STATUSES as readonly string[]).includes(row.status)) {
      throw new DomainException(
        'conflict',
        'draft·revision_requested 상태에서만 수정할 수 있습니다',
        {
          status: row.status,
        },
      );
    }

    if (!isReporterUser(user)) {
      const touchesDraftFields =
        dto.title !== undefined ||
        dto.description !== undefined ||
        dto.category !== undefined ||
        dto.cultureTopics !== undefined ||
        dto.scenes !== undefined ||
        dto.hasMinorSubject !== undefined;
      if (touchesDraftFields) {
        throw new DomainException(
          'forbidden',
          '센터·관리자는 targetChannelAccountIds만 수정할 수 있습니다',
        );
      }
    }

    // culture↔cultureTopics 상호 불변식 — 병합 결과 기준 (shared 순수 헬퍼가 원천).
    // 검증에 쓴 병합값을 그대로 저장한다: culture 유지 시 기존 topics 보존,
    // culture 밖으로 나가면 암묵적으로 [] (명시 전송 불요).
    const category = dto.category ?? (row.category as Content['category']);
    const cultureTopics: Content['cultureTopics'] = requiresCultureTopic(category)
      ? (dto.cultureTopics ?? (row.cultureTopics as Content['cultureTopics']))
      : (dto.cultureTopics ?? []);
    if (requiresCultureTopic(category) && !cultureTopics?.length) {
      throw new DomainException(
        'validation_failed',
        "category='culture'는 cultureTopics 1개 이상 필수",
      );
    }
    if (!requiresCultureTopic(category) && cultureTopics?.length) {
      throw new DomainException('validation_failed', 'culture 외 분류는 cultureTopics 금지');
    }

    // Unchecked 사용 이유: minorConsentConfirmedByUserId가 관계(minorConsentConfirmedBy)로 매핑돼
    // 체크형 ContentUpdateInput에는 스칼라로 없다 — D3 fail-closed 지움에 스칼라 null 대입이 필요하다.
    const data: Prisma.ContentUncheckedUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.category !== undefined || dto.cultureTopics !== undefined
        ? { category, cultureTopics: [...(cultureTopics ?? [])] } // 검증한 병합값 그대로 저장
        : {}),
      ...(dto.hasMinorSubject !== undefined ? { hasMinorSubject: dto.hasMinorSubject } : {}),
      ...(dto.targetChannelAccountIds !== undefined
        ? { targetChannelAccountIds: [...dto.targetChannelAccountIds] }
        : {}),
    };
    if (dto.scenes !== undefined) {
      data.scenes = this.mergeScenes(row, dto.scenes) as unknown as Prisma.InputJsonValue;
    }
    // D3 fail-closed 불변식 (T-W2-23): true→false로 내리면 확인 기록도 같은 update에서 함께 지운다 —
    // 켬→센터 확인→끔→다시 켬으로 동의 게이트를 우회하는 경로를 막는다.
    if (dto.hasMinorSubject === false && row.hasMinorSubject) {
      data.minorConsentConfirmedByUserId = null;
      data.minorConsentConfirmedAt = null;
    }

    const updated = await this.prisma.content.update({ where: { id }, data });
    return toContent(updated);
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 사후 자막 보강 (T-W2-34 — 대장 #123 · 03 §C-4 간단 모드)
   *
   * 왜 `update()`를 넓히지 않고 별도 경로인가: `update()`는 **초안 작성자의 수정**이라
   * ⓐ 상태가 `draft`·`revision_requested`뿐이고 ⓑ 액터가 담당 기자 본인(`loadOwned`)이다.
   * 자막 보강은 둘 다 달라야 한다 — 간단 모드는 "촬영자는 자막을 안 쓴다"가 목적이라 액터를
   * 소유 기자로 좁히면 목적 자체가 무너지고, 업로드가 끝난 뒤에 채우는 것이라 상태도 초안
   * 범위를 벗어나 있다. 같은 메서드에 조건을 겹치면 "누가 무엇을 언제 고칠 수 있는가"가
   * 한 함수 안에서 네 갈래로 갈려 읽을 수 없게 된다.
   *
   * 안전장치 3겹(전부 다른 축):
   *  ① **필드** — DTO에 `scenes`밖에 없다. 넓힌 액터가 제목·분류를 건드릴 방법이 타입에 없다.
   *  ② **지사 경계** — `loadReadable`(기자=자기 지사 강제)을 **재사용**한다. 판정 사본 0.
   *  ③ **상태** — shared `isCaptionEditableStatus`(전이맵 파생 + published 제외). 목록 필터
   *     `captions=needed`와 **같은 원천**이라 발견 수단과 쓰기 게이트가 어긋날 수 없다.
   *
   * 승인 홉에는 자막 가드를 걸지 않는다(사용자 결정 2026-08-16 "송출 허용 + 사후 보강") —
   * 자막이 비어 있어도 승인·송출은 진행되고, 자막은 published 전까지 언제든 채운다.
   * ══════════════════════════════════════════════════════════════════════════ */

  /**
   * 자막(scenes) 전량 치환. `SceneId`는 `mergeScenes`가 order 기준으로 보존한다
   * (수정 지시 `RevisionRequest.sceneNotes`의 참조가 유령이 되지 않게 — `update()`와 동일 규약).
   *
   * 실패 코드: 미존재 404 · 타 지사 기자 403(`loadReadable`) · 송출·종결 이후 409.
   * 409에 현재 상태를 실어 앱이 "왜 못 고치는지"를 그대로 보여줄 수 있게 한다.
   */
  async updateCaptions(user: User, id: string, dto: UpdateContentCaptionsDto): Promise<Content> {
    // ② 지사 경계 — 소유 기자 전용(loadOwned)이 아니라 "같은 지사 기자"(loadReadable).
    //    주민 업로드 검수(ResidentReviewsService.loadForReview)가 지사 담당자를 판정하는 것과
    //    같은 규칙이며, 그쪽 주석이 밝히듯 그 규칙의 원천이 이 loadReadable이다.
    const row = await this.loadReadable(user, id);

    // ③ 상태 — 규칙은 shared가 소유한다(여기에 상태 이름을 적지 않는다)
    if (!isCaptionEditableStatus(row.status as ContentStatus)) {
      throw new DomainException(
        'conflict',
        '이미 송출됐거나 종결된 콘텐츠의 자막은 수정할 수 없습니다',
        { status: row.status },
      );
    }

    const scenes = this.mergeScenes(row, dto.scenes);
    const updated = await this.prisma.content.update({
      where: { id },
      data: { scenes: scenes as unknown as Prisma.InputJsonValue },
    });
    return toContent(updated);
  }

  /**
   * 미성년자 동의 확인 — 센터 전용 (07 §3-3·02 §E-20, T-W2-23). "촬영한 사람과 확인하는 사람을
   * 분리해야 게이트가 실효를 갖는다" — reviewPolicy='reporter_only' 경로도 이 확인을 거쳐야
   * policyGuard ④(content-workflow.service.ts)를 통과할 수 있다(이 메서드는 그 게이트 자체가 아니라
   * 게이트가 요구하는 사실을 기록하는 쓰기 경로다).
   * hasMinorSubject=false인 콘텐츠는 거부 — 미리 확인해 두고 나중에 플래그를 켜는 우회를 막는다.
   * 이미 확인된 콘텐츠는 멱등 200이며 기존 확인자·시각을 유지한다(최초 확인자가 감사 기록의 원천).
   *
   * ★ 대장 #116 ⓐ — 조기반환만으로는 그 "최초 확인자 보존"이 경합에서 깨진다. 위 두 판정은 **읽은
   * 시점의 스냅샷**이라, 두 센터 운영자가 동시에 들어오면 둘 다 미확인을 보고 통과해 두 번째 쓰기가
   * 최초 확인자를 덮어쓴다. 데이터 파손은 아니지만 **법적 감사 기록의 귀속 오류**라 일반 경합보다
   * 무겁다. 그래서 쓰기를 `minorConsentConfirmedAt: null` 조건부 `updateMany`로 바꿔 판정과 쓰기를
   * 한 원자 연산에 합친다(`applyHop`·`beginPublishing`과 동형 — 이 2메서드만 예외였다).
   * 미적중(count=0)은 실패가 아니라 **경합했다는 사실**이므로, 재조회해서 그 결과로 판정한다.
   */
  async confirmMinorConsent(user: User, id: string): Promise<Content> {
    this.requireCenterActor(user);
    const row = await this.loadOwned(user, id);
    if (!row.hasMinorSubject) {
      throw new DomainException(
        'validation_failed',
        'hasMinorSubject가 꺼져 있는 콘텐츠는 동의를 확인할 수 없습니다',
      );
    }
    if (row.minorConsentConfirmedAt) {
      return toContent(row); // 멱등 — 기존 확인자·시각을 덮어쓰지 않는다
    }

    const confirmedAt = new Date();
    const res = await this.prisma.content.updateMany({
      where: { id, hasMinorSubject: true, minorConsentConfirmedAt: null },
      data: { minorConsentConfirmedByUserId: user.id, minorConsentConfirmedAt: confirmedAt },
    });
    if (res.count === 0) {
      // 읽기 이후 상태가 움직였다 — 다른 확인자가 선점했거나(멱등 유지) 플래그가 내려갔다(D3).
      const fresh = await this.loadOwned(user, id);
      if (!fresh.hasMinorSubject) {
        throw new DomainException(
          'validation_failed',
          'hasMinorSubject가 꺼져 있는 콘텐츠는 동의를 확인할 수 없습니다',
        );
      }
      return toContent(fresh); // 최초 확인자·시각 그대로 — 우리 쓰기는 적용되지 않았다
    }
    return toContent({ ...row, minorConsentConfirmedByUserId: user.id, minorConsentConfirmedAt: confirmedAt });
  }

  /**
   * 동의 확인 철회 — 센터 전용. 미확인 상태면 409(철회할 대상이 없다).
   *
   * 게이트 통과 판정은 `approvedAt`이 아니라 `status_transition_logs` 실측이다(D5 정정, T-W2-23) —
   * `approvedAt`은 `reporter_then_center`의 **기자 승인 hop에서도** 기록되므로(`content-workflow.service.ts`
   * `approve()` 2지점: 센터 승인 시 + 모든 reviewPolicy의 기자 승인 hop) 게이트 통과의 프록시가 아니다.
   * reporter_then_center 콘텐츠가 기자 승인만 받고 아직 센터 검토 전(`awaiting_center_review`)이어도
   * `approvedAt`은 이미 채워져 있어, 그 필드만 보면 아직 미성년자 게이트를 통과하지 않았는데도
   * 철회를 거부하는 오판이 난다. 대신 policyGuard ④가 실제로 지키는 전이(reviewPolicy별로 다름)가
   * `status_transition_logs`에 기록됐는지를 직접 조회한다 — 모든 콘텐츠 전이는 `applyHop` 단일 관문을
   * 거치며 거기서 로그를 남기므로, 상태 목록을 사본으로 하드코딩하지 않고 실제 발생한 전이에서
   * 판정이 파생된다. 행이 있으면 게이트를 이미 통과했으므로 철회해도 송출을 막지 못해 409로 거부한다
   * ("철회했는데 왜 송출되지?"라는 거짓 안심을 만들지 않는다). 사유 바디는 받지 않는다
   * (저장할 컬럼이 없다 — T-W2-24 주민 검수 반려 API 선례).
   *
   * ★ 대장 #116 ⓑ — 그 판정과 쓰기 사이에 승인이 끼어들면 "승인됐는데 철회 성공"이 되어, D5가
   * 막으려던 거짓 안심이 정확히 그 창에서 되살아난다. 방어의 실체는 **status CAS**다: 승인은 반드시
   * status를 바꾸므로(awaiting_*→*_approved), 읽은 status가 그대로일 때만 쓰기가 적중한다.
   * ⚠️ 트랜잭션은 이 경합을 **혼자서는 막지 못한다** — Read Committed에서 다른 트랜잭션이 그 사이
   * 커밋한 로그 INSERT는 우리 SELECT에 안 보이기 때문이다. 여기서 `$transaction`은 조회와 쓰기의
   * 원자 경계일 뿐이고, 경합을 실제로 잡는 것은 where 절의 status·확인여부 조건이다.
   */
  async withdrawMinorConsent(user: User, id: string): Promise<Content> {
    this.requireCenterActor(user);
    const row = await this.loadOwned(user, id);
    if (!row.minorConsentConfirmedAt) {
      throw new DomainException('conflict', '아직 확인되지 않은 동의는 철회할 수 없습니다');
    }
    // reviewPolicy별로 정책 가드 ④가 실제로 지키는 전이가 다르다(content-workflow.service.ts policyGuard 주석 ④ 참조):
    // reporter_only는 기자 종단 승인(awaiting_reporter_review→reporter_approved)이 곧 "승인"이고,
    // 그 외(reporter_then_center)는 센터 승인(awaiting_center_review→center_approved)이 "승인"이다.
    const gateEdge =
      row.reviewPolicy === 'reporter_only'
        ? { fromStatus: 'awaiting_reporter_review', toStatus: 'reporter_approved' }
        : { fromStatus: 'awaiting_center_review', toStatus: 'center_approved' };

    const outcome = await this.prisma.$transaction(async (tx) => {
      const gatePassed = await tx.statusTransitionLog.findFirst({
        where: {
          entityType: 'content',
          entityId: id,
          fromStatus: gateEdge.fromStatus,
          toStatus: gateEdge.toStatus,
        },
      });
      if (gatePassed) return 'gate_passed' as const;
      const res = await tx.content.updateMany({
        where: { id, status: row.status, minorConsentConfirmedAt: { not: null } },
        data: { minorConsentConfirmedByUserId: null, minorConsentConfirmedAt: null },
      });
      return res.count === 1 ? ('withdrawn' as const) : ('raced' as const);
    });

    if (outcome === 'gate_passed') {
      throw new DomainException(
        'conflict',
        '이미 승인된 콘텐츠는 동의 확인을 철회할 수 없습니다',
      );
    }
    if (outcome === 'raced') {
      // status가 움직였다 = 조회 이후 승인·전이가 끼어들었다. 철회했다고 답하면 거짓 안심이 된다.
      throw new DomainException(
        'conflict',
        '조회 이후 콘텐츠 상태가 바뀌었습니다 — 재조회 후 다시 시도하세요',
      );
    }
    return toContent({ ...row, minorConsentConfirmedByUserId: null, minorConsentConfirmedAt: null });
  }

  async transitionLogs(
    user: User,
    id: string,
    page: PageParams,
  ): Promise<Paginated<StatusTransitionLog>> {
    await this.loadReadable(user, id); // 존재+읽기 범위 확인
    const where: Prisma.StatusTransitionLogWhereInput = { entityType: 'content', entityId: id };
    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.statusTransitionLog.count({ where }),
      this.prisma.statusTransitionLog.findMany({
        where,
        orderBy: { at: 'desc' },
        ...toSkipTake(page),
      }),
    ]);
    return toPaginated(rows.map(toStatusTransitionLog), totalCount, page);
  }

  /** 존재 확인 + 소유권 (기자=자기 담당만, center_operator·admin 전체) — 위반 403. 쓰기 경로용 */
  async loadOwned(user: User, id: string): Promise<ContentRow> {
    const row = await this.prisma.content.findUnique({ where: { id } });
    if (!row) throw new DomainException('not_found', '콘텐츠를 찾을 수 없습니다');
    if (isReporterUser(user) && row.reporterId !== user.id) {
      throw new DomainException('forbidden', '자기 담당 콘텐츠만 접근할 수 있습니다');
    }
    return row;
  }

  /**
   * 존재 확인 + **지사 범위** (기자=소속 지사 전체 — list()와 동일 범위, center_operator·admin 전체).
   * 목록에 보이는 항목은 상세·이력도 열려야 한다 (읽기 계약 정합).
   *
   * ⚠ 이름이 `loadReadable`이지만 읽기 전용 판정이 아니다 — **지사 경계 판정**이며 쓰기도 하나
   * 쓴다: 사후 자막 보강(`updateCaptions`, T-W2-34). 정본 03 §C-4가 자막을 채우는 주체를
   * "지사 담당자"로 두었기 때문이며, 그 액터 범위가 정확히 이 판정과 같다(주민 업로드 검수의
   * `ResidentReviewsService.loadForReview`도 같은 규칙을 자기 테이블에 적용하며 이쪽을 원천으로
   * 인용한다). 그 외 모든 쓰기·전이는 여전히 `loadOwned`(소유 기자)다 — 넓히지 말 것.
   */
  private async loadReadable(user: User, id: string): Promise<ContentRow> {
    const row = await this.prisma.content.findUnique({ where: { id } });
    if (!row) throw new DomainException('not_found', '콘텐츠를 찾을 수 없습니다');
    if (isReporterUser(user) && row.stationId !== user.stationId) {
      throw new DomainException('forbidden', '자기 지사 콘텐츠만 조회할 수 있습니다');
    }
    return row;
  }

  /**
   * 센터 전용 액션 방어(defense-in-depth) — 컨트롤러 `@Roles('center_operator','admin')`가 이미
   * 막지만, 다른 서비스 파일(content-workflow.service.ts·distribution-orchestrator.service.ts)의
   * 동명 private 헬퍼와 같은 이유로 서비스 계층에도 명시한다.
   */
  private requireCenterActor(user: User): void {
    if (user.role !== 'center_operator' && user.role !== 'admin') {
      throw new DomainException('forbidden', '센터 운영자 또는 관리자만 수행할 수 있습니다');
    }
  }

  /**
   * SceneId 정책: order가 같으면 기존 id 보존, 신규 장면은 새 id —
   * RevisionRequest.sceneNotes의 sceneId 참조 안정성 (재발급하면 수정 지시가 유령 참조가 된다).
   */
  private mergeScenes(row: ContentRow, inputs: UpdateContentDraftDto['scenes']): Scene[] {
    const existing = zScene.array().parse(row.scenes);
    const byOrder = new Map(existing.map((s) => [s.order, s]));
    return (inputs ?? []).map((input) => ({
      ...input,
      id: byOrder.get(input.order)?.id ?? newId<SceneId>(),
    }));
  }
}
