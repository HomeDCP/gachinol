import type {
  AbortMultipartUploadRequest,
  CompletedUploadPart,
  CompleteMultipartUploadRequest,
  CompleteUploadRequest,
  Content,
  ContentId,
  CreateMultipartUploadRequest,
  CreateMultipartUploadResponse,
  IssueUploadUrlRequest,
  IssueUploadUrlResponse,
  MultipartUploadPart,
} from '@gachinol/shared';
// 값 import(타입 아님) — 서버(services/api s3.service.ts)와 동일 상수를 shared에서 함께 소비한다.
// 대장 #211 보완: 애초 이 값을 로컬에 복제했으나(값이 서버와 어긋나면 413 재발), shared로
// 옮겨 단일 원천화했다(shared content/dto.ts MULTIPART_PART_SIZE_BYTES 주석 참조).
import { MULTIPART_PART_SIZE_BYTES } from '@gachinol/shared';
import type { ApiClient } from '../api/client';
import { UploadAbortedError } from './mock-upload-service';
import { assertRealVideoInput } from './upload-service';
import type { UploadInput, UploadProgress, UploadResult, UploadService } from './upload-service';

/* ══════════════════════════════════════════════════════════════════════════
 * 웹 업로더의 실제 로직 — **주입 가능한 XHR 의존성** (T-W2-02)
 *
 * `http-upload-service.web.ts`가 진짜 `XMLHttpRequest`·`fetch`를 주입해 이 팩토리를 부른다.
 * 로직을 여기 분리해 두는 이유는 **테스트 가능성**이다: jest-expo는 네이티브 플랫폼으로 모듈을
 * 해석해 `.web.ts`를 절대 로드하지 않으므로, 웹 어댑터의 동작(진행률 매핑·취소·실패 복구 통지)을
 * 검증하려면 DOM 없이 부를 수 있는 지점이 필요하다(구독자 `dom-uploader.ts` 선례와 동형).
 *
 * 아래 인터페이스는 DOM 타입의 **구조적 최소 부분집합**이다(`lib.dom` 참조 없이 타입이 서므로
 * 네이티브 타입체크에서도 안전하다).
 * ══════════════════════════════════════════════════════════════════════════ */

export interface ProgressEventLike {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}

export interface XhrLike {
  readonly upload: { onprogress: ((e: ProgressEventLike) => void) | null };
  readonly status: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
  /** 멀티파트 파트 PUT 응답에서 ETag를 읽는다 — 대장 #211. 단일 PUT 경로는 쓰지 않는다. */
  getResponseHeader(name: string): string | null;
}

/**
 * 전송 본문의 구조적 최소 — 실측 크기만 있으면 된다(웹에선 Blob이 이 형태다).
 * `slice`는 멀티파트(대장 #211)가 파트 경계로 잘라내는 데 쓴다 — 실 `Blob.slice(start, end)`와
 * 구조적으로 호환된다(3번째 `contentType` 인자는 선택값이라 이 최소 시그니처를 그대로 만족한다).
 */
export interface BlobLike {
  readonly size: number;
  slice(start: number, end: number): BlobLike;
}

export interface XhrUploadEnv {
  readonly XhrCtor: new () => XhrLike;
  /** `fileUri`(웹 픽커의 blob:·data:)를 전송 가능한 본문으로 해석한다. 실패 시 throw — ① 전이라 서버 무접촉. */
  resolveBody(uri: string): Promise<BlobLike>;
}

/**
 * ②·③ 실패/중단 후 서버측 복구 통지 — ①(upload-url)이 이미 draft|upload_failed→uploading을
 * 커밋했으므로, 그 뒤 실패하면 콘텐츠가 `uploading`에 갇혀 재발급(upload-url, `ISSUABLE=
 * ['draft','upload_failed']`)이 409로 막힌다(재시도 교착). 전용 "실패 통지" 엔드포인트는 없으므로,
 * HEAD 검증 실패 시 내부적으로 uploading→upload_failed로 되돌리는 **기존** `upload-complete`
 * 엔드포인트(services/api UploadService.completeUpload)를 그대로 재사용해 통지한다(신규 서버
 * 엔드포인트 없이 클라이언트만으로 해결 — 서버·shared는 이 태스크 소유 밖).
 * 이 통지 호출 자체의 실패(기대된 400 등)는 삼킨다 — 목적은 응답이 아니라 서버측 부수효과이고,
 * 호출부에는 원래 에러를 그대로 전파해야 한다(이 함수가 원래 에러를 가리면 안 된다).
 *
 * ★ 이 함수가 여기(웹 로직 파일)에 사는 이유: 네이티브(`http-upload-service.ts`)·웹(XHR) 두 어댑터가
 * 같은 복구 의미론을 공유해야 하는데(사본 금지), 웹 해석에서 `./http-upload-service`는
 * `http-upload-service.web.ts` **자신**이라 그쪽에 두면 순환이 된다(구독자 `uploader.web.ts`와
 * 동일 함정). 이 파일은 플랫폼 접미사가 없어 양쪽 해석에서 동일하다.
 */
export async function notifyUploadFailed(
  client: ApiClient,
  contentId: ContentId,
  storageKey: string,
): Promise<void> {
  try {
    await client.request<Content>('POST', `/contents/${contentId}/upload-complete`, {
      body: { contentId, storageKey } satisfies CompleteUploadRequest,
    });
  } catch {
    // 기대된 실패(오브젝트 HEAD 미검출 → 400) — 서버가 이미 그 경로에서 uploading→upload_failed를
    // 커밋했다. 이 catch는 통지 자체의 실패를 삼킬 뿐, 호출부의 원래 에러를 대체하지 않는다.
  }
}

/**
 * presigned PUT — `fetch` 대신 XHR을 쓰는 유일한 이유는 **업로드 진행률**이다(fetch에는 업로드
 * 진행 이벤트가 없다). 파일 바이트는 api를 거치지 않고 스토리지로 직행하며, 서명이 URL에
 * 들어 있으므로 Authorization 헤더를 붙이지 않는다.
 * ★ 에러 메시지에 상태 코드만 싣는다 — presigned URL(서명 포함)을 메시지에 넣지 않는다.
 */
function putWithXhr(
  env: XhrUploadEnv,
  uploadUrl: string,
  body: BlobLike,
  mimeType: string,
  sizeBytes: number,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const xhr = new env.XhrCtor();
    let canceled = false;

    const onAbort = (): void => {
      canceled = true;
      xhr.abort();
    };
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (e) => {
      // 서버·프록시가 total을 안 주는 경우(lengthComputable=false)는 실측 본문 크기로 폴백한다
      const total = e.lengthComputable && e.total > 0 ? e.total : sizeBytes || 1;
      onProgress({
        loadedBytes: e.loaded,
        totalBytes: total,
        ratio: Math.min(e.loaded / total, 1),
      });
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        const total = sizeBytes || 1;
        onProgress({ loadedBytes: total, totalBytes: total, ratio: 1 });
        resolve();
        return;
      }
      reject(new Error(`업로드 전송 실패 (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('업로드 중 연결이 끊겼습니다'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error('업로드에 시간이 너무 오래 걸립니다'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(canceled ? new UploadAbortedError() : new Error('업로드가 중단됐습니다'));
    };

    signal?.addEventListener('abort', onAbort);
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.send(body);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 멀티파트 업로드 (대장 #211 클라이언트측) — Cloudflare 터널이 단일 요청 바디를 정확히
 * 100MiB(104,857,600B)까지만 통과시켜(서버측 실측, 조율자 위임 전제) 큰 원본은 위 단일 PUT
 * 경로로 못 올라간다. 서버가 이미 파트 계획(`MULTIPART_PART_SIZE_BYTES`, shared
 * `content/dto.ts`)을 세워 파트별 presigned URL을 내려준다 — 클라는 그 지시
 * (`parts[].sizeBytes`)대로 자르고 올리기만 한다.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 단일 PUT vs 멀티파트 분기 임계값 — **단일 원천은 `@gachinol/shared`의
 * `MULTIPART_PART_SIZE_BYTES`다**(대장 #211 보완, 2026-09-13). 값을 여기서 재정의·복제하지
 * 않고 그대로 재사용한다 — 서버(`services/api/src/media/s3.service.ts`)도 같은 값을 shared에서
 * import하므로, 이 상수가 바뀌면 서버·클라가 **동시에** 갱신된다("서로 다른 임계를 갖는 상태"가
 * 구조적으로 불가능해짐).
 *
 * ⚠️ 이력 — 최초 구현은 이 값을 서버 로컬 상수로 오인해 apps/reporter에 **값만 복제**했다(서버
 * 상수가 바뀌어도 클라는 모른 채로 남는 상태). 조율자 보완 지시(§10 "공용 타입은
 * packages/shared에 두고 앱·서비스가 import")에 따라 shared로 옮겨 원천 차단했다.
 *
 * 64MiB를 그대로 재사용하는 이유(100MiB를 새로 쓰지 않는 이유)는 shared 쪽 주석에 있다 —
 * 요약하면 서버가 이미 검증한 "Cloudflare 실측 상한 100MiB 대비 34% 여유"를 그대로 물려받아,
 * 이 값 이하는 단일 PUT이 한도에 절대 닿지 않고 초과분은 서버가 어차피 같은 크기로 쪼갠다.
 */
export const MULTIPART_THRESHOLD_BYTES = MULTIPART_PART_SIZE_BYTES;

/**
 * 파트 동시 전송 수 — 가정 회선 업로드가 origin이라(대장 #211 위임 전제) 대역폭 자체가 병목이다.
 * 대역폭 병목 구간에서는 동시성을 올려도 총 처리량이 늘지 않고(파이프가 이미 꽉 차 있다),
 * 오히려 각 XHR이 대역폭을 나눠 가지며 개별 요청의 왕복이 길어져 타임아웃·재시도 부담만
 * 커진다. 그렇다고 완전 순차(1)로 두면 파트 사이의 "요청 종료→다음 요청 시작" 지연(서버 확인
 * 응답 대기)이 매 파트마다 대역폭을 노는 시간으로 버려진다. 2로 잡아 그 유휴 구간만 다음 파트로
 * 메우고, 그 이상은 올리지 않는다(메모리도 고려 — 파트당 최대 64MiB Blob 슬라이스이므로 2개
 * 동시가 128MiB 피크, 그 이상은 저사양 기기에서 부담이 커진다).
 */
export const MULTIPART_PART_CONCURRENCY = 2;

/**
 * ②·③ 멀티파트 실패/중단 후 서버측 복구 통지 — `notifyUploadFailed`와 **역할이 다르다**(사본이
 * 아니라 별개 함수).
 *
 * `notifyUploadFailed`는 전용 "실패 통지" 엔드포인트가 없던 시절 **기존 `upload-complete`를
 * 재사용**해 HEAD 실패를 유도하는 우회였다(그 함수 주석 참조). 멀티파트는 대장 #211에서 **전용
 * 중단 엔드포인트(`multipart-upload-abort`)가 신설**됐으므로 같은 우회를 반복할 이유가 없다 —
 * 오히려 우회하면 S3에 남은 멀티파트 파트(고아)가 정리되지 않는다(제온 MinIO는
 * `AbortIncompleteMultipartUpload` 라이프사이클 규칙이 없음이 실측 확인됨, s3.service.ts 주석).
 * 그래서 멀티파트 경로는 이 함수만 쓰고 `notifyUploadFailed`를 호출하지 않는다.
 *
 * 언제 부르는가: 파트 전송 실패·ETag 누락·사용자 취소 등 **파트 업로드~완료 호출 사이에서 발생한
 * 모든 실패**. 완료 호출(`multipart-upload-complete`) 자체가 서버에 도달해 처리된 뒤 실패한
 * 경우(S3 조립 실패)는 서버가 **스스로** 콘텐츠 롤백 + S3 best-effort abort를 수행하므로
 * (upload.service.ts 주석 — "서버는 완료 실패만 스스로 abort한다") 원칙적으로 다시 부를 필요가
 * 없지만, 이 함수도 함께 호출해 둔다 — 그 시점에 콘텐츠는 이미 `upload_failed`라 서버가 409로
 * 거부할 뿐이고(S3Service.abortMultipartUpload는 문서화된 대로 재중단에 통상 무해) 그 실패는
 * 아래에서 삼킨다. 이렇게 하나의 호출 지점(바깥 `catch`)만 두면 "완료 요청이 네트워크 층에서
 * 소실돼 서버가 아예 못 받은" 애매한 경우(서버가 자체 정리를 할 기회조차 없었던 경우)까지
 * 동일하게 커버된다 — 분기해서 어느 경우인지 판별하는 것보다 안전하다.
 */
export async function notifyMultipartAborted(
  client: ApiClient,
  contentId: ContentId,
  storageKey: string,
  uploadId: string,
): Promise<void> {
  try {
    await client.request<Content>('POST', `/contents/${contentId}/multipart-upload-abort`, {
      body: { contentId, storageKey, uploadId } satisfies AbortMultipartUploadRequest,
    });
  } catch {
    // 기대된 실패(이미 upload_failed로 전이됨 등) — 통지 자체의 실패를 삼킬 뿐, 호출부의
    // 원래 에러를 대체하지 않는다(notifyUploadFailed와 동일 원칙).
  }
}

/**
 * 파트 1개 PUT — 단일 PUT(`putWithXhr`)과 달리 **Content-Type 헤더를 붙이지 않는다**: 서버의
 * `presignUploadPart`(s3.service.ts)가 `UploadPartCommand`에 `ContentType`을 싣지 않으므로
 * 서명 대상에 없는 헤더다(단일 PUT의 `presignPut`은 `ContentType`을 서명에 포함시켜 헤더 부착이
 * 필수인 것과 대비). 성공 시 응답 헤더의 `ETag`를 읽어 resolve한다 — **없으면 즉시 실패**시킨다
 * (조용히 빈 값으로 완료 호출을 하면 서버 `CompleteMultipartUploadCommand`가 원인 불명 실패를
 * 내기 때문, 대장 #211 위임 경고). S3 ETag는 따옴표를 포함한 문자열(`"abc123"`)로 오는데,
 * **그대로(따옴표 포함) 전달한다** — shared dto.ts 주석("완료 호출에 **그대로** 전달")과
 * 서버 `completeMultipartUpload`가 받은 문자열을 가공 없이 SDK `ETag`에 싣는 구현(s3.service.ts)
 * 양쪽이 "가공 금지"를 전제한다. AWS S3 API 자체도 `CompleteMultipartUpload`의 각 파트 ETag가
 * `UploadPart` 응답 헤더 값과 **정확히 일치**할 것을 요구하므로(따옴표째로) 벗기면 불일치로
 * 실패한다.
 */
function putPartWithXhr(
  env: XhrUploadEnv,
  uploadUrl: string,
  body: BlobLike,
  onLoadedChange: (loadedBytes: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const xhr = new env.XhrCtor();
    let canceled = false;

    const onAbort = (): void => {
      canceled = true;
      xhr.abort();
    };
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (e) => {
      onLoadedChange(Math.max(0, e.loaded));
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        const eTag = xhr.getResponseHeader('ETag');
        if (!eTag) {
          reject(new Error('파트 업로드 응답에 ETag가 없습니다 — 다시 시도해주세요'));
          return;
        }
        resolve(eTag);
        return;
      }
      reject(new Error(`파트 업로드 실패 (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('파트 업로드 중 연결이 끊겼습니다'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error('파트 업로드에 시간이 너무 오래 걸립니다'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(canceled ? new UploadAbortedError() : new Error('파트 업로드가 중단됐습니다'));
    };

    signal.addEventListener('abort', onAbort);
    xhr.open('PUT', uploadUrl);
    xhr.send(body);
  });
}

/**
 * 파트 전체를 `MULTIPART_PART_CONCURRENCY`개씩 동시 전송하는 워커 풀 — 어느 파트든 실패하면
 * (또는 `signal`이 취소되면) 내부 컨트롤러를 즉시 abort해 **아직 안 시작했거나 진행 중인 다른
 * 파트도 조기에 멈춘다**(실패가 확정된 업로드에 남은 대역폭을 계속 쓰지 않도록). 진행률은
 * 파트별 최신 loaded를 배열에 기록해두고 매 갱신마다 **전체 합**을 콜백한다 — 각 파트의 loaded는
 * 통상 단조 비감소이지만(브라우저 XHR 관례), 그 관례를 "보장"으로 적어두고 코드는 강제하지 않던
 * 과장 주석이 있었다(대장 #209류, verifier 게이트② 지적). 지금은 호출부(`uploadMultipart`)가
 * 파트별 최댓값으로 **클램프**해 관례가 깨지는 이례적 이벤트가 와도 합산 진행률이 뒤로 가지
 * 않음을 코드로 강제한다.
 */
async function uploadPartsConcurrently(
  env: XhrUploadEnv,
  body: BlobLike,
  serverParts: readonly MultipartUploadPart[],
  onPartLoadedChange: (partIndex: number, loadedBytes: number) => void,
  signal: AbortSignal | undefined,
): Promise<CompletedUploadPart[]> {
  const results: CompletedUploadPart[] = new Array(serverParts.length);
  const offsets: number[] = [];
  {
    let acc = 0;
    for (const part of serverParts) {
      offsets.push(acc);
      acc += part.sizeBytes;
    }
  }

  const internalController = new AbortController();
  const onExternalAbort = (): void => internalController.abort();
  signal?.addEventListener('abort', onExternalAbort);

  let cursor = 0;
  let firstError: unknown = null;

  async function worker(): Promise<void> {
    for (;;) {
      if (internalController.signal.aborted) return;
      const i = cursor;
      if (i >= serverParts.length) return;
      cursor += 1;
      const part = serverParts[i]!;
      const start = offsets[i]!;
      const slice = body.slice(start, start + part.sizeBytes);
      try {
        const eTag = await putPartWithXhr(
          env,
          part.uploadUrl,
          slice,
          (loaded) => onPartLoadedChange(i, Math.min(loaded, part.sizeBytes)),
          internalController.signal,
        );
        results[i] = { partNumber: part.partNumber, eTag };
        onPartLoadedChange(i, part.sizeBytes); // 파트 완료 확정치(성공 시 항상 최댓값)
      } catch (e) {
        if (firstError === null) {
          firstError = e;
          internalController.abort(); // 나머지 진행 중/대기 중 파트도 조기 취소
        }
        return;
      }
    }
  }

  const concurrency = Math.max(1, Math.min(MULTIPART_PART_CONCURRENCY, serverParts.length));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  signal?.removeEventListener('abort', onExternalAbort);

  if (firstError !== null) throw firstError;
  if (signal?.aborted) throw new UploadAbortedError();
  return results;
}

/**
 * 멀티파트 업로드 실 구현 — ① 시작(POST multipart-upload) → ② 파트 동시 전송 → ③ 완료 통지.
 * ①이 성공한 시점부터 서버가 `uploading`을 커밋했으므로(단일 PUT과 동형) ②·③ 구간의 모든 실패·
 * 취소는 `notifyMultipartAborted`로 통지한 뒤 원 에러를 그대로 재던진다.
 */
async function uploadMultipart(
  client: ApiClient,
  env: XhrUploadEnv,
  input: UploadInput,
  body: BlobLike,
  sizeBytes: number,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  // ① 멀티파트 시작 — draft|upload_failed → uploading + 파트별 presigned URL (서버 전이)
  const started = await client.request<CreateMultipartUploadResponse>(
    'POST',
    `/contents/${input.contentId}/multipart-upload`,
    {
      body: {
        contentId: input.contentId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes,
      } satisfies CreateMultipartUploadRequest,
    },
  );

  const partLoaded = new Array<number>(started.parts.length).fill(0);
  const reportProgress = (): void => {
    const loaded = partLoaded.reduce((a, b) => a + b, 0);
    onProgress({
      loadedBytes: loaded,
      totalBytes: sizeBytes,
      ratio: Math.min(loaded / (sizeBytes || 1), 1),
    });
  };

  try {
    // ② 파트 동시 전송(진행률·취소는 내부 컨트롤러가 조율)
    const completedParts = await uploadPartsConcurrently(
      env,
      body,
      started.parts,
      (partIndex, loadedBytes) => {
        // 대장 #211 보완(verifier 게이트②) — 파트별 최댓값으로 클램프해 단조 비감소를 **코드로
        // 강제**한다. 이전에는 "브라우저 XHR의 loaded는 통상 단조 증가한다"는 가정에 기대어
        // 매 갱신을 그대로 덮어썼는데, 그 가정이 깨지면(같은 XHR에서 loaded가 역행하는 비정상
        // 이벤트) 합산 진행률이 사용자에게 뒤로 간다 — 과장 주석(대장 #209류)을 코드가 실제로
        // 보장하도록 바꾼다.
        partLoaded[partIndex] = Math.max(partLoaded[partIndex]!, loadedBytes);
        reportProgress();
      },
      signal,
    );

    // ③ 완료 통지 — S3가 파트를 조립 → uploading → uploaded + 트랜스코딩 인큐(서버)
    await client.request<Content>(
      'POST',
      `/contents/${input.contentId}/multipart-upload-complete`,
      {
        body: {
          contentId: input.contentId,
          storageKey: started.storageKey,
          uploadId: started.uploadId,
          parts: completedParts,
        } satisfies CompleteMultipartUploadRequest,
      },
    );

    return { storageKey: started.storageKey };
  } catch (err) {
    await notifyMultipartAborted(client, input.contentId, started.storageKey, started.uploadId);
    throw err;
  }
}

/**
 * 실 업로드 구현(웹) — presigned PUT 3단계. 상태 전이(draft→uploading→uploaded)는 서버 몫.
 * ① POST /contents/:id/upload-url (IssueUploadUrlRequest → IssueUploadUrlResponse)
 * ② presigned PUT 파일 전송 (진행률·취소는 XHR `upload.onprogress`/`abort`)
 * ③ POST /contents/:id/upload-complete (CompleteUploadRequest → Content)
 *
 * 네이티브 구현(`http-upload-service.ts`)과 다른 점 하나: 본문(⓪)을 ①보다 **먼저** 읽는다.
 * 로컬 파일을 못 읽으면 서버 상태를 건드리지 않고 draft 그대로 실패시키기 위해서다(네이티브는
 * 전송 태스크가 읽기를 지연 수행해 이 순서를 가질 수 없다).
 */
export function createXhrUploadService(client: ApiClient, env: XhrUploadEnv): UploadService {
  return {
    async upload(
      input: UploadInput,
      onProgress: (p: UploadProgress) => void,
      signal?: AbortSignal,
    ): Promise<UploadResult> {
      if (signal?.aborted) throw new UploadAbortedError();
      // 유령 미디어 방어 ①(uri·mimeType) — 근거는 upload-service.ts의 assertRealVideoInput 주석.
      // 빈 fileUri는 fetch()조차 시도하지 않고 여기서 끊는다(서버 무접촉, ①(upload-url) 미호출).
      assertRealVideoInput(input);

      // ⓪ 본문 확보 — 실패 시 서버 무접촉(위 주석)
      const body = await env.resolveBody(input.fileUri);
      // 유령 미디어 방어 ②(0바이트) — Blob은 항상 동기적으로 정확한 size를 알므로(진행률 이벤트의
      // lengthComputable과는 무관한 별개 개념) "측정 불가"란 없다. 예전엔 body.size<=0이면
      // input.sizeBytes로 **폴백**했는데, 그 폴백 자체가 조사자가 짚은 구멍이었다 — fetch('')가
      // 성공한 HTML 셸도 size>0이라 이 분기를 타지 않고 그대로 통과했었다(재현:
      // xhr-upload-service.test.ts "유령 미디어 방어 — 빈 fileUri는..." 테스트 주석의 배경 설명).
      // 0바이트는 폴백하지 말고 여기서 확정적으로 차단한다 — 실측 Blob을 신뢰한다.
      if (body.size <= 0) {
        throw new Error('선택한 영상이 비어 있습니다 — 다시 선택해주세요');
      }
      const sizeBytes = body.size;

      // 대장 #211 — 임계 초과 시 멀티파트 경로(단일 원천·근거는 MULTIPART_THRESHOLD_BYTES 주석).
      if (sizeBytes > MULTIPART_THRESHOLD_BYTES) {
        return uploadMultipart(client, env, input, body, sizeBytes, onProgress, signal);
      }

      // ① 업로드 URL 발급 — draft|upload_failed → uploading (서버 전이. 클라 전이 흉내 금지)
      const issued = await client.request<IssueUploadUrlResponse>(
        'POST',
        `/contents/${input.contentId}/upload-url`,
        {
          body: {
            contentId: input.contentId,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes,
          } satisfies IssueUploadUrlRequest,
        },
      );

      // ①이 성공한 이 시점부터 서버는 uploading을 커밋했다 — 아래에서 던지는 에러는 전부
      // notifyUploadFailed로 서버에 통지(재발급 가능 상태로 복구)한 뒤 원래 에러를 그대로 재전파한다.
      try {
        // ② presigned PUT — 진행률·취소
        await putWithXhr(env, issued.uploadUrl, body, input.mimeType, sizeBytes, onProgress, signal);

        // ③ 완료 통지 — uploading → uploaded + 트랜스코딩 인큐(서버)
        await client.request<Content>('POST', `/contents/${input.contentId}/upload-complete`, {
          body: {
            contentId: input.contentId,
            storageKey: issued.storageKey,
          } satisfies CompleteUploadRequest,
        });

        return { storageKey: issued.storageKey };
      } catch (err) {
        await notifyUploadFailed(client, input.contentId, issued.storageKey);
        throw err;
      }
    },
  };
}
