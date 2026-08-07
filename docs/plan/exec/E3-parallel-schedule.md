# E3. 병렬 스케줄 — 의존 그래프·웨이브 편성

> 근거: [EXEC-PLAN.md](EXEC-PLAN.md) G1~G9, [reviews/EXEC-RUBRIC.md](reviews/EXEC-RUBRIC.md) 영역 4,
> [08-rollout-transition.md](../08-rollout-transition.md) §A(선행조건·시간축 매핑 소비). **범위**: 본 문서는
> "언제·어떤 순서로·몇 개씩 동시에"만 정의한다 — 태스크 목록·크기·산출물·DoD는 [E2](E2-work-breakdown.md)를
> 재정의하지 않고 그대로 소비한다(신규 범위 발명 금지). 절대 시간(며칠·몇 주)은 다루지 않는다 — 08§A 자체가
> "기간 산정은 실행계획으로 이월하되 순서는 확정한다"고 선언했고, 절대 토큰·시간 예산은 [E4](E4-token-budget.md)
> 소유다. 본 문서는 **선후 관계·동시성 상한·파일 소유권 배타**만 소유한다.
>
> **라운드 1 수정**: [reviews/EXEC-EVAL-ROUND-1.md](reviews/EXEC-EVAL-ROUND-1.md) 영역 4 감점 전건 +
> [reviews/EXEC-ROUND-1-DECISIONS.md](reviews/EXEC-ROUND-1-DECISIONS.md) D1·D2·D3·D4·D6·D7·D8 반영. 웨이브
> 1~19(舊 1~17에서 재편성 — D3 "구현 ≤4+검증 슬롯 1"·D4 `app.module.ts` 충돌 해소·D6 태스크 분할을 동시 반영한
> 결과) 전체를 재번호했다. DECISIONS 확정 문안은 재해석 없이 인용만 한다.
>
> **라운드 2 수정**: [reviews/EXEC-EVAL-ROUND-2.md](reviews/EXEC-EVAL-ROUND-2.md) 영역 4 감점 1~4 +
> [reviews/EXEC-ROUND-2-DECISIONS.md](reviews/EXEC-ROUND-2-DECISIONS.md) DD1(T-W1-07 분할 반영)·DD5(17모듈·
> T-NC 15건) 반영. Wave 12에 T-W1-07a 삽입(舊 19웨이브 개수는 불변 — 신규 웨이브 추가가 아니라 기존 여유
> 슬롯에 편입).
>
> **라운드 3 수정**: [reviews/EXEC-EVAL-ROUND-3.md](reviews/EXEC-EVAL-ROUND-3.md) 영역 3·4 감점 전건 +
> [reviews/EXEC-ROUND-3-DECISIONS.md](reviews/EXEC-ROUND-3-DECISIONS.md) DDD1(사이징 43건 전건 재판정)·DDD2
> (T-NC-14 경로=`broadcast-url-procedure/`)·DDD3(W1 종료=Wave 12 통일) 반영. 舊 라운드 1·2가 지적 1건만 고치고
> 동종 전건을 재판정하지 않았던 패턴(Wave 2 사이징만 수정)을 이번 라운드에서 43건 전건으로 확장 해소했다.
>
> **라운드 4 수정**: [reviews/EXEC-EVAL-ROUND-4.md](reviews/EXEC-EVAL-ROUND-4.md) 영역 1·3·4 감점 +
> [reviews/EXEC-ROUND-4-DECISIONS.md](reviews/EXEC-ROUND-4-DECISIONS.md) D4-3(W3 선행조건 = W1+T-NC-08 정본
> 준수)·D4-4(패널 R1 기점 = Wave 5)·D4-5(02§E-10 순서 선언 반영 — Wave 17→17a/17b 순차 재편) 반영. **웨이브
> 라벨 19→20**(17a·17b 분리, 태스크 배정 43건은 불변). V-11(사이징 파일 수 미확정 2건) 정정 동반.
>
> **라운드 6 수정**: [reviews/EXEC-EVAL-ROUND-6.md](reviews/EXEC-EVAL-ROUND-6.md) 이슈 W-1·W-2·W-3·W-7·W-8 +
> [reviews/EXEC-ROUND-6-DECISIONS.md](reviews/EXEC-ROUND-6-DECISIONS.md) D6-1(`pnpm-lock.yaml` 준-공용 자산·
> Wave 8→8a/8b 재배치)·D6-2/EXEC-DECISIONS #6(T-W2-09 nginx 폴백 동반)·D6-3(08§A 시간축 W축 결박 4활동 →
> T-NC-16~19 신설, 15→19건)·D6-5(T-W1-07a/07b 사이징은 이미 정합, E2측 파일 열거만 보정) 반영. **웨이브 라벨
> 20→21**(8a·8b 분리, 태스크 배정 43건은 불변). 기타확정 W-2(앵커4 "제외"→"§D 편입" 정정) 동반.
>
> **라운드 7 수정**: [reviews/EXEC-EVAL-ROUND-7.md](reviews/EXEC-EVAL-ROUND-7.md) 이슈 Q-6·Q-7·Q-8·Q-9·Q-12·
> Q-16 + [reviews/EXEC-ROUND-7-DECISIONS.md](reviews/EXEC-ROUND-7-DECISIONS.md) D7-2(T-W2-07 Playwright
> 의존성 소유 확정, 유예 해제)·D7-3(의존성 추가 태스크 열거 5종=T-W0-05 편입, +T-W2-07로 6종) 반영. **Wave 15
> 판정: D6-1 웨이브당 1건 규칙 위반 없음(T-W2-07 단독 웨이브)** — 재배치 불요, 사이징만 M(5파일)→L(7파일)
> 상향(E4 재계산 후행). 웨이브 라벨 수·태스크 배정 43건 불변(재편 없음).
>
> **라운드 8 수정**: [reviews/EXEC-EVAL-ROUND-8.md](reviews/EXEC-EVAL-ROUND-8.md) 이슈 R-1·R-2·R-3·R-6·R-7·
> R-8·R-9·R-14 + [reviews/EXEC-ROUND-8-DECISIONS.md](reviews/EXEC-ROUND-8-DECISIONS.md) D8-1/EXEC-DECISIONS
> #7(`T-W2-17` [SOLO] 신설 — 02§E-9 "CI 자동 실행" 요소 결박, Wave 15→15a/15b 분리)·D8-2/EXEC-DECISIONS
> #8(§F ③ 근거를 #8 인용으로 교체)·D8-4(준-공용 자산 3 — `nginx.conf` 신설 등재 + 게이트③ 루트 회귀에
> lockfile 편입)·D8-5(T-TRIG 3행에 §B 준-공용 3종 판정 선행 1구) 반영. **웨이브 라벨 21→22**(15a·15b 분리,
> 태스크 배정 43→44건 — T-W2-17 신설). SOLO 7→8건.
>
> **라운드 9 수정**: [reviews/EXEC-EVAL-ROUND-9.md](reviews/EXEC-EVAL-ROUND-9.md) 이슈 S-1·S-2·S-3·S-13·S-14 +
> [reviews/EXEC-ROUND-9-DECISIONS.md](reviews/EXEC-ROUND-9-DECISIONS.md) 배분(B팀) 반영. **§C 내장 재검산
> 블록이 stale(43/21)이던 것을 지금 재실행한 출력(44/44/22)으로 전면 재작성 — §G와 단일 총계 확보**(舊 블록은
> D8-1의 T-W2-17 신설·15a/15b 분리가 미반영돼 있었다). §H 리스크1 열거에 Wave 2 편입(구현 4건 웨이브 5개로
> 정정) + 폐지 라벨 "Wave 8" 현재형 잔존 2곳(§H 리스크3·§E 5조 예시)을 현행 라벨로 치환. **웨이브 구조 변경
> 없음**(라벨·태스크 배정 수 불변, 표기 정정만).
>
> **라운드 14 수정**: [reviews/EXEC-EVAL-ROUND-14.md](reviews/EXEC-EVAL-ROUND-14.md) 이슈 J-2·J-6·J-7·J-11·
> J-13·J-14 + [reviews/EXEC-ROUND-14-DECISIONS.md](reviews/EXEC-ROUND-14-DECISIONS.md) D14-1(02§B 9파일
> 커버리지 판정 — 6건 기존 태스크 귀속·1건 신규 태스크 T-W2-18 신설)·D14-4(J-2 T-W1-07a 소유 `watch/[id].tsx`
> 정정·J-13 T-W2-08에 shared `ContentOrigin` 편입·J-14 Wave 18 배타 근거를 `--exclude-dir=exec`로 교체) 반영.
> **Wave 12에 T-W2-18 삽입(기존 여유 슬롯 편입 — 신규 웨이브 라벨 불요, 웨이브 라벨 22 불변), 태스크 배정
> 44→45건**(T-W2-18 신설). Wave 1(T-W0-05)·8a(T-W1-03)·9(T-W2-03)·6(T-W2-08) 사이징 동반 상향(T-W0-05
> M→L, T-W1-03 M→L, T-W2-03·T-W2-08은 버킷 불변).
>
> **라운드 15 수정**: [reviews/EXEC-EVAL-ROUND-15.md](reviews/EXEC-EVAL-ROUND-15.md) 이슈 H-1·H-5·H-8·H-9·
> H-11 + [reviews/EXEC-ROUND-15-DECISIONS.md](reviews/EXEC-ROUND-15-DECISIONS.md) D15-1("구현 4건 웨이브"
> 3문서 불변식 5개→6개 — D14-1의 T-W2-18 Wave 12 편입이 §H 리스크1에 전파되지 않은 stale 정정, §C 재검산
> 블록과의 자기모순 해소)·D15-2(`live/[id].tsx` 준-공용 자산 5종째 등재 — 3태스크 T-W1-03·T-W2-11·T-W1-07a
> 편집, 웨이브 전부 달라 동시 편집 없음) 반영. **웨이브 재편·신규 태스크 0**(태스크 배정 45건·웨이브 라벨
> 22 불변 — 이번 라운드는 순수 표기·인용 정합 정정). H-8 전수 대사 중 eval 인용 2건(T-W1-04·T-W2-07) 외
> 3번째 축약(T-W1-11a)을 추가 발견해 동형 정정.
>
> **라운드 16 수정**: [reviews/EXEC-EVAL-ROUND-16.md](reviews/EXEC-EVAL-ROUND-16.md) 이슈 G-1·G-7·G-9 +
> E3 §E 6조(G-3/D16-1 연동부) + [reviews/EXEC-ROUND-16-DECISIONS.md](reviews/EXEC-ROUND-16-DECISIONS.md)
> D16-3(02§B 신규 파일 25건 전건 대사로 D14-1 판정 범위 확장 — 나머지 16건 전건 ①기존귀속, 신규 태스크·
> 명시제외 0건. 즉시 확정 1건: 링크아웃 클릭 계측 클라이언트 이벤트를 T-W2-11 편입, 2→3파일 버킷 S 불변)·
> D15-2 인용 확장(E3 §I는 5종 전건 기보유, 이번 라운드는 E2 §G·§H 쪽의 4/5·2/5 배치 비대칭만 정정) 반영.
> E3 §E에 6조 신설(머지 완료 후 회귀 발견 시 같은 워크스페이스 태스크의 게이트③ 보류 + 이월 카운트 산입).
> **웨이브 재편·신규 태스크 0**(태스크 배정 45건·웨이브 라벨 22 불변 — Wave 10 T-W2-11 파일 수만 2→3, 버킷
> 불변이라 E4 재계산 불요).
>
> **라운드 17 수정**: [reviews/EXEC-EVAL-ROUND-17.md](reviews/EXEC-EVAL-ROUND-17.md) 이슈 F-1·F-2·F-3·F-9·F-10·
> **F-11(최고)** + [reviews/EXEC-ROUND-17-DECISIONS.md](reviews/EXEC-ROUND-17-DECISIONS.md) **D17-1**(E3 §A에
> `T-W1-07a ─ T-W1-11a` 엣지 신설 — 구독자 E2E 시나리오 4단계 "자막토글"의 구현 태스크(T-W1-07a, Wave 12)가
> 시나리오 태스크(T-W1-11a, 舊 Wave 10)보다 뒤 웨이브였던 순서 역전 정정. **T-W1-11a를 Wave 10→13a로,
> T-W1-11b(SOLO)를 舊 Wave 11→13b로 연쇄 재배치**(舊 Wave 13이 13a/13b로 분리, 舊 Wave 11 라벨 폐지) 반영.
> **웨이브 라벨 총수 22 불변**(11 폐지 + 13→13a/13b 분리로 상쇄), **태스크 배정 45건 불변**(순수 재배치,
> 신설·삭제 아님). **부수 효과(A팀 E4 재계산 입력 — 필보고)**: Wave 10이 4건→3건으로 줄어 "구현 정확히 4건인
> 웨이브" 집합이 **6개(Wave 2·4·5·9·10·12)→5개(Wave 2·4·5·9·12)로 변경** — E4 §A-7·E5 §F 리스크1·앵커⑮
> 동반 갱신 필요(§H 리스크1 행에 반영 완료, E4·E5 쪽은 A·C팀 후행). Wave 12의 "W1 종료 웨이브" 서술은
> "T-W1-07a가 W1 마지막 미배정 태스크" 근거가 무효화돼 "앵커2(W1 DoD) 판정 시점"으로만 정정(08§A 원문
> DoD①②는 T-NC-05·06 소유, T-W1-11a·11b와 무관 — Wave 8a 종료 후 이미 성립하던 게이트라 판정 시점 자체는
> 불변). §G·§I·E2 T-W1-11a 행 동반 정정.
>
> **라운드 18 수정**: [reviews/EXEC-EVAL-ROUND-18.md](reviews/EXEC-EVAL-ROUND-18.md) 이슈 **V2-1**(앵커⑥
> 불성립)·**V2-2**(앵커⑨ 불성립, D6-4·D15-3 실패 유형 3회차)·V2-7 반영(전부 D17 전파 잔여, 신규 설계 0).
> **V2-1**: §C Wave 16 선행 열의 "Wave 12(W1 종료)"를 "Wave 13b(W1 코드 종료) + 앵커2(W1 DoD 판정 기점)는
> Wave 12"로 이원화(Wave 12 셀 자신의 라운드17 격하 선언과 정합, E2 §C W3 선행 문단에 동일 문안 이식).
> **V2-2**: §C "정상 웨이브 코드 태스크 합계" 블록이 `grep -c "10(4)+11(1)+13(2)" → 0`을 주장했으나 본문
> 회고 인용 자체가 그 문자열을 재생산해 재실행 결과는 3이었다(자기 매칭) — **舊 문자열을 본문에서 전면
> 제거**(단어 서술로 대체)해 재발 근원을 구조적으로 없애고, 검증 방식도 D15-3의 **존재 재현**(`10(3)+13a(3)+13b(1)`
> ≥1)으로 전환. **V2-7**: §F ①·③행의 웨이브 라벨 종점 표기("Wave 1~15 전건"·"Wave 1~10까지")를 **경계
> 태스크 기준**(①="T-NC-01 실측 제외 전 웨이브", ③="T-W2-15 착수 직전까지")으로 교체 — 향후 웨이브 재편에도
> stale되지 않는 형식. **웨이브 재편·신규 태스크 0**(태스크 배정 45건·웨이브 라벨 22 완전 불변 — 이번
> 라운드는 순수 표기·검증형식 정정).
>
> **라운드 19 수정**: [reviews/EXEC-EVAL-ROUND-19.md](reviews/EXEC-EVAL-ROUND-19.md) 이슈 **R2-3**(확정 —
> T-NC-20 신설)·R2-4·R2-5·R2-10(동반부) 반영. **R2-3**: T-W2-15 산출물 "CF Stream 실계정 개설"(사용자
> 재무/행정 결정, 서브에이전트 비완결 행위)을 분리해 **T-NC-20 신설**(담당=사용자/법무·운영 지원 절차
> 지원, T-NC-08·09 선례 동형, 게이트=Wave 10(T-W2-15) 착수 전+G9③ 확인 후) — §D 체크포인트 표 +1행,
> **코드 외 19→20건, 총계 67→68건**(코드 45건·웨이브 라벨 22 불변 — T-NC는 웨이브 비배정 체크포인트라
> 편성 영향 없음). **R2-4**: §E 5조 "5개 중"(D3 이전 舊 상한 잔재)을 "구현 최대 4건 중"으로 정정. **R2-5**:
> §B에 준-공용 자산 승격 문턱 신설(2태스크 공유+엣지 존재+배치 분리 시 유예 판정 기록) — `watch/[id].tsx`·
> `classify.tsx` 2건의 유예 판정 명시. **R2-10(동반)**: §A 시간축 문단의 "DD3 'W1 종료 웨이브=Wave 12'"
> 인용을 "DD3 'W1 DoD 판정 기점=Wave 12'"로 정정해 라운드18 V2-1의 W1 이원 선언과 문언 정합.
>
> **라운드 20 수정**: [reviews/EXEC-EVAL-ROUND-20.md](reviews/EXEC-EVAL-ROUND-20.md) 이슈 **Z2-1(최중대)**+
> Z2-11(근본 원인)·Z2-6·Z2-8·Z2-9·Z2-10·Z2-12 반영. **Z2-1/Z2-11**: 라운드19 승격 문턱이 리포 실측과
> 어긋나 있었음을 정정 — 근본 원인(Z2-11, E2 §C T-W1-02·T-W2-05·T-W2-06의 "디렉터리+개수" 표기)을 E2측에서
> 공유 파일 명시 열거로 해소한 뒤, 그 입력으로 §B 재판정: 준-공용 자산 5(`live/[id].tsx`) 3건→**4건**
> (T-W1-02 편입), `watch/[id].tsx`·`classify.tsx`(舊 "유예 2건")를 실측 3태스크로 정정해 **준-공용 자산
> 6·7로 정식 등재**, 무판정 잔존 6건 전건에 유예 판정 기록, §A에 엣지 2쌍(`T-W1-07b ─ T-W2-05`·
> `T-W2-18 ─ T-W2-05`) 신설, §I 체크리스트·E2 §G 리스크 표·§D T-TRIG 준-공용 종수(5→7) 동반 갱신. **현 편성
> 동일 웨이브 충돌 0건 재확인**(안전 결론 불변, 하드가드 입력만 정정). **Z2-6**: §C Wave 10 선행 열에
> T-NC-20 게이트 병기(Wave 16 T-NC-08 표기와 동형). **Z2-8**: E2 §H 각주 XL 3건 정당화 정정. **Z2-9**:
> §D T-TRIG-03 행에 02§E-11 후단 상시 의무 비범위 판정(DDD7 선례 준용). **Z2-10**: E2 §0에 02§B api
> 신규 20파일 전건 대사표 신설(전건 ①기존귀속, 무기록 0건). **Z2-12**: §G 라벨 `T-NC-01~20`으로 정정.
> **웨이브 재편·재계산 0**(태스크 배정 45건·웨이브 라벨 22·코드외 20건 전부 불변 — 이번 라운드는 순수
> 등재·판정·표기 정정).
>
> **라운드 21 수정**: [reviews/EXEC-EVAL-ROUND-21.md](reviews/EXEC-EVAL-ROUND-21.md) 이슈 **Y2-1(최중대,
> 확정: T-W1-11b 확장)**·Y2-6·Y2-8·Y2-9 반영(전부 E2 소유, 본 파일은 T-W1-11b Wave 13b 셀 1곳만 동반
> 갱신). **Y2-1**: 02§C Lighthouse CI 게이트(구독자 앱 한정, Performance≥80·Accessibility≥95, 병합 차단)를
> T-W1-11b 산출물에 편입 — CI 게이트 **3종→4종**, `lhci` CLI 플래그로 `ci.yml`에 인라인 지정해 **파일 수·
> 사이징(S, 1파일) 불변**(별도 config 파일이 실제로 필요해지면 그 시점 사이징 재판정 필보고). **Y2-6**:
> E2 §0에 03·07 자체 소유 항목 비범위 선언 신설(04·06과 동형). **Y2-8**: E2 T-W1-09·T-W1-10의 D12-1 판정
> 근거에서 실체 없는 "앱 내부 진입 링크" 서술 제거(판정 결론·편성 불변). **Y2-9**: E2 §A에 대량 소비 전환
> 3태스크 재실측 예고 1구 신설. **웨이브 재편·재계산 0**(태스크 배정 45건·웨이브 라벨 22 완전 불변).
>
> **라운드 22 수정**: [reviews/EXEC-EVAL-ROUND-22.md](reviews/EXEC-EVAL-ROUND-22.md)(1차) X2-1·X2-2·X2-4 +
> [reviews/EXEC-EVAL-ROUND-22B.md](reviews/EXEC-EVAL-ROUND-22B.md)(2차 — 이중 기동 사건으로 평가서 2부, X2 번호는 1차와 별개) X2-1·X2-2·X2-5 +
> [reviews/EXEC-ROUND-22-DECISIONS.md](reviews/EXEC-ROUND-22-DECISIONS.md) D22-1·D22-2·D22-8 반영.
> **D22-1**: 02§B가 "신규 워크플로"로 명시 계상한 `deploy-web.yml`(舊 exec 전 문서 0건 무기록)을 신규 태스크
> **T-W1-11c [SOLO]**(인프라 담당, S 1파일)로 편입 — **신규 SOLO Wave 8c 삽입**(선행 T-W0-03=Wave 2·
> T-W1-03=Wave 8a 직후, 기존 라벨 재번호 0(접미 문자 라벨)·앵커 ⑮ 집합 {2·4·5·9·12} 불변·**"W1 코드 종료
> (Wave 13b)" 이원 선언 불변**(8c<13b라 동기 갱신 조건 미발동)). **웨이브 라벨 22→23·태스크 배정 45→46·
> SOLO 8→9·총 68→69** — §B SOLO 표 9행·§C·§G 재검산·§I 체크리스트 동반 갱신(재검산 정규식 `[ab]?`→`[abc]?`
> — 라벨 8c·ID 11c 매칭, E5 앵커 측 갱신은 E2 신규 위임 #7 제출). **D22-2**: CF 캐시 퍼지 CI 스텝 소유를
> T-W1-11b(`ci.yml`)→T-W1-11c(`deploy-web.yml`)로 이관 — Wave 13b 셀 "4종"→3종·§A 엣지 근거 동기.
> **D22-8(22B 편입)**: ① installability FAIL의 02§C 조치("TWA/iOS 쉘 패키징 착수 자동 차단·재검사까지 W3
> 일정 보류")를 **Wave 17a·17b 선행 열에 결박**(22B X2-1 — 舊 exec 0건) ② §B 승격 문턱 판정 입력에
> **glob(`dir/*`) 축 추가** + `services/api/src/telemetry/*`(엣지 `T-W1-08 ─ T-W2-12` 신설)·
> `services/api/src/live/*` 2쌍 유예 판정(유예 6→8건, 22B X2-2) ③ §F 2곳의 "CF Stream 실계정 개설=T-W2-15"를
> **T-NC-20**으로 정정(22B X2-5 — R2-3 정합 복원, 앵커 ⑭ 성립 유지).

## A. 의존 그래프 — 08§A 선행조건·시간축 매핑 소비

**W-단계 간 선후 관계(08§A "전환 단계" 표 그대로 인용)**:

- W1 선행조건: "W0 + `packages/ui` 디자인 토큰 승격 완료 ... + `<input capture>` 대용량 업로드 실기기 PoC 완료"
- W2 선행조건: **"W0 (W1과 병렬 가능)"** — 08§A "병렬성" 절 "W1과 W2는 서로 독립(구독자=무인증, 기자·관제=인증
  스택 공유). W2 내부에서 기자·관제도 병렬 가능(인증 어댑터를 공용 패키지로 먼저 추출)"을 그대로 반영해, 아래
  §C 웨이브 편성은 W1·W2 태스크를 **분리된 두 순차 블록이 아니라 상호 의존이 없는 것부터 같은 웨이브군에 교차
  배치**한다(단, `packages/ui` 스키마(T-W1-01)에 의존하는 W2 토큰 소비 태스크(T-W2-05·06)는 예외 — 아래 그래프 참조)
- W3 선행조건: "W1(구독자 웹 안정) + 스토어 개발자 계정 개설 완료(... W3 착수 8주 전 개시)"
- W4 선행조건: "W1~W3"

**W0 DoD의 범위 한정(웨이브 효율화 근거)**: 08§A W0 행의 DoD는 **"`https://api.<도메인>/health` 외부 도달 + 웹
오리진에서 로그인 왕복"**뿐이다 — 08§E-3(백업 파이프라인)·3-2(보안 모니터링)는 §E 실행체크리스트의 W0-시한
항목이지만 이 DoD 문장에는 포함되지 않는다. 또한 08§D 리스크 테이블 "방화벽/터널 승인 지연" 행이 "승인 전에는
로컬 LAN에서 W1 기술 검증 선행"을 완화책으로 명시한다 — 즉 **로컬/코드 준비 작업은 G9 사용자 확인(도메인·제온
노출방식·운전자금) 이전에도 진행 가능**하고, 그 확인이 막는 것은 **실제 대외 노출**(프로덕션 도메인 적용·방화벽
개방 실행·`T-NC-01` 외부 접속 실측)이다. 이 두 근거로 아래 §C는 T-W0-04(백업)·T-W0-06(보안 모니터링)을 W0 DoD의
엄격한 선행 경로 밖에 두고 웨이브 효율에 활용한다.

**세부 태스크 간 의존(E2 파일 소유권 대조로 도출, G3 파일 배타 원칙의 실행 형태 — D4·D6 반영 갱신)**:

```
T-W0-05[SOLO] ─┬─ T-W1-03(export 요구) ─ T-W1-11a ─ T-W1-11b[SOLO]
               └─ T-W1-02(export 검증 요구)
T-W0-03 ─ T-W1-06(같은 nginx.conf, 순서 의존)
T-W0-04 ─ T-W0-06(같은 Uptime Kuma 설정, app.module.ts와 무관한 별도 파일)
T-W1-01[SOLO] ─┬─ T-W1-02 ─ T-W1-03 ─ T-W1-11a ─ T-W1-11b[SOLO]
               └─ T-W2-05, T-W2-06(토큰 2단계 소비, W2 완료 시점까지)
T-W1-05 ─ T-W1-08(**D4: `app.module.ts` 준-공용 자산 — 동시 편집 금지, 같은 웨이브 배치 불가·순차만 허용**)
T-W1-08 ─ T-W2-12(**신설(EVAL-ROUND-22 22B X2-2/D22-8) — 같은 `services/api/src/telemetry/*`(glob 표기) 공유:
T-W2-12는 E2 원천·소유권 열이 "T-W1-08 모듈 확장"이라 명시하는 확장 태스크라 편집 순서(T-W1-08 Wave 5 →
T-W2-12 Wave 10)를 엣지로 강제한다. 舊 그래프에 이 엣지가 없어 §B 승격 문턱 조건 ①이 불성립인 채 무판정
상태였다 — §B 유예 7 참조**)
T-W1-03 ─ T-W1-07a(**DD1 — `watch/[id].tsx`(EVAL-ROUND-14 D14-4/J-2 정정 소유) 계측 배선은 T-W1-03이 놓는 폴백 UI 골격 완료 후에만 안전, Wave 8(현 8a)에서 제거해 Wave 12로 이동**)
T-W1-07a ─ T-W1-11a(**신설(EVAL-ROUND-17 F-11/D17-1) — 02§E-9①의 구독자 E2E 4단계 시나리오 마지막 단계
"자막(Scene 캡션) 토글"의 UI는 T-W1-07a(Wave 12, `watch/[id].tsx`)가 구현하는데, 舊 그래프에는 이 엣지가
없어 T-W1-11a(당시 Wave 10)가 그 UI 없이 게이트①을 통과할 수 없는 상태였다. 엣지 추가에 따라 T-W1-11a를
Wave 13a로 재배치(연쇄: T-W1-11b도 Wave 13b로 재배치) — 위 두 ASCII 체인(`T-W1-03 ─ T-W1-11a ─ T-W1-11b`)은
T-W1-03 선행은 그대로 유효하나 이제 T-W1-07a 선행이 AND 조건으로 추가됐다는 뜻으로 읽는다**)
T-W1-03 ─ T-W2-11 ─ T-W1-07a(**같은 `apps/subscriber/app/live/[id].tsx` 3태스크 공유(EVAL-ROUND-15 H-5/D15-2 신설 —
준-공용 자산 5 참조) — 편집 순서 T-W1-03(Wave 8a, hls.js 재생+폴백 UI) → T-W2-11(Wave 10, 상품카드 삽입) →
T-W1-07a(Wave 12, 계측 배선). 웨이브가 전부 달라 현 편성에 동시 편집 없음**)
T-W1-03 ─ T-NC-06(**EVAL-ROUND-5 영역4 감점1·U-10 — 08§A W1 DoD② "상세 화면이 실제로 렌더됨을 확인"은 웹 빌드
산출물(`expo export --platform web` 스모크·전 화면 웹 렌더)이 있어야 판정 가능하며 그 산출물은 T-W1-03(Wave 8a)뿐이다.
舊 그래프에는 이 엣지가 없어 T-NC-06이 완료 불가능한 시점(Wave 4 종료 직후)에 열리는 것으로 서술돼 있었다**)
T-NC-03(PoC) ─ T-W2-02(EXEC-DECISIONS #2 — "**§E 7번 계열(T-W2-02 이후) 착수 전 완료**"), T-W2-03
T-W2-02 ─ T-W2-03(같은 업로드 플로우)
T-W2-08[SOLO] ─ T-W2-09(같은 주민링크 API 소비)
T-W2-13[SOLO] ─ T-W2-14(같은 미성년자 게이트 소비)
T-W2-03, T-W2-14 ─ T-W2-05(기자 앱 콘텐츠 등록 폼 파일 중복 가능성 — 순서 분리로 회피)
T-W1-07b ─ T-W2-14(**같은 `apps/reporter/app/(app)/contents/new/classify.tsx` 공유(EVAL-ROUND-15 H-5 신설) —
T-W1-07b(Wave 8a, 모드 선택 UI 호출 배선+간단/정밀 위저드 분기) → T-W2-14(Wave 12, 미성년자 게이트 소비) 순서.
웨이브가 달라 동시 편집 없음**)
T-W1-07b ─ T-W2-05(**신설(EVAL-ROUND-20 Z2-1) — `apps/reporter/app/(app)/contents/new/classify.tsx`(T-W1-07b·
T-W2-05 공유, 준-공용 자산 7 참조)·`.../upload.tsx`(T-W1-07b·T-W2-05 공유) 2파일 공통 순서: T-W1-07b(Wave 8a) →
T-W2-05(Wave 13a). 웨이브가 달라 동시 편집 없음**)
T-W2-18 ─ T-W2-05(**신설(EVAL-ROUND-20 Z2-1) — 같은 `apps/reporter/app/(app)/contents/new/scenes.tsx` 공유
(T-W2-18 Wave 12 → T-W2-05 Wave 13a). 웨이브가 달라 동시 편집 없음**)
T-W2-15 ─ T-W2-16a(CF Stream webhook, BE) ─ T-W2-16b(상태조회 UI, FE — D6 분할 후 순차 유지)
T-W2-04, T-W2-16b ─ T-W2-06(관제 앱 인증·CF Stream 작업 정착 후 토큰 소비)
T-W2-01~16b(전건) ─ T-W2-07(Playwright 완성은 기자·관제 기능 완결 후)
T-W2-07 ─ T-W2-17(**EVAL-ROUND-8 D8-1 신설** — CI 잡이 실행할 시나리오·스모크 스펙이 먼저 존재해야 CI 등재가 유효하다)
T-W1-04, T-W1-11a ─ T-W1-11b(CI 번들예산게이트·Lighthouse CI 게이트는 클라이언트측 완료 후 — **舊 근거의
"CF 캐시퍼지 CI 스텝"은 EVAL-ROUND-22 D22-2로 그 스텝이 T-W1-11c(`deploy-web.yml`)에 이관되며 제외**)
T-W0-03, T-W1-03 ─ T-W1-11c[SOLO](**신설(EVAL-ROUND-22 X2-1(1차)/D22-1) — `deploy-web.yml` 웹 배포 워크플로:
nginx `web` 컨테이너(T-W0-03, Wave 2)와 웹 export 빌드 실증(T-W1-03, Wave 8a)이 선행(D22-1 확정 2건).
02§E-4-1 4번째 요소(배포 파이프라인 CF 캐시 퍼지)는 D22-2로 T-W1-11b에서 본 태스크로 이관. 실배포 스텝
활성은 T-NC-02 ②·G9 ① 확정 후(§F ①·② 참조 — 워크플로 작성 자체는 비차단)**)
T-W3-01[SOLO] ─ T-W3-02, T-W3-03, T-W3-04(쉘 토큰수신 API 선행)
T-W3-02 ─ T-W3-03(**D4-5, EVAL-ROUND-4 영역4 감점1·V-7 — 02§E-10 "manifest/SW → TWA → iOS 쉘" 순서 선언을 의존
엣지로 반영. TWA(Bubblewrap)는 PWA manifest를 패키징 입력으로 받는 실질 기술 의존이기도 하다. T-W3-04(iOS 쉘)는
이 순서 선언의 직접 대상이 아니나 §C에서 T-W3-03과 함께 T-W3-02 이후 웨이브로 재편**)
T-W1~W3(전건) ─ T-W4-01, T-W4-02, T-W4-03
T-NC-10(스토어 심사 통과) ─ T-W4-*(08§A W4 선행조건 "W1~W3" 전건)
```

**시간축 매핑표 소비(08§A 4개 앵커 인용)**: 앵커 2(런칭=W1 DoD 시점)는 §C **Wave 12** 종료 시점과 일치(EVAL-ROUND-3
영역4 감점1·Z-9 정정 — DD3(라운드3 시점) "**W1 DoD 판정 기점** = Wave 12" 통일(EVAL-ROUND-19 R2-10 문언
정정 — 舊 "W1 종료 웨이브 = Wave 12"는 라운드17 이후 T-W1-11a·11b가 Wave 13a·13b로 재배치되며 신설된
"W1 코드 종료(Wave 13b)/DoD 판정 기점(Wave 12)" 이원 선언(EVAL-ROUND-18 V2-1, §C Wave 16 선행 열·E2 §C
W3 선행 문단 참조)과 문언이 어긋났다 — 앵커 자체는 항상 "DoD 판정 기점"만 가리켰으므로 이 문언 정정은
관계식 변경이 아니라 W1 코드 종료 개념 신설 전 舊 표현을 현행에 맞춘 것이다), 舊 "Wave 11"은 T-W1-07a가
Wave 8(현 8a)→12로 이동한 결과가 미전파된 자기모순이었다), 앵커 3(첫
실 방송=W2 DoD 이후+04§H-1 게이트)은 §C Wave 15b 종료 이후(EVAL-ROUND-8 D8-1 반영 — W2 DoD의 "CI 자동 실행" 요소가 T-W2-17(Wave 15b)로 결박되며 W2 종료 마커가 15a→15b로 이동, 04 자체 게이트는 본 문서 비범위), **앵커 4(대외
런칭=시드 콘텐츠 6건)는 "제외"가 아니라 §D 체크포인트로 편입한다**(EVAL-ROUND-6 W-2·기타확정 정정 — 舊 "W축과
별도 캘린더라 웨이브에 대응시키지 않는다"는 08§A 원문 근거를 잘못 인용한 것이었다. 08§A 원문(앵커 4 단락)의
정확한 판정 시점 문구는 **"담당: 기획(PM), 판정 시점: 앵커 2(W1 DoD) 판정과 동시 착수하여 이후 시드 콘텐츠
누적 시마다 재확인(월 1회 W축 진척 점검 회의와 동일 주기)"**이며, 이는 "M축이 W단계 진행 속도와 무관하게
흐른다"는 M1~M12 서술과 달리 **앵커 2(=Wave 12 종료)에 W축으로 결박**돼 있다 — W축과 무관한 것은 M1~M12뿐이고
앵커 4는 그와 다르다. 아래 §D에 체크포인트로 편입한다).

## B. 단독 슬롯 규칙 적용 (G3)

**정의 확정 — 정본은 EXEC-PLAN G3(D1, EVAL-ROUND-1 X-5 정정)**: 舊 E3는 이 정의를 본 문서가 직접 서술했으나,
E4 §A-1이 "다른 자산의 태스크와는 병행 가능"이라는 **정반대 해석**을 별도로 서술해 두 문서가 충돌했다(같은
EXEC-PLAN G3를 인용한다면서 정반대 결론). 이를 EXEC-PLAN G3 본문에서 **1회 확정**하도록 조율자가 정정했으므로,
본 절은 그 확정 문안을 **인용만** 한다:

> **EXEC-PLAN G3 정본 인용**: "단독 슬롯의 정의(본 행이 정본 — EXEC-ROUND-1-DECISIONS D1): 그 태스크만 실행하는
> 웨이브다. 파일 집합이 겹치지 않는 다른 태스크와도 같은 웨이브에 동시 배치하지 않는다(시스템 전체 정지). 근거는
> 공용 자산의 **런타임 정합성**(마이그레이션 중 다른 세션의 DB 관측, CI 변경 중 다른 태스크의 게이트① 실행).
> E3 §B·E4 §A-1은 이 문장을 인용만 한다."

즉 SOLO 웨이브는 **시스템 전체가 그 1태스크만 실행**하는 웨이브다(다른 트랙도 일시 정지) — 아래 표·§C 웨이브
편성은 이 정의를 그대로 적용한다.

| 태스크 | G3 사유 | 웨이브 |
|---|---|---|
| T-W0-05 | `app.config.ts` 공통 변경(3앱) | Wave 1 |
| T-W1-01 | `packages/ui` 신설(공용 자산) | Wave 3 |
| T-W1-11b | CI 설정(`ci.yml`) 변경(D6 분할 — installability·번들예산게이트·Lighthouse CI 게이트. **CF퍼지 CI 스텝은 EVAL-ROUND-22 D22-2로 T-W1-11c 이관**) | Wave 13b(舊 Wave 11 — EVAL-ROUND-17 F-11/D17-1로 T-W1-11a 재배치에 연쇄, 라벨 11 폐지) |
| T-W1-11c **(EVAL-ROUND-22 D22-1 신설)** | CI 설정(`.github/workflows/deploy-web.yml` 신규 — 웹 배포 워크플로. `ci.yml`과 별개 파일이나 CI 설정 G3 SOLO 관례 동형, E1 §A-1 보완 조건 ①의 `.github/workflows` 다중 소유+SOLO 시점 배타 규칙 대상) | Wave 8c |
| T-W2-08 | Prisma 스키마 마이그레이션(`ContentOrigin` 확장) | Wave 6 |
| T-W2-13 | Prisma 스키마 마이그레이션(미성년자 필드) | Wave 7 |
| T-W2-17 **(EVAL-ROUND-8 D8-1 신설)** | CI 설정(`ci.yml`) 변경(02§E-9 완료 정의 "CI 자동 실행" 요소, T-W1-11b·T-W4-02와 동일 파일) | Wave 15b |
| T-W3-01 | Prisma 스키마 마이그레이션(`PushSubscription`) + `app.module.ts` 준-공용 자산 등록 | Wave 16 |
| T-W4-02 | CI 설정(`ci.yml`) 변경 | Wave 19 |

**단독 배치이나 SOLO 아님 4건(부기 — EVAL-ROUND-24 U2-7/D24-6 신설, E5 §D 앵커 ② "오분류 대조" 차집합의 우항)**: 위 표는 G3 SOLO 웨이브이며, §C에서 **구현 태스크가 1건만 배치된 웨이브**는 이보다 많다 — 그 차집합은 `8b`·`14`·`15a`·`17a` 4건이고 사유는 각각 ① **8b**(T-W1-04) = `pnpm-lock.yaml` 준-공용 자산 **동시성 1**(D6-1)이 T-W1-03(8a)과의 동시 배치를 금지해 분리 — §C 8b 셀이 "SOLO 아님 — G3 사유가 아니라 준-공용 자산 동시성 1 사유"라 이미 명시 ② **14**(T-W2-06) = **병렬 대상 없음**(§C 14 셀 "단독(병렬 대상 없음)" — 선행 정착 조건 때문에 같은 시점에 배치할 배타 태스크가 남지 않음) ③ **15a**(T-W2-07) = **병렬 대상 없음**(§C 15a 셀 "다른 W2 태스크 전건 완료가 전제라 병렬 대상 없음" — D7-2로 이 웨이브가 lockfile 규칙 위반이 아님도 같은 셀에서 판정) ④ **17a**(T-W3-02) = 02§E-10 **순서 선언**에 따라 T-W3-03의 선행으로 분리(D4-5/V-7)다. 넷 다 G3 사유(공용 자산의 런타임 정합성)가 아니라 **편성 사유**이므로 SOLO로 승격하지 않는다 — SOLO는 시스템 전체 정지를 요구하는데 이 4건은 다른 트랙의 정지를 필요로 하지 않는다. **재현**: 차집합 산출은 E5 §D 앵커 ② "오분류 대조" 명령(양방향 — 역차집합이 비어야 SOLO 전건이 단독 배치다), 사유 원문 대조는 `grep -nE "^\| \*\*(8b|14|15a|17a)\*\* \|" docs/plan/exec/E3-parallel-schedule.md`. 라벨 값·건수는 **그 시점 실측**이며 §C 재편 시 본 부기도 같은 커밋에서 동반 갱신한다(D7-1 — 박제 금지).

**Prisma 마이그레이션 순서 고정**: T-W2-08 → T-W2-13 → T-W3-01 (W축 순서와 자연히 일치하므로 별도 조정 불요,
E2 §G 리스크 표 인용).

**준-공용 자산 종수 참조 원칙(EVAL-ROUND-13 K-4 재발 방지)**: 본 문서·타 문서에서 "준-공용 N종"을 인용할 때
N은 **항상 아래 §B 목록의 현재 길이를 그대로 따른다**(고정 수 박제 금지) — 신설 시 §B에만 추가하고 참조처
(§D T-TRIG 등)를 놓치면 K-4류(3종/4종 불일치)가 재발한다.

**승격 문턱(EVAL-ROUND-19 R2-5 신설, EVAL-ROUND-20 Z2-1로 전면 재작성 — 리포 실측과 어긋난 舊 판정 정정)**:
동일 파일을 **2개 이상** 태스크가 편집하면 준-공용 자산 **후보**다. ① §A 의존 그래프에 그 편집 순서를
강제하는 엣지가 있고 ② 현 편성에서 서로 다른 웨이브에 배치돼 실질 동시 편집이 없으면 **등재를 유예**하되
그 판정을 §B에 1줄로 남긴다(무판정 잔존 금지 — 등재 밖 상태를 "판정 없음"이 아니라 "유예로 판정함"으로
명시). **3태스크 이상 공유하거나 ①·② 중 하나라도 성립하지 않으면 정식 등재를 검토한다.**
**재발 방지(EVAL-ROUND-20 Z2-1)**: 공유 파일 판정의 입력은 **E2 §C 파일 소유권 열의 명시 경로 +
`dir/*` glob 표기(EVAL-ROUND-22 22B X2-2/D22-8 확장 — 같은 디렉터리 glob을 2개 이상 태스크가 소유 표기하면
후보로 편입하고 착수 전 실측 grep으로 파일을 전개한 뒤 판정한다. 舊 정의는 "명시 경로/개수 표기" 2형태만
덮어 제3의 형태인 glob이 정의역 밖이었고, 그 결과 `telemetry/*`·`live/*` 2쌍이 무판정 잔존했다 — 아래 유예
7·8로 해소. glob 공유 후보 자동 탐지 재현: grep -oE '\`services/api/src/[a-z-]+/\*\`'
E2-work-breakdown.md | sort | uniq -c | awk '$1>1' — 그 시점 전수, 닫힌 목록 아님)**이며,
개수 표기만 있는 태스크(T-W1-02·T-W2-05·T-W2-06 등 대량 태스크)는 착수 전 실측 grep으로 경로를 전개한
뒤 판정한다 — 舊 판정(아래)이 T-W1-02·T-W2-05·T-W2-06을 이 열에서 누락해 준-공용 5의 편집 태스크 수와
"유예 2건"의 태스크 수 양쪽이 실측과 어긋났었다(E2 §C가 이번 라운드 Z2-11로 그 세 태스크의 공유 파일을
명시 열거했으므로 이 절이 그 입력을 그대로 소비한다).

**정식 등재 판정 2건(舊 "유예 2건" 정정)**: 리포 실측(리포 루트,
`grep -n 'watch/\[id\]\.tsx\|classify\.tsx' docs/plan/exec/E2-work-breakdown.md`)
결과 두 파일 모두 **3태스크** 공유로 확인돼 문턱의 "3태스크 이상" 조건에 해당한다 — 아래 **준-공용 자산
6·7**로 정식 등재한다(既존 5종과 동일 논거: `live/[id].tsx`(자산5)도 정확히 3태스크에서 승격됐던 선례와
정합).

**유예 판정 8건(무판정 잔존 해소, EVAL-ROUND-20 Z2-1 6건 + EVAL-ROUND-22 22B X2-2/D22-8 glob 2건 편입
6→8)**: 아래 전부 2태스크 공유이며 조건 ①(엣지)·②(배치 분리) 양쪽을 충족해 유예한다 —
1. `apps/subscriber/app/(tabs)/index.tsx`(T-W1-02 Wave5·T-W1-03 Wave8a — 엣지는 §A "T-W1-02 ─ T-W1-03" 체인(토큰 게이트 선행)으로 기존 실재, 배치 분리 — 유예)
2. `apps/subscriber/app/(tabs)/stations.tsx`(동일 태스크 쌍·동일 근거 — 유예)
3. `apps/reporter/.../contents/new/index.tsx`(T-W2-03 Wave9·T-W2-05 Wave13a — 엣지 `T-W2-03, T-W2-14 ─ T-W2-05` 기존 실재, 배치 분리 — 유예)
4. `apps/reporter/.../contents/new/upload.tsx`(T-W1-07b Wave8a·T-W2-05 Wave13a — 엣지 `T-W1-07b ─ T-W2-05` 신설(§A 참조), 배치 분리 — 유예)
5. `apps/reporter/.../contents/new/scenes.tsx`(T-W2-18 Wave12·T-W2-05 Wave13a — 엣지 `T-W2-18 ─ T-W2-05` 신설(§A 참조), 배치 분리 — 유예)
6. `apps/control-center/app/(app)/live/[id].tsx`(T-W2-16b Wave13a·T-W2-06 Wave14 — 엣지 `T-W2-04, T-W2-16b ─ T-W2-06` 기존 실재, 배치 분리 — 유예)
7. `services/api/src/telemetry/*`(T-W1-08 Wave5·T-W2-12 Wave10 — **glob 표기 공유, EVAL-ROUND-22 22B X2-2/D22-8 편입**. 엣지 `T-W1-08 ─ T-W2-12` **신설**(§A 참조 — E2 T-W2-12 원천·소유권 열 "T-W1-08 모듈 확장"이 이미 순서 근거를 명시하나 舊 그래프에 엣지가 없어 조건 ① 불성립 상태였다), 배치 분리 — 유예)
8. `services/api/src/live/*`(T-W2-15 Wave10·T-W2-16a Wave12 — **glob 표기 공유, EVAL-ROUND-22 22B X2-2/D22-8 편입**. 엣지 `T-W2-15 ─ T-W2-16a` 기존 실재(§A), 배치 분리 — 유예. 舊에는 엣지·배치 분리가 실재하면서도 유예 목록 밖의 무판정 잔존이었다)

전건 향후 3번째 편집 태스크가 생기면 이 문턱에 따라 정식 등재를 재검토한다.

**준-공용 자산(D4, EVAL-ROUND-1 영역4 감점1·X-14 — SOLO는 아니지만 동시성 1)**: `services/api/src/app.module.ts`
(NestJS 단일 등록점, 리포 실측 **17모듈** 전부 이 파일에 등록 — EVAL-ROUND-2 영역1 감점1·Y-1 정정, 재현 명령은
E2 T-W1-05 행 각주 참조: `awk '/imports: \[/{f=1;next} /^  \],/{f=0} f' services/api/src/app.module.ts | grep -cE
"^\s+[A-Za-z]"` → `17`)는 **SOLO로 승격하지 않되 동시성 1**을 적용한다 — 이
파일을 편집하는 신규 api 모듈 태스크(T-W1-05·T-W1-08·T-W2-08·T-W3-01)는 **같은 웨이브에 2건 이상 배치하지
않는다**(T-W2-08·T-W3-01은 이미 SOLO라 자동 충족, 실제 조정이 필요한 것은 T-W1-05·T-W1-08 두 비-SOLO 태스크뿐).
아래 §C Wave 4·5가 이 규칙을 적용해 두 태스크를 서로 다른 웨이브로 분리 배치한다.

**준-공용 자산 2 — 루트 `pnpm-lock.yaml`(EVAL-ROUND-6 D6-1 신설, `app.module.ts`와 동형, **EVAL-ROUND-7 D7-3·
D7-2로 열거 갱신**, **EVAL-ROUND-25 K2-1/D25-1로 6종→8종**)**: 루트 `pnpm-lock.yaml`을 갱신하는 태스크는
**5종**(T-W0-05 react-dom 등 3앱·T-W1-03 hls.js·T-W1-04 Workbox·T-W1-11a Playwright·T-W3-01 web-push, E2 §G
리스크표 인용) **+ T-W2-07**(관제·기자 `@playwright/test`, D7-2로 소유자 유예 해제된 6번째 — EVAL-ROUND-7 Q-9)
**+ T-W1-01**(3앱 `apps/*/package.json`의 `"@gachinol/ui": "workspace:*"` 소비측 선언 — **EVAL-ROUND-25
K2-1/D25-1로 편입된 7번째**, E2 §A "공용 패키지 신설 태스크의 소비측 선언 동반 원칙"이 소유자를 확정)
**+ T-W3-02**(reporter·control-center `package.json`의 Workbox 의존성 — **EVAL-ROUND-25 K2-1 동형 확정(조율자
판정)으로 편입된 8번째**. T-W1-04가 subscriber분을 소유한 것과 대칭이며, 舊에는 두 앱의 `sw.js`·등록 모듈만
소유하고 그 의존성 선언이 소유권 밖이라 같은 유형의 누락이 남아 있었다). 舊 "실측
4종"은 이 계획 최대 규모 의존성 태스크인 T-W0-05를 누락했었다(Q-8). **정의역 확장(K2-1 근본 해소)**: 본 규칙의
대상은 "신규 npm 패키지 도입"에 한정되지 않고 **`pnpm-lock.yaml`을 갱신하는 모든 태스크**다 — 워크스페이스 내부
패키지 선언(`workspace:*`)도 `importers:` 섹션 갱신을 유발하므로 동일 대상이며(리포 실측 재현:
`grep -c "^  apps/" pnpm-lock.yaml` → 그 시점 값, 현 3), 舊 "npm 의존성" 어휘가 이 형태를 정의역 밖으로 밀어낸
것이 K2-1의 발생 경로였다. **이 열거는 그 시점 전수이며 닫힌 목록이 아니다**(재현 = 바로 아래 python3 블록) —
lockfile을 갱신하는 태스크가 생기면 그 태스크가 자동으로 본 규칙 대상이 된다(E2 T-W1-06 DoD의 "닫힌 목록 아님" 장치와 동형, EVAL-ROUND-7 영역4
9.5 도달 수정 지시 반영). 대상 태스크는 `pnpm-lock.yaml`을 공유 편집한다 — **SOLO로 승격하지 않되 동시성 1**을
적용한다: **같은 웨이브에 lockfile 갱신 태스크를 2건 이상 배치하지 않는다**(D6-1 확정 문안). 舊 Wave 8
(T-W1-03+T-W1-04 동시 배치)이 이 규칙 위반이었으므로 아래 §C가 **Wave 8a/8b로 분리 재배치**한다(T-W3-01·
T-W0-05·**T-W1-01**은 이미 SOLO라 자동 충족, T-W1-11a는 **Wave 13a**(舊 Wave 10 — EVAL-ROUND-17 F-11/D17-1로
재배치)에서 다른 lockfile 갱신 태스크와 겹치지 않아 자동 충족, **T-W2-07은 Wave 15a 단독 배정이라 D7-2 편입
후에도 위반 없음 — 아래 §C Wave 15a 셀 판정 참조**).

**8종 전건 웨이브 배치 재검증(K2-1 해소 확인 — 재배치 0건으로 D6-1 위반 0, 재현 블록은 이 문단 하단)**: 8종의
소속 웨이브는 `1`(T-W0-05 SOLO)·`3`(T-W1-01 SOLO)·`8a`(T-W1-03)·`8b`(T-W1-04)·`13a`(T-W1-11a)·`15a`(T-W2-07)·
`16`(T-W3-01 SOLO)·`17a`(T-W3-02)로 **전건 서로 다른 라벨**이라(재현: 하단 python3 블록) 어느 웨이브에도 2건이
겹치지 않는다. 소유자를 T-W1-01(SOLO)로 확정한 결과 **웨이브 재배치
자체가 불필요**해졌다(소비 전환 3태스크를 lockfile 편집자로 두는 대안이었다면 Wave 13a에 T-W2-05+T-W1-11a 2건이
서서 라벨 분리가 강제됐다 — 택일 근거는 E2 §A 비교 기록). **재현**(리포 루트, 중복 라벨이 있으면 그 라벨이 출력된다):

```
$ python3 - <<'PY'
import re, collections
e3=open('docs/plan/exec/E3-parallel-schedule.md',encoding='utf-8').read()
lock=['T-W0-05','T-W1-01','T-W1-03','T-W1-04','T-W1-11a','T-W2-07','T-W3-01','T-W3-02']
rows=re.findall(r'(?m)^\| \*\*([0-9]+[abc]?)\*\* \| ([^|]*)\|', e3)
w={t:[lab for lab,tasks in rows if re.search(re.escape(t)+r'(?![0-9a-c])', tasks)] for t in lock}
print(w)
c=collections.Counter(l for v in w.values() for l in v)
print('lockfile 2건 이상 웨이브:', [k for k,n in c.items() if n>1])
PY
```

**`apps/*/package.json` 자체의 준-공용 자산 등재 판정(무판정 잔존 금지 — 위 승격 문턱 적용)**: 위 편입으로
`apps/subscriber/package.json`은 T-W0-05·T-W1-01·T-W1-03·T-W1-04·T-W1-11a **5태스크**가 편집하게 돼 문턱의
"3태스크 이상" 조건에 걸린다 — 그러나 **별도 자산으로 등재하지 않는다**: 이 파일의 편집은 예외 없이
`pnpm-lock.yaml` 갱신을 동반하므로 **자산 2 규칙(앱 횡단 동시성 1)이 앱 단위 동시성 1의 상위집합**이고, 별도
등재는 같은 제약의 이중 기재가 된다(자산 4 `_layout.tsx`가 앱 단위 스코프를 따로 둔 것과는 다르다 — 그쪽에는
상위 규칙이 없다). 등재 밖 상태를 "판정 없음"이 아니라 "상위 규칙에 흡수됨으로 판정"으로 기록해 무판정 잔존을
만들지 않는다(D8-3 원칙).

**K2-1 동형 잔여 1건 — 편입 확정(조율자 판정, 라운드 25 같은 작업에서 반영 완료)**: T-W3-02(Wave 17a)는 T-W1-04가
subscriber에 확립한 Workbox 패턴을 reporter·control-center로 이식하는데, T-W1-04는 자기 앱 `package.json`(Workbox
의존성)을 소유권에 명시한 반면 T-W3-02 소유권에는 두 앱의 `package.json`이 없어 **같은 유형의 소비측 선언 누락**이
남아 있었다. 조율자가 "K2-1과 같은 유형의 결함을 문서에 남기면 다음 라운드에 그대로 지적된다"로 **편입 확정**해
본 라운드에 반영했다 — E2 T-W3-02 소유권 열 +2파일(**총 9→11**), 위 자산 2 열거 **7종→8종**, 위 재검증 블록 재실행
결과 `lockfile 2건 이상 웨이브: []` 유지. **사이징 무영향**(버킷 L=7~11 정의역 안이라 9도 11도 L → E4 §A-6 Wave 17a
예산 불변)이고 **D6-1 무영향**(Wave 17a는 T-W3-02 단독). 유일한 문서 간 파급은 **E4 §G #6의 리터럴 재현 주장**
(§C 사이징 셀의 **9파일 리터럴을 세는 그 주장**의 값이 본 갱신으로 감소한다 — 문자열 자체는 여기 재생산하지
않는다: 재생산이 곧 그 grep의 계수를 부풀려 주장을 자기 반증하게 만들기 때문이다, D24-4·D23-1 존량 규칙)이며,
값 박제 없는 형태로의 전환은 **A팀 소관**이다(아래 §신규 위임
목록 #6 — B팀은 E4를 수정하지 않는다).

**준-공용 자산 3 — `infra/docker/nginx.conf`(EVAL-ROUND-8 D8-4 신설, R-8 — `app.module.ts`·`pnpm-lock.yaml`과
동형)**: E2가 T-W1-06·T-W2-09 파일 소유권 열에서 이미 "준-공용 자산"·"준-공용 주의"라 명시했음에도 舊 §B
준-공용 목록에는 등재돼 있지 않았다(무규칙 상태에서 Wave 2·4·9로 흩어진 것은 의존 관계의 부수 결과였을 뿐,
규칙의 산물이 아니었다). **SOLO로 승격하지 않되 동시성 1**을 적용한다: 현재 편집 태스크 = **T-W0-03(Wave 2)·
T-W1-06(Wave 4)·T-W2-09(Wave 9) 3건**(그 시점 전수, 닫힌 목록 아님 — EXEC-DECISIONS #6에 따라 동적 라우트를
신설하는 태스크가 nginx SPA 폴백 패턴을 동반 소유하므로 자동으로 이 규칙 대상에 편입된다). 같은 웨이브에
2건 이상 배치 금지 — 현재 3건은 이미 서로 다른 웨이브라 위반 없음(재확인).

**준-공용 자산 4 — `apps/<app>/app/_layout.tsx`(EVAL-ROUND-12 D12-1 신설, M-7 — `app.module.ts`(D4)와 동형
논거: expo-router 단일 등록점, 다수 태스크가 계속 편집)**: 리포 실측(`cat apps/subscriber/app/_layout.tsx`) 결과
이 앱의 루트 레이아웃은 `<Stack.Screen name="watch/[id]" options={{...}} />`처럼 라우트를 **명시 등록**하는
구조이고, 계획 자신도 T-W1-04에서 이 파일을 소유권에 이미 명시했다 — "공유 진입점"임이 실측으로 확인된다.
**SOLO로 승격하지 않되 동시성 1**을 적용한다: **동시성은 앱 단위로 스코프**된다(같은 웨이브에 **같은 앱**의
`_layout.tsx` 편집 태스크를 2건 이상 배치하지 않는다 — 서로 다른 앱의 `_layout.tsx`는 별개 파일이라 무관).
현재 편집 태스크 = **T-W1-04(Wave 8b, subscriber)·T-W2-09(Wave 9, subscriber)·T-W3-02(Wave 17a, reporter·
control-center)** 3건(그 시점 전수, 닫힌 목록 아님 — 신규 라우트 태스크가 생기면 자동 편입). **위반 판정**:
T-W1-04와 T-W2-09는 둘 다 subscriber이나 웨이브가 다르다(8b≠9) — 무충돌. Wave 9 자체는 T-W2-09 1건만
subscriber `_layout.tsx`를 편집한다(D12-1 판정 — T-W1-09·T-W1-10은 옵션 불요로 이 파일 소유권에 불포함,
E2 §C 해당 행 참조) — **동시성 1 규칙 자동 충족, 웨이브 재편 불요**.

**준-공용 자산 5 — `apps/subscriber/app/live/[id].tsx`(EVAL-ROUND-15 H-5/D15-2 신설 — `_layout.tsx`(D12-1)와
동형 논거: 다수 태스크의 반복 편집 단일점, D8-4가 `nginx.conf`를 승격시킨 논거("무규칙 상태에서 여러 웨이브로
흩어진 것은 의존 관계의 부수 결과였을 뿐, 규칙의 산물이 아니었다")와 정확히 같은 상황. **EVAL-ROUND-20 Z2-1
정정** — 舊 "3태스크"는 T-W1-02를 누락한 실측 오류였다)**: 리포 실측(`grep -n 'live/\[id\]\.tsx'
E2-work-breakdown.md`) 결과 **4태스크**가 이 파일을 편집한다 — **T-W1-02(Wave 5, theme 소비 전환)** ·
T-W1-03(Wave 8a, hls.js 재생+폴백 UI) · T-W2-11(Wave 10, 상품카드 삽입) · T-W1-07a(Wave 12, 계측 배선).
**SOLO로 승격하지 않되 동시성 1**을 적용한다(앱 단위 스코프 — `_layout.tsx`와 동형). **위반 판정**: 4태스크가
각각 Wave 5·8a·10·12로 전부 다른 웨이브에 배치돼 있어 **현 편성에 동시 편집은 없다**(재편 불요) — §A
의존 그래프의 `T-W1-02 ─ T-W1-03`(체인 실재) + `T-W1-03 ─ T-W2-11 ─ T-W1-07a` 엣지가 전건 순서를 명시한다.
이 규칙은 향후 편성 변경 시 4건 중 2건 이상이 같은 웨이브로 합류하는 것을 막는 **하드가드**로 기능한다
(그 시점 전수, 닫힌 목록 아님).

**준-공용 자산 6 — `apps/subscriber/app/watch/[id].tsx`(EVAL-ROUND-20 Z2-1 신설 — R2-5 문턱 "3태스크 이상"
조건 충족으로 유예에서 정식 등재 승격, 자산5와 동형 논거)**: 리포 실측 결과 **3태스크**가 편집한다 —
T-W1-02(Wave 5, theme 소비 전환) · T-W1-03(Wave 8a, VOD 폴백 UI 골격) · T-W1-07a(Wave 12, 계측 배선+자막
토글). **SOLO로 승격하지 않되 동시성 1**을 적용한다(앱 단위 스코프). **위반 판정**: 3태스크가 각각 Wave
5·8a·12로 전부 다른 웨이브라 **현 편성에 동시 편집은 없다** — §A `T-W1-02 ─ T-W1-03`(체인)·`T-W1-03 ─
T-W1-07a` 엣지가 순서를 명시한다.

**준-공용 자산 7 — `apps/reporter/app/(app)/contents/new/classify.tsx`(EVAL-ROUND-20 Z2-1 신설 — 동형
승격)**: 리포 실측 결과 **3태스크**가 편집한다 — T-W1-07b(Wave 8a, 모드 선택 UI 호출 배선) · T-W2-14
(Wave 12, 미성년자 게이트 소비) · T-W2-05(Wave 13a, theme 소비 전환). **SOLO로 승격하지 않되 동시성 1**을
적용한다. **위반 판정**: 3태스크가 각각 Wave 8a·12·13a로 전부 다른 웨이브라 **현 편성에 동시 편집은 없다**
— §A `T-W1-07b ─ T-W2-14`·`T-W1-07b ─ T-W2-05`(신설) 엣지가 순서를 명시한다.

**준-공용 자산 종수 갱신**: 위 6·7 신설로 준-공용 자산은 **5종 → 7종**이 된다 — 본 절 서두 "종수 참조
원칙"에 따라 이후 "준-공용 N종" 인용은 전부 7을 따른다(§D T-TRIG 3행·§I 체크리스트 동반 갱신).

## C. 웨이브 편성 (구현 동시 ≤4 + qa-verifier 슬롯 1 예약 = G4 상한 ≤5, D3 확정)

**편성 규칙 갱신(D3, EVAL-ROUND-1 영역4 감점4·영역5 감점1·X-12·X-15)**: 舊 E3는 "동시 ≤5"를 **구현 태스크 5건**으로
채워 매 웨이브 게이트②(qa-verifier) 슬롯이 0이 되고, 그 결과 검증이 웨이브 종료 후 전부 직렬화되는 문제가 있었다
— E4 §A-1이 "동시 ≤5는 구현+qa-verifier 합산"이라 정의한 것과 충돌했다(E4 §A-6 "145만 상한 유지" 판정의 전제
붕괴, X-12). **확정**: 구현 태스크 동시 배정 상한 **4건** + 5번째 슬롯은 **qa-verifier 전용 예약**. 아래 표의
"태스크" 열은 이미 이 상한(≤4)을 준수하도록 재편성했다 — 舊 Wave 4·5·8(구현 5건)을 4건으로 낮추고 여유분을
인접 웨이브로 재배치했다.

**표기**: 병렬 근거 열은 "파일 소유권 비교집합"을 요약한다 — 상세 파일 목록은 E2 각 태스크 행을 인용(재정의 아님).
예상 소요는 **상대 크기**(S=1~3파일·M=4~6파일·L=7~11파일·**XL=12파일 이상**, E4 §A-5가 정본으로 신설한 버킷 —
본 절은 인용만 한다, EVAL-ROUND-2 영역4 감점2·Y-7 반영)로 표기하며 절대 토큰·시간 예산은 E4 소관이다.

**예산 검산 기준(EXEC-DECISIONS #3 인용, EVAL-ROUND-2 영역4 감점3·Y-8 반영)**: 웨이브 배정 합계는 **200만
토큰**(정의의 정본은 E4 §A-3 — 본 절은 인용만)을 넘지 않는다. 아래 표의 태스크 구성·사이징이 이 검산의 입력이며,
절대 토큰 합산·상한 판정 자체는 E4 §A-6이 수행한다(본 문서는 입력만 소유).

**W0 "종료" 이원 명시(EVAL-ROUND-4 영역4 감점3·V-13 신설 — E5 §D 앵커 ⑥이 실행 가능해지려면 이 선언이 필요)**:
W0에는 "종료"가 **두 시점**으로 나뉜다 — **① W0 코드 종료 = Wave 4**(T-W0-01~06 6건 전건 웨이브 배정 완료 시점,
`app.module.ts` 준-공용 자산 사용까지 포함) **② W0 DoD 판정 기점 = Wave 2 완료 후**(§A "W0 DoD 범위 한정"이
정의한 DoD 형성 4건 T-W0-01~04만 대상 — T-NC-01 실측이 이 시점에 착수). 두 시점이 다른 이유: DoD 형성 4건은
Wave 2에서 이미 완료되지만, 나머지 2건(T-W0-04 백업·T-W0-06 보안 모니터링)은 §A가 명시한 대로 "DoD 엄격
선행 경로 밖"이라 Wave 4까지 유예돼 코드 자체는 더 늦게 끝난다 — 즉 **DoD 판정이 코드 종료보다 먼저 온다**
(선판정·후완결 구조).

| 웨이브 | 태스크(≤4 구현 + qa-verifier 1슬롯) | 병렬 근거(파일 집합) | 예상 소요 | 선행 웨이브 |
|---|---|---|---|---|
| **1** | T-W0-05 **[SOLO]** | 단독 — `app.config.ts`×3(수정)+`package.json`×3(수정)+**`src/global.css`×3(신규, 3앱 웹 엔트리 글로벌 CSS 진입점 — EVAL-ROUND-14 D14-1/J-6)** | **L(9파일** — 舊 M(6파일)에서 상향, EVAL-ROUND-14 D14-1) | — |
| **2** | T-W0-01, T-W0-02, T-W0-03, T-W0-04 | `services/api/src/auth/*` vs `infra/docker-compose.yml`+`infra/scripts/r2-cors.ts` vs `infra/docker/docker-compose.xeon.yml`+`nginx.conf`(신규)+`Dockerfile.web`(신규) vs `infra/backup/*`(신규) — 4개 워크스페이스/디렉터리 상호 배타(정확히 4건, qa-verifier 1슬롯 자동 확보) | **M+S×3**(T-W0-01=4파일 M · T-W0-02=2파일 S · T-W0-03=3파일 S · T-W0-04=3파일 S — EVAL-ROUND-2 영역4 감점4·Y-20 정정, 舊 "M×4"는 E3 자신의 S/M/L 정의(S=1~3)로 재판정하면 성립하지 않았다. 보수 방향 오기라 예산 리스크는 없었음) | Wave 1 |
| **3** | T-W1-01 **[SOLO]** | 단독 — `packages/ui/` 신설 **+ 3앱 `package.json` 소비측 선언**(`"@gachinol/ui": "workspace:*"` — EVAL-ROUND-25 K2-1/D25-1, E2 §A 원칙. **lockfile 갱신 태스크이나 SOLO라 §B 준-공용 자산 2 동시성 1을 정의상 충족**). **앵커 ⑯ 2단 재현**(D25-1 — 문서 소유권 + 리포 실체): ① 문서 `grep -c "^. T-W1-01 .*apps/{reporter,control-center,subscriber}/package\.json" docs/plan/exec/E2-work-breakdown.md` → ≥1 ② 리포 실체 `python3 -c "import json;print([k for k in json.load(open('apps/reporter/package.json'))['dependencies'] if 'gachinol' in k])"` → `['@gachinol/shared']`(즉 `@gachinol/ui`는 아직 없고, 소비가 성립하려면 이 선언이 추가돼야 한다) | **M**(T-W1-01=6파일 M — `packages/ui` 3(`package.json`+토큰스키마+CSS진입점) + 3앱 `package.json` 수정 3. **EVAL-ROUND-25 K2-1/D25-1로 舊 S(3파일)에서 버킷 전환** → **E4 §A-6 Wave 3 행 재계산 필요**(A팀 수신 위임, §신규 위임 목록 #4). 舊 이력: EVAL-ROUND-3 영역4 감점2·Z-10 전건 재판정으로 M→S였다) | Wave 2 |
| **4** | T-W1-05, T-W1-06, T-W2-01, T-W0-06 | `services/api/src/go-link/*`+`app.module.ts`(**D4 — 이 웨이브의 유일한 api 모듈 신설 태스크** — EVAL-ROUND-23 W2-6 앵커 ⑯ 부착, 재현: 본 웨이브 나머지 3태스크는 `app.module.ts` 미소유 `grep -c -e "^. T-W1-06 .*app\.module\.ts" -e "^. T-W2-01 .*app\.module\.ts" -e "^. T-W0-06 .*app\.module\.ts" docs/plan/exec/E2-work-breakdown.md` → 0 / 본 태스크만 소유 `grep -c "^. T-W1-05 .*app\.module\.ts" docs/plan/exec/E2-work-breakdown.md` → ≥1) vs `infra/docker/nginx.conf`(T-W0-03 후속) vs `apps/reporter/src/auth/token-store.ts` vs `infra/monitoring/*`(신규) — 4개 상호 배타, qa-verifier 1슬롯 확보. **정본 시점 차이 대사(EVAL-ROUND-5 영역1 감점2·U-15 신설)**: 02§E-6 정본은 동적 라우트 규칙(T-W1-06)을 "§E 4번(T-W1-03)과 동일 시점, §E 5번보다 선행 또는 동시"라 규정하나 본 계획은 T-W1-06=Wave 4, T-W1-03=Wave 8a로 **선행 배치**한다 — 안전 방향(nginx 폴백이 웹 빌드보다 먼저 서 있어도 무해, 반대로 웹 빌드가 폴백 없이 먼저 서면 신규 라우트 404 노출 위험)이므로 유지하되 정본 문언과의 차이를 여기 명시 대사한다 | **S×4**(T-W1-05=3파일·T-W1-06=1파일·T-W2-01=2파일·T-W0-06=2파일 — Z-10 전건 재판정, 舊 M×4는 버킷 정의 미적용) | Wave 3(T-W1-06은 T-W0-03 완료 필요), Wave 2(T-W0-06은 T-W0-04 완료 필요) |
| **5** | T-W1-08, T-W1-02, T-W2-04, T-W2-02 | `services/api/src/telemetry/*`+`app.module.ts`(**D4 — 이 웨이브의 유일한 api 모듈 신설 태스크, Wave 4의 T-W1-05와 겹치지 않도록 분리 배치**) vs `apps/subscriber` 테마소비(11파일) vs `apps/control-center/src/auth/*` vs `apps/reporter/src/upload/*`(신규) — 4개 상호 배타, qa-verifier 1슬롯 확보. **lockfile 갱신 태스크 0건**(D6-1 자동 충족 — **앵커 ⑯ 2단 재현, D25-1**: ① 문서 = §B "7종 전건 웨이브 배치 재검증" python 블록 출력에 라벨 `5`가 등장하지 않는다(등장하면 이 셀이 틀린 것) ② 리포 실체 = T-W1-02가 소비할 `@gachinol/ui` 선언은 선행 Wave 3의 T-W1-01이 이미 성립시켰다 — 현재 리포에는 그 선언이 없음을 `python3 -c "import json;print([k for k in json.load(open('apps/subscriber/package.json'))['dependencies'] if 'gachinol' in k])"` → `['@gachinol/shared']`로 확인) | **XL(T-W1-02, 12파일 — `theme.ts` 삭제 1+소비파일 11)**+**S×3**(T-W1-08=3파일·T-W2-04=3파일·T-W2-02=3파일 — Z-10 전건 재판정, 舊 M×3은 버킷 정의 미적용) | Wave 3(T-W1-02는 T-W1-01 필요), **T-NC-03 PoC 합격 필수**(아래 §D, EXEC-DECISIONS #2 — T-W2-02가 §E 7번 계열의 착수 지점, EVAL-ROUND-10 P-1 정정: Wave 9·16·18과 동형으로 T-NC 게이트를 선행 열에 명시 — 舊 이 열은 T-NC-03 게이트 없이 Wave 3만 적어 §C 표만 보고 편성 시 PoC 미완료 상태로 착수될 위험이 있었다) |
| **6** | T-W2-08 **[SOLO]** | 단독 — Prisma 마이그레이션(`ContentOrigin`) + `app.module.ts` 등록 + **검수 게이트 서버측 강제**(D13-2, EVAL-ROUND-13 K-8) + **shared `ContentOrigin` 확장**(`packages/shared/src/content/content.ts`, EVAL-ROUND-14 J-13/D14-4) | **M(6파일**: schema.prisma 1 + resident-links 컨트롤러·서비스 2(검수 게이트 전이 가드 포함) + 단위 테스트 1(D13-2) + app.module.ts 1 + `packages/shared/src/content/content.ts` 1(`ContentOrigin` 확장 — **공용 자산 G3 SOLO 대상**, 게이트③ 루트 회귀 5종 규칙 적용 대상, EVAL-ROUND-14 D14-4) — 舊 5파일에서 상향, **버킷 불변(M)**이라 웨이브·E4 재계산 불요) | Wave 5 |
| **7** | T-W2-13 **[SOLO]** | 단독 — Prisma 마이그레이션(미성년자 필드) | **S(2파일**: schema.prisma 1 + 전이 가드 1 — EVAL-ROUND-10 P-11 확정, E2 §C 총계와 등식 성립) | Wave 6(동일 스키마 파일, 순차 필수) |
| **8a** | T-W1-07b, T-W1-03, T-W2-10 | **구독자 재생 컴포넌트는 T-W1-03 단독 소유 — 계측 배선은 T-W1-07a로 분리해 Wave 12로 이동(DD1, EVAL-ROUND-2 영역4 감점1·Y-13 정정)**. **舊 Wave 8은 T-W1-04를 포함한 4건이었으나 EVAL-ROUND-6 D6-1(`pnpm-lock.yaml` 준-공용 자산, 신규 의존성 추가 태스크 웨이브당 1건)이 T-W1-03+T-W1-04 동시 배치를 위반으로 적발 — T-W1-04를 Wave 8b로 재배치했다(웨이브 구성 변경, E4 재계산 후행)**: `apps/reporter` 이벤트훅+업로드위저드/모드선택 호출배선+단위테스트(T-W1-07b, D6-5 보정으로 4파일) vs `apps/subscriber/app/live/[id].tsx`(T-W1-03, 재생 컴포넌트 수정 + **재생 실패 폴백 UI**, EVAL-ROUND-14 D14-1/J-6)+`apps/subscriber/app/(tabs)/index.tsx`(OG메타 + **홈화면 추가 배너·카톡 웹뷰 감지**, D14-1)+`apps/subscriber/app/(tabs)/stations.tsx`(OG메타)+`apps/subscriber/app/watch/[id].tsx`(**VOD 재생 실패 폴백 UI 골격**, D14-1 — T-W1-07a(Wave 12)가 이후 계측 배선 추가)+`apps/subscriber/package.json`(신규 의존성 hls.js — D6-1) vs `services/api/src/media/*`(공개렌디션, api 모듈 신설 아님 — 기존 media 모듈 확장이라 `app.module.ts` 무편집) — 3개 상호 배타, **신규 의존성 추가 태스크는 T-W1-03 1건뿐**(D6-1 준수), qa-verifier 여유 슬롯 2개 | **M+L+S**(T-W1-07b=4파일 M·T-W1-03=7파일 **L**(舊 6파일에서 `watch/[id].tsx` 추가로 상향, EVAL-ROUND-14 D14-1, **M→L**)·T-W2-10=3파일 S) | Wave 5(T-W1-03은 T-W1-02 후) |
| **8b** | T-W1-04 | **D6-1 재배치 대상**: `apps/subscriber/src/pwa/register-service-worker.ts`+`apps/subscriber/public/sw.js`(신규)+`apps/subscriber/app/_layout.tsx`(SW 등록 호출 — 수정)+`apps/subscriber/package.json`(신규 의존성 Workbox — D6-1) — 단독. 파일 집합은 8a의 어느 태스크와도 겹치지 않아(동일 앱이나 배타, EVAL-ROUND-5 U-11 확인) 순수 파일소유권 기준으로는 8a와 병렬 가능했으나, **`pnpm-lock.yaml` 동시성 1 규칙(D6-1)이 T-W1-03(8a)과의 동시 배치를 금지**해 별도 웨이브로 분리했다(SOLO 아님 — G3 사유가 아니라 준-공용 자산 동시성 1 사유, "SOLO 승격 불요" D6-1 문구 그대로) | **M(4파일**: register-service-worker.ts+sw.js+_layout.tsx+package.json — 舊 3파일 S에서 D6-1 반영 상향) | Wave 8a(파일 집합 자체는 배타, lockfile 동시성 1로 순차 배치만 필요) |
| **8c** | T-W1-11c **[SOLO]** | (신설 — EVAL-ROUND-22 X2-1(1차)/D22-1) 단독 — `.github/workflows/deploy-web.yml`(신규, 웹 배포 워크플로: 웹 export 빌드→번들 예산 게이트→정적 산출물 배포→D-T5 4항 CF 캐시 퍼지(D22-2 이관 수령) — G3 사유: CI 설정(`.github/workflows`) 변경. T-W1-11b·T-W2-17·T-W4-02의 `ci.yml`과는 **별개 파일**이라 동일 파일 순차 편집 제약은 없으나 CI 설정 SOLO 관례 동형 적용). **배치 근거**: 선행 2건(T-W0-03=Wave 2·T-W1-03=Wave 8a, D22-1 확정) 직후의 최초 가능 지점 — T-NC-05(TTFF 실기기 실측)·T-NC-06(go. 링크 실기 확인)이 Wave 8a 종료 후 개시되므로 그 실측이 딛는 웹 배포 수단을 W1 DoD 실측 개시 시점에 공급한다(D22-1 근거 "W0·W1 DoD 배포 수단 공백 해소" 이행). **삽입 제약 3건 준수(D22-1)**: ① 기존 라벨 재번호 0(접미 문자 라벨 8c) ② 선행(Wave 2·8a) 이후 ③ 앵커 ⑮ 집합 {2·4·5·9·12} 불변 — 부수로 **"W1 코드 종료(Wave 13b)" 이원 선언도 불변**(8c<13b라 W1 라벨 최종 완료 지점이 안 바뀌어 동기 갱신 조건 미발동) | **S**(1파일 — E2 §C "총 1파일"과 등식 성립, 앵커 ⑦ 대조 입력) | Wave 2(T-W0-03 nginx `web` 컨테이너)·Wave 8a(T-W1-03 웹 export 빌드 실증). **실배포 스텝 활성은 T-NC-02 ②(제온 노출 방식)·G9 ①(도메인) 확정 후**(T-W0-03 N-1 문안 준용, §F ①·② 우회 경로 참조 — 워크플로 작성·문법 검증은 비차단, 신규 상신 종점 아님(앵커 ⑭ 불변)) |
| **9** | T-W1-09, T-W1-10, T-W2-09, T-W2-03 | **`apps/subscriber/app/support.tsx`(문의하기, 신규) vs `apps/subscriber/app/schedule.tsx`(편성표, 신규) vs `apps/subscriber/app/upload/[token].tsx`(주민링크 프론트, 신규, T-W2-08 소비)+`infra/docker/nginx.conf`(수정, `/upload/:token` SPA 폴백 1줄 — 준-공용 주의, EXEC-DECISIONS #6/D6-2. T-W0-03(Wave 2)·T-W1-06(Wave 4)과는 웨이브가 달라 동시 편집 충돌 없음)+**`apps/subscriber/app/_layout.tsx`(수정 1, 준-공용 자산 4 — D12-1)** vs `apps/reporter/`(촬영/업로드 화면, T-W2-02 후속)** — T-W2-09의 소속 앱이 `apps/subscriber`로 확정됨에 따라(EVAL-ROUND-3 영역3·4 Z-8 정정, E2 §C 참조) 이 웨이브의 배타는 **subscriber 3건(경로 상호 배타) + reporter 1건(다른 워크스페이스)** 구조다 — subscriber 3건은 전부 신규 라우트 파일이라 상호 배타, reporter 1건은 워크스페이스 자체가 달라 자동 배타. **준-공용 자산 4(`app/_layout.tsx`) 판정(EVAL-ROUND-12 D12-1/M-7)**: E2 리포 실측 결과 T-W1-09·T-W1-10은 옵션 불요(소유권 불포함), T-W2-09만 옵션 필요(1건) — "1건이면 재배치 불요"(D12-1) 조건 충족, Wave 9는 이 파일을 만지는 태스크가 T-W2-09 1건뿐이라 동시성 1 규칙 자동 충족(**웨이브 재편 불요**). 4개 상호 배타, qa-verifier 1슬롯 확보 | **S+S+M+S**(T-W1-09=2파일·T-W1-10=1파일·**T-W2-09=4파일(舊 3파일에서 `_layout.tsx` 1줄 추가로 상향, D12-1 — S→M 버킷 변경)**·**T-W2-03=3파일(舊 2파일에서 IndexedDB 초안 보존 유틸 추가로 상향, EVAL-ROUND-14 D14-1/J-6 — 버킷 불변 S)**) | Wave 6(T-W2-09는 T-W2-08 후), Wave 5(T-W2-03은 T-W2-02 후), **T-NC-03 PoC 합격 필수**(아래 §D, EXEC-DECISIONS #2) |
| **10** | T-W2-11, T-W2-12, T-W2-15 | 라이브 상품카드+**링크아웃 클릭 계측 발신 훅**(신규, EVAL-ROUND-16 G-1/D16-3) vs `services/api/src/telemetry/*`(T-W1-08 모듈 확장, 클릭 엔드포인트만 추가) vs `services/api/src/live/*`(CF Stream 신규 연동) — 3개 상호 배타, qa-verifier 1슬롯 확보(**T-W1-11a 제거로 여유 슬롯 1개 증가 — EVAL-ROUND-17 F-11/D17-1, 아래 Wave 13a 참조**) | **S×3**(**T-W2-11=3파일**(舊 2파일에서 `use-linkout-click.ts` 추가로 상향, EVAL-ROUND-16 G-1/D16-3 — 버킷 불변 S)·T-W2-12=1파일·T-W2-15=2파일) | Wave 8a·8b, **T-NC-20(CF Stream 실계정 개설) 완료 + G9 ③ 확인 후**(EVAL-ROUND-20 Z2-6 — Wave 16의 T-NC-08 표기와 동형, §D T-NC-20 행 인용. T-W2-15가 이 웨이브 소속이라 §C 표만 보고 편성 시에도 게이트가 보이도록 병기) |
| **12** | T-W1-07a, T-W2-14, T-W2-16a, **T-W2-18**(EVAL-ROUND-14 D14-1/J-6 신설 편입) | **T-W1-07a 삽입(DD1, Y-13 — Wave 8(현 8a)에서 이동)**: `apps/subscriber` **`watch/[id].tsx`**(정정 소유 — EVAL-ROUND-14 D14-4/J-2, 02§E-16① 계측 실 발생 지점. 舊 `live/[id].tsx` 단독 소유는 잘못된 파일이었다)+`live/[id].tsx`(라이브 재생시작·조회집계만) 호출 지점 배선+단위테스트(D6-5 보정, T-W1-03 산출물인 폴백 UI 골격 소비, Wave 8a 완료 후) vs `apps/reporter` 콘텐츠 등록 폼(`classify.tsx`, T-W2-13 소비, T-W2-03과 분리) vs `services/api/src/live/*`(CF Stream webhook, D6 분할 BE분) vs **`apps/reporter/app/(app)/contents/new/scenes.tsx`+`src/features/SceneOrderChecklist.tsx`(T-W2-18, D14-1 신설 — `classify.tsx`(T-W2-14)와 다른 파일이라 reporter 내에서도 배타)** — 4개 상호 배타, qa-verifier 1슬롯 확보(舊 3건 미만 여유는 T-W2-18 편입으로 소진) | **M+S+S+S**(T-W1-07a=4파일 M(舊 3파일 S에서 상향, EVAL-ROUND-14 D14-4/J-2 — `watch/[id].tsx` 추가)·T-W2-14=1파일·T-W2-16a=1파일·**T-W2-18=2파일**(D14-1 신설)) | Wave 8a(T-W1-07a는 T-W1-03 후), Wave 7(T-W2-14), Wave 10(T-W2-16a는 T-W2-15 후). **정정(EVAL-ROUND-17 F-11/D17-1)**: 舊 "W1 종료 웨이브(T-W1-07a가 W1의 마지막 미배정 태스크였다)"는 T-W1-11a·11b가 Wave 13a·13b로 재배치되며 사실 오류가 됐다(이제 W1 라벨 태스크 중 가장 늦게 완료되는 것은 Wave 13b의 T-W1-11b다). **본 웨이브가 유지하는 것은 "앵커2(W1 DoD) 판정 시점"뿐**이다 — 08§A 원문 W1 DoD는 TTFF(①)+go. 링크 미리보기·상세 렌더(②) 2항목만 요구하고(T-NC-05·06이 소유, 각각 Wave 8a 종료 후 판정 가능), T-W1-11a(E2E 시나리오)·T-W1-11b(CI installability)는 이 DoD 판정 기준에 포함되지 않는다(§D T-NC-05·06 행 참조 — 두 게이트의 실질 기점은 이미 Wave 8a였고 본 웨이브 변경과 무관) |
| **13a** | T-W2-05, T-W2-16b, T-W1-11a | (舊 "Wave 13"에 T-W1-11a 편입 — EVAL-ROUND-17 F-11/D17-1) `apps/reporter` 테마소비(20파일, T-W2-03·14 정착 후) vs `apps/control-center/src/live/*`(상태 조회 UI, D6 분할 FE분, T-W2-16a 후) vs **`apps/subscriber` Playwright 구독자 시나리오**(`playwright.config.ts`+시나리오+`package.json` 신규 의존성 Playwright — D6-1, T-W1-11a, EVAL-ROUND-17 F-11/D17-1로 Wave 10에서 재배치 — `T-W1-07a ─ T-W1-11a`(자막토글 UI 선행) 엣지 신설 반영) — 3개 앱 워크스페이스 상호 배타, **lockfile 갱신 태스크는 T-W1-11a 1건뿐**(D6-1 준수, Wave 13a에서 유일 — EVAL-ROUND-23 W2-6 앵커 ⑯ 부착, **EVAL-ROUND-25 K2-1/D25-1로 2단 재현으로 보강**(舊 재현은 계획 자신의 소유권 선언만 검사해 실체와의 괴리를 못 잡았다 — 그 사각이 K2-1이었다): ① **문서** = §B "7종 전건 웨이브 배치 재검증" python 블록 출력에서 라벨 `13a`가 **정확히 T-W1-11a에만** 붙고 lockfile 2건 이상 웨이브 목록이 비어 있음 ② **리포 실체** = T-W2-05가 소비할 `@gachinol/ui` 선언은 본 웨이브가 아니라 T-W1-01(Wave 3) 소유임을 E2가 명시 — `grep -c "^. T-W2-05 .*소유가 아니다" docs/plan/exec/E2-work-breakdown.md` → ≥1, 그리고 그 선언이 실제로 필요한 형태임은 `python3 -c "import json;print([k for k in json.load(open('apps/reporter/package.json'))['dependencies'] if 'gachinol' in k])"` → `['@gachinol/shared']`(같은 `workspace:*` 형식의 선행 사례)로 재현), qa-verifier 1슬롯 확보 | **XL(T-W2-05, 21파일 — `theme.ts` 삭제 1+소비파일 20)**+**S**(T-W2-16b=2파일 — Z-10 전건 재판정, 舊 M은 버킷 정의 미적용)+**S**(T-W1-11a=3파일 — 버킷 불변, EVAL-ROUND-17 F-11/D17-1로 Wave 10에서 이전) | Wave 12(T-W2-14 정착, T-W2-16a 완료 — **T-W1-11a도 이 조건으로 충족**: 자막토글 UI(T-W1-07a)가 Wave 12 산출물이므로 Wave 13a 착수 자체가 이미 그 선행을 만족한다), Wave 8a·8b(T-W1-11a는 T-W1-03·04 완료 필요 — 이미 Wave 12보다 이전에 종료) |
| **13b** | T-W1-11b **[SOLO]** | (신설 — EVAL-ROUND-17 F-11/D17-1) 단독 — `ci.yml`(CI 설정, D6 분할 — installability·번들예산게이트·**Lighthouse CI 게이트**(EVAL-ROUND-21 Y2-1 편입, 구독자 앱 한정). **CF퍼지 CI 스텝은 EVAL-ROUND-22 D22-2로 T-W1-11c(`deploy-web.yml`, Wave 8c) 이관**). **재배치 사유**: T-W1-11a가 Wave 10→13a로 이동함에 따라 그 완료를 요구하는 T-W1-11b(SOLO)도 연쇄 재배치(舊 Wave 11 라벨은 폐지 — 아래 §G 재검산에서 라벨 총수 확인) | **S**(1파일 — EVAL-ROUND-3 영역4 감점2·Z-10 전건 재판정 그대로 승계. CI 게이트 **3종**(EVAL-ROUND-21 Y2-1로 3종→4종 → **EVAL-ROUND-22 D22-2로 CF 퍼지 스텝 이관, 4종→3종** — required 분류는 E2 T-W1-11b 산출물 열이 정본. Lighthouse 임계값은 `lhci` CLI 플래그로 인라인 지정 — 별도 config 파일 신설 없음)이 동일 파일(`ci.yml`) 안에서 이뤄지는 편집이라 파일 수는 여전히 1, 버킷 S 불변 — E4 재계산 불요) | Wave 13a(T-W1-11a 완료 필요) |
| **14** | T-W2-06 | `apps/control-center` 테마소비(16파일, T-W2-04·16b 정착 후) — 단독(병렬 대상 없음). **lockfile 갱신 태스크 0건**(**앵커 ⑯ 2단 재현, D25-1**: ① 문서 = §B 재검증 python 블록 출력에 라벨 `14`가 등장하지 않는다 ② 리포 실체 = `@gachinol/ui` 선언은 T-W1-01(Wave 3) 소유임을 E2가 명시 — `grep -c "^. T-W2-06 .*소유가 아니다" docs/plan/exec/E2-work-breakdown.md` → ≥1) | **XL(T-W2-06, 17파일 — `theme.ts` 삭제 1+소비파일 16)**(E4 §A-5 XL 버킷 인용, Y-7 정정) | **Wave 13b**(T-W2-16b는 13a 소속이나 T-W1-11b가 SOLO라 시스템 전체 정지 — Wave 14는 파일 의존(T-W2-16b, 13a)과 SOLO 통과(13b) 양쪽 다 만족해야 착수, EVAL-ROUND-17 F-11/D17-1 — 舊 "Wave 13"), Wave 5(T-W2-04) |
| **15a** | T-W2-07 | 단독(다른 W2 태스크 전건 완료가 전제라 병렬 대상 없음, **舊 "Wave 15" — EVAL-ROUND-8 D8-1로 15a·15b 분리**). **D7-2 판정(EVAL-ROUND-7 Q-9)**: T-W2-07이 `apps/{reporter,control-center}/package.json`(`@playwright/test`) 소유로 확정되며 신규 의존성 추가 태스크가 됐다 — `pnpm-lock.yaml` 준-공용 자산 동시성 1 규칙(D6-1) 위반 여부 판정 결과 **위반 없음**(Wave 15a는 T-W2-07 1건뿐이라 "웨이브당 1건" 규칙이 자동 충족, 재배치 불요) | **L(7파일**: `playwright.config.ts` 2 + 시나리오 스펙 2(관제·기자 각 1) + 스모크 스펙 1 + `package.json` 2(관제·기자, D7-2 신규 의존성) — EVAL-ROUND-7 Q-7·Q-9 반영, 舊 M(5파일)에서 상향, E4 §A-6 Wave 15a 재계산 후행) | Wave 4~14 전건(관제·기자 기능 완결 필요) |
| **15b** | T-W2-17 **[SOLO]** | 단독(**EVAL-ROUND-8 D8-1/EXEC-DECISIONS #7 신설**) — `.github/workflows/ci.yml`(CI 설정, T-W1-11b·T-W4-02와 동일 파일 순차 편집 — G3) | **S**(1파일: `ci.yml` — 02§E-9 완료 정의 "CI 자동 실행" 요소를 태스크에 결박, 웹 E2E 잡을 비필수 자동 실행으로 등재) | Wave 15a(T-W2-07 완료 필요 — 시나리오·스모크 존재해야 CI 잡이 실행할 대상이 있다) — **W2 종료 웨이브**(舊 "Wave 15", D8-1 재편 반영 — 02§E-9의 "CI 자동 실행" 요소가 이 웨이브 완료로 비로소 충족되므로 W2 종료 마커가 15a→15b로 이동) |
| **16** | T-W3-01 **[SOLO]** | 단독 — Prisma 마이그레이션(`PushSubscription`) + `app.module.ts` 등록 + `services/api/package.json`(신규 의존성 web-push — D6-1) | **L(7파일**: schema.prisma 1 + push 모듈 4 + app.module.ts 1 + package.json 1 — EVAL-ROUND-6 D6-1 반영, 舊 M(6파일)에서 상향, E4 재계산 후행) | **Wave 13b(W1 코드 종료) + T-NC-08(스토어 계정 개설) 완료**(08§A W3 선행조건 원문 그대로 — EVAL-ROUND-4 영역1 감점4·V-4 정정, D4-3 확정. 舊 "08§A W3 선행조건은 W1만 요구"는 정본이 명시한 "W1 + 스토어 계정 개설 완료" 결합 조건을 W1 단독으로 오인용한 것이었다. **EVAL-ROUND-18 V2-1 정정(앵커⑥)** — 08§A가 요구하는 "W1(구독자 웹 안정)"의 **DoD 판정 기점은 앵커2(W1 DoD, Wave 12 종료 보고)**이며 **코드 종료 기점은 Wave 13b**다(D17-1로 T-W1-11a·11b가 Wave 13a·13b로 재배치되며 W1 라벨 태스크 **14건**(EVAL-ROUND-22 D22-1로 T-W1-11c 신설 13→14 — Wave 8c 완료라 최종 완료 지점(13b) 불변) 전체의 마지막 완료 지점이 Wave 12→13b로 이동, W0의 "코드 종료(Wave 4)/DoD 판정 기점(Wave 2)" 이원 선언과 동형 구조). 舊 "Wave 12(W1 종료)" 단일 표기는 Wave 12 셀 자신의 격하 선언("이제 W1 라벨 태스크 중 가장 늦게 완료되는 것은 Wave 13b")과 모순됐다. 단 T-NC-08은 사용자 의존 외부 리드타임이라 **코드 선행 준비(Wave 16·17a·17b)는 §F G9 우회 경로와 동형으로 로컬 검증 범위 내 가능하며, 실제 하드 차단은 T-NC-10(스토어 제출 행위)뿐**이다 — 08§D 승인 지연 완화책 준용) |
| **17a** | T-W3-02 | `apps/{reporter,control-center,subscriber}/web/manifest.json`(신규 3) + `apps/{reporter,control-center}/src/pwa/register-service-worker.ts`(신규 2) + **`apps/{reporter,control-center}/public/sw.js`(신규 2, Workbox — T-W1-04 산출물과 동형)** + **`apps/{reporter,control-center}/app/_layout.tsx`(수정 2, SW 등록 호출 지점 — 준-공용 자산 4, T-W1-04와는 Wave 8b vs 17a로 시점 분리돼 안전)**+ **`apps/{reporter,control-center}/package.json`(수정 2, Workbox 의존성 — EVAL-ROUND-25 K2-1 동형 확정)**(EVAL-ROUND-12 D12-2/M-6, E2 §C 예상 경로 참조). **lockfile 갱신 태스크는 T-W3-02 1건뿐**(D6-1 준수 — 본 웨이브가 단독 배치라 정의상 충족. **앵커 ⑯ 2단 재현**: ① 문서 = §B "8종 전건 웨이브 배치 재검증" python3 블록 출력에서 라벨 `17a`가 T-W3-02에만 붙고 2건 이상 웨이브 목록이 비어 있음 ② 리포 실체 = 같은 Workbox 이식의 subscriber분을 T-W1-04가 자기 앱 `package.json` 소유로 이미 명시 — `grep -c "^. T-W1-04 .*Workbox 신규 의존성" docs/plan/exec/E2-work-breakdown.md` → ≥1) — 단독(**D4-5, V-7 — 02§E-10 순서 선언에 따라 T-W3-03의 선행으로 분리**, EVAL-ROUND-4 영역4 감점1 정정. 舊 Wave 17은 3건 병렬로 이 순서를 근거 기록 없이 평탄화했었다) | **L(11파일**: manifest 3 + `register-service-worker.ts` 2(reporter·control-center) + `public/sw.js` 2(reporter·control-center) + `app/_layout.tsx`(SW 등록 호출 지점) 2(reporter·control-center) + **`package.json` 2(reporter·control-center, Workbox 의존성 — EVAL-ROUND-25 K2-1 동형 확정(조율자 판정), 舊 9파일에서 상향)** — **버킷 L(7~11) 불변이라 E4 §A-6 Wave 17a 예산은 무변경**(9→11 둘 다 L 정의역 안. 다만 본 셀의 舊 9파일 리터럴을 계수해 재현 주장으로 삼던 E4 §G #6은 값 박제 없는 형태로 전환 필요 — A팀 수신 위임 #6. 그 문자열은 여기 재생산하지 않는다). EVAL-ROUND-12 D12-2/M-6 확정. 舊 "M(5파일)"은 기자·관제의 서비스워커 본체(`sw.js`)·호출 지점(`_layout.tsx`) 4파일을 누락해 "SW 3종" DoD가 닫히지 않는 상태였다(subscriber는 T-W1-04가 이미 4파일로 완결 소유 — 동형 완결)) | Wave 16 **+ T-W1-11b installability 구조 검사 상태 확인**(EVAL-ROUND-22 22B X2-1/D22-8 결박 — 02§C Installability 행 미달 시 조치 "FAIL 시 TWA/iOS 쉘 패키징(§E 10번) 착수를 자동 차단 … **재검사까지 W3 일정 보류**": FAIL 상태면 본 웨이브를 포함한 W3 잔여 일정을 재검사 통과까지 보류한다. 舊 exec 전 문서에 이 정본 조치의 결박이 0건이었다 — 하드 차단 대상은 패키징 2건(아래 17b 선행 열)이며 본 열은 "W3 일정 보류" 문언 몫) |
| **17b** | T-W3-03, T-W3-04 | `infra/shell/twa/*`(Bubblewrap, 별도 프로젝트, T-W3-02 산출물(manifest) 소비) vs `infra/shell/ios/*`(별도 프로젝트, T-W3-02와 무관하나 같은 웨이브로 재편) — 2개 상호 배타 | **S+L**(T-W3-03=2파일 S / T-W3-04=3파일이나 L 유지, 정당화: E4 §A-5가 "가정치 3파일 → 실제 Xcode 프로젝트 골격은 보일러플레이트 동반으로 확장 가능성" 근거로 이미 명시 정당화해 둔 예외 — DDD1이 지목한 유일한 정당 예외) | Wave 17a(T-W3-02 완료 — manifest 소비), Wave 16(웹푸시 토큰수신 API 필요), **T-W1-11b installability 구조 검사 PASS**(EVAL-ROUND-22 22B X2-1/D22-8 결박 — 02§C "FAIL 시 TWA/iOS 쉘 패키징(§E 10번) 착수를 자동 차단"의 직접 대상이 본 웨이브의 T-W3-03·04다(D22-2 분류: 비필수 게이트이되 **T-W3-03·04 착수 선행조건** — E2 T-W1-11b 산출물 열 required 표기 정본 인용). FAIL 시 재검사 통과까지 착수 하드 차단) |
| **18** | T-W4-01, T-W4-03 | `CLAUDE.md` + `docs/ROADMAP.md` + `docs/` 하위 네이티브 잔재 서술(T-W4-01, **D10-3 편입** — 대상은 착수 시점 재실측) vs `reviews/dod-evidence/w4/maintenance-savings-report.md`(신규 실측 리포트 문서, T-W4-03, 경로 전체는 `docs/plan/exec/reviews/dod-evidence/w4/...`로 **`docs/` 하위**다) — 2개 상호 배타. **배타 근거는 "`docs/` 밖"이 아니라 스윕 범위 제외다**: T-W4-01의 D10-3 판정 명령①(`grep -rn "expo-env\.d\.ts\|EAS Build" CLAUDE.md docs/ --exclude-dir=exec`)이 **`--exclude-dir=exec`로 `exec/` 하위 전체를 스캔 범위에서 제외**하므로 T-W4-03 산출물(`docs/plan/exec/reviews/...`)은 애초에 스윕 대상 밖이라 배타가 성립한다(舊 "`docs/` 밖" 서술은 경로가 실제로는 `docs/` 하위임에도 밖이라 적은 사실 오류 — EVAL-ROUND-14 J-14/D14-4 정정. EVAL-ROUND-11 N-4의 "D10-3 편입 반영" 정정 이력은 유지) | **S+S**(T-W4-01=2파일·T-W4-03=1파일, EVAL-ROUND-11 N-3 반영 — 재실측 상향 시 동반 재판정, D10-3 개방 소유권의 앵커 ⑦ 대조 입력) | Wave 15b(W2 종료 — EVAL-ROUND-8 D8-1 반영, 舊 "Wave 15"), **Wave 17b**(W3 종료 — D4-5 재편 반영, 舊 "Wave 17"), **T-NC-10 스토어 심사 통과**(08§A W4 선행조건 "W1~W3") |
| **19** | T-W4-02 **[SOLO]** | 단독 — `ci.yml`(웹 E2E 필수 게이트 전환) | **S(1파일**: `ci.yml` — EVAL-ROUND-12 M-8 확정, E2 §C 총계와 등식 성립) | Wave 18 — **W4 종료 웨이브(전 태스크 마감)** |

**사이징 라벨 전건 재판정(DDD1, EVAL-ROUND-3 영역4 감점2·Z-10)**: 43개 코드 태스크 전건을 E2 §C 파일 소유권 열의
파일 수로 재판정했다(라운드 2가 Wave 2에만 적용했던 것과 동일 절차를 나머지 웨이브로 확장). **변경 23건**
(전건 하향 — Wave 3·4·5·8·9·10·11·12·13·17b의 해당 셀), **불변 20건**(파일 수가 이미 정확했던 셀), **정당 예외
1건**(T-W3-04, Wave 17b — "가정치 3파일이나 확장 가능성" 근거로 L 유지, E4 §A-5 기존 정당화 인용). 위 웨이브 표의
각 변경 셀에 舊 라벨·새 라벨·파일 수 근거를 인라인 각주로 남겼다 — 상세 웨이브별 舊→新 대조표는 완료 보고에
동봉(A팀의 E4 §A-6 재계산 입력). 방향은 전부 보수적(하향)이므로 200만 상한 판정이 뒤집힐 가능성은 낮다.

**웨이브 재편(D4-5, EVAL-ROUND-4 영역4 감점1·V-7)**: Wave 17(舊, T-W3-02·03·04 3건 병렬)을 **17a(T-W3-02
단독)→17b(T-W3-03·04 병렬)**로 순차 재편했다 — 02§E-10의 "manifest/SW → TWA → iOS 쉘" 순서 선언을 §A 의존
엣지로 반영한 결과다. 웨이브 **라벨** 수는 19→**20**으로 늘지만(17이 17a·17b 2개로 분리), 태스크 배정 43건
자체는 불변이다(신규 태스크 추가 아님 — 기존 3건이 1+2로 순차 재편됐을 뿐).

**웨이브 재편 2(D6-1, EVAL-ROUND-6 W-3 — `pnpm-lock.yaml` 준-공용 자산 동시성 1 위반 해소)**: Wave 8(舊, T-W1-07b·
T-W1-03·T-W1-04·T-W2-10 4건 병렬)이 T-W1-03(hls.js)과 T-W1-04(Workbox)를 동시에 배치해 "신규 의존성 추가
태스크는 웨이브당 1건" 규칙을 위반했다(D6-1 확정). **T-W1-04를 8b로 재배치**해 **8a(T-W1-07b·T-W1-03·T-W2-10
3건)→8b(T-W1-04 단독)**로 순차 재편했다 — T-W1-03·T-W1-04는 파일 소유권 자체는 배타(동일 앱 `apps/subscriber`
이나 겹치는 파일 없음, EVAL-ROUND-5 U-11 재확인)라 병렬 배치를 막을 파일 충돌 근거는 없으나, lockfile
동시성 1 규칙이 별도로 순차 배치를 요구한다. **재배치 판단(D6-1 "E3 재량")**: T-W1-04가 아니라 T-W1-03을
옮기지 않은 이유 — ① T-W1-03은 **Wave 13a(T-W1-11a, EVAL-ROUND-17 F-11/D17-1 재배치 반영 — 舊 라운드6 시점
기재 "Wave 9"는 이후 라운드들의 재편으로 이미 stale이었다)**·Wave 12(T-W1-07a)·§D(T-NC-05·06)의 선행 조건이라
하류 의존이 T-W1-04보다 많아 자리를 옮기면 파급이 더 크다, ② T-W1-04는 **Wave 13b(T-W1-11b, SOLO, 舊 Wave 11
— 동일 정정)**의 선행 조건이라 **그 웨이브 이전 어느 웨이브에도** 배치 가능해야 하는데 Wave 9·10은 이미 구현
4건 상한(D3)에 도달해 있어(§C Wave 9·10 참조) 그 사이에 끼워 넣을 여유가 없다 — 새 웨이브(8b)를 신설하는 것이
D3 상한을 위반하지 않는
유일한 해법이었다. 웨이브 **라벨** 수는 20→**21**로 늘지만(8이 8a·8b 2개로 분리), 태스크 배정 43건 자체는
불변이다(신규 태스크 추가 아님). **E4 재계산 후행 필요**(D6-1 — T-W1-03·T-W1-04·T-W3-01 사이징 변경도 동반,
아래 §C 각 셀 각주 참조).

**정상 웨이브 코드 태스크 합계(EVAL-ROUND-22 지금 재실행한 출력으로 갱신 — D22-1의 Wave 8c(T-W1-11c) 신설
반영·정규식 `[abc]?` 확장. 앞선 전면 재작성 이력: EVAL-ROUND-17 — D17-1(F-11)의 T-W1-11a·11b
재배치(Wave 10→13a, 舊 Wave 11→13b, 라벨 11 폐지)를 반영. 아래는 §G와 **단일 총계**, Q1 원칙 — 실행 명령·
출력 인용, A팀 E4 §G #7 발주 반영. **EVAL-ROUND-18 V2-2 정정(앵커⑨)**: 이 블록이 舊 편성 문자열의 **부재**를
`grep -c → 0`으로 주장했으나, 본문(이 문단·아래 웨이브별 분포 서술)이 그 문자열을 회고 인용으로 재생산해
실제 재실행 결과는 0이 아니었다(자기 매칭 — D6-4·D15-3이 이미 종결한 실패 유형의 3회차 재발). **D15-3
형식으로 전환**: 부재 주장 대신 **현행 문자열의 존재만 재현**한다 — 회고 인용을 포함한 자기 매칭은
존재 판정(≥1)에서는 오히려 무해하다(더 많이 매칭돼도 "존재한다"는 참인 채로 유지되므로))**:

**실행 컨텍스트**(C팀 위임 #26 수신 — 앵커 ⑨ cwd 판정 항목의 §C 적용): 아래 블록은 **리포 루트**에서 그대로
재실행한다 — 파일 인자를 **전체 경로**(`docs/plan/exec/…`)로 표기해 §B python 블록·§G 검산 블록과 통일했다.
**위 괄호 안의 과거형 회고 기록**(舊 부재 주장 `grep -c → 0`, 舊 정규식 `[ab]?` 이력 등)**은 재실행 대상이
아니다** — 그 시점 상태의 이력이지 현행 재현 주장이 아니므로 cwd 판정·출력 대조 양쪽에서 제외한다(C팀 신설
규칙의 회고 제외 조항). 재실행 대상은 아래 `$` 5줄이다.

```
$ grep -E "^\| \*\*[0-9]+[abc]?\*\* \|" docs/plan/exec/E3-parallel-schedule.md | awk -F'|' '{print $3}' | grep -oE "T-W[0-4]-[0-9]+[abc]?" | wc -l
46
$ grep -E "^\| \*\*[0-9]+[abc]?\*\* \|" docs/plan/exec/E3-parallel-schedule.md | awk -F'|' '{print $3}' | grep -oE "T-W[0-4]-[0-9]+[abc]?" | sort -u | wc -l
46
$ grep -cE "^\| \*\*[0-9]+[abc]?\*\* \|" docs/plan/exec/E3-parallel-schedule.md
23
$ grep -E "^\| \*\*[0-9]+[abc]?\*\* \|" docs/plan/exec/E3-parallel-schedule.md | awk -F'|' '{n=gsub(/T-W[0-4]-[0-9]+[abc]?/,"&",$3); print $2, n}'
 **1** 1 / **2** 4 / **3** 1 / **4** 4 / **5** 4 / **6** 1 / **7** 1 / **8a** 3 / **8b** 1 / **8c** 1 /
 **9** 4 / **10** 3 / **12** 4 / **13a** 3 / **13b** 1 / **14** 1 / **15a** 1 / **15b** 1 / **16** 1 /
 **17a** 1 / **17b** 2 / **18** 2 / **19** 1        (합계 46, 최대 4 — D3 위반 0)
$ grep -c "10(3)+13a(3)+13b(1)" docs/plan/exec/E3-parallel-schedule.md
(존재 재현 — ≥1이면 성립, 정확한 회수는 자기 매칭 포함이라 계수하지 않는다. D15-3 형식)
```

(총 출현 46 = 고유 46 → 중복 0건. 웨이브 **행**은 **23**(**EVAL-ROUND-22 D22-1 — Wave 8c(T-W1-11c [SOLO])
신설로 22→23**; 22는 EVAL-ROUND-8 이후 라운드 21까지 불변이었다 — EVAL-ROUND-14의 T-W2-18은 기존 Wave 12
여유 슬롯에 편입, EVAL-ROUND-17의 T-W1-11a·11b 재배치는 라벨 11 폐지 + 13→13a/13b 분리로 라벨 수가 상쇄).
"태스크" 열만 추출 — `선행 웨이브` 열의 참조성 재언급은 별도 열이라 이 카운트에 섞이지 않는다.
**EVAL-ROUND-22 재검증 각주**: 신설 라벨 `8c`·ID `T-W1-11c`는 舊 정규식 `[ab]?`에 매칭되지 않는다(라벨 행은
아예 미계수, ID는 "T-W1-11"로 오추출) — 본 블록·§G의 전 재현 명령을 `[abc]?`로 확장 후 재실행했다(위 출력이
그 결과). E5 §D 앵커 측 동일 정규식 갱신은 E2 신규 위임 #7로 제출. **EVAL-ROUND-18 V2-2 부수 정리**: 아래
"웨이브별 분포" 문단은 舊 편성을 더 이상 고정 숫자 문자열로 인용하지 않는다(단어 서술로 대체) — 자기 매칭
근원을 본문에서 제거하는 쪽을 택해 향후 재발 자체를 구조적으로 막는다.)
웨이브별 분포: 1(1)+2(4)+3(1)+4(4)+5(4)+6(1)+7(1)+**8a(3)+8b(1)+8c(1)**+9(4)+10(3)+**12(4)**+**13a(3)+13b(1)**+14(1)+
**15a(1)+15b(1)**+16(1)+**17a(1)+17b(2)**+18(2)+19(1) = **46건**(E2 §C W0~W4 코드 태스크 합계
6+**14**+**19**+4+3=46과 일치, **EVAL-ROUND-22 D22-1 반영** — T-W1-11c(Wave 8c [SOLO]) 신설로 45→46·W1 13→14.
**EVAL-ROUND-17 F-11/D17-1 반영 이력 유지** — 舊 편성(10에 T-W1-11a 4번째로 포함,
별도 웨이브에 T-W1-11b 1건, 舊 13에 2건)이 10(3)+13a(3)+13b(1)로 재편(T-W1-11a·11b가 자막토글 UI 선행
엣지(`T-W1-07a ─ T-W1-11a`)를 만족하도록 Wave 13a·13b로 이동, 라벨 11 폐지 — 재편 전후 3웨이브 합 7건은
불변, 배치만 이동). W2 코드 태스크 18→19는 T-W2-18 신설(EVAL-ROUND-14, 불변 유지).
구현 동시 배정이 4건을 초과하는 웨이브 **0건**(모든 웨이브 태스크 열 ≤4, D3 편성 규칙 위반 없음 — 정확히
4건인 웨이브는 **Wave 2·4·5·9·12 5개**(EVAL-ROUND-17로 舊 6개(Wave 10 포함)에서 변경 — Wave 10이 4건→3건.
**EVAL-ROUND-22 Wave 8c 신설 후에도 이 집합 불변** — SOLO 1건 웨이브라 무영향, D22-1 제약 ③·앵커 ⑮ 준수),
qa-verifier 슬롯은 별도 확보 문구로 관리).

## D. 코드 외/트리거 태스크의 체크포인트 배치 (게이트 트랙)

E2 §D(트리거 대기 코드 3건)·§E(코드 외 **20건**, T-NC-13·14·15·16·17·18·19 포함(DD5·D6-3) + **T-NC-20**(EVAL-ROUND-19 R2-3 신설))는 동시성 상한이 적용되는 서브에이전트 웨이브가
아니라, 위 웨이브 사이에 삽입되는 **체크포인트**(사람·외부기관·수치 트리거 대기)다. 각 체크포인트는 정확히
하나의 웨이브 구간에 배치해 "어느 웨이브 전후에 걸리는가"를 명확히 한다. **예상 토큰 열은 D8 확정 잠정치를
인용**(QA 리드 orchestration 세션 = **5만/건** — 실기기 조작·패널 진행 자체는 사람 시간이라 토큰 비대상, E4
§A-2/§A-5와 단일 원천 공유).

| 체크포인트 ID | 배치 위치 | 배치 근거 | 예상 토큰(D8) | 하류 영향(막는 것) |
|---|---|---|---|---|
| T-NC-02(사용자 결정 3건) | Wave 1 착수와 동시 접수 개시, **상시 대기**(확인 전까지 로컬 코드 웨이브는 계속 진행, §A "W0 DoD 범위 한정" 참조) | 08§A W0 선행조건 | 5만(접수 세션) | 실제 대외 노출(T-NC-01 외부 접속 실측 포함)만 차단 — 나머지 전 웨이브는 비차단(EXEC-PLAN G9·08§D 리스크 완화책) |
| T-NC-01(W0 DoD 실측) | Wave 2 종료 직후 | 08§A W0 DoD | 5만 | 형식상 W0 "완료" 선언(§F Wave 종료 보고), Wave 3 자체는 비차단(E5§C 판정 절차는 병렬 진행 가능) |
| **T-NC-03(PoC)** | Wave 1~2 구간과 병행 개시, **Wave 5(T-W2-02) 착수 전 필수 완료**(EXEC-DECISIONS #2·D2 — 舊 "Wave 9만"은 §A 그래프(T-W2-02 포함)와 불일치하던 결함, X-6 정정) | EXEC-DECISIONS #2 "기자 촬영·업로드 트랙(§E 7번 계열 = T-W2-02 이후) 착수 전 완료" | 5만 | **Wave 5의 T-W2-02 + Wave 9의 T-W2-03**(舊 "Wave 9의 T-W2-03"만 서술해 T-W2-02가 누락돼 있었다 — 정정 완료) |
| T-NC-04(어르신 패널 1차) | **Wave 5(T-W1-01+T-W1-02 완료 = `packages/ui` 토큰 게이트 완료) 직후 ~ Wave 8a(export 스모크) 구간**(D4-4 확정 문안, EVAL-ROUND-4 영역1 감점5·V-5 정정 — 舊 "Wave 3(토큰 게이트)만으로 개방"은 02§E-1 "스키마 반영만으로는 이 게이트가 닫히지 않는다"·08§A 시간축 매핑 U3 "토큰 게이트 완료 → 패널 R1 순서 확정"과 어긋난 오인용이었다. 08§A 시간축 매핑표 "§E 1번 완료 직후"의 "1번"은 02§E-1의 완료 정의 2단(스키마+소비전환) 전체를 가리킨다. **EVAL-ROUND-6 D6-1 반영**: Wave 8이 8a·8b로 분리되며 export 스모크(T-W1-03)는 8a 소관 — 구간 종점 표기 갱신) | 08§A 시간축 매핑표 "W1 진행 중(§E 1번 완료 직후 ~ 4번 사이)" | 5만 | 없음(비차단, 정보 수집성) |
| T-NC-05(TTFF 실측) | Wave 8a 종료 후(EVAL-ROUND-6 D6-1 — T-W1-03 소재가 8a로 확정) | 08§A W1 DoD① | 5만 | **Wave 12** 종료 보고(W1 DoD 판정)의 근거 자료(DD3, Z-9 정정 — 舊 "Wave 11"은 W1의 마지막 태스크(T-W1-07a, Wave 12) 완료 전에 W1 DoD가 판정되는 정본 위반 상태였다) — Wave 9·10·13a·13b 자체 착수는 비차단(**EVAL-ROUND-17 F-11/D17-1 반영 — T-W1-11a·11b가 Wave 13a·13b로 재배치됐으나 08§A W1 DoD①②(TTFF·go. 링크)는 이 두 태스크를 요구하지 않아 Wave 12 판정 시점 불변**) |
| T-NC-06(go. 링크 캡처) | **Wave 8a 종료 후**(EVAL-ROUND-5 영역4 감점1·U-10 정정 — go. 라우트·nginx 동적라우트는 Wave 4에 이미 완료돼 캡처 "준비"는 선행 가능하나, 08§A W1 DoD②가 요구하는 "탭 후 리다이렉트→상세 화면 실제 렌더 확인" **판정**은 웹 빌드 산출물(T-W1-03, Wave 8a)이 있어야 성립한다. 舊 "Wave 4 종료 후, Wave 8과 병행 가능"은 §A 신설 엣지(`T-W1-03 ─ T-NC-06`)와 모순이었다. **EVAL-ROUND-6 D6-1**: Wave 8→8a 분리 반영) | 08§A W1 DoD② | 5만 | **Wave 12** 종료 보고(W1 DoD 판정)의 근거 자료(DD3, Z-9 정정) |
| T-NC-07(W2 실기기 완주) | Wave 15b 종료 후(EVAL-ROUND-8 D8-1 반영, 舊 "Wave 15 종료 후" — 08§A W2 DoD "CI 자동 실행" 요소가 T-W2-17(15b)로 결박돼 실질 기점이 15a→15b로 이동) | 08§A W2 DoD | 5만 | 앵커 3(첫 실 방송, 04 소관·본 문서 비범위)의 전제 — Wave 16 착수는 비차단(W3는 "W1 안정"만 요구, 08§A) |
| T-NC-08(스토어 계정 개설) | Wave 1과 동시 개시(**Wave 16 착수 전 완료가 08§A W3 선행조건 정본** — EVAL-ROUND-4 영역1 감점4·V-4 정정, D4-3. 舊 "Wave 17 착수 8주 전"은 정본 선행조건을 T-NC-10 심사 제출 시점 기준으로만 역산해 W3 착수(Wave 16) 자체의 선행조건 위상을 놓쳤다. 리드타임(8주) 자체는 불변 — 08§E-1-1 "W3 착수 8주 전 개시") | 08§E-1-1 | 5만 | **Wave 16(정본 선행조건, D4-3)** — 단 코드 선행 준비(Wave 16·17a·17b)는 로컬 검증 범위 내 비차단, 실질 하드 차단은 T-NC-10(Wave 18 제출 행위)뿐 |
| T-NC-09(Meta App Review) | 사업자등록 완료 직후(외부 이벤트, 본 웨이브 그래프 밖) | 08§E-10 | 5만 | 04§H-1 R4(첫 실 방송 게이트, 본 문서 비범위) — W0~W4 어느 웨이브도 차단하지 않음 |
| T-NC-10(스토어 심사 통과) | **Wave 17b** 종료 후(舊 "Wave 17", D4-5 재편 반영), **Wave 18 착수 전 필수** | 08§A W4 선행조건 "W1~W3" | 5만 | Wave 18·19(W4 전체) |
| T-NC-11(클라우드 트리거 대시보드 리뷰) | Wave 15b 종료 후 상시(월 1회, 종료 없음)(EVAL-ROUND-8 D8-1 반영, 舊 "Wave 15") | 08§E-8 | 5만/회(반복) | 없음(비차단 상시 운영) |
| T-NC-12(커머스 2단계 리뷰) | Wave 15b 종료 후 상시(월 1회, 종료 없음)(EVAL-ROUND-8 D8-1 반영, 舊 "Wave 15") | 08§E-9 | 5만/회(반복) | 없음(비차단 상시 운영) |
| **T-NC-13(W4 DoD 실측, EVAL-ROUND-1 영역1 감점3·X-10 신설)** | Wave 19 종료 후 | 08§A W4 DoD(**판정 명령 = DD3 확정 문안, E2 T-NC-13과 동일 문안 — EVAL-ROUND-2 영역7 감점1·Y-5 정정**: 명령①`grep -rn "expo-env\.d\.ts\|EAS Build" CLAUDE.md docs/ --exclude-dir=exec`(정상서술 제외 단서 포함)+명령②`eas.json` 부재+워크플로/package.json EAS 잔재 0건) | 5만 | W4 "완료" 최종 선언(문서·CI 반영+네이티브 잔재 0 판정) — 본 항목이 없으면 §I 체크리스트의 "전 태스크 마감" 선언이 실측 근거 없이 이뤄진다 |
| **T-NC-14(방송별 HLS URL 게시 절차, EVAL-ROUND-2 영역1 감점2·Y-15 신설)** | Wave 9 종료 후(T-W1-10 완료) | 02§E-21(센터 운영 몫) | 5만 | 08§B 생존 매트릭스·04§B④ "라이브 신규 진입 완화책"의 실효성(정적 편성표 페이지만으로는 URL이 채워지지 않아 완화책이 작동하지 않음). **증적 경로 = `reviews/dod-evidence/broadcast-url-procedure/`**(DDD2 확정, EVAL-ROUND-3 영역1 Z-14 정정 — E5§C가 정본이라 그 경로를 인용, 舊 `ops-review.md`는 상시 리뷰 전용 경로를 1회성 절차 증적에 오적용한 것이었다) |
| **T-NC-15(PG 복구 리허설 분기 1회, EVAL-ROUND-2 영역1 감점3·Y-16 신설)** | Wave 2 종료 후 상시(분기 1회, 종료 없음) | 08§B "복구 리허설을 분기 1회" | 5만/회(반복) | 없음(비차단 상시 운영 — T-NC-11·12와 동일 성격) |
| **T-NC-16(패널 R2, EVAL-ROUND-6 D6-3 신설)** | **Wave 12 종료 직전**(T-NC-05·06 실측 완료 후, W1 DoD 판정 최종 확인 단계 — D6-3 "W1 DoD 충족 직전") | 08§A 시간축 매핑표 "런칭 직전 — 패널 R2(스테이징 빌드)"(03§B-1) | 5만 | **Wave 12** 종료 보고(W1 DoD 판정)의 근거 자료 1건 추가(비차단, 정보 수집성) |
| **T-NC-17(패널 R3, EVAL-ROUND-6 D6-3 신설)** | Wave 12 종료(W1 DoD 판정, 앵커 2) + 4주 경과 시점, **W2 구현 구간(T-W2-05 착수 ~ T-W2-17 완료)과 병행 가능·비차단**(D6-3 "W2·W3와 병행". **EVAL-ROUND-25 K2-5/D25-2 정정** — 舊 "Wave 13~15"는 **폐지·분리된 라벨을 포함한 범위 표기**였다: 라벨 13·15는 각각 13a/13b·15a/15b로 분리돼 단독으로 실재하지 않는다(재현: `grep -cE "^. \*\*13\*\* " docs/plan/exec/E3-parallel-schedule.md` → 0 · `grep -cE "^. \*\*15\*\* " …` → 0 · `grep -cE "^. \*\*13a\*\* " …` → 1). 라운드9 S-3이 §E·§H에서 정정한 유형의 잔여이며, **경계 태스크 표기**는 웨이브 재편에도 stale되지 않는다(V2-7이 §F ①·③에 적용한 형식). 그 구간의 경계 태스크 = T-W2-05(13a 착수)·T-W2-17(15b 완료)) | 08§A 시간축 매핑표 "런칭 4주 후 — 패널 R3(실사용 로그+재방문 인터뷰)"(03§B-1) | 5만 | 없음(비차단, 정보 수집성) |
| **T-NC-18(03§B-4 1차, EVAL-ROUND-6 D6-3 신설)** | **Wave 15b 종료 직전**(T-NC-07 W2 DoD 판정 직전 단계 = "첫 촬영 재개 전" 시점, D6-3 "W2 DoD 충족 직전" — EVAL-ROUND-8 D8-1 반영, 舊 "Wave 15") | 08§A 시간축 매핑표 "03§B-4 공급자(기자·주민) 사용성 검증 — 1차" | 5만 | 03 리스크 9 트리거(자막 입력 이탈 2명 이상 또는 완료율 90% 미만) 관측 — 미달 시 07 §3-3 대안 검토(본 문서 비범위), 코드 웨이브 자체는 비차단 |
| **T-NC-19(03§B-4 2차, EVAL-ROUND-6 D6-3 신설)** | Wave 15b 종료(W2 DoD 판정, 첫 촬영 재개) + 4주 경과 시점(EVAL-ROUND-8 D8-1 반영, 舊 "Wave 15"), **W3 구현 구간(T-W3-01 착수 ~ T-W3-04 완료)과 병행 가능·비차단**(**EVAL-ROUND-25 K2-5/D25-2 정정** — 舊 "Wave 16~18"은 ① 폐지·분리된 라벨 17 단독을 포함했고(재현: `grep -cE "^. \*\*17\*\* " docs/plan/exec/E3-parallel-schedule.md` → 0 · `grep -cE "^. \*\*17a\*\* " …` → 1) ② 종점 Wave 18의 구성이 T-W4-01·T-W4-03 = **W4 구현 웨이브**라 "(W3 진행)" 부기와도 어긋났다(재현: `grep -E "^. \*\*18\*\* " docs/plan/exec/E3-parallel-schedule.md`). W3 코드 태스크 T-W3-01~04의 실재 라벨은 16·17a·17b 3개다) | 08§A 시간축 매핑표 "03§B-4 공급자(기자·주민) 사용성 검증 — 2차" | 5만 | 없음(비차단, 정보 수집성) |
| **T-NC-20(CF Stream 실계정 개설, EVAL-ROUND-19 R2-3 신설)** | **Wave 10(T-W2-15) 착수 전** + G9 ③(05§G 운전자금) 확인 후(E3 §F ③이 이미 "실비용 발생 지점(T-NC-20, CF Stream 실계정 개설 — 그 자격증명을 소비하는 코드 태스크는 T-W2-15, Wave 10)"으로 지목한 게이트 재인용 — 신규 게이트 발명 아님. **EVAL-ROUND-22 22B X2-5/D22-8 동기 갱신**: 舊 인용문은 §F 정정 전 문안이라 stale이었다) | 04 실행체크리스트-1(08§A W2 DoD 인용), T-W2-15 원 산출물에서 분리(EVAL-ROUND-19 R2-3 — E2 §E 서두 "사용자 재무/행정 결정" 분리 기준을 T-NC-08·09와 동일하게 적용) | 5만 | **Wave 10의 T-W2-15**(그 태스크가 소비할 자격증명이 아직 없으면 코드는 작성 가능하나 env 실 연동 검증은 이 게이트 이후) — Wave 1~9는 비차단 |
| **앵커4(대외 런칭 판정) — 08§A 자체 소유 상시 프로세스 인용, T-NC 아님(EVAL-ROUND-6 W-2·기타확정)** | **Wave 12 종료(앵커2=W1 DoD)와 동시 착수**, 이후 시드 콘텐츠 누적 시마다 재확인(월 1회 W축 진척 점검 회의와 동일 주기, 종료 없음) | 08§A "담당: 기획(PM), 판정 시점: 앵커 2(W1 DoD) 판정과 동시 착수하여 이후 시드 콘텐츠 누적 시마다 재확인" | 해당없음(08§A 자체 소유 상시 프로세스 인용 — 조율자 상시 관리, E2 신규 T-NC 태스크가 아니므로 §G **69건**(**EVAL-ROUND-22 D22-1 정정 — 舊 "68건"은 T-W1-11c 신설 반영 전 stale**, 그 앞 EVAL-ROUND-19 R2-3 정정(舊 "67건"→68)도 동형. §G 표 합계 행과 이제 단일 총계) 재검산 대상 아님, M1~M12 행과 동형 처리) | 없음(정보성 편입 — 대외 홍보(카톡 채널 공지) 개시 여부만 좌우, 코드 웨이브는 비차단. 舊 §A는 이를 "제외"로 서술했으나 정정 — 앵커2에 W축 결박이라 §D 편입이 맞다) |
| T-TRIG-01(멀티파트 승격) | 트리거(D-T4 문장) 충족 시 — **편입 웨이브 확정 전 조율자가 §B 준-공용 7종(app.module.ts·pnpm-lock.yaml·nginx.conf·`apps/<app>/app/_layout.tsx`·`apps/subscriber/app/live/[id].tsx`·`apps/subscriber/app/watch/[id].tsx`·`apps/reporter/.../classify.tsx`) 해당 여부를 판정하고 결과를 §B 목록에 임시 편입한다**(EVAL-ROUND-8 D8-5, R-9, EVAL-ROUND-13 K-4로 3종→4종 정정, EVAL-ROUND-15 H-5/D15-2로 4종→5종 정정, **EVAL-ROUND-20 Z2-1로 5종→7종 정정** — E2 §D 파일 소유권 열 신설(D8-5) 결과 T-TRIG-01은 기존 `UploadModule` 확장이라 `app.module.ts`·D4 비대상으로 확정됨, 나머지 6종도 무관) 그 시점 이후 첫 여유 웨이브(구현 4건 미달 웨이브)에 편입 | 02§E-12 | (코드 태스크 — E4 §A-5 S/M/L 적용, 5만/건 대상 아님) | 없음(선택적 승격) |
| T-TRIG-02(B2B 워터마크) | B2B 착수 결정 시 — **편입 웨이브 확정 전 조율자가 §B 준-공용 7종 해당 여부를 판정**(D8-5, R-9, EVAL-ROUND-13 K-4로 3종→4종 정정, EVAL-ROUND-15 H-5/D15-2로 4종→5종 정정, **EVAL-ROUND-20 Z2-1로 5종→7종 정정** — E2 파일 소유권 확정 결과 `services/media-worker/*`라 7종 전부 무관) — 동일 방식 편입 | 02§E-15 | (코드 태스크) | 없음 |
| T-TRIG-03(쉘 UA 감지) | 05§A-4 결정 시(전체) 또는 **Wave 17a** 이전 아무 여유 웨이브(감지 로직 선구축분만, 舊 "Wave 17") — **편입 웨이브 확정 전 조율자가 §B 준-공용 7종 해당 여부를 판정**(D8-5, R-9, EVAL-ROUND-13 K-4로 3종→4종 정정, EVAL-ROUND-15 H-5/D15-2로 4종→5종 정정, **EVAL-ROUND-20 Z2-1로 5종→7종 정정** — E2 파일 소유권 확정 결과 `apps/subscriber/src/shell/*`(라우트 파일이 아닌 유틸리티라 7종 어느 쪽 대상도 아님)라 7종 전부 무관). **02§E-11 후단 상시 의무 판정(EVAL-ROUND-20 Z2-9)**: 02§E-11 원문 후단 "매 앱 업데이트마다 회귀 확인"은 05§A-4 결정(후원·멤버십 트랙 재개) 이후의 **상시 운영 의무**이지 본 트리거의 1회 완결 산출물이 아니다 — DDD7이 08§D "네이티브 즉시 동결"을 상시 제약으로 승계한 선례를 준용해, 이 상시 회귀 확인은 **본 실행계획(W0~W4) 비범위**로 판정한다(05§A-4 미결정 구간에는 비노출 대상 UI 자체가 없어 회귀 대상도 없고, 트리거 발동 이후의 상시 회귀는 W0~W4 이후 운영 국면이다). 준수 확인 자리는 트리거 발동 시 조율자가 별도 배정 | 02§E-11 | (코드 태스크) | 없음(전체 기능은 05§A-4 미결정 시 대상 UI 자체가 없어 비차단) |

## E. 실패 태스크 재시도·이월 규칙

1. **게이트① 자가검증 실패(레드/미실행)**: E5§A 게이트① 조치를 그대로 적용 — 해당 웨이브에서 그 태스크만
   "미완료" 상태로 유지, **같은 웨이브의 나머지 태스크는 영향받지 않고 계속 진행**(파일 소유권이 배타적이므로
   실패가 전파되지 않음 — 이것이 G3 파일 배타 병렬의 핵심 이점).
2. **게이트② qa-verifier FAIL**: 동일 웨이브 내 재기동(같은 서브에이전트 또는 재위임) 1회 허용. 재기동도 실패하면
   해당 태스크를 **다음 웨이브로 이월**(carry-over)하고, 원래 웨이브의 나머지 태스크는 계획대로 다음 단계 진행.
   단, 이월된 태스크에 **의존하는 하류 태스크는 이월된 태스크 완료까지 자동 보류**(예: T-W2-08 실패 시 T-W2-09는
   T-W2-08 완료 후 웨이브로 재배치).
3. **SOLO 태스크 실패**: 시스템 전체가 그 태스크만 기다리는 구조이므로, 실패는 **후속 전 웨이브를 지연**시킨다.
   **SOLO 실패가 확인되면 조율자는 즉시 원인을 분류(설계 문제/구현 실수)하고, ① 24시간 ② E5 §E 웨이브 간 대기
   구간 보고(주 1회 간이 보고)의 다음 정기 시점 중 먼저 도래하는 시점 안에 재기동 여부를 판단한다(무기한 방치
   금지).**(EVAL-ROUND-2 영역4 감점4·Y-19 — 문장 재구성, 2문장 분리로 주 구조 복원)
   > 각주(경위, EVAL-ROUND-1 영역8 감점6·X-16): "다음 조율자 점검 시점"이라는 舊 표현은 참조 대상이 어느 문서에도
   > 정의되지 않은 미정의 참조였다 — 이를 **E5 §E "웨이브 간 대기 구간 보고"**(웨이브가 외부 대기로 3일 이상
   > 정체 시 조율자가 대기 항목·경과일·해제 조건을 기록하는 주 1회 간이 보고) 절의 정기 시점으로 확정해 닫았다.
   > E5§E는 이미 갱신 완료돼 해당 절이 실존한다(리포 실측: `E5-quality-gates.md` §E "웨이브 간 대기 구간
   > 보고" — EVAL-ROUND-14 J-11/D14-4 정정, 舊 "E5§E가 아직 갱신 전이면 조율자 재량 판단으로 대체한다"는
   > 이미 종결된 조건을 현재형으로 남긴 잔여였다).
4. **이월 한도**: 동일 태스크가 **2개 웨이브 연속 이월**되면(재기동 2회 실패), E5§A "동일 유형 위반 2회 이상"
   조항과 동일 기준으로 조율자가 태스크 자체를 재설계(범위 축소/분할)한다 — E2로 피드백해 태스크 정의를 갱신한다.
5. **웨이브 부분 실패의 재계산**: 한 웨이브에서 **구현 최대 4건 중**(EVAL-ROUND-19 R2-4 정정 — 舊 "5개 중"은
   D3 확정(구현 상한 4건 + qa-verifier 전용 1슬롯) 이전의 舊 상한 잔재였다. D3 이후 §C·§H·E4 §A-1이 전부
   "구현 4건"으로 통일됐고 실측상 5개 구현 태스크가 배정된 웨이브는 0건이라 "5개 중"에 해당하는 웨이브가
   구조적으로 존재하지 않는다) 일부가 이월되면, 그 웨이브의 "완료"는 **성공한 태스크만
   반영**하고 이월분은 다음 웨이브 번호에 재편입한다(웨이브 번호 자체를 재부여하지 않음 — 예: Wave 8a에서 1개
   이월되면 Wave 9는 원래 계획대로 진행하고 이월분은 Wave 9 이후 여유 슬롯에 삽입 — EVAL-ROUND-9 S-3 정정,
   舊 예시 "Wave 8"은 8a/8b 분리 후 존재하지 않는 폐지 라벨이었다).
6. **머지 완료 후 회귀 발견 시(EVAL-ROUND-16 G-3/D16-1 연동)**: 위 1~5항은 전부 **pre-merge**(게이트④ 통과 전)
   국면만 다룬다 — G8 자기머지(로컬 `--no-ff`+`git push origin main`)로 게이트④ 통과 즉시 main에 반영되므로,
   그 이후 결함이 드러나는 국면은 별도 규정이 필요하다. E5§A "위반 시 조치" 5항(① D10-4 델타로 결함 기인
   태스크 특정 ② 경미 결함=`hotfix/<태스크ID>-슬러그`, 구조 결함=`git revert`+원 태스크 미완료 원복 ③ 핫픽스도
   4단 게이트 전 구간 통과 ④ EXEC-DECISIONS 기록)를 그대로 적용한다. **이 복구가 진행 중 웨이브에 미치는
   영향**: 복구 대상과 **같은 워크스페이스**(`apps/*`/`services/*`/`packages/*` 단위)를 편집하는 진행 중
   태스크는 게이트③(회귀 검증)을 그 복구가 게이트④까지 재통과할 때까지 **보류**한다(D10-4 순차 머지 규칙상
   뒤 태스크의 before 스냅숏이 아직 안정되지 않아 회귀 판정 자체가 무의미해지기 때문 — 1항의 "파일 소유권
   배타 원칙"과 동형으로 다른 워크스페이스 태스크는 영향받지 않고 계속 진행). 복구 대상 원 태스크는 미완료로
   원복되며 **이월 카운트에 산입**한다(4항의 "2웨이브 연속 이월 시 재설계" 상한과 연결 — 이 복구 사이클이
   해당 태스크의 이월 횟수를 1회 더한다).

## F. G9 게이트 보류 태스크 우회 경로

**원칙**(EXEC-PLAN G9·HANDOFF 승계): "미확인 항목은 해당 게이트에 걸리는 태스크만 보류, 나머지는 로컬 검증 범위
내 병렬 진행."

| G9 항목 | 직접 차단 대상 | 우회 경로(차단 전 진행 가능한 것) |
|---|---|---|
| ① 도메인 미확정 (**담당: 기획(PM)·사용자** — 08§D "도메인·브랜드 미결정으로 W0 지연" 행 원문 담당을 그대로 승계, EVAL-ROUND-24 U2-6/D24-6. 확정 상신의 종점은 E5 §E "사용자 개입 필요 시점" 1번, 접수 슬롯은 T-NC-02 ①. 재현: `grep -n "도메인·브랜드 미결정" docs/plan/08-rollout-transition.md`) | T-NC-01(외부 `https://api.<도메인>/health` 실측), T-W1-05·06의 실제 배포 검증(임시 도메인 대체 가능, 08§D 리스크 "도메인·브랜드 미결정으로 W0 지연" 완화책 인용: "임시 도메인으로 W0~W2 기술 검증 진행") | **T-NC-01 실측(외부 도메인 필요)을 제외한 전 웨이브**는 임시 도메인 또는 로컬 LAN으로 코드·통합 검증 진행(EVAL-ROUND-18 V2-7 정정 — 舊 "Wave 1~15 전건"은 13a/13b·15a/15b 분리 후 종점이 15a인지 15b인지 웨이브 라벨만으로 특정 불가했다. 경계 태스크 기준으로 재작성해 웨이브 재편이 있어도 이 행이 stale되지 않는다) |
| ② 제온 노출 방식(Tunnel/포트개방) 미확정 | T-W0-03의 실제 외부 노출 경로 구성(Cloudflare Tunnel `cloudflared` 서비스 블록 또는 방화벽 허용 규칙 — E2 T-W0-03 산출물란 인용, EVAL-ROUND-11 N-1 정합)의 **실 연결**(설정 코드 자체는 작성 가능) | Wave 2(T-W0-03) 코드 작성은 진행, 실 연결만 보류(= 방식을 실제 Cloudflare/방화벽 인프라에 적용하는 것 — 코드 작성과 실 연결의 경계는 T-NC-02 ② 확정 여부). **08§D 데드라인**: "W0 착수 + 4주 초과 시 승인 대기를 종료하고 Tunnel 단독안으로 자동 확정" — 4주 경과 시 조율자가 자동 확정 후 진행 |
| ③ 05§G 운전자금 미확인 | Wave 1(T-W0-05) 자체는 순수 코드라 비차단. 08§A는 "W0 착수 보류"라 명시하나, **EXEC-DECISIONS #8**(EVAL-ROUND-8 D8-2, R-2 정정 — 舊 인용처였던 08§D "방화벽/터널 승인 지연" 행은 재무 게이트에 대응 행이 없는 **유추 적용**이었다. #8이 근거를 정식 기록: ① G9 원문 "기술 준비 작업은 로컬 검증 범위 내 선행 가능" ② 재무 게이트의 보호 목적은 현금 소진 방지이며 로컬 개발은 지출 0이라 무충돌 ③ 08§D 행 인용은 동형 완화책의 유추임을 명시)를 적용해 **코드 웨이브는 진행하되 실 배포·비용 발생 단계(Cloudflare 유료 티어 전환·서버 실사용 등)만 보류** | **실비용 발생 지점(T-NC-20, CF Stream 실계정 개설 — 그 자격증명을 소비하는 코드 태스크는 T-W2-15, Wave 10) 착수 직전까지** 로컬 검증 범위 내 진행, 그 직전 재확인 필수(**EVAL-ROUND-22 22B X2-5/D22-8 정정** — 라운드19 R2-3이 "실계정 개설"(사용자 재무/행정 결정)을 T-W2-15에서 T-NC-20으로 분리했고 E2 T-W2-15·E2 §E·E3 §D·E5 §C·E5 §E 11번 5문서가 전부 갱신됐는데 본 §F 2곳만 舊 귀속으로 남아 소유권 서술이 충돌했다(편성·게이트 시점은 동일해 실행 영향은 없었다). **앵커 ⑭ 재확인**: 이 행의 LHS 추출 지점이 이제 `T-NC-20`을 산출하고, RHS(E5 §E "사용자 개입 필요 시점" 목록)에 T-NC-20이 이미 실재하므로 교체 후에도 차집합 빈 출력이 유지된다(추출 패턴 문자열 자체는 본문에 재생산하지 않는다 — V2-2가 종결한 자기 매칭 재발 방지). EVAL-ROUND-18 V2-7 정정 이력 유지 — 舊 "Wave 1~10(코드 작성)까지"와 "T-W2-15, Wave 10 도달 전 재확인"이 동일 웨이브를 "까지 진행"과 "도달 전 재확인 필요" 양쪽으로 서술해 자기모순이었다. T-W2-15 착수 자체가 그 실비용 발생 지점이므로 경계는 "그 태스크 착수 직전"으로 충분하며 웨이브 번호가 재편돼도 stale되지 않는다) |

**우회 경로의 한계**: 위 표는 "코드를 미리 짜 둔다"는 뜻이지 "확인 없이 실행한다"는 뜻이 아니다 — 비용이 실제로
발생하는 지점(도메인 구매·Cloudflare 유료 전환·**CF Stream 실계정 개설=T-NC-20**(그 자격증명을 소비하는 코드
태스크는 T-W2-15, Wave 10) — **EVAL-ROUND-22 22B X2-5/D22-8 정정**, 舊 "실계정 개설=T-W2-15" 명시 등식은
라운드19 R2-3의 T-NC-20 분리를 반영하지 못한 5문서 충돌 잔여였다)에 도달하기 **직전**,
조율자가 G9 확인 상태를 재점검한다. 미확인 상태로 이 경계를 넘는 것은 E5§A "테스트 미실행 완료 선언 금지"와
동급의 절차 위반으로 취급한다.

## G. E2 ↔ E3 정합 자체 검산 (EVAL-ROUND-22 재검산 — 69건·T-W1-11c 신설, 실행 grep 인용)

**검산 방법**: E2의 전 태스크 ID(**69건**: 정상 웨이브 코드 **46** + 트리거 대기 3 + 코드 외 **20**,
**EVAL-ROUND-22 D22-1로 T-W1-11c 신설 반영 코드 45→46**(신규 SOLO Wave 8c 삽입 — 웨이브 라벨 22→23),
EVAL-ROUND-19 R2-3으로 T-NC-20 신설 반영 19→20 — T-NC-20은 T-W2-15에서 산출물을
분리한 신설이지 코드 태스크 변경이 아니었다)를 위 §C 웨이브 표 + §D 체크포인트 표와 대조해, 각 ID가 **정확히
1곳**에만 배정됐는지 확인한다. Q1 원칙에 따라 실제 실행한 명령·출력을 그대로 인용한다.

**실행 컨텍스트**(EXEC-EVAL-ROUND-26 J2-4/D26-4 반영): 아래 블록은 **리포 루트**에서 그대로 재실행한다 — 파일
인자를 **전체 경로**(`docs/plan/exec/…`)로 표기해 §B python 블록의 "**재현**(리포 루트, …)" 표기·E5 §D 앵커 전종과
통일했다. 舊 bare 파일명 표기는 리포 루트에서 `No such file or directory`·**exit 2**를 내, 앵커 ⑨이 요구하는
"그대로 재실행"이 출력 불일치가 아니라 **재현 불가**로 읽혔다(앵커 ⑬ 판정 규칙과 결합하면 매 웨이브 허위 보고).

(EVAL-ROUND-22 재실행 —
신설 라벨 `8c`·ID `T-W1-11c` 매칭을 위해 정규식을 `[ab]?`→`[abc]?`로 확장했다. 舊 정규식으로는 8c 행이 계수
자체가 되지 않고 `T-W1-11c`가 `T-W1-11`로 오추출된다).

```
$ grep -E "^\| \*\*[0-9]+[abc]?\*\* \|" docs/plan/exec/E3-parallel-schedule.md | awk -F'|' '{print $3}' | grep -oE "T-W[0-4]-[0-9]+[abc]?" | wc -l
46
$ grep -E "^\| \*\*[0-9]+[abc]?\*\* \|" docs/plan/exec/E3-parallel-schedule.md | awk -F'|' '{print $3}' | grep -oE "T-W[0-4]-[0-9]+[abc]?" | sort -u | wc -l
46
$ grep -cE "^\| \*\*[0-9]+[abc]?\*\* \|" docs/plan/exec/E3-parallel-schedule.md
23
$ grep -E "^\| \*\*[0-9]+[abc]?\*\* \|" docs/plan/exec/E3-parallel-schedule.md | awk -F'|' '{print $3}' | grep -oE "T-W[0-4]-[0-9]+[abc]?" | sort | uniq -c | awk '$1!=1'
(빈 출력 — 중복 0건)
$ comm -3 <(grep -oE "^\| T-W[0-4]-[0-9]+[abc]?" docs/plan/exec/E2-work-breakdown.md | sed 's/| //' | sort -u) \
          <(grep -E "^\| \*\*[0-9]+[abc]?\*\* \|" docs/plan/exec/E3-parallel-schedule.md | awk -F'|' '{print $3}' | grep -oE "T-W[0-4]-[0-9]+[abc]?" | sort -u)
(빈 출력 — E2 코드 태스크 ID 집합 == E3 웨이브 배정 집합, 차집합 0)
$ grep -oE "^\| T-W[0-4]-[0-9]+[abc]?" docs/plan/exec/E2-work-breakdown.md | sed 's/| //' | sort -u | wc -l
46
$ grep -oE "^\| \**T-NC-[0-9]+" docs/plan/exec/E2-work-breakdown.md | sed 's/[| *]//g' | sort -u | wc -l
20
$ grep -oE "^\| \**T-(W[0-4]|NC|TRIG)-[0-9]+[abc]?" docs/plan/exec/E2-work-breakdown.md | sed 's/[| *]//g' | sort -u | wc -l
69
$ grep -cE "^\| \*\*T-NC-20" docs/plan/exec/E3-parallel-schedule.md
1
$ grep -c "T-W1-11c" docs/plan/exec/E2-work-breakdown.md docs/plan/exec/E3-parallel-schedule.md
(양 파일 ≥1 존재 재현 — D15-3 형식, 정확한 회수는 서술 문맥의 자기 매칭을 포함하므로 판정 입력으로 쓰지 않는다)
```

(§C 표 "태스크" 열만 대상 — 전체 문서 대상 grep은 §A 의존그래프·§D 체크포인트·§H 리스크 표 등에서 태스크 ID를
참조성으로 재언급하므로 카운트가 부풀려진다는 점은 라운드 1에서 이미 확인했다. 정규식을 `[0-9]+[ab]?`로 확장한
것은 D4-5의 웨이브 라벨 분리(17a/17b)를 매칭하기 위함 — EVAL-ROUND-4 영역4 감점1·V-7 반영. **EVAL-ROUND-8
재검증 각주**: Wave 15a/15b 신설 행에서 라벨 셀에 괄호 주석을 직접 붙였다가(舊 `**15a**(舊 "15", ...)`) 웨이브
라벨 정규식(`^\| \*\*[0-9]+[ab]?\*\* \|`)이 라벨 셀을 "**15a**"만으로 기대해 매칭에 실패, 재검산 결과가
42/20으로 실측과 어긋난 것을 이 재현 과정에서 직접 발견해 즉시 정정했다(라벨 셀은 순수 라벨만, 주석은 인접
열로 이동 — 기존 8a/8b·17a/17b 행과 동형 정합). T-NC 카운트에 `\**`를 추가한 것은 EVAL-ROUND-6 신설
T-NC-16~19가 E2 §E에서 볼드 없이 등재됐음을 확인하는 과정에서, 舊 grep이 볼드 유무를 가정하지 않은 느슨한
패턴이라 신설분도 정확히 잡힘을 재확인한 것. **EVAL-ROUND-14 재검증 각주**: T-W2-18 신설 행을 처음 작성할 때
ID를 볼드로 감싸(`| **T-W2-18**(...) |`) 코드 태스크 정규식(`^\| T-W[0-4]-[0-9]+[ab]?`)이 매칭에 실패해
재검산 결과가 44로(기대 45 대비 1건 누락) 나온 것을 이 재현 과정에서 직접 발견해 즉시 정정했다 — ID 셀은
항상 볼드 없는 순수 텍스트로 시작해야 한다는 기존 컨벤션(T-NC-16 라운드6 사례와 동형)을 재확인.)

| 구간 | E2 태스크 수 | E3 배정 위치 | 중복/누락 |
|---|---|---|---|
| W0 코드(T-W0-01~06) | 6 | Wave 1(1)+Wave 2(4)+Wave 4(1, T-W0-06) | 0/0 |
| W1 코드(T-W1-01~11c, DD1 분할·**D22-1 T-W1-11c 신설** 반영) | **14**(EVAL-ROUND-22 D22-1 — T-W1-11c 신설로 13→14) | Wave 3(01)+Wave 4(05·06)+Wave 5(08·02)+**Wave 8a(07b·03)+Wave 8b(04)+Wave 8c(11c)**(EVAL-ROUND-22 D22-1 신설 SOLO 웨이브)+Wave 9(09·10)+Wave 12(07a)+**Wave 13a(11a)+Wave 13b(11b)**(EVAL-ROUND-17 F-11/D17-1 — 舊 Wave 10(11a)+Wave 11(11b)에서 재배치, 라벨 11 폐지) | **14건 전건 배정, 중복 0**(01·05·06·08·02·07b·03·04·**11c**·11a·09·10·11b·07a = 14개 고유 ID, EVAL-ROUND-6 D6-1로 舊 Wave8(07b·03·04)이 8a(07b·03)+8b(04)로 분리, EVAL-ROUND-17로 11a·11b가 Wave 10·11에서 Wave 13a·13b로 재배치, **EVAL-ROUND-22 D22-1로 11c가 Wave 8c(신규 SOLO 라벨)에 신규 배정** — 기존 배정 재번호 0) |
| W2 코드(T-W2-01~18) | **19**(EVAL-ROUND-14 D14-1/J-6 — T-W2-18 신설로 18→19) | Wave4(01)·Wave5(02·04)·Wave6(08)·Wave7(13)·**Wave8a(10)**·Wave9(09·03)·**Wave10(11·12·15)**(EVAL-ROUND-17로 T-W1-11a 제거 후 3건)·**Wave12(14·16a·18)**·**Wave13a(05·16b)**(舊 "Wave13")·Wave14(06)·**Wave15a(07)·Wave15b(17)** | **19건 전건 배정, 중복 0**(01·02·03·04·05·06·07·08·09·10·11·12·13·14·15·16a·16b·17·18 = 19개 고유 ID, T-W2-18은 기존 Wave 12 슬롯에 편입 — 신규 웨이브 라벨 불요) |
| W3 코드(T-W3-01~04) | 4 | Wave16(01)·**Wave17a(02)**·**Wave17b(03·04)**(D4-5 재편 반영, 舊 "Wave17(02·03·04)") | 0/0 |
| W4 코드(T-W4-01~03) | 3 | Wave18(01·03)·Wave19(02) | 0/0 |
| 트리거 대기(T-TRIG-01~03) | 3 | §D 표(트리거 발동 시 여유 웨이브 편입 — 고정 웨이브 미배정은 설계 의도, "정확히 한 웨이브"가 아니라 "정확히 한 체크포인트 규칙"에 배정) | 0/0(트랙 배정 완료) |
| 코드 외(T-NC-01~20, T-NC-16~19 신설 반영(D6-3) + T-NC-20 신설(EVAL-ROUND-19 R2-3) — **EVAL-ROUND-20 Z2-12로 라벨 범위 표기 정정**) | **20** | §D 체크포인트 표 20행 전건(T-NC-20 포함) | 0/0 |
| **합계** | **69** | **46(웨이브 23라벨)+3(트리거 규칙)+20(체크포인트)=69** | **전건 배정 — 누락 0건, 중복 0건**(DD1 분할로 42→43, DD5 T-NC 신설로 13→15, D4-5 웨이브 라벨 19→20, D6-3 T-NC 15→19·D6-1 웨이브 라벨 20→21, EVAL-ROUND-8: D8-1 T-W2-17 신설로 코드 43→44·웨이브 라벨 21→22, EVAL-ROUND-14: D14-1/J-6 T-W2-18 신설로 코드 44→45(웨이브 라벨 불변 22 — 기존 Wave 12 슬롯 편입), EVAL-ROUND-17: F-11/D17-1로 T-W1-11a·11b 웨이브 재배치(舊 Wave 10·11 → Wave 13a·13b, 라벨 11 폐지·舊 Wave 13이 13a/13b로 분리) — 코드 45건·웨이브 라벨 22 양쪽 모두 불변(순수 재배치, 신설·삭제 아님). 부수 효과: 구현 정확히 4건인 웨이브 집합이 6개(Wave 2·4·5·9·10·12)→5개(Wave 2·4·5·9·12)로 변경(Wave 10이 4건→3건) — E4 §A-7·E5 §F 리스크1·앵커⑮ 동반 갱신 필요, **EVAL-ROUND-19: R2-3으로 T-NC-20 신설, 코드 외 19→20(웨이브 라벨·코드 45건 불변 — T-NC는 체크포인트라 웨이브 배정 대상 아님)**, **EVAL-ROUND-22: D22-1로 T-W1-11c 신설(02§B가 명시 계상한 `deploy-web.yml`의 무기록 해소), 코드 45→46·웨이브 라벨 22→23(신규 SOLO 웨이브 8c 삽입 — 기존 라벨 재번호 0(접미 문자 라벨)·앵커 ⑮ 구현 4건 웨이브 집합 {2·4·5·9·12} 불변·"W1 코드 종료=Wave 13b" 이원 선언 불변), 총 68→69**, 총 61→65→66→67→68→69 태스크) |

**앵커4(대외 런칭) 별도 확인**: 위 §D 표의 "앵커4(대외 런칭 판정)" 행은 E2 T-NC ID가 없는 **정보성 편입**(EVAL-ROUND-6
W-2·기타확정)이라 위 **69건**(EVAL-ROUND-22 D22-1 정정 — 舊 "68건"은 T-W1-11c 신설 반영 전 stale. 그 앞
EVAL-ROUND-19 R2-3 정정 이력(舊 "67건" → 68)도 동형이었다. 바로 위
§G 정합 표 합계 행과 동일 총계) 재검산에 포함하지 않는다 — M1~M12 행(05 소유, 본 문서 비범위)과 동일하게
08§A 자체 소유 상시 프로세스를 인용만 한 것이지 E2가 신설한 태스크가 아니다.

## H. 리스크 테이블

| 리스크 | 완화책 | 담당 | 발동 트리거 |
|---|---|---|---|
| 계획 시점 파일 소유권 근사치가 실제와 달라 같은 웨이브 내 태스크가 충돌(특히 **Wave 2·4·5·9·12의 4개 동시 배치 — 구현 4건 웨이브 **5개**, E4 §A-7·E5 §F 리스크1과 동일 집합**, **EVAL-ROUND-17 F-11/D17-1 정정** — 舊 "6개(Wave 2·4·5·9·10·12)"는 T-W1-11a가 Wave 10→13a로 재배치되며 Wave 10이 4건→3건으로 줄어 stale이 됐다(자막토글 UI 선행 엣지 신설에 따른 연쇄, 상세는 §C Wave 10·13a·13b 셀·§A 그래프 참조). **이 변경은 E4 §A-7·E5 §F 리스크1에 동반 갱신 필요**(3문서 불변식 — 앵커 ⑮가 다음 재현 시 검출). EVAL-ROUND-15 H-1/D15-1 정정 이력(舊 "5개"→"6개") 이후 두 번째 갱신. EVAL-ROUND-9 S-2 정정 — 舊 열거는 Wave 2가 빠진 4개뿐이었다. 舊 Wave 8도 4건이었으나 EVAL-ROUND-6 D6-1로 8a(3건)·8b(1건)로 분리되며 4건 동시 배치 사례에서 빠졌다) | 웨이브 착수 직전 조율자가 각 태스크의 실제 대상 디렉터리를 `git status`/`grep` 재확인 후 배치 확정(E2§G 리스크 표와 동일 원칙) — 충돌 발견 시 그 웨이브 내에서 즉시 재배치(다음 웨이브로 순연). **완화책 적용 범위는 위 열거 5개 웨이브 전건**이며, Wave 12는 소유권이 정정된 T-W1-07a(`watch/[id].tsx`)와 T-W2-18을 함께 담아 재확인 필요성이 가장 크다(EVAL-ROUND-15 H-1) | 조율자 | 매 웨이브 착수 직전 상시 |
| SOLO 웨이브(**9건**, EVAL-ROUND-8 D8-1로 T-W2-17 신설 반영 7→8 · **EVAL-ROUND-22 D22-1로 T-W1-11c 신설 반영 8→9** — D6 분할 이후 舊 7건에서 두 차례 갱신)가 전체 파이프라인을 순차 정지시켜 총 웨이브 수가 늘어남(동시성 손실) | SOLO 웨이브는 최대한 작게 설계(단일 관심사 1태스크)해 정지 시간을 최소화. **정정(EVAL-ROUND-1 영역3 감점1·X-9)**: 舊 "T-W1-11에 CI 관련 항목을 병합해 SOLO 8→7 축소"는 스케줄 편의가 크기 기준을 앞선 사례로 적발됐다 — D6로 재분할했으며, 분할 후 SOLO 건수는 7건이었다가 EVAL-ROUND-8 D8-1의 T-W2-17 신설(02§E-9 "CI 자동 실행" 요소 결박, 정본 준수가 목적이지 스케줄 편의가 아님)로 8건, **EVAL-ROUND-22 D22-1의 T-W1-11c 신설(02§B 명시 계상 `deploy-web.yml` 무기록 해소 — 동일하게 정본 준수가 목적)로 9건**이 됐다. 신설 2건 모두 S(1파일)라 정지 시간 증가는 최소. 추가 병합은 크기 기준(E2§A) 위반 없이만 검토 | 조율자 | 웨이브 편성 확정 전 상시 |
| W1·W2 교차 배치(Wave 4·5·8a·9·10, EVAL-ROUND-9 S-3 정정 — 舊 "8"은 8a/8b 분리 후 존재하지 않는 폐지 라벨)에서 실제로는 08§A "서로 독립" 전제가 깨지는 숨은 의존(인증 어댑터 공용 패키지 추출 미실행) | **EXEC-DECISIONS #1로 기록 완료**(EVAL-ROUND-1 X-2 반영 — 舊 "아래 신규 위임 목록에 기록"은 미완 상태였다): 08§A 원문의 "공용 패키지 추출"은 선택적 최적화이지 필수 선행조건이 아니라는 판단을 EXEC-DECISIONS #1에 배경·원 계획 인용·채택안·영향 문서 형식으로 확정 기록했다. T-W2-01(기자)·T-W2-04(관제)는 각자 독립 구현으로 진행(파일 소유권 배타적이라 병렬 배치에 지장 없음) | 조율자 | 해소 완료(EXEC-DECISIONS #1 기록 시점) — 상시 재확인은 새 인증 관련 태스크 추가 시 |
| 이월(carry-over) 누적으로 하류 웨이브가 연쇄 지연 | §E 이월 규칙의 "2웨이브 연속 이월 시 재설계" 상한 적용 + 웨이브 종료 보고(E5§E 형식)에 이월 현황 상시 표기 | 조율자 | 동일 태스크 2웨이브 연속 이월 |
| **구현 4건 상한(D3) 미준수로 게이트② 슬롯이 여전히 잠식**(EVAL-ROUND-1 X-15) | §C 웨이브 표가 이미 전 웨이브 구현 ≤4을 만족하도록 재편성됐음(§C 말미 재검산 인용) — 신규 태스크 추가 시에도 이 상한을 웨이브 편성 체크리스트 1항목으로 강제 | 조율자 | 신규 태스크가 기존 4건 웨이브에 추가 배정되려 할 때 |

## I. 실행 체크리스트

- [ ] 웨이브 착수 전 파일 소유권 실측 재확인(§H 리스크 1행)
- [ ] SOLO 웨이브 **9건**(EVAL-ROUND-8 D8-1로 T-W2-17 신설 반영 7→8, **EVAL-ROUND-22 D22-1로 T-W1-11c(Wave 8c) 신설 반영 8→9**)이 전부 단독으로(다른 트랙 정지 포함) 실행됐는지 확인
- [ ] **구현 태스크 동시 배정 ≤4 + qa-verifier 1슬롯 예약**(D3) 준수 확인 — 신규/재배치 웨이브마다 필수
- [ ] `app.module.ts` 준-공용 자산 규칙(D4) — 신규 api 모듈 태스크(T-W1-05·08·T-W2-08·T-W3-01) 동일 웨이브 배치 금지 재확인
- [ ] **`pnpm-lock.yaml` 준-공용 자산 규칙(EVAL-ROUND-6 D6-1, EVAL-ROUND-7 D7-3·D7-2 갱신, EVAL-ROUND-8 D8-4 게이트③ 편입, **EVAL-ROUND-25 K2-1/D25-1로 6종→8종**) — lockfile 갱신 태스크(T-W0-05·**T-W1-01**·T-W1-03·04·11a·T-W3-01·**T-W3-02** + T-W2-07 = **8종**) 동일 웨이브 배치 금지 재확인**(그 시점 전수, 닫힌 목록 아님 — Wave 8a/8b 분리가 최초 적용 사례, Wave 15a(T-W2-07 단독)는 D7-2 편입 후에도 위반 없음, T-W1-01은 Wave 3 SOLO·T-W3-02는 Wave 17a 단독 배치라 정의상 충족. 판정·재현은 §B "8종 전건 웨이브 배치 재검증" python3 블록 1회 실행으로 갈음한다) — **게이트③ 루트 회귀 대상에도 편입됨을 확인**(D8-4, 8건 전부)
- [ ] **`infra/docker/nginx.conf` 준-공용 자산 3(EVAL-ROUND-8 D8-4, R-8 신설) — 편집 태스크(T-W0-03·T-W1-06·T-W2-09) 동일 웨이브 배치 금지 재확인**(그 시점 전수, 닫힌 목록 아님 — EXEC-DECISIONS #6에 따라 동적 라우트 신설 태스크 자동 편입)
- [ ] **`apps/<app>/app/_layout.tsx` 준-공용 자산 4(EVAL-ROUND-12 D12-1 신설, M-7) — 같은 앱의 편집 태스크(T-W1-04·T-W2-09 subscriber, T-W3-02 reporter·control-center) 동일 웨이브 배치 금지 재확인**(그 시점 전수, 닫힌 목록 아님 — 신규 라우트 태스크가 옵션 필요로 판정될 때마다 자동 편입, 판정 절차는 E2 §A 인용)
- [ ] **`apps/subscriber/app/live/[id].tsx` 준-공용 자산 5(EVAL-ROUND-15 H-5/D15-2 신설, **EVAL-ROUND-20 Z2-1로 3건→4건 정정**) — 편집 태스크(T-W1-02 Wave 5·T-W1-03 Wave 8a·T-W2-11 Wave 10·T-W1-07a Wave 12) 동일 웨이브 배치 금지 재확인**(그 시점 전수, 닫힌 목록 아님 — 현재 4건은 전부 다른 웨이브라 무충돌, §A 그래프 `T-W1-02 ─ T-W1-03`(체인)·`T-W1-03 ─ T-W2-11 ─ T-W1-07a` 엣지 인용)
- [ ] **`apps/subscriber/app/watch/[id].tsx` 준-공용 자산 6(EVAL-ROUND-20 Z2-1 신설) — 편집 태스크(T-W1-02 Wave 5·T-W1-03 Wave 8a·T-W1-07a Wave 12) 동일 웨이브 배치 금지 재확인**(그 시점 전수, 닫힌 목록 아님 — 현재 3건은 전부 다른 웨이브라 무충돌)
- [ ] **`apps/reporter/app/(app)/contents/new/classify.tsx` 준-공용 자산 7(EVAL-ROUND-20 Z2-1 신설) — 편집 태스크(T-W1-07b Wave 8a·T-W2-14 Wave 12·T-W2-05 Wave 13a) 동일 웨이브 배치 금지 재확인**(그 시점 전수, 닫힌 목록 아님 — 현재 3건은 전부 다른 웨이브라 무충돌, §A 그래프 `T-W1-07b ─ T-W2-14`·`T-W1-07b ─ T-W2-05` 엣지 인용)
- [ ] **E2E 시나리오 태스크의 각 단계가 요구하는 UI·API의 구현 태스크가 그 시나리오 태스크보다 앞선 웨이브에 있는지 확인**(EVAL-ROUND-17 F-11/D17-1 신설 — 계획 자신이 신설하는 산출물의 선행 누락 방지, EXEC-DECISIONS #4·#6과 동형 사각지대. 대상: T-W1-11a(자막토글 UI, T-W1-07a Wave 12 선행 — 현재 Wave 13a로 충족)·T-W2-07(관제·기자·구독자 시나리오, Wave 4~14 전건 선행으로 이미 충족) — 그 시점 전수, 닫힌 목록 아님. 신규 E2E 시나리오 태스크 추가 시 자동 편입)
- [ ] Prisma 마이그레이션 순서(T-W2-08→T-W2-13→T-W3-01) 위반 없음 확인
- [ ] **웨이브 배정 예상 토큰 합계 ≤ 200만**(E4 §A-5 단가로 계산, 초과 시 E4 §A-4 사전 조치 — EVAL-ROUND-2 영역4 감점3·Y-8 신설)
- [ ] **사이징 라벨이 §C 버킷 정의(파일 수: S=1~3·M=4~6·L=7~11·XL=12+)와 일치하거나 예외 근거가 셀에 부기됐는지**(EVAL-ROUND-3 영역4 감점2·Z-10 신설 — 신규 태스크 추가·파일 수 변경 시마다 재확인)
- [ ] 코드 외 체크포인트(§D **20건**, T-NC-13~19 포함(D6-3 반영) + **T-NC-20**(EVAL-ROUND-19 R2-3 신설))가 해당 웨이브 전후에 실제로 실행됐는지 웨이브 종료 보고에서 확인
- [ ] G9 3항목 상태를 매 웨이브 종료 보고에 표기(§F 우회 경로가 실비용 발생 지점을 넘지 않았는지)
- [ ] 이월 발생 시 §E 규칙에 따라 하류 태스크 자동 보류 반영
- [ ] §G 정합 표를 새 태스크(E2 갱신) 발생 시 즉시 재검산(실행 grep 출력 동봉 의무)
- [ ] **D10-3류 "개방 소유권"(대상 목록이 착수 시점 재실측인 태스크, 예: T-W4-01의 `docs/` 하위)이 같은 웨이브의 타 태스크 신규 산출물 경로와 겹치지 않는지 확인**(EVAL-ROUND-11 N-4 신설 — Wave 18의 T-W4-01/T-W4-03 배타가 그 첫 적용 사례). **판정 기준은 경로가 `docs/` 하위인지 여부가 아니라 D10-3 판정 명령①의 `--exclude-dir=exec` 스윕 제외 범위인지 여부다**(EVAL-ROUND-14 J-14/D14-4 정정 — T-W4-03 산출물은 `docs/` 하위(`docs/plan/exec/reviews/...`)이지만 `exec/` 하위라 스윕 대상에서 제외돼 배타가 성립하며, 신규 개방 소유권 겹침 판단 시마다 이 기준으로 재확인)

## 신규 위임 목록 (등재 책임 규칙에 따라 제출)

**상태 SSOT(D7, EVAL-ROUND-1 영역8 감점3·X-3)**: 아래 표는 **발주 시점 스냅샷**이며, 처리 상태의 정본은
[PIVOT-PLAN §6-11](../PIVOT-PLAN.md)이다. 상태 열은 개별 갱신하지 않으며 **두 형식만** 쓴다(정의의 정본은
E5 §D 절차 6, 본 절은 인용이다) — 등재 완료분은 `→ 6-11 #n 참조`(번호에 볼드가 씌워진 형태도 같은 형식이다
— 앵커 ⑫ "정규식 주의"), 아직 §6-11에 편입되지 않은 항목은 `등재 필요(6-11 편입 대기)`. **그 밖의 제3의
문구는 값의 정오와 무관하게 형식 위반**이다(**EVAL-ROUND-27 H2-1/D27-0** — 본 표 #5가 그 실례였다: 제3의
문구가 PMO 미등재 탐지 grep과 앵커 ⑫ 대조의 분모를 동시에 비워, **진짜 미등재**가 라운드 25·26 두 스윕을
무검출로 생존했다. 라운드 27에 `등재 필요(6-11 편입 대기)`로 정정). **재현**(리포 루트
`/Users/homedcp/Claude/Projects/gachinol`, 본 표 전 행) — 아래 두 계수가 같아야 한다:
`awk '/^## 신규 위임 목록/,0' docs/plan/exec/E3-parallel-schedule.md | grep -cE '^\| [0-9]+ \|'`(데이터 행수) ·
`awk '/^## 신규 위임 목록/,0' docs/plan/exec/E3-parallel-schedule.md | grep -cE '^\| [0-9]+ \|.*(→ 6-11 \*{0,2}#[0-9]+\*{0,2} 참조|등재 필요\(6-11 편입 대기\))'`(두 형식 히트).
값은 그 시점 출력으로 읽고 박제하지 않는다(D7-1).

| # | 발주처 | 수신처 | 요청 내용 | 상태 |
|---|---|---|---|---|
| 1 | E3 §C(예상 소요 열) | **E4**(토큰·시간 예산) | 웨이브 **23개**(EVAL-ROUND-6 D6-1 재편으로 20→21, EVAL-ROUND-8 D8-1로 21→22, EVAL-ROUND-14는 라벨 수 불변 — Wave 8→8a/8b, Wave 15→15a/15b 분리, **EVAL-ROUND-22 D22-1로 22→23 — 신규 SOLO Wave 8c(T-W1-11c) 삽입**)의 상대 크기(S/M/L/XL) 표를 절대 토큰 예산 산정의 입력으로 사용 요청 — **라운드 22 재계산 입력(D22-1, A팀 수행)**: ① 신규 태스크 **T-W1-11c = 사이징 S(1파일)·소속 웨이브 라벨 `8c`·그 웨이브 구성 = T-W1-11c 단독([SOLO], 구현 1건)** → §A-6 표에 **행 1개 신설**(22행→23행)·합계에 S 1건분 + qa-verifier·PMO 슬롯 가산 ② 태스크 45→46·총 68→69·SOLO 8→9(§A-1·§A-3·§A-8 모수 동반) ③ §B-4 분류표 **+1행**(T-W1-11c — 기본 낮음, 담당 인프라 담당) ④ **앵커 ⑮ 구현 4건 웨이브 집합 {2·4·5·9·12} 불변**(8c는 SOLO 1건이라 §A-7 최대 부하 웨이브 판정에도 무영향 — 최대 Wave 5 유지 여부만 재확인) — SOLO 웨이브 **9건**(D8-1로 7→8, **D22-1로 8→9**)의 병렬 슬롯 손실 + T-W1-03·T-W1-04·T-W3-01 사이징 변경(D6-1) + T-W2-07 Wave 15a 사이징 변경(M→L, EVAL-ROUND-7 D7-2·Q-9) + **T-W2-17(Wave 15b) 신규 태스크 편성(S, EVAL-ROUND-8 D8-1)** + **EVAL-ROUND-14 D14-1/J-6 반영**(T-W2-18 Wave 12 기존 슬롯 신규 편입(S, 2파일) + T-W0-05 Wave 1 M→L(6→9파일)·T-W1-03 Wave 8a M→L(6→7파일) 사이징 상향 + T-W2-03 Wave 9·T-W2-08 Wave 6 파일 수 증가(버킷 불변))를 토큰 예산에 반영 요청 | → 6-11 #9 참조 · → 6-11 #38 참조(**EVAL-ROUND-25 C팀 위임 #23·#24 수신 — 앵커 ⑫ 역방향 대조 적발분 + 그 반영분의 표기 형태 보정**: 본 발주를 발주처 칸에 담은 §6-11 행은 **2행**이다(초회 사이징 편입분 · 라운드 22 D22-1 파급 = Wave 8c 신설분 예산 편입분)인데 舊 상태 칸은 앞 번호만 표기해 대장 번호가 한쪽만 가리켰다. **#24 보정 내용**: 병기 시 **각 번호가 접두 `→ 6-11`부터 접미 `참조`까지의 마커를 통째로 반복**해야 하며, 번호만 잇는 축약형은 재현 정규식이 **양쪽 다** 놓쳐 역방향 후보가 오히려 늘어난다(C팀이 E5 §D 앵커 ⑫ "병기 표기 규칙"으로 명확화, 준거 사례는 E5 §신규 위임 #19 상태 칸). 확인: `awk '/^### 6-11\./,0' docs/plan/PIVOT-PLAN.md` 출력의 9번 행 발주처 = "E3 §C·§H(웨이브 사이징 — E3 완료 보고 제출분)" · 38번 행 발주처 = "E3 §신규 위임 #1(라운드 22 파급 제출분)") |
| 2 | E3 §H(리스크 3행) | **PIVOT-PLAN §6**(대장 소유자) | "인증 어댑터 공용 패키지 추출 없이 기자·관제 독립 구현" 판단을 EXEC-DECISIONS에 1건 기록 요청 | → 6-11 #10 참조(EXEC-DECISIONS #1로 기록 완료 확인) |
| 3 | E3 §D(T-NC 체크포인트 13행) | **E5**(§C DoD 판정 절차 표) | E2 신규 위임 목록 #3(PoC·패널 증적 경로)과 동일 건 | → 6-11 #8 참조(E2#3과 통합) |
| 4 | E3 §C Wave 3 셀(사이징 소유자) — 라운드 25(K2-1/D25-1) | **E4 §A-6**(웨이브별 재계산 표) | **Wave 3 사이징 S(3파일) → M(6파일) 재계산 요청** — T-W1-01이 3앱 `package.json` 소비측 선언(`"@gachinol/ui": "workspace:*"`)을 동반 소유하게 돼 파일 수가 3→6, 버킷이 S→M으로 바뀐다(E2 §A 택일 근거 참조). **불변 확인 4건**: ① 웨이브 라벨 수 23 ② 코드 태스크 46·총 69 ③ SOLO 9 ④ 앵커 ⑮ 구현 4건 웨이브 집합 2·4·5·9·12. 즉 **§A-6 표의 Wave 3 행 1개만 갱신**하면 되며 행 신설·라벨 순증은 없다(최대 부하 웨이브 Wave 5도 불변) | → 6-11 #50 참조(2026-08-08 조율자 스윕 — Wave 3 사이징 S→M 재계산 이행 완료: A팀 §A-6 표 Wave 3 행·§A-3·§A-8 ①③⑤ 갱신, 합계 1,944만·최대 부하 Wave 5 166만 불변) |
| 5 | E3 §B 준-공용 자산 2(열거 소유자) — 라운드 25(K2-1/D25-1) | **E5 §B**("의존성 추가 태스크" 행)·**E5 §A 게이트③**(공용 자산 5종 인용부) | 열거를 **6종 → 8종**(+T-W1-01 `@gachinol/ui` 워크스페이스 선언, +T-W3-02 reporter·control-center Workbox — 후자는 조율자 판정으로 같은 라운드에 편입 확정)으로 갱신하고, 대상 어휘를 "신규 npm 패키지 도입"에서 **"신규 npm 패키지 도입 또는 워크스페이스 의존성 선언(`workspace:*`) 추가 — 즉 `pnpm-lock.yaml`을 갱신하는 모든 태스크"**로 확장 요청(舊 어휘가 워크스페이스 링크 형태를 정의역 밖으로 밀어낸 것이 K2-1의 발생 경로였다. 정의의 정본은 E3 §B이며 E5는 인용만 한다). 게이트③ 루트 전체 회귀 대상도 같은 이유로 7건 | → 6-11 #55 참조(2026-08-08 조율자 스윕 — 라운드27 H2-1 적발분. 수신처 이행은 라운드25에 완료돼 있었고 등재만 누락됐다) |
| 6 | E3 §B·§C Wave 17a·E2 §C T-W3-02(K2-1 동형 잔여 **편입 확정분**) — 라운드 25 | **E4 §G #6**(재현 주장 소유자 = A팀) | **조율자 판정으로 B팀이 편입을 이미 반영했다**(T-W3-02 소유권 +`apps/{reporter,control-center}/package.json` 2 → 총 9→11파일, 준-공용 자산 2 열거 7종→8종). 남은 수신분은 **E4 §G #6의 리터럴 재현 주장 전환** 1건 — 그 주장은 §C 사이징 셀의 **9파일 리터럴 계수가 2**임을 박제하고 있는데, 본 갱신으로 Wave 17a 셀이 11파일이 되면서 Wave 1(T-W0-05) 1건만 남아 성립하지 않는다. **값 박제 없는 형태**(D7-1 — 예: 그 시점 실측 참조형)로 전환 요청. 대조 문자열은 본 표에 재생산하지 않는다(재생산하면 그 grep의 계수가 부풀려져 주장이 자기 반증된다 — D24-4·D23-1 존량 규칙. A팀은 E4 §G #6 자신이 보유한 명령을 그대로 재실행해 확인하면 된다). **불변 확인 3건**: ① 버킷 L(7~11) 불변이라 §A-6 Wave 17a 예산 무변경 ② D6-1 위반 0(Wave 17a 단독 — §B 8종 재검증 블록 재실행 출력 `lockfile 2건 이상 웨이브: []`) ③ 라벨 23·태스크 46/69·SOLO 9·앵커 ⑮ 집합 불변 | → 6-11 #50 참조(2026-08-08 조율자 스윕 — 양단 이행 완료: T-W3-02 소유권 편입(9→11파일, B팀)·E4 §G #6 재현 형식 전환(A팀). 버킷 L 불변·D6-1 무영향) |

**라운드 1 수정에서 발생한 신규 위임**: 없음 — 본 라운드는 EXEC-EVAL-ROUND-1·EXEC-ROUND-1-DECISIONS(D1·D2·D3·
D4·D6·D7·D8)를 그대로 인용·적용했다. E5 §A 게이트③ 확정(조율자 추가 지시, 신규 위임 #6/대장 6-11 #12)은
검증자 표기가 E2 소유라 본 문서에는 직접적인 표기 변경 대상이 없음을 확인했다(**EVAL-ROUND-24 U2-4/D24-4 —
앵커 ⑯ 존량 전환 규칙 ⓒ(주장 삭제 후 대체) 적용**: 舊 괄호는 "본 문서 안에 <검증자 표기 문자열>이 없다"는
**부재 주장**이었고, 그 주장 문장 자신이 문서 안에 그 문자열을 만들어 재실행 시 스스로를 반증했다 — §C
재검산 블록이 V2-2에서 이미 같은 이유로 존재 재현 형식으로 전환됐는데 본 절만 미전환 잔여였다. 부재 주장을
삭제하고 **존재 재현**으로 대체한다 — 본 문서 §E~§I의 검증자 축이 `qa-verifier`임을 아래 명령으로 판정한다
(→ **≥1**): `awk '/^## E\. 실패/,/^## 신규 위임 목록/' docs/plan/exec/E3-parallel-schedule.md | grep -c "qa-verifier"`.
**자기 매칭 배제 방식 2중**: ① awk 범위의 종점을 `## 신규 위임 목록` 헤더로 잡아 **본 문단 자신을 재현 대상
범위 밖**에 둔다 ② 판정을 부재(=0)가 아니라 존재(≥1)로 세워, 설령 회고 인용이 범위 안에 들어와도 참이
유지된다(D15-3 형식). 舊 문자열 자체는 본문에 재생산하지 않는다 — 재생산이 곧 재발이기 때문이다).

**라운드 2 수정에서 발생한 신규 위임**: 없음 — EXEC-EVAL-ROUND-2·EXEC-ROUND-2-DECISIONS(DD1·DD5)가 이미 확정한
문안만 인용·적용했다. XL 버킷 정의·200만 예산 검산 기준은 각각 E4 §A-5·EXEC-DECISIONS #3을 인용만 했고(정의의
정본 재정의 없음), T-NC-14·15의 `ops-review.md` 경로는 조율자 지시에 이미 지정돼 있어 별도 발주가 불필요하다
(**라운드 2 시점 기록** — T-NC-14의 경로는 라운드 3에서 DDD2에 따라 `broadcast-url-procedure/`로 재확정됐다,
§D T-NC-14 행 참조. T-NC-15는 `ops-review.md`로 불변).

**라운드 3 수정에서 발생한 신규 위임**: 없음 — EXEC-EVAL-ROUND-3·EXEC-ROUND-3-DECISIONS(DDD1·DDD2·DDD3)가 이미
확정한 문안만 인용·적용했다. 사이징 재판정 결과의 E4 §A-6 재계산 동반은 DDD1 자체가 이미 "E3 수정 완료 후 E4
착수" 순서로 명시한 기존 워크플로라 별도 신규 위임이 아니다.

**라운드 25 수정에서 발생한 신규 위임**: 위 **#4**(E4 §A-6 Wave 3 사이징 S→M 재계산 — A팀 수신)·**#5**(E5 §B
의존성 추가 태스크 행 6종→**8종** + 대상 어휘 확장 — C팀 수신)·**#6**(E4 §G #6 리터럴 재현 전환 — A팀 수신,
T-W3-02 편입의 파급) **3건**. 셋 다 K2-1(D25-1) 확정의 파급이며 B팀 소유 파일 밖이라 직접 수정하지 않았다
(#6의 본체인 T-W3-02 소유권 편입 자체는 조율자 판정으로 **B팀이 본 라운드에 직접 반영 완료** — 위임으로 남은 것은
E4 측 재현 문안뿐이다). K2-5(D25-2) 반영분(§D T-NC-17·19 배치 셀의 라벨 범위 표기 → 경계 태스크 표기)은 E3 내부
수정이라 위임이 아니다.

**라운드 26 수정에서 발생한 신규 위임**: **본 문서 발주분 없음**(수신분 1건 — 아래) — J2-4(D26-4) 반영은 §G 검산
블록의 파일 인자를 **전체 경로**(`docs/plan/exec/…`)로 통일하고 실행 컨텍스트(리포 루트)를 문면에 부기한 E3 내부
수정이다. **수신분: C팀 위임 #26**(앵커 ⑨ cwd 판정 항목을 대상 절 전체에 적용한 결과 D26-4 지정 범위 밖에서
발견된 잔여) — E3 몫인 **§C 재검산 블록**에 §G와 동일 조치를 적용해 **같은 라운드에 해소**했고, 함께 §B "정식 등재
판정 2건"의 인라인 리포 실측 1건도 같은 규칙으로 통일했다(C팀 제출 시점 계수 밖이던 잔여). 해소 판정은 탐지 보조
명령의 히트 소멸이다 — 리포 루트에서
`grep -nE '(grep|awk|sed|comm) [^|]*[^/]E[0-9]-[a-z-]+\.md' docs/plan/exec/E3-parallel-schedule.md`를 실행해
`docs/plan/exec/` 접두 없이 문서 파일을 인자로 넘기는 행이 남지 않았음을 확인한다(현재 **빈 출력**). 같은
이슈의 나머지 두 수신처는 조율자 선확정으로 이미 배정돼 있다 — **E4 §G #7 두 명령의 경로 통일 = A팀**,
**E5 §D 앵커 ⑨에 "재현 명령의 실행 컨텍스트(cwd) 명시 여부" 판정 항목 추가 = C팀**. 본 문서가 같은 건을 다시
발주하면 대장(§6-11) 행이 이중 등재된다(라운드 25 #4~#6에서 발주처를 소유자 문서 하나로 모은 판단과 같은 계열).
사이징·웨이브 편성·SOLO 건수·lockfile 8종 배치는 본 라운드에 손대지 않았다(모수 불변 — 재현은 §B python 블록과
위 §G 블록).
