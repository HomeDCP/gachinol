"""pydantic v2 모델 — packages/shared 계약을 정확히 미러.

모든 모델은 `alias_generator=to_camel` + `populate_by_name=True`.
→ 요청은 camelCase(alias)로 파싱(snake도 허용), 응답은 FastAPI가 `by_alias=True`로 직렬화
  → **JSON 키가 shared VisionAnalysis/TextAnalysis/AiAnalysis와 정확히 일치**.

id·createdAt·completedAt은 응답에 없음(api가 부여 → 스텁 결정성 보존).
필드명·optionality를 shared와 1:1로 맞춰 api 매퍼가 그대로 JSONB로 저장·복원할 수 있게 한다.
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ── 응답 하위 타입 (shared/analysis/ai-analysis.ts 미러) ──


class SttSegment(_Camel):
    """shared SttSegment (startSec/endSec/text/confidence?)"""

    start_sec: float
    end_sec: float
    text: str
    confidence: float | None = None


class Shot(_Camel):
    """shared VisionAnalysis.shots[] (startSec/endSec/label?)"""

    start_sec: float
    end_sec: float
    label: str | None = None


class VisionAnalysis(_Camel):
    """shared VisionAnalysis"""

    shots: list[Shot]
    labels: list[str]
    thumbnail_candidates_sec: list[float] | None = None
    safety_flags: list[str] | None = None


class TextAnalysis(_Camel):
    """shared TextAnalysis"""

    transcript: list[SttSegment]
    summary: str
    keywords: list[str]
    tags: list[str]
    language: str | None = None


class ModelInfo(_Camel):
    """shared AiAnalysis.modelInfo"""

    vision_model: str | None = None
    stt_model: str | None = None
    version: str | None = None


# ── 요청 하위 타입 ──


class MediaRef(_Camel):
    """AnalyzeRequest.media — api가 발급한 presigned GET(url) + 프로브 메타. 스텁은 url 미접근."""

    url: str | None = None
    mime_type: str | None = None
    duration_sec: float | None = None


class AnalyzeOptions(_Camel):
    """부분 분석 게이팅 — 미지정 시 둘 다 true."""

    vision: bool = True
    text: bool = True


# ── 최상위 요청/응답 (POST /analyze) ──


class AnalyzeRequest(_Camel):
    """POST /analyze 요청 본문. api가 조립. contentId/generation은 wire 경계라 plain."""

    content_id: str
    generation: int
    media: MediaRef | None = None
    language_hint: str | None = None
    options: AnalyzeOptions | None = None


class AnalyzeResponse(_Camel):
    """/analyze 응답 = AiAnalysis에서 서버소유 필드(id·contentId·generation·시각) 제외.

    vision·text는 shared VisionAnalysis/TextAnalysis 형태 그대로. options로 부분 생략 가능.
    """

    vision: VisionAnalysis | None = None
    text: TextAnalysis | None = None
    recommendation_score: float | None = None
    model_info: ModelInfo | None = None
