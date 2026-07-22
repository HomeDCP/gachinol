"""FastAPI 앱 — GET /health, POST /analyze. 순수 컴퓨트(DB·큐·JWT·S3 자격 미접근)."""

from fastapi import FastAPI, Request

from app.analyzers.registry import select_analyzer
from app.config import Settings
from app.models import AnalyzeRequest, AnalyzeResponse


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="gachinol ai-worker", version="0.1.0")
    app.state.settings = settings
    # 분석기는 앱 생성 시 1회 선택(요청마다 재생성 불필요 — 순수·무상태)
    app.state.analyzer = select_analyzer(settings)

    @app.get("/health")
    def health() -> dict[str, str]:
        # 순수 컴퓨트라 프로세스 생존이 곧 준비 — 외부 의존 미점검
        return {"status": "ok", "provider": settings.ai_provider}

    @app.post(
        "/analyze",
        response_model=AnalyzeResponse,
        response_model_exclude_none=True,  # None 필드·미생성 서브객체 생략(부분 분석)
    )
    def analyze(req: AnalyzeRequest, request: Request) -> AnalyzeResponse:
        # 예외는 500 → 호출측(api 인프로세스 Worker)의 BullMQ가 재시도/소진 처리
        return request.app.state.analyzer.analyze(req)

    return app


app = create_app()
