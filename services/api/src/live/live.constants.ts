/**
 * DI 토큰 — 댓글 수집 어댑터 레지스트리(목 기본 / SNS 키 시 실). Redis pub/sub 커넥션은
 * socket.io 다중 인스턴스 어댑터 전용(afterInit에서 makeConnection 재사용, 별도 토큰 불요).
 */
export const COMMENT_SOURCE_REGISTRY = Symbol('COMMENT_SOURCE_REGISTRY');
