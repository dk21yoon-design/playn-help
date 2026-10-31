# NC v1g 동시 실행 시험 (2026-10-31)
- 별도 연결 2개: 임시 Edge Function `playn-nc-locktest`(SUPABASE_DB_URL로 postgres 연결 2개를 따로 열어 트랜잭션 겹치기). 시험 뒤 410 stub(v3, verify_jwt=true)으로 교체
- 시험 번호만: 010-0000-99xx (회원 9901·9902·9903·9905, 회원 없는 번호 9904). 시험 뒤 회원 status=left + 수신 거부 활성, 세션 만료. 삭제 없음
- 결과 원본: playand_log source=nc_v1g_locktest(수정 후 17건), nc_v1g_locktest_pre(수정 전 3건)
- 겹침 방식: (1) 앞 트랜잭션이 회원 행을 잡고 1.5초 대기 뒤 함수 실행, 뒤 트랜잭션은 0.3초 뒤 시작 (2) 앞이 함수 실행 뒤 1.5초 커밋 지연
