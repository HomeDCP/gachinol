FROM python:3.12-slim

WORKDIR /app

# 의존만 먼저 설치(레이어 캐시) — 소스는 뒤에 COPY
COPY pyproject.toml ./
RUN pip install --no-cache-dir "fastapi>=0.115" "uvicorn[standard]>=0.32" \
      "pydantic>=2.9" "pydantic-settings>=2.6"

COPY app ./app

EXPOSE 8000
RUN useradd -m appuser && chown -R appuser /app
USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
