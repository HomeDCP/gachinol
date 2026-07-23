import { createHash } from 'node:crypto';
import { JobType, type PublicationId } from '@gachinol/shared';

/**
 * BullMQ 송출 큐 wire 계약 — api-내부 자체완결(shared 아님).
 *
 * 송출 워커는 api **인프로세스**(analysis-worker 동형)이므로 생산자↔소비자가 언어·프로세스 경계를
 * 넘지 않는다(media/analysis가 wire를 shared에 둔 이유 = 별도 프로세스 worker가 여기엔 없음).
 * shared에서는 JobType.Publish·PublicationId만 소비한다(shared 최소 준수).
 *
 * ★ shared JobPayloadMap.publish({publicationIds})와 상이 — 그쪽은 명목 Job-레코드 계약(미영속),
 *   여기는 워커가 DB 없이 송출하도록 좌표를 패킹한 큐 job.data(PublishTargetItem). 두 계약 병존(사본 아님).
 */

/** 송출 큐 이름 — api Queue/QueueEvents/Worker가 공유 */
export const DISTRIBUTION_QUEUE_NAME = 'distribution' as const;
export type DistributionQueueName = typeof DISTRIBUTION_QUEUE_NAME;

/** BullMQ job.name — shared JobType.Publish 재사용 */
export const PUBLISH_JOB_NAME = JobType.Publish; // 'publish'

/** 워커가 DB 없이 송출하도록 생산자가 채널+콘텐츠 좌표를 패킹(MediaJobData 동형) */
export interface PublishTargetItem {
  publicationId: PublicationId;
  /** 어댑터 레지스트리 키 (Platform) */
  platform: string;
  externalChannelId: string;
  /** 시크릿 저장소 키 이름만(값 아님) */
  credentialRef: string;
  /** = publicationId (실 카카오 중복송출 방지 토큰) */
  idempotencyKey: string;
  message: {
    title: string;
    description?: string;
    playbackUrl?: string;
    thumbnailUrl?: string;
  };
}

export interface PublishJobData {
  publications: readonly PublishTargetItem[];
}

/** 워커→api(job.returnvalue) — 채널 부분실패는 throw 아닌 데이터 */
export interface PublishResultItem {
  publicationId: PublicationId;
  ok: boolean;
  externalPostId?: string;
  externalUrl?: string;
  error?: string;
}

export interface PublishJobResult {
  results: readonly PublishResultItem[];
}

/**
 * 결정적 jobId — (content, generation, 대상 publication 집합) 단위 dedup. mediaJobId 동형.
 *
 * ★ pubId 집합을 접미 해시로 반영하는 이유(동시성): enqueuePublish는 전체 distribute(전 채널)와
 *   단일 채널 retry(1건) 양쪽에서 호출된다. (content, generation)만으로 키를 잡으면 두 채널 B·C를
 *   동시 재시도할 때 remove(jobId)가 서로의 잡을 지워(clobber) 한쪽이 queued에 영구 고착한다.
 *   대상 집합이 다르면 다른 jobId(전체 vs 채널별이 격리), 같은 집합 재요청은 같은 jobId(멱등 재큐).
 *   pubId를 정렬 후 해시 → 순서 무관·결정적.
 *
 * ★ 형식 제약(BullMQ): 콜론(:) 포함 커스텀 jobId는 정확히 3파트(콜론 2개)만 허용된다
 *   (repeatable job 하위호환). 그래서 해시는 새 콜론 없이 g{gen} 세그먼트에 '-'로 접미한다
 *   → `publish:{contentId}:g{gen}-{hash}` = 콜론 2개 유지(contentId=UUID·hash=hex라 콜론 무포함).
 */
export const publishJobId = (
  contentId: string,
  generation: number,
  publicationIds: readonly string[],
): string => {
  const digest = createHash('sha1')
    .update([...publicationIds].sort().join(','))
    .digest('hex')
    .slice(0, 12);
  return `publish:${contentId}:g${generation}-${digest}`;
};
