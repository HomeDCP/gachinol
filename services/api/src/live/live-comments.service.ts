import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LiveComment as LiveCommentRow, Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env.schema';
import type { RawComment } from './adapters/comment-source.adapter';

/** 물음표/의문 종결어미 휴리스틱 — 아나운서 우선 응답 후보 판정 */
export const looksLikeQuestion = (message: string): boolean =>
  /[?？]/.test(message) || /(까요|나요|가요|을까|ㄹ까|어때|어떤|언제|어디|무엇|누구|얼마|왜)/.test(message);

/**
 * live_comments의 유일 DB 기록자 — 정규화·멱등 영속(dedup)·프롬프터 마킹·초기 조회.
 * 멱등: createMany skipDuplicates((channel,external) unique) + status collected→prompted 전이.
 * 재수집·재-poll은 두 가드로 신규 0에 수렴한다.
 */
@Injectable()
export class LiveCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Raw → createMany 입력. status='collected', isQuestion=raw우선 ?? 휴리스틱. */
  normalize(
    raw: RawComment,
    ctx: { liveSessionId: string; channelAccountId: string; platform: string },
  ): Prisma.LiveCommentCreateManyInput {
    return {
      id: uuidv7(),
      liveSessionId: ctx.liveSessionId,
      channelAccountId: ctx.channelAccountId,
      platform: ctx.platform,
      externalCommentId: raw.externalCommentId,
      authorName: raw.authorName,
      authorExternalId: raw.authorExternalId ?? null,
      authorAvatarUrl: raw.authorAvatarUrl ?? null,
      message: raw.message,
      isQuestion: raw.isQuestion ?? looksLikeQuestion(raw.message),
      status: 'collected',
      postedAt: new Date(raw.postedAt),
    };
  }

  /** 멱등 영속 — (channel, external) 중복은 조용히 건너뜀. 반환=시도 건수(신규 판정은 상태로) */
  async persistMany(rows: readonly Prisma.LiveCommentCreateManyInput[]): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.liveComment.createMany({ data: [...rows], skipDuplicates: true });
  }

  /**
   * 아직 프롬프터에 안 나간 신규분 — status='collected'만 postedAt 오름차순(배치 상한 LIVE_COMMENT_BATCH_MAX).
   * status 전이(collected→prompted)가 재-poll 멱등의 단일 진실 → 재호출은 0건에 수렴.
   */
  async fetchUnprompted(liveSessionId: string): Promise<LiveCommentRow[]> {
    const take = this.config.get('LIVE_COMMENT_BATCH_MAX', { infer: true });
    return this.prisma.liveComment.findMany({
      where: { liveSessionId, status: 'collected' },
      orderBy: { postedAt: 'asc' },
      take,
    });
  }

  /** 프롬프터 푸시 완료 마킹 — collected→prompted CAS(+promptedAt). 이미 prompted면 무해 skip. */
  async markPrompted(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.liveComment.updateMany({
      where: { id: { in: [...ids] }, status: 'collected' },
      data: { status: 'prompted', promptedAt: new Date() },
    });
  }

  /** prompter.join 초기 배치 — collected/prompted 최근 N, postedAt 오름차순 */
  async recentForPrompter(liveSessionId: string): Promise<LiveCommentRow[]> {
    const take = this.config.get('LIVE_COMMENT_BATCH_MAX', { infer: true });
    const rows = await this.prisma.liveComment.findMany({
      where: { liveSessionId, status: { in: ['collected', 'prompted'] } },
      orderBy: { postedAt: 'desc' },
      take,
    });
    return rows.reverse();
  }
}
