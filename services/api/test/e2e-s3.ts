import { e2eDb } from './e2e-db';

/** presigned PUT/GET·HEAD 검증은 실 S3(MinIO) 필요. 미가용 시 스위트 skip(녹색 종료) */
export const s3Available = (): boolean => e2eDb().s3Available === true;

/** S3 필요 스위트용: `const d = describeWithS3(); d('...', () => ...)` */
export const describeWithS3 = (): jest.Describe => (s3Available() ? describe : describe.skip);
