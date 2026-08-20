-- 라이브커머스 1단계(링크아웃) 상품 카드 — live_sessions에 JSONB 1컬럼.
--
-- 별도 products 테이블을 만들지 않는다: 정본 05 §A-1이 "가치놀은 상품·주문·결제 데이터를
-- 보관·처리하지 않는다"(거래 비당사자)고 못박았고, 조인·집계 대상이 되는 순간 그 원칙이 깨진다.
-- 세션에 종속된 표시 자산이라 수명도 세션과 같다.
--
-- 기존 product_ids(String[])는 2단계(자체 결제)용 예약 컬럼이며 현재 아무도 채우지 않는다 — 건드리지 않는다.
--
-- 형태: [{"id": "<uuid v7>", "name": "...", "url": "https://...", "imageUrl"?: "...", "priceLabel"?: "25,000원"}]
-- 검증은 애플리케이션 경계(zod + shared isSafeLinkoutUrl)가 담당한다 — 읽기/쓰기 양쪽 모두
-- (계약 밖 값이 들어가면 목록·상세가 영구 500이 되는 비대칭을 주간추천에서 이미 밟았다).
ALTER TABLE "live_sessions"
  ADD COLUMN "product_cards" JSONB NOT NULL DEFAULT '[]';
