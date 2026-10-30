-- N CREW v1c (2026-10-30): 모든 가입 경로의 광고 동의 = 별도 선택·기본 꺼짐 (인증 문자 스위치와 무관)
-- 가입 경로(홈페이지·내 N CREW·롤드컵 투표·팀·동행자·연장 그룹·체크인)는 모두 이 함수 하나로 회원을 만들거나 다시 활성화한다
-- 규칙
--   새 회원 / 활성 아닌 회원(left 등): 광고 동의 = p_marketing (서버가 b.marketing === true 일 때만 true 전달). 야간 = 광고 동의 and p_night
--   이미 활성 회원: 광고 동의를 끄지 않음. 명시 선택(p_marketing=true)일 때만 켬. 이름·지점만 갱신
--   수신 거부 기록이 있는 번호: 광고 동의 보호 트리거(v1a)가 true 를 다시 false 로 바꿈 → 선택 true·재가입으로도 광고 제외
-- 삭제 없음. 기존 회원 동의 일괄 변경 없음

create or replace function public.playn_member_join(p_phone text, p_name text, p_source text, p_branch text, p_marketing boolean, p_night boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m playn_members; v_now timestamptz := now(); v_mk boolean := coalesce(p_marketing, false);
begin
  if p_phone !~ '^01[0-9]{8,9}$' or coalesce(btrim(p_name), '') = '' then return jsonb_build_object('ok', false, 'error', '이름과 휴대폰 번호를 확인해 주세요'); end if;
  select * into m from playn_members where phone = p_phone for update;
  if not found then
    insert into playn_members(phone, name, marketing_agree, night_agree, agreed_at, source, fav_branch, status, updated_at)
      values (p_phone, left(btrim(p_name), 20), v_mk, v_mk and coalesce(p_night, false), case when v_mk then v_now end, left(coalesce(p_source, 'web'), 30), p_branch, 'active', v_now);
    return jsonb_build_object('ok', true, 'again', false, 'was_active', false);
  end if;
  if m.status <> 'active' then
    update playn_members set name = left(btrim(p_name), 20), status = 'active', marketing_agree = v_mk, night_agree = v_mk and coalesce(p_night, false),
      agreed_at = case when v_mk then v_now else agreed_at end, source = left(coalesce(p_source, 'web'), 30), fav_branch = coalesce(p_branch, fav_branch), updated_at = v_now
     where phone = p_phone;
    return jsonb_build_object('ok', true, 'again', true, 'was_active', false);
  end if;
  -- 활성 회원: 동의는 명시적으로 켤 때만 바꿈 (끄기는 수신 거부 경로에서만)
  update playn_members set name = left(btrim(p_name), 20), fav_branch = coalesce(p_branch, fav_branch), updated_at = v_now,
    marketing_agree = case when v_mk then true else marketing_agree end,
    night_agree = case when v_mk then coalesce(p_night, false) else night_agree end,
    agreed_at = case when v_mk and not marketing_agree then v_now else agreed_at end
   where phone = p_phone;
  return jsonb_build_object('ok', true, 'again', true, 'was_active', true);
end $$;

revoke execute on function public.playn_member_join(text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.playn_member_join(text, text, text, text, boolean, boolean) to service_role;
