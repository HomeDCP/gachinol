import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AnalyzeRequest, AnalyzeResponse } from '@gachinol/shared';
import type { Env } from '../config/env.schema';

/**
 * ai-worker HTTP 경계 — POST {AI_WORKER_URL}/analyze.
 * Node 24 전역 fetch + AbortSignal.timeout 사용(신규 HTTP 의존 없음).
 * non-2xx/timeout은 throw → 호출측(인프로세스 Analysis 워커)의 BullMQ가 재시도/소진 처리.
 * in-call 재시도는 하지 않는다(media-worker "throw만" 원칙과 정합 — 재시도는 잡 attempts의 몫).
 */
@Injectable()
export class AiWorkerClient {
  private readonly logger = new Logger(AiWorkerClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    const url = this.config.get('AI_WORKER_URL', { infer: true });
    if (!url) throw new Error('AI_WORKER_URL 미설정 — ai-worker 분석 호출 불가');
    const timeoutMs = this.config.get('AI_WORKER_TIMEOUT_MS', { infer: true });

    const res = await fetch(`${url.replace(/\/+$/, '')}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ai-worker /analyze ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return (await res.json()) as AnalyzeResponse;
  }
}
