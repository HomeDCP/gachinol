"""POST /analyze — 결정성·camelCase 키·부분분석·옵션 게이팅·타임코드 경계."""

from fastapi.testclient import TestClient


def _req(**over: object) -> dict:
    base = {
        "contentId": "0192f000-0000-7000-8000-000000000001",
        "generation": 1,
        "media": {"url": "https://example.test/presigned", "durationSec": 42.0},
        "languageHint": "ko",
    }
    base.update(over)
    return base


def test_analyze_camel_case_keys(client: TestClient) -> None:
    res = client.post("/analyze", json=_req())
    assert res.status_code == 200
    body = res.json()

    # 최상위 camelCase
    assert "recommendationScore" in body
    assert "modelInfo" in body
    assert "vision" in body and "text" in body

    # vision 하위 camelCase (shared VisionAnalysis 키)
    vision = body["vision"]
    assert "thumbnailCandidatesSec" in vision
    assert "safetyFlags" in vision
    shot = vision["shots"][0]
    assert "startSec" in shot and "endSec" in shot

    # text 하위 (shared TextAnalysis / SttSegment 키)
    text = body["text"]
    seg = text["transcript"][0]
    assert "startSec" in seg and "endSec" in seg and "confidence" in seg
    assert set(text) >= {"transcript", "summary", "keywords", "tags", "language"}

    # modelInfo camelCase
    assert set(body["modelInfo"]) <= {"visionModel", "sttModel", "version"}
    assert body["modelInfo"]["visionModel"] == "stub-vision"


def test_analyze_deterministic(client: TestClient) -> None:
    a = client.post("/analyze", json=_req()).json()
    b = client.post("/analyze", json=_req()).json()
    assert a == b


def test_analyze_different_input_differs(client: TestClient) -> None:
    a = client.post("/analyze", json=_req(contentId="aaaa", generation=1)).json()
    b = client.post("/analyze", json=_req(contentId="bbbb", generation=1)).json()
    # 시드가 다르면 라벨/점수가 갈린다(전부 동일할 확률 극히 낮음)
    assert a["recommendationScore"] != b["recommendationScore"] or a["vision"] != b["vision"]


def test_recommendation_score_range(client: TestClient) -> None:
    score = client.post("/analyze", json=_req()).json()["recommendationScore"]
    assert 0.0 <= score < 1.0


def test_shots_within_duration_bounds(client: TestClient) -> None:
    dur = 42.0
    vision = client.post("/analyze", json=_req(media={"durationSec": dur})).json()["vision"]
    assert len(vision["shots"]) >= 1
    for shot in vision["shots"]:
        assert 0.0 <= shot["startSec"] <= shot["endSec"] <= dur + 0.01
    for t in vision["thumbnailCandidatesSec"]:
        assert 0.0 <= t <= dur


def test_options_vision_only(client: TestClient) -> None:
    body = client.post("/analyze", json=_req(options={"vision": True, "text": False})).json()
    assert body["vision"] is not None
    # exclude_none 으로 text 키 자체가 생략된다
    assert "text" not in body


def test_options_text_only(client: TestClient) -> None:
    body = client.post("/analyze", json=_req(options={"vision": False, "text": True})).json()
    assert "vision" not in body
    assert body["text"] is not None


def test_analyze_without_media(client: TestClient) -> None:
    body = client.post(
        "/analyze",
        json={"contentId": "no-media", "generation": 2},
    ).json()
    # media 없어도 유효 응답 — 단일 [0,0] 경계
    assert body["vision"]["shots"] == [
        {"startSec": 0.0, "endSec": 0.0, "label": body["vision"]["shots"][0]["label"]}
    ]
    assert body["text"]["language"] == "ko"


def test_snake_case_request_also_accepted(client: TestClient) -> None:
    # populate_by_name=True → snake_case 입력도 허용(방어적)
    res = client.post(
        "/analyze",
        json={"content_id": "snake", "generation": 1, "media": {"duration_sec": 10.0}},
    )
    assert res.status_code == 200


def test_missing_required_field_422(client: TestClient) -> None:
    res = client.post("/analyze", json={"generation": 1})  # contentId 누락
    assert res.status_code == 422
