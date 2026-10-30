-- v3.8 (2026-10-30): 인증 경계 보완 — 발급 한도 원자화 · 커뮤니티 전용 세션 · 탈퇴/신청 경합
-- 추가·교체만. 표·데이터 삭제 없음. N CREW 표(playn_sessions·playn_otp·playn_members) 쓰기 없음(브리지는 읽기만)

-- 1) 커뮤니티 전용 세션 표. 게임 모임 서버만 읽는다. N CREW 서버는 이 표를 모름
create table if not exists public.community_sessions (
  token text primary key,
  phone text not null,
  source text not null check (source in ('otp','ncrew_bridge')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  test_run text
);
alter table public.community_sessions enable row level security;
revoke all on table public.community_sessions from public, anon, authenticated;
create index if not exists community_sessions_phone on public.community_sessions(phone);

-- 2) 발급: 모든 발급을 하나의 잠금으로 직렬화 (번호·접속·전체 한도 확인과 삽입 사이에 끼어들 수 없음)
--    잠금은 이 키 하나만 쓰므로 교착 없음. 한도 값은 그대로
create or replace function public.community_otp_issue(p_phone text, p_ip_hash text default null, p_test text default null, p_global_cap integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz; v_last timestamptz; n_h int; n_d int; n_ip int; n_all int; cap int; v_code text;
begin
  if p_phone !~ '^01[0-9]{8,9}$' then return jsonb_build_object('ok', false, 'error', '휴대폰 번호를 확인해 주세요'); end if;
  perform pg_advisory_xact_lock(hashtext('community_otp:issue'));
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

-- 3) 인증번호 확인 + 세션 발급을 한 트랜잭션으로. 세션 저장이 실패하면 인증번호 소모도 함께 되돌림
create or replace function public.community_otp_login(p_phone text, p_code text, p_test text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; v_token text;
begin
  r := community_otp_verify(p_phone, p_code);
  if not (r->>'ok')::boolean then return r; end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into community_sessions(token, phone, source, expires_at, test_run)
    values (v_token, p_phone, 'otp', clock_timestamp() + interval '30 days', p_test);
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

-- 4) N CREW 로그인으로 들어오기: 사용자가 화면에서 직접 눌렀을 때만. N CREW 세션은 읽기만 하고 바꾸지 않음
--    커뮤니티 세션 만료는 N CREW 세션 만료보다 늦지 않게
create or replace function public.community_session_bridge(p_ncrew_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s record; v_token text; v_exp timestamptz;
begin
  if length(coalesce(p_ncrew_token, '')) < 16 then return jsonb_build_object('ok', false, 'error', 'N CREW 로그인이 필요해요'); end if;
  select phone, expires_at into s from playn_sessions where token = p_ncrew_token;
  if not found or s.expires_at <= clock_timestamp() then return jsonb_build_object('ok', false, 'error', 'N CREW 로그인이 끝났어요. 휴대폰 인증으로 들어와 주세요'); end if;
  v_exp := least(s.expires_at, clock_timestamp() + interval '30 days');
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into community_sessions(token, phone, source, expires_at) values (v_token, s.phone, 'ncrew_bridge', v_exp);
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

-- 5) 커뮤니티 로그아웃: community_sessions 의 그 토큰만. 다른 표는 건드리지 않음
create or replace function public.community_logout(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update community_sessions set revoked_at = clock_timestamp() where token = p_token and revoked_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'revoked', n);
end $$;

-- 6) 탈퇴: 회원 행 잠금(FOR UPDATE) → 진행 중 신청 확인 → 탈퇴 + 이 회원의 커뮤니티 세션 모두 끝냄
create or replace function public.community_member_leave(p_phone text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m community_members; n int; v_now timestamptz;
begin
  select * into m from community_members where phone = p_phone for update;
  v_now := clock_timestamp();
  if not found or m.status <> 'active' then return jsonb_build_object('ok', false, 'error', '가입된 회원이 아니에요'); end if;
  select count(*) into n from playn_party_rsvps r join playn_events e on e.id = r.event_id
   where r.phone = p_phone and r.status in ('confirmed','offered','waitlist') and e.status in ('open','closed') and e.end_at > v_now;
  if n > 0 then return jsonb_build_object('ok', false, 'error', '진행 중인 신청 ' || n || '건을 먼저 취소해 주세요', 'active', n); end if;
  update community_members set status = 'left', nick = '탈퇴 회원', left_at = v_now, updated_at = v_now,
    notify_sms = false, notify_changed_at = case when notify_sms then v_now else notify_changed_at end,
    marketing_sms = false, marketing_changed_at = case when marketing_sms then v_now else marketing_changed_at end
   where phone = p_phone;
  update community_sessions set revoked_at = v_now where phone = p_phone and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- 7) 신청: 모임 잠금 → 회원 행 공유 잠금(FOR SHARE) 후 active 확인. 탈퇴(FOR UPDATE)와 서로 기다림
--    탈퇴가 먼저 끝나면 left 를 보고 거절, 신청이 먼저면 탈퇴가 신청을 보고 막힘
--    잠금 순서: 신청은 모임→회원, 탈퇴는 회원만(모임 잠금 없음) → 교착 없음
create or replace function public.party_join(p_event text, p_phone text, p_name text, p_test text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare ev playn_events; r playn_party_rsvps; held int; waiting int; pos int; nid bigint; v_now timestamptz; v_ms text;
begin
  select * into ev from playn_events where id = p_event and kind = 'party' for update;
  if not found then return jsonb_build_object('ok', false, 'error', '모임을 찾지 못했어요'); end if;
  select status into v_ms from community_members where phone = p_phone for share;   -- v3.8
  if v_ms is distinct from 'active' then return jsonb_build_object('ok', false, 'need_join', true, 'error', '게임 모임 가입이 먼저 필요해요'); end if;
  v_now := clock_timestamp();   -- v3.5: 잠금 획득 뒤 판단 시각
  if ev.status <> 'open' then return jsonb_build_object('ok', false, 'error', '지금은 신청을 받지 않아요'); end if;
  if ev.start_at <= v_now then return jsonb_build_object('ok', false, 'error', '이미 시작된 모임이에요'); end if;
  if coalesce(ev.apply_until, ev.start_at) < v_now then return jsonb_build_object('ok', false, 'error', '신청이 마감됐어요'); end if;
  select * into r from playn_party_rsvps where event_id = p_event and phone = p_phone and status in ('confirmed','waitlist','offered');
  if found then return jsonb_build_object('ok', true, 'dup', true, 'status', r.status, 'rsvp_id', r.id); end if;
  select count(*) filter (where status in ('confirmed','offered')), count(*) filter (where status = 'waitlist')
    into held, waiting from playn_party_rsvps where event_id = p_event;
  insert into playn_party_rsvps(event_id, phone, name, status, test_run)
    values (p_event, p_phone, p_name, case when held < ev.cap and waiting = 0 then 'confirmed' else 'waitlist' end, p_test)
    returning * into r;
  if r.status = 'waitlist' then
    select count(*) into pos from playn_party_rsvps where event_id = p_event and status = 'waitlist' and id <= r.id;
  end if;
  nid := party_notice(r, ev, r.status, pos);
  return jsonb_build_object('ok', true, 'status', r.status, 'rsvp_id', r.id, 'position', pos,
    'notices', case when nid is null then '[]'::jsonb else jsonb_build_array(nid) end);
end $$;

-- 8) 제안 수락도 같은 규칙 (거절은 회원 상태와 상관없이 허용)
create or replace function public.party_respond(p_event text, p_phone text, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare ev playn_events; r playn_party_rsvps; ids jsonb := '[]'::jsonb; nid bigint; v_now timestamptz; v_ms text;
begin
  select * into ev from playn_events where id = p_event and kind = 'party' for update;
  if not found then return jsonb_build_object('ok', false, 'error', '모임을 찾지 못했어요'); end if;
  select * into r from playn_party_rsvps where event_id = p_event and phone = p_phone and status = 'offered' for update;
  if not found then return jsonb_build_object('ok', false, 'error', '응답할 참여 제안이 없어요'); end if;
  if p_accept then
    select status into v_ms from community_members where phone = p_phone for share;   -- v3.8
    if v_ms is distinct from 'active' then return jsonb_build_object('ok', false, 'need_join', true, 'error', '게임 모임 가입이 먼저 필요해요'); end if;
  end if;
  v_now := clock_timestamp();   -- v3.5
  if p_accept and (ev.status not in ('open','closed') or ev.start_at <= v_now) then
    return jsonb_build_object('ok', false, 'error', case when ev.status not in ('open','closed') then '취소된 모임이라 수락할 수 없어요' else '이미 시작된 모임이라 수락할 수 없어요' end);
  end if;
  if r.offer_expires_at <= v_now then
    update playn_party_rsvps set status = 'expired', closed_at = now() where id = r.id returning * into r;
    nid := party_notice(r, ev, 'expired'); if nid is not null then ids := ids || to_jsonb(nid); end if;
    ids := ids || party_fill(ev);
    return jsonb_build_object('ok', false, 'error', '수락 기한이 지났어요', 'notices', ids);
  end if;
  if p_accept then
    update playn_party_rsvps set status = 'confirmed', accepted_at = now() where id = r.id returning * into r;
    nid := party_notice(r, ev, 'accepted');
  else
    update playn_party_rsvps set status = 'declined', closed_at = now() where id = r.id returning * into r;
    nid := party_notice(r, ev, 'declined');
  end if;
  if nid is not null then ids := ids || to_jsonb(nid); end if;
  if not p_accept then ids := ids || party_fill(ev); end if;
  return jsonb_build_object('ok', true, 'status', r.status, 'notices', ids);
end $$;

revoke execute on function public.community_otp_issue(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.community_otp_login(text, text, text) from public, anon, authenticated;
revoke execute on function public.community_session_bridge(text) from public, anon, authenticated;
revoke execute on function public.community_logout(text) from public, anon, authenticated;
revoke execute on function public.community_member_leave(text) from public, anon, authenticated;
revoke execute on function public.party_join(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.party_respond(text, text, boolean) from public, anon, authenticated;
