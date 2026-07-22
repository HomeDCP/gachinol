"""ai-worker 설정 (pydantic-settings).

ai-worker는 `AI_WORKER_URL`을 **읽지 않는다** — 그건 api가 ai-worker를 찾는 주소다.
ai-worker는 자기 포트(AI_WORKER_PORT)에만 바인딩한다. DB·큐·JWT 관련 env 없음(순수 컴퓨트).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # 분석기 선택: 'stub'(기본, 외부의존 0·결정적) | 'openai'(확장점, 지연 import)
    ai_provider: str = "stub"
    # uvicorn 바인드 포트 (Makefile/Dockerfile과 동기)
    ai_worker_port: int = 8000
    # model_info에 노출할 모델명 힌트 (미설정 시 stub 기본값 사용)
    ai_vision_model: str | None = None
    ai_stt_model: str | None = None
    # 시크릿 — 로그 금지. AI_PROVIDER=openai 확장점에서만 필요. api env.schema엔 미포함.
    openai_api_key: str | None = None
