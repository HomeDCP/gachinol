"""결정적 스텁 분석기 — 외부의존 0.

시드 = sha256(f"{content_id}:{generation}"). random·wall-clock·네트워크·S3 **미사용**.
동일 입력 ⇒ 동일 출력(CI 재현). 미디어(media.url)는 아예 접근하지 않고 duration_sec 힌트만 쓴다.
(LOCKED 계약: textHints 미포함 — 파생은 content_id/generation/duration_sec/language_hint에서만.)
"""

from hashlib import sha256

from app.analyzers.base import Analyzer
from app.models import (
    AnalyzeOptions,
    AnalyzeRequest,
    AnalyzeResponse,
    ModelInfo,
    Shot,
    SttSegment,
    TextAnalysis,
    VisionAnalysis,
)

# 고정 한국어 어휘 — 시드 인덱싱으로 라벨/키워드 선택
_VOCAB: tuple[str, ...] = (
    "인물",
    "풍경",
    "실내",
    "인터뷰",
    "자막",
    "바다",
    "마을",
    "음식",
    "생산자",
    "축제",
)
_MAX_SHOTS = 12
_STUB_VERSION = "0.1.0"


class _SeedPicker:
    """시드 바이트를 순환 소비하는 결정적 선택기(모듈 random 미사용)."""

    def __init__(self, seed: bytes) -> None:
        self._seed = seed
        self._cursor = 0

    def _next_byte(self) -> int:
        b = self._seed[self._cursor % len(self._seed)]
        self._cursor += 1
        return b

    def index(self, n: int) -> int:
        return self._next_byte() % n if n > 0 else 0

    def distinct(self, k: int) -> list[str]:
        pool = list(_VOCAB)
        out: list[str] = []
        for _ in range(min(k, len(pool))):
            out.append(pool.pop(self.index(len(pool))))
        return out


def _boundaries(dur: float | None) -> list[tuple[float, float]]:
    """duration을 균등 분할한 [start,end] 경계. dur 없으면 단일 [0,0]."""
    if not dur or dur <= 0:
        return [(0.0, 0.0)]
    n = max(1, min(_MAX_SHOTS, round(dur / 5)))
    step = dur / n
    return [(round(i * step, 3), round((i + 1) * step, 3)) for i in range(n)]


class StubAnalyzer(Analyzer):
    """기본 분석기. 순수 결정적."""

    def __init__(self, vision_model: str | None = None, stt_model: str | None = None) -> None:
        self._vision_model = vision_model or "stub-vision"
        self._stt_model = stt_model or "stub-stt"

    def analyze(self, req: AnalyzeRequest) -> AnalyzeResponse:
        seed = sha256(f"{req.content_id}:{req.generation}".encode()).digest()
        picker = _SeedPicker(seed)
        opts = req.options or AnalyzeOptions()
        dur = req.media.duration_sec if req.media else None
        bounds = _boundaries(dur)

        vision = self._vision(picker, dur, bounds) if opts.vision else None
        labels = list(vision.labels) if vision else []
        text = self._text(req, dur, bounds, labels, picker) if opts.text else None

        # 0~1 결정적 추천 점수(picker와 독립 — 옵션 게이팅에 불변)
        score = (int.from_bytes(seed[:4], "big") % 1000) / 1000.0

        return AnalyzeResponse(
            vision=vision,
            text=text,
            recommendation_score=score,
            model_info=ModelInfo(
                vision_model=self._vision_model,
                stt_model=self._stt_model,
                version=_STUB_VERSION,
            ),
        )

    def _vision(
        self,
        picker: _SeedPicker,
        dur: float | None,
        bounds: list[tuple[float, float]],
    ) -> VisionAnalysis:
        shots = [
            Shot(start_sec=s, end_sec=e, label=_VOCAB[picker.index(len(_VOCAB))])
            for (s, e) in bounds
        ]
        if dur and dur > 0:
            thumbs = [round(dur * f, 3) for f in (0.1, 0.5, 0.9)]
        else:
            thumbs = [0.0]
        return VisionAnalysis(
            shots=shots,
            labels=picker.distinct(3),
            thumbnail_candidates_sec=thumbs,
            safety_flags=[],
        )

    def _text(
        self,
        req: AnalyzeRequest,
        dur: float | None,
        bounds: list[tuple[float, float]],
        labels: list[str],
        picker: _SeedPicker,
    ) -> TextAnalysis:
        transcript = [
            SttSegment(start_sec=s, end_sec=e, text=f"장면 {i + 1}", confidence=0.9)
            for i, (s, e) in enumerate(bounds)
        ]
        summary = f"총 {len(bounds)}개 장면, 약 {round(dur or 0)}초 분량의 영상입니다."

        # 키워드: 라벨(비전 활성 시) + 시드 선택 어휘를 순서 보존 중복제거
        keyword_src = labels + picker.distinct(3)
        keywords = list(dict.fromkeys(keyword_src))[:5]
        tags = list(dict.fromkeys(keywords + labels))

        return TextAnalysis(
            transcript=transcript,
            summary=summary,
            keywords=keywords,
            tags=tags,
            language=req.language_hint or "ko",
        )
