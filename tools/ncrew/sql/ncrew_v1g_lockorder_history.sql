-- N CREW v1g (2026-10-31): GPT 검수 20261031-NCREW-재동의-검수 보완 2건만
-- 1) 잠금 순서 통일: 모든 쓰기 경로 = 회원 행(playn_members) → 수신 거부 행(playn_optout)
--    playn_optout_apply / playn_optout_by_link 가 거부 행을 먼저 잠그던 것을 회원 행 먼저 잠그도록 변경.
--    회원이 없는 번호는 잠글 회원 행이 없어 바로 거부 처리(기존 동작 유지).
-- 2) 재동의 변경 이력: 실제 동의 상태가 바뀔 때마다 이전/이후 광고·야간 값, 처리자, 근거, 시각을 history에 남김.
--    같은 상태 반복 호출은 아무것도 바꾸지 않고 이력도 남기지 않음(changed=false).
--    p_night 기본값 false 유지 (일반 광고 재동의를 야간 동의로 자동 해석하지 않음).
-- 새 기능·화면·발송·정책 변경 없음.

-- 이력 종류 추가: consent_change (거부 기록이 활성 아닐 때의 동의 변경)
alter table public.playn_optout_history drop constraint playn_optout_history_event_check;
alter table public.playn_optout_history add constraint playn_optout_history_event_check check (event = any (array['reconsent','re_optout','consent_change']));

create or replace function public.playn_optout_apply(p_phone text, p_method text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from playn_members where phone = p_phone for update;  -- v1g: 회원 행 먼저
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
  perform 1 from playn_members where phone = v_phone for update;  -- v1g: 회원 행 먼저
  perform playn_optout_mark(v_phone, 'link', 'link');
  update playn_members set marketing_agree = false, night_agree = false, updated_at = now() where phone = v_phone and (marketing_agree or night_agree);
  return jsonb_build_object('ok', true, 'tail', right(v_phone, 4));
end $$;

create or replace function public.playn_ad_reconsent(p_phone text, p_actor text, p_note text, p_night boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o playn_optout; m playn_members; a playn_members; v_had boolean := false; v_has_o boolean;
  v_night boolean := coalesce(p_night, false); v_now timestamptz := now();
begin
  if coalesce(btrim(p_actor), '') = '' or coalesce(btrim(p_note), '') = '' then return jsonb_build_object('ok', false, 'error', '처리자와 근거가 필요해요'); end if;
  select * into m from playn_members where phone = p_phone for update;           -- 회원 행 먼저
  if not found or m.status <> 'active' then return jsonb_build_object('ok', false, 'error', '활성 회원이 아니에요'); end if;
  select * into o from playn_optout where phone = p_phone for update;             -- 그다음 거부 행
  v_has_o := found;
  v_had := v_has_o and o.revoked_at is null;
  -- 같은 상태 반복: 바꿀 것이 없으면 동의일·이력 모두 그대로
  if not v_had and m.marketing_agree and m.night_agree = v_night then
    return jsonb_build_object('ok', true, 'had_optout', false, 'changed', false);
  end if;
  if v_had then
    update playn_optout set revoked_at = v_now, revoked_by = p_actor, revoke_note = p_note where phone = p_phone;
  end if;
  perform set_config('playn.ad_reconsent', 'on', true);
  update playn_members set marketing_agree = true, night_agree = v_night,
    agreed_at = case when v_had or not m.marketing_agree then v_now else agreed_at end,  -- 광고 동의가 새로 켜질 때만 동의일 갱신
    updated_at = v_now
   where phone = p_phone returning * into a;
  perform set_config('playn.ad_reconsent', '', true);
  insert into playn_optout_history(phone, event, snapshot, actor, note, at)
  values (p_phone, case when v_had then 'reconsent' else 'consent_change' end,
    case when v_has_o then to_jsonb(o) else '{}'::jsonb end
    || jsonb_build_object(
      'consent_before', jsonb_build_object('marketing', m.marketing_agree, 'night', m.night_agree, 'agreed_at', m.agreed_at),
      'consent_after',  jsonb_build_object('marketing', a.marketing_agree, 'night', a.night_agree, 'agreed_at', a.agreed_at),
      'optout_active_before', v_had),
    p_actor, p_note, v_now);
  return jsonb_build_object('ok', true, 'had_optout', v_had, 'changed', true);
end $$;

-- 권한: 기존과 같게 서버 전용
revoke execute on function public.playn_optout_apply(text, text) from public, anon, authenticated;
revoke execute on function public.playn_optout_by_link(text) from public, anon, authenticated;
revoke execute on function public.playn_ad_reconsent(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.playn_optout_apply(text, text) to service_role;
grant execute on function public.playn_optout_by_link(text) to service_role;
grant execute on function public.playn_ad_reconsent(text, text, text, boolean) to service_role;
