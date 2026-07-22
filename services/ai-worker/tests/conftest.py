"""pytest fixture — 오프라인 TestClient(httpx 기반, 네트워크 불요)."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    # 명시적 stub settings — 환경변수 오염 방지
    return TestClient(create_app(Settings(ai_provider="stub")))
