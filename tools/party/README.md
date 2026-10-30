# 게임 모임 (가칭 '오늘 한 파티') — 모임 신청 MVP

독립 게임 커뮤니티의 첫 기능. 화면 `party/index.html`(playn.kr/party), 서버 함수 `playn-party`(원본 `playn-party.ts`).

- 로그인 기술만 재사용(`playn_otp`·`playn_sessions`). 회원은 `community_members`로 N CREW와 별개. 자동 가입·문자 동의 승계 없음
- 정원·대기·참여 제안·수락·거절·만료·취소는 DB 함수 `party_join`·`party_respond`·`party_cancel`·`party_sweep`(모임 행 잠금)
- 안내는 `playn_party_notices`에 먼저 기록. 발송 모드 `playand_config.party_sms_mode` = log(기록만, 현재)
- 테스트: 모임 id `party-test*`, 기록 `test_run` 열. 테스트는 모드와 상관없이 발송·관제실 기록 안 함
- 크론 `party-sweep-5min`: 기한 지난 제안 만료 + 빈자리 제안
- 인계: 옵시디언 `00_AI공유/게임 커뮤니티/모임 신청 MVP 인계 (2026-10-30).md`
