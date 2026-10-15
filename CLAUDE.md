# playn-help (playn.kr) 작업 규칙

- 화면을 만들거나 고칠 때: `design-system/playn/MASTER.md`를 먼저 읽고 토큰·대비·체크리스트를 따른다. 세부 UX 규칙은 `tools/uiux-pro-max` 검색 도구(오프라인)로 찾는다.
- Supabase(bjrgtoyjrggxmdexnwib) 표·함수를 새로 만들 때: RLS 켜기, 공개 키(anon·authenticated)에서 security definer 함수 실행 권한 빼기(`revoke execute ... from public, anon, authenticated`), `set search_path = public, pg_temp`, 자주 거르는 열에 인덱스. 바꾼 뒤 advisor(security) 다시 확인.
- 페이지 문구·SEO: 제목 60자 안, 설명 80~150자, h1 하나, 이미지 alt, 예약 CTA는 첫 화면 + 끝. 한국어 문구는 AI 티 제거 규칙(번역투·AI 관용구·연결어미 쉼표 금지).
- 키·토큰은 코드·노트·채팅에 쓰지 않는다. 커밋 후 GitHub Pages 배포는 1~2분.
- 작업이 끝나면 옵시디언 `00_AI공유/HANDOFF.md`에 한 줄 남긴다.
