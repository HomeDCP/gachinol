# services/ai-worker — AI 분석 워커

**Python 3.12 + FastAPI**. 무거운 ML/분석을 메인 API에서 분리한 **순수 HTTP 컴퓨트**.

## 역할

- 화면(비전) 분석: 샷 경계·라벨·썸네일 후보
- 텍스트 분석: STT(음성→텍스트)·요약·키워드/태깅
- 주간 콘텐츠 추천 산정용 `recommendationScore`(0~1) 산출

api가 오케스트레이션한다: transcode 완료 후 api가 `analysis` BullMQ 잡을 넣고, 그 잡의
**api 인프로세스 Node 핸들러가 이 워커의 `POST /analyze`를 호출**한다. 결과를 api가 QueueEvents
완료 패턴으로 받아 **api가 유일 DB 기록자**로서 `ai_analyses`에 기록하고
`analyzing → preview_generating` 전이한다. **ai-worker는 상태·DB를 모른다.**

## 불변식 (반드시 지킴)

- **pnpm/turbo 밖**: 이 디렉토리에 `package.json`을 두지 않는다 → `services/*` 글롭이
  워크스페이스 멤버로 보지 않아 turbo/pnpm이 흡수하지 않는다.
- **DB·큐·JWT·S3 자격 미접근**: psycopg/redis/bullmq/jwt 의존 없음. 순수 컴퓨트.
- **미디어**: api가 넘긴 `media.url`(presigned GET)로만 접근. **기본 스텁은 아예 미접근**(오프라인).
- **결정적·재현**: 스텁은 입력의 순수 함수(`random`/wall-clock/네트워크 미사용).
  `id`·`createdAt`·`completedAt`은 api가 부여 → 응답에 없음.

## 실행

`Makefile`은 루트에서 `make -C services/ai-worker <target>`로 호출한다.

```bash
make -C services/ai-worker install   # .venv 생성 + pip install -e ".[dev]"
make -C services/ai-worker test      # pytest (오프라인 TestClient)
make -C services/ai-worker lint       # ruff check
make -C services/ai-worker fmt        # ruff format
make -C services/ai-worker dev        # uvicorn --reload (기본 :8000)
make -C services/ai-worker run        # uvicorn (0.0.0.0:8000)
```

수동(uv 또는 venv):

```bash
cd services/ai-worker
uv venv && uv pip install -e ".[dev]"           # 또는:
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q
.venv/bin/uvicorn app.main:app --port 8000
```

Docker:

```bash
docker build -t gachinol-ai-worker services/ai-worker
docker run -p 8000:8000 gachinol-ai-worker
```

## HTTP 계약

### `GET /health` → `200`

```json
{ "status": "ok", "provider": "stub" }
```

### `POST /analyze` (`Content-Type: application/json`)

요청 (JSON 키 = **camelCase**):

```json
{
  "contentId": "0192...uuid",
  "generation": 1,
  "media": { "url": "https://...presigned-get", "mimeType": "video/mp4", "durationSec": 42.0 },
  "languageHint": "ko",
  "options": { "vision": true, "text": true }
}
```

- `contentId`(string, 필수)·`generation`(number, 필수)만 필수. 나머지 optional.
- `media`·`media.*` 모두 optional. **스텁은 `media.url` 미접근**(duration 힌트만 사용).
- `options` 미지정 = `vision`·`text` 둘 다 `true`. `false`면 해당 서브객체 생략.

응답 (`200`, camelCase, `null`/미생성 서브객체 생략):

```json
{
  "vision": {
    "shots": [{ "startSec": 0.0, "endSec": 5.25, "label": "인터뷰" }],
    "labels": ["바다", "마을", "축제"],
    "thumbnailCandidatesSec": [4.2, 21.0, 37.8],
    "safetyFlags": []
  },
  "text": {
    "transcript": [{ "startSec": 0.0, "endSec": 5.25, "text": "장면 1", "confidence": 0.9 }],
    "summary": "총 8개 장면, 약 42초 분량의 영상입니다.",
    "keywords": ["바다", "마을", "축제"],
    "tags": ["바다", "마을", "축제"],
    "language": "ko"
  },
  "recommendationScore": 0.734,
  "modelInfo": { "visionModel": "stub-vision", "sttModel": "stub-stt", "version": "0.1.0" }
}
```

- `vision`/`text`는 shared `VisionAnalysis`/`TextAnalysis`와 **키·optionality 1:1**.
- 응답에 `id`·`contentId`·`generation`·`createdAt`·`completedAt` **없음**(api가 부여).
- 검증 실패 → `422`(FastAPI 표준 `{"detail":[...]}`). 분석기 예외 → `500`(api BullMQ 재시도/소진).

## env (`.env` 또는 프로세스 환경)

| 이름              | 기본     | 설명                                           |
| ----------------- | -------- | ---------------------------------------------- |
| `AI_PROVIDER`     | `stub`   | `stub`(기본) \| `openai`(확장점, 지연 import)  |
| `AI_WORKER_PORT`  | `8000`   | uvicorn 바인드 포트                            |
| `AI_VISION_MODEL` | (없음)   | `modelInfo.visionModel` 노출값 힌트            |
| `AI_STT_MODEL`    | (없음)   | `modelInfo.sttModel` 노출값 힌트               |
| `OPENAI_API_KEY`  | (없음)   | 시크릿 — `AI_PROVIDER=openai`일 때만. 로그 금지 |

> `AI_WORKER_URL`은 **api가 이 워커를 찾는 주소** — ai-worker 자신은 읽지 않는다.

## 확장 (실 모델)

`AI_PROVIDER=openai` + `pip install -e ".[real]"` → `app/analyzers/openai_provider.py`
(현재 `NotImplementedError` 스텁)를 구현. **api·파이프라인 변경 없이 env 스위치만으로 승격.**
```
