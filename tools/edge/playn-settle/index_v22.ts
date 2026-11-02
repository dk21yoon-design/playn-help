// playn-settle: 보증금 자동 정산 (입실 전 체크인 → 퇴실 후 사용 내역 → 자동 계산 → 사장님 송금 확인 → 손님 문자)
// v22 (2026-11-02): 후기 이벤트 캡처는 사장님이 '후기 인증 수락'을 눌러야 통과 (review_ok: null 확인 대기 / true 수락 / false 반려 → 손님 다시 올림). 되돌리기: index_v21.ts
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ── N CREW v1 (2026-10-30): 광고 판단·수신 거부 링크·접속 구분 (DB 함수 playn_ad_ok / playn_optout_link)
async function adOk(phone: string) { const { data } = await sb.rpc("playn_ad_ok", { p_phone: phone }); return data === true; }
async function adFooter(phone: string) { const { data: t } = await sb.rpc("playn_optout_link", { p_phone: phone }); return t ? `수신거부 playn.kr/stop/?t=${t}` : "수신거부: playn.kr 맨 아래"; }
async function withFooter(msg: string, phone: string) { return msg.replace("수신거부: playn.kr 맨 아래", await adFooter(phone)); }
async function otpIpHash(req: Request) {
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim(); if (!ip) return null;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ncrew-otp:" + ip)));
  return Array.from(d.slice(0, 8)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const ACCOUNT = "토스뱅크 100008287587 (예금주 윤도권)";
const END_H: Record<string, number> = { day: 17.5, night: 33.5, full: 34 };
const PKN: Record<string, string> = { day: "주간", night: "나이트", full: "통대관" };
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((x) => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("");
const won = (n: number) => n.toLocaleString("ko-KR") + "원";

async function cfgAll() {
  const { data } = await sb.from("playand_config").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
}
async function sms(cfg: Record<string, string>, to: string | null | undefined, msg: string) {
  if (!cfg.macrodroid_webhook || !to) return false;
  const u = new URL(cfg.macrodroid_webhook);
  u.searchParams.set("phone", String(to).replace(/\D/g, "")); u.searchParams.set("msg", msg);
  try { return (await fetch(u.toString())).ok; } catch { return false; }
}
const maskAcc = (a: string) => String(a ?? "").replace(/\d(?=\d{4})/g, "*");
async function extHours(resId: string | null) {
  if (!resId) return 0;
  const { data } = await sb.from("playn_extensions").select("hours").eq("res_id", resId).eq("status", "confirmed");
  return (data ?? []).reduce((a, x) => a + Number(x.hours), 0);
}
function endMs(s: any, ext = 0) { return new Date(s.use_date + "T00:00:00Z").getTime() + ((END_H[s.pkg] ?? 24) + ext) * 3600e3; }

// 롤드컵 이벤트: 이용일이 기간 안이고 예측 마감 전이면 참여 가능
function worldsOf(cfg: Record<string, string>, s: any) {
  let w: any; try { w = JSON.parse(cfg.worlds_event ?? "null"); } catch { return null; }
  if (!w?.on) return null;
  const d = String(s.use_date);
  if (d < w.from || d > w.to) return null;
  if (Array.isArray(w.pkgs) && !w.pkgs.includes(s.pkg)) return null; // 나이트·통대관만
  const tier = tierNow(w);
  return { title: w.title, teams: w.teams ?? [], payout: tier?.payout ?? 0, tier: tier?.label ?? null, tiers: w.tiers ?? [], rule: w.rule ?? null, final: w.final, open: !!tier && Date.now() < new Date(w.lock).getTime() };
}
// 지금 제출하면 받는 금액 구간 (8강 전 10만원 / 8강 이후 5만원)
function tierNow(w: any) {
  const now = Date.now();
  return (w.tiers ?? [{ until: w.lock, payout: w.payout, label: "" }]).find((t: any) => now < new Date(t.until).getTime()) ?? null;
}
// 팀 가입 현황: 팀 링크로 가입한 N CREW 멤버 수 (예약자 포함)
async function crewProgress(p: any) {
  if (!p?.group_code) return { joined: 0, need: p?.headcount ?? 0, valid: false };
  const { data } = await sb.from("playn_worlds_crew").select("phone").eq("group_code", p.group_code);
  const phones = (data ?? []).map((r) => r.phone);
  let joined = 0;
  if (phones.length) { const { count } = await sb.from("playn_members").select("phone", { count: "exact", head: true }).in("phone", phones).eq("status", "active"); joined = count ?? 0; }
  return { joined, need: p.headcount ?? 0, valid: joined >= (p.headcount ?? 1) };
}
// ── N CREW 전원 가입 → 퇴실 무료 연장 (2026-10-11) ──
// 퇴실 시각(스페이스클라우드 캘린더 기준)과 다음 예약을 보고 무료 연장이 되는지 판단. 안 되면 대체 혜택(alt).
const kIso = (ms: number) => new Date(ms).toISOString().slice(0, 16); // KST 값 "YYYY-MM-DDTHH:MM"
const kMs = (t: string) => new Date(String(t).replace(" ", "T").slice(0, 16) + ":00Z").getTime();
async function fxWindow(cfg: Record<string, string>, s: any) {
  const fx = JSON.parse(cfg.fx_settings ?? "{}"), hours = Number(fx.hours ?? 1);
  const buf = Number(JSON.parse(cfg.ext_settings ?? "{}").buffer_hours ?? 1) * 3600e3;
  const { data: exts } = await sb.from("playn_extensions").select("id,status").eq("res_id", s.res_id ?? "-").in("status", ["requested", "confirmed"]);
  const base = endMs(s); // 패키지 기준 퇴실
  // 같은 예약의 캘린더 이벤트 종료 시각을 쓰면 노션 청소 일정 키와 맞음
  const lo = kIso(base - 3 * 3600e3).replace("T", " "), hi = kIso(base + 3 * 3600e3).replace("T", " ");
  const { data: cur } = await sb.from("playand_ical_events").select("start_at,end_at,summary").eq("branch", s.branch).gte("end_at", lo).lte("end_at", hi).lt("start_at", kIso(base - 2 * 3600e3).replace("T", " "));
  const real = (cur ?? []).filter((e: any) => !/연장/.test(e.summary ?? ""));
  const origMs = real.length ? Math.max(...real.map((e: any) => kMs(e.end_at))) : base;
  const newMs = origMs + hours * 3600e3;
  const { data: nx } = await sb.from("playand_ical_events").select("start_at,summary").eq("branch", s.branch)
    .gte("start_at", kIso(origMs - 3600e3).replace("T", " ")).lt("start_at", kIso(newMs + buf).replace("T", " ")).order("start_at").limit(5);
  const next = (nx ?? []).filter((e: any) => !/연장/.test(e.summary ?? "") && kMs(e.start_at) > origMs - 3600e3)[0];
  const reason = (exts ?? []).length ? "이미 연장이 잡혀 있어요" : next ? "다음 예약이 있어요" : null;
  return { possible: !reason, reason, hours, orig_end: kIso(origMs), new_end: kIso(newMs), next_start: next ? String(next.start_at).replace(" ", "T").slice(0, 16) : null,
    deadline: kIso(origMs - Number(fx.deadline_min ?? 30) * 60e3), alt: String(fx.alt ?? "") };
}
async function fxProgress(g: any) {
  const { data } = await sb.from("playn_fx_members").select("phone").eq("code", g.code);
  const phones = new Set((data ?? []).map((r) => r.phone));
  if (g.phone && (await isMember(g.phone))) phones.add(String(g.phone).replace(/\D/g, ""));
  let joined = 0;
  if (phones.size) { const { count } = await sb.from("playn_members").select("phone", { count: "exact", head: true }).in("phone", [...phones]).eq("status", "active"); joined = count ?? 0; }
  return { joined, need: g.headcount, done: joined >= g.headcount };
}
const fmtK = (t: string | null) => t ? t.slice(5, 16).replace("-", "/").replace("T", " ") : "-";
async function fxFinalize(cfg: Record<string, string>, g: any) {
  const { data: s } = await sb.from("playn_settle").select("*").eq("id", g.settle_id).maybeSingle();
  let result = "alt", extId: number | null = null;
  if (g.mode === "ext" && s) {
    const w = await fxWindow(cfg, s);
    if (w.possible) {
      const { data: ins } = await sb.from("playn_extensions").insert({ res_id: s.res_id, branch: s.branch, phone: s.phone, guest: s.guest, hours: w.hours, orig_end: w.orig_end, new_end: w.new_end, next_start: w.next_start, session: "fx:" + g.code, note: "N CREW 전원 가입 무료 연장" }).select("id").single();
      if (ins) {
        extId = ins.id;
        const r = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/playn-auto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "admin_ext_decide", key: cfg.admin_key, id: ins.id, approve: true, auto: true, price: 0, note: "N CREW 전원 가입 무료 연장" }), signal: AbortSignal.timeout(120000) }).then((x) => x.json()).catch(() => ({ ok: false }));
        if (r?.ok) result = "ext";
        else await sb.from("playn_extensions").update({ status: "rejected", note: "무료 연장 직전 확인에서 겹침 → 대체 혜택", decided_at: new Date().toISOString() }).eq("id", ins.id).eq("status", "requested");
      }
    }
  }
  if (result === "alt" && s) {
    await sb.from("playn_settle").update({ fx_perk: "alt" }).eq("id", s.id);
    if (s.calc) await recalc(JSON.parse(cfg.settle_rules ?? "{}"), { ...s, fx_perk: "alt" });
    // 다음 방문 1시간 연장권 (60일)
    if (s.phone) await sb.from("playn_coupons").insert({ phone: String(s.phone).replace(/\D/g, ""), source: "fx:" + g.code, kind: "ext1", title: "1시간 연장권 (N CREW 전원 가입)", detail: "다음 예약 때 입실 전 또는 퇴실 후로 1시간. 사용하려면 호스트에게 미리 문자로 알려주세요. 앞뒤 예약 때문에 못 쓰면 그 예약 이용금액에서 20,000원 할인해 드려요.", amount: null, expires_at: new Date(Date.now() + 60 * 86400e3).toISOString() }).then(() => null, () => null);
    await sms(cfg, s.phone, `[플레이앤] 🎉 ${g.headcount}명 전원 N CREW 가입 완료!\n${g.mode === "ext" ? "다음 예약 때문에 오늘 연장은 어려워서 " : ""}대신 드려요:\n${JSON.parse(cfg.fx_settings ?? "{}").alt ?? ""}\n봉투비·일회용품은 퇴실 정산 때 자동으로 빠지고, 연장권(60일)은 내 쿠폰에 들어갔어요 👉 https://playn.kr/me/`);
  }
  await sb.from("playn_fx_groups").update({ status: "done", result, ext_id: extId, done_at: new Date().toISOString() }).eq("id", g.id);
  await sms(cfg, cfg.owner_phone, `[N CREW 전원 가입] ${g.branch} ${g.guest ?? ""} ${g.headcount}명 완료 → ${result === "ext" ? `무료 연장 자동 확정 (퇴실 ${fmtK(g.orig_end)} → ${fmtK(g.new_end)}, 노션·스클 막기 자동)` : "대체 혜택(봉투비 면제·일회용품 무료 + 다음 방문 1시간 연장권) 자동 반영"}`);
  await sb.from("playand_log").insert({ source: "fx_done", payload: { code: g.code, branch: g.branch, n: g.headcount, result } });
}
async function isMember(phone: string | null) {
  if (!phone) return false;
  const { data } = await sb.from("playn_members").select("status").eq("phone", String(phone).replace(/\D/g, "")).maybeSingle();
  return data?.status === "active";
}

// N CREW 레벨 (방문 = 확정 예약 이용일 + 같이 온 친구로 적힌 체크인, 같은 날·지점 1회)
const fmtTel = (d: string) => d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
async function crewOf(cfg: Record<string, string>, phone: string | null) {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (!d || !(await isMember(d))) return null;
  const today = kstNow().toISOString().slice(0, 10);
  const { data: rs } = await sb.from("playand_reservations").select("branch,use_date").in("phone", [d, fmtTel(d)]).eq("status", "confirmed").lt("use_date", today);
  const { data: cs } = await sb.from("playn_settle").select("branch,use_date").in("status", ["checked_in", "submitted", "hold", "paid"]).lt("use_date", today)
    .or(`checkin->>companions.ilike.*${d}*,checkin->>companions.ilike.*${fmtTel(d)}*`);
  const seen = new Set((rs ?? []).concat(cs ?? []).map((r: any) => r.use_date + r.branch));
  let levels: any[] = []; try { levels = JSON.parse(cfg.crew_levels ?? "[]"); } catch { /* */ }
  let lv = levels[0];
  for (const l of levels) if (seen.size >= l.min) lv = l;
  return lv ? { lv: lv.lv, name: lv.name, visits: seen.size, exempt: /보증금 면제/.test(lv.perk ?? ""), free_drinks: /음료 2병/.test(levels.find((x: any) => x.lv === 2)?.perk ?? "") && lv.lv >= 2 } : null;
}
// N CREW 스탬프 바베큐 무료권: 이 정산에 이미 쓴 것 → 없으면 쓸 수 있는 것 (오래된 것부터)
async function bbqCouponOf(s: any) {
  const d = String(s.phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  const { data: used } = await sb.from("playn_coupons").select("id,detail").eq("phone", d).eq("kind", "bbq").eq("used_note", "settle:" + s.id).limit(1).maybeSingle();
  const today = kstNow().toISOString().slice(0, 10);
  const c = used ?? (await sb.from("playn_coupons").select("id,detail").eq("phone", d).eq("kind", "bbq").eq("status", "active").or(`expires_at.is.null,expires_at.gte.${today}`).order("issued_at", { ascending: true }).limit(1).maybeSingle()).data;
  if (!c) return null;
  const people = Number(String(c.detail ?? "").match(/(\d+)인분/)?.[1] ?? 5);
  return { id: c.id, people };
}
// 예약 플랫폼: 손님이 고른 값 → 없으면 예약 출처로 추정
function platformOf(s: any) {
  const p = String(s.checkin?.platform ?? "");
  if (p) return p.includes("네이버") ? "naver" : p.includes("스페이스") ? "spacecloud" : "site";
  const id = String(s.res_id ?? "");
  return id.startsWith("site:") ? "site" : id.startsWith("ext:") ? "naver" : "spacecloud";
}
const SCID: Record<string, string> = { "홍대루프탑점": "43667", "연남루프탑점": "55750", "연트럴파크점": "72605" };
const STORE: Record<string, string> = { "홍대루프탑점": "https://smartstore.naver.com/playn_/products/9434661597", "연남루프탑점": "https://smartstore.naver.com/playn_/products/9430485644", "연트럴파크점": "https://smartstore.naver.com/playn_/products/12071850850" };
function reviewGuide(s: any) {
  const pf = platformOf(s);
  if (pf === "naver") return { pf, name: "네이버", url: STORE[s.branch] ?? "https://smartstore.naver.com/playn_", how: "네이버페이 주문내역 → 플레이앤 → 리뷰 쓰기 (사진 리뷰)" };
  if (pf === "site") return { pf, name: "네이버 지도", url: `https://map.naver.com/p/search/${encodeURIComponent("게임파티룸 플레이앤 " + String(s.branch ?? ""))}`, how: "네이버 지도에서 플레이앤 → 리뷰 → 방문자 리뷰 쓰기" };
  return { pf, name: "스페이스클라우드", url: `https://www.spacecloud.kr/space/${SCID[s.branch] ?? "43667"}`, how: "스페이스클라우드 앱 → 마이페이지 → 예약 내역 → 이용후기 작성 (사진 후기)" };
}

// 정산 계산
// 바베큐: 바베큐 인원(N) 중 예약 플랫폼(스클 등)에서 결제한 인원(P)을 뺀 나머지만 보증금에서 차감
//   P는 손님 신고값, 사장님이 스클에서 확인하면 bbq_verified 값이 우선
// 보증금: 입금 확인(deposit_ok) 전에는 환급 0원, 확인 후 정상 계산
function calcOf(rules: any, s: any, items: Record<string, number>, opt: any, manual: any[] = []) {
  const lines: { name: string; amount: number; manual?: boolean }[] = [];
  lines.push({ name: "기본 쓰레기봉투", amount: rules.bag_base });
  for (const it of rules.items) {
    const q = Math.max(0, Math.min(99, Math.round(Number(items?.[it.id] ?? 0))));
    if (q) lines.push({ name: `${it.name.replace(/\s*\(.*\)/, "")} ${q}${it.unit}`, amount: q * it.price });
  }
  const head = Number(s.checkin?.headcount ?? 0);
  const extra = Math.max(0, head - rules.base_people);
  if (extra && opt.extra_paid !== "platform") lines.push({ name: `인원 추가 ${extra}명`, amount: extra * rules.extra_person });
  const bbqN = Math.max(0, Math.round(Number(opt.bbq_people ?? 0)));
  let bbqPaid = 0;
  if (s.checkin?.bbq && bbqN) {
    const claimed = opt.bbq_paid === "platform" ? Math.max(0, Math.min(bbqN, Math.round(Number(opt.bbq_paid_people ?? bbqN)))) : 0;
    bbqPaid = s.bbq_verified != null ? Math.min(bbqN, Number(s.bbq_verified)) : claimed;
    const unpaid = bbqN - bbqPaid;
    if (unpaid) lines.push({ name: bbqPaid ? `바베큐 미결제 ${unpaid}인 (${bbqN}인 중 ${bbqPaid}인 결제)` : `바베큐 ${bbqN}인`, amount: unpaid * rules.bbq_per_person });
    // N CREW 스탬프 바베큐 무료권 (2026-10-12): 미결제 인원 중 쿠폰 인원만큼 무료
    const free = opt.bbq_coupon ? Math.min(unpaid, Number(opt.bbq_coupon.people ?? 0)) : 0;
    if (free) lines.push({ name: `N CREW 스탬프 바베큐 무료권 (${free}인)`, amount: -free * rules.bbq_per_person });
  }
  // 레귤러 이상 혜택: 방문마다 음료 2병 + 물 2병 무료
  // 음료는 방문 1번에 최대 2병만 무료 (2026-10-12): 후기 이벤트로 음료 2병을 받았으면 레귤러 음료 혜택은 빠지고 물만
  if ((s.crew_lv ?? 0) >= 2) {
    const it = (id: string) => rules.items.find((x: any) => x.id === id);
    const drinkFree = s.checkin?.review === "drink" ? 0 : 2;
    const fd = Math.min(drinkFree, Math.round(Number(items?.drink ?? 0))) * (it("drink")?.price ?? 0), fw = Math.min(2, Math.round(Number(items?.water ?? 0))) * (it("water")?.price ?? 0);
    if (fd + fw) lines.push({ name: drinkFree ? "N CREW 혜택 (음료·물 2개씩 무료)" : "N CREW 혜택 (물 2개 무료 · 음료는 후기 이벤트로 받음)", amount: -(fd + fw) });
  }
  // N CREW 전원 가입 대체 혜택: 기본 봉투비 면제 + 일회용품 무료 (+ 다음 방문 1시간 연장권은 쿠폰으로 따로 발급)
  if (s.fx_perk === "alt") {
    const it = (id: string) => rules.items.find((x: any) => x.id === id);
    const dp = Math.round(Number(items?.disposable ?? 0)) * (it("disposable")?.price ?? 0);
    lines.push({ name: "N CREW 전원 가입 혜택 (기본 봉투비·일회용품 무료)", amount: -(rules.bag_base + dp) });
  }
  for (const m of manual) lines.push(m);
  const total = Math.max(0, lines.reduce((a, l) => a + l.amount, 0));
  if (s.deposit_exempt) // 레전드: 보증금 없이 이용 → 차감액만 받음
    return { deposit: 0, exempt: true, lines, total, bbq: { people: bbqN, paid: bbqPaid, verified: s.bbq_verified ?? null }, deposit_ok: true, refund: 0, expect: 0, owed: total };
  const received = !!s.deposit_ok;
  return { deposit: rules.deposit, lines, total, bbq: { people: bbqN, paid: bbqPaid, verified: s.bbq_verified ?? null }, deposit_ok: received,
    refund: received ? Math.max(0, rules.deposit - total) : 0, expect: Math.max(0, rules.deposit - total), owed: received ? Math.max(0, total - rules.deposit) : total };
}
function flagsOf(s: any, calc: any, proof: string | null, cl: any) {
  const f: string[] = [];
  if (!s.deposit_ok && !s.deposit_exempt) f.push("보증금 입금 미확인 (토스 입금 확인 전에는 환급 0원)");
  if (cl?.verdict === "charge") f.push("청소 점검: " + (cl.ai?.notes ?? "추가 청소 필요"));
  if (s.checkin?.review && s.checkin.review !== "none") { // 2026-11-02 후기 이벤트 손님은 후기+사용내역 둘 다 돼야 환급 · v22 캡처는 사장님 수락까지
    if (!proof) f.push("⛔ 환급 보류: 후기 이벤트 참여 — 후기 캡처를 올려야 환급돼요");
    else if (s.review_ok === false) f.push("⛔ 환급 보류: 후기 캡처 반려" + (s.review_note ? ` (${s.review_note})` : "") + " — 손님이 다시 올리면 확인 대기로 바뀌어요");
    else if (s.review_ok !== true) f.push("⛔ 환급 보류: 후기 캡처 확인 대기 — 사진 보고 '후기 인증 수락'을 눌러주세요");
  }
  const b = calc.bbq;
  if (b?.people && b.paid > 0 && b.verified == null) f.push(`바베큐 ${b.people}인 중 ${b.paid}인 플랫폼 결제 신고 → 스클 예약옵션 수량 확인 필요`);
  return f;
}
async function recalc(rules: any, s: any) {
  if (!s.calc) return null;
  const manual = (s.calc.lines ?? []).filter((l: any) => l.manual);
  const calc = { ...calcOf(rules, s, s.items ?? {}, s.calc.opt ?? {}, manual), opt: s.calc.opt };
  const { data: cl } = await sb.from("playn_clean").select("verdict,ai").eq("res_id", s.res_id ?? "-").maybeSingle();
  const flags = flagsOf(s, calc, s.review_proof, cl);
  const status = s.status === "paid" ? "paid" : flags.length ? "hold" : "submitted";
  await sb.from("playn_settle").update({ calc, refund: calc.refund, flags, status }).eq("id", s.id);
  return { calc, flags, status };
}
const START_H: Record<string, number> = { day: 11, night: 19, full: 12 };
// 토스 입금 알림 문구에서 금액·이름 뽑기 (예: "홍길동님이 200,000원을 보냈어요", "입금 200,000원 홍길동")
function parseDeposit(raw: string) {
  const t = String(raw ?? "").replace(/\s+/g, " ");
  const t2 = t.replace(/잔액\s*[:：]?\s*[\d,]+\s*원/g, " "); // 잔액 숫자는 빼고
  const am = [...t2.matchAll(/([\d,]{4,})\s*원/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n >= 1000);
  const stop = new Set(["입금", "출금", "토스", "토스뱅크", "보냈어요", "받았어요", "통장", "잔액", "내", "원을", "님이", "계좌", "알림", "이체", "송금"]);
  const names = (t.replace(/님(이|에게서|께서|으로부터)?/g, " ").match(/[가-힣]{2,5}/g) ?? []).map((w) => w.replace(/(님이|님|에게서|이|가)$/, "")).filter((w) => w.length >= 2 && !stop.has(w));
  return { amount: am.length ? Math.max(...am) : 0, names: [...new Set(names)] };
}

async function bySession(k: unknown) {
  const { data } = await sb.from("playn_settle").select("*").eq("token", String(k ?? "")).maybeSingle();
  return data;
}

// 예약 → 정산 링크 발급 (안내문자 보낼 때 호출)
async function issue(r: any) {
  const { data: ex } = await sb.from("playn_settle").select("token").eq("res_id", r.id).maybeSingle();
  if (ex) return ex.token;
  const token = rand(10);
  await sb.from("playn_settle").insert({ token, res_id: r.id, branch: r.branch, phone: r.phone ? String(r.phone).replace(/\D/g, "") : null, guest: r.guest_name ?? null, use_date: r.use_date, pkg: r.pkg });
  return token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let b: any = {};
  try { b = await req.json(); } catch { /* */ }
  // MacroDroid 등에서 GET ?action=deposit_hook&key=..&text=.. 로도 받기 (JSON 깨짐 방지)
  const qs = Object.fromEntries(new URL(req.url).searchParams);
  if (!b?.action && qs.action) b = qs;
  const cfg = await cfgAll();
  const rules = JSON.parse(cfg.settle_rules ?? "{}");

  // ── 손님용 ──
  if (b.action === "info") {
    const s = await bySession(b.k);
    if (!s) return J({ ok: false, error: "링크가 올바르지 않아요. 안내문자의 링크로 다시 들어와 주세요." });
    return J({ ok: true, branch: s.branch, date: s.use_date, pkg: PKN[s.pkg] ?? "", guest: s.guest, status: s.status, rules, account: ACCOUNT,
      checkin: s.checkin ? { ...s.checkin, account: maskAcc(s.checkin.account) } : null, deposit_ok: !!s.deposit_ok, review_ok: !!s.review_proof && s.review_ok !== false, review_state: !s.review_proof ? "none" : s.review_ok === true ? "approved" : s.review_ok === false ? "rejected" : "pending", review_note: s.review_ok === false ? s.review_note ?? null : null, calc: s.calc, refund: s.refund,
      crew: s.checkin ? (s.crew_lv ? { lv: s.crew_lv } : null) : await crewOf(cfg, s.phone), exempt: s.checkin ? !!s.deposit_exempt : !!(await crewOf(cfg, s.phone))?.exempt, platform: platformOf(s), review: reviewGuide(s),
      member: await isMember(s.phone), bbq_coupon: s.status === "paid" ? null : await bbqCouponOf(s), fx_perk: s.fx_perk ?? null, worlds: worldsOf(cfg, s), ...(await (async () => { const { data: p } = await sb.from("playn_worlds_picks").select("team,group_code,headcount,payout").eq("settle_id", s.id).maybeSingle(); return p ? { pick: p.team, pick_payout: p.payout, group: p.group_code, crew: await crewProgress(p) } : { pick: null }; })()) });
  }
  if (b.action === "checkin") {
    const s = await bySession(b.k);
    if (!s) return J({ ok: false, error: "링크가 올바르지 않아요" });
    if (["submitted", "hold", "paid"].includes(s.status)) return J({ ok: false, error: "이미 퇴실 정산이 접수됐어요" });
    const head = Math.round(Number(b.headcount));
    const acc = b.account === "keep" && s.checkin?.account ? s.checkin.account : String(b.account ?? "").replace(/[^\d-]/g, "");
    if (!(head >= 1 && head <= 30)) return J({ ok: false, error: "확정 인원을 숫자로 적어주세요" });
    if (!String(b.depositor ?? "").trim()) return J({ ok: false, error: "보증금 입금자명을 적어주세요" });
    if (!b.bank || acc.replace(/-/g, "").length < 8) return J({ ok: false, error: "환급받으실 은행과 계좌번호를 확인해 주세요" });
    const checkin = { headcount: head, depositor: String(b.depositor).trim().slice(0, 20), review: ["early", "drink", "none"].includes(b.review) ? b.review : "none",
      bank: String(b.bank).slice(0, 20), account: acc.slice(0, 30), holder: String(b.holder ?? b.depositor).trim().slice(0, 20), bbq: !!b.bbq, platform: String(b.platform ?? "").slice(0, 20),
      companions: String(b.companions ?? "").replace(/[^\d,\s-]/g, "").slice(0, 120) };
    const first = !s.checkin;
    // N CREW 가입 (예약자 본인 번호, 수신 동의 체크한 경우만)
    let joined = false;
    if (b.crew_join && s.phone && !(await isMember(s.phone))) {
      const now = new Date().toISOString();
      // 광고 동의 별도·기본 꺼짐 (v1c): crew_marketing === true 일 때만. 이미 활성 회원은 isMember 로 걸러져 체크인이 동의를 바꾸지 않음
      await sb.rpc("playn_member_join", { p_phone: String(s.phone).replace(/\D/g, ""), p_name: String(s.guest || checkin.depositor).slice(0, 20), p_source: "checkin", p_branch: s.branch, p_marketing: b.crew_marketing === true, p_night: b.crew_night === true });
      await sb.from("playand_log").insert({ source: "member_join", payload: { phone: String(s.phone).slice(-4), via: "checkin" } });
      joined = true;
    }
    // 롤드컵 우승팀 예측 (1그룹 1회, 마감 전만, 이미 냈으면 수정 불가)
    const w = worldsOf(cfg, s);
    let picked: string | null = null, group: string | null = null;
    if (w?.open && b.worlds_pick && w.teams.includes(String(b.worlds_pick))) {
      if (!(await isMember(s.phone))) return J({ ok: false, error: "롤드컵 이벤트는 N CREW 가입 팀만 참여할 수 있어요. 아래 'N CREW 가입하기'를 체크해 주세요." });
      const { data: ex } = await sb.from("playn_worlds_picks").select("team").eq("settle_id", s.id).maybeSingle();
      if (!ex) {
        group = rand(8);
        await sb.from("playn_worlds_picks").insert({ settle_id: s.id, res_id: s.res_id, branch: s.branch, use_date: s.use_date, phone: s.phone, guest: s.guest || checkin.depositor, team: String(b.worlds_pick), headcount: head, payout: w.payout, group_code: group });
        await sb.from("playn_worlds_crew").upsert({ group_code: group, phone: String(s.phone).replace(/\D/g, ""), name: String(s.guest || checkin.depositor).slice(0, 20) });
        picked = String(b.worlds_pick);
        await sms(cfg, s.phone, `[플레이앤] 롤드컵 우승팀 예측 접수 🏆\n우리 팀 픽: ${picked} (적중 시 ${won(w.payout)})\n※ 팀원 ${head}명 전원 N CREW 가입해야 페이백 대상이 돼요.\n이 링크를 단톡방에 공유해 주세요 👇\nhttps://playn.kr/team/?g=${group}`);
      }
    }
    const crew = await crewOf(cfg, s.phone);
    const exempt = !!crew?.exempt;
    await sb.from("playn_settle").update({ checkin, checkin_at: new Date().toISOString(), status: "checked_in", crew_lv: crew?.lv ?? null, deposit_exempt: exempt, ...(exempt ? { deposit_ok: true, deposit_at: new Date().toISOString() } : {}) }).eq("id", s.id);
    // 체크인 전에 먼저 들어온 입금(미매칭)이 있으면 입금자명으로 자동 연결
    if (!s.deposit_ok) {
      const since = new Date(Date.now() - 36 * 3600e3).toISOString();
      const { data: deps } = await sb.from("playn_deposits").select("id,name,amount").eq("status", "unmatched").gte("at", since);
      const d0 = checkin.depositor.replace(/\s/g, "");
      const hit = (deps ?? []).find((d) => d.amount >= rules.deposit && String(d.name ?? "").split(",").some((n) => n && (n === d0 || n.includes(d0) || d0.includes(n))));
      if (hit) { await sb.from("playn_deposits").update({ settle_id: s.id, status: "matched" }).eq("id", hit.id); await sb.from("playn_settle").update({ deposit_ok: true, deposit_at: new Date().toISOString() }).eq("id", s.id); }
    }
    if (first) await sms(cfg, cfg.owner_phone, `[체크인] ${s.branch} ${PKN[s.pkg] ?? ""} ${String(s.use_date).slice(5)}\n${head}명 · 입금자 ${checkin.depositor} · 후기 ${checkin.review === "none" ? "X" : checkin.review === "early" ? "조기입실" : "음료"} · 바베큐 ${checkin.bbq ? "O" : "X"}${joined ? " · N CREW 가입" : ""}${picked ? " · 롤드컵 예측 " + picked : ""}${head > rules.base_people ? ` · 인원추가 ${head - rules.base_people}명` : ""}${exempt ? `\n👑 ${crew?.name} (방문 ${crew?.visits}회) · 보증금 면제 — 퇴실 정산 때 차감액만 받아요` : `\n보증금 ${won(rules.deposit)} 토스 입금 자동 확인 대기 중 (1시간 안에 안 들어오면 손님께 자동 안내)`}${crew && crew.lv >= 2 && !exempt ? `\nN CREW ${crew.name} · 음료·물 2개씩 무료` : ""}`);
    return J({ ok: true, joined, picked, group, exempt, crew });
  }
  if (b.action === "checkout") {
    const s = await bySession(b.k);
    if (!s) return J({ ok: false, error: "링크가 올바르지 않아요" });
    if (!s.checkin) return J({ ok: false, error: "입실 정보부터 입력해 주세요" });
    if (s.status === "paid") return J({ ok: false, error: "이미 환급이 끝났어요. 문의는 호스트에게 문자 주세요" });
    const items: Record<string, number> = {};
    for (const it of rules.items) items[it.id] = Math.max(0, Math.min(99, Math.round(Number(b.items?.[it.id] ?? 0))));
    const opt = { extra_paid: b.extra_paid === "platform" ? "platform" : "deposit", bbq_paid: ["platform", "deposit"].includes(b.bbq_paid) ? b.bbq_paid : "none", bbq_people: Number(b.bbq_people ?? 0), bbq_paid_people: Number(b.bbq_paid_people ?? (b.bbq_paid === "platform" ? b.bbq_people : 0)) };
    // 후기 인증 사진
    let proof = s.review_proof, rvOk = s.review_ok ?? null, newProof = false;
    const m = String(b.review_image ?? "").match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (m) {
      const p = `settle/${s.id}-${Date.now()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
      const up = await sb.storage.from("playn-private").upload(p, Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)), { contentType: "image/" + m[1] });
      if (!up.error) { proof = p; rvOk = null; newProof = true; } // v22: 새 캡처는 다시 사장님 확인 대기
    }
    if (s.checkin.review && s.checkin.review !== "none" && proof && rvOk === false) return J({ ok: false, error: "올려주신 사진이 후기 캡처로 확인되지 않았어요. 예약하신 곳에 사진 후기를 남긴 뒤, 후기가 보이는 화면을 캡처해서 다시 올려주세요" });
    if (s.checkin.review && s.checkin.review !== "none" && !proof) return J({ ok: false, error: "후기 이벤트 참여하셨으면 사진 후기 캡처를 꼭 올려주세요 (환급 신청 필수)" }); // 2026-11-02 서버에서도 강제
    const bc = s.checkin.bbq && opt.bbq_people > 0 ? await bbqCouponOf(s) : null;
    (opt as any).bbq_coupon = bc;
    const calc = { ...calcOf(rules, s, items, opt), opt };
    const bbqFree = calc.lines.some((l: any) => l.name.startsWith("N CREW 스탬프 바베큐"));
    // 다시 제출해서 바베큐 무료가 빠지면 쿠폰 돌려놓기, 쓰면 사용 처리
    await sb.from("playn_coupons").update({ status: "active", used_at: null, used_note: null }).eq("used_note", "settle:" + s.id).eq("kind", "bbq");
    if (bc && bbqFree) await sb.from("playn_coupons").update({ status: "used", used_at: new Date().toISOString(), used_note: "settle:" + s.id }).eq("id", bc.id);
    const { data: cl } = await sb.from("playn_clean").select("verdict,ai").eq("res_id", s.res_id ?? "-").maybeSingle();
    const flags = flagsOf({ ...s, review_ok: rvOk }, calc, proof, cl);
    const status = flags.length ? "hold" : "submitted";
    await sb.from("playn_settle").update({ items, calc, review_proof: proof, review_ok: rvOk, ...(newProof ? { review_note: null, review_checked_at: null } : {}), checkout_at: new Date().toISOString(), status, flags, refund: calc.refund }).eq("id", s.id);
    await sms(cfg, cfg.owner_phone, `[정산 ${flags.length ? "확인 필요" : "준비"}] ${s.branch} ${s.checkin.depositor}\n${calc.exempt ? `👑 보증금 면제 · 받을 돈 ${won(calc.owed)}` : `차감 ${won(calc.total)} → 환급 ${won(calc.refund)}`}${flags.length ? "\n⚠️ " + flags.join(" / ") : ""}\n${newProof && s.checkin.review !== "none" ? "\n📸 후기 캡처 새로 올라옴 → 사진 보고 '후기 인증 수락'" : ""}\n확인·송금: https://playn.kr/admin.html#settle`);
    return J({ ok: true, calc, status });
  }

  // ── 팀원 가입 (롤드컵 이벤트 팀 링크) ──
  if (b.action === "team_info" || b.action === "team_join") {
    const { data: p } = await sb.from("playn_worlds_picks").select("*").eq("group_code", String(b.g ?? "")).maybeSingle();
    if (!p) return J({ ok: false, error: "팀 링크가 올바르지 않아요" });
    if (b.action === "team_join") {
      const phone = String(b.phone ?? "").replace(/\D/g, ""), name = String(b.name ?? "").trim().slice(0, 20);
      if (!/^01\d{8,9}$/.test(phone) || !name) return J({ ok: false, error: "이름과 휴대폰 번호를 확인해 주세요" });
      // 가입 필수 동의와 광고 동의 분리 (v1c). 광고 동의는 b.marketing === true 일 때만, 인증 스위치와 무관
      if (!b.agree) return J({ ok: false, error: "N CREW 가입 필수 동의에 체크해 주세요" });
      if (cfg.ncrew_join_otp === "on") {
        const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "join" });
        if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호를 확인해 주세요" });
      }
      const { data: ex } = await sb.from("playn_members").select("phone,status").eq("phone", phone).maybeSingle();
      if (!ex || ex.status !== "active") await sb.rpc("playn_member_join", { p_phone: phone, p_name: name, p_source: "worlds_team", p_branch: p.branch, p_marketing: b.marketing === true, p_night: b.night_agree === true });
      await sb.from("playn_worlds_crew").upsert({ group_code: p.group_code, phone, name });
      await sb.from("playand_log").insert({ source: "member_join", payload: { phone: phone.slice(-4), via: "worlds_team", again: !!ex } });
    }
    const pr = await crewProgress(p);
    return J({ ok: true, team: p.team, branch: p.branch, date: p.use_date, payout: p.payout, ...pr });
  }

  // ── 공개: 홈페이지 우승팀 팬 투표 (N CREW 멤버만, 1인 1표, 마감 전 변경 가능) ──
  if (b.action === "worlds_vote" || b.action === "worlds_my_vote") {
    let w: any = {}; try { w = JSON.parse(cfg.worlds_event ?? "{}"); } catch { /* */ }
    const phone = String(b.phone ?? "").replace(/\D/g, "");
    if (!/^01\d{8,9}$/.test(phone)) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const { data: m } = await sb.from("playn_members").select("name,status").eq("phone", phone).maybeSingle();
    if (!m || m.status !== "active") return J({ ok: false, need_join: true, error: "N CREW 멤버만 투표할 수 있어요. 아래에서 30초 가입하고 바로 투표하세요." });
    const { data: mine } = await sb.from("playn_worlds_votes").select("team,updated_at").eq("phone", phone).maybeSingle();
    if (b.action === "worlds_my_vote") return J({ ok: true, name: m.name, team: mine?.team ?? null });
    const lockAt = new Date(w.vote_lock ?? w.tiers?.[0]?.until ?? w.lock).getTime();
    if (Date.now() > lockAt) return J({ ok: false, error: "투표가 마감됐어요. 결과는 이 페이지에서 확인하세요." });
    const team = String(b.team ?? "");
    if (!(w.teams ?? []).includes(team) || (w.eliminated ?? []).includes(team)) return J({ ok: false, error: "선택할 수 없는 팀이에요" });
    await sb.from("playn_worlds_votes").upsert({ phone, team, name: m.name, updated_at: new Date().toISOString() });
    await sb.from("playand_log").insert({ source: "worlds_vote", payload: { phone: phone.slice(-4), team, changed: !!mine && mine.team !== team } });
    return J({ ok: true, name: m.name, team, changed: !!mine && mine.team !== team });
  }

  // ── 공개: 롤드컵 픽 현황 (개인정보 없이 팀별 숫자만) ──
  if (b.action === "worlds_public") {
    let w: any = {}; try { w = JSON.parse(cfg.worlds_event ?? "{}"); } catch { /* */ }
    const { data } = await sb.from("playn_worlds_picks").select("team,branch");
    const tally: Record<string, number> = {};
    for (const p of data ?? []) if (p.team !== "(테스트)") tally[p.team] = (tally[p.team] ?? 0) + 1;
    const total = Object.values(tally).reduce((a, n) => a + n, 0);
    // 홈페이지 팬 투표 (N CREW 멤버 1인 1표)
    const { data: vs } = await sb.from("playn_worlds_votes").select("team,updated_at");
    const fan: Record<string, number> = {};
    for (const v of vs ?? []) fan[v.team] = (fan[v.team] ?? 0) + 1;
    const fan_total = (vs ?? []).length;
    // 최근 투표 티커 (개인정보 없이 팀·시각만)
    const recent = [...(vs ?? [])].sort((a, z) => String(z.updated_at).localeCompare(String(a.updated_at))).slice(0, 8).map((v) => ({ team: v.team, at: v.updated_at }));
    return J({ ok: true, fan, fan_total, recent, vote_lock: w.vote_lock ?? w.tiers?.[0]?.until ?? w.lock, total, tally, playn_pick: w.playn_pick ?? null, eliminated: w.eliminated ?? [], stage: w.stage ?? null, winner: w.winner ?? null, lock: w.lock, from: w.from, to: w.to, final: w.final, payout: tierNow(w)?.payout ?? 0, tiers: w.tiers ?? [], rule: w.rule ?? null, teams: w.teams ?? [] });
  }

  // ── N CREW 전원 가입 → 무료 연장 (대표: 체크인 링크 k / 친구: 그룹 코드 g) ──
  if (b.action === "__src") { // 배포본 확인용: 소스 해시
    const src = await Deno.readTextFile(new URL(import.meta.url)).catch(() => "");
    const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src)))).map((x) => x.toString(16).padStart(2, "0")).join("");
    return J({ ok: true, sha256: h, len: src.length });
  }
  if (b.action === "fx_check" || b.action === "fx_start" || b.action === "fx_status") {
    const fx = JSON.parse(cfg.fx_settings ?? "{}");
    if (!fx.on) return J({ ok: false, error: "지금은 진행하지 않는 이벤트예요" });
    const s = await bySession(b.k);
    if (!s) return J({ ok: false, error: "링크가 올바르지 않아요" });
    const { data: g0 } = await sb.from("playn_fx_groups").select("*").eq("settle_id", s.id).maybeSingle();
    if (g0) return J({ ok: true, started: true, code: g0.code, mode: g0.mode, status: g0.status, result: g0.result, orig_end: g0.orig_end, new_end: g0.new_end, alt: fx.alt, ...(await fxProgress(g0)) });
    if (b.action === "fx_status") return J({ ok: true, started: false });
    if (!s.checkin) return J({ ok: false, error: "입실 전 체크인을 먼저 해주세요 (인원 확인이 필요해요)" });
    if (["submitted", "hold", "paid"].includes(s.status)) return J({ ok: false, error: "퇴실 정산이 끝나서 신청할 수 없어요" });
    const w = await fxWindow(cfg, s);
    if (kMs(w.deadline) < Date.now() + 9 * 3600e3) return J({ ok: false, error: "퇴실 30분 전까지 신청할 수 있어요" });
    const need = Number(s.checkin.headcount ?? 0);
    if (need < 2) return J({ ok: false, error: "2명 이상일 때 신청할 수 있어요" });
    if (b.action === "fx_check") return J({ ok: true, ...w, need });
    const code = rand(8);
    const { data: g, error } = await sb.from("playn_fx_groups").insert({ code, settle_id: s.id, res_id: s.res_id, branch: s.branch, phone: s.phone, guest: s.guest || s.checkin.depositor, headcount: need, mode: w.possible ? "ext" : "alt", orig_end: w.orig_end, new_end: w.possible ? w.new_end : null, next_start: w.next_start }).select("*").single();
    if (error || !g) return J({ ok: false, error: "잠시 후 다시 시도해 주세요" });
    await sb.from("playand_log").insert({ source: "fx_start", payload: { code, branch: s.branch, need, mode: g.mode } });
    return J({ ok: true, started: true, code, mode: g.mode, status: g.status, orig_end: g.orig_end, new_end: g.new_end, alt: fx.alt, ...(await fxProgress(g)) });
  }
  if (b.action === "fx_info" || b.action === "fx_otp" || b.action === "fx_join") {
    const fx = JSON.parse(cfg.fx_settings ?? "{}");
    const { data: g } = await sb.from("playn_fx_groups").select("*").eq("code", String(b.g ?? "")).maybeSingle();
    if (!g) return J({ ok: false, error: "QR이 올바르지 않아요. 대표님 화면의 QR을 다시 찍어주세요" });
    const pub = async () => ({ branch: g.branch, guest: String(g.guest ?? "").slice(0, 1) + "○○", mode: g.mode, status: g.status, result: g.result, orig_end: g.orig_end, new_end: g.new_end, alt: fx.alt, ...(await fxProgress(g)) });
    if (b.action === "fx_info") return J({ ok: true, ...(await pub()) });
    if (g.status !== "open") return J({ ok: true, closed: true, ...(await pub()) });
    const phone = String(b.phone ?? "").replace(/\D/g, ""), name = String(b.name ?? "").trim().slice(0, 20);
    if (!/^01\d{8,9}$/.test(phone)) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    if (b.action === "fx_otp") {
      const { data: r, error } = await sb.rpc("member_otp_issue", { p_phone: phone, p_purpose: "fx", p_ip_hash: await otpIpHash(req) });
      if (error || !r?.ok) return J({ ok: false, error: r?.error ?? "잠시 후 다시 시도해 주세요" });
      const sent = await sms(cfg, phone, `[플레이앤 N CREW] 인증번호 ${r.code} (5분 안에 입력해 주세요)`);
      return J({ ok: sent, error: sent ? undefined : "문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요" });
    }
    // fx_join: 인증번호 확인 → N CREW 가입 → 그룹 인원 반영 → 전원이면 자동 처리
    if (!name) return J({ ok: false, error: "이름을 적어주세요" });
    if (!b.agree) return J({ ok: false, error: "N CREW 가입 필수 동의에 체크해 주세요" });
    const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "fx" });
    if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호가 맞지 않거나 시간이 지났어요" });
    const now = new Date().toISOString();
    const { data: ex } = await sb.from("playn_members").select("status").eq("phone", phone).maybeSingle();
    if (!ex || ex.status !== "active") await sb.rpc("playn_member_join", { p_phone: phone, p_name: name, p_source: "fx_group", p_branch: g.branch, p_marketing: b.marketing === true, p_night: b.night_agree === true }); // 광고 동의 별도·기본 꺼짐 (v1c)
    await sb.from("playn_fx_members").upsert({ code: g.code, phone, name });
    await sb.from("playand_log").insert({ source: "member_join", payload: { phone: phone.slice(-4), via: "fx_group", again: !!ex } });
    // 같이 온 친구로 기록 (다음 방문 때 N CREW 방문 횟수 인정)
    const { data: st } = await sb.from("playn_settle").select("id,checkin").eq("id", g.settle_id).maybeSingle();
    if (st?.checkin && !String(st.checkin.companions ?? "").includes(phone)) await sb.from("playn_settle").update({ checkin: { ...st.checkin, companions: [st.checkin.companions, phone].filter(Boolean).join(", ").slice(0, 400) } }).eq("id", st.id);
    const pr = await fxProgress(g);
    if (pr.done) {
      const { data: lock } = await sb.from("playn_fx_groups").update({ status: "completing" }).eq("id", g.id).eq("status", "open").select("*").maybeSingle();
      if (lock) {
        const job = fxFinalize(cfg, lock).catch(async (e) => { await sb.from("playn_fx_groups").update({ status: "open" }).eq("id", g.id); await sms(cfg, cfg.owner_phone, `[N CREW 전원 가입 처리 오류] ${g.branch} ${g.code}: ${String(e).slice(0, 80)}`); });
        // @ts-ignore EdgeRuntime는 Supabase 런타임 전역
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
      }
    }
    return J({ ok: true, ...(await pub()), status: pr.done ? "completing" : g.status, me: name });
  }

  // ── 토스 입금 알림 자동 확인 (MacroDroid가 토스 알림 문구를 그대로 보내줌) ──
  if (b.action === "deposit_hook") {
    if (!cfg.deposit_hook_key || b.key !== cfg.deposit_hook_key) return J({ ok: false }, 401);
    const raw = String(b.text ?? "").slice(0, 300);
    if (!/입금|보냈|받았/.test(raw)) return J({ ok: true, skip: "not deposit" });
    const { amount, names } = parseDeposit(raw);
    const from = new Date(kstNow().getTime() - 2 * 86400e3).toISOString().slice(0, 10);
    const to = new Date(kstNow().getTime() + 1 * 86400e3).toISOString().slice(0, 10);
    const { data: open } = await sb.from("playn_settle").select("*").eq("deposit_ok", false).gte("use_date", from).lte("use_date", to).not("checkin", "is", null);
    const hit = (open ?? []).filter((s) => { const d = String(s.checkin?.depositor ?? "").replace(/\s/g, ""); return d && names.some((n) => n === d || n.includes(d) || d.includes(n)); });
    const ok = hit.length === 1 && amount >= rules.deposit;
    const { data: row } = await sb.from("playn_deposits").insert({ raw, name: names.join(","), amount, settle_id: ok ? hit[0].id : null, status: ok ? "matched" : hit.length > 1 ? "ambiguous" : amount >= rules.deposit ? "unmatched" : "small" }).select("id").single();
    if (ok) {
      const s = hit[0];
      await sb.from("playn_settle").update({ deposit_ok: true, deposit_at: new Date().toISOString() }).eq("id", s.id);
      await recalc(rules, { ...s, deposit_ok: true });
    } else if (amount >= rules.deposit) {
      await sms(cfg, cfg.owner_phone, `[입금 매칭 실패] ${names.join("/") || "이름?"} ${won(amount)}\n체크인 입금자명과 안 맞아요. 관리자에서 연결해 주세요: https://playn.kr/admin.html#settle`);
    }
    return J({ ok: true, matched: ok ? hit[0].id : null, id: row?.id });
  }

  // ── 크론: 퇴실 1시간 뒤 정산 링크 리마인드 (09~21시) ──
  if (b.action === "tick") {
    if (b.key !== cfg.admin_key) return J({ ok: false }, 401);
    const h = kstNow().getUTCHours(); let n = 0;
    if (h >= 9 && h < 21) {
      const from = new Date(kstNow().getTime() - 3 * 86400e3).toISOString().slice(0, 10);
      const { data: rows } = await sb.from("playn_settle").select("*").in("status", ["issued", "checked_in"]).is("reminded_at", null).gte("use_date", from);
      for (const s of rows ?? []) {
        const end = endMs(s, await extHours(s.res_id));
        if (kstNow().getTime() < end + 3600e3) continue;
        const g = reviewGuide(s);
        const ev = s.checkin?.review && s.checkin.review !== "none";
        const msg = [`[플레이앤] 오늘 ${s.branch} 이용 고마웠어요 🙏`,
          s.deposit_exempt ? `레전드 멤버라 보증금은 없었어요. 쓰신 물품만 체크해 주시면 정산 금액이 바로 나와요 (1분)` : `보증금 환급을 위해 쓰신 물품만 체크해 주세요 (1분)`,
          `https://playn.kr/out/?k=${s.token}`,
          ev ? `\n📸 후기 이벤트 참여하셨죠? ${g.name}에 사진 후기 남기고 캡처를 위 링크에 올려주세요.\n${g.how}\n${g.url}` : `\n${g.name}로 예약하셨다면 후기 한 줄도 큰 힘이 돼요 👉 https://playn.kr/t/?s=${s.token}`].join("\n");
        if (await sms(cfg, s.phone, msg)) n++;
        // 일반 후기 문자(playn-auto, 퇴실 2시간 뒤)는 보내지 않도록 미리 기록
        if (s.res_id && s.phone) await sb.from("playn_followups").insert({ res_id: s.res_id, token: s.token, phone: String(s.phone).replace(/\D/g, ""), branch: s.branch, sent1_at: new Date().toISOString() }).then(() => null, () => null);
        await sb.from("playn_settle").update({ reminded_at: new Date().toISOString() }).eq("id", s.id);
      }
    }
    // 당일 체크인 안내: 입실 3시간 전부터 아직 체크인 안 한 손님에게 1번 / 입실 1시간 지나도 미체크인이면 사장님께 1번
    let cn = 0, na = 0;
    { const today = kstNow().toISOString().slice(0, 10);
      const { data: ns } = await sb.from("playn_settle").select("*").eq("status", "issued").eq("use_date", today);
      for (const s of ns ?? []) {
        const start = new Date(s.use_date + "T00:00:00Z").getTime() + (START_H[s.pkg] ?? 12) * 3600e3, now = kstNow().getTime();
        if (!s.checkin_nudged_at && s.phone && now >= start - 3 * 3600e3 && now < start + 3600e3) {
          await sms(cfg, s.phone, `[플레이앤] 오늘 ${s.branch} ${PKN[s.pkg] ?? ""} 이용 날이에요 🎮\n입실 전에 1분 체크인 부탁드려요 (인원·입금자명·환급 계좌)\nhttps://playn.kr/in/?k=${s.token}\n보증금 ${won(rules.deposit)}: ${ACCOUNT}`);
          await sb.from("playn_settle").update({ checkin_nudged_at: new Date().toISOString() }).eq("id", s.id); cn++;
        }
        if (!s.noshow_alerted_at && now >= start + 3600e3) {
          await sms(cfg, cfg.owner_phone, `[미체크인] ${s.branch} ${PKN[s.pkg] ?? ""} ${s.guest ?? ""} ${s.phone ? String(s.phone).slice(-4) : ""}\n입실 1시간이 지났는데 체크인·보증금이 안 들어왔어요. 확인 부탁드려요.`);
          await sb.from("playn_settle").update({ noshow_alerted_at: new Date().toISOString() }).eq("id", s.id); na++;
        }
      } }
    // 보증금 미입금 리마인드: 입실 1시간 뒤(체크인 30분 뒤)까지 입금 확인이 안 되면 손님에게 1번, 사장님께 1번
    let dn = 0;
    { const from2 = new Date(kstNow().getTime() - 2 * 86400e3).toISOString().slice(0, 10);
      const { data: due } = await sb.from("playn_settle").select("*").eq("deposit_ok", false).is("deposit_reminded_at", null).not("checkin", "is", null).gte("use_date", from2);
      for (const s of due ?? []) {
        const start = new Date(s.use_date + "T00:00:00Z").getTime() + ((START_H[s.pkg] ?? 12) + 1) * 3600e3;
        const ci = new Date(s.checkin_at ?? 0).getTime() + 9 * 3600e3 + 30 * 60e3;
        if (kstNow().getTime() < Math.max(start, ci)) continue;
        await sms(cfg, s.phone, `[플레이앤] 보증금 ${won(rules.deposit)} 입금이 아직 확인되지 않았어요 🙏\n${ACCOUNT}\n입금자명: ${s.checkin.depositor}\n이미 보내셨다면 입금자명이 다를 수 있어요. 이 문자에 답장으로 알려주세요.\n보증금은 퇴실 후 사용 내역만큼 빼고 그대로 돌려드려요.`);
        await sms(cfg, cfg.owner_phone, `[보증금 미입금] ${s.branch} ${s.checkin.depositor} (${s.checkin.headcount}명)\n입실 1시간이 지났는데 토스 입금이 확인 안 됐어요. 손님께 안내문자 보냈어요.`);
        await sb.from("playn_settle").update({ deposit_reminded_at: new Date().toISOString() }).eq("id", s.id); dn++;
      } }
    // 개인정보: 환급 끝난 지 30일 지난 계좌번호 삭제
    const old = new Date(Date.now() - 30 * 86400e3).toISOString();
    const { data: done } = await sb.from("playn_settle").select("id,checkin").eq("status", "paid").lt("paid_at", old).not("checkin->>account", "is", null);
    for (const d of done ?? []) {
      // 롤드컵 예측 참여 그룹은 이벤트 정산(페이백) 끝날 때까지 계좌 보관
      const { data: pk } = await sb.from("playn_worlds_picks").select("result,paid_at").eq("settle_id", d.id).maybeSingle();
      if (pk && !pk.paid_at && pk.result !== "lose") continue;
      await sb.from("playn_settle").update({ checkin: { ...d.checkin, account: null, account_purged: true } }).eq("id", d.id);
    }
    return J({ ok: true, reminded: n, checkin_nudged: cn, noshow_alerted: na, deposit_reminded: dn, purged: (done ?? []).length });
  }

  // ── 관리자 ──
  if (b.key !== cfg.admin_key) return J({ ok: false, error: "관리 키가 맞지 않아요" }, 401);
  if (b.action === "issue") { // 예약 id로 링크 발급
    const { data: r } = await sb.from("playand_reservations").select("*").eq("id", String(b.res_id)).maybeSingle();
    if (!r) return J({ ok: false, error: "예약을 찾을 수 없어요" });
    return J({ ok: true, token: await issue(r) });
  }
  if (b.action === "admin_settle_list") {
    const { data } = await sb.from("playn_settle").select("*").in("status", b.all ? ["issued", "checked_in", "submitted", "hold", "paid"] : ["checked_in", "submitted", "hold"]).order("use_date", { ascending: false }).limit(40);
    const out = [];
    for (const s of data ?? []) {
      const proof = s.review_proof ? (await sb.storage.from("playn-private").createSignedUrl(s.review_proof, 900)).data?.signedUrl : null;
      out.push({ ...s, proof_url: proof });
    }
    const { data: deps } = await sb.from("playn_deposits").select("id,at,name,amount,status,raw").in("status", ["unmatched", "ambiguous"]).order("at", { ascending: false }).limit(20);
    // 청소 점검(매니저 사진 + AI 판독)을 정산 카드에 붙이고, 정산 링크를 안 쓴 예약의 점검은 따로
    const sign = async (p: string) => (await sb.storage.from("playn-private").createSignedUrl(p, 900)).data?.signedUrl ?? null;
    const { data: cl } = await sb.from("playn_clean").select("*").neq("deposit_status", "done").order("created_at", { ascending: false }).limit(30);
    const byRes = new Map((cl ?? []).map((c: any) => [c.res_id, c]));
    for (const o of out as any[]) { const c = byRes.get(o.res_id); if (c) { o.clean = { id: c.id, verdict: c.verdict, notes: c.ai?.notes ?? null, urls: (await Promise.all((c.photos ?? []).slice(0, 4).map(sign))).filter(Boolean) }; byRes.delete(o.res_id); } }
    const orphans = [];
    for (const c of byRes.values()) { const { data: r } = await sb.from("playand_reservations").select("guest_name,phone,use_date,branch").eq("id", c.res_id).maybeSingle(); orphans.push({ id: c.id, branch: c.branch ?? r?.branch, use_date: r?.use_date, guest: r?.guest_name, phone: r?.phone, verdict: c.verdict, notes: c.ai?.notes ?? null, urls: (await Promise.all((c.photos ?? []).slice(0, 4).map(sign))).filter(Boolean) }); }
    return J({ ok: true, items: out, rules, deposits: deps ?? [], cleans: orphans });
  }
  if (b.action === "admin_settle_adjust") { // 금액 조정 (파손·청소비 등 추가 차감)
    const { data: s } = await sb.from("playn_settle").select("*").eq("id", b.id).maybeSingle();
    if (!s || !s.calc) return J({ ok: false, error: "정산 내역이 없어요" });
    const extra = Math.round(Number(b.extra ?? 0));
    const lines = s.calc.lines.filter((l: any) => !l.manual);
    if (extra) lines.push({ name: String(b.reason ?? "추가 차감").slice(0, 40), amount: extra, manual: true });
    await sb.from("playn_settle").update({ note: b.reason ?? s.note }).eq("id", s.id);
    const r = await recalc(rules, { ...s, calc: { ...s.calc, lines } });
    return J({ ok: true, ...r });
  }
  if (b.action === "admin_worlds") { // 예측 목록 + 우승팀 지정 시 당첨 그룹
    let w: any = {}; try { w = JSON.parse(cfg.worlds_event ?? "{}"); } catch { /* */ }
    if (b.winner !== undefined) {
      w.winner = b.winner || null;
      await sb.from("playand_config").upsert({ key: "worlds_event", value: JSON.stringify(w) });
      await sb.from("playn_worlds_picks").update({ result: null }).neq("id", 0);
      if (w.winner) { await sb.from("playn_worlds_picks").update({ result: "win" }).eq("team", w.winner); await sb.from("playn_worlds_picks").update({ result: "lose" }).neq("team", w.winner); }
    }
    if (b.playn_pick !== undefined || b.eliminated !== undefined || b.stage !== undefined) {
      if (b.playn_pick !== undefined) w.playn_pick = b.playn_pick || null;
      if (Array.isArray(b.eliminated)) w.eliminated = b.eliminated.filter((t: string) => (w.teams ?? []).includes(t));
      if (b.stage !== undefined) w.stage = String(b.stage || "").slice(0, 30) || null;
      await sb.from("playand_config").upsert({ key: "worlds_event", value: JSON.stringify(w) });
    }
    if (b.paid_id) {
      const { data: p } = await sb.from("playn_worlds_picks").select("*").eq("id", b.paid_id).maybeSingle();
      if (p && !p.paid_at && p.result === "win") {
        await sb.from("playn_worlds_picks").update({ paid_at: new Date().toISOString() }).eq("id", p.id);
        await sms(cfg, p.phone, `[플레이앤] 롤드컵 우승팀 적중 🏆\n${p.team} 우승을 맞히셨어요! 약속드린 ${won(Number(p.payout ?? w.payout ?? 100000))} 보내드렸어요.\n같이 응원해 주셔서 고마워요. 다음 시즌에도 플레이앤에서 만나요!`);
      }
    }
    const { data } = await sb.from("playn_worlds_picks").select("*").order("created_at", { ascending: false }).limit(300);
    const tally: Record<string, number> = {};
    for (const p of data ?? []) tally[p.team] = (tally[p.team] ?? 0) + 1;
    // 당첨 그룹 환급 계좌 (보증금 정산 때 받은 계좌, 30일 지나 지워졌으면 없음)
    const items = [];
    for (const p of data ?? []) {
      let acc = null;
      if (p.result === "win") { const { data: st } = await sb.from("playn_settle").select("checkin").eq("id", p.settle_id).maybeSingle(); acc = st?.checkin?.account ? { bank: st.checkin.bank, account: st.checkin.account, holder: st.checkin.holder } : null; }
      items.push({ ...p, acc, crew: await crewProgress(p) });
    }
    // 홈페이지 팬 투표 집계
    const { data: vs } = await sb.from("playn_worlds_votes").select("team");
    const fan: Record<string, number> = {};
    for (const v of vs ?? []) fan[v.team] = (fan[v.team] ?? 0) + 1;
    return J({ ok: true, event: w, tally, items, fan, fan_total: (vs ?? []).length });
  }
  if (b.action === "admin_deposit_set") { // 입금 수동 확인/취소, 또는 미매칭 입금을 정산 건에 연결
    const { data: s } = await sb.from("playn_settle").select("*").eq("id", b.id).maybeSingle();
    if (!s) return J({ ok: false, error: "정산 건이 없어요" });
    const ok = b.ok !== false;
    await sb.from("playn_settle").update({ deposit_ok: ok, deposit_at: ok ? new Date().toISOString() : null }).eq("id", s.id);
    if (b.deposit_id) await sb.from("playn_deposits").update({ settle_id: s.id, status: "matched" }).eq("id", b.deposit_id);
    return J({ ok: true, ...(await recalc(rules, { ...s, deposit_ok: ok })) });
  }
  if (b.action === "admin_review_set") { // v22: 후기 이벤트 캡처 수락/반려 (반려하면 손님께 다시 올려달라는 문자)
    const { data: s } = await sb.from("playn_settle").select("*").eq("id", b.id).maybeSingle();
    if (!s) return J({ ok: false, error: "정산 건이 없어요" });
    if (!s.review_proof) return J({ ok: false, error: "손님이 올린 후기 캡처가 없어요" });
    if (s.status === "paid") return J({ ok: false, error: "이미 환급이 끝난 건이에요" });
    const ok = b.ok === true, note = ok ? null : (String(b.note ?? "").trim().slice(0, 80) || null);
    await sb.from("playn_settle").update({ review_ok: ok, review_note: note, review_checked_at: new Date().toISOString() }).eq("id", s.id);
    const r: any = await recalc(rules, { ...s, review_ok: ok, review_note: note });
    // 퇴실 점검(인원·일회용품·퇴실 체크 등)이 붙인 확인 항목은 후기 수락으로 지워지지 않게 그대로 둠
    const keep = (s.flags ?? []).filter((f: string) => /^(인원 |일회용품 |⛔ 환급 보류: 손님이 퇴실|바베큐 한다고|체크인을 안 한)/.test(f) && !(r?.flags ?? []).includes(f));
    if (r && keep.length) { r.flags = [...r.flags, ...keep]; r.status = "hold"; await sb.from("playn_settle").update({ flags: r.flags, status: "hold" }).eq("id", s.id); }
    let notified = false;
    if (!ok && s.phone) {
      const g = reviewGuide(s);
      notified = await sms(cfg, s.phone, [`[플레이앤] 올려주신 사진이 후기 캡처로 확인되지 않았어요${note ? ` (${note})` : ""}.`, `${g.name}에 사진 후기를 남긴 뒤, 작성한 후기가 보이는 화면을 캡처해서 다시 올려주세요. 확인되면 바로 보증금 환급을 진행해요.`, `https://playn.kr/out/?k=${s.token}`].join("\n"));
    }
    return J({ ok: true, notified, ...(r ?? {}) });
  }
  if (b.action === "admin_clean_done") { await sb.from("playn_clean").update({ deposit_status: "done" }).eq("id", b.id); return J({ ok: true }); }
  if (b.action === "admin_deposit_dismiss") { await sb.from("playn_deposits").update({ status: "ignored" }).eq("id", b.deposit_id); return J({ ok: true }); }
  if (b.action === "admin_bbq_verify") { // 스클에서 확인한 바베큐 결제 인원
    const { data: s } = await sb.from("playn_settle").select("*").eq("id", b.id).maybeSingle();
    if (!s) return J({ ok: false, error: "정산 건이 없어요" });
    const v = Math.max(0, Math.round(Number(b.paid ?? 0)));
    await sb.from("playn_settle").update({ bbq_verified: v }).eq("id", s.id);
    return J({ ok: true, ...(await recalc(rules, { ...s, bbq_verified: v })) });
  }
  // 송금(정산) 완료 처리: 한 건 / 여러 건 한 번에
  async function markPaid(id: number, force: boolean) {
    const { data: s } = await sb.from("playn_settle").select("*").eq("id", id).maybeSingle();
    if (!s || !s.calc) return { id, ok: false, error: "정산 내역이 없어요" };
    if (s.status === "paid") return { id, ok: false, error: "이미 완료된 정산이에요" };
    // 2026-11-02 사장님: 후기 이벤트 참여 손님은 후기 캡처 + 퇴실 사용내역 체크가 모두 된 경우에만 환급 (강제 완료로도 못 넘김)
    if (s.checkin?.review && s.checkin.review !== "none" && s.review_proof && s.checkout_at && s.review_ok !== true) return { id, ok: false, error: s.review_ok === false ? "후기 캡처를 반려한 상태예요. 손님이 다시 올리고 '후기 인증 수락'을 눌러야 환급할 수 있어요" : "후기 캡처를 아직 수락하지 않았어요. 사진 확인 후 '후기 인증 수락'을 먼저 눌러주세요" };
    if (s.checkin?.review && s.checkin.review !== "none" && (!s.review_proof || !s.checkout_at)) return { id, ok: false, error: `후기 이벤트 참여 손님이라 ${!s.review_proof && !s.checkout_at ? "후기 캡처와 퇴실 사용내역 체크가" : !s.review_proof ? "후기 캡처가" : "퇴실 사용내역 체크가"} 끝나야 환급할 수 있어요` };
    if (!s.deposit_ok && !s.deposit_exempt && !force) return { id, ok: false, error: "보증금 입금이 확인되지 않았어요. 토스에서 확인했다면 '입금 확인'을 먼저 눌러주세요." };
    if (!s.deposit_ok && !s.deposit_exempt) { // 사장님이 직접 확인하고 강제 완료 → 입금 확인으로 보고 다시 계산
      await sb.from("playn_settle").update({ deposit_ok: true, deposit_at: new Date().toISOString() }).eq("id", s.id);
      const r = await recalc(rules, { ...s, deposit_ok: true }); if (r) s.calc = r.calc;
    }
    await sb.from("playn_settle").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", s.id);
    if (s.res_id) await sb.from("playn_clean").update({ deposit_status: "done" }).eq("res_id", s.res_id); // 청소 점검 카드도 같이 정리
    const detail = s.calc.lines.map((l: any) => `· ${l.name} ${won(l.amount)}`).join("\n");
    const g = reviewGuide(s), ev = s.checkin?.review && s.checkin.review !== "none";
    const tail = `${ev ? "" : `\n${g.name} 후기 한 줄 부탁드려요 🙏 https://playn.kr/t/?s=${s.token}`}${(await isMember(s.phone)) ? "\nN CREW 멤버 특가는 playn.kr 에서 확인하세요" : "\nN CREW 가입하면 다음 예약 멤버 특가 20% 👉 playn.kr/?from=refund#crew"}`;
    const body = s.calc.exempt
      ? `[플레이앤] 정산 완료 ✅ (레전드 · 보증금 면제)\n이용 차감 ${won(s.calc.total)} 입금 확인했어요.\n${detail}\n이용해 주셔서 감사합니다!${tail}`
      : `[플레이앤] 보증금 환급 완료 💸\n보증금 ${won(s.calc.deposit)} - 차감 ${won(s.calc.total)} = ${won(s.calc.refund)}\n${detail}\n${s.checkin?.bank ?? ""} ${maskAcc(s.checkin?.account ?? "")}로 보냈어요.\n이용해 주셔서 감사합니다!${tail}`;
    await sms(cfg, s.phone, body);
    return { id, ok: true, refund: s.calc.refund ?? 0, owed: s.calc.owed ?? 0 };
  }
  if (b.action === "admin_settle_paid") {
    const r = await markPaid(Number(b.id), !!b.force);
    return J(r);
  }
  if (b.action === "admin_settle_paid_batch") { // 확인 끝난 건들 한 번에 완료 (깨끗한 건만: 플래그 없음 + 입금 확인)
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 30);
    const out = [];
    for (const id of ids) out.push(await markPaid(id, false));
    return J({ ok: true, done: out.filter((x) => x.ok).length, results: out });
  }
  return J({ error: "unknown action" }, 400);
});
