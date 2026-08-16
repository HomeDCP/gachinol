import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

export interface PurgeResult {
  /** CF API를 실제로 호출했는가 — false면 no-op(미설정 또는 대상 0건) */
  attempted: boolean;
  /** attempted=true일 때만 의미 있음 */
  success: boolean;
  /** no-op·실패 사유 — 관측 가능성 확보용(조용한 성공 위장 금지) */
  reason?: string;
}

/**
 * Cloudflare 캐시 퍼지 — D-T8 필수 대칭 설계의 절반(공개 복사의 반대편, 삭제·비공개 전환 시 호출).
 *
 * **env 게이트 + 미설정 시 no-op**(이 리포의 확립된 패턴 — 카카오 목 어댑터·DCP arbiter와 동형).
 * CF_ZONE_ID·CF_API_TOKEN 둘 다 설정 시에만 실제로 Cloudflare Purge Cache API를 호출한다.
 * 미설정이어도 **조용히 성공한 척하지 않는다** — `attempted:false` + 로그로 "퍼지되지 않은 URL이
 * CDN에 stale로 남을 수 있다"를 명시적으로 남긴다(운영자가 검색 가능하게).
 */
@Injectable()
export class CloudflareCacheService {
  private readonly logger = new Logger(CloudflareCacheService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get zoneId(): string | undefined {
    return this.config.get('CF_ZONE_ID', { infer: true });
  }

  private get apiToken(): string | undefined {
    return this.config.get('CF_API_TOKEN', { infer: true });
  }

  /** CF_ZONE_ID·CF_API_TOKEN 둘 다 설정됐는가 */
  get enabled(): boolean {
    return Boolean(this.zoneId && this.apiToken);
  }

  /**
   * URL 목록을 Cloudflare 엣지 캐시에서 퍼지한다. 절대 throw하지 않는다 — 퍼지 실패가
   * 호출부(콘텐츠 삭제·비공개 전이)를 막아서는 안 된다. 대신 결과를 관측 가능하게 반환·로그한다.
   */
  async purge(urls: readonly string[]): Promise<PurgeResult> {
    if (urls.length === 0) {
      this.logger.debug('CF 캐시 퍼지 스킵 — 대상 URL 0건');
      return { attempted: false, success: false, reason: 'no_urls' };
    }
    if (!this.enabled) {
      this.logger.warn(
        `CF 캐시 퍼지 미실행(no-op) — CF_ZONE_ID/CF_API_TOKEN 미설정. ` +
          `대상 ${urls.length}건이 CDN에 stale로 남을 수 있음: ${urls.join(', ')}`,
      );
      return { attempted: false, success: false, reason: 'not_configured' };
    }

    const timeoutMs = this.config.get('CF_PURGE_TIMEOUT_MS', { infer: true });
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/purge_cache`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: urls }),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`CF 캐시 퍼지 실패(HTTP ${res.status}) — ${urls.length}건: ${body}`);
        return { attempted: true, success: false, reason: `http_${res.status}` };
      }
      this.logger.log(`CF 캐시 퍼지 성공 — ${urls.length}건`);
      return { attempted: true, success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`CF 캐시 퍼지 예외 — ${urls.length}건: ${message}`);
      return { attempted: true, success: false, reason: 'exception' };
    }
  }
}
