// playn-party: 커뮤니티 모임 신청 (2026-10-30 v1)
//  가입·로그인은 기존 N CREW 그대로 (playn-site join → playn-community otp → playn_sessions 토큰)
//  public: list · info(e, token?) · join(e, token) · cancel(e, token)
//  admin(key): admin_list(e) · admin_create · admin_cancel(e, phone) · admin_dispatch
//  정원·대기·자동 승격은 DB 함수 party_join / party_cancel 이 모임 행을 잠그고 처리한다
//  안내 문자는 playn_party_notices 에 먼저 기록하고 여기서 보낸다. 발송 모드는 playand_config.party_sms_mode
//    log(기본) = 기록만 · test = 운영폰으로만 · live = 신청자에게
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const normPhone = (p: unknown) => { const d = String(p ?? "").replace(/\D/g, ""); return /^01\d{8,9}$/.test(d) ? d : null; };
const mask = (n: string) => n.length <= 1 ? n : n[0] + "*".repeat(Math.max(1, n.length - 2)) + (n.length > 2 ? n[n.length - 1] : "");

async function cfgAll() {
  const { data } = await sb.from("playand_config").select("key,value").in("key", ["admin_key", "owner_phone", "macrodroid_webhook", "party_sms_mode"]);
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
}
async function sessionMember(token: unknown) {
  const { data: s } = await sb.from("playn_sessions").select("phone,expires_at").eq("token", String(token ?? "")).maybeSingle();
  if (!s || new Date(s.expires_at) < new Date()) return null;
  const { data: m } = await sb.from("playn_members").select("phone,name,status").eq("phone", s.phone).maybeSingle();
  return m && m.status === "active" ? m : null;
}
// 기록된 안내를 실제로 보냄 (모드에 따라)
async function dispatch(cfg: Record<string, string>, ids: number[]) {
  if (!ids.length) return [];
  const mode = cfg.party_sms_mode || "log";
  const { data: rows } = await sb.from("playn_party_notices").select("*").in("id", ids).eq("status", "pending");
  const out: any[] = [];
  for (const n of rows ?? []) {
    let status = "logged", http: number | null = null;
    const to = mode === "live" ? n.phone : mode === "test" ? cfg.owner_phone : null;
    if (to && cfg.macrodroid_webhook) {
      const u = new URL(cfg.macrodroid_webhook);
      u.searchParams.set("phone", String(to).replace(/\D/g, ""));
      u.searchParams.set("msg", mode === "test" ? `[테스트·실제 ${String(n.phone).slice(-4)}]\n${n.msg}` : n.msg);
      try { const r = await fetch(u.toString()); http = r.status; status = r.ok ? (mode === "test" ? "test_sent" : "sent") : "failed"; } catch { status = "failed"; }
    }
    await sb.from("playn_party_notices").update({ status, http, sent_at: status === "logged" ? null : new Date().toISOString() }).eq("id", n.id).eq("status", "pending");
    out.push({ id: n.id, kind: n.kind, status });
  }
  return out;
}
async function counts(id: string) {
  const { data } = await sb.from("playn_party_rsvps").select("id,phone,name,status,created_at").eq("event_id", id).neq("status", "cancelled").order("created_at").order("id");
  const conf = (data ?? []).filter((r) => r.status === "confirmed"), wait = (data ?? []).filter((r) => r.status === "waitlist");
  return { conf, wait };
}
const pub = (ev: any, c: any) => ({ id: ev.id, title: ev.title, branch: ev.branch, start_at: ev.start_at, end_at: ev.end_at, price: ev.price, cap: ev.cap, status: ev.status, apply_until: ev.apply_until, cancel_until: ev.cancel_until, info: ev.info,
  confirmed: c.conf.length, waitlist: c.wait.length, left: Math.max(0, ev.cap - c.conf.length), names: c.conf.map((r: any) => mask(r.name)) });
async function getEv(id: unknown) { return (await sb.from("playn_events").select("*").eq("id", String(id ?? "")).eq("kind", "party").maybeSingle()).data; }
async function myRsvp(ev: any, phone: string, c: any) {
  const { data: r } = await sb.from("playn_party_rsvps").select("id,status,created_at,promoted_at").eq("event_id", ev.id).eq("phone", phone).neq("status", "cancelled").maybeSingle();
  if (!r) return null;
  return { status: r.status, promoted: !!r.promoted_at, position: r.status === "waitlist" ? c.wait.findIndex((w: any) => w.id === r.id) + 1 : null };
}
async function activity(text: string, key: string) {
  await sb.from("hq_activity").insert({ who: "모임", brand: "playn", text, dedupe_key: key }).then(() => {}, () => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let b: any = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { return J({ ok: false, error: "bad json" }, 400); } }
  else b = Object.fromEntries(new URL(req.url).searchParams);
  const action = b.action ?? (b.e ? "info" : "list");

  if (action === "list") {
    const { data } = await sb.from("playn_events").select("*").eq("kind", "party").in("status", ["open", "closed"]).gte("end_at", new Date().toISOString()).order("start_at").limit(30);
    const evs = await Promise.all((data ?? []).filter((e) => !String(e.id).startsWith("party-test") || b.test).map(async (e) => pub(e, await counts(e.id))));
    return J({ ok: true, events: evs });
  }
  if (action === "info") {
    const ev = await getEv(b.e);
    if (!ev) return J({ ok: false, error: "모임을 찾지 못했어요" }, 404);
    const c = await counts(ev.id);
    const m = b.token ? await sessionMember(b.token) : null;
    return J({ ok: true, ev: pub(ev, c), me: m ? { name: m.name, rsvp: await myRsvp(ev, m.phone, c) } : null });
  }
  if (action === "join" || action === "cancel") {
    const m = await sessionMember(b.token);
    if (!m) return J({ ok: false, expired: true, error: "N CREW 로그인이 필요해요" });
    const cfg = await cfgAll();
    const { data: r, error } = action === "join"
      ? await sb.rpc("party_join", { p_event: String(b.e ?? ""), p_phone: m.phone, p_name: m.name })
      : await sb.rpc("party_cancel", { p_event: String(b.e ?? ""), p_phone: m.phone, p_by: "member" });
    if (error) return J({ ok: false, error: "처리하지 못했어요. 잠시 후 다시 해주세요" }, 500);
    if (!r?.ok) return J(r);
    const sent = await dispatch(cfg, (r.notices ?? []).map(Number));
    const ev = await getEv(b.e); const c = await counts(ev.id);
    if (!r.dup) await activity(`${ev.title} · ${mask(m.name)} ${action === "join" ? (r.status === "confirmed" ? "신청 확정" : `대기 ${r.position}번`) : "취소"}${r.promoted_rsvp ? " → 대기 1명 자동 확정" : ""} (확정 ${c.conf.length}/${ev.cap} · 대기 ${c.wait.length})`, `party:${ev.id}:${m.phone}:${action}:${Date.now()}`);
    return J({ ...r, ev: pub(ev, c), me: { name: m.name, rsvp: await myRsvp(ev, m.phone, c) }, sent });
  }

  // ── 관리자 ──
  const cfg = await cfgAll();
  if (!cfg.admin_key || b.key !== cfg.admin_key) return J({ ok: false, error: "관리 키가 맞지 않아요" }, 401);
  if (action === "admin_list") {
    const ev = await getEv(b.e); if (!ev) return J({ ok: false, error: "모임을 찾지 못했어요" }, 404);
    const { data: rs } = await sb.from("playn_party_rsvps").select("*").eq("event_id", ev.id).order("created_at").order("id");
    const { data: ns } = await sb.from("playn_party_notices").select("id,rsvp_id,phone,kind,msg,status,http,created_at,sent_at").eq("event_id", ev.id).order("id", { ascending: false }).limit(200);
    return J({ ok: true, ev: pub(ev, await counts(ev.id)), rsvps: rs ?? [], notices: ns ?? [], mode: cfg.party_sms_mode || "log" });
  }
  if (action === "admin_create") {
    const id = String(b.id ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    const cap = Math.round(Number(b.cap));
    if (!id || !b.title || !b.branch || !b.start_at || !b.end_at || !(cap >= 1 && cap <= 200)) return J({ ok: false, error: "id·제목·지점·시작·끝·정원을 확인해 주세요" });
    const { error } = await sb.from("playn_events").insert({ id, kind: "party", title: String(b.title).slice(0, 60), branch: String(b.branch), start_at: b.start_at, end_at: b.end_at, apply_until: b.apply_until ?? null, cancel_until: b.cancel_until ?? null, price: Number(b.price) || 0, cap, cap_f: 0, cap_m: 0, min_people: Number(b.min_people) || 1, status: "open", info: { desc: String(b.desc ?? "").slice(0, 600) } });
    return J({ ok: !error, error: error?.message, id });
  }
  if (action === "admin_set") {
    const patch: any = {};
    for (const k of ["status", "title", "cap", "apply_until", "cancel_until", "start_at", "end_at"]) if (b[k] != null) patch[k] = b[k];
    if (b.desc != null) patch.info = { desc: String(b.desc).slice(0, 600) };
    const { error } = await sb.from("playn_events").update(patch).eq("id", String(b.e ?? "")).eq("kind", "party");
    return J({ ok: !error, error: error?.message });
  }
  if (action === "admin_cancel") {
    const p = normPhone(b.phone); if (!p) return J({ ok: false, error: "번호를 확인해 주세요" });
    const { data: r, error } = await sb.rpc("party_cancel", { p_event: String(b.e ?? ""), p_phone: p, p_by: "admin" });
    if (error || !r?.ok) return J(r ?? { ok: false, error: error?.message });
    return J({ ...r, sent: await dispatch(cfg, (r.notices ?? []).map(Number)) });
  }
  if (action === "admin_dispatch") { // 기록만 된(pending) 안내를 다시 보냄
    const { data } = await sb.from("playn_party_notices").select("id").eq("status", "pending").limit(50);
    return J({ ok: true, sent: await dispatch(cfg, (data ?? []).map((x) => x.id)) });
  }
  return J({ ok: false, error: "unknown action" }, 400);
});
