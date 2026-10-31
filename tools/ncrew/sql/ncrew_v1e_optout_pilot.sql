-- N CREW v1e (준비만, 아직 적용 안 함): 인증번호로 본인 확인 후 수신 거부 — 지정 번호 제한 시험
-- 전역 스위치(ncrew_optout_mode=verified)는 그대로 꺼 둠. 이 시험은 아래 표에 들어간 번호에만 적용
-- 켜는 법: playand_config ncrew_optout_pilot=on + 시험 번호 등록. 끄는 법: ncrew_optout_pilot=off (서버 재배포 필요 없음)
-- 표에 없는 번호는 지금과 똑같이 번호 입력(legacy) 수신 거부. /stop/ 링크·내 N CREW 끄기도 그대로
-- 삭제 없음. 시험 번호는 끌 때 active=false 로만 바꿈

create table if not exists public.ncrew_optout_pilot_phones (
  phone text primary key check (phone ~ '^01[0-9]{8,9}$'),
  active boolean not null default true,
  note text,
  added_at timestamptz not null default now()
);
alter table public.ncrew_optout_pilot_phones enable row level security;
revoke all on table public.ncrew_optout_pilot_phones from public, anon, authenticated;

-- 이 번호가 지금 시험 대상인가 (스위치 on + 표에 active)
create or replace function public.ncrew_optout_pilot_on(p_phone text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select value from playand_config where key = 'ncrew_optout_pilot'), 'off') = 'on'
     and exists(select 1 from ncrew_optout_pilot_phones where phone = p_phone and active);
$$;

-- 시험 인증번호 발급: 시험 대상 확인 → 시험 전체 발송 한도 확인 → 기존 발급 함수(번호당 60초·1시간 3회, 접속당 1시간 10회, 5회 실패 잠금)
-- 한도: playand_config ncrew_optout_pilot_cap (없으면 5). 시험 발급은 test_run='NCREW-OPTOUT-PILOT' 로 남겨 셈
create or replace function public.ncrew_optout_pilot_issue(p_phone text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cap int; n int; r jsonb;
begin
  if not ncrew_optout_pilot_on(p_phone) then return jsonb_build_object('ok', false, 'reason', 'not_pilot'); end if;
  perform pg_advisory_xact_lock(hashtext('ncrew_optout_pilot:issue'));
  cap := coalesce((select nullif(value, '')::int from playand_config where key = 'ncrew_optout_pilot_cap'), 5);
  select count(*) into n from playn_otp where test_run = 'NCREW-OPTOUT-PILOT';
  if n >= cap then return jsonb_build_object('ok', false, 'reason', 'pilot_cap', 'error', '시험 발송 한도를 다 썼어요'); end if;
  r := member_otp_issue(p_phone, 'optout', p_ip_hash, 'NCREW-OPTOUT-PILOT', 1000);
  return r || jsonb_build_object('pilot_sent_before', n, 'pilot_cap', cap);
end $$;

revoke execute on function public.ncrew_optout_pilot_on(text) from public, anon, authenticated;
revoke execute on function public.ncrew_optout_pilot_issue(text, text) from public, anon, authenticated;
grant execute on function public.ncrew_optout_pilot_on(text) to service_role;
grant execute on function public.ncrew_optout_pilot_issue(text, text) to service_role;
