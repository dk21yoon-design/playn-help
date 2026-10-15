# Play N 디자인 시스템 (MASTER)

playn.kr의 모든 페이지(홈·지점·관리·관제실 /hq)는 이 파일을 먼저 따른다. 페이지별로 다르게 할 때는 `pages/<페이지>.md`를 만들어 그 부분만 덮어쓴다.
근거: UI/UX Pro Max(nextlevelbuilder, MIT) 우선순위 규칙 + 지금 사이트 실제 토큰. 2026-10-15 정리.

## 1. 색 토큰 (밤 테마, 실제 사용값)
| 토큰 | 값 | 용도 |
|---|---|---|
| --night | #16133F | 기본 배경 |
| --deep | #0E0C2C | 더 깊은 배경·푸터 |
| --panel / --panel2 | #1C1850 / #241F63 | 카드·패널 |
| --line / --line2 | rgba(166,162,214,.16 / .28) | 구분선 |
| --ink | #F3F1FF | 본문 글자 |
| --mute | #B3AFDF | 보조 글자 |
| --dim | #9E9AD6 | 흐린 글자(작은 메타) |
| --lamp / --lamp2 | #FFB547 / #FFC977 | 강조·주요 버튼 (버튼 글자는 #1a1300) |
| --brand | #FF2E6E | 브랜드 핑크 (선·점·큰 제목 강조) |
| 핑크 바탕 글자 버튼 | #E0185E + 흰 글자 | 작은 글자가 올라가는 핑크 바탕 |
| 상태색 | ok #3DDC97 · warn #FFB547 · crit #FF5A5F · info #8FA3FF | 상태 표시에만 사용 |

### 대비 측정 결과 (WCAG, 일반 글자 기준 4.5:1)
- night 배경: ink 15.7 · mute 8.4 · dim 6.7 · lamp 10.0 · brand 4.9 → 통과
- panel2 배경: brand 글자 4.0 → 작은 글자에 핑크 쓰지 않기 (큰 제목·선만)
- 흰 글자 + #FF2E6E 바탕 3.6 → 불합격. 글자가 올라가는 핑크 바탕은 #E0185E(4.7) 사용 (2026-10-15 index·admin·league 수정)
- 진한 글자 + lamp 바탕 10.5 → 주요 버튼 기본

## 2. 글꼴
- 제목: Black Han Sans (Google Fonts) — 숫자 KPI·섹션 제목
- 본문: Pretendard — 기본 16px, 줄간 1.5~1.6, 12px 미만 본문 금지
- 영문 게임 폰트(Russo One 등)는 쓰지 않는다 (한글 미지원)

## 3. 간격·모양
- 여백: --pad clamp(16px,4vw,32px), 4/8 단위 리듬 (8·12·16·24·32·48)
- 둥근 모서리: --r 18px(카드) · --r-sm 10px(작은 요소) · --pill 999px(칩·버튼)
- 움직임: --ease cubic-bezier(.16,1,.3,1), 150~300ms, prefers-reduced-motion이면 끔
- 레이아웃 흔들림(CLS) 금지: 이미지는 크기 지정, 눌림 효과는 색·그림자만

## 4. 우선순위 점검 (UI/UX Pro Max 1→10 순)
1. 접근성: 대비 4.5:1, 이미지 alt, 키보드 포커스 보이기, 아이콘만 있는 버튼엔 aria-label
2. 터치: 누르는 곳 44×44px 이상, 간격 8px 이상, 누르면 바로 반응(로딩 표시)
3. 성능: WebP, 지연 로딩, 자리 미리 잡기
4. 스타일 일관성: 이모지를 아이콘으로 쓰지 않기(SVG), 한 화면에 한 아이콘 계열
5. 반응형: 375px에서 가로 스크롤 없음, 확대 막지 않기
6. 글자·색: 토큰만 쓰기(하드코딩 색 금지), 회색 위 회색 금지
7. 애니메이션: 의미 있을 때만, 퇴장이 등장보다 빠르게
8. 폼: 라벨 보이기(placeholder만 금지), 오류는 칸 옆에, 제출 후 결과 표시
9. 내비: 뒤로 가기 예측 가능, 하단 메뉴 5개 이하, 해시·주소로 바로 들어오기
10. 차트: 범례·툴팁, 색만으로 의미 전달하지 않기

## 5. 납품 전 체크
- [ ] 375 / 768 / 1440px에서 확인 (Playwright 스크린샷)
- [ ] 위 대비표 밖의 새 색을 썼다면 대비 계산
- [ ] reduced-motion 켜고 확인
- [ ] 버튼·링크 전부 포커스 보임, cursor pointer
- [ ] 예약 CTA는 첫 화면에 하나, 스크롤 중간·끝에 반복 (전환: 한 화면 한 메시지)

## 6. 검색 도구 (오프라인, 외부 전송 없음)
```bash
PYTHONPATH=tools/uiux-pro-max/scripts python3 -I tools/uiux-pro-max/scripts/search.py "booking form mobile" --domain ux -n 5
PYTHONPATH=tools/uiux-pro-max/scripts python3 -I tools/uiux-pro-max/scripts/search.py "<제품·분위기 키워드>" --design-system -f markdown
```
domain: ux · style · color · typography · landing · chart · icons · gsap. 결과는 참고 자료이고 이 파일 규칙이 우선.
