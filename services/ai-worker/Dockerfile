# ai-worker — Python/FastAPI 순수 컴퓨트(비전+STT). DB·큐·JWT·S3 자격 미접근.
# 빌드 컨텍스트 = services/ai-worker (이 디렉토리):
#   docker build -t gachinol-ai-worker services/ai-worker
FROM python:3.12-slim

# 빌드 스탬프(대장 #186) — "배포된 것이 어느 커밋인가"를 물을 수 있게 한다(워커는 HTTP 미노출이라
# `docker inspect`/`docker exec printenv GIT_SHA`로 조회). 단일 스테이지라 멀티스테이지 전파 함정은
# 없지만 다른 두 Dockerfile과 형태를 맞춘다. 기본값 `unknown`(빈 문자열 금지 — 규율 21).
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

# 컨테이너 로깅 정합(버퍼링 해제)·.pyc 미생성
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    AI_WORKER_PORT=8000

WORKDIR /app

# 의존만 먼저 설치(레이어 캐시) — 목록은 pyproject.toml [project].dependencies와 동일하게 유지할 것.
COPY pyproject.toml ./
RUN pip install --upgrade pip \
 && pip install "fastapi>=0.115" "uvicorn[standard]>=0.32" \
      "pydantic>=2.9" "pydantic-settings>=2.6"

COPY app ./app

RUN useradd -m -u 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
# 헬스체크 = 표준 라이브러리 urllib(추가 의존 0). GET /health 는 app/main.py 제공.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('AI_WORKER_PORT','8000'), timeout=3).status==200 else 1)"

# AI_WORKER_PORT로 바인딩 포트 재정의 가능(기본 8000).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${AI_WORKER_PORT:-8000}"]
