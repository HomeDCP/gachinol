# 루트에서: make -C services/ai-worker <target>
# Node 모노레포(pnpm/turbo)와 격리된 별도 런타임(venv). package.json 없음.

PY ?= python3
VENV := .venv
BIN := $(VENV)/bin

.PHONY: venv install dev run test lint fmt clean

venv:
	$(PY) -m venv $(VENV)

install: venv
	$(BIN)/pip install -U pip
	$(BIN)/pip install -e ".[dev]"

dev:
	$(BIN)/uvicorn app.main:app --reload --port $${AI_WORKER_PORT:-8000}

run:
	$(BIN)/uvicorn app.main:app --host 0.0.0.0 --port $${AI_WORKER_PORT:-8000}

test:
	$(BIN)/pytest -q

lint:
	$(BIN)/ruff check .

fmt:
	$(BIN)/ruff format .

clean:
	rm -rf $(VENV) .pytest_cache .ruff_cache **/__pycache__
