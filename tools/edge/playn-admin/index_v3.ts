// playn-admin: 관리자 대시보드 데이터 (2026-10-15)
// v3 (2026-11-08): HQ 캘린더용으로 지난 예약도 62일까지 (back 최대 7 → 62). 되돌리기: index_v2.ts
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
  if (b.action === "analytics") {
    const days = Math.min(90, Math.max(1, Number(b.days ?? 7)));
    const { data, error } = await sb.rpc("playn_analytics", { days });
    return J(error ? { ok: false, error: error.message } : { ok: true, ...(data as any) });
  }
  return J({ error: "unknown action" }, 400);
});
