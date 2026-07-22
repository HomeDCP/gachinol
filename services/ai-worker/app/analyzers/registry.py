"""settings.ai_provider → Analyzer 선택 (지연 import).

'stub'(기본)은 외부의존 0. 'openai' 등 실 제공자는 **지연 import**로 인스턴스화 →
openai/httpx 미설치 환경에서도 기본(stub) 경로가 깨지지 않는다.
파이프라인·api 변경 없이 env 스위치만으로 실 모델 승격.
"""

from app.analyzers.base import Analyzer
from app.config import Settings


def select_analyzer(settings: Settings) -> Analyzer:
    provider = (settings.ai_provider or "stub").strip().lower()

    if provider == "stub":
        from app.analyzers.stub import StubAnalyzer

        return StubAnalyzer(
            vision_model=settings.ai_vision_model,
            stt_model=settings.ai_stt_model,
        )

    if provider == "openai":
        from app.analyzers.openai_provider import OpenAiAnalyzer  # 지연 import(확장점)

        return OpenAiAnalyzer(settings)

    raise ValueError(f"알 수 없는 AI_PROVIDER: {provider!r} (지원: 'stub' | 'openai')")
