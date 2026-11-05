// playn-site: 플레이앤 홈페이지 API — 이번 주 공실 계산, N CREW 멤버 가입, 멤버 특가 신청, 사장님 관리
// v18 (2026-11-05): 확정 문자에 인원·바베큐 줄 추가. 되돌리기: index_v17.ts
// v17 (2026-11-04): 확정 문자에 입금자명·입금 기한(DB playn_pay_open), 사장님 입금 확인/취소(admin_pay), 가입 문자 인증(need_code → 인증 후 바로 로그인 토큰), 번호만으로 받던 옛 신청(request)은 내 N CREW로 안내. 되돌리기: index_v16.ts
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const BR = ["홍대루프탑점", "연남루프탑점", "연트럴파크점"];
const PK: Record<string, { n: string; s: number; e: number; t: string }> = {
  day: { n: "주간", s: 11, e: 17.5, t: "11:00 ~ 17:30" },
  night: { n: "야간", s: 19, e: 33.5, t: "19:00 ~ 익일 09:30" },
  full: { n: "통대관", s: 12, e: 34, t: "12:00 ~ 익일 10:00" },
};
const HOST = "010-8339-5818";
const ACCOUNT = "토스뱅크 100008287587 (예금주 윤도권)"; // 바꿀 땐 playand_config bank_account / host_phone 키를 넣으면 코드 배포 없이 적용 (2026-10-17)
const GUIDE: Record<string, string> = {
  "홍대루프탑점": "https://playn.kr/guide/?b=hongdae",
  "연남루프탑점": "https://playn.kr/guide/?b=yeonnam",
  "연트럴파크점": "https://playn.kr/guide/?b=yeontral",
};

async function cfgAll() {
  const { data } = await sb.from("playand_config").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
}
const kstNow = () => new Date(Date.now() + 9 * 3600e3); // UTC 필드를 KST로 읽음
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => ymd(new Date(new Date(s + "T00:00:00Z").getTime() + n * 86400e3));
const normPhone = (p: unknown) => { const d = String(p ?? "").replace(/\D/g, ""); return /^01\d{8,9}$/.test(d) ? d : null; };

// ── N CREW v1 (2026-10-30): 광고 판단·수신 거부 링크·접속 구분 (DB 함수 playn_ad_ok / playn_optout_link)
async function adOk(phone: string) { const { data } = await sb.rpc("playn_ad_ok", { p_phone: phone }); return data === true; }
async function adFooter(phone: string) { const { data: t } = await sb.rpc("playn_optout_link", { p_phone: phone }); return t ? `수신거부 playn.kr/stop/?t=${t}` : "수신거부: playn.kr 맨 아래"; }
async function withFooter(msg: string, phone: string) { return msg.replace("수신거부: playn.kr 맨 아래", await adFooter(phone)); }
async function otpIpHash(req: Request) {
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim(); if (!ip) return null;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ncrew-otp:" + ip)));
  return Array.from(d.slice(0, 8)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const fmtPhone = (d: string) => d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
function label(s: string) { const d = new Date(s + "T00:00:00Z"); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]})`; }

function grade(date: string, hol: Set<string>, forceC: string[]) {
  if (forceC.includes(date.slice(5))) return "C";
  const off = (s: string) => hol.has(s) || [0, 6].includes(new Date(s + "T00:00:00Z").getUTCDay());
  const a = off(date), b = off(addDays(date, 1));
  return !a && !b ? "A" : !a && b ? "B" : a && b ? "C" : "D";
}

// 공실 특가 규칙 (2026-10 리서치 반영: "기다리면 싸진다" 학습 방지)
// - D-3 이후(early_from~) 빈자리: 멤버 특가 deal_discount%
// - D-1·D-2: 할인 없음(정가)
// - 당일: 예고 없이 하루 flash_per_day자리만 deal_discount_today% (조건 맞는 빈자리 중 날짜 해시 순서)
// - 고수요 제외: exclude_grades 등급 전체, exclude_night_grades 등급의 야간·통대관, exclude_mmdd 날짜
// - mode "classic"이면 예전 방식(7일 전부 할인, 당일 더 크게)
function dealRules(cfg: Record<string, string>) {
  const d = { mode: "fenced", early_from: 3, flash_per_day: 1, exclude_grades: ["C"], exclude_night_grades: ["B"], exclude_mmdd: ["12-24", "12-31"] };
  try { return { ...d, ...JSON.parse(cfg.deal_rules ?? "{}") }; } catch { return d; }
}
function blocked(r: any, date: string, g: string, k: string) {
  if (r.exclude_mmdd.includes(date.slice(5))) return true;
  if (r.exclude_grades.includes(g)) return true;
  if (k !== "day" && r.exclude_night_grades.includes(g)) return true;
  return false;
}
async function hashOrder(seed: string, keys: string[]) {
  const scored = await Promise.all(keys.map(async (k) => {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed + "|" + k)));
    return { k, s: (h[0] << 8) | h[1] };
  }));
  return scored.sort((a, b) => a.s - b.s).map((x) => x.k);
}

async function deals(cfg: Record<string, string>) {
  const days = Number(cfg.deal_days ?? 7), disc = Number(cfg.deal_discount ?? 20), discToday = Number(cfg.deal_discount_today ?? disc);
  const R = dealRules(cfg), classic = R.mode === "classic";
  const prices = JSON.parse(cfg.prices ?? "{}"), hol = new Set<string>(JSON.parse(cfg.holidays ?? "[]")), forceC = JSON.parse(cfg.force_c ?? "[]");
  const now = kstNow(), today = ymd(now), nowH = now.getUTCHours() + now.getUTCMinutes() / 60;
  const end = addDays(today, days + 1);
  const { data: ev } = await sb.from("playand_ical_events").select("branch,start_at,end_at").lt("start_at", end + "T12:00:00").gt("end_at", today + "T00:00:00");
  const { data: rq } = await sb.from("playn_deal_requests").select("branch,use_date,pkg,upgrade_full,regular_price,deal_price").in("status", ["pending", "confirmed"]).gte("use_date", today);
  const toH = (ts: string, base: string) => (new Date(ts.replace(" ", "T") + "Z").getTime() - new Date(base + "T00:00:00Z").getTime()) / 3600e3;
  const price = (reg: number | null, dc: number) => (reg ? Math.round((reg * (100 - dc)) / 100 / 1000) * 1000 : null);
  // 오늘 날짜를 당일 특가 수준으로 신청한 건수
  const flashUsed = (rq ?? []).filter((r) => r.use_date === today && Number(r.regular_price) > 0 && Number(r.deal_price) > 0 && Number(r.deal_price) <= Number(r.regular_price) * (100 - discToday) / 100 + 1000).length;
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i), g = grade(d, hol, forceC);
    const row: any = { date: d, label: label(d), grade: g, weekend: g !== "A", branches: {} };
    for (const b of BR) {
      const busy = (ev ?? []).filter((e) => e.branch === b).map((e) => [toH(e.start_at, d), toH(e.end_at, d)]);
      row.branches[b] = {};
      for (const [k, p] of Object.entries(PK)) {
        let free = !busy.some(([s, e]) => s < p.e && e > p.s);
        if (i === 0 && nowH > p.s - 1) free = false; // 시작 1시간 전까지만
        if ((rq ?? []).some((r) => r.branch === b && r.use_date === d && (r.pkg === k || r.pkg === "full" || r.upgrade_full || k === "full"))) free = false;
        const reg = prices?.[b]?.[k]?.[g] ?? null;
        let dc = 0, kind = "regular";
        if (classic) { dc = i === 0 ? discToday : disc; kind = i === 0 ? "today" : "early"; }
        else if (i >= R.early_from && !blocked(R, d, g, k)) { dc = disc; kind = "early"; }
        row.branches[b][k] = { free, regular: reg, deal: price(reg, dc), rate: dc, kind };
      }
    }
    out.push(row);
  }
  // 당일 번개 특가: 조건 맞는 빈자리 중 날짜 해시 순서로 남은 수량만큼
  if (!classic && out.length && R.flash_per_day - flashUsed > 0) {
    const r0 = out[0], keys: string[] = [];
    for (const b of BR) for (const k of Object.keys(PK)) { const s = r0.branches[b][k]; if (s.free && s.regular && !blocked(R, r0.date, r0.grade, k)) keys.push(b + "|" + k); }
    for (const key of (await hashOrder(today, keys)).slice(0, R.flash_per_day - flashUsed)) {
      const [b, k] = key.split("|"), s = r0.branches[b][k];
      Object.assign(s, { rate: discToday, deal: price(s.regular, discToday), kind: "flash" });
    }
  }
  return { discount: disc, discount_today: discToday, rules: { mode: R.mode, early_from: R.early_from, flash_per_day: R.flash_per_day }, packages: PK, days: out, updated: new Date().toISOString() };
}

// 날짜 하나의 빈자리·정가 (멤버 예약 신청용, 90일 이내)
async function slotInfo(cfg: Record<string, string>, date: string, branch: string, pkg: string) {
  const p = PK[pkg];
  if (!p || !BR.includes(branch) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "지점·날짜·패키지를 확인해 주세요" };
  const today = ymd(kstNow()), nowH = kstNow().getUTCHours() + kstNow().getUTCMinutes() / 60;
  if (date < today || date > addDays(today, 90)) return { ok: false, error: "오늘부터 90일 안의 날짜만 신청할 수 있어요" };
  const hol = new Set<string>(JSON.parse(cfg.holidays ?? "[]")), forceC = JSON.parse(cfg.force_c ?? "[]"), prices = JSON.parse(cfg.prices ?? "{}");
  const g = grade(date, hol, forceC);
  const { data: ev } = await sb.from("playand_ical_events").select("start_at,end_at").eq("branch", branch).lt("start_at", addDays(date, 2) + "T12:00:00").gt("end_at", date + "T00:00:00");
  const { data: rq } = await sb.from("playn_deal_requests").select("pkg,upgrade_full").eq("branch", branch).eq("use_date", date).in("status", ["pending", "confirmed"]);
  const toH = (ts: string) => (new Date(ts.replace(" ", "T") + "Z").getTime() - new Date(date + "T00:00:00Z").getTime()) / 3600e3;
  const busyFor = (q: { s: number; e: number }) => (ev ?? []).some((e) => toH(e.start_at) < q.e && toH(e.end_at) > q.s);
  const reqFor = (k: string) => (rq ?? []).some((r) => r.pkg === k || r.pkg === "full" || r.upgrade_full || k === "full");
  let free = !busyFor(p) && !reqFor(pkg);
  if (date === today && nowH > p.s - 1) free = false;
  const fullFree = !busyFor(PK.full) && !reqFor("full") && !(date === today && nowH > PK.full.s - 1);
  const days = Number(cfg.deal_days ?? 7), inWindow = date < addDays(today, days);
  // 빈자리 보드와 같은 규칙 (D-3 이후 특가, 당일 번개 1자리, 고수요 제외)
  const dealRate = inWindow ? Number((await deals(cfg)).days.find((x: any) => x.date === date)?.branches?.[branch]?.[pkg]?.rate ?? 0) : 0;
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  return { ok: true, free, full_free: fullFree, regular: prices?.[branch]?.[pkg]?.[g] ?? null, grade: g, deal_rate: dealRate, dow, label: label(date), pkg_name: p.n, time: p.t };
}

async function sms(cfg: Record<string, string>, to: string, msg: string) {
  if (!cfg.macrodroid_webhook || !to) return false;
  const u = new URL(cfg.macrodroid_webhook);
  u.searchParams.set("phone", to.replace(/\D/g, ""));
  u.searchParams.set("msg", msg);
  try { return (await fetch(u.toString())).ok; } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const cfg = await cfgAll();
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.has("deals")) return J(await deals(cfg));
    return J({ ok: true, kakao: cfg.kakao_channel_url ?? null, optout_mode: cfg.ncrew_optout_mode === "verified" ? "verified" : "legacy", join_otp: cfg.ncrew_join_otp === "on" });
  }
  let b: any;
  try { b = await req.json(); } catch { return J({ error: "bad json" }, 400); }

  if (b.action === "slot") return J(await slotInfo(cfg, String(b.date ?? ""), String(b.branch ?? ""), String(b.pkg ?? "")));

  // 가입 인증번호 (준비: 설정 ncrew_join_otp=on 일 때만. 지금은 꺼짐 → 문자 안 나감)
  if (b.action === "join_otp") {
    if (cfg.ncrew_join_otp !== "on") return J({ ok: false, error: "가입 인증은 아직 준비 중이에요" });
    const phone = normPhone(b.phone); if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const { data: r, error } = await sb.rpc("member_otp_issue", { p_phone: phone, p_purpose: "join", p_ip_hash: await otpIpHash(req) });
    if (error || !r?.ok) return J({ ok: false, error: r?.error ?? "잠시 후 다시 해 주세요" });
    const sent = await sms(cfg, phone, `[플레이앤 N CREW] 가입 인증번호 ${r.code} (5분 안에 입력해 주세요)`);
    return J({ ok: sent, error: sent ? undefined : "문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요" });
  }
  if (b.action === "join") {
    const phone = normPhone(b.phone), name = String(b.name ?? "").trim().slice(0, 20);
    if (!phone || !name) return J({ ok: false, error: "이름과 휴대폰 번호를 확인해 주세요" });
    // 가입 필수 동의(개인정보 수집·이용)와 광고 동의는 분리 (N CREW v1c). 광고 동의는 b.marketing === true 일 때만, 인증 스위치와 무관
    if (!b.agree) return J({ ok: false, error: "N CREW 가입 필수 동의에 체크해 주세요" });
    const joinOtp = cfg.ncrew_join_otp === "on";
    if (joinOtp) {
      if (!String(b.code ?? "").trim()) { // v17: 인증번호를 아직 안 넣었으면 바로 보내고 입력 칸을 띄우게 함
        const { data: r, error } = await sb.rpc("member_otp_issue", { p_phone: phone, p_purpose: "join", p_ip_hash: await otpIpHash(req) });
        if (error || !r?.ok) return J({ ok: false, need_code: true, sent: false, error: r?.error ?? "잠시 후 다시 해 주세요" });
        const sent = await sms(cfg, phone, `[플레이앤 N CREW] 가입 인증번호 ${r.code} (5분 안에 입력해 주세요)`);
        return J({ ok: false, need_code: true, sent, error: sent ? "문자로 받은 인증번호 6자리를 넣어 주세요" : "문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요" });
      }
      const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "join" });
      if (!v?.ok) return J({ ok: false, need_code: true, error: v?.error ?? "인증번호를 확인해 주세요" });
    }
    const { data: jr } = await sb.rpc("playn_member_join", { p_phone: phone, p_name: name, p_source: String(b.source ?? "web").slice(0, 30), p_branch: BR.includes(b.branch) ? b.branch : null, p_marketing: b.marketing === true, p_night: b.night_agree === true });
    if (!jr?.ok) return J({ ok: false, error: jr?.error ?? "잠시 후 다시 해 주세요" });
    const ex = jr.again;
    await sb.from("playand_log").insert({ source: "member_join", payload: { phone: phone.slice(-4), again: !!ex, verified: joinOtp, marketing: b.marketing === true } });
    const { data: ticket } = await sb.rpc("playn_join_ticket", { p_phone: phone }); // 초대 코드 연결용 1회 표(10분)
    let token: string | null = null; // v17: 문자 인증으로 가입했으면 내 N CREW 로그인까지 한 번에 (인증번호 두 번 받지 않게)
    if (joinOtp) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((x) => x.toString(16).padStart(2, "0")).join("");
      await sb.from("playn_sessions").insert({ token, phone, expires_at: new Date(Date.now() + 30 * 86400e3).toISOString() });
    }
    return J({ ok: true, again: !!ex, name, ticket, token });
  }

  if (b.action === "check") {
    const phone = normPhone(b.phone);
    if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const { data: m } = await sb.from("playn_members").select("name,status").eq("phone", phone).maybeSingle();
    return J({ ok: !!m && m.status === "active" }); // 이름은 돌려주지 않음 (번호만으로 남의 이름 조회 방지)
  }

  // 광고 수신 거부: 광고 동의 끄기 + 수신 거부 기록만. 회원 자격·로그인·예약·혜택은 그대로 (N CREW v1)
  //  verified(본인 확인): 인증번호 확인 뒤 처리 / legacy(전환 전 임시): 기존 홈페이지 경로 유지, 광고만 끔
  if (b.action === "optout_link") {
    const { data: r } = await sb.rpc("playn_optout_by_link", { p_token: String(b.t ?? "").slice(0, 40) });
    return J(r ?? { ok: false, error: "잠시 후 다시 해 주세요" });
  }
  if (b.action === "optout_otp") {
    const phone = normPhone(b.phone); if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    // v1e 제한 시험: 전역 verified 가 꺼져 있어도, 시험 스위치 on + 지정 번호만 인증번호 발급 (시험 전체 발송 한도 있음)
    const pilot = cfg.ncrew_optout_mode !== "verified" && cfg.ncrew_optout_pilot === "on" && (await sb.rpc("ncrew_optout_pilot_on", { p_phone: phone })).data === true;
    if (cfg.ncrew_optout_mode !== "verified" && !pilot) return J({ ok: false, error: "본인 확인 수신 거부는 아직 준비 중이에요" });
    const { data: r, error } = pilot
      ? await sb.rpc("ncrew_optout_pilot_issue", { p_phone: phone, p_ip_hash: await otpIpHash(req) })
      : await sb.rpc("member_otp_issue", { p_phone: phone, p_purpose: "optout", p_ip_hash: await otpIpHash(req) });
    if (error || !r?.ok) return J({ ok: false, error: r?.error ?? "잠시 후 다시 해 주세요" });
    const sent = await sms(cfg, phone, `[플레이앤] 수신 거부 인증번호 ${r.code}\n5분 안에 입력해 주세요. 요청 안 했으면 무시하세요.`);
    return J({ ok: sent, error: sent ? undefined : "문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요" });
  }
  if (b.action === "leave") {
    const phone = normPhone(b.phone);
    if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const verified = cfg.ncrew_optout_mode === "verified" || (cfg.ncrew_optout_pilot === "on" && (await sb.rpc("ncrew_optout_pilot_on", { p_phone: phone })).data === true);
    if (verified) {
      if (!b.code) return J({ ok: false, need_code: true, error: "본인 확인 인증번호를 받아 주세요" });
      const { data: r } = await sb.rpc("playn_optout_verified", { p_phone: phone, p_code: String(b.code).slice(0, 12) });
      return J(r ?? { ok: false, error: "잠시 후 다시 해 주세요" });
    }
    await sb.rpc("playn_optout_apply", { p_phone: phone, p_method: "site_legacy" });
    return J({ ok: true });
  }

  if (b.action === "request") { // v17: 번호만으로 신청하던 옛 경로는 닫음 (화면은 이미 내 N CREW 문자 인증 로그인으로 넘어감)
    if (cfg.site_request_legacy !== "on") return J({ ok: false, moved: true, error: "예약 신청은 내 N CREW(playn.kr/me)에서 문자 인증 후 할 수 있어요" });
    const phone = normPhone(b.phone);
    if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const { data: m } = await sb.from("playn_members").select("name,status").eq("phone", phone).maybeSingle();
    if (!m || m.status !== "active") return J({ ok: false, need_join: true, error: "N CREW 멤버만 신청할 수 있어요. 먼저 가입해 주세요" });
    const since = new Date(Date.now() - 86400e3).toISOString();
    const { count } = await sb.from("playn_deal_requests").select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since);
    if ((count ?? 0) >= 3) return J({ ok: false, error: "하루 신청은 3건까지예요. 호스트에게 문의해 주세요" });
    const d = await deals(cfg);
    const day = d.days.find((x: any) => x.date === b.date);
    const slot = day?.branches?.[b.branch]?.[b.pkg];
    if (!slot?.free) return J({ ok: false, error: "방금 마감됐어요. 다른 날짜를 골라주세요" });
    const people = Math.max(1, Math.min(30, Number(b.people) || 0)) || null;
    const { data: ins } = await sb.from("playn_deal_requests").insert({ phone, name: m.name, branch: b.branch, use_date: b.date, pkg: b.pkg, regular_price: slot.regular, deal_price: slot.deal, people, memo: String(b.memo ?? "").slice(0, 200) }).select("id").single();
    const p = PK[b.pkg];
    await sms(cfg, cfg.owner_phone, `[N CREW 특가 신청 #${ins?.id}]\n${m.name} ${fmtPhone(phone)}\n${b.branch} ${day.label} ${p.n} (${p.t})\n인원 ${people ?? "-"}명 · ${slot.kind === "flash" ? "⚡당일 번개 " : slot.rate ? "" : "정가 "}${slot.rate ? slot.rate + "% 특가 " : ""}${slot.deal ? slot.deal.toLocaleString() + "원" : "가격 확인 필요"}\n${b.memo ? "메모: " + String(b.memo).slice(0, 80) + "\n" : ""}관리: https://playn.kr/admin.html`);
    return J({ ok: true, id: ins?.id, price: slot.deal, label: day.label, pkg: p.n, time: p.t });
  }

  // 사장님 관리
  if (b.action?.startsWith("admin")) {
    if (!cfg.admin_key || b.key !== cfg.admin_key) return J({ ok: false, error: "관리 키가 맞지 않아요" }, 401);
    if (b.action === "admin_list") {
      const { data: rq } = await sb.from("playn_deal_requests").select("*").order("created_at", { ascending: false }).limit(60);
      const { data: cks } = await sb.from("playn_crew_checks").select("request_id,need,phones,done_at,code").in("request_id", (rq ?? []).map((r) => r.id));
      for (const r of rq ?? []) { const c = (cks ?? []).find((x) => x.request_id === r.id); if (c) (r as any).crew = { need: c.need, have: c.phones.length, done: !!c.done_at, link: `https://playn.kr/crew/?g=${c.code}` }; }
      const { count } = await sb.from("playn_members").select("phone", { count: "exact", head: true }).eq("status", "active");
      return J({ ok: true, requests: rq, members: count, discount: Number(cfg.deal_discount ?? 20), discount_today: Number(cfg.deal_discount_today ?? 35) });
    }
    if (b.action === "admin_members") {
      const { data } = await sb.from("playn_members").select("name,phone,fav_branch,night_agree,source,created_at,status").order("created_at", { ascending: false }).limit(500);
      return J({ ok: true, members: data });
    }
    if (b.action === "admin_discount") {
      const v = Math.max(0, Math.min(70, Number(b.value)));
      await sb.from("playand_config").upsert({ key: "deal_discount", value: String(v) });
      let t = Number(cfg.deal_discount_today ?? 35);
      if (b.today != null && b.today !== "") { t = Math.max(0, Math.min(70, Number(b.today))); await sb.from("playand_config").upsert({ key: "deal_discount_today", value: String(t) }); }
      return J({ ok: true, discount: v, discount_today: t });
    }
    if (b.action === "admin_decide") {
      const st = b.status === "confirmed" ? "confirmed" : "rejected";
      if (st === "confirmed") { // 50% 할인권 예약: 이용 인원 전원 N CREW 인증 전엔 확정 불가
        const { data: ck } = await sb.from("playn_crew_checks").select("need,phones,done_at").eq("request_id", b.id).maybeSingle();
        if (ck && !ck.done_at) return J({ ok: false, error: `N CREW 전원 인증 전이라 확정할 수 없어요 (${ck.phones.length}/${ck.need}명)` });
      }
      const { data: r } = await sb.from("playn_deal_requests").update({ status: st, decided_at: new Date().toISOString(), deal_price: b.price != null && b.price !== "" ? Number(b.price) : undefined }).eq("id", b.id).select("*").single();
      if (!r) return J({ ok: false, error: "신청을 찾을 수 없어요" });
      // 쿠폰: 확정되면 사용, 마감되면 되돌림
      if (r.coupon_id) {
        if (st === "confirmed") await sb.from("playn_coupons").update({ status: "used", used_at: new Date().toISOString(), used_note: `예약 #${r.id}` }).eq("id", r.coupon_id);
        else await sb.from("playn_coupons").update({ status: "active", request_id: null }).eq("id", r.coupon_id);
      }
      // 플레이앤 패스 결제: 확정되면 잔액 차감
      let passLeft: number | null = null;
      if (st === "confirmed" && r.pay_pass && Number(r.deal_price) > 0) {
        const { data: ex } = await sb.from("playn_pass_ledger").select("id").eq("request_id", r.id).maybeSingle();
        if (!ex) await sb.from("playn_pass_ledger").insert({ phone: r.phone, delta: -Number(r.deal_price), note: `예약 #${r.id}`, request_id: r.id });
        const { data: led } = await sb.from("playn_pass_ledger").select("delta").eq("phone", r.phone);
        passLeft = (led ?? []).reduce((a, x) => a + x.delta, 0);
      }
      // v17: 입금 기한 정하기 (무료·패스는 free, 이미 입금 확인된 건은 그대로)
      let pay: any = null;
      if (st === "confirmed") { const { data } = await sb.rpc("playn_pay_open", { p_id: r.id }); pay = data; }
      const p = PK[r.upgrade_full ? "full" : r.pkg];
      const head = r.kind === "member" ? "멤버 예약" : "멤버 특가 예약";
      const payLines = Number(r.deal_price) === 0 ? [`💰 이번 예약은 무료예요 (${r.discount_note ?? "쿠폰"})`, ``]
        : r.pay_pass ? [`💰 ${Number(r.deal_price).toLocaleString()}원을 플레이앤 패스에서 차감했어요 (남은 잔액 ${Number(passLeft ?? 0).toLocaleString()}원)`, ``]
        : [`💰 ${Number(r.deal_price).toLocaleString()}원${r.discount_note ? ` (${r.discount_note})` : ""}`, ``, `아래 계좌로 입금해 주시면 예약이 완료돼요 (보증금은 입실 후 별도)`, (cfg.bank_account || ACCOUNT),
           ...(pay?.due_label ? [`입금자명: ${pay.pay_name} (예약자 이름 그대로)`, `입금 기한: ${pay.due_label}까지 · 지나면 예약이 자동 취소돼요`] : []), ``];
      const msg = st === "confirmed"
        ? [`[플레이앤 N CREW] ${r.name}님, ${head}이 확정됐어요 🎉`, `📅 ${r.branch} ${label(r.use_date)} ${p.n} (${p.t})${r.upgrade_full ? " · 통대관 업그레이드" : ""}`, `👥 ${r.people ?? 5}명${r.bbq_people == null ? "" : r.bbq_people > 0 ? ` · 🍖 바베큐 ${r.bbq_people}명 (인당 1만원, 퇴실 정산 때 별도)` : " · 바베큐 없음"}`, ...payLines, `이용 안내: ${GUIDE[r.branch]}`, `입실 전 1분 체크인 링크는 이용일 전에 문자로 따로 보내드려요.`, `문의: ${(cfg.host_phone || HOST)}`].join("\n")
        : [`[플레이앤 N CREW] ${r.name}님, 신청해 주셔서 감사해요.`, `아쉽게도 ${r.branch} ${label(r.use_date)} ${PK[r.pkg].n}은 먼저 예약이 들어와 마감됐어요 🙏`, r.coupon_id ? `쓰려던 쿠폰은 그대로 돌려드렸어요.` : `다음 공실 특가 때 다시 알려드릴게요!`].join("\n");
      // 확정된 홈페이지 예약도 예약 장부(playand_reservations)에 기록 → 안내문자·체크인·보증금 정산·후기·방문횟수·스클 자동막음까지 같은 흐름
      const rid = `site:${r.id}`;
      if (st === "confirmed") {
        const pk = r.upgrade_full ? "full" : r.pkg;
        const { data: ex } = await sb.from("playand_reservations").select("id,sms_status").eq("id", rid).maybeSingle();
        await sb.from("playand_reservations").upsert({ id: rid, branch: r.branch, pkg: pk, use_date: r.use_date, start_h: PK[pk].s, status: "confirmed",
          title: `플레이앤 홈페이지 ${head} ${PK[pk].n}`, guest_name: r.name, phone: fmtPhone(String(r.phone)), sources: ["site"],
          sms_status: ex?.sms_status ?? "pending", updated_at: new Date().toISOString() });
      } else {
        const { data: ex } = await sb.from("playand_reservations").select("id,status").eq("id", rid).maybeSingle();
        if (ex && ex.status !== "cancelled") {
          await sb.from("playand_reservations").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", rid);
          await sb.from("playand_blocks").delete().eq("reservation_id", rid).eq("status", "pending");
          await sb.from("playand_blocks").update({ status: "delete_pending", updated_at: new Date().toISOString() }).eq("reservation_id", rid).eq("status", "done").not("ext_id", "is", null);
        }
      }
      const sent = b.notify === false ? false : await sms(cfg, r.phone, msg);
      return J({ ok: true, status: st, sms: sent, preview: msg, pay });
    }
    // v17: 사장님 입금 확인(paid) / 미입금 취소(cancel) / 기한 연장(extend, 시간)
    if (b.action === "admin_pay") {
      const id = Number(b.id);
      if (b.op === "paid") { const { data } = await sb.rpc("playn_pay_mark", { p_id: id, p_how: "owner", p_deposit_id: b.deposit_id ? Number(b.deposit_id) : null }); return J(data ?? { ok: false }); }
      if (b.op === "extend") {
        const h = Math.max(1, Math.min(72, Number(b.hours) || 3));
        const { data: r } = await sb.from("playn_deal_requests").update({ pay_status: "waiting", pay_due: new Date(Date.now() + h * 3600e3).toISOString(), pay_reminded_at: new Date().toISOString() }).eq("id", id).eq("status", "confirmed").in("pay_status", ["waiting", "owner_check"]).select("id,pay_due").maybeSingle();
        return J(r ? { ok: true, pay_due: r.pay_due } : { ok: false, error: "입금 대기 중인 예약이 아니에요" });
      }
      if (b.op === "cancel") {
        const { data: r } = await sb.from("playn_deal_requests").update({ status: "unpaid", pay_status: "released", decided_at: new Date().toISOString() }).eq("id", id).eq("status", "confirmed").neq("pay_status", "paid").select("*").maybeSingle();
        if (!r) return J({ ok: false, error: "취소할 수 있는 예약이 아니에요 (입금 확인된 예약은 여기서 취소 안 돼요)" });
        if (r.coupon_id) await sb.from("playn_coupons").update({ status: "active", request_id: null }).eq("id", r.coupon_id);
        const rid = `site:${r.id}`;
        await sb.from("playand_reservations").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", rid).neq("status", "cancelled");
        await sb.from("playand_blocks").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("reservation_id", rid).eq("status", "pending");
        await sb.from("playand_blocks").update({ status: "delete_pending", updated_at: new Date().toISOString() }).eq("reservation_id", rid).eq("status", "done").not("ext_id", "is", null);
        const sent = b.notify === false ? false : await sms(cfg, r.phone, [`[플레이앤] ${r.name}님, 입금이 확인되지 않아 ${r.branch} ${label(r.use_date)} 예약이 취소됐어요.`, `다시 이용하시려면 playn.kr 에서 새로 신청해 주세요.`, r.coupon_id ? `쓰려던 쿠폰은 돌려드렸어요.` : ``].filter(Boolean).join("\n"));
        return J({ ok: true, sms: sent });
      }
      return J({ ok: false, error: "op를 확인해 주세요" });
    }
  }
  return J({ error: "unknown action" }, 400);
});
