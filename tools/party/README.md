# 게임 모임 (가칭 '오늘 한 파티') — 모임 신청 MVP

독립 게임 커뮤니티의 첫 기능. 화면 `party/index.html`(playn.kr/party), 서버 함수 `playn-party`(원본 `playn-party.ts`).

- 로그인 기술만 재사용(`playn_otp`·`playn_sessions`). 회원은 `community_members`로 N CREW와 별개. 자동 가입·문자 동의 승계 없음
- 정원·대기·참여 제안·수락·거절·만료·취소는 DB 함수 `party_join`·`party_respond`·`party_cancel`·`party_sweep`(모임 행 잠금)
- 안내는 `playn_party_notices`에 먼저 기록. 발송 모드 `playand_config.party_sms_mode` = log(기록만, 현재)
- 테스트: 모임 id `party-test*`, 기록 `test_run` 열. 테스트는 모드와 상관없이 발송·관제실 기록 안 함
- 크론 `party-sweep-5min`: 기한 지난 제안 만료 + 빈자리 제안
- 인계: 옵시디언 `00_AI공유/게임 커뮤니티/모임 신청 MVP 인계 (2026-10-30).md`

## 전날 리마인드 (v3, 2026-10-30, 기록 전용)
- 예정 시각: 모임 시작일(한국 날짜) 전날 18:00 KST (`party_remind_due`). 24시간 전이 아님
- 크론 `party-sweep-5min` → `admin_sweep` → `party_sweep` → `party_remind_scan(now)`. 새 크론 없음
- 대상: 게임 모임(kind=party, open/closed)의 `confirmed` 신청자만. 예정 시각 ≤ 지금 < 시작 시각. 미처리 상태 조회라 기준을 놓쳐도 시작 전이면 1회 복구
- 1회 보장: `dedupe_key = reminder:모임:회원:v일정버전` 고유 인덱스. 취소 후 재신청해도 같은 일정이면 다시 안 만듦
- 일정 변경: `start_at` 바뀌면 `sched_version`+1, 이전 버전 미처리 리마인드는 `superseded`(삭제 안 함). 모임 `cancelled` 도 `superseded`
- 발송 판단은 DB `party_dispatch_decide` 한 곳: pending 만 대상 → 무효면 superseded / 안내 수신 꺼짐이면 skipped_pref / 테스트면 logged / log 모드면 logged / test·live 모드만 send
  - logged·skipped·test·superseded 기록은 모드를 live 로 바꿔도 다시 꺼내지 않음 (드라이런 확인)
- 테스트 경로: `party_remind_scan(가짜시각, test_run)` 는 서버 전용(공개 키 실행 불가)이고 그 test_run 모임만 봄
- 마이그레이션 원문은 Supabase `supabase_migrations.schema_migrations` (party_* 4건)
