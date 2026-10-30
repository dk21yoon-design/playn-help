-- 게임 모임(playn-party) 현재 DB 정의 — 검수 자료 (비밀정보 없음)
-- 출처: Supabase bjrgtoyjrggxmdexnwib 에서 pg_get_functiondef / pg_indexes / pg_get_triggerdef 로 2026-10-30 10:45 KST 추출, v3.4(11:05 KST)·v3.5(11:35 KST)·v3.6(13:20 KST) 반영
-- 적용된 마이그레이션(순서): party_rsvp_waitlist_v1, party_v2_offer_accept_community_members, party_v2_1_queue_order_by_id,
--   party_v3_day_before_reminder_log_only, party_v3_1_reminder_absolute_date_text, party_test_evidence_table,
--   party_v3_2_decide_at_and_stale_offer, party_v3_3_revoke_public_table_grants, party_v3_4_lifecycle_guards, party_v3_5_decide_after_lock_clock,
--   party_v3_6_event_cancelled_notice_log_only
-- 이 파일은 실행용이 아니라 읽기용이다. 원문 그대로 붙였다.

-- ── 함수 실행 권한 (모든 party_* 함수): anon=false authenticated=false service_role=true
-- ── 표: playn_party_rsvps / playn_party_notices / community_members / party_test_evidence
--    RLS 켬(정책 없음), anon·authenticated 표 권한 없음(v3.3 회수). 공개 키 직접 조회 시 42501
-- ── 시각 규칙(v3.5): party_join·party_respond·party_fill 은 모임·신청 잠금을 얻은 뒤 clock_timestamp()를 v_now 로 한 번 잡아
--    시작·접수 마감·제안 기한 판단에 쓴다. now()는 트랜잭션 시작 시각(잠금 대기 시간 미반영). 기록용 시각은 now() 그대로
--    party_dispatch_decide_at 의 p_now 는 비공개 시험용 주입 시각, 운영 경로(party_dispatch_decide)는 now()
-- ── 모임 취소 안내(v3.6): open/closed→cancelled 전이 때 cancel_round+1, 그 시점 confirmed·offered·waitlist 신청자에게 event_cancelled 1건씩 기록
--    중복 방지 = (event_id, phone, cancel_round) 고유. 신청 상태는 바꾸지 않음. 판단은 동의 꺼짐 skipped_pref, 그 외 모드와 무관하게 logged(send 없음)
--    재개(cancelled→open/closed) 시 미처리 event_cancelled 는 superseded, 이미 logged 된 기록은 보존
-- ── 크론: party-sweep-5min */5 * * * * → playn-party admin_sweep (변경 없음)

-- ── 인덱스
CREATE UNIQUE INDEX playn_party_rsvps_active_uq ON public.playn_party_rsvps USING btree (event_id, phone) WHERE (status = ANY (ARRAY['confirmed'::text, 'waitlist'::text, 'offered'::text]));
CREATE INDEX playn_party_rsvps_ev_st ON public.playn_party_rsvps USING btree (event_id, status, created_at);
CREATE INDEX playn_party_rsvps_offer_exp ON public.playn_party_rsvps USING btree (offer_expires_at) WHERE (status = 'offered'::text);
CREATE UNIQUE INDEX playn_party_notices_dedupe ON public.playn_party_notices USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);
CREATE UNIQUE INDEX playn_party_notices_once ON public.playn_party_notices USING btree (rsvp_id, kind) WHERE ((test_run IS DISTINCT FROM 'T1-20261030-db-v1'::text) AND (kind <> ALL (ARRAY['reminder'::text, 'event_cancelled'::text])));
CREATE UNIQUE INDEX playn_party_notices_event_cancel_once ON public.playn_party_notices USING btree (event_id, phone, cancel_round) WHERE (kind = 'event_cancelled'::text);
CREATE INDEX playn_party_notices_ev ON public.playn_party_notices USING btree (event_id, created_at);
CREATE INDEX playn_party_notices_pending ON public.playn_party_notices USING btree (status) WHERE (status = 'pending'::text);
CREATE INDEX party_test_evidence_run ON public.party_test_evidence USING btree (test_run, id);

-- ── 트리거 (playn_events)
CREATE TRIGGER party_events_sched_bump BEFORE UPDATE OF start_at, status ON public.playn_events FOR EACH ROW EXECUTE FUNCTION party_events_sched_bump();
CREATE TRIGGER party_events_supersede AFTER UPDATE ON public.playn_events FOR EACH ROW EXECUTE FUNCTION party_events_supersede();

-- ── 함수
CREATE OR REPLACE FUNCTION public.party_kfmt(t timestamp with time zone)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  select to_char(t at time zone 'Asia/Seoul','FMMM/FMDD') || '(' ||
    (array['일','월','화','수','목','금','토'])[extract(dow from t at time zone 'Asia/Seoul')::int + 1] || ') ' ||
    to_char(t at time zone 'Asia/Seoul','HH24:MI')
$function$;

CREATE OR REPLACE FUNCTION public.party_remind_due(p_start timestamp with time zone)
 RETURNS timestamp with time zone LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  select (((p_start at time zone 'Asia/Seoul')::date - 1) + time '18:00') at time zone 'Asia/Seoul'
$function$;

CREATE OR REPLACE FUNCTION public.party_notice(r playn_party_rsvps, ev playn_events, k text, pos integer DEFAULT NULL::integer)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare m text; nid bigint; head text := '[게임 모임] ' || r.name || '님 「' || ev.title || '」';
  tail text := E'\n' || party_kfmt(ev.start_at) || ' · ' || ev.branch || E'\nhttps://playn.kr/party/?e=' || ev.id;
begin
  m := case k
    when 'confirmed' then head || ' 참가 확정됐어요.' || tail
    when 'waitlist'  then head || ' 정원이 차서 대기 ' || pos || '번이에요. 자리가 나면 참여 제안을 보내드려요.' || tail
    when 'offered'   then head || ' 자리가 났어요. ' || party_kfmt(r.offer_expires_at) || '까지 수락하면 확정돼요. 그 안에 답이 없으면 다음 분께 넘어가요.' || tail
    when 'accepted'  then head || ' 수락 완료, 참가 확정됐어요.' || tail
    when 'declined'  then head || ' 참여 제안을 거절했어요. 다음에 또 만나요.' || tail
    when 'expired'   then head || ' 수락 기한이 지나 자리가 다음 분께 넘어갔어요.' || tail
    when 'cancelled' then head || ' 신청이 취소됐어요.' || tail
  end;
  insert into playn_party_notices(rsvp_id, event_id, phone, kind, msg, test_run)
    values (r.id, ev.id, r.phone, k, m, r.test_run)
    on conflict do nothing returning id into nid;
  return nid;
end $function$;

CREATE OR REPLACE FUNCTION public.party_fill(ev playn_events)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare held int; w playn_party_rsvps; ids jsonb := '[]'::jsonb; nid bigint; exp timestamptz; v_now timestamptz;
begin
  if ev.status not in ('open','closed') then return ids; end if;
  loop
    v_now := clock_timestamp();   -- v3.5
    exit when ev.start_at <= v_now;
    select count(*) into held from playn_party_rsvps where event_id = ev.id and status in ('confirmed','offered');
    exit when held >= ev.cap;
    select * into w from playn_party_rsvps where event_id = ev.id and status = 'waitlist' order by id limit 1 for update skip locked;
    exit when not found;
    exp := least(v_now + make_interval(mins => ev.offer_minutes), ev.start_at);
    exit when exp <= v_now;
    update playn_party_rsvps set status = 'offered', offered_at = v_now, offer_expires_at = exp where id = w.id returning * into w;
    nid := party_notice(w, ev, 'offered');
    if nid is not null then ids := ids || to_jsonb(nid); end if;
  end loop;
  return ids;
end $function$;

CREATE OR REPLACE FUNCTION public.party_join(p_event text, p_phone text, p_name text, p_test text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare ev playn_events; r playn_party_rsvps; held int; waiting int; pos int; nid bigint; v_now timestamptz;
begin
  select * into ev from playn_events where id = p_event and kind = 'party' for update;
  if not found then return jsonb_build_object('ok', false, 'error', '모임을 찾지 못했어요'); end if;
  v_now := clock_timestamp();   -- v3.5: 모임 잠금 획득 뒤 판단 시각
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
end $function$;

CREATE OR REPLACE FUNCTION public.party_respond(p_event text, p_phone text, p_accept boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare ev playn_events; r playn_party_rsvps; ids jsonb := '[]'::jsonb; nid bigint; v_now timestamptz;
begin
  select * into ev from playn_events where id = p_event and kind = 'party' for update;
  if not found then return jsonb_build_object('ok', false, 'error', '모임을 찾지 못했어요'); end if;
  select * into r from playn_party_rsvps where event_id = p_event and phone = p_phone and status = 'offered' for update;
  if not found then return jsonb_build_object('ok', false, 'error', '응답할 참여 제안이 없어요'); end if;
  v_now := clock_timestamp();   -- v3.5: 모임·신청 잠금 획득 뒤 판단 시각
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
end $function$;

CREATE OR REPLACE FUNCTION public.party_cancel(p_event text, p_phone text, p_by text DEFAULT 'member'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare ev playn_events; r playn_party_rsvps; ids jsonb := '[]'::jsonb; was text; nid bigint;
begin
  select * into ev from playn_events where id = p_event and kind = 'party' for update;
  if not found then return jsonb_build_object('ok', false, 'error', '모임을 찾지 못했어요'); end if;
  select * into r from playn_party_rsvps where event_id = p_event and phone = p_phone and status in ('confirmed','waitlist','offered') for update;
  if not found then return jsonb_build_object('ok', false, 'error', '취소할 신청이 없어요'); end if;
  if p_by = 'member' and coalesce(ev.cancel_until, ev.start_at) < now() then
    return jsonb_build_object('ok', false, 'error', '취소 가능 시간이 지났어요. 운영자에게 문의해 주세요'); end if;
  was := r.status;
  update playn_party_rsvps set status = 'cancelled', cancelled_at = now(), cancel_by = p_by where id = r.id returning * into r;
  nid := party_notice(r, ev, 'cancelled'); if nid is not null then ids := ids || to_jsonb(nid); end if;
  if was in ('confirmed','offered') then ids := ids || party_fill(ev); end if;
  return jsonb_build_object('ok', true, 'was', was, 'notices', ids);
end $function$;

CREATE OR REPLACE FUNCTION public.party_remind_scan(p_now timestamp with time zone, p_test text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare ev playn_events; r playn_party_rsvps; ids jsonb := '[]'::jsonb; nid bigint;
begin
  for ev in select * from playn_events e
     where e.kind = 'party' and e.status in ('open','closed')
       and e.start_at > p_now and party_remind_due(e.start_at) <= p_now
       and (case when p_test is null then e.id not like 'party-test%' else e.info->>'test_run' = p_test end)
  loop
    for r in select * from playn_party_rsvps where event_id = ev.id and status = 'confirmed' order by id loop
      insert into playn_party_notices(rsvp_id, event_id, phone, kind, msg, test_run, dedupe_key, sched_version)
      values (r.id, ev.id, r.phone, 'reminder',
        '[게임 모임] ' || r.name || '님 「' || ev.title || '」 ' || party_kfmt(ev.start_at) || ' 시작이에요.'
          || E'\n장소: ' || ev.branch
          || E'\n못 오시면 미리 취소해 주세요. 내 신청: https://playn.kr/party/?e=' || ev.id,
        r.test_run, 'reminder:' || ev.id || ':' || r.phone || ':v' || ev.sched_version, ev.sched_version)
      on conflict do nothing returning id into nid;
      if nid is not null then ids := ids || to_jsonb(nid); end if;
    end loop;
  end loop;
  return ids;
end $function$;

create or replace function public.party_dispatch_decide_at(p_ids bigint[], p_mode text, p_dry boolean, p_now timestamptz)
returns table(id bigint, kind text, phone text, msg text, decision text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare n playn_party_notices; ev playn_events; rs playn_party_rsvps; cm community_members; d text;
begin
  for n in select * from playn_party_notices x where x.id = any(p_ids) and x.status = 'pending' order by x.id
     for update skip locked
  loop
    select * into ev from playn_events e where e.id = n.event_id;
    select * into rs from playn_party_rsvps y where y.id = n.rsvp_id;
    select * into cm from community_members c where c.phone = n.phone;
    if n.kind = 'reminder' and (ev.id is null or ev.status = 'cancelled' or ev.sched_version is distinct from n.sched_version
        or ev.start_at <= p_now or rs.status is distinct from 'confirmed') then d := 'superseded';
    elsif n.kind = 'offered' and (rs.status is distinct from 'offered' or rs.offer_expires_at <= p_now
        or ev.id is null or ev.status not in ('open','closed') or ev.start_at <= p_now) then d := 'superseded';
    elsif n.kind = 'event_cancelled' and (ev.id is null or ev.status is distinct from 'cancelled' or ev.cancel_round is distinct from n.cancel_round) then d := 'superseded';
    elsif cm.phone is null or cm.status <> 'active' or not cm.notify_sms then d := 'skipped_pref';
    elsif n.kind = 'event_cancelled' then d := 'logged';
    elsif n.test_run is not null or n.event_id like 'party-test%' then d := 'logged';
    elsif p_mode in ('test','live') then d := 'send';
    else d := 'logged';
    end if;
    if not p_dry then
      update playn_party_notices set status = case when d = 'send' then 'sending' else d end where playn_party_notices.id = n.id;
    end if;
    id := n.id; kind := n.kind; phone := n.phone; msg := n.msg; decision := d;
    return next;
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.party_dispatch_decide(p_ids bigint[], p_mode text, p_dry boolean DEFAULT false)
 RETURNS TABLE(id bigint, kind text, phone text, msg text, decision text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  select * from party_dispatch_decide_at(p_ids, p_mode, p_dry, now())
$function$;

CREATE OR REPLACE FUNCTION public.party_sweep()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare e text; ev playn_events; r playn_party_rsvps; ids jsonb := '[]'::jsonb; nid bigint; rem jsonb;
begin
  for e in select distinct event_id from playn_party_rsvps where status in ('offered','waitlist') loop
    select * into ev from playn_events where id = e and kind = 'party' for update skip locked;
    continue when not found;
    for r in select * from playn_party_rsvps where event_id = e and status = 'offered' and offer_expires_at <= now() for update loop
      update playn_party_rsvps set status = 'expired', closed_at = now() where id = r.id returning * into r;
      nid := party_notice(r, ev, 'expired'); if nid is not null then ids := ids || to_jsonb(nid); end if;
    end loop;
    ids := ids || party_fill(ev);
  end loop;
  rem := party_remind_scan(now(), null);
  return jsonb_build_object('ok', true, 'notices', ids || rem, 'reminders', jsonb_array_length(rem));
end $function$;

create or replace function public.party_events_sched_bump()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'party' and new.start_at is distinct from old.start_at then
    new.sched_version := old.sched_version + 1;
  end if;
  if new.kind = 'party' and old.status in ('open','closed') and new.status = 'cancelled' then
    new.cancel_round := old.cancel_round + 1;
  end if;
  return new;
end $$;

create or replace function public.party_events_supersede()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind <> 'party' then return null; end if;
  if new.sched_version <> old.sched_version or (new.status = 'cancelled' and old.status <> 'cancelled') then
    update playn_party_notices set status = 'superseded'
     where event_id = new.id and kind = 'reminder' and status = 'pending';
  end if;
  if old.status in ('open','closed') and new.status = 'cancelled' then
    update playn_party_notices set status = 'superseded'
     where event_id = new.id and kind = 'event_cancelled' and status = 'pending' and cancel_round is distinct from new.cancel_round;
    insert into playn_party_notices(rsvp_id, event_id, phone, kind, msg, test_run, dedupe_key, cancel_round)
    select r.id, new.id, r.phone, 'event_cancelled',
      '[게임 모임] ' || r.name || '님 「' || new.title || '」 모임이 취소됐어요.'
        || E'\n원래 일정: ' || party_kfmt(new.start_at) || ' · ' || new.branch
        || E'\n내 신청: https://playn.kr/party/?e=' || new.id,
      r.test_run, 'event_cancelled:' || new.id || ':' || r.phone || ':c' || new.cancel_round, new.cancel_round
    from playn_party_rsvps r
    where r.event_id = new.id and r.status in ('confirmed','offered','waitlist')
    on conflict do nothing;
  elsif old.status = 'cancelled' and new.status in ('open','closed') then
    update playn_party_notices set status = 'superseded'
     where event_id = new.id and kind = 'event_cancelled' and status = 'pending';
  end if;
  return null;
end $$;
