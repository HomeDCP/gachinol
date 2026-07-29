import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { parseArbiterState, type DcpArbiterState } from './arbiter-policy';

/**
 * DCP api(dcpx-api) 읽기 전용 클라이언트 — 상태 조회 + SSE 구독.
 *
 * **DCP 스택에 아무 변경도 가하지 않는다**(GET만). 접근은 Caddy(:443, BasicAuth·맥 전용)를 우회해
 * 호스트 루프백 `http://host.docker.internal:8080`으로 직접 간다 — dcpx-api가 host net에서
 * 127.0.0.1에만 바인드하므로, bridge 컨테이너인 우리는 compose `extra_hosts`로 호스트를 가리킨다.
 *
 * ⚠️ 경로 prefix `/api`는 필수다. 빼면 404가 아니라 **SPA index.html이 200으로** 돌아오므로
 * (DCP측 실측), Content-Type이 JSON인지 반드시 확인한다.
 */

/** SSE 프레임 분리 — 완성된 프레임들과 남은 버퍼. 순수 함수. */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  return { frames: parts.filter((f) => f.trim().length > 0), rest };
}

/** SSE 프레임의 event 이름(없으면 'message'가 기본). 순수 함수. */
export function sseEventName(frame: string): string {
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) return line.slice('event:'.length).trim();
  }
  return 'message';
}

@Injectable()
export class DcpArbiterClient {
  private readonly logger = new Logger(DcpArbiterClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** 아비터 활성 여부 — DCP_ARBITER_URL 미설정 시 전 기능 비활성(단독 운영 시 정상) */
  get baseUrl(): string | null {
    return this.config.get('DCP_ARBITER_URL', { infer: true }) ?? null;
  }

  /**
   * 현재 DCP 상태 조회. 실패(도달 불가·비JSON·계약 위반)는 **null**을 반환하며,
   * 정지 여부는 호출부의 failMode가 결정한다(여기서 정책 판단을 하지 않는다).
   */
  async fetchState(): Promise<DcpArbiterState | null> {
    const base = this.baseUrl;
    if (!base) return null;
    const timeoutMs = this.config.get('DCP_ARBITER_TIMEOUT_MS', { infer: true });
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await fetch(`${base}/api/arbiter/state`, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!res.ok) {
        this.logger.warn(`DCP 상태 조회 실패 — HTTP ${res.status}`);
        return null;
      }
      // prefix 누락 시 SPA HTML이 200으로 오는 함정 방어(DCP측 실측 경고)
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        this.logger.warn(`DCP 상태 조회 실패 — JSON이 아님(content-type=${contentType})`);
        return null;
      }
      const parsed = parseArbiterState(await res.json());
      if (!parsed) this.logger.warn('DCP 상태 조회 실패 — 계약 파싱 불가');
      return parsed;
    } catch (e) {
      this.logger.warn(`DCP 상태 조회 실패 — ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * SSE(`/api/stream`) 구독 — 이벤트를 **트리거로만** 쓴다(진실은 fetchState).
   * 이렇게 하면 DCP의 state enum을 한 줄도 파싱하지 않으므로 그쪽 변경에 면역이다.
   * `snapshot`(접속 시 1회)·`state_changed` 수신 시 onTrigger를 호출한다.
   *
   * SSE는 best-effort(Redis Pub/Sub)라 순단 시 이벤트가 누락될 수 있다 — 폴백 폴링과 병행 전제.
   * 반환값은 구독 해제 함수.
   */
  subscribe(onTrigger: () => void): () => void {
    const base = this.baseUrl;
    if (!base) return () => undefined;

    const controller = new AbortController();
    let stopped = false;
    let backoffMs = 1000;

    const loop = async (): Promise<void> => {
      while (!stopped) {
        try {
          const res = await fetch(`${base}/api/stream`, {
            headers: { Accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          this.logger.log('DCP SSE 구독 시작');
          backoffMs = 1000; // 연결 성공 → 백오프 초기화

          const decoder = new TextDecoder();
          let buffer = '';
          for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            if (stopped) break;
            buffer += decoder.decode(chunk, { stream: true });
            const { frames, rest } = splitSseFrames(buffer);
            buffer = rest;
            for (const frame of frames) {
              const name = sseEventName(frame);
              if (name === 'state_changed' || name === 'snapshot') onTrigger();
            }
          }
        } catch (e) {
          if (stopped) return;
          this.logger.warn(`DCP SSE 끊김 — ${(e as Error).message} (${backoffMs}ms 후 재연결)`);
        }
        if (stopped) return;
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    };

    void loop();
    return () => {
      stopped = true;
      controller.abort();
    };
  }
}
