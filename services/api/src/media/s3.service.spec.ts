import { S3Client } from '@aws-sdk/client-s3';
import { DomainException } from '../common/errors/domain.exception';
import {
  MULTIPART_MAX_PART_COUNT,
  MULTIPART_MIN_PART_SIZE_BYTES,
  MULTIPART_PART_SIZE_BYTES,
  planMultipartUpload,
  S3Service,
} from './s3.service';

/** CloudflareCacheService 선례(makeConfig 패턴) — Nest ConfigService<Env,true> 최소 더블 */
const makeConfig = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    S3_ENDPOINT: undefined,
    S3_REGION: 'ap-northeast-2',
    S3_BUCKET: 'gachinol-media',
    S3_ACCESS_KEY: 'test-access',
    S3_SECRET_KEY: 'test-secret',
    S3_FORCE_PATH_STYLE: true,
    S3_PUBLIC_ENDPOINT: undefined,
    S3_PRESIGN_EXPIRES_SEC: 900,
    ...over,
  };
  return { get: (k: string) => values[k] } as never;
};

describe('planMultipartUpload — 순수 함수(네트워크·S3 호출 없음)', () => {
  it('실측 최대 원본(173MB) — 파트 크기 합이 실제 바이트 수와 정확히 일치한다', () => {
    const total = 173 * 1024 * 1024;
    const plan = planMultipartUpload(total);
    expect(plan.partSizeBytes).toBe(MULTIPART_PART_SIZE_BYTES);
    const sum = plan.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
    expect(sum).toBe(total);
    // 마지막 파트를 제외한 모든 파트는 기본 파트 크기와 같아야 한다
    plan.parts.slice(0, -1).forEach((p) => expect(p.sizeBytes).toBe(MULTIPART_PART_SIZE_BYTES));
    // partNumber는 1부터 시작하는 연속 정수(S3 규약)
    expect(plan.parts.map((p) => p.partNumber)).toEqual(
      Array.from({ length: plan.parts.length }, (_, i) => i + 1),
    );
  });

  it('평균 실측 원본(128MB) — 2개 파트로 분할, 합이 일치', () => {
    const total = 128 * 1024 * 1024;
    const plan = planMultipartUpload(total);
    const sum = plan.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
    expect(sum).toBe(total);
    expect(plan.parts).toHaveLength(2);
  });

  it('정확히 나누어떨어지는 크기 — 마지막 파트도 기본 파트 크기와 같다(나머지 0으로 남지 않음)', () => {
    const total = MULTIPART_PART_SIZE_BYTES * 3;
    const plan = planMultipartUpload(total);
    expect(plan.parts).toHaveLength(3);
    expect(plan.parts[2]!.sizeBytes).toBe(MULTIPART_PART_SIZE_BYTES);
    expect(plan.parts.reduce((acc, p) => acc + p.sizeBytes, 0)).toBe(total);
  });

  it('파트 크기보다 작은 파일 — 파트 1개(유일한 파트라 5MiB 최소 제약이 적용되지 않음)', () => {
    const total = 1024; // 1KB
    const plan = planMultipartUpload(total);
    expect(plan.parts).toEqual([{ partNumber: 1, sizeBytes: 1024 }]);
  });

  it('0 이하 크기는 거부', () => {
    expect(() => planMultipartUpload(0)).toThrow(DomainException);
    expect(() => planMultipartUpload(-1)).toThrow(DomainException);
  });

  it('파트 크기가 S3 규약 최소(5MiB) 미만이면 거부', () => {
    expect(() =>
      planMultipartUpload(10 * 1024 * 1024, MULTIPART_MIN_PART_SIZE_BYTES - 1),
    ).toThrow(DomainException);
  });

  it('파트 수가 상한(10,000)을 넘으면 거부', () => {
    const total = MULTIPART_MIN_PART_SIZE_BYTES * (MULTIPART_MAX_PART_COUNT + 1);
    expect(() => planMultipartUpload(total, MULTIPART_MIN_PART_SIZE_BYTES)).toThrow(
      DomainException,
    );
  });

  /**
   * 뮤테이션 자가확인 대상(위임 지시) — 이 결함의 본질은 "파트 크기가 Cloudflare 실측 한도
   * (100MiB=104,857,600B, 이분 탐색 확정)를 넘으면 안 된다"는 것이다. 여기서 그 상한을 직접
   * 코드로 고정한다: 기본 파트 크기가 한도 미만이며, 경계에 딱 붙지 않고(최소 10% 이상 여유)
   * 실제로는 34% 여유(64MiB vs 100MiB)를 둔다. `MULTIPART_PART_SIZE_BYTES`를 100MiB 초과값
   * (예: 110*1024*1024)으로 바꾸면 이 테스트가 즉시 red가 된다 — 조율자 뮤테이션 지시가 요구한
   * 자가확인을 이 assertion이 담당한다.
   */
  it('기본 파트 크기는 Cloudflare 실측 한도(100MiB=104,857,600B) 아래 안전 여유를 둔다', () => {
    const CLOUDFLARE_LIMIT_BYTES = 104_857_600;
    expect(MULTIPART_PART_SIZE_BYTES).toBeLessThan(CLOUDFLARE_LIMIT_BYTES);
    expect(CLOUDFLARE_LIMIT_BYTES - MULTIPART_PART_SIZE_BYTES).toBeGreaterThan(
      CLOUDFLARE_LIMIT_BYTES * 0.1,
    );
  });

  /**
   * 게이트② 보완(verifier 지적 — 뮤테이션 무반응) — 위 "기본 파트 크기…" 테스트와 `sum===total`류
   * 단언들은 **파트 수 산식 자체의 회귀**를 못 잡는다. `Math.ceil`을 `Math.floor`로 바꾸면(예:
   * 173MB 총합에서 partCount가 3→2로 줄어) **나머지가 항상 마지막 파트로 흡수**되므로 합계는
   * 여전히 항등(`sum===total`)이지만, 그 마지막 파트 자체가 **Cloudflare 100MiB 한도를 그대로
   * 초과**한다(173MB−64MiB=약 109MB > 104,857,600B) — #211이 고치려던 결함이 파트 수 산식
   * 하나의 회귀만으로 그대로 재발한다. 그래서 여기서는 **개별 파트 크기**(합계가 아니라)를
   * 실측 최대 원본(173MB, 정확히 나누어떨어지지 않는 값)을 포함한 여러 비정수배 크기에 대해
   * 전수 검사한다. `planMultipartUpload`의 `Math.ceil`을 `Math.floor`로 바꾸면 이 테스트가
   * red가 됨을 on-disk 뮤테이션 + jest로 확인했다(보고 ③ 참조).
   */
  it('개별 파트 크기 전수가 Cloudflare 한도 미만이다(파트 수 산식 회귀 방지 — 173MB 등 비정수배 입력)', () => {
    const CLOUDFLARE_LIMIT_BYTES = 104_857_600;
    const totals = [
      173 * 1024 * 1024, // 실측 최대 원본 — 64MiB로 정확히 나누어떨어지지 않음(ceil이 실제로 갈리는 지점)
      128 * 1024 * 1024, // 실측 평균 원본
      MULTIPART_PART_SIZE_BYTES + 1, // 파트 크기 바로 위 — 마지막 파트가 1바이트인 극단 경계
      MULTIPART_PART_SIZE_BYTES * 3, // 정수배(마지막 파트도 기본 크기와 같은 경우)
    ];
    for (const total of totals) {
      const plan = planMultipartUpload(total);
      for (const part of plan.parts) {
        expect(part.sizeBytes).toBeGreaterThan(0);
        expect(part.sizeBytes).toBeLessThan(CLOUDFLARE_LIMIT_BYTES); // ★ 핵심 — 개별 파트 크기
      }
      // 합계 항등도 함께 고정 — "합은 맞는데 마지막 파트가 한도를 넘는" 사각을 명시적으로 배제
      expect(plan.parts.reduce((acc, p) => acc + p.sizeBytes, 0)).toBe(total);
    }
  });
});

describe('S3Service — 멀티파트 AWS 호출', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('createMultipartUpload: Bucket/Key/ContentType을 실어 보내고 UploadId를 반환한다', async () => {
    const sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({ UploadId: 'upload-1' } as never);
    const svc = new S3Service(makeConfig());

    const result = await svc.createMultipartUpload('contents/c-1/g1/original.mp4', {
      contentType: 'video/mp4',
    });

    expect(result).toEqual({ uploadId: 'upload-1' });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0]![0] as unknown as { input: Record<string, unknown> };
    expect(command.input).toEqual({
      Bucket: 'gachinol-media',
      Key: 'contents/c-1/g1/original.mp4',
      ContentType: 'video/mp4',
    });
  });

  it('createMultipartUpload: S3 응답에 UploadId가 없으면 internal 예외(빈 uploadId로 진행하지 않음)', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const svc = new S3Service(makeConfig());
    await expect(svc.createMultipartUpload('contents/c-1/g1/original.mp4')).rejects.toBeInstanceOf(
      DomainException,
    );
  });

  it('presignUploadPart: 공개 엔드포인트(S3_PUBLIC_ENDPOINT) 설정 시 그 엔드포인트로 서명한다(실기기 도달성)', async () => {
    const svc = new S3Service(
      makeConfig({
        S3_PUBLIC_ENDPOINT: 'https://public.example.com',
        S3_ENDPOINT: 'https://internal.example.com',
      }),
    );
    const { url, expiresAt } = await svc.presignUploadPart(
      'contents/c-1/g1/original.mp4',
      'upload-1',
      1,
    );
    expect(url.startsWith('https://public.example.com/')).toBe(true);
    expect(url).toContain('partNumber=1');
    expect(url).toContain('uploadId=upload-1');
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('completeMultipartUpload: 클라가 순서를 뒤섞어 보내도 partNumber 오름차순으로 정렬해 전달', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const svc = new S3Service(makeConfig());

    await svc.completeMultipartUpload('contents/c-1/g1/original.mp4', 'upload-1', [
      { partNumber: 2, eTag: '"e2"' },
      { partNumber: 1, eTag: '"e1"' },
    ]);

    const command = sendSpy.mock.calls[0]![0] as unknown as { input: Record<string, unknown> };
    expect(command.input).toEqual({
      Bucket: 'gachinol-media',
      Key: 'contents/c-1/g1/original.mp4',
      UploadId: 'upload-1',
      MultipartUpload: {
        Parts: [
          { PartNumber: 1, ETag: '"e1"' },
          { PartNumber: 2, ETag: '"e2"' },
        ],
      },
    });
  });

  it('completeMultipartUpload: S3가 거부하면(파트 누락·ETag 불일치 등) 그대로 throw한다', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(new Error('InvalidPart') as never);
    const svc = new S3Service(makeConfig());
    await expect(
      svc.completeMultipartUpload('contents/c-1/g1/original.mp4', 'upload-1', []),
    ).rejects.toThrow('InvalidPart');
  });

  it('abortMultipartUpload: Bucket/Key/UploadId로 중단 요청을 보낸다', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const svc = new S3Service(makeConfig());
    await svc.abortMultipartUpload('contents/c-1/g1/original.mp4', 'upload-1');
    const command = sendSpy.mock.calls[0]![0] as unknown as { input: Record<string, unknown> };
    expect(command.input).toEqual({
      Bucket: 'gachinol-media',
      Key: 'contents/c-1/g1/original.mp4',
      UploadId: 'upload-1',
    });
  });
});
