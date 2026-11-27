// stay-clean v1 (2026-11-27): 플레이앤 스테이(삼삼엠투) 청소 체크리스트
// - board: 예약 일정·지난 보고·입실 정보(도어락·컴퓨터 비밀번호). 청소 링크 열쇠(stay_clean_key) 또는 사장님 열쇠(admin_key)
// - photo: 사진 1장 업로드(비공개 저장소 playn-private/stay-clean/) → 경로 반환
// - report: 체크리스트 보고 저장 → 사장님께 문자, 부족한 소모품은 관제실 할 일로
// - booking_add / booking_cancel: 사장님만. 등록하면 청소 연락처로 일정 문자
// - remind: 사장님 열쇠(cron). 내일 퇴실이 있으면 청소 연락처로 알림 문자
// 키·번호는 전부 playand_config / stay_guest_secrets 에서 읽는다(코드에 없음)
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const WD = "일월화수목금토";
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const md = (d: string) => { const x = new Date(d + "T00:00:00Z"); return `${x.getUTCMonth() + 1}월 ${x.getUTCDate()}일(${WD[x.getUTCDay()]})`; };
const isYmd = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const SUPPLIES = ["샴푸", "린스", "바디워시", "세탁세제", "주방세제"];
const PHOTO_KINDS = ["before", "after"];
const LINK = (k: string) => `https://playn.kr/stay/clean/#k=${k}`;

async function cfg() {
  const { data } = await sb.from("playand_config").select("key,value").in("key", ["stay_clean_key", "admin_key", "owner_phone", "stay_cleaner_phone", "macrodroid_webhook"]);
  const o: Record<string, string> = {};
  for (const r of data ?? []) o[r.key] = String(r.value ?? "");
  return o;
}
async function sms(c: Record<string, string>, to: string, msg: string) {
  if (!c.macrodroid_webhook || !to) return false;
  const u = new URL(c.macrodroid_webhook);
  u.searchParams.set("phone", String(to).replace(/\D/g, "")); u.searchParams.set("msg", msg);
  try { return (await fetch(u.toString())).ok; } catch { return false; }
}
const sign = async (p: string) => (await sb.storage.from("playn-private").createSignedUrl(p, 7 * 86400)).data?.signedUrl ?? null;
const scheduleMsg = (b: { in_date: string; out_date: string }, k: string) =>
  `[플레이앤 스테이]\n${md(b.in_date)}부터 ${md(b.out_date)}까지 예약 들어왔습니다.\n${md(b.out_date)} 오전 10시 체크아웃입니다.\n확인 부탁드립니다.\n청소 체크리스트: ${LINK(k)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { return J({ ok: false }, 400); }
  const c = await cfg();
  const k = String(b.k ?? "");
  const isOwner = !!c.admin_key && k === c.admin_key;
  const isCleaner = isOwner || (!!c.stay_clean_key && k === c.stay_clean_key);
  if (!isCleaner) { await new Promise((r) => setTimeout(r, 400)); return J({ ok: false, error: "링크를 다시 확인해 주세요" }, 403); }
  const today = kstToday();
  const action = String(b.action ?? "board");

  if (action === "board") {
    const [{ data: bk }, { data: reps }, { data: sec }, { data: lastTowel }] = await Promise.all([
      sb.from("stay_bookings").select("id,in_date,out_date,status,memo").neq("status", "cancelled").gte("out_date", addDays(today, -7)).order("out_date"),
      sb.from("stay_clean_reports").select("id,booking_id,out_date,created_at,towel_count,pc_state,supplies,damage_memo,shortage_memo,memo,checks,photos").gte("out_date", addDays(today, -30)).order("id", { ascending: false }),
      sb.from("stay_guest_secrets").select("door,pc_password").eq("id", "stay1").maybeSingle(),
      sb.from("stay_clean_reports").select("towel_count,out_date").not("towel_count", "is", null).order("id", { ascending: false }).limit(1),
    ]);
    const reports = [];
    for (const r of reps ?? []) {
      const it: any = { id: r.id, booking_id: r.booking_id, out_date: r.out_date, at: r.created_at, towel_count: r.towel_count, pc_state: r.pc_state, supplies: r.supplies, damage_memo: r.damage_memo, shortage_memo: r.shortage_memo, memo: r.memo };
      if (isOwner) {
        it.checks = r.checks;
        const ph: Record<string, string[]> = {};
        for (const [kind, arr] of Object.entries(r.photos ?? {})) ph[kind] = (await Promise.all((arr as string[]).slice(0, 20).map(sign))).filter(Boolean) as string[];
        it.photos = ph;
      } else it.photo_count = Object.values(r.photos ?? {}).reduce((n: number, a: any) => n + (a?.length ?? 0), 0);
      reports.push(it);
    }
    return J({ ok: true, owner: isOwner, today, bookings: bk ?? [], reports, door: sec?.door ?? null, pc: sec?.pc_password ?? null, last_towel: lastTowel?.[0] ?? null, supplies: SUPPLIES });
  }

  if (action === "photo") {
    const kind = PHOTO_KINDS.includes(b.kind) ? b.kind : "before";
    const date = isYmd(b.out_date) ? b.out_date : today;
    const mm = String(b.data ?? "").match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (!mm || mm[2].length > 6_000_000) return J({ ok: false, error: "사진을 다시 골라 주세요" }, 400);
    const path = `stay-clean/${date}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${mm[1] === "jpeg" ? "jpg" : mm[1]}`;
    const up = await sb.storage.from("playn-private").upload(path, Uint8Array.from(atob(mm[2]), (ch) => ch.charCodeAt(0)), { contentType: "image/" + mm[1] });
    if (up.error) return J({ ok: false, error: "사진을 올리지 못했어요. 다시 눌러 주세요" }, 500);
    return J({ ok: true, path });
  }

  if (action === "report") {
    const date = isYmd(b.out_date) ? b.out_date : today;
    const photos: Record<string, string[]> = {};
    for (const kind of PHOTO_KINDS) {
      const arr = Array.isArray(b.photos?.[kind]) ? b.photos[kind] : [];
      photos[kind] = arr.filter((p: unknown) => typeof p === "string" && p.startsWith(`stay-clean/`) && !p.includes("..")).slice(0, 40);
    }
    if (!photos.before.length) return J({ ok: false, error: "청소 전 사진을 먼저 올려 주세요" }, 400);
    const supplies: Record<string, string> = {};
    for (const s of SUPPLIES) if (b.supplies?.[s] === "ok" || b.supplies?.[s] === "low") supplies[s] = b.supplies[s];
    const checks: Record<string, boolean> = {};
    for (const [key, v] of Object.entries(b.checks ?? {})) if (/^[a-z0-9_]{1,30}$/.test(key)) checks[key] = !!v;
    const towel = Number.isFinite(Number(b.towel_count)) && String(b.towel_count) !== "" ? Math.max(0, Math.min(200, Math.round(Number(b.towel_count)))) : null;
    const pc_state = ["on", "off"].includes(b.pc_state) ? b.pc_state : null;
    const t = (x: unknown) => (x ? String(x).slice(0, 800) : null);
    const booking_id = Number.isInteger(b.booking_id) ? b.booking_id : null;
    const row = { booking_id, out_date: date, photos, checks, pc_state, towel_count: towel, supplies, damage_memo: t(b.damage_memo), shortage_memo: t(b.shortage_memo), memo: t(b.memo) };
    const { data: saved, error } = await sb.from("stay_clean_reports").insert(row).select("id,created_at").single();
    if (error) return J({ ok: false, error: "저장하지 못했어요. 다시 눌러 주세요" }, 500);
    const low = SUPPLIES.filter((s) => supplies[s] === "low");
    const lines = [`[스테이 청소 완료] ${md(date)}`, `사진: 청소 전 ${photos.before.length}장 · 청소 후 ${photos.after.length}장`];
    if (towel !== null) lines.push(`수건 총 ${towel}개`);
    if (pc_state) lines.push(`도착 때 컴퓨터: ${pc_state === "on" ? "켜져 있음" : "꺼져 있음"}`);
    if (low.length) lines.push(`부족: ${low.join(", ")}`);
    if (row.damage_memo) lines.push(`파손: ${row.damage_memo.slice(0, 100)}`);
    if (row.shortage_memo) lines.push(`비품: ${row.shortage_memo.slice(0, 100)}`);
    if (row.memo) lines.push(`메모: ${row.memo.slice(0, 100)}`);
    if (c.admin_key) lines.push(`보기: ${LINK(c.admin_key)}`);
    await sms(c, c.owner_phone, lines.join("\n"));
    for (const it of low) await sb.from("hq_todos").upsert({ brand: "playn", text: `🛒 스테이 ${it} 채우기 (청소 체크 ${md(today)})`, dedupe_key: `stay-stock:${it}:${today}` }, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (row.damage_memo || row.shortage_memo) await sb.from("hq_todos").upsert({ brand: "playn", text: `🧹 스테이 청소 메모 확인: ${(row.damage_memo || row.shortage_memo || "").slice(0, 60)}`, dedupe_key: `stay-memo:${saved!.id}` }, { onConflict: "dedupe_key", ignoreDuplicates: true });
    return J({ ok: true, id: saved!.id, at: saved!.created_at });
  }

  if (action === "booking_add") {
    if (!isOwner) return J({ ok: false, error: "사장님 링크에서만 할 수 있어요" }, 401);
    if (!isYmd(b.in_date) || !isYmd(b.out_date) || b.out_date <= b.in_date) return J({ ok: false, error: "입실일과 퇴실일을 확인해 주세요" }, 400);
    const { data: row, error } = await sb.from("stay_bookings").insert({ in_date: b.in_date, out_date: b.out_date, memo: b.memo ? String(b.memo).slice(0, 200) : null }).select("id,in_date,out_date").single();
    if (error) return J({ ok: false, error: "저장하지 못했어요" }, 500);
    let sent = false;
    if (b.notify !== false && c.stay_cleaner_phone && c.stay_clean_key) {
      sent = await sms(c, c.stay_cleaner_phone, scheduleMsg(row!, c.stay_clean_key));
      if (sent) await sb.from("stay_bookings").update({ notified_at: new Date().toISOString() }).eq("id", row!.id);
    }
    return J({ ok: true, id: row!.id, sent });
  }

  if (action === "booking_cancel") {
    if (!isOwner) return J({ ok: false, error: "사장님 링크에서만 할 수 있어요" }, 401);
    const { data: row } = await sb.from("stay_bookings").update({ status: "cancelled" }).eq("id", Number(b.id)).select("id,in_date,out_date,notified_at").maybeSingle();
    if (!row) return J({ ok: false, error: "없는 예약" }, 404);
    let sent = false;
    if (row.notified_at && b.notify !== false && c.stay_cleaner_phone) sent = await sms(c, c.stay_cleaner_phone, `[플레이앤 스테이]\n${md(row.in_date)}부터 ${md(row.out_date)}까지 예약이 취소됐습니다.\n${md(row.out_date)} 청소는 없습니다.`);
    return J({ ok: true, sent });
  }

  if (action === "remind") {
    if (!isOwner) return J({ ok: false }, 401);
    const tomorrow = addDays(today, 1);
    const { data: rows } = await sb.from("stay_bookings").select("id,in_date,out_date").eq("status", "confirmed").eq("out_date", tomorrow).is("reminded_at", null);
    let sent = 0;
    for (const r of rows ?? []) {
      if (await sms(c, c.stay_cleaner_phone, `[플레이앤 스테이]\n내일 ${md(r.out_date)} 오전 10시 체크아웃입니다.\n확인 부탁드립니다.\n청소 체크리스트: ${LINK(c.stay_clean_key)}`)) {
        await sb.from("stay_bookings").update({ reminded_at: new Date().toISOString() }).eq("id", r.id); sent++;
      }
    }
    return J({ ok: true, sent });
  }
  return J({ ok: false, error: "unknown action" }, 400);
});
