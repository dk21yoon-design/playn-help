// v6 (2026-11-08): 조기입실·연장·연박 막기 칸을 예약으로 착각해 생기던 가짜 청소 일정 제거. 되돌리기: index_v5.ts
// playn-clean: 청소 매니저 일정 보드 (노션 청소 DB 대체, 2026-10-18)
// v5 (2026-11-06): 사장님이 스클 호스트센터에 직접 넣은 외부예약(playand_ext)은 넣은 종료 시각으로 퇴실 계산 (예: 주간연장 10~20시 → 오후8시 퇴실). 키는 그대로라 메모·완료 기록 유지, 매니저에겐 '변경' 문자. 되돌리기: index_v4.ts
// - board: 예약 원장·iCal·연장·조기입실로 퇴실/입실/연박을 그 자리에서 계산 (노션 거치지 않음)
// - note: 메모·청소 완료 저장 (자동 계산과 따로 저장해서 덮어쓰기 없음)
// - report: 청소 완료 보고 (사진 묶음·특이사항·부족 재고) → 사장님 문자, 발주는 관제실 할 일
// - register/unregister/watch: 매니저 번호 등록 → 새 청소 일정·변경·취소를 문자로 알림 (watch는 10분 cron)
// - backup: 노션 청소 DB 3개 + 지점 안내 페이지 3개를 비공개 저장소(playn-private)에 JSON으로 백업하고, 앞으로의 노션 행을 playn_clean_import로 옮김
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const BR = ["홍대루프탑점", "연남루프탑점", "연트럴파크점"];

// ── playand-sync 와 같은 계산 규칙 ──
const PKG: Record<string, { inH: number; outH: number; outM: number; outDay: number }> = {
  day: { inH: 11, outH: 17, outM: 30, outDay: 0 },
  night: { inH: 19, outH: 9, outM: 30, outDay: 1 },
  full: { inH: 12, outH: 10, outM: 0, outDay: 1 },
};
const pkgOfHour = (h: number) => (h === 12 || h === 0 ? "full" : h >= 17 ? "night" : "day");
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const outLabel = (h: number, m: number) => `${h < 12 ? "오전" : "오후"}${h > 12 ? h - 12 : h}시${m ? m + "분" : ""}`;
const inLabel = (h: number) => (h === 11 ? "오전11시" : h === 12 ? "점심12시" : h === 19 ? "저녁7시" : outLabel(h, 0));
const hm = (h: number, m: number) => `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
const PKGNAME: Record<string, string> = { day: "주간", night: "야간", full: "통대관" };

async function compute(today: string, days: number) {
  const from = addDays(today, -2), until = addDays(today, days);
  const [{ data: evRows }, { data: resRows }, { data: extRows }, { data: earlyRows }, { data: ownRows }] = await Promise.all([
    sb.from("playand_ical_events").select("branch,start_at,summary").gte("start_at", from + "T00:00:00"),
    sb.from("playand_reservations").select("branch,use_date,start_h,status,phone,pkg").gte("use_date", from),
    sb.from("playn_extensions").select("branch,hours,orig_end,new_end").eq("status", "confirmed").gte("orig_end", from),
    sb.from("playn_early_in").select("branch,orig_start,new_start").eq("status", "confirmed").gte("orig_start", from),
    sb.from("playand_ext").select("branch,name,memo,sdate,edate,shour,ehour").gte("sdate", from), // v5: 사장님이 직접 넣은 외부예약 시간
  ]);
  // v5: 사장님 입력 종료 시각 (ehour는 마지막으로 막은 시간 → 끝나는 시각 = ehour+1). 자동 막음·스클 미러는 제외
  const ownEnd = new Map<string, { date: string; h: number }>();
  for (const o of ownRows || []) {
    if (!o.branch || String(o.memo ?? "") === "플레이앤 자동" || /^스클/.test(String(o.name ?? "").replace(/\s/g, ""))) continue;
    if (Number(o.ehour) >= 23 && String(o.edate || o.sdate) === String(o.sdate)) continue; // 자정까지 막은 건 밤샘 예약(실제 퇴실은 다음 날) → 패키지 기본 퇴실 사용
    let d = String(o.edate || o.sdate), h = Number(o.ehour) + 1;
    if (h >= 24) { h -= 24; d = addDays(d, 1); }
    ownEnd.set(`${o.branch}|${o.sdate}|${o.shour}`, { date: d, h });
  }
  const digits = (p?: string | null) => String(p ?? "").replace(/\D/g, "");
  const phoneOf = new Map<string, string>();
  for (const r of resRows || []) if (r.status !== "cancelled" && digits(r.phone).length >= 10) phoneOf.set(`${r.branch}|${r.use_date}|${r.start_h}`, digits(r.phone));
  const outMin = (h: number) => { const q = PKG[pkgOfHour(h)]; return q.outH * 60 + q.outM; };
  const stayNext = (b: string, outDate: string, outM: number, ph?: string) => !!ph && (resRows || []).some((r) => r.status !== "cancelled" && r.branch === b && r.use_date === outDate && r.start_h * 60 > outM && digits(r.phone) === ph);
  const stayPrev = (b: string, d: string, h: number, ph?: string) => !!ph && (resRows || []).some((r) => r.status !== "cancelled" && r.branch === b && digits(r.phone) === ph && !(r.use_date === d && r.start_h === h) && addDays(r.use_date, PKG[pkgOfHour(r.start_h)].outDay) === d && outMin(r.start_h) < h * 60);
  const slots = new Map<string, { branch: string; date: string; h: number }>();
  const add = (b: string, d: string, h: number) => slots.set(`${b}|${d}|${h}`, { branch: b, date: d, h });
  // v6: 우리가 막아 둔 조기입실·연장·연박 칸은 예약이 아님 (예전엔 '주간 17:30 퇴실' 같은 가짜 청소 일정이 생김)
  for (const e of evRows || []) { if (/조기입실|연장|연박/.test(String((e as any).summary ?? ""))) continue; add(e.branch, String(e.start_at).slice(0, 10), +String(e.start_at).slice(11, 13)); }
  const confirmedKeys = new Set((resRows || []).filter((r) => r.status !== "cancelled").map((r) => `${r.branch}|${r.use_date}|${r.start_h}`));
  for (const r of resRows || []) if (r.status !== "cancelled") add(r.branch, r.use_date, r.start_h);
  for (const r of resRows || []) { const k = `${r.branch}|${r.use_date}|${r.start_h}`; if (r.status === "cancelled" && !confirmedKeys.has(k)) slots.delete(k); }
  const extOf = new Map<string, { hours: number; newDate: string; h: number; m: number }>();
  for (const x of extRows || []) {
    const o = String(x.orig_end), n = String(x.new_end);
    const k = `${x.branch}|${o.slice(0, 10)}|${o.slice(11, 13)}${o.slice(14, 16)}`;
    const v = { hours: +x.hours, newDate: n.slice(0, 10), h: +n.slice(11, 13), m: +n.slice(14, 16) };
    const prev = extOf.get(k); if (!prev || v.hours > prev.hours) extOf.set(k, v);
  }
  const earlyOf = new Map<string, number>();
  for (const e of earlyRows || []) earlyOf.set(`${e.branch}|${String(e.orig_start).slice(0, 10)}|${+String(e.orig_start).slice(11, 13)}`, +String(e.new_start).slice(11, 13));

  const list = [...slots.values()];
  const items: any[] = [];
  for (const s of list) {
    const pk = pkgOfHour(s.h), p = PKG[pk]; const date = addDays(s.date, p.outDay);
    if (date < today || date > until) continue;
    if (list.some((i) => i.branch === s.branch && i.date === date && i.h === 0)) continue;
    const ph = phoneOf.get(`${s.branch}|${s.date}|${s.h}`);
    // v5: 사장님 입력 시간이 패키지 기본 퇴실과 30분 이상 다르면 그 시간으로
    const own0 = ownEnd.get(`${s.branch}|${s.date}|${s.h}`);
    const ownM = own0 ? (own0.date > date ? 24 * 60 : own0.date < date ? -24 * 60 : 0) + own0.h * 60 : null;
    const own = own0 && ownM !== null && Math.abs(ownM - (p.outH * 60 + p.outM)) >= 30 ? own0 : null;
    const endM = own ? ownM! : p.outH * 60 + p.outM;
    const stay = stayNext(s.branch, date, endM, ph);
    const next = list.filter((i) => i.branch === s.branch && i.date === date && i.h * 60 > endM).sort((a, b) => a.h - b.h)[0];
    const out = hm(p.outH, p.outM); // 키는 패키지 기본 퇴실 그대로 (메모·완료 기록 유지)
    const x = own ? undefined : extOf.get(`${s.branch}|${date}|${out}`);
    const early = next ? earlyOf.get(`${s.branch}|${date}|${next.h}`) : undefined;
    const outTxt = own ? `${own.date !== date ? "익일 " : ""}${outLabel(own.h, 0)} 퇴실` : x ? `${x.newDate !== date ? "익일 " : ""}${outLabel(x.h, x.m)} 퇴실(${x.hours}시간 연장)` : `${outLabel(p.outH, p.outM)} 퇴실`;
    const inTxt = stay ? "같은 손님 연박 (중간 청소 없음)" : next ? (early !== undefined ? `당일 ${outLabel(early, 0)} 조기입실` : `당일 ${inLabel(next.h)} 입실`) : "당일 입실 없음";
    const title = (stayPrev(s.branch, s.date, s.h, ph) ? "연박 " : "") + outTxt + " " + (stay ? "연박 이어짐" : next ? inTxt : "당일입실X");
    items.push({
      key: `${s.branch}|${date}|${out}`, branch: s.branch, date, out, use_date: s.date, start_h: s.h, pkg: PKGNAME[pk],
      out_txt: outTxt, in_txt: inTxt, title, ext: x ? x.hours : 0, stay, stay_prev: stayPrev(s.branch, s.date, s.h, ph),
      gap_min: next && !stay ? (early !== undefined ? early * 60 : next.h * 60) - (own ? endM : x ? (x.newDate !== date ? 24 * 60 : 0) + x.h * 60 + x.m : p.outH * 60 + p.outM) : null, own_time: !!own,
    });
  }
  // 같은 키 중복 제거
  const uniq = new Map(items.map((i) => [i.key, i]));
  return [...uniq.values()].sort((a, b) => (a.date + a.out + a.branch).localeCompare(b.date + b.out + b.branch));
}

async function cfgOf(keys: string[]) {
  const { data } = await sb.from("playand_config").select("key,value").in("key", keys);
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
}

// ── 노션 백업 ──
async function notion(token: string, path: string, method = "GET", body?: unknown) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch("https://api.notion.com/v1/" + path, { method, headers: { Authorization: "Bearer " + token, "Notion-Version": "2022-06-28", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1200 * (i + 1))); continue; }
    const j = await r.json(); if (!r.ok) throw new Error(`notion ${path} ${r.status} ${j.message}`); return j;
  }
  throw new Error("notion retry " + path);
}
async function blocksDeep(token: string, id: string, depth = 0): Promise<any[]> {
  const out: any[] = []; let cursor: string | undefined;
  do {
    const j = await notion(token, `blocks/${id}/children?page_size=100${cursor ? "&start_cursor=" + cursor : ""}`);
    for (const b of j.results) { if (b.has_children && depth < 4) b._children = await blocksDeep(token, b.id, depth + 1); out.push(b); }
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}
const GUIDE_PAGES: Record<string, string> = { "홍대루프탑점": "224f13b49cff8016994fd539d281daff", "연남루프탑점": "224f13b49cff80dab61ac2ca3dd0af46", "연트럴파크점": "224f13b49cff80358b21c7257c517e19" };


// ── 2026-10-18 v3: 완료 보고·퀘스트·알림 ──
const SHORT = ["장작", "숯", "일회용불판", "물", "음료", "건전지"];
const PHOTO_KINDS = ["room", "bbq", "drink", "water", "meter", "extra"];
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1~12
// 연남 수도 사진: 그 달 말일이 들어 있는 주(월~일)에 해당 달 사진이 없으면 퀘스트
function meterQuest(today: string) {
  const t = new Date(today + "T00:00:00Z");
  for (const off of [0, 1, -1]) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + off, 1));
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, L = new Date(Date.UTC(y, m - 1, lastDay(y, m)));
    const dow = (L.getUTCDay() + 6) % 7; // 월=0
    const mon = new Date(L.getTime() - dow * 86400e3), sun = new Date(mon.getTime() + 6 * 86400e3);
    if (t >= mon && t <= sun) return { month: `${y}-${String(m).padStart(2, "0")}`, last: L.toISOString().slice(0, 10) };
  }
  return null;
}
async function smsTo(cfg: Record<string, string>, to: string, msg: string) {
  if (!cfg.macrodroid_webhook || !to) return false;
  const u = new URL(cfg.macrodroid_webhook);
  u.searchParams.set("phone", String(to).replace(/\D/g, "")); u.searchParams.set("msg", msg);
  try { return (await fetch(u.toString())).ok; } catch { return false; }
}
const WD = "일월화수목금토";
const dl = (d: string) => { const x = new Date(d + "T00:00:00Z"); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${WD[x.getUTCDay()]})`; };
const sign = async (p: string) => (await sb.storage.from("playn-private").createSignedUrl(p, 7 * 86400)).data?.signedUrl ?? null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let b: any = {};
  try { b = req.method === "POST" ? await req.json() : Object.fromEntries(new URL(req.url).searchParams); } catch { return J({ ok: false, error: "요청 형식 오류" }, 400); }
  const c = await cfgOf(["cleaner_key", "admin_key", "intake_key", "notion_token", "macrodroid_webhook", "owner_phone"]);
  const isOwner = (c.admin_key && b.k === c.admin_key) || (c.intake_key && b.k === c.intake_key);
  const isCleaner = isOwner || (c.cleaner_key && b.k === c.cleaner_key);
  if (!isCleaner) return J({ ok: false, error: "링크가 맞지 않아요. 사장님께 새 링크를 받아 주세요" }, 401);
  const action = b.action ?? "board";
  const today = kstToday();

  if (action === "board") {
    const days = Math.max(1, Math.min(31, Number(b.days) || 7));
    const items = await compute(today, days);
    const until = addDays(today, days);
    const [{ data: notes }, { data: imp }] = await Promise.all([
      sb.from("playn_clean_notes").select("key,memo,done,done_at,by_name,updated_at").gte("out_date", addDays(today, -1)).lte("out_date", until),
      sb.from("playn_clean_import").select("page_id,branch,out_date,title,memo,auto_key").gte("out_date", today).lte("out_date", until),
    ]);
    const nm = new Map((notes ?? []).map((n) => [n.key, n]));
    // 노션에서 사람이 제목을 바꿔 둔 항목(예: 늦은 퇴실 합의)은 그 제목을 같이 보여 줌
    const legacy = new Map((imp ?? []).filter((r) => r.auto_key).map((r) => [r.auto_key, r.title]));
    const sq = (x: string) => String(x ?? "").replace(/\s/g, "");
    const out = items.map((i) => { const lt = legacy.get(i.key); return { ...i, note: nm.get(i.key) ?? null, notion_title: lt && sq(lt) !== sq(i.title) ? lt : null }; });
    // 노션에서 사람이 직접 적은 일정(자동 항목과 겹치지 않는 것)은 따로 보여 줌
    const manual = (imp ?? []).filter((r) => !r.auto_key && !String(r.memo ?? "").startsWith("자동|")).map((r) => ({ key: "notion|" + r.page_id, branch: r.branch, date: r.out_date, title: r.title, memo: r.memo, note: nm.get("notion|" + r.page_id) ?? null }));
    // 예약 번호(방 사진 AI 점검용)와 완료 보고
    const { data: rs } = await sb.from("playand_reservations").select("id,branch,use_date,start_h").neq("status", "cancelled").gte("use_date", addDays(today, -2));
    const { data: reps } = await sb.from("playn_clean_reports").select("id,key,by_name,memo,photos,shortages,ai_verdict,created_at").in("key", out.map((i) => i.key).concat(manual.map((x) => x.key), ["-"])).order("id");
    const repOf = new Map<string, any>(); for (const r of reps ?? []) repOf.set(r.key, r);
    for (const i of out as any[]) {
      i.res_id = (rs ?? []).find((r) => r.branch === i.branch && r.use_date === i.use_date && r.start_h === i.start_h)?.id ?? null;
      const r = repOf.get(i.key);
      if (r) {
        const ph: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(r.photos ?? {})) ph[k] = (await Promise.all((v as string[]).slice(0, 6).map(sign))).filter(Boolean) as string[];
        i.report = { at: r.created_at, by: r.by_name, memo: r.memo, shortages: r.shortages, ai: r.ai_verdict, photos: ph };
      }
    }
    for (const mi of manual as any[]) { const r = repOf.get(mi.key); if (r) mi.report = { at: r.created_at, by: r.by_name, memo: r.memo, shortages: r.shortages }; }
    const q = meterQuest(today);
    let quest = null;
    if (q) { const { count } = await sb.from("playn_clean_reports").select("id", { count: "exact", head: true }).eq("branch", "연남루프탑점").eq("meter_month", q.month); quest = { branch: "연남루프탑점", month: q.month, last: q.last, done: (count ?? 0) > 0 }; }
    return J({ ok: true, today, now: new Date().toISOString(), items: out, manual, owner: !!isOwner, quest, short_items: SHORT });
  }
  if (action === "note") {
    const key = String(b.key ?? "");
    const m = key.match(/^(홍대루프탑점|연남루프탑점|연트럴파크점)\|(\d{4}-\d{2}-\d{2})\|\d{4}$/) || key.match(/^notion\|[0-9a-f-]{32,36}$/);
    if (!m) return J({ ok: false, error: "항목을 다시 골라 주세요" }, 400);
    let branch = m[1], date = m[2];
    if (key.startsWith("notion|")) { const { data: r } = await sb.from("playn_clean_import").select("branch,out_date").eq("page_id", key.slice(7)).maybeSingle(); if (!r) return J({ ok: false, error: "없는 항목" }, 404); branch = r.branch; date = r.out_date; }
    const row: any = { key, branch, out_date: date, updated_at: new Date().toISOString() };
    if (b.memo !== undefined) row.memo = String(b.memo).slice(0, 500);
    if (b.done !== undefined) { row.done = !!b.done; row.done_at = b.done ? new Date().toISOString() : null; }
    if (b.by) row.by_name = String(b.by).slice(0, 20);
    const { error } = await sb.from("playn_clean_notes").upsert(row, { onConflict: "key" });
    return J({ ok: !error, error: error?.message });
  }
  if (action === "report") {
    const key = String(b.key ?? "");
    let m: any = key.match(/^(홍대루프탑점|연남루프탑점|연트럴파크점)\|(\d{4}-\d{2}-\d{2})\|\d{4}$/) || (key === "quest" ? [key, "연남루프탑점", today] : null);
    if (!m && /^notion\|[0-9a-f-]{32,36}$/.test(key)) { const { data: r } = await sb.from("playn_clean_import").select("branch,out_date").eq("page_id", key.slice(7)).maybeSingle(); if (r) m = [key, r.branch, r.out_date]; }
    if (!m) return J({ ok: false, error: "항목을 다시 골라 주세요" }, 400);
    const branch = m[1], date = m[2], by = String(b.by ?? "").slice(0, 20) || null;
    const photos: Record<string, string[]> = {};
    let n = 0;
    for (const kind of PHOTO_KINDS) {
      const arr = Array.isArray(b.photos?.[kind]) ? b.photos[kind].slice(0, 4) : [];
      for (const [i, du] of arr.entries()) {
        const mm = String(du).match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
        if (!mm || mm[2].length > 4_000_000) continue;
        const path = `clean-report/${branch}/${date}/${kind}-${Date.now()}-${i}.${mm[1] === "jpeg" ? "jpg" : mm[1]}`;
        const up = await sb.storage.from("playn-private").upload(path, Uint8Array.from(atob(mm[2]), (ch) => ch.charCodeAt(0)), { contentType: "image/" + mm[1] });
        if (!up.error) { (photos[kind] ??= []).push(path); n++; }
      }
    }
    const shortages = (Array.isArray(b.shortages) ? b.shortages : []).filter((x: string) => SHORT.includes(x));
    const memo = b.memo ? String(b.memo).slice(0, 500) : null;
    const q = meterQuest(today);
    const meter_month = photos.meter?.length && branch === "연남루프탑점" ? (q?.month ?? today.slice(0, 7)) : null;
    const { data: row, error } = await sb.from("playn_clean_reports").insert({ key, branch, out_date: date, by_name: by, memo, photos, shortages, meter_month, ai_verdict: b.ai_verdict ? String(b.ai_verdict).slice(0, 20) : null }).select("id,created_at").single();
    if (error) return J({ ok: false, error: "저장하지 못했어요. 다시 눌러 주세요" }, 500);
    if (key !== "quest") await sb.from("playn_clean_notes").upsert({ key, branch, out_date: date, done: true, done_at: new Date().toISOString(), by_name: by, ...(memo ? { memo } : {}), updated_at: new Date().toISOString() }, { onConflict: "key" });
    // 사장님께 보고 + 부족 재고는 관제실 할 일로
    const lines = [`[청소 ${key === "quest" ? "수도 사진" : "완료"}] ${branch} ${dl(date)}${by ? " · " + by : ""}`, `사진 ${n}장${meter_month ? " (수도 " + meter_month + ")" : ""}`];
    if (shortages.length) lines.push(`🛒 부족: ${shortages.join(", ")}`);
    if (memo) lines.push(`📝 ${memo.slice(0, 120)}`);
    lines.push(`보기: https://playn.kr/clean/?k=${c.cleaner_key}`);
    await smsTo(c, c.owner_phone, lines.join("\n"));
    for (const it of shortages) await sb.from("hq_todos").upsert({ brand: "playn", text: `🛒 ${branch.replace("루프탑점", "").replace("파크점", "")} ${it} 발주 (청소 매니저 체크 ${dl(today)})`, dedupe_key: `stock:${branch}:${it}:${today}` }, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (shortages.length) await sb.from("hq_activity").insert({ who: by ?? "청소 매니저", brand: "playn", text: `${branch} 재고 부족: ${shortages.join(", ")}`, dedupe_key: `stockact:${row!.id}` });
    return J({ ok: true, id: row!.id, at: row!.created_at, photos: n });
  }
  if (action === "register") {
    const phone = String(b.phone ?? "").replace(/\D/g, "");
    if (!/^01\d{8,9}$/.test(phone)) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const branches = (Array.isArray(b.branches) ? b.branches : []).filter((x: string) => BR.includes(x));
    await sb.from("playn_cleaners").upsert({ phone, name: String(b.name ?? "").slice(0, 20) || null, branches: branches.length ? branches : BR, active: true });
    await smsTo(c, phone, `[플레이앤 청소] 알림 등록 완료 ✅\n${(branches.length ? branches : BR).join(", ")} 새 청소 일정이 생기거나 바뀌면 바로 문자 드릴게요.\n일정 보기: https://playn.kr/clean/?k=${c.cleaner_key}`);
    return J({ ok: true });
  }
  if (action === "unregister") {
    const phone = String(b.phone ?? "").replace(/\D/g, "");
    await sb.from("playn_cleaners").update({ active: false }).eq("phone", phone);
    return J({ ok: true });
  }
  if (action === "watch") {
    if (!isOwner) return J({ ok: false }, 401);
    const items = await compute(today, 7);
    const { data: seen } = await sb.from("playn_clean_seen").select("*").gte("out_date", today);
    const seenMap = new Map((seen ?? []).map((r) => [r.key, r]));
    const first = !(seen ?? []).length && !(await sb.from("playn_clean_seen").select("key", { count: "exact", head: true })).count;
    const { data: cl } = await sb.from("playn_cleaners").select("phone,branches").eq("active", true);
    const msgs: { branch: string; text: string }[] = [];
    for (const i of items) {
      const s0 = seenMap.get(i.key);
      if (!s0) { if (!first) msgs.push({ branch: i.branch, text: `🆕 새 청소 일정: ${i.branch.replace("루프탑점", "").replace("파크점", "")} ${dl(i.date)} ${i.out_txt} → ${i.in_txt}` }); await sb.from("playn_clean_seen").upsert({ key: i.key, branch: i.branch, out_date: i.date, title: i.title, updated_at: new Date().toISOString(), gone: false }); }
      else if (s0.gone || s0.title !== i.title) { if (!first) msgs.push({ branch: i.branch, text: `🔄 청소 일정 변경: ${i.branch.replace("루프탑점", "").replace("파크점", "")} ${dl(i.date)} ${i.out_txt} → ${i.in_txt}` }); await sb.from("playn_clean_seen").update({ title: i.title, gone: false, updated_at: new Date().toISOString() }).eq("key", i.key); }
    }
    const now = new Set(items.map((i) => i.key));
    for (const s0 of seen ?? []) if (!s0.gone && !now.has(s0.key) && s0.out_date <= addDays(today, 7)) {
      msgs.push({ branch: s0.branch, text: `❌ 청소 일정 취소: ${s0.branch.replace("루프탑점", "").replace("파크점", "")} ${dl(s0.out_date)} (예약 취소)` });
      await sb.from("playn_clean_seen").update({ gone: true, updated_at: new Date().toISOString() }).eq("key", s0.key);
    }
    let sent = 0;
    for (const p of cl ?? []) {
      const mine = msgs.filter((x) => (p.branches ?? BR).includes(x.branch));
      if (!mine.length) continue;
      await smsTo(c, p.phone, [`[플레이앤 청소]`, ...mine.map((x) => x.text), `일정 보기: https://playn.kr/clean/?k=${c.cleaner_key}`].join("\n"));
      sent++;
    }
    return J({ ok: true, first, changes: msgs.length, sent });
  }
  if (action === "backup") {
    if (!isOwner) return J({ ok: false, error: "사장님 키 필요" }, 401);
    const token = c.notion_token; if (!token) return J({ ok: false, error: "노션 토큰 없음" });
    const dbs = await cfgOf(BR.map((x) => "notion_db:" + x));
    const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const report: any = { db: {}, guide: {}, imported: 0 };
    const { data: mirror } = await sb.from("playand_notion_items").select("key,page_id");
    const autoOf = new Map((mirror ?? []).map((m) => [m.page_id, m.key]));
    for (const br of BR) {
      const db = dbs["notion_db:" + br]; if (!db) continue;
      const rows: any[] = []; let cursor: string | undefined;
      do { const j = await notion(token, `databases/${db}/query`, "POST", { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }); rows.push(...j.results); cursor = j.has_more ? j.next_cursor : undefined; } while (cursor);
      const path = `backup/notion/${stamp}/clean_${br}.json`;
      await sb.storage.from("playn-private").upload(path, new TextEncoder().encode(JSON.stringify(rows)), { contentType: "application/json", upsert: true });
      report.db[br] = { rows: rows.length, path };
      const imp = rows.map((p: any) => ({
        page_id: p.id, branch: br, out_date: p.properties["날짜"]?.date?.start?.slice(0, 10) ?? null,
        title: (p.properties["일정"]?.title || []).map((t: any) => t.plain_text).join(""),
        memo: (p.properties["메모"]?.rich_text || []).map((t: any) => t.plain_text).join(""),
        auto_key: autoOf.get(p.id) ?? null,
      })).filter((r) => r.out_date && r.out_date >= addDays(today, -1));
      if (imp.length) { await sb.from("playn_clean_import").upsert(imp, { onConflict: "page_id" }); report.imported += imp.length; }
    }
    for (const [br, id] of Object.entries(GUIDE_PAGES)) {
      const page = await notion(token, `pages/${id}`);
      const blocks = await blocksDeep(token, id);
      const path = `backup/notion/${stamp}/guide_${br}.json`;
      await sb.storage.from("playn-private").upload(path, new TextEncoder().encode(JSON.stringify({ page, blocks })), { contentType: "application/json", upsert: true });
      report.guide[br] = { blocks: blocks.length, path };
    }
    return J({ ok: true, ...report });
  }
  return J({ ok: false, error: "모르는 요청" }, 400);
});
