-- N CREW v1a (2026-10-30): 광고 수신 거부와 회원 상태 분리 · 광고 대상 판단 통일  [광고 차단 층]
-- 추가만. 기존 표·데이터·수신 거부 기록 삭제 없음. 이 층은 보안 층(v1b)을 되돌려도 그대로 남는다
-- 서버 함수를 옛 버전으로 되돌려도 아래 트리거가 수신 거부 번호의 광고 동의를 다시 켜지 못하게 막는다

alter table public.playn_members add column if not exists marketing_changed_at timestamptz;
alter table public.playn_members add column if not exists withdrawn_at timestamptz;   -- 실제 탈퇴(별도 기능, 아직 미구현) 예약 열
alter table public.playn_optout add column if not exists method text;                 -- site_legacy / link / otp

-- 1) 광고 동의 보호: 수신 거부 기록이 있는 번호는 어떤 경로(가입·재가입·체크인·옛 코드)로도 광고 동의가 켜지지 않음
--    다시 받으려면 본인 인증 뒤 재동의 기능이 트랜잭션 안에서 playn.ad_reconsent=on 을 켜야 함(재동의 기능은 아직 없음)
create or replace function public.playn_members_ad_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.marketing_agree is true
     and exists (select 1 from playn_optout o where o.phone = new.phone)
     and coalesce(current_setting('playn.ad_reconsent', true), '') <> 'on' then
    new.marketing_agree := false;
    new.night_agree := false;
  end if;
  if tg_op = 'INSERT' or new.marketing_agree is distinct from old.marketing_agree then
    new.marketing_changed_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger playn_members_ad_guard before insert or update on public.playn_members
  for each row execute function public.playn_members_ad_guard();

-- 2) 광고 대상 판단 (모든 광고 경로가 이것만 씀)
--    활성 회원 + 광고 동의 + 수신 거부 기록 없음 + 한국 시각 08:00~20:59
create or replace function public.playn_ad_ok(p_phone text, p_at timestamptz default now())
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from playn_members m where m.phone = p_phone and m.status = 'active' and m.marketing_agree)
     and not exists (select 1 from playn_optout o where o.phone = p_phone)
     and extract(hour from p_at at time zone 'Asia/Seoul') between 8 and 20
$$;
create or replace view public.playn_ad_audience with (security_invoker = on) as
  select m.phone, m.name from public.playn_members m
  where m.status = 'active' and m.marketing_agree
    and not exists (select 1 from public.playn_optout o where o.phone = m.phone);

-- 3) 회원 자격 판단 (로그인·신청 게이트). 광고 동의와 무관
create or replace function public.playn_member_ok(p_phone text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from playn_members m where m.phone = p_phone and m.status = 'active')
$$;

-- 4) 전용 수신 거부 링크: 번호 대신 추측할 수 없는 값(주소에 번호 없음). 같은 번호는 같은 값
create table if not exists public.playn_optout_links (
  token text primary key,
  phone text not null unique,
  created_at timestamptz not null default now()
);
alter table public.playn_optout_links enable row level security;
revoke all on table public.playn_optout_links from public, anon, authenticated;

create or replace function public.playn_optout_link(p_phone text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare t text;
begin
  select token into t from playn_optout_links where phone = p_phone;
  if found then return t; end if;
  insert into playn_optout_links(token, phone)
    values (translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_'), p_phone)
    on conflict (phone) do nothing;
  select token into t from playn_optout_links where phone = p_phone;
  return t;
end $$;

-- 링크를 누르면: 그 번호의 광고만 끔 + 수신 거부 기록. 회원 상태는 그대로. 여러 번 눌러도 결과 같음
create or replace function public.playn_optout_by_link(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_phone text;
begin
  select phone into v_phone from playn_optout_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', '수신 거부 링크가 올바르지 않아요'); end if;
  insert into playn_optout(phone, source, method) values (v_phone, 'link', 'link') on conflict (phone) do nothing;
  update playn_members set marketing_agree = false, night_agree = false, updated_at = now() where phone = v_phone and (marketing_agree or night_agree);
  return jsonb_build_object('ok', true, 'tail', right(v_phone, 4));
end $$;

-- 수신 거부(공통): 광고만 끔 + 기록. 회원 상태·세션은 건드리지 않음
create or replace function public.playn_optout_apply(p_phone text, p_method text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into playn_optout(phone, source, method) values (p_phone, 'site', p_method) on conflict (phone) do nothing;
  update playn_members set marketing_agree = false, night_agree = false, updated_at = now() where phone = p_phone and (marketing_agree or night_agree);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.playn_members_ad_guard() from public, anon, authenticated;
revoke execute on function public.playn_ad_ok(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.playn_member_ok(text) from public, anon, authenticated;
revoke execute on function public.playn_optout_link(text) from public, anon, authenticated;
revoke execute on function public.playn_optout_by_link(text) from public, anon, authenticated;
revoke execute on function public.playn_optout_apply(text, text) from public, anon, authenticated;
revoke all on public.playn_ad_audience from public, anon, authenticated;
