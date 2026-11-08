// playn-admin: 관리자 대시보드 데이터 (2026-10-15)
// v3 (2026-11-08): HQ 캘린더용으로 지난 예약도 62일까지 (back 최대 7 → 62). 되돌리기: index_v2.ts
// v4 (2026-11-08): revenue — 월 매출 (playn_rev_book 장부 + 장부 이후 새 예약은 요금표로 추정). 되돌리기: index_v3.ts
// - board: 다가오는 예약 한눈에 (인원·보증금·계좌·특이사항·군인 배지·연장/조기입실·쿠폰)
// - analytics: 사이트 방문자 분석 (페이지·이탈·유입·클릭·흐름)
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let b: any; try { b = await req.json(); } catch { return J({ error: "bad json" }, 400); }
  const { data: k } = await sb.from("playand_config").select("value").eq("key", "admin_key").maybeSingle();
  if (!k?.value || b.key !== k.value) return J({ ok: false, error: "관리 키가 맞지 않아요" }, 401);
  if (b.action === "board") {
    const back = Math.min(62, Math.max(0, Number(b.back ?? 1))), fwd = Math.min(60, Math.max(1, Number(b.fwd ?? 14)));
    const { data: rows, error } = await sb.rpc("playn_admin_board", { back_days: back, fwd_days: fwd });
    if (error) return J({ ok: false, error: error.message });
    // 캘린더(스페이스클라우드 iCal)에만 있고 예약 원장에 아직 안 들어온 예약도 같이 보여줌
    const today = new Date(Date.now() + 9 * 3600e3 - back * 86400e3).toISOString().slice(0, 10);
    const until = new Date(Date.now() + 9 * 3600e3 + (fwd + 1) * 86400e3).toISOString().slice(0, 10);
    const { data: ev } = await sb.from("playand_ical_events").select("branch,start_at,end_at,summary").gte("start_at", today).lt("start_at", until).order("start_at");
    const have = new Set((rows ?? []).map((r: any) => `${r.branch}|${r.date}|${r.start_h}`));
    const seen = new Set<string>(); const extra: any[] = [];
    for (const e of ev ?? []) {
      const s = String(e.summary ?? "");
      if (/^스클|플레이앤|확정$|연장|연박|조기입실/.test(s)) continue; // 우리가 막아둔 블록
      const d = String(e.start_at).slice(0, 10), h = +String(e.start_at).slice(11, 13), key = `${e.branch}|${d}|${h}`;
      if (have.has(key) || seen.has(key)) continue; seen.add(key);
      extra.push({ id: "ical:" + key, branch: e.branch, date: d, start_h: h, end_at: e.end_at, guest: s, source: "스페이스클라우드 캘린더", status: "confirmed", calendar_only: true });
    }
    return J({ ok: true, items: [...(rows ?? []), ...extra].sort((a: any, z: any) => (a.date + String(a.start_h).padStart(2, "0")).localeCompare(z.date + String(z.start_h).padStart(2, "0"))) });
  }
  if (b.action === "revenue") {
    const y = Math.min(2100, Math.max(2020, Number(b.year ?? new Date().getFullYear())));
    const from = `${y - 1}-01-01`, to = `${y}-12-31`;
    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb.from("playn_rev_book").select("id,src,branch,use_date,pkg,amount,est,name,status").gte("use_date", from).lte("use_date", to).order("use_date").range(off, off + 999);
      if (error) return J({ ok: false, error: error.message });
      rows.push(...(data ?? [])); if (!data || data.length < 1000) break;
    }
    const have = new Set(rows.map((r) => r.id));
    const { data: cfgRows } = await sb.from("playand_config").select("key,value").in("key", ["prices", "holidays", "force_c"]);
    const C = Object.fromEntries((cfgRows ?? []).map((r: any) => [r.key, r.value]));
    const prices = JSON.parse(C.prices ?? "{}"), hol = new Set<string>(JSON.parse(C.holidays ?? "[]")), forceC: string[] = JSON.parse(C.force_c ?? "[]");
    const add = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const off = (d: string) => hol.has(d) || [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay());
    const grade = (d: string) => forceC.includes(d.slice(5)) ? "C" : (!off(d) && !off(add(d, 1)) ? "A" : !off(d) ? "B" : off(add(d, 1)) ? "C" : "D");
    // 장부(스클 동기화) 이후 들어온 예약: 예약 원장에서 가져와 요금표로 추정, 홈페이지 예약은 실제 신청 금액
    const { data: led } = await sb.from("playand_reservations").select("id,branch,pkg,use_date,status,title").gte("use_date", from).lte("use_date", to);
    const { data: deals } = await sb.from("playn_deal_requests").select("id,deal_price,status").in("status", ["confirmed"]);
    const dealP = Object.fromEntries((deals ?? []).map((x: any) => [String(x.id), Number(x.deal_price)]));
    for (const r of led ?? []) {
      if (["cancelled", "canceled"].includes(String(r.status))) continue;
      const id = String(r.id); const key = /^\d+$/.test(id) ? "sc:" + id : id;
      if (have.has(key) || id.startsWith("site:cash")) continue;
      if (rows.some((x) => x.branch === r.branch && x.use_date === r.use_date && x.pkg === r.pkg)) continue; // 같은 칸이 장부에 이미 있음
      const pk = ["day", "night", "full"].includes(r.pkg) ? r.pkg : "full";
      const site = id.startsWith("site:") ? dealP[id.slice(5)] : null;
      const amt = site ?? prices?.[r.branch]?.[pk]?.[grade(String(r.use_date))] ?? 0;
      rows.push({ id: key, src: /^\d+$/.test(id) ? "sc" : id.startsWith("site:") ? "home" : "naver", branch: r.branch, use_date: r.use_date, pkg: pk, amount: amt, est: !site, name: r.title ?? "", status: "new" });
    }
    const { data: last } = await sb.from("playn_rev_book").select("updated_at").order("updated_at", { ascending: false }).limit(1);
    return J({ ok: true, year: y, rows, synced_at: last?.[0]?.updated_at ?? null });
  }
  if (b.action === "analytics") {
    const days = Math.min(90, Math.max(1, Number(b.days ?? 7)));
    const { data, error } = await sb.rpc("playn_analytics", { days });
    return J(error ? { ok: false, error: error.message } : { ok: true, ...(data as any) });
  }
  return J({ error: "unknown action" }, 400);
});
