"""Analyzer 계약 (ABC)."""

from abc import ABC, abstractmethod

from app.models import AnalyzeRequest, AnalyzeResponse


class Analyzer(ABC):
    """비전+텍스트 분석 계약.

    구현은 순수 함수적이어야 한다(부수효과·전역상태 금지). `req.options.vision/text`를
    존중해 해당 서브객체를 채우거나 생략한다(shared가 둘 다 optional — 부분 분석 허용).
    """

    @abstractmethod
    def analyze(self, req: AnalyzeRequest) -> AnalyzeResponse:  # pragma: no cover - 인터페이스
        ...
