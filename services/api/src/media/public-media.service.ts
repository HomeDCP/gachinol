import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaAsset as MediaAssetRow } from '@prisma/client';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { CloudflareCacheService } from './cloudflare-cache.service';
import { S3Service } from './s3.service';

/**
 * 공개 사본의 Cache-Control (대장 #129 ⓑ). **env가 아니라 상수다** — 값이 정책이기 때문이다.
 *
 * - `s-maxage=31536000`(엣지 1년): 공개 키에는 세대가 박혀 있고(`contents/{id}/g{n}/...`),
 *   `published`의 유일한 출구는 종결 상태 `archived`라(shared CONTENT_STATUS_TRANSITIONS)
 *   **같은 URL의 바이트가 나중에 바뀌는 경로가 없다**. 즉 URL이 곧 버전이라 엣지는 길게 잡는다.
 *   그리고 엣지는 `CloudflareCacheService.purge`로 **강제 무효화가 가능**하다.
 * - `max-age=3600`(브라우저 1시간): 브라우저 캐시는 purge가 닿지 않는 유일한 층이다.
 *   보관·비공개 전환의 실효 기한이 **24시간**(02 §D-T8 필수 대칭 / 06 삭제 절차 SLA)이므로
 *   브라우저 TTL을 그 안쪽에 둬야 "공개 URL을 지웠는데 계속 재생된다"가 구조적으로 막힌다.
 * - `immutable`은 **의도적으로 붙이지 않는다** — 붙이면 브라우저가 만료 전 재검증을 아예 생략해
 *   위 24시간 SLA와 충돌한다(불변성은 엣지 TTL로 이미 취한다).
 */
export const PUBLIC_MEDIA_CACHE_CONTROL = 'public, max-age=3600, s-maxage=31536000';

/** 공개 사본 기록 3컬럼 — 항상 함께 세팅되고 함께 비워진다(부분 기록 금지) */
type PublicCopyRef = Pick<MediaAssetRow, 'publicBucket' | 'publicKey'>;

/**
 * 공개 렌디션 캐시 서빙 (D-T8, T-W2-10 → T-W2-33) — 공개 렌디션 전용 버킷/프리픽스 분리 + 삭제·비공개
 * 전환 시 공개 객체 제거 + CF 캐시 퍼지를 **같은 서비스에서 대칭으로** 구현한다(정본 "순서 분리 금지").
 *
 * **공개 사본의 존재는 DB(`media_assets.public_bucket`/`public_key`/`public_copied_at`)가 기록한다**
 * (T-W2-33, 대장 #129 ⓐ). T-W2-10은 스키마 무변경을 위해 키를 결정적으로 파생하고 존재는 S3 HEAD로
 * 확인했는데, 그러면 `MEDIA_PUBLIC_BASE_URL`을 켜는 순간 **피드 1페이지(20건)당 최대 20회 오리진 왕복**이
 * 생겨 CDN 서빙의 목적과 정면으로 상충한다. 이제 읽기 경로(`publicUrlForAsset`)는 S3를 전혀 만지지 않는다.
 *
 * 기록의 방향은 **항상 보수적**이다 — "있다"고 잘못 말하면 재생이 깨지고(404), "없다"고 잘못 말하면
 * 서명 URL로 폴백해 재생은 멀쩡하다(CDN 이득만 못 본다). 그래서:
 *   ① 복사는 **성공한 뒤에만** 기록한다(실패·부분실패는 그 자산만 NULL로 남는다 — 기록 단위 = 자산 1건)
 *   ② 제거는 **지우기 전에** 기록을 비운다(중간에 죽어도 "없다"로 남는다)
 * 복사·삭제 모두 S3 관점에서 멱등이라 재시도·재호출이 안전하다.
 */
@Injectable()
export class PublicMediaService {
  private readonly logger = new Logger(PublicMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly cfCache: CloudflareCacheService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get publicBucket(): string {
    return this.config.get('MEDIA_PUBLIC_BUCKET', { infer: true }) ?? this.s3.bucket;
  }

  private get publicPrefix(): string {
    return this.config.get('MEDIA_PUBLIC_PREFIX', { infer: true });
  }

  private get publicBaseUrl(): string | undefined {
    return this.config.get('MEDIA_PUBLIC_BASE_URL', { infer: true });
  }

  /** 원본 storageKey → 공개 버킷 내 키 ('{prefix}/{storageKey}') */
  publicKeyFor(storageKey: string): string {
    return `${this.publicPrefix}/${storageKey}`;
  }

  /** MEDIA_PUBLIC_BASE_URL 미설정이면 undefined(공개 URL 자체가 성립하지 않음) */
  private publicUrlForKey(publicKey: string): string | undefined {
    const base = this.publicBaseUrl;
    if (!base) return undefined;
    return `${base.replace(/\/+$/, '')}/${publicKey}`;
  }

  /**
   * 발행(published) 시점 훅 — 현 세대 720p 렌디션·썸네일을 공개 버킷/프리픽스로 복사(멱등)하고
   * **복사에 성공한 자산만** 공개 사본 위치를 DB에 기록한다.
   * best-effort: 개별 자산 복사 실패는 다른 자산 복사를 막지 않으며, 실패해도 throw하지 않는다
   * (발행 자체를 막을 이유는 아니다 — FeedService는 공개 URL 부재 시 서명 URL로 폴백한다).
   * S3 자격 미설정 등 인프라 부재도 여기서 흡수(로그만) — 로컬 무인프라 개발 무회귀.
   *
   * **읽기 경로와 같은 조건으로 게이트한다(qa-verifier 보강 2)**: `MEDIA_PUBLIC_BASE_URL` 미설정이면
   * `publicUrlForAsset`이 애초에 공개 URL을 내주지 않으므로 — 그 상태에서 복사만 무조건 실행하면
   * **아무도 읽지 않는 사본이 매 publish마다 조용히 쌓인다**(스토리지 실비용, 회수 경로도 archived
   * 도달이 사실상 없어 사실상 영구 누적). 공개 서빙 자체가 꺼져 있으면 복사도 하지 않는다 — 단
   * "꺼서 안 했다"는 사실은 조용히 삼키지 않고 로그로 남긴다("no-op을 성공으로 위장하지 마라" 원칙,
   * CF 퍼지 게이트와 동일 기조). `removePublishedCopies`는 **게이트하지 않는다** — 과거 설정이 켜져
   * 있을 때 만들어진 사본이 이후 설정이 꺼진 채로 archived에 도달해도 정리는 항상 시도해야 한다.
   */
  async syncPublishedCopies(contentId: string, generation: number): Promise<void> {
    if (!this.publicBaseUrl) {
      this.logger.warn(
        `공개 렌디션 복사 스킵(no-op) — MEDIA_PUBLIC_BASE_URL 미설정(공개 서빙 비활성): content=${contentId}`,
      );
      return;
    }
    const assets = await this.selectPublicAssets(contentId, generation);
    const destBucket = this.publicBucket;
    for (const asset of assets) {
      const destKey = this.publicKeyFor(asset.storageKey);
      try {
        await this.s3.copyObject({
          sourceBucket: asset.bucket,
          sourceKey: asset.storageKey,
          destBucket,
          destKey,
          // Cache-Control은 REPLACE로만 반영된다 → ContentType도 반드시 동반(S3Service 주석 참조)
          cacheControl: PUBLIC_MEDIA_CACHE_CONTROL,
          contentType: asset.mimeType,
        });
        this.logger.log(
          `공개 렌디션 복사 완료: content=${contentId} kind=${asset.kind} key=${asset.storageKey}`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `공개 렌디션 복사 실패: content=${contentId} kind=${asset.kind} key=${asset.storageKey} — ${message}`,
        );
        continue; // 실패한 자산은 기록하지 않는다 — "없다"로 남아 서명 URL 폴백(보수적 방향)
      }
      // 복사 성공 이후에만 기록. 이 기록 실패도 삼킨다(기록이 없으면 폴백일 뿐 재생은 멀쩡하다).
      try {
        await this.prisma.mediaAsset.update({
          where: { id: asset.id },
          data: { publicBucket: destBucket, publicKey: destKey, publicCopiedAt: new Date() },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `공개 사본 기록 실패(사본은 존재, 서명 URL로 폴백됨): content=${contentId} key=${destKey} — ${message}`,
        );
      }
    }
  }

  /**
   * 삭제·비공개(archived) 전환 훅 — **필수 대칭**: 공개 복사본 제거 + CF 캐시 퍼지를 동시에 수행한다.
   * (선택적 정리 작업이 아니다 — 이 호출 없이는 "만료 없는 공개 URL"이 24시간 삭제 SLA를 무력화한다.)
   * best-effort throw 없음 — 상세는 syncPublishedCopies와 동일 이유. 실패는 로그로 관측 가능하게 남긴다.
   *
   * **기록은 오브젝트를 지우기 "전에" 비운다**(T-W2-33): 반대 순서면 삭제 후 기록 갱신 전에 죽었을 때
   * DB가 "사본 있음"이라고 거짓말하고 피드가 404 URL을 내준다 — HEAD 판정보다 나쁜 상태다.
   * 지금 순서에서는 최악이라도 "기록 없음 + 객체 잔존"(= 서명 URL 폴백 + 고아 객체 로그)에 그친다.
   *
   * 삭제 대상은 **기록된 위치 우선**, 없으면 현행 설정으로 파생한 키다 — 기록 이전(T-W2-10 시절)에
   * 만들어진 사본도 정리되어야 하기 때문이다(마이그레이션 직후 기존 행은 전부 NULL이다).
   */
  async removePublishedCopies(contentId: string, generation: number): Promise<void> {
    const assets = await this.selectPublicAssets(contentId, generation);
    if (assets.length === 0) {
      await this.cfCache.purge([]);
      return;
    }

    // ① 기록을 먼저 비운다 — 이후 어느 지점에서 죽어도 DB는 "사본 없음"(보수적)으로 남는다.
    try {
      await this.prisma.mediaAsset.updateMany({
        where: { id: { in: assets.map((a) => a.id) } },
        data: { publicBucket: null, publicKey: null, publicCopiedAt: null },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // 기록을 못 비웠어도 삭제·퍼지는 계속한다 — 비공개 전환은 규제(24시간 SLA) 요구라 우선한다.
      // 남은 기록이 피드로 새지는 않는다: 피드는 published만 서빙하고 이 훅은 archived 도달 후다.
      this.logger.error(`공개 사본 기록 해제 실패(content=${contentId}) — ${message}`);
    }

    // ② 객체 제거 + ③ CF 퍼지 (순서 분리 금지 — 같은 호출 안에서 끝낸다)
    const purgeUrls: string[] = [];
    for (const asset of assets) {
      const target = this.publicRefFor(asset);
      try {
        await this.s3.deleteObject(target.publicKey, { bucket: target.publicBucket });
        this.logger.log(
          `공개 렌디션 제거 완료: content=${contentId} kind=${asset.kind} key=${target.publicKey}`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `공개 렌디션 제거 실패(고아 객체 가능): content=${contentId} kind=${asset.kind} ` +
            `bucket=${target.publicBucket} key=${target.publicKey} — ${message}`,
        );
      }
      const url = this.publicUrlForKey(target.publicKey);
      if (url) purgeUrls.push(url);
    }

    const result = await this.cfCache.purge(purgeUrls);
    if (result.attempted && !result.success) {
      this.logger.error(`CF 캐시 퍼지 실패(content=${contentId}) — 사유: ${result.reason}`);
    }
  }

  /**
   * 공개 재생 URL 조회 — FeedService가 서명 URL 대신 소비(D-T8 "Cloudflare 캐시 서빙 전환").
   * **S3를 호출하지 않는다**(T-W2-33 — 피드 항목당 HEAD 왕복 제거). 판정은 DB 기록만 본다.
   *
   * null을 반환하는 경우(호출부는 반드시 서명 URL 폴백을 유지해야 한다 — 공개 URL은 필수가 아니다):
   *  - `MEDIA_PUBLIC_BASE_URL` 미설정(공개 서빙 자체가 꺼짐)
   *  - 기록 없음(아직 미복사·복사 실패·마이그레이션 이전 사본)
   *  - 기록된 버킷이 현재 공개 버킷과 다름 — 베이스 URL은 지금의 공개 버킷 하나만 가리키므로
   *    옛 버킷의 사본을 그 URL로 내주면 404다. 조용히 서명 URL로 폴백하는 편이 안전하다.
   *
   * 남는 위험은 "기록은 있는데 객체가 없다"(운영자 수동 삭제·버킷 라이프사이클 만료)뿐이다.
   * 이건 HEAD 판정을 버린 대가로, 우리가 만든 경로에서는 발생하지 않는다(복사 성공 후에만 기록,
   * 삭제 전에 기록 해제). 발생 시 복구는 재발행(멱등 재복사)이며, 그 사이에도 피드는 500이 아니라
   * 404 URL을 내주는 데 그친다(다른 항목·다른 API는 영향 없음).
   */
  publicUrlForAsset(asset: PublicCopyRef): string | null {
    if (!asset.publicKey) return null;
    if (asset.publicBucket && asset.publicBucket !== this.publicBucket) return null;
    return this.publicUrlForKey(asset.publicKey) ?? null;
  }

  /** 삭제 대상 위치 — 기록된 실제 위치 우선, 없으면 현행 설정으로 파생(기록 이전 사본 정리용) */
  private publicRefFor(asset: MediaAssetRow): { publicBucket: string; publicKey: string } {
    return {
      publicBucket: asset.publicBucket ?? this.publicBucket,
      publicKey: asset.publicKey ?? this.publicKeyFor(asset.storageKey),
    };
  }

  /**
   * 공개 대상 자산 선택 — FeedService.getPlayback과 동일 규칙(720p 렌디션 우선, 없으면 최신
   * 렌디션 + 최신 썸네일)으로 **의도적으로 동기화**한다. 이 선택이 어긋나면 "복사한 것과 피드가
   * 요구하는 것"이 달라져 공개 URL이 있어도 못 쓰거나, 지운 줄 알았는데 다른 렌디션이 남는다.
   */
  private async selectPublicAssets(
    contentId: string,
    generation: number,
  ): Promise<MediaAssetRow[]> {
    const rows: MediaAssetRow[] = await this.prisma.mediaAsset.findMany({
      where: {
        contentId,
        generation,
        status: 'ready',
        kind: { in: ['rendition', 'thumbnail'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const renditions = rows.filter((r) => r.kind === 'rendition');
    const rendition = renditions.find((r) => r.renditionLabel === '720p') ?? renditions[0];
    const thumbnail = rows.find((r) => r.kind === 'thumbnail');
    return [rendition, thumbnail].filter((x): x is MediaAssetRow => Boolean(x));
  }
}
