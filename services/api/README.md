# services/api — 메인 API 서버

**Node.js + TypeScript + NestJS**. 플랫폼의 중심.

## 역할
- 인증(JWT)·사용자·지사(Station) 관리
- 콘텐츠 CRUD, 업로드 접수, 오브젝트 스토리지 저장, 큐(BullMQ) 등록
- 워크플로우 상태머신 (업로드→처리→분석→승인→송출)
- 다채널 송출 오케스트레이션 (카카오·YouTube·Meta·X·Threads 커넥터)
- WebSocket 게이트웨이: 라이브 채팅·채널별 댓글 집계·프롬프터

## 상태
스캐폴딩 전. Phase 2 예정. (docs/ROADMAP.md)
