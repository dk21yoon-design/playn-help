-- N CREW v1b 되돌리기 (보안 층만). 비상시에만 실행
-- 효과: 인증번호 5회 제한·용도 구분, 초대 코드 가입 표 확인을 예전처럼 느슨하게 되돌림
-- 건드리지 않는 것: 광고 차단 층(v1a: 광고 동의 보호 트리거·광고 판단 함수·수신 거부 기록·전용 링크). 표·기록 삭제 없음
-- 서버 함수는 그대로 둔 채 DB 함수 내용만 바꾸므로 서버 재배포 없이 바로 적용됨

create or replace function public.member_otp_verify(p_phone text, p_code text, p_purpose text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o playn_otp;
begin
  -- 되돌린 동작: 용도 구분 없음, 시도 제한 없음 (1회 사용은 유지)
  select * into o from playn_otp
   where phone = p_phone and used_at is null and voided_at is null and not used and created_at > clock_timestamp() - interval '5 minutes'
   order by created_at desc limit 1 for update;
  if not found or o.code is distinct from btrim(coalesce(p_code, '')) then
    return jsonb_build_object('ok', false, 'error', '인증번호가 맞지 않거나 시간이 지났어요', 'reason', 'none'); end if;
  update playn_otp set used = true, used_at = clock_timestamp() where id = o.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.playn_ref_attach(p_phone text, p_code text, p_ticket text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m playn_members; v_inv text;
begin
  -- 되돌린 동작: 가입 표 확인 없이 가입 10분 이내만 확인 (예전 ref_attach 와 같음)
  if p_code !~ '^N[A-Z0-9]{5}$' then return jsonb_build_object('ok', false); end if;
  select * into m from playn_members where phone = p_phone for update;
  if not found or m.referred_by is not null or m.ref_code = p_code or m.created_at < clock_timestamp() - interval '10 minutes' then return jsonb_build_object('ok', false); end if;
  select phone into v_inv from playn_members where ref_code = p_code;
  if v_inv is null or v_inv = p_phone then return jsonb_build_object('ok', false); end if;
  update playn_members set referred_by = p_code where phone = p_phone;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.member_otp_verify(text, text, text) from public, anon, authenticated;
revoke execute on function public.playn_ref_attach(text, text, text) from public, anon, authenticated;
