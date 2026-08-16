import { StationKind } from '@gachinol/shared';
import type { CreateStationRequest, Station, UpdateStationRequest } from '@gachinol/shared';
import type { ValidationResult } from '../contents/validation';

/**
 * 지사 생성·수정 폼 검증 — 서버 zod 미러.
 * 원천: `services/api/src/stations/schemas/station.schemas.ts`
 *   code        /^[a-z0-9-]+$/, 1..50 (unique slug)
 *   name        1..100
 *   region      1..100
 *   description ≤2000
 *   thumbnailUrl url, ≤2000
 *   supportTel  trim.min(1).max(30), /^\+?\d[\d-]*\d$/
 *   youtubeUrl  trim.min(1).max(2000), https + youtube.com·youtu.be 계열 호스트
 *   sortOrder   int ≥0
 *   foundedAt   /^\d{4}-\d{2}-\d{2}$/
 * (zod 미도입 — shared는 런타임 의존성 0이라 api 스키마를 import할 수 없다. contents/validation.ts와
 *  동일 규약으로 수치 상수를 출처 주석과 함께 동기화한다.)
 *
 * 서버가 **공백만 있는 값을 거부**하므로(빈 값이 저장되면 앱이 "설정됨"으로 오판해 목적지 없는
 * 전화·유튜브 버튼을 그린다) 선택 항목은 공백이면 **키 자체를 생략**한다 — 빈 문자열을 보내지 않는다.
 */

export const STATION_CODE_MAX_LEN = 50;
export const STATION_NAME_MAX_LEN = 100;
export const STATION_REGION_MAX_LEN = 100;
export const STATION_DESCRIPTION_MAX_LEN = 2000;
export const STATION_URL_MAX_LEN = 2000;
export const STATION_SUPPORT_TEL_MAX_LEN = 30;

const CODE_RE = /^[a-z0-9-]+$/;
const TEL_RE = /^\+?\d[\d-]*\d$/;
/** 서버 host 검사(youtube.com·youtu.be 및 그 서브도메인) + https 강제의 정규식 미러 */
const YOUTUBE_URL_RE = /^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be)(\/|$)/i;
const HTTP_URL_RE = /^https?:\/\/[^\s]+$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 폼 상태는 전부 문자열 — 숫자·선택 항목의 변환·생략을 검증이 책임진다 */
export interface StationFormValues {
  code: string;
  name: string;
  region: string;
  sortOrder: string;
  description: string;
  thumbnailUrl: string;
  supportTel: string;
  youtubeUrl: string;
  foundedAt: string;
}

export const emptyStationForm = (): StationFormValues => ({
  code: '',
  name: '',
  region: '',
  sortOrder: '',
  description: '',
  thumbnailUrl: '',
  supportTel: '',
  youtubeUrl: '',
  foundedAt: '',
});

/**
 * 수정 폼 프리필 — 서버가 준 Station을 폼 문자열로. **미설정 필드는 빈 문자열**이고, 빈 채로 저장하면
 * 키가 생략되어 기존 값이 유지된다(지우기 미지원이라 "비웠으니 지워지겠지"가 성립하지 않는다).
 */
export const stationToFormValues = (station: Station): StationFormValues => ({
  code: station.code,
  name: station.name,
  region: station.region,
  sortOrder: String(station.sortOrder),
  description: station.description ?? '',
  thumbnailUrl: station.thumbnailUrl ?? '',
  supportTel: station.supportTel ?? '',
  youtubeUrl: station.youtubeUrl ?? '',
  foundedAt: station.foundedAt ?? '',
});

/** 'YYYY-MM-DD'가 형식뿐 아니라 **실존 날짜**인지 (2026-02-31 같은 값이 서버로 새지 않게) */
function isRealDate(value: string): boolean {
  const matched = DATE_ONLY_RE.exec(value);
  if (!matched) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** 선택 항목 공통 — 공백이면 undefined(키 생략), 값이 있으면 규칙 검사 */
function optionalField(
  raw: string,
  key: string,
  errors: Record<string, string>,
  check: (v: string) => string | undefined,
): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const message = check(trimmed);
  if (message) {
    errors[key] = message;
    return undefined;
  }
  return trimmed;
}

interface OptionalParts {
  description?: string;
  thumbnailUrl?: string;
  supportTel?: string;
  youtubeUrl?: string;
  foundedAt?: string;
}

function collectOptional(values: StationFormValues, errors: Record<string, string>): OptionalParts {
  const parts: OptionalParts = {};
  const description = optionalField(values.description, 'description', errors, (v) =>
    v.length > STATION_DESCRIPTION_MAX_LEN ? '소개는 2000자 이내로 입력해 주세요' : undefined,
  );
  if (description !== undefined) parts.description = description;

  const thumbnailUrl = optionalField(values.thumbnailUrl, 'thumbnailUrl', errors, (v) => {
    if (v.length > STATION_URL_MAX_LEN) return '이미지 주소가 너무 깁니다';
    return HTTP_URL_RE.test(v) ? undefined : 'http(s)로 시작하는 주소여야 합니다';
  });
  if (thumbnailUrl !== undefined) parts.thumbnailUrl = thumbnailUrl;

  const supportTel = optionalField(values.supportTel, 'supportTel', errors, (v) => {
    if (v.length > STATION_SUPPORT_TEL_MAX_LEN) return '대표번호가 너무 깁니다';
    return TEL_RE.test(v) ? undefined : '숫자와 하이픈만 입력해 주세요 (예: 064-000-0000)';
  });
  if (supportTel !== undefined) parts.supportTel = supportTel;

  const youtubeUrl = optionalField(values.youtubeUrl, 'youtubeUrl', errors, (v) => {
    if (v.length > STATION_URL_MAX_LEN) return '유튜브 주소가 너무 깁니다';
    return YOUTUBE_URL_RE.test(v)
      ? undefined
      : 'https 유튜브 주소여야 합니다 (youtube.com·youtu.be)';
  });
  if (youtubeUrl !== undefined) parts.youtubeUrl = youtubeUrl;

  const foundedAt = optionalField(values.foundedAt, 'foundedAt', errors, (v) =>
    isRealDate(v) ? undefined : '설립일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다',
  );
  if (foundedAt !== undefined) parts.foundedAt = foundedAt;

  return parts;
}

function validateName(raw: string, errors: Record<string, string>): string {
  const name = raw.trim();
  if (!name) errors.name = '지사 이름을 입력해 주세요';
  else if (name.length > STATION_NAME_MAX_LEN) errors.name = '지사 이름은 100자 이내여야 합니다';
  return name;
}

function validateRegion(raw: string, errors: Record<string, string>): string {
  const region = raw.trim();
  if (!region) errors.region = '행정구역을 입력해 주세요 (예: 제주시 애월읍)';
  else if (region.length > STATION_REGION_MAX_LEN) errors.region = '행정구역은 100자 이내여야 합니다';
  return region;
}

/** 정렬 순서 — 폼 문자열이 **음수·소수·문자**면 서버 400이 아니라 여기서 잡는다 */
function validateSortOrder(raw: string, errors: Record<string, string>): number {
  const trimmed = raw.trim();
  if (!trimmed) {
    errors.sortOrder = '정렬 순서를 입력해 주세요 (0 이상 정수)';
    return 0;
  }
  if (!/^\d+$/.test(trimmed)) {
    errors.sortOrder = '정렬 순서는 0 이상 정수여야 합니다';
    return 0;
  }
  return Number(trimmed);
}

/**
 * 생성 — `kind`는 **'branch' 고정**이다. 센터(kind='center')는 DB partial unique index로 정확히
 * 1행만 존재할 수 있어 이 화면에서 두 번째 센터를 만들 수 있게 하면 반드시 실패한다.
 * `status`는 바디에 없다(서버가 planned로 시작) — 운영 시작은 전이 경로 전용.
 */
export function validateCreateStation(
  values: StationFormValues,
): ValidationResult<CreateStationRequest> {
  const errors: Record<string, string> = {};

  const code = values.code.trim().toLowerCase();
  if (!code) errors.code = '지사 코드를 입력해 주세요 (예: aewol)';
  else if (code.length > STATION_CODE_MAX_LEN) errors.code = '지사 코드는 50자 이내여야 합니다';
  else if (!CODE_RE.test(code)) errors.code = '소문자·숫자·하이픈만 사용할 수 있습니다';

  const name = validateName(values.name, errors);
  const region = validateRegion(values.region, errors);
  const sortOrder = validateSortOrder(values.sortOrder, errors);
  const optional = collectOptional(values, errors);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { code, name, kind: StationKind.Branch, region, sortOrder, ...optional },
  };
}

/**
 * 수정 — 계약상 `code`·`kind`·`status`는 대상이 아니다.
 * 선택 항목을 비우면 키가 생략되어 **기존 값이 유지**된다(서버는 null로 지우기를 지원하지 않는다).
 */
export function validateUpdateStation(
  values: StationFormValues,
): ValidationResult<UpdateStationRequest> {
  const errors: Record<string, string> = {};

  const name = validateName(values.name, errors);
  const region = validateRegion(values.region, errors);
  const sortOrder = validateSortOrder(values.sortOrder, errors);
  const optional = collectOptional(values, errors);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, region, sortOrder, ...optional } };
}
