-- N CREW v1b (2026-10-30): 인증번호 용도 분리·5회 제한·원자적 1회 사용 · 초대 코드 연결 보호  [보안 층]
-- 추가만. 기존 인증번호 6건(모두 만료)과 세션은 그대로. 광고 차단 층(v1a)과 독립: 이 층을 되돌려도 광고 차단은 유지
-- 되돌리기: ncrew_v1b_rollback.sql (이 층의 함수만 예전처럼 느슨하게 바꿈, 표·기록 삭제 없음)

alter table public.playn_otp add column if not exists id bigserial;
alter table public.playn_otp add column if not exists purpose text;          -- login / crew / fx / optout / join
alter table public.playn_otp add column if not exists attempts integer not null default 0;
alter table public.playn_otp add column if not exists used_at timestamptz;
alter table public.playn_otp add column if not exists voided_at timestamptz;
alter table public.playn_otp add column if not exists ip_hash text;
alter table public.playn_otp add column if not exists test_run text;
create index if not exists playn_otp_phone_purpose on public.playn_otp(phone, purpose, created_at desc);
create index if not exists playn_otp_created on public.playn_otp(created_at);

-- 1) 발급: 모든 발급을 잠금 하나로 직렬화 (번호·접속·전체 한도를 동시 요청에도 넘지 않음)
--    번호당 1시간 3회(기존과 같음, 용도 합산) · 같은 번호 60초 대기 · 같은 접속 1시간 10회 · 전체 1시간 p_cap(기본 설정값 또는 60)
--    같은 번호·같은 용도의 이전 미사용 번호는 무효
create or replace function public.member_otp_issue(p_phone text, p_purpose text, p_ip_hash text default null, p_test text default null, p_cap integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz; v_last timestamptz; n_h int; n_ip int; n_all int; cap int; v_code text;
begin
  if p_phone !~ '^01[0-9]{8,9}$' then return jsonb_build_object('ok', false, 'error', '휴대폰 번호를 확인해 주세요'); end if;
  if p_purpose not in ('login','crew','fx','optout','join') then return jsonb_build_object('ok', false, 'error', 'bad purpose'); end if;
  perform pg_advisory_xact_lock(hashtext('playn_otp:issue'));
  v_now := clock_timestamp();
  select max(created_at), count(*) into v_last, n_h from playn_otp where phone = p_phone and created_at > v_now - interval '1 hour';
  if v_last is not null and v_last > v_now - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'error', '인증번호는 1분 뒤에 다시 받을 수 있어요', 'reason', 'cooldown'); end if;
  if n_h >= 3 then return jsonb_build_object('ok', false, 'error', '인증번호는 1시간에 3번까지 받을 수 있어요', 'reason', 'phone_hour'); end if;
  if p_ip_hash is not null then
    select count(*) into n_ip from playn_otp where ip_hash = p_ip_hash and created_at > v_now - interval '1 hour';
    if n_ip >= 10 then return jsonb_build_object('ok', false, 'error', '요청이 너무 많아요. 잠시 후 다시 해 주세요', 'reason', 'ip_hour'); end if;
  end if;
  cap := coalesce(p_cap, (select nullif(value, '')::int from playand_config where key = 'ncrew_otp_hourly_cap'), 60);
  select count(*) into n_all from playn_otp where created_at > v_now - interval '1 hour' and test_run is not distinct from p_test;
  if n_all >= cap then return jsonb_build_object('ok', false, 'error', '지금은 인증 요청이 많아요. 잠시 후 다시 해 주세요', 'reason', 'global_hour'); end if;
  update playn_otp set voided_at = v_now where phone = p_phone and purpose = p_purpose and used_at is null and voided_at is null;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into playn_otp(phone, code, created_at, used, purpose, ip_hash, test_run) values (p_phone, v_code, v_now, false, p_purpose, p_ip_hash, p_test);
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- 2) 확인: 같은 번호·같은 용도의 최근 유효 번호 1건을 잠그고 판단. 5분 유효, 5번 틀리면 무효, 맞으면 1번만 사용
--    용도가 다른 번호(예: 동행자용)로는 로그인 확인 불가. 예전 방식으로 만든 번호(purpose 없음)는 쓰지 않음
create or replace function public.member_otp_verify(p_phone text, p_code text, p_purpose text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o playn_otp; v_now timestamptz;
begin
  select * into o from playn_otp
   where phone = p_phone and purpose = p_purpose and used_at is null and voided_at is null and not used
   order by created_at desc limit 1 for update;
  v_now := clock_timestamp();
  if not found or o.created_at <= v_now - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'error', '인증번호가 맞지 않거나 시간이 지났어요', 'reason', 'none'); end if;
  if o.attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', '5번 틀려서 이 인증번호는 쓸 수 없어요. 다시 받아 주세요', 'reason', 'locked'); end if;
  if o.code is distinct from btrim(coalesce(p_code, '')) then
    update playn_otp set attempts = attempts + 1, voided_at = case when attempts + 1 >= 5 then v_now end where id = o.id;
    return jsonb_build_object('ok', false,
      'error', case when o.attempts + 1 >= 5 then '5번 틀려서 이 인증번호는 쓸 수 없어요. 다시 받아 주세요' else '인증번호가 맞지 않아요 (' || (5 - o.attempts - 1) || '번 남음)' end,
      'reason', case when o.attempts + 1 >= 5 then 'locked' else 'wrong' end, 'left', greatest(0, 5 - o.attempts - 1));
  end if;
  update playn_otp set used = true, used_at = v_now where id = o.id;
  return jsonb_build_object('ok', true);
end $$;

-- 3) 로그인: 회원 자격 확인 → 인증번호(login) 확인 → 세션 저장을 한 트랜잭션에서. 저장 실패면 인증번호도 미사용으로 되돌아감
create or replace function public.member_otp_login(p_phone text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; v_token text;
begin
  if not playn_member_ok(p_phone) then return jsonb_build_object('ok', false, 'need_join', true, 'error', 'N CREW 멤버가 아니에요. 먼저 가입해 주세요'); end if;
  r := member_otp_verify(p_phone, p_code, 'login');
  if not (r->>'ok')::boolean then return r; end if;
  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  insert into playn_sessions(token, phone, expires_at) values (v_token, p_phone, clock_timestamp() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

-- 4) 본인 확인 수신 거부: optout 용 인증번호 확인 + 광고만 끔 (회원 상태 그대로)
create or replace function public.playn_optout_verified(p_phone text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  r := member_otp_verify(p_phone, p_code, 'optout');
  if not (r->>'ok')::boolean then return r; end if;
  return playn_optout_apply(p_phone, 'otp');
end $$;

-- 5) 초대 코드 연결 보호: 가입 직후 서버가 준 1회용 가입 표(10분)가 있어야 연결
create table if not exists public.playn_join_tickets (
  token text primary key,
  phone text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.playn_join_tickets enable row level security;
revoke all on table public.playn_join_tickets from public, anon, authenticated;
create index if not exists playn_join_tickets_phone on public.playn_join_tickets(phone);

create or replace function public.playn_join_ticket(p_phone text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare t text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  insert into playn_join_tickets(token, phone, expires_at) values (t, p_phone, clock_timestamp() + interval '10 minutes');
  return t;
end $$;

create or replace function public.playn_ref_attach(p_phone text, p_code text, p_ticket text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare tk playn_join_tickets; m playn_members; v_inv text;
begin
  select * into tk from playn_join_tickets where token = coalesce(p_ticket, '') and phone = p_phone for update;
  if not found or tk.used_at is not null or tk.expires_at <= clock_timestamp() then return jsonb_build_object('ok', false, 'reason', 'ticket'); end if;
  if p_code !~ '^N[A-Z0-9]{5}$' then return jsonb_build_object('ok', false, 'reason', 'code'); end if;
  select * into m from playn_members where phone = p_phone for update;
  if not found or m.referred_by is not null or m.ref_code = p_code then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  select phone into v_inv from playn_members where ref_code = p_code;
  if v_inv is null or v_inv = p_phone then return jsonb_build_object('ok', false, 'reason', 'inviter'); end if;
  update playn_members set referred_by = p_code where phone = p_phone;
  update playn_join_tickets set used_at = clock_timestamp() where token = tk.token;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.member_otp_issue(text, text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.member_otp_verify(text, text, text) from public, anon, authenticated;
revoke execute on function public.member_otp_login(text, text) from public, anon, authenticated;
revoke execute on function public.playn_optout_verified(text, text) from public, anon, authenticated;
revoke execute on function public.playn_join_ticket(text) from public, anon, authenticated;
revoke execute on function public.playn_ref_attach(text, text, text) from public, anon, authenticated;
