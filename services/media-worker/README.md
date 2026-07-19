# services/media-worker — 미디어 처리 워커

**Node + FFmpeg**. 큐(BullMQ)에서 작업을 받아 영상 처리.

## 역할
- 트랜스코딩 (원본 → 배포용 포맷/해상도)
- **자동편집** 오케스트레이션
- **저화질 프리뷰** 생성 (기자 승인용)
- 썸네일·HLS 세그먼트 생성

## 상태
스캐폴딩 전. Phase 4 예정. (docs/ROADMAP.md)
