-- v3.6 (2026-10-30): 모임 취소 안내(event_cancelled) 기록 전용
-- 승인 범위: playn_party_notices_once 인덱스 1개, party_events_sched_bump 트리거 1개 교체 + 아래 함수·열·인덱스 추가
-- Supabase apply_migration 은 이 파일 전체를 한 트랜잭션으로 실행한다(실패하면 전체 롤백)
-- 표·데이터·테스트 기록 삭제 없음. 신청 상태 변경 없음. 실제 발송 경로 없음

-- 1) 취소 회차: open/closed → cancelled 실제 전이 때만 +1 (시작 시각 버전 sched_version 과 별개)
alter table public.playn_events add column if not exists cancel_round integer not null default 0;
alter table public.playn_party_notices add column if not exists cancel_round integer;

-- 2) 기존 '신청+종류 1회' 중복 방지는 그대로 두고, 모임 취소 안내만 제외 (회차마다 1건이 필요)
drop index if exists public.playn_party_notices_once;
create unique index playn_party_notices_once on public.playn_party_notices(rsvp_id, kind)
  where test_run is distinct from 'T1-20261030-db-v1' and kind not in ('reminder','event_cancelled');
-- 모임 취소 안내 중복 방지: 모임 + 회원 + 취소 회차
create unique index if not exists playn_party_notices_event_cancel_once
  on public.playn_party_notices(event_id, phone, cancel_round) where kind = 'event_cancelled';

-- 3) BEFORE 트리거: 시작 시각 버전(기존) + 취소 회차(v3.6). 감시 열에 status 추가
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
drop trigger if exists party_events_sched_bump on public.playn_events;
create trigger party_events_sched_bump before update of start_at, status on public.playn_events
  for each row execute function public.party_events_sched_bump();

-- 4) AFTER 트리거 함수(트리거 정의는 그대로): 리마인드 무효화(기존) + 모임 취소 안내 기록 + 재개 시 미처리 취소 안내 무효화
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

-- 5) 판단: 모임 취소 안내는 같은 회차로 취소 상태일 때만 유효, 동의 꺼짐이면 skipped_pref, 그 외에는 모드와 상관없이 logged (send 없음)
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

-- 6) 권한
revoke execute on function public.party_events_sched_bump() from public, anon, authenticated;
revoke execute on function public.party_events_supersede() from public, anon, authenticated;
revoke execute on function public.party_dispatch_decide_at(bigint[], text, boolean, timestamptz) from public, anon, authenticated;
