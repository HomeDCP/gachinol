/**
 * 업로드 고착 복구(대장 #224) 409 안내 문구 — 순수 함수.
 *
 * ★ 임계값(30분)을 여기서 재현하지 않는다. 서버 `UploadService.recoverStalledUpload`가
 * `Content.updatedAt`+`UPLOAD_STUCK_MS`로 고착을 직접 판정하고, `uploading`인데 아직 임계
 * 미만이면 409 `details: { elapsedMs, stuckMs }`를 돌려준다(services/api/src/upload/upload.service.ts).
 * 이 함수는 그 두 숫자를 **뺄셈만** 해서 "얼마나 더 기다려야 하는가"를 사람이 읽는 문구로
 * 바꾼다 — 판정 로직 자체를 클라이언트에 복제하면 대장 #211(상수 복제가 서버와 어긋난다)이
 * 재발한다.
 *
 * `details`가 이 형태가 아니면(예: 다른 상태로 이미 넘어간 409 — `details: { status }`만 있음)
 * `null`을 반환해 호출부가 일반 충돌 문구로 폴백하게 한다.
 */
export function formatUploadRecoverWait(details: Record<string, unknown> | undefined): string | null {
  if (!details) return null;
  const { elapsedMs, stuckMs } = details;
  if (typeof elapsedMs !== 'number' || typeof stuckMs !== 'number') return null;
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(stuckMs)) return null;

  const remainingMs = stuckMs - elapsedMs;
  if (remainingMs <= 0) {
    // 서버 응답이 오가는 사이 임계를 넘었을 수 있다 — 곧 복구 가능하다는 뜻이므로 재시도를 권한다.
    return '아직 업로드가 진행 중일 수 있습니다 — 잠시 후 다시 시도해 주세요.';
  }
  const remainingMin = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `아직 업로드가 진행 중일 수 있습니다 — 약 ${remainingMin}분 후 다시 시도해 주세요.`;
}
