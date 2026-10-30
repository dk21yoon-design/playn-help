-- v3.7 (2026-10-30): 게임 모임 신규 가입 준비 — 인증번호 보안 보완 + 가입 동의 기록 + 탈퇴
-- 추가만 한다. 기존 표·데이터 삭제 없음. N CREW 표(playn_otp·playn_members) 변경 없음
-- 인증 문자 실제 발송은 계속 꺼짐 (playand_config.party_otp_send 미설정)

-- 1) 커뮤니티 전용 인증번호 표 (N CREW playn_otp 와 분리: 시도 횟수·만료·무효화를 따로 관리)
create table if not exists public.community_otp (
  id bigserial primary key,
  phone text not null,
  code text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  voided_at timestamptz,
  ip_hash text,
  test_run text
);
alter table public.community_otp enable row level security;
revoke all on table public.community_otp from public, anon, authenticated;
revoke all on sequence public.community_otp_id_seq from public, anon, authenticated;
create index if not exists community_otp_phone_created on public.community_otp(phone, created_at desc);
create index if not exists community_otp_ip_created on public.community_otp(ip_hash, created_at desc) where ip_hash is not null;
create index if not exists community_otp_created on public.community_otp(created_at);

-- 2) 가입 동의 기록 열 (기존 행은 그대로)
alter table public.community_members add column if not exists terms_version text;
alter table public.community_members add column if not exists age14_confirmed_at timestamptz;
alter table public.community_members add column if not exists left_at timestamptz;

-- 3) 인증번호 발급: 번호 단위 잠금 후 한도 확인 → 이전 미사용 번호 무효화 → 새 번호
--    한도: 같은 번호 60초 재발송 대기 · 1시간 3회 · 하루 5회 / 같은 접속 1시간 10회 / 전체 1시간 p_global_cap(기본 설정값, 없으면 30)
create or replace function public.community_otp_issue(p_phone text, p_ip_hash text default null, p_test text default null, p_global_cap integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz; v_last timestamptz; n_h int; n_d int; n_ip int; n_all int; cap int; v_code text;
begin
  if p_phone !~ '^01[0-9]{8,9}$' then return jsonb_build_object('ok', false, 'error', '휴대폰 번호를 확인해 주세요'); end if;
  perform pg_advisory_xact_lock(hashtext('community_otp:' || p_phone));
  v_now := clock_timestamp();
  select max(created_at), count(*) filter (where created_at > v_now - interval '1 hour'), count(*)
    into v_last, n_h, n_d from community_otp where phone = p_phone and created_at > v_now - interval '1 day';
  if v_last is not null and v_last > v_now - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'error', '인증번호는 1분 뒤에 다시 받을 수 있어요', 'reason', 'cooldown'); end if;
  if n_h >= 3 then return jsonb_build_object('ok', false, 'error', '인증번호는 1시간에 3번까지 받을 수 있어요', 'reason', 'phone_hour'); end if;
  if n_d >= 5 then return jsonb_build_object('ok', false, 'error', '오늘은 인증번호를 더 받을 수 없어요. 내일 다시 해 주세요', 'reason', 'phone_day'); end if;
  if p_ip_hash is not null then
    select count(*) into n_ip from community_otp where ip_hash = p_ip_hash and created_at > v_now - interval '1 hour';
    if n_ip >= 10 then return jsonb_build_object('ok', false, 'error', '요청이 너무 많아요. 잠시 후 다시 해 주세요', 'reason', 'ip_hour'); end if;
  end if;
  cap := coalesce(p_global_cap, (select nullif(value, '')::int from playand_config where key = 'party_otp_hourly_cap'), 30);
  select count(*) into n_all from community_otp where created_at > v_now - interval '1 hour' and test_run is not distinct from p_test;
  if n_all >= cap then return jsonb_build_object('ok', false, 'error', '지금은 인증 요청이 많아요. 잠시 후 다시 해 주세요', 'reason', 'global_hour'); end if;
  update community_otp set voided_at = v_now where phone = p_phone and used_at is null and voided_at is null;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into community_otp(phone, code, created_at, expires_at, ip_hash, test_run)
    values (p_phone, v_code, v_now, v_now + interval '5 minutes', p_ip_hash, p_test);
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- 4) 인증번호 확인: 가장 최근 유효 번호 1건을 잠그고 판단. 틀리면 시도 +1, 5번 틀리면 무효. 맞으면 한 번만 소모
create or replace function public.community_otp_verify(p_phone text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o community_otp; v_now timestamptz;
begin
  select * into o from community_otp
   where phone = p_phone and used_at is null and voided_at is null
   order by created_at desc limit 1 for update;
  v_now := clock_timestamp();
  if not found or o.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'error', '인증번호가 없거나 시간이 지났어요. 다시 받아 주세요', 'reason', 'none'); end if;
  if o.attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', '5번 틀려서 이 인증번호는 쓸 수 없어요. 다시 받아 주세요', 'reason', 'locked'); end if;
  if o.code is distinct from btrim(coalesce(p_code, '')) then
    update community_otp set attempts = attempts + 1, voided_at = case when attempts + 1 >= 5 then v_now end where id = o.id;
    return jsonb_build_object('ok', false, 'error', case when o.attempts + 1 >= 5 then '5번 틀려서 이 인증번호는 쓸 수 없어요. 다시 받아 주세요' else '인증번호가 맞지 않아요 (' || (5 - o.attempts - 1) || '번 남음)' end,
      'reason', case when o.attempts + 1 >= 5 then 'locked' else 'wrong' end, 'left', greatest(0, 5 - o.attempts - 1));
  end if;
  update community_otp set used_at = v_now where id = o.id;
  return jsonb_build_object('ok', true, 'otp_id', o.id);
end $$;

-- 5) 탈퇴: 진행 중 신청이 있으면 막음(먼저 취소). 닉네임 가리고 안내·광고 수신 끔. 신청 기록은 남김
create or replace function public.community_member_leave(p_phone text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m community_members; n int; v_now timestamptz := clock_timestamp();
begin
  select * into m from community_members where phone = p_phone for update;
  if not found or m.status <> 'active' then return jsonb_build_object('ok', false, 'error', '가입된 회원이 아니에요'); end if;
  select count(*) into n from playn_party_rsvps r join playn_events e on e.id = r.event_id
   where r.phone = p_phone and r.status in ('confirmed','offered','waitlist') and e.status in ('open','closed') and e.end_at > v_now;
  if n > 0 then return jsonb_build_object('ok', false, 'error', '진행 중인 신청 ' || n || '건을 먼저 취소해 주세요', 'active', n); end if;
  update community_members set status = 'left', nick = '탈퇴 회원', left_at = v_now, updated_at = v_now,
    notify_sms = false, notify_changed_at = case when notify_sms then v_now else notify_changed_at end,
    marketing_sms = false, marketing_changed_at = case when marketing_sms then v_now else marketing_changed_at end
   where phone = p_phone;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.community_otp_issue(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.community_otp_verify(text, text) from public, anon, authenticated;
revoke execute on function public.community_member_leave(text) from public, anon, authenticated;
