"""실 제공자 확장점 (AI_PROVIDER=openai). 본문 미구현 — 인터페이스만.

승격 시 구현 요지(api·파이프라인 무변경):
  1. `req.media.url`(presigned GET)을 httpx로 fetch (의존 설치: pip install -e ".[real]")
  2. Whisper STT → TextAnalysis / 비전 모델 → VisionAnalysis 조립
  3. 동일한 AnalyzeResponse(camelCase alias) 반환 — 스텁과 wire 동형
`OPENAI_API_KEY`는 이 확장점에서만 사용(시크릿 — 로그 금지).
"""

from app.analyzers.base import Analyzer
from app.config import Settings
from app.models import AnalyzeRequest, AnalyzeResponse


class OpenAiAnalyzer(Analyzer):
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def analyze(self, req: AnalyzeRequest) -> AnalyzeResponse:
        # TODO(ai-worker): media.url fetch → Whisper STT + 비전 → AnalyzeResponse 조립
        raise NotImplementedError("AI_PROVIDER=openai 미구현 — 확장점(기본은 AI_PROVIDER=stub)")
