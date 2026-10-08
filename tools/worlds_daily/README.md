# 롤드컵 데일리 홍보 (W 시리즈)

매일 18:50 KST, @playn_no.1에 롤드컵 이벤트(playn.kr/worlds) 홍보 캐러셀 1개를 올린다. 기간은 11/15 결승까지.
발행 자체는 Supabase `playn-publish` cron이 맡는다. `playn_ig_queue`에 status `ready`로 넣으면 끝.

## 하루 작업 순서
1. `curl -s -X POST https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-settle -H 'content-type: application/json' -d '{"action":"worlds_public"}'`로 데이터를 받는다. 받는 값: 득표(tally, fan), stage, eliminated, winner.
2. 웹검색 2곳 이상으로 어제 새벽 결과와 오늘 밤에서 내일 새벽 사이 경기(한국시간)를 확인한다. 기준은 LoL Esports 공식 일정이다. 확인이 안 된 경기 시간과 시드는 적지 않는다.
3. `specs/<YYYY-MM-DD>.json`을 작성한다. 형식은 기존 spec을 따른다. 슬라이드는 4장 안팎이고 마지막은 항상 `cta`다. 디스클레이머는 cta에 자동으로 들어간다.
   - `publish_at`: `<date>T09:50:00Z` (18:50 KST)
   - `title`: `W<번호> [롤드컵 데일리] ...`. 번호는 큐에서 마지막 W 번호에 1을 더한다.
   - `caption`: 아래 형식을 지킨다. hook 1줄, ✔ 4줄, `👉 playn.kr/worlds (프로필 링크)`, 디스클레이머, `사진: 플레이앤 매장`, 해시태그.
     - 해시태그는 **5개까지**(인스타 제한, 캡션+첫 댓글 합계). 기본: `#롤드컵 #롤드컵2026 #롤드컵단관 #게임파티룸 #홍대파티룸`. 넘치면 발행 함수가 6번째부터 자동으로 지운다.
     - hook 1줄에 검색어(롤드컵·LCK·팀명 등)를 넣는다. 인스타 검색은 캡션 키워드를 읽는다.
4. 빌드와 업로드: `PLAYN_KEY=<playand_config.intake_key> node tools/worlds_daily/build.mjs tools/worlds_daily/specs/<date>.json`
   - 넘침 오류가 나면 문구를 줄여 다시 빌드한다.
   - 출력된 `out/<date>/insert.sql`을 Supabase에서 실행한다.
5. spec 파일을 커밋하고 push한다. `out/`은 gitignore 대상이다.
6. `playand_log`에 `{source:'worlds_daily', payload:{date,id,title}}`를 남긴다.

## 날짜별 주제 (한국시간)
| 기간 | 단계 | 주제 로테이션 |
|---|---|---|
| 10/12~10/15 | 개막 전, 집계 시작 | 집계 시작 · 지점별 관람 환경 · 플레이인 D-n 알람표 · 픽 현황 |
| 10/16~10/19 | 플레이인 (새벽 3시) | 어젯밤 결과(탈락팀 줄긋기) · 오늘 새벽 경기 · 픽 현황 |
| 10/20~10/23 | 스위스 앞 휴식 | 스위스 진출 팀 · 10만원 구간 D-n · 참여법 |
| 10/24~11/1 | 스위스 (새벽 2~5시) | 매일 결과 + 오늘 경기 + 픽 현황 bars + 10만원 마감 D-n |
| 11/2~11/3 | 10만원 마감 | D-1, D-DAY (11/3 23:59) 강조 |
| 11/4~11/9 | 8강·4강 | 5만원 구간 · 남은 팀 · 결과 |
| 11/10~11/14 | 결승 D-n | 결승 단관 예약 · 픽 현황 최종 |
| 11/15 | 결승 당일 (새벽 4시) | 결과와 정산 안내. 이 날로 시리즈를 끝낸다 |

- 같은 레이아웃을 이틀 연속 첫 장에 쓰지 않는다.
- 사진 `img/`는 매장 실사만 쓴다. AI 이미지는 금지다.
- 같은 사진 반복 금지: 첫 장(cover/count) 사진은 직전 3일 spec과 겹치지 않게 고른다(`grep photo specs/*.json`). 슬라이드 구성(레이아웃 순서)도 전날과 다르게 한다.
- 릴스를 만들 땐 `tools/reelkit/playn_reel_v3.py`를 쓴다. 이 빌더는 서버 공용 클립 기록(playn_clip_registry)으로 모든 시리즈의 영상 재사용을 막는다(PLAYN_KEY 필요).

## 문구 규칙 (사장님 확정)
- 팀명, 경기 결과, 일정 같은 사실은 쓴다.
- 협업, 공식 파트너, 후원처럼 읽히는 표현은 금지다. Riot, 팀, 선수 로고도 쓰지 않는다.
- 톤은 "이런 경기가 있는데 우리 파티룸에서 같이 볼래? 예약할래?"이다.
- 페이백 조건은 그대로 적는다: 10/12~11/14 나이트·통대관 이용 팀, 11/3까지 픽하면 10만원, 그 뒤는 5만원, 팀원 전원 N CREW 가입, 결승 뒤 7일 안에 송금.
- 득표가 0이면 숫자 대신 "아직 1위 없음, 지금 찍으면 네 픽이 1위"로 쓴다.
