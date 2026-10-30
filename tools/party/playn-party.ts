// playn-party: 독립 게임 커뮤니티 모임 신청 (v5 2026-10-30: 인증 경계 — 커뮤니티 전용 세션 community_sessions, 서비스별 로그아웃, N CREW 로그인은 명시적으로만 이어받기)
//  v4: 가입 보안 보완 — 커뮤니티 전용 인증번호·시도 제한·원자적 소모, 가입 동의 기록, 로그아웃·탈퇴
//  v3: 전날 리마인드 기록 전용 · 발송 판단 DB 일원화
//  로그인 기술(휴대폰 인증번호 방식)만 재사용. 인증번호 community_otp · 세션 community_sessions 모두 커뮤니티 전용. N CREW(playn_members·playn_sessions)와 회원·동의·세션 분리
//  N CREW 세션(playn_sessions)은 c_bridge 에서 읽기만 함(사용자가 'N CREW 로그인으로 계속하기'를 눌렀을 때). 쓰기·만료 없음
//  커뮤니티 회원 = community_members (가입·약관·안내 문자 설정·광고 알림 설정 따로, 기본 꺼짐)
//  public: list · info(e, token?) · c_otp_send · c_otp_verify · c_bridge · c_me · c_join(가입) · c_settings · c_logout · c_leave(탈퇴)
//          join(e) · cancel(e) · accept(e) · decline(e)
//  인증번호: community_otp 표 + DB 함수 community_otp_issue(한도, 전체 발급 한 잠금)·community_otp_login(5회 제한·1회 소모+세션 저장 한 트랜잭션). 발송은 party_otp_send=on 일 때만(현재 꺼짐)
//  admin(key): admin_list(e) · admin_create · admin_set · admin_cancel(e, phone) · admin_sweep · admin_dispatch
//  정원·대기·제안·수락은 DB 함수(party_join / party_respond / party_cancel / party_sweep)가 모임 행을 잠그고 처리
//  안내 문자는 playn_party_notices 에 먼저 기록. 발송 모드 playand_config.party_sms_mode
//    log(기본·현재) = 기록만 · test = 운영폰으로만 · live = 신청자에게(안내 수신 켠 회원만)
//  전날 리마인드: 크론 admin_sweep → party_sweep → party_remind_scan(now) (모임 시작일 전날 18:00 KST부터 시작 전까지, 확정자만, 모임+회원+일정버전 1회)
//  테스트 실행(test_run) 기록과 'party-test' 모임은 모드와 상관없이 절대 발송하지 않고 관제실 활동에도 남기지 않음
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const normPhone = (p: unknown) => { const d = String(p ?? "").replace(/\D/g, ""); return /^01\d{8,9}$/.test(d) ? d : null; };
const mask = (n: string) => n.length <= 1 ? n : n[0] + "*".repeat(Math.max(1, n.length - 2)) + (n.length > 2 ? n[n.length - 1] : "");
const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("");
const isTestEv = (id: string) => String(id).startsWith("party-test");
// 가입 화면에서 보여 준 약관 판. 바뀌면 화면과 함께 올림 (옛 화면으로 가입하면 다시 동의 받음)
const TERMS_VERSION = "party-2026-10-30-draft";
// 접속 구분값: Supabase 게이트웨이가 넣는 값만 씀. x-forwarded-for 첫 값은 사용자가 꾸밀 수 있어 쓰지 않음 (T7R 시험 근거)
function clientIp(req: Request) {
  return (req.headers.get("cf-connecting-ip") ?? "").trim() || null;
}
async function ipHash(req: Request) {
  const ip = clientIp(req);
  if (!ip) return null;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("party-otp:" + ip)));
  return Array.from(d.slice(0, 8)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function cfgAll() {
  const { data } = await sb.from("playand_config").select("key,value").in("key", ["admin_key", "owner_phone", "macrodroid_webhook", "party_sms_mode", "party_otp_send"]);
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
}
// 커뮤니티 세션만 인정 (N CREW playn_sessions 토큰은 여기서 받지 않음)
async function sessionPhone(token: unknown) {
  const t = String(token ?? ""); if (t.length < 32) return null;
  const { data: s } = await sb.from("community_sessions").select("phone,expires_at,revoked_at").eq("token", t).maybeSingle();
  return s && !s.revoked_at && new Date(s.expires_at) > new Date() ? s.phone as string : null;
}
async function cMember(phone: string) {
  const { data } = await sb.from("community_members").select("phone,nick,status,notify_sms,marketing_sms,test_run,created_at").eq("phone", phone).maybeSingle();
  return data && data.status === "active" ? data : null;
}
async function rawSms(cfg: Record<string, string>, to: string, msg: string) {
  if (!cfg.macrodroid_webhook) return { ok: false, http: null as number | null };
  const u = new URL(cfg.macrodroid_webhook);
  u.searchParams.set("phone", to.replace(/\D/g, "")); u.searchParams.set("msg", msg);
  try { const r = await fetch(u.toString()); return { ok: r.ok, http: r.status }; } catch { return { ok: false, http: null }; }
}
// 기록된 안내 처리. 판단은 DB 함수 party_dispatch_decide 한 곳에서 (pending 만, 선점 잠금)
//  superseded(취소·일정 변경) / skipped_pref(안내 수신 꺼짐) / logged(테스트·기록 모드) / send(test·live 모드만)
//  실제 문자 호출은 decision === "send" 일 때만. 현재 모드 log 라 send 는 나오지 않음
async function dispatch(cfg: Record<string, string>, ids: number[]) {
  if (!ids.length) return [];
  const mode = cfg.party_sms_mode || "log";
  const { data: rows, error } = await sb.rpc("party_dispatch_decide", { p_ids: ids, p_mode: mode, p_dry: false });
  if (error) return [{ error: "dispatch_decide 실패" }];
  const out: any[] = [];
  for (const n of rows ?? []) {
    let status = n.decision, http: number | null = null;
    if (n.decision === "send") {
      const r = mode === "test" && cfg.owner_phone
        ? await rawSms(cfg, cfg.owner_phone, `[테스트·실제 ${String(n.phone).slice(-4)}]\n${n.msg}`)
        : mode === "live" ? await rawSms(cfg, n.phone, n.msg) : { ok: false, http: null };
      http = r.http; status = r.ok ? (mode === "test" ? "test_sent" : "sent") : "failed";
      await sb.from("playn_party_notices").update({ status, http, sent_at: r.ok ? new Date().toISOString() : null }).eq("id", n.id).eq("status", "sending");
    }
    out.push({ id: n.id, kind: n.kind, status });
  }
  return out;
}
async function counts(id: string) {
  const { data } = await sb.from("playn_party_rsvps").select("id,name,status,created_at,offer_expires_at").eq("event_id", id).in("status", ["confirmed", "offered", "waitlist"]).order("id");
  const by = (s: string) => (data ?? []).filter((r) => r.status === s);
  return { conf: by("confirmed"), offer: by("offered"), wait: by("waitlist") };
}
const pub = (ev: any, c: any) => ({ id: ev.id, title: ev.title, place: ev.branch, start_at: ev.start_at, end_at: ev.end_at, price: ev.price, cap: ev.cap, status: ev.status, apply_until: ev.apply_until, cancel_until: ev.cancel_until, offer_minutes: ev.offer_minutes, info: ev.info,
  confirmed: c.conf.length, offered: c.offer.length, waitlist: c.wait.length, left: Math.max(0, ev.cap - c.conf.length - c.offer.length), names: c.conf.map((r: any) => mask(r.name)) });
async function getEv(id: unknown) { return (await sb.from("playn_events").select("*").eq("id", String(id ?? "")).eq("kind", "party").maybeSingle()).data; }
async function myRsvp(ev: any, phone: string, c: any) {
  const { data: r } = await sb.from("playn_party_rsvps").select("id,status,accepted_at,offer_expires_at").eq("event_id", ev.id).eq("phone", phone).in("status", ["confirmed", "offered", "waitlist"]).maybeSingle();
  if (!r) return null;
  return { status: r.status, via_offer: !!r.accepted_at, offer_expires_at: r.status === "offered" ? r.offer_expires_at : null, position: r.status === "waitlist" ? c.wait.findIndex((w: any) => w.id === r.id) + 1 : null };
}
async function activity(ev: any, text: string) {
  if (isTestEv(ev.id)) return;
  await sb.from("hq_activity").insert({ who: "게임 모임", brand: "community", text, dedupe_key: `party:${ev.id}:${Date.now()}:${rand(4)}` }).then(() => {}, () => {});
}
const LABEL: Record<string, string> = { confirmed: "확정", waitlist: "대기", offered: "참여 제안", accepted: "수락 확정", declined: "제안 거절", cancelled: "취소", expired: "제안 만료" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let b: any = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { return J({ ok: false, error: "bad json" }, 400); } }
  else b = Object.fromEntries(new URL(req.url).searchParams);
  const action = b.action ?? (b.e ? "info" : "list");

  if (action === "list") {
    const { data } = await sb.from("playn_events").select("*").eq("kind", "party").eq("status", "open").gte("end_at", new Date().toISOString()).order("start_at").limit(30);
    const evs = await Promise.all((data ?? []).filter((e) => !isTestEv(e.id)).map(async (e) => pub(e, await counts(e.id))));
    return J({ ok: true, events: evs });
  }
  if (action === "info") {
    const ev = await getEv(b.e);
    if (!ev) return J({ ok: false, error: "모임을 찾지 못했어요" }, 404);
    const c = await counts(ev.id);
    const ph = b.token ? await sessionPhone(b.token) : null;
    const m = ph ? await cMember(ph) : null;
    return J({ ok: true, ev: pub(ev, c), login: !!ph, member: m ? { nick: m.nick } : null, rsvp: m ? await myRsvp(ev, m.phone, c) : null });
  }

  // ── 커뮤니티 로그인·가입 (로그인 기술만 재사용) ──
  if (action === "c_otp_send") {
    const cfg = await cfgAll();
    if (cfg.party_otp_send !== "on") return J({ ok: false, error: "인증 문자는 아직 준비 중이에요" });
    const phone = normPhone(b.phone); if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const { data: r, error } = await sb.rpc("community_otp_issue", { p_phone: phone, p_ip_hash: await ipHash(req) });
    if (error || !r?.ok) return J({ ok: false, error: r?.error ?? "잠시 후 다시 해 주세요" });
    const s = await rawSms(cfg, phone, `[게임 모임] 인증번호 ${r.code} (5분 안에 입력해 주세요)`);
    return J({ ok: s.ok, error: s.ok ? undefined : "문자를 보내지 못했어요" });
  }
  if (action === "c_otp_verify") {
    const phone = normPhone(b.phone); if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    // 인증번호 확인과 세션 저장을 DB 한 트랜잭션에서. 저장이 실패하면 인증번호도 소모되지 않음
    const { data: r, error } = await sb.rpc("community_otp_login", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12) });
    if (error) return J({ ok: false, reauth: true, error: "로그인을 마치지 못했어요. 잠시 후 같은 인증번호로 다시 해 보거나 새로 받아 주세요" }, 500);
    if (!r?.ok || typeof r.token !== "string" || r.token.length < 32) return J({ ok: false, error: r?.error ?? "인증하지 못했어요", left: r?.left });
    return J({ ok: true, token: r.token, member: !!(await cMember(phone)) });
  }
  if (action === "c_bridge") { // 사용자가 'N CREW 로그인으로 계속하기'를 눌렀을 때만. N CREW 회원 가입·동의는 넘어오지 않음
    const { data: r, error } = await sb.rpc("community_session_bridge", { p_ncrew_token: String(b.ncrew_token ?? "") });
    if (error) return J({ ok: false, error: "잠시 후 다시 해 주세요" }, 500);
    if (!r?.ok || typeof r.token !== "string") return J({ ok: false, error: r?.error ?? "N CREW 로그인을 확인하지 못했어요" });
    const ph = await sessionPhone(r.token);
    return J({ ok: true, token: r.token, member: ph ? !!(await cMember(ph)) : false });
  }
  if (action === "c_logout") { // 커뮤니티 세션만 끝냄. N CREW 세션 토큰을 넣어도 아무것도 바뀌지 않음
    const { data: r, error } = await sb.rpc("community_logout", { p_token: String(b.token ?? "") });
    return J({ ok: !error, revoked: r?.revoked ?? 0 });
  }
  const phone = await sessionPhone(b.token);
  if (!phone) return adminRoutes(b, action);
  if (action === "c_me") {
    const m = await cMember(phone);
    if (!m) return J({ ok: true, member: null });
    const { data: rs } = await sb.from("playn_party_rsvps").select("event_id,status,offer_expires_at").eq("phone", phone).in("status", ["confirmed", "offered", "waitlist"]);
    return J({ ok: true, member: { nick: m.nick, notify_sms: m.notify_sms, marketing_sms: m.marketing_sms, since: m.created_at }, rsvps: rs ?? [] });
  }
  if (action === "c_join") {
    if (await cMember(phone)) return J({ ok: true, already: true });
    const nick = String(b.nick ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 12);
    if (nick.length < 2) return J({ ok: false, error: "닉네임을 2자 이상 적어 주세요" });
    if (b.age14 !== true) return J({ ok: false, error: "만 14세 이상만 가입할 수 있어요" });
    if (b.terms !== true) return J({ ok: false, error: "이용 약관에 동의해 주세요" });
    if (b.terms_version !== TERMS_VERSION) return J({ ok: false, error: "약관이 바뀌었어요. 새로고침한 뒤 다시 동의해 주세요", reload: true });
    const now = new Date().toISOString();
    const { data: prev } = await sb.from("community_members").select("test_run").eq("phone", phone).maybeSingle();
    const { error } = await sb.from("community_members").upsert({ phone, nick, status: "active", terms_agreed_at: now, terms_version: TERMS_VERSION, age14_confirmed_at: now, left_at: null, notify_sms: b.notify_sms === true, notify_changed_at: now, marketing_sms: b.marketing_sms === true, marketing_changed_at: now, source: String(b.source ?? "party").slice(0, 20), test_run: prev?.test_run ?? null, updated_at: now });
    return J({ ok: !error, error: error ? "가입하지 못했어요. 잠시 후 다시 해주세요" : undefined });
  }
  const m = await cMember(phone);
  if (!m) return J({ ok: false, need_join: true, error: "게임 모임 가입이 먼저 필요해요" });
  if (action === "c_settings") {
    const now = new Date().toISOString(), patch: any = { updated_at: now };
    if (typeof b.notify_sms === "boolean" && b.notify_sms !== m.notify_sms) { patch.notify_sms = b.notify_sms; patch.notify_changed_at = now; }
    if (typeof b.marketing_sms === "boolean" && b.marketing_sms !== m.marketing_sms) { patch.marketing_sms = b.marketing_sms; patch.marketing_changed_at = now; }
    await sb.from("community_members").update(patch).eq("phone", phone);
    return J({ ok: true });
  }
  if (action === "c_leave") {
    const { data: r, error } = await sb.rpc("community_member_leave", { p_phone: phone });
    if (error) return J({ ok: false, error: "처리하지 못했어요. 잠시 후 다시 해주세요" }, 500);
    return J(r);
  }
  if (["join", "cancel", "accept", "decline"].includes(action)) {
    const e = String(b.e ?? "");
    const call = action === "join" ? sb.rpc("party_join", { p_event: e, p_phone: phone, p_name: m.nick, p_test: m.test_run })
      : action === "cancel" ? sb.rpc("party_cancel", { p_event: e, p_phone: phone, p_by: "member" })
      : sb.rpc("party_respond", { p_event: e, p_phone: phone, p_accept: action === "accept" });
    const { data: r, error } = await call;
    if (error) return J({ ok: false, error: "처리하지 못했어요. 잠시 후 다시 해주세요" }, 500);
    const cfg = await cfgAll();
    const sent = await dispatch(cfg, (r?.notices ?? []).map(Number));
    const ev = await getEv(e);
    if (!ev) return J({ ...r, sent });
    const c = await counts(ev.id);
    if (r?.ok && !r.dup && !m.test_run) await activity(ev, `${ev.title} · ${mask(m.nick)} ${action === "join" ? LABEL[r.status] : action === "cancel" ? "취소" : action === "accept" ? "제안 수락" : "제안 거절"} (확정 ${c.conf.length}/${ev.cap} · 제안 ${c.offer.length} · 대기 ${c.wait.length})`);
    return J({ ...r, sent, ev: pub(ev, c), rsvp: await myRsvp(ev, phone, c) });
  }
  return J({ ok: false, error: "unknown action" }, 400);
});

async function adminRoutes(b: any, action: string) {
  const cfg = await cfgAll();
  if (!String(action).startsWith("admin")) return J({ ok: false, expired: true, error: "로그인이 필요해요" });
  if (!cfg.admin_key || b.key !== cfg.admin_key) return J({ ok: false, error: "관리 키가 맞지 않아요" }, 401);
  if (action === "admin_events") {
    const { data } = await sb.from("playn_events").select("*").eq("kind", "party").order("start_at", { ascending: false }).limit(50);
    return J({ ok: true, events: await Promise.all((data ?? []).map(async (e) => pub(e, await counts(e.id)))), mode: cfg.party_sms_mode || "log" });
  }
  if (action === "admin_list") {
    const ev = await getEv(b.e); if (!ev) return J({ ok: false, error: "모임을 찾지 못했어요" }, 404);
    const { data: rs } = await sb.from("playn_party_rsvps").select("*").eq("event_id", ev.id).order("id");
    const { data: ns } = await sb.from("playn_party_notices").select("id,rsvp_id,phone,kind,msg,status,http,created_at,sent_at,test_run").eq("event_id", ev.id).order("id", { ascending: false }).limit(300);
    return J({ ok: true, ev: pub(ev, await counts(ev.id)), rsvps: rs ?? [], notices: ns ?? [], mode: cfg.party_sms_mode || "log" });
  }
  if (action === "admin_create") {
    const id = String(b.id ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    const cap = Math.round(Number(b.cap));
    if (!id || !b.title || !b.place || !b.start_at || !b.end_at || !(cap >= 1 && cap <= 500)) return J({ ok: false, error: "주소용 이름·제목·장소·시작·끝·정원을 확인해 주세요" });
    const { error } = await sb.from("playn_events").insert({ id, kind: "party", title: String(b.title).slice(0, 60), branch: String(b.place).slice(0, 40), start_at: b.start_at, end_at: b.end_at, apply_until: b.apply_until || null, cancel_until: b.cancel_until || null, offer_minutes: Math.max(10, Math.min(2880, Number(b.offer_minutes) || 720)), price: Number(b.price) || 0, cap, cap_f: 0, cap_m: 0, min_people: 1, status: "open", info: { desc: String(b.desc ?? "").slice(0, 600), game: String(b.game ?? "").slice(0, 30) } });
    return J({ ok: !error, error: error ? (error.code === "23505" ? "같은 주소용 이름이 이미 있어요" : error.message) : undefined, id });
  }
  if (action === "admin_set") {
    const patch: any = {};
    for (const k of ["status", "title", "cap", "apply_until", "cancel_until", "start_at", "end_at", "offer_minutes"]) if (b[k] != null && b[k] !== "") patch[k] = b[k];
    const { error } = await sb.from("playn_events").update(patch).eq("id", String(b.e ?? "")).eq("kind", "party");
    // 정원을 늘렸으면 바로 대기자에게 제안
    const sw = error ? null : (await sb.rpc("party_sweep")).data;
    return J({ ok: !error, error: error?.message, sent: sw ? await dispatch(cfg, (sw.notices ?? []).map(Number)) : [] });
  }
  if (action === "admin_cancel") {
    const p = normPhone(b.phone); if (!p) return J({ ok: false, error: "번호를 확인해 주세요" });
    const { data: r, error } = await sb.rpc("party_cancel", { p_event: String(b.e ?? ""), p_phone: p, p_by: "admin" });
    if (error || !r?.ok) return J(r ?? { ok: false, error: error?.message });
    return J({ ...r, sent: await dispatch(cfg, (r.notices ?? []).map(Number)) });
  }
  if (action === "admin_sweep") { // 크론: 기한 지난 제안 만료 + 빈자리 제안 + 남은 기록 처리
    const { data: r } = await sb.rpc("party_sweep");
    const { data: pend } = await sb.from("playn_party_notices").select("id").eq("status", "pending").limit(100);
    return J({ ok: true, sweep: r, sent: await dispatch(cfg, (pend ?? []).map((x) => x.id)) });
  }
  return J({ ok: false, error: "unknown action" }, 400);
}
