import { Injectable } from '@nestjs/common';
import type { ProducedAsset } from '@gachinol/shared';
import { mediaOutputKeyPrefix, originalStorageKey } from '@gachinol/shared';
import type { MediaAsset as MediaAssetRow, Prisma } from '@prisma/client';
import { newId } from '../common/ids';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';

/**
 * media_assets의 유일 기록자 — 멱등 생성(upsert on (bucket, storageKey))의 유일 소유자.
 * QueueEvents 다중 수신·재전송에도 (bucket, storageKey) unique가 하드 가드 → 1행 유지.
 */
@Injectable()
export class MediaAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  /** 'contents/{contentId}/g1/original.{ext}' */
  originalKey(contentId: string, ext: string): string {
    return originalStorageKey(contentId, ext);
  }

  /** 'contents/{contentId}/g{n}/' */
  outputPrefix(contentId: string, generation: number): string {
    return mediaOutputKeyPrefix(contentId, generation);
  }

  /**
   * 업로드 URL 발급 시 original(pending) 멱등 생성 (재-issue 안전).
   * 확장자가 바뀌는 재발급(예: original.mp4 → original.mov)은 (bucket,storageKey)가 달라
   * 새 행을 INSERT하므로, 같은 (content, generation=1)에 original 행이 2건 이상 공존할 수 있다.
   * 그러면 findOriginal이 비결정적으로 엉뚱한 원본을 골라 완료 검증이 잠기거나
   * 트랜스코딩이 죽은 원본을 가리킨다 → 현재 키의 original만 남기고 이전 세대1 original 행을 정리해
   * '(content, generation=1)당 original 1행' 불변식을 유지한다.
   */
  async createOriginalPending(
    contentId: string,
    storageKey: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<MediaAssetRow> {
    const bucket = this.s3.bucket;
    const row = await this.prisma.mediaAsset.upsert({
      where: { bucket_storageKey: { bucket, storageKey } },
      create: {
        id: newId(),
        ownerKind: 'content',
        contentId,
        kind: 'original',
        status: 'pending',
        generation: 1,
        bucket,
        storageKey,
        mimeType,
        sizeBytes: BigInt(sizeBytes),
      },
      update: {},
    });
    // 이전 확장자로 발급된 잔존 original 행 제거(현재 키만 유지) — 단일 원본 불변식
    await this.prisma.mediaAsset.deleteMany({
      where: { contentId, kind: 'original', generation: 1, storageKey: { not: storageKey } },
    });
    return row;
  }

  /** 업로드 완료 검증 통과 시 original을 ready로 + 실측 size 갱신 */
  async markReady(
    storageKey: string,
    probe?: { sizeBytes?: number; durationSec?: number },
  ): Promise<void> {
    const bucket = this.s3.bucket;
    const data: Prisma.MediaAssetUncheckedUpdateInput = { status: 'ready' };
    if (probe?.sizeBytes != null) data.sizeBytes = BigInt(probe.sizeBytes);
    if (probe?.durationSec != null) data.durationSec = probe.durationSec;
    await this.prisma.mediaAsset.update({
      where: { bucket_storageKey: { bucket, storageKey } },
      data,
    });
  }

  /** 업로드 검증 실패 시 original을 failed 표기 */
  async markFailed(storageKey: string): Promise<void> {
    const bucket = this.s3.bucket;
    await this.prisma.mediaAsset
      .update({
        where: { bucket_storageKey: { bucket, storageKey } },
        data: { status: 'failed' },
      })
      .catch(() => undefined); // 행 부재(원본 미생성)여도 무해
  }

  /** 워커 산출물 멱등 upsert (완료 이벤트 소비). (bucket, storageKey) unique가 다중 수신 가드 */
  async upsertOutput(
    contentId: string,
    generation: number,
    jobId: string,
    out: ProducedAsset,
  ): Promise<MediaAssetRow> {
    const common = {
      ownerKind: 'content',
      contentId,
      kind: out.kind,
      status: 'ready',
      generation,
      bucket: out.bucket,
      storageKey: out.storageKey,
      mimeType: out.mimeType,
      sizeBytes: BigInt(out.sizeBytes),
      durationSec: out.durationSec ?? null,
      width: out.width ?? null,
      height: out.height ?? null,
      bitrateKbps: out.bitrateKbps ?? null,
      videoCodec: out.videoCodec ?? null,
      audioCodec: out.audioCodec ?? null,
      renditionLabel: out.renditionLabel ?? null,
      checksumSha256: out.checksumSha256,
      createdByJobId: jobId,
    };
    return this.prisma.mediaAsset.upsert({
      where: { bucket_storageKey: { bucket: out.bucket, storageKey: out.storageKey } },
      create: { id: newId(), ...common },
      // 메타는 갱신하되 생성 계보(id·createdByJobId)는 보존
      update: {
        status: 'ready',
        sizeBytes: common.sizeBytes,
        durationSec: common.durationSec,
        width: common.width,
        height: common.height,
        bitrateKbps: common.bitrateKbps,
        videoCodec: common.videoCodec,
        audioCodec: common.audioCodec,
        renditionLabel: common.renditionLabel,
        checksumSha256: common.checksumSha256,
      },
    });
  }

  /**
   * 현 세대 원본 자산 조회. 완료 검증(upload)·인큐(queue-producer) 두 핫패스가 의존하므로
   * 결정적이어야 한다: failed 원본은 배제(정리 이전 잔존분 방어)하고 최신 createdAt 우선으로 정렬해
   * orderBy 없는 findFirst의 Postgres 무순서 비결정성을 제거한다.
   */
  async findOriginal(contentId: string, generation = 1): Promise<MediaAssetRow | null> {
    return this.prisma.mediaAsset.findFirst({
      where: { contentId, kind: 'original', generation, status: { not: 'failed' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 상세 DTO용 — 현 세대 산출물 (original 포함) */
  async listForContent(contentId: string, generation: number): Promise<MediaAssetRow[]> {
    return this.prisma.mediaAsset.findMany({
      where: { contentId, generation },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string): Promise<MediaAssetRow | null> {
    return this.prisma.mediaAsset.findUnique({ where: { id } });
  }
}
