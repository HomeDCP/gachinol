/**
 * 문의하기 페이지의 FAQ 정적 데이터 (T-W1-09 · 06 §F-6 4요소 중 "FAQ").
 *
 * ⚠️ **문안은 정본 미확정이다.** 06 §A 채널 표의 "FAQ 페이지" 행과 §F-4는 "자주 묻는 **20문항**
 * (재생·글자 크기·홈화면 추가·촬영 방법·구매/환불), 어르신 문구 + 그림 안내 / 작성 담당: 기획(PM),
 * 분기 갱신(최초 W1)"까지만 정한다 — **20문항의 실제 문안은 어느 정본 문서에도 없다**(리포 실측:
 * `docs/plan/06-cs-voc.md`에 질문·답변 본문 0건). 따라서 이 파일은 다음 규칙으로만 채운다.
 *
 *   1. **카테고리 5종은 정본 그대로**(위 괄호 안 5개). 늘리지도 줄이지도 않는다 — `FaqCategory`가
 *      타입으로 고정하므로 6번째 카테고리를 지어내면 tsc가 막는다.
 *   2. **항목은 카테고리당 1개, 총 5개의 최소 뼈대**만 둔다. 20문항으로 부풀리지 않는다.
 *   3. 각 항목의 답은 **이 리포에 실제로 구현돼 있거나 정본이 명문화한 사실**만 쓴다. 그 근거를
 *      `sourceNote`에 남겨, 나중에 누가 "어디서 나온 문안이냐"를 되짚을 수 있게 한다.
 *   4. 아직 없는 기능은 **쓰지 않는다**. 예: 03 §A-1의 "큰 자막 모드" 토글은 `packages/ui`에 값
 *      (`typoLarge`·`--gachinol-font-*-large`)만 정의돼 있고 **토글 UI는 미구현**이다(실측:
 *      `grep -rn "typoLarge" apps/subscriber` → 0건). 그래서 "글자 크기" 항목은 앱 안의 토글이
 *      아니라 실제로 동작하는 경로(브라우저·OS 글자 크기 설정 → rem 토큰이 따라감)만 안내한다.
 *
 * PM이 정식 20문항을 확정하면 이 배열을 **교체**하면 된다(화면은 이 데이터를 렌더만 하므로
 * `support.tsx` 수정 불요). 그때 `sourceNote`는 "06 §F-4 확정 문안"으로 바뀐다.
 */

/** 06 §A "FAQ 페이지" 행이 열거한 5개 주제 — 정본 문구 그대로. 확장 금지(정본 개정이 선행). */
export const FAQ_CATEGORIES = [
  'playback',
  'text_size',
  'add_to_home',
  'filming',
  'purchase_refund',
] as const;

export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

/** 화면에 찍히는 카테고리 이름 — 5종 전수 강제(누락 시 tsc 실패) */
export const FAQ_CATEGORY_LABELS: Record<FaqCategory, string> = {
  playback: '영상 보기',
  text_size: '글자 크기',
  add_to_home: '홈 화면에 추가',
  filming: '촬영·제보',
  purchase_refund: '구매·환불',
};

export interface FaqItem {
  /** 안정 식별자 — 문안이 바뀌어도 유지(테스트·계측이 문자열 본문에 매달리지 않게) */
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
  /**
   * 이 문안이 어디서 나왔는지. **정본 확정 문안이 아니라는 사실을 데이터 자체가 들고 다니게 한다.**
   * 화면에는 렌더하지 않는다(시청자에게 내부 문서 번호를 보여줄 이유가 없다).
   */
  sourceNote: string;
}

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: 'playback-not-working',
    category: 'playback',
    question: '영상이 안 나와요. 어떻게 하나요?',
    answer:
      '화면에 [다시 시도] 버튼이 보이면 한 번 눌러 주세요. 그래도 안 나오면 잠시 뒤에 다시 열어 보시고, ' +
      '계속 안 나오면 위 연락처로 알려 주세요.',
    sourceNote:
      '앱 실구현 — src/ui/playback-fallback.tsx의 재생 실패 폴백은 env 설정과 무관하게 "다시 시도"를 항상 렌더한다.',
  },
  {
    id: 'text-size-too-small',
    category: 'text_size',
    question: '글씨가 작아서 잘 안 보여요.',
    answer:
      '휴대폰이나 인터넷 창의 글자 크기 설정을 키우시면 이 화면의 글씨도 같이 커집니다. ' +
      '휴대폰 설정 > 화면(또는 디스플레이) > 글자 크기에서 조절하세요.',
    sourceNote:
      '앱 실구현 — packages/ui/src/tokens.css가 rem 기반이라 브라우저·OS 텍스트 배율을 그대로 따라간다(03 §A-1 WCAG 1.4.4). ' +
      '앱 안의 "큰 자막 모드" 토글은 아직 없으므로 안내하지 않는다.',
  },
  {
    id: 'add-to-home-screen',
    category: 'add_to_home',
    question: '휴대폰 첫 화면에 아이콘을 만들어 두려면 어떻게 하나요?',
    answer:
      "아이폰은 화면 아래 [공유] 버튼을 누르고 '홈 화면에 추가'를, 안드로이드는 화면 오른쪽 위 점 3개 메뉴에서 " +
      "'홈 화면에 추가'를 선택하세요. 카카오톡 안에서 보고 계시면 먼저 다른 인터넷 창으로 열어야 합니다.",
    sourceNote:
      'src/features/home/home-banner.ts의 안내 문구(03 §A-5)와 동일 내용 — 카카오 인앱 웹뷰에서는 공유 시트가 없어 A2HS가 불가하다는 분기 포함.',
  },
  {
    id: 'how-to-contribute-footage',
    category: 'filming',
    question: '우리 마을 소식을 방송에 내보내고 싶어요.',
    answer:
      '촬영과 제보는 그 지역 마을방송국(지사) 담당자가 맡습니다. 위 카카오톡 채널이나 전화로 말씀해 주시면 ' +
      '담당자에게 연결해 드립니다.',
    sourceNote:
      '06 §B 소통창구 라우팅 — 콘텐츠 제보는 카톡 채널이 1선이고, 어느 창구로 들어와도 접수한 쪽이 대장 기록 후 이관한다.',
  },
  {
    id: 'purchase-and-refund',
    category: 'purchase_refund',
    question: '방송에서 소개한 물건은 어디서 사나요? 환불은 어떻게 하나요?',
    answer:
      '주문과 결제는 저희가 직접 받지 않고, 방송에서 안내해 드리는 판매처에서 이뤄집니다. ' +
      '배송과 환불도 그 판매처의 절차를 따르며, 진행이 어려우시면 위 연락처로 알려 주세요. 판매자와 연결해 드립니다.',
    sourceNote:
      '06 §F-4 단서("구매/환불 문항은 Z1 1단계(링크아웃) 기준 절차로 최초 작성") + 05 §A-1 링크아웃 1단계(판매·결제는 외부 플랫폼, 자체 PG 없음).',
  },
];
