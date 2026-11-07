// playn-perk: 연장권(ext1/2/3) 손님 셀프 사용 (2026-10-15)
// 손님이 내 N CREW에서 예약과 방향(늦은퇴실/조기입실)을 고르면 앞뒤 예약을 캘린더로 확인해서
// 가능하면 바로 확정(노션 청소 일정·스페이스클라우드 다른 세부공간 막기까지), 둘 다 안 되면 대체 혜택으로 바꿈.
// 국군장병 감사 2시간권(source military_thanks) 대체 = 바베큐 무료 패키지, 그 외 = 금액 할인권(ext_fallback)
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const START_H: Record<string, number> = { day: 11, night: 19, full: 12 };
const END_H: Record<string, number> = { day: 17.5, night: 33.5, full: 34 };
const HOURS: Record<string, number> = { ext1: 1, ext2: 2, ext3: 3 };
const kstNow = () => Date.now() + 9 * 3600e3;
const kstToday = () => new Date(kstNow()).toISOString().slice(0, 10);
const kIso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const kSp = (ms: number) => kIso(ms).replace("T", " ");
const kMs = (t: string) => new Date(String(t).replace(" ", "T").slice(0, 16) + ":00Z").getTime();
const fmt = (t: string) => t.slice(5, 16).replace("-", "/").replace("T", " ");
const fmtTel = (d: string) => d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
async function cfgAll() {
  const { data } = await sb.from("playand_config").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
}
async function sms(cfg: Record<string, string>, to: string | null, msg: string) {
  if (!cfg.macrodroid_webhook || !to) return false;
  const u = new URL(cfg.macrodroid_webhook);
  u.searchParams.set("phone", String(to).replace(/\D/g, "")); u.searchParams.set("msg", msg);
  try { return (await fetch(u.toString())).ok; } catch { return false; }
}
async function sessionPhone(token: unknown) {
  const { data: s } = await sb.from("playn_sessions").select("phone,expires_at").eq("token", String(token ?? "")).maybeSingle();
  return s && new Date(s.expires_at) >= new Date() ? s.phone : null;
}
// 늦은퇴실: 이 예약의 실제 퇴실(캘린더) 뒤로 hours 시간 + 청소 버퍼 안에 다음 예약이 없어야 함
async function lateWindow(r: any, hours: number, buf: number) {
  const base = new Date(r.use_date + "T00:00:00Z").getTime() + (END_H[r.pkg] ?? 24) * 3600e3;
  const { data: cur } = await sb.from("playand_ical_events").select("start_at,end_at,summary").eq("branch", r.branch)
    .gte("end_at", kSp(base - 3 * 3600e3)).lte("end_at", kSp(base + 3 * 3600e3)).lt("start_at", kSp(base - 2 * 3600e3));
  const real = (cur ?? []).filter((e: any) => !/연장/.test(e.summary ?? ""));
  const origMs = real.length ? Math.max(...real.map((e: any) => kMs(e.end_at))) : base;
  const newMs = origMs + hours * 3600e3;
  const { data: nx } = await sb.from("playand_ical_events").select("start_at,summary").eq("branch", r.branch)
    .gte("start_at", kSp(origMs - 3600e3)).lt("start_at", kSp(newMs + buf)).order("start_at").limit(5);
  const next = (nx ?? []).filter((e: any) => kMs(e.start_at) > origMs - 3600e3 && kMs(e.start_at) >= origMs)[0];
  const { data: ex } = await sb.from("playn_extensions").select("id").eq("res_id", String(r.id)).in("status", ["requested", "confirmed"]).limit(1);
  const late = kstNow() > origMs - 30 * 60e3;
  const reason = ex?.length ? "이미 늦은퇴실이 잡혀 있어요" : late ? "퇴실 30분 전까지만 신청할 수 있어요" : next ? `다음 예약(${fmt(String(next.start_at).replace(" ", "T"))})이 있어요` : null;
  return { possible: !reason, reason, orig: kIso(origMs), to: kIso(newMs), next_start: next ? String(next.start_at).replace(" ", "T").slice(0, 16) : null };
}
// 조기입실: 원래 입실 hours 시간 전부터, 그 앞 예약 퇴실 + 청소 버퍼가 끝나 있어야 함
async function earlyWindow(r: any, hours: number, buf: number) {
  const origMs = new Date(r.use_date + "T00:00:00Z").getTime() + (Number(r.start_h ?? START_H[r.pkg] ?? 12)) * 3600e3;
  const newMs = origMs - hours * 3600e3;
  const { data: ev } = await sb.from("playand_ical_events").select("start_at,end_at,summary").eq("branch", r.branch)
    .lt("start_at", kSp(origMs)).gt("end_at", kSp(newMs - buf)).limit(10);
  const hit = (ev ?? [])[0];
  const { data: ex } = await sb.from("playn_early_in").select("id").eq("res_id", String(r.id)).eq("status", "confirmed").limit(1);
  const tooLate = kstNow() > newMs - 60 * 60e3;
  const reason = ex?.length ? "이미 조기입실이 잡혀 있어요" : tooLate ? "조기입실은 바뀐 입실 1시간 전까지만 신청할 수 있어요" : hit ? `앞 예약(${fmt(String(hit.end_at).replace(" ", "T"))} 퇴실)이 있어요` : null;
  return { possible: !reason, reason, orig: kIso(origMs), to: kIso(newMs) };
}
async function myRes(phone: string) {
  const { data } = await sb.from("playand_reservations").select("id,branch,pkg,use_date,start_h,status,guest_name").in("phone", [phone, fmtTel(phone)]).eq("status", "confirmed").gte("use_date", new Date(kstNow() - 86400e3).toISOString().slice(0, 10)).order("use_date").limit(10);
  return data ?? [];
}
async function myCoupon(phone: string, id: unknown) {
  const { data } = await sb.from("playn_coupons").select("*").eq("id", Number(id)).eq("phone", phone).maybeSingle();
  if (!data || data.status !== "active" || !HOURS[data.kind]) return null;
  if (data.expires_at && String(data.expires_at).slice(0, 10) < kstToday()) return null;
  return data;
}
const PKG_KO: Record<string, string> = { day: "데이", night: "나이트", full: "통대관" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let b: any; try { b = await req.json(); } catch { return J({ error: "bad json" }, 400); }
  const phone = await sessionPhone(b.token);
  if (!phone) return J({ ok: false, expired: true, error: "다시 로그인해 주세요" });
  const cfg = await cfgAll();
  const buf = Number(JSON.parse(cfg.ext_settings ?? "{}").buffer_hours ?? 1) * 3600e3;

  // 1) 쓸 수 있는 예약과 방향별 가능 여부 미리 보기
  if (b.action === "ext_options") {
    const c = await myCoupon(phone, b.coupon_id);
    if (!c) return J({ ok: false, error: "쓸 수 있는 연장권이 아니에요" });
    const h = HOURS[c.kind], out = [];
    for (const r of await myRes(phone)) {
      const [late, early] = await Promise.all([lateWindow(r, h, buf), earlyWindow(r, h, buf)]);
      out.push({ id: r.id, branch: r.branch, label: `${r.use_date.slice(5).replace("-", "/")} ${r.branch} ${PKG_KO[r.pkg] ?? r.pkg}`, late, early });
    }
    return J({ ok: true, hours: h, military: c.source === "military_thanks", items: out });
  }

  // 2) 사용 신청 → 확인 → 확정 or 대체 혜택
  if (b.action === "ext_use") {
    const c = await myCoupon(phone, b.coupon_id);
    if (!c) return J({ ok: false, error: "쓸 수 있는 연장권이 아니에요" });
    const r = (await myRes(phone)).find((x) => String(x.id) === String(b.res_id));
    if (!r) return J({ ok: false, error: "내 예약에서 찾지 못했어요. 예약한 번호로 로그인했는지 확인해 주세요" });
    const h = HOURS[c.kind], dir = b.dir === "early" ? "early" : "late";
    const mil = c.source === "military_thanks";
    const { data: me } = await sb.from("playn_members").select("name").eq("phone", phone).maybeSingle();
    const guest = me?.name ?? r.guest_name ?? null;
    const cond = mil ? "\n※ 체크인 때 같이 온 인원 모두 N CREW 가입 확인" : "";
    const [late, early] = await Promise.all([lateWindow(r, h, buf), earlyWindow(r, h, buf)]);
    const w = dir === "late" ? late : early, other = dir === "late" ? early : late;
    const tag = `${c.title} (#${c.id})`;
    if (w.possible && dir === "late") {
      const { data: ins } = await sb.from("playn_extensions").insert({ res_id: String(r.id), branch: r.branch, phone, guest, hours: h, orig_end: w.orig, new_end: w.to, next_start: (late as any).next_start, session: "coupon:" + c.id, note: tag }).select("id").single();
      const res = ins ? await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/playn-auto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "admin_ext_decide", key: cfg.admin_key, id: ins.id, approve: true, auto: true, price: 0, note: tag }), signal: AbortSignal.timeout(120000) }).then((x) => x.json()).catch(() => ({ ok: false })) : { ok: false };
      if (res?.ok) {
        await sb.from("playn_coupons").update({ status: "used", used_at: new Date().toISOString(), used_note: "ext:" + ins!.id }).eq("id", c.id);
        if (mil) await sms(cfg, cfg.owner_phone, `[국군장병 2시간권 사용] ${r.branch} ${guest ?? ""} 늦은퇴실 ${fmt(w.orig)} → ${fmt(w.to)} 자동 확정${cond}`);
        return J({ ok: true, done: "late", message: `늦은퇴실 확정! 퇴실 ${fmt(w.to)} (문자로도 보내드려요)` });
      }
      if (ins) await sb.from("playn_extensions").update({ status: "rejected", note: "직전 확인에서 겹침", decided_at: new Date().toISOString() }).eq("id", ins.id).eq("status", "requested");
      w.possible = false; w.reason = /겹쳐/.test(res?.error ?? "") ? "방금 다음 예약이 확인됐어요" : "확인 중 문제가 생겼어요. 잠시 뒤 다시 눌러 주세요";
    }
    if (w.possible && dir === "early") {
      const { data: e } = await sb.from("playn_early_in").insert({ res_id: String(r.id), branch: r.branch, phone, guest, hours: h, orig_start: w.orig, new_start: w.to, coupon_id: c.id, note: tag }).select("id").single();
      await sb.from("playn_coupons").update({ status: "used", used_at: new Date().toISOString(), used_note: "early:" + e?.id }).eq("id", c.id);
      const H = { "content-type": "application/json", "x-playand-key": cfg.intake_key };
      await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/playand-sync", { method: "POST", headers: H, body: JSON.stringify({ skip_ical: true }), signal: AbortSignal.timeout(45000) }).catch(() => {});
      await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/playand-intake", { method: "POST", headers: H, body: JSON.stringify({ source: "block_todo" }), signal: AbortSignal.timeout(20000) }).catch(() => {});
      await sms(cfg, phone, `[플레이앤] ${r.branch} 조기입실이 확정됐어요 ⏰\n입실 시간: ${fmt(w.to)} (원래 ${fmt(w.orig).slice(6)})\n출입 비밀번호는 입실 3시간 전부터 문자·체크인 화면에서 볼 수 있어요.`);
      await sms(cfg, cfg.owner_phone, `[조기입실 자동 확정] ${r.branch} ${guest ?? ""} 입실 ${fmt(w.orig)} → ${fmt(w.to)} (${tag})\n앞 퇴실 청소를 ${fmt(w.to).slice(6)} 전까지 끝내 주세요. 노션·스클 막기 자동.${cond}`);
      return J({ ok: true, done: "early", message: `조기입실 확정! 입실 ${fmt(w.to)} (문자로도 보내드려요)` });
    }
    // 고른 방향이 안 되면: 다른 방향이 되면 그쪽을 권하고, 둘 다 안 되면 대체 혜택으로 바로 바꿈
    if (other.possible && !b.convert) return J({ ok: false, suggest: dir === "late" ? "early" : "late", error: `${w.reason}. 대신 ${dir === "late" ? "조기입실" : "늦은퇴실"}(${fmt(other.to)})은 가능해요` });
    const booked = (x: any) => /예약\(/.test(x.reason ?? "") || /다음 예약이 확인/.test(x.reason ?? "");
    if (!booked(late) || !(booked(early) || /1시간 전까지만/.test(early.reason ?? ""))) return J({ ok: false, error: w.reason ?? "지금은 쓸 수 없어요" });
    let alt = "";
    if (mil) {
      await sb.from("playn_coupons").insert({ phone, source: "military_bbq:" + c.id, kind: "bbq", title: "국군장병 감사 바베큐 무료 패키지", detail: `${r.branch} ${r.use_date} 예약 · 인원 전체 16인분까지 무료 (시간 연장 대신)`, expires_at: c.expires_at });
      alt = "바베큐 무료 패키지(인원 전체)";
    } else {
      const fb = Number(JSON.parse(cfg.perk_rules ?? "{}").ext_fallback ?? 40000);
      await sb.from("playn_coupons").insert({ phone, source: "ext_fb:" + c.id, kind: "won", amount: fb, title: `연장 대신 ${fb.toLocaleString()}원 할인권`, detail: "앞뒤 예약 때문에 연장을 못 써서 드리는 할인권이에요.", expires_at: c.expires_at });
      alt = `${fb.toLocaleString()}원 할인권`;
    }
    await sb.from("playn_coupons").update({ status: "used", used_at: new Date().toISOString(), used_note: "대체 혜택으로 전환: " + alt }).eq("id", c.id);
    await sms(cfg, phone, `[플레이앤] ${r.branch} 앞뒤로 다른 예약이 있어서 조기입실·늦은퇴실이 어려워요 🙏\n대신 ${alt}으로 바꿔드렸어요. 내 쿠폰: https://playn.kr/me/${mil ? "\n체크인 때 '바베큐 해요'를 고르면 정산에서 자동으로 빠져요." : ""}`);
    await sms(cfg, cfg.owner_phone, `[연장권 → 대체 혜택] ${r.branch} ${r.use_date} ${guest ?? ""}: 늦은퇴실(${late.reason}) · 조기입실(${early.reason}) 둘 다 불가 → ${alt} 자동 지급${cond}`);
    return J({ ok: true, done: "alt", message: `앞뒤 예약 때문에 시간은 못 늘려서 ${alt}으로 바꿔드렸어요` });
  }
  return J({ error: "unknown action" }, 400);
});
