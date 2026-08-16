import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaAsset as MediaAssetRow } from '@prisma/client';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { CloudflareCacheService } from './cloudflare-cache.service';
import { S3Service } from './s3.service';

/**
 * 공개 렌디션 캐시 서빙 (D-T8, T-W2-10) — 공개 렌디션 전용 버킷/프리픽스 분리 + 삭제·비공개
 * 전환 시 공개 객체 제거 + CF 캐시 퍼지를 **같은 서비스에서 대칭으로** 구현한다(정본 "순서 분리 금지").
 *
 * 상태를 별도로 저장하지 않는다 — `MediaAsset.storageKey`로부터 공개 키를 **결정적으로 파생**하고
 * (`publicKeyFor`), 존재 여부는 그때그때 S3 HEAD로 확인한다(Prisma 스키마 변경 없이 구현하기 위한
 * 의도적 설계 — 신규 컬럼은 SOLO 웨이브 사유라 이 태스크 범위 밖). 복사·삭제 모두 S3 관점에서
 * 멱등이라 재시도·재호출이 안전하다.
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
  private publicUrlFor(storageKey: string): string | undefined {
    const base = this.publicBaseUrl;
    if (!base) return undefined;
    return `${base.replace(/\/+$/, '')}/${this.publicKeyFor(storageKey)}`;
  }

  /**
   * 발행(published) 시점 훅 — 현 세대 720p 렌디션·썸네일을 공개 버킷/프리픽스로 복사(멱등).
   * best-effort: 개별 자산 복사 실패는 다른 자산 복사를 막지 않으며, 실패해도 throw하지 않는다
   * (발행 자체를 막을 이유는 아니다 — FeedService는 공개 URL 부재 시 서명 URL로 폴백한다).
   * S3 자격 미설정 등 인프라 부재도 여기서 흡수(로그만) — 로컬 무인프라 개발 무회귀.
   *
   * **읽기 경로와 같은 조건으로 게이트한다(qa-verifier 보강 2)**: `MEDIA_PUBLIC_BASE_URL` 미설정이면
   * `resolvePublicUrl`이 애초에 공개 URL을 내주지 않으므로 — 그 상태에서 복사만 무조건 실행하면
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
    for (const asset of assets) {
      try {
        await this.s3.copyObject({
          sourceBucket: asset.bucket,
          sourceKey: asset.storageKey,
          destBucket: this.publicBucket,
          destKey: this.publicKeyFor(asset.storageKey),
        });
        this.logger.log(
          `공개 렌디션 복사 완료: content=${contentId} kind=${asset.kind} key=${asset.storageKey}`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `공개 렌디션 복사 실패: content=${contentId} kind=${asset.kind} key=${asset.storageKey} — ${message}`,
        );
      }
    }
  }

  /**
   * 삭제·비공개(archived) 전환 훅 — **필수 대칭**: 공개 복사본 제거 + CF 캐시 퍼지를 동시에 수행한다.
   * (선택적 정리 작업이 아니다 — 이 호출 없이는 "만료 없는 공개 URL"이 24시간 삭제 SLA를 무력화한다.)
   * best-effort throw 없음 — 상세는 syncPublishedCopies와 동일 이유. 실패는 로그로 관측 가능하게 남긴다.
   */
  async removePublishedCopies(contentId: string, generation: number): Promise<void> {
    const assets = await this.selectPublicAssets(contentId, generation);
    const purgeUrls: string[] = [];
    for (const asset of assets) {
      const publicKey = this.publicKeyFor(asset.storageKey);
      try {
        await this.s3.deleteObject(publicKey, { bucket: this.publicBucket });
        this.logger.log(
          `공개 렌디션 제거 완료: content=${contentId} kind=${asset.kind} key=${publicKey}`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `공개 렌디션 제거 실패: content=${contentId} kind=${asset.kind} key=${publicKey} — ${message}`,
        );
      }
      const url = this.publicUrlFor(asset.storageKey);
      if (url) purgeUrls.push(url);
    }

    const result = await this.cfCache.purge(purgeUrls);
    if (result.attempted && !result.success) {
      this.logger.error(`CF 캐시 퍼지 실패(content=${contentId}) — 사유: ${result.reason}`);
    }
  }

  /**
   * 공개 재생 URL 조회 — FeedService가 서명 URL 대신 소비(D-T8 "Cloudflare 캐시 서빙 전환").
   * MEDIA_PUBLIC_BASE_URL 미설정이거나 공개 버킷에 객체가 없으면(아직 복사 전·복사 실패) null —
   * 호출부는 반드시 서명 URL 폴백을 유지해야 한다(공개 URL을 필수로 취급하지 않는다).
   */
  async resolvePublicUrl(storageKey: string): Promise<string | null> {
    const url = this.publicUrlFor(storageKey);
    if (!url) return null;
    const head = await this.s3.headObject(this.publicKeyFor(storageKey), {
      bucket: this.publicBucket,
    });
    return head ? url : null;
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
