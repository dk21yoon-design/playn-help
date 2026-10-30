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

## 모임 취소 안내 (v3.6, 2026-10-30, 기록 전용)
- 모임 상태가 open/closed → cancelled 로 실제 바뀔 때 `cancel_round`+1. 이미 취소된 모임을 다시 취소하면 회차 그대로, 안내 추가 없음
- 대상: 그 시점 `confirmed`·`offered`·`waitlist` 신청자. 이미 개인 취소·거절·만료된 사람 제외. 신청 상태는 바꾸지 않음(자동 탈락·환불 없음)
- 중복 방지: (모임, 회원, 취소 회차) 고유 인덱스 `playn_party_notices_event_cancel_once`, dedupe_key `event_cancelled:모임:회원:c회차`
- 판단: 안내 수신 꺼짐·탈퇴면 skipped_pref, 그 외 logged. 발송 모드가 test·live 여도 send 없음
- 재개(cancelled → open/closed): 미처리 취소 안내는 superseded, 이미 logged 된 기록은 남김. 다시 취소하면 다음 회차로 새로 기록
- 관리 화면 `admin_set status=cancelled` 로 만든 안내는 다음 크론(5분)에 판단됨. 서버 함수 변경 없음
- SQL 원문: `sql/migrations/party_v3_6_event_cancelled_notice_log_only.sql`

## 신규 가입 준비 (v3.7 DB · v4 서버 함수, 2026-10-30) — 인증 문자 발송은 계속 꺼짐
- 인증번호는 커뮤니티 전용 표 `community_otp` (N CREW `playn_otp` 와 분리). 세션 표 `playn_sessions` 는 그대로 재사용
- 발급 `community_otp_issue`: 번호 단위 잠금 → 60초 재발송 대기 · 번호당 1시간 3회 · 하루 5회 · 같은 접속(IP 해시) 1시간 10회 · 전체 1시간 30회(설정 `party_otp_hourly_cap`) → 이전 미사용 번호 무효화 → 5분 유효
- 확인 `community_otp_verify`: 최근 유효 번호 1건을 잠그고 판단. 5번 틀리면 무효. 맞으면 1번만 소모(동시 확인도 1건만 성공)
- 가입 `c_join`: 만 14세 이상(필수) · 이용 약관(필수) · 약관 판 `TERMS_VERSION` 일치 필요. 기록 열 terms_version · age14_confirmed_at. 안내·광고 문자는 선택, 기본 꺼짐
- `c_logout`: 세션 만료 처리(삭제 아님). 화면은 게임 모임에서 로그인한 세션(gm_token)만 끝냄. N CREW 로그인(pn_token)은 건드리지 않음
- `c_leave`/`community_member_leave`: 진행 중 신청이 있으면 막음. 상태 left · 닉네임 가림 · 문자 수신 모두 끔. 지난 신청 기록은 남김
- 약관·개인정보 안내 초안: `party/terms/` (noindex, 사장님 확정 전 실제 가입 받지 않음)
- 실제 발송을 켜려면 `playand_config.party_otp_send = on` (사장님 결정)
