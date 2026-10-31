-- N CREW v1d (2026-10-31): 로그인한 회원 본인의 광고 알림 끄기 (추가 문자 없음)
-- 본인 확인: 유효한 N CREW 세션(playn_sessions, 만료 전)에서 번호를 정함. 요청 본문의 번호는 쓰지 않음
-- 하는 일: 광고·야간 동의 끄기 + 수신 거부 기록(method=me_session). 회원 상태·세션·예약·혜택은 그대로
-- 이미 꺼져 있고 기록도 있으면 아무것도 쓰지 않고 already=true. 같은 회원 동시 요청은 회원 행 잠금으로 줄 세움
-- 광고 켜기(재동의)는 만들지 않음. 삭제 없음

create or replace function public.playn_self_optout(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s playn_sessions; m playn_members; v_had boolean;
begin
  select * into s from playn_sessions where token = coalesce(p_token, '');
  if not found or s.expires_at < now() then return jsonb_build_object('ok', false, 'expired', true, 'error', '다시 로그인해 주세요'); end if;
  select * into m from playn_members where phone = s.phone for update;
  if not found then return jsonb_build_object('ok', false, 'expired', true, 'error', '다시 로그인해 주세요'); end if;
  v_had := exists(select 1 from playn_optout where phone = s.phone);
  if v_had and not m.marketing_agree and not m.night_agree then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  insert into playn_optout(phone, source, method) values (s.phone, 'me', 'me_session') on conflict (phone) do nothing;
  update playn_members set marketing_agree = false, night_agree = false, updated_at = now()
   where phone = s.phone and (marketing_agree or night_agree);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- 내 N CREW 화면 표시용: 지금 광고를 받는 상태인지 (동의 켜짐 + 수신 거부 기록 없음)
create or replace function public.playn_ad_state(p_phone text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'on', coalesce((select marketing_agree from playn_members where phone = p_phone), false) and not exists(select 1 from playn_optout where phone = p_phone),
    'optout', exists(select 1 from playn_optout where phone = p_phone));
$$;

revoke execute on function public.playn_self_optout(text) from public, anon, authenticated;
revoke execute on function public.playn_ad_state(text) from public, anon, authenticated;
grant execute on function public.playn_self_optout(text) to service_role;
grant execute on function public.playn_ad_state(text) to service_role;
