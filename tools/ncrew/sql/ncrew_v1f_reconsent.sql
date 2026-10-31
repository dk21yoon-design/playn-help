-- N CREW v1f (2026-10-31): 광고 재동의 = 수신 거부 기록을 지우지 않고 '철회' 표시 + 이력 보관
-- 사장님 결정(13:13 "두개 다 해"): ① 기록을 따로 보관 ② 지우지 않는 철회 표시 기능. 철회 표시가 있으면 삭제가 필요 없어 원래 기록은 지우지 않음
-- 유효한 수신 거부 = playn_optout 행이 있고 revoked_at 이 비어 있음. 광고 판단·대상·트리거·가입·캠페인 발송 모두 이 기준으로 바꿈
-- 재동의는 관리자(서버 키)만 실행. 고객 화면에는 '광고 켜기'를 만들지 않음
-- 다시 수신 거부하면 철회 표시를 지우고 다시 유효해짐. 모든 변화는 playn_optout_history 에 남김

alter table public.playn_optout add column if not exists revoked_at timestamptz;
alter table public.playn_optout add column if not exists revoked_by text;
alter table public.playn_optout add column if not exists revoke_note text;

create table if not exists public.playn_optout_history (
  id bigserial primary key,
  phone text not null,
  event text not null check (event in ('reconsent', 're_optout')),
  snapshot jsonb not null,          -- 바뀌기 전 playn_optout 행 그대로
  actor text,
  note text,
  at timestamptz not null default now()
);
alter table public.playn_optout_history enable row level security;
revoke all on table public.playn_optout_history from public, anon, authenticated;
revoke all on sequence public.playn_optout_history_id_seq from public, anon, authenticated;
create index if not exists playn_optout_history_phone on public.playn_optout_history(phone, at desc);

create or replace function public.playn_optout_active(p_phone text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from playn_optout where phone = p_phone and revoked_at is null);
$$;

-- 수신 거부 기록 남기기(공통). 철회된 행이 있으면 이력에 남기고 다시 유효하게
create or replace function public.playn_optout_mark(p_phone text, p_source text, p_method text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare o playn_optout;
begin
  select * into o from playn_optout where phone = p_phone for update;
  if not found then
    insert into playn_optout(phone, source, method) values (p_phone, p_source, p_method) on conflict (phone) do nothing;
  elsif o.revoked_at is not null then
    insert into playn_optout_history(phone, event, snapshot, actor, note) values (p_phone, 're_optout', to_jsonb(o), p_method, null);
    update playn_optout set revoked_at = null, revoked_by = null, revoke_note = null, source = p_source, method = p_method, created_at = now() where phone = p_phone;
  end if;
end $$;

create or replace function public.playn_optout_apply(p_phone text, p_method text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform playn_optout_mark(p_phone, 'site', p_method);
  update playn_members set marketing_agree = false, night_agree = false, updated_at = now() where phone = p_phone and (marketing_agree or night_agree);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.playn_optout_by_link(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_phone text;
begin
  select phone into v_phone from playn_optout_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', '수신 거부 링크가 올바르지 않아요'); end if;
  perform playn_optout_mark(v_phone, 'link', 'link');
  update playn_members set marketing_agree = false, night_agree = false, updated_at = now() where phone = v_phone and (marketing_agree or night_agree);
  return jsonb_build_object('ok', true, 'tail', right(v_phone, 4));
end $$;

create or replace function public.playn_self_optout(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s playn_sessions; m playn_members;
begin
  select * into s from playn_sessions where token = coalesce(p_token, '');
  if not found or s.expires_at < now() then return jsonb_build_object('ok', false, 'expired', true, 'error', '다시 로그인해 주세요'); end if;
  select * into m from playn_members where phone = s.phone for update;
  if not found then return jsonb_build_object('ok', false, 'expired', true, 'error', '다시 로그인해 주세요'); end if;
  if playn_optout_active(s.phone) and not m.marketing_agree and not m.night_agree then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  perform playn_optout_mark(s.phone, 'me', 'me_session');
  update playn_members set marketing_agree = false, night_agree = false, updated_at = now()
   where phone = s.phone and (marketing_agree or night_agree);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

create or replace function public.playn_ad_ok(p_phone text, p_at timestamptz default now())
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from playn_members m where m.phone = p_phone and m.status = 'active' and m.marketing_agree)
     and not playn_optout_active(p_phone)
     and extract(hour from p_at at time zone 'Asia/Seoul') between 8 and 20
$$;

create or replace function public.playn_ad_state(p_phone text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'on', coalesce((select marketing_agree from playn_members where phone = p_phone), false) and not playn_optout_active(p_phone),
    'optout', playn_optout_active(p_phone));
$$;

create or replace view public.playn_ad_audience with (security_invoker = true) as
  select phone, name from playn_members m
   where status = 'active' and marketing_agree
     and not exists (select 1 from playn_optout o where o.phone = m.phone and o.revoked_at is null);
revoke all on public.playn_ad_audience from public, anon, authenticated;

create or replace function public.playn_members_ad_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.marketing_agree is true
     and playn_optout_active(new.phone)
     and coalesce(current_setting('playn.ad_reconsent', true), '') <> 'on' then
    new.marketing_agree := false;
    new.night_agree := false;
  end if;
  if tg_op = 'INSERT' or new.marketing_agree is distinct from old.marketing_agree then
    new.marketing_changed_at := clock_timestamp();
  end if;
  return new;
end $$;

-- 재동의 (관리자 전용). 수신 거부 기록은 지우지 않고 철회 표시, 바뀌기 전 행은 이력에 보관
create or replace function public.playn_ad_reconsent(p_phone text, p_actor text, p_note text, p_night boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o playn_optout; m playn_members; v_had boolean := false;
begin
  if coalesce(btrim(p_actor), '') = '' or coalesce(btrim(p_note), '') = '' then return jsonb_build_object('ok', false, 'error', '처리자와 근거가 필요해요'); end if;
  select * into m from playn_members where phone = p_phone for update;
  if not found or m.status <> 'active' then return jsonb_build_object('ok', false, 'error', '활성 회원이 아니에요'); end if;
  select * into o from playn_optout where phone = p_phone for update;
  if found and o.revoked_at is null then
    v_had := true;
    insert into playn_optout_history(phone, event, snapshot, actor, note) values (p_phone, 'reconsent', to_jsonb(o), p_actor, p_note);
    update playn_optout set revoked_at = now(), revoked_by = p_actor, revoke_note = p_note where phone = p_phone;
  end if;
  perform set_config('playn.ad_reconsent', 'on', true);
  update playn_members set marketing_agree = true, night_agree = coalesce(p_night, false), agreed_at = now(), updated_at = now() where phone = p_phone;
  perform set_config('playn.ad_reconsent', '', true);
  return jsonb_build_object('ok', true, 'had_optout', v_had);
end $$;

revoke execute on function public.playn_optout_active(text) from public, anon, authenticated;
revoke execute on function public.playn_optout_mark(text, text, text) from public, anon, authenticated;
revoke execute on function public.playn_ad_reconsent(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.playn_optout_active(text) to service_role;
grant execute on function public.playn_optout_mark(text, text, text) to service_role;
grant execute on function public.playn_ad_reconsent(text, text, text, boolean) to service_role;
-- playn_member_join·playn_campaign_tick: 현재 정의에서 수신 거부 판단 한 줄만 바꿔 다시 정의 (나머지 코드는 그대로)
do $f$
declare d text;
  o1 text := 'exists(select 1 from playn_optout where phone = p_phone)';
  o2 text := 'exists (select 1 from playn_optout o where o.phone=r.phone)';
begin
  d := pg_get_functiondef('public.playn_member_join(text,text,text,text,boolean,boolean)'::regprocedure);
  if position(o1 in d) = 0 then raise exception 'member_join 기준 문구 없음'; end if;
  execute replace(d, o1, 'playn_optout_active(p_phone)');
  d := pg_get_functiondef('public.playn_campaign_tick()'::regprocedure);
  if position(o2 in d) = 0 then raise exception 'campaign_tick 기준 문구 없음'; end if;
  execute replace(d, o2, 'playn_optout_active(r.phone)');
end $f$;
