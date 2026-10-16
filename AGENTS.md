# playn-help (playn.kr) 작업 기준

모든 AI(Claude·Gemini·Cursor·Codex)가 이 파일 하나를 기준으로 삼는다. 규칙을 바꿀 때는 이 파일만 고친다.
- `CLAUDE.md`: 이 파일을 불러오기만 한다 (Claude Code용)
- `.cursor/rules/playn-project.mdc`: Cursor 전용 안내만 둔다

## 프로젝트
- 플레이앤(Play N) 실내 이스포츠 아레나 & 루프탑 바베큐 공간 웹페이지 고도화 프로젝트
- 사이트 playn.kr · GitHub Pages 정적 배포 · 빌드 도구 없음
- 브랜드 표기는 Play N (N = AND). & 표기 쓰지 않는다
- 관제실은 `hq/index.html` 한 파일(CSS·JS 포함)

## 주요 기능
1. 무지연 대시보드
2. 하단 고정 스마트 견적 바
3. 듀얼 무드 스위처
4. 게이밍 기어 월 투표

## 역할 분담
- Gemini: 전체 UI/UX 기획, 코드 감사(리뷰). 기획안과 감사 의견을 내고 코드를 크게 직접 고치지 않는다
- Claude: 실제 컴포넌트 구현과 디버깅

## 작업 규칙
- 화면을 만들거나 고칠 때: `design-system/playn/MASTER.md`를 먼저 읽고 토큰·대비·체크리스트를 따른다. 세부 UX 규칙은 `tools/uiux-pro-max` 검색 도구(오프라인)로 찾는다.
- Supabase(bjrgtoyjrggxmdexnwib) 표·함수를 새로 만들 때: RLS 켜기, 공개 키(anon·authenticated)에서 security definer 함수 실행 권한 빼기(`revoke execute ... from public, anon, authenticated`), `set search_path = public, pg_temp`, 자주 거르는 열에 인덱스. 바꾼 뒤 advisor(security) 다시 확인.
- 페이지 문구·SEO: 제목 60자 안, 설명 80~150자, h1 하나, 이미지 alt, 예약 CTA는 첫 화면 + 끝. 한국어 문구는 AI 티 제거 규칙(번역투·AI 관용구·연결어미 쉼표 금지).
- 키·토큰은 코드·노트·채팅에 쓰지 않는다. 커밋 후 GitHub Pages 배포는 1~2분.
- 작업이 끝나면 옵시디언 `00_AI공유/HANDOFF.md`에 한 줄 남긴다.
