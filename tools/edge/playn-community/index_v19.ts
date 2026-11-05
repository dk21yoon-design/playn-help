// playn-community: 홈페이지 참여 기능
// v19 (2026-11-05): 견적·신청에서 쓸 수 있는 할인권(won) 중 가장 유리한 것을 자동 적용 (coupon_id 비우면 자동, "none"이면 안 씀). 화면을 연 뒤 받은 쿠폰도 서버가 바로 읽어서 적용. 되돌리기: index_v18.ts
// v18 (2026-11-04): 예약 신청 사장님 문자를 '홈페이지 예약 신청 확인' 형식으로 정리 + 발송 결과 기록. 되돌리기: index_v17.ts
// - 다음 장비 투표
// - 플레이앤 리그 (명예의 전당)
// - N CREW 내 정보: 문자 인증 → 레벨·방문 수·업적 배지·친구 초대 코드·쿠폰(자동 발급)·VIP
// - 멤버 예약(홈페이지 전용 할인), 플레이앤 패스, 생일 (군인 인증은 playn-military)
// v17 (2026-11-02): 재방문권 90일·일~목 이용(공휴일·쉬는 날 전날 제외, perk_rules.revisit.weekday) + 방문 수를 playn_members.visits에 저장
// 되돌리기: 같은 폴더 index_v16.ts
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
// 월간 기어 입고 투표 (2026-10-17): 후보는 playand_config.gear_candidates(JSON), 표는 playn_gear_votes(월별 voter 접두어)
const GEAR_MIN = 10;
const monthKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const monthStartIso = () => new Date(monthKst() + "-01T00:00:00+09:00").toISOString();
function gearList(cfg: Record<string, string>): any[] { try { const v = JSON.parse(cfg.gear_candidates ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }
async function ipHash(req: Request, salt: string) { // 원래 IP는 저장하지 않음: 월마다 바뀌는 소금을 넣은 해시 앞 16자만
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "0";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + monthKst() + ":" + ip));
  return [...new Uint8Array(d)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function gearBoard(cfg: Record<string, string>) {
  const list = gearList(cfg), act = list.filter((c) => c.st === "active");
  const { data } = await sb.from("playn_gear_votes").select("item").gte("created_at", monthStartIso()).limit(20000);
  const count: Record<string, number> = Object.fromEntries(act.map((c) => [c.item, 0]));
  for (const r of data ?? []) if (r.item in count) count[r.item]++;
  return {
    month: monthKst(), min: GEAR_MIN,
    candidates: act.map((c) => ({ item: c.item, votes: count[c.item], cat: c.cat ?? null, reason: c.reason ?? null, user: c.src === "user", fresh: c.src === "user" && !!c.at && Date.now() - Date.parse(c.at) < 7 * 86400e3 })),
    bought: list.filter((c) => c.st === "bought").slice(-3).map((c) => ({ item: c.item, month: c.bm ?? null })),
  };
}
const BR = ["홍대루프탑점", "연남루프탑점", "연트럴파크점"];
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
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const rand = (n: number, set = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789") => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((x) => set[x % set.length]).join("");

async function cfgAll() {
  const { data } = await sb.from("playand_config").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
}
async function sms(cfg: Record<string, string>, to: string, msg: string) {
  if (!cfg.macrodroid_webhook) return false;
  const u = new URL(cfg.macrodroid_webhook);
  u.searchParams.set("phone", to); u.searchParams.set("msg", msg);
  try { return (await fetch(u.toString())).ok; } catch { return false; }
}

const fmtPhone = (d: string) => d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
const variants = (d: string) => [d, fmtPhone(d)]; // 예약 기록은 010-0000-0000, 멤버는 숫자만
const addMonths = (n: number) => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

// 업적 배지 정의 (예약 기록으로 자동 계산)
function badges(visits: { branch: string; pkg: string; use_date: string }[], m: any, league: number, refOk: number) {
  const out: { id: string; name: string; desc: string; got: boolean }[] = [];
  const branches = new Set(visits.map((v) => v.branch));
  const add = (id: string, name: string, desc: string, got: boolean) => out.push({ id, name, desc, got });
  add("first", "첫 입장", "플레이앤 첫 방문", visits.length >= 1);
  add("all3", "3개 지점 정복", "홍대·연남·연트럴 모두 방문", BR.every((b) => branches.has(b)));
  add("allday", "하루 종일", "통대관 패키지 이용", visits.some((v) => v.pkg === "full"));
  add("owl", "올빼미", "야간 패키지 3번", visits.filter((v) => v.pkg === "night").length >= 3);
  add("league", "리그 출전", "플레이앤 리그 기록 등록", league > 0);
  add("friend", "같이 가자", "초대한 친구가 첫 예약", refOk > 0);
  add("vip", "VIP", "초대한 친구들이 5번 이상 이용", !!m?.vip);
  add("military", "나라사랑 애국자", "군인 인증 완료", (Array.isArray(m?.badges) && m.badges.includes("military")) || !!m?.mil_until);
  return out;
}

// 방문 = 확정 예약 중 이용일이 지난 것 (같은 날 같은 지점은 1회)
async function visitsOf(phone: string) {
  const { data: rs } = await sb.from("playand_reservations").select("branch,pkg,use_date").in("phone", variants(phone)).eq("status", "confirmed").lte("use_date", kstToday());
  // 체크인 때 "같이 온 친구 번호"로 적힌 방문도 인정
  const { data: cs } = await sb.from("playn_settle").select("branch,pkg,use_date").in("status", ["checked_in", "submitted", "hold", "paid"]).lte("use_date", kstToday())
    .or(`checkin->>companions.ilike.*${phone}*,checkin->>companions.ilike.*${fmtPhone(phone)}*`);
  const all = [...(rs ?? []), ...(cs ?? [])];
  const seen = new Set<string>();
  return all.filter((r) => { const k = r.use_date + r.branch; if (seen.has(k)) return false; seen.add(k); return true; });
}
async function bookedOf(phone: string) {
  const { count } = await sb.from("playand_reservations").select("id", { count: "exact", head: true }).in("phone", variants(phone)).eq("status", "confirmed");
  return count ?? 0;
}

// 쿠폰 발급 (같은 사유로는 한 번만)
async function issue(cfg: Record<string, string>, phone: string, source: string, c: { kind: string; title: string; detail?: string; amount?: number; expires?: string }, notify = true) {
  const rules = JSON.parse(cfg.perk_rules ?? "{}");
  const { data, error } = await sb.from("playn_coupons").insert({ phone, source, kind: c.kind, title: c.title, detail: c.detail ?? null, amount: c.amount ?? null, expires_at: c.expires ?? addMonths(rules.coupon_months ?? 6) }).select("id").maybeSingle();
  if (error || !data) return false; // 이미 받음
  const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  // N CREW v1: 쿠폰은 그대로 지급, (광고) 문자는 광고 판단(동의·수신 거부·활성·08~21시)을 통과할 때만
  if (notify && h >= 8 && h < 21 && (await adOk(phone))) await sms(cfg, phone, await withFooter(`(광고)[플레이앤 N CREW] 🎁 ${c.title} 지급\n${c.detail ?? ""}\n내 쿠폰: https://playn.kr/me/\n수신거부: playn.kr 맨 아래`, phone));
  return true;
}
const addDaysStr = (s: string, n: number) => new Date(new Date(s + "T00:00:00Z").getTime() + n * 86400e3).toISOString().slice(0, 10);
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const extDetail = (h: number, fb: number) => `예약 입실 시간 전 또는 퇴실 시간 후로 ${h}시간. 사용하려면 호스트에게 미리 문자로 알려주세요. 앞뒤 예약 때문에 못 쓰면 그 예약 이용금액에서 ${fb.toLocaleString()}원 할인해 드려요.`;

const CREW_MIN = 30; // 50% 예약: 신청 후 30분 안에 전원 인증 못 하면 자동 취소
const crewDeadline = (ck: any) => new Date(new Date(ck.created_at).getTime() + CREW_MIN * 60e3);
// 50% 할인권 쓸 수 있는 날 (2026-10-15): 월~목 + 그날·다음날이 공휴일이 아님 (주말·공휴일·쉬는 날 전날 제외)
const HALF = ["night50", "wk50"];
function halfDayOk(cfg: Record<string, string>, date: string) {
  const hol = new Set<string>(JSON.parse(cfg.holidays ?? "[]"));
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  return dow >= 1 && dow <= 4 && !hol.has(date) && !hol.has(addDaysStr(date, 1));
}
// 재방문권 쓸 수 있는 날 (v17): 일~목 + 그날·다음날이 공휴일이 아님 (금·토·공휴일·쉬는 날 전날 제외)
function revisitDayOk(cfg: Record<string, string>, date: string) {
  const hol = new Set<string>(JSON.parse(cfg.holidays ?? "[]"));
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  return dow >= 0 && dow <= 4 && !hol.has(date) && !hol.has(addDaysStr(date, 1));
}
const REVISIT_DAYS_TXT = "일~목 이용 예약에 쓸 수 있어요 (금·토·공휴일·쉬는 날 전날 제외)";
const mondayOf = (d: string) => { const t = new Date(d + "T00:00:00Z"); const w = (t.getUTCDay() + 6) % 7; return addDaysStr(d, -w); };
const bbqStamp = (rules: any) => ({ every: Number(rules.bbq_stamp?.every ?? 3), people: Number(rules.bbq_stamp?.people ?? 5) });
// 레벨·친구 초대·VIP 보상 자동 정리
async function syncRewards(cfg: Record<string, string>, m: any, visits: any[]) {
  const rules = JSON.parse(cfg.perk_rules ?? "{}"), fb = rules.ext_fallback ?? 40000;
  const levels = JSON.parse(cfg.crew_levels ?? "[]");
  for (const l of levels) if (l.coupon && visits.length >= l.min) {
    const c = { ...l.coupon };
    if (c.kind === "ext3") c.detail = extDetail(3, fb);
    await issue(cfg, m.phone, "level" + l.lv, c);
  }
  // 레전드 주간 쿠폰: 매주(월요일 기준) 1장
  for (const l of levels) if (l.weekly && visits.length >= l.min) {
    const mon = mondayOf(kstToday());
    await issue(cfg, m.phone, `weekly${l.lv}:${mon}`, { kind: l.weekly.kind, title: l.weekly.title, detail: l.weekly.detail, expires: addDaysStr(kstToday(), (l.weekly.days ?? 14) - 1) });
  }
  // 내가 초대받은 경우: 내 첫 예약이 확정되면 나와 초대한 사람 모두 2시간 연장권
  const ext2 = { kind: "ext2", title: "2시간 연장권 (친구 초대)", detail: extDetail(2, fb) };
  if (m.referred_by && (await bookedOf(m.phone)) > 0) {
    const { data: inv } = await sb.from("playn_members").select("phone").eq("ref_code", m.referred_by).maybeSingle();
    await issue(cfg, m.phone, "ref_in", ext2);
    if (inv) await issue(cfg, inv.phone, "ref_out:" + m.phone, ext2);
    if (!m.ref_rewarded) await sb.from("playn_members").update({ ref_rewarded: true }).eq("phone", m.phone);
  }
  // 내가 초대한 친구들
  const { data: friends } = m.ref_code ? await sb.from("playn_members").select("phone,ref_rewarded").eq("referred_by", m.ref_code) : { data: [] as any[] };
  let friendVisits = 0, okCount = 0;
  for (const f of friends ?? []) {
    if ((await bookedOf(f.phone)) > 0) {
      okCount++;
      await issue(cfg, m.phone, "ref_out:" + f.phone, ext2);
      await issue(cfg, f.phone, "ref_in", ext2);
      if (!f.ref_rewarded) await sb.from("playn_members").update({ ref_rewarded: true }).eq("phone", f.phone);
    }
    friendVisits += (await visitsOf(f.phone)).length;
  }
  // 크루장: 같은 날 내 초대 코드로 N명 이상 가입
  if (m.ref_code) {
    const { data: fr } = await sb.from("playn_members").select("created_at").eq("referred_by", m.ref_code);
    const byDay: Record<string, number> = {};
    for (const f of fr ?? []) { const d = kstDate(f.created_at); byDay[d] = (byDay[d] ?? 0) + 1; }
    for (const [d, n] of Object.entries(byDay)) if (n >= (rules.crew_leader?.count ?? 3))
      await issue(cfg, m.phone, "crew:" + d, { kind: "service", title: "크루장 보상", detail: `같이 온 친구 ${n}명이 N CREW에 가입했어요. 음료 4병 + 다음 방문 1시간 연장권.` });
  }
  // 3개 지점 정복
  if (BR.every((b) => visits.some((v) => v.branch === b)))
    await issue(cfg, m.phone, "all3", { kind: "won", title: `3개 지점 정복 ${Number(rules.all3?.amount ?? 50000).toLocaleString()}원 할인권`, detail: "홍대·연남·연트럴을 모두 와주셔서 감사해요. 홈페이지 예약 1건에 쓸 수 있어요.", amount: rules.all3?.amount ?? 50000 });
  // 평일 주간 스탬프: 평일 주간 N번마다 1번 무료
  const every = rules.day_stamp?.every ?? 3;
  const dayVisits = visits.filter((v) => v.pkg === "day" && [1, 2, 3, 4, 5].includes(new Date(v.use_date + "T00:00:00Z").getUTCDay())).length;
  for (let k = 1; k <= Math.floor(dayVisits / every); k++)
    await issue(cfg, m.phone, "daystamp:" + k, { kind: "day_free", title: "평일 주간 무료권", detail: `평일 주간 ${every}번 이용 스탬프 완성! 평일 주간 패키지 1번 무료.` });
  // N CREW 스탬프 (2026-10-12): 아무 지점 N번 방문마다 테라스 바베큐 M인분 무료권 (퇴실 정산에서 자동 차감)
  const bs = bbqStamp(rules);
  for (let k = 1; k <= Math.floor(visits.length / bs.every); k++)
    await issue(cfg, m.phone, "bbqstamp:" + k, { kind: "bbq", title: `테라스 바베큐 ${bs.people}인분 무료권`, detail: `N CREW 스탬프 ${bs.every}개 완성! 바베큐(장작·숯·불판) ${bs.people}인분 무료. 체크인 때 '바베큐 사용'을 고르면 퇴실 정산에서 자동으로 빠져요. ${bs.people + 1}번째 분부터는 1인 1만원.` });
  // 재방문권 (v17): 마지막 방문일부터 rd일(기본 90일), weekday면 일~목 이용만
  const last = visits.map((v) => v.use_date).sort().pop();
  const rd = rules.revisit?.days ?? 90;
  if (last && kstToday() <= addDaysStr(last, rd))
    await issue(cfg, m.phone, "revisit:" + last, { kind: "won", title: `재방문 ${Number(rules.revisit?.amount ?? 30000).toLocaleString()}원 할인권`, detail: `${addDaysStr(last, rd)}까지 홈페이지에서 예약할 때 쓸 수 있어요. ${rules.revisit?.weekday ? REVISIT_DAYS_TXT : "요일 상관없이 쓸 수 있어요"}.`, amount: rules.revisit?.amount ?? 30000, expires: addDaysStr(last, rd) });
  // 생일 주간 (생일 2주 전부터 지급, 생일 1주 뒤까지)
  if (/^\d{2}-\d{2}$/.test(m.birthday ?? "")) {
    const t = kstToday(), y = Number(t.slice(0, 4));
    for (const yy of [y, y + 1]) {
      const bd = `${yy}-${m.birthday}`;
      if (t >= addDaysStr(bd, -14) && t <= addDaysStr(bd, 7))
        await issue(cfg, m.phone, "bday:" + yy, { kind: "won", title: `생일 ${Number(rules.birthday?.amount ?? 30000).toLocaleString()}원 할인권`, detail: `생일 축하해요! ${addDaysStr(bd, 7)}까지 이용하는 예약에 쓸 수 있어요. 케이크 냉장 보관·초 준비도 말씀만 주세요.`, amount: rules.birthday?.amount ?? 30000, expires: addDaysStr(bd, 7) });
    }
  }
  const need = rules.vip?.friend_visits ?? 5;
  if (friendVisits >= need && !m.vip) {
    await sb.from("playn_members").update({ vip: true, vip_at: new Date().toISOString() }).eq("phone", m.phone);
    m.vip = true;
    await issue(cfg, m.phone, "vip", { kind: "won", title: `VIP ${Number(rules.vip?.coupon ?? 100000).toLocaleString()}원 할인권`, detail: `초대한 친구들이 ${need}번 이상 이용해서 VIP가 됐어요. 요일 상관없이 예약 1건에 쓸 수 있고, 앞으로 모든 예약이 ${rules.vip?.rate ?? 10}% 할인돼요.`, amount: rules.vip?.coupon ?? 100000 });
  }
  return { friends: (friends ?? []).length, okCount, friendVisits };
}

async function profile(phone: string, cfg: Record<string, string>) {
  const { data: m } = await sb.from("playn_members").select("*").eq("phone", phone).maybeSingle();
  if (!m) return null;
  if (!m.ref_code) {
    for (let i = 0; i < 5; i++) {
      const code = "N" + rand(5);
      const { error } = await sb.from("playn_members").update({ ref_code: code }).eq("phone", phone);
      if (!error) { m.ref_code = code; break; }
    }
  }
  const visits = await visitsOf(phone);
  // v17: 관제실·대시보드가 바로 읽도록 방문 수를 회원 표에 저장 (매일 admin_sync_all + 내 정보 열 때)
  if ((m.visits ?? 0) !== visits.length) await sb.from("playn_members").update({ visits: visits.length }).eq("phone", phone);
  const { count: league } = await sb.from("playn_league").select("id", { count: "exact", head: true }).ilike("members", `%${phone}%`);
  const rw = await syncRewards(cfg, m, visits);
  const rules = JSON.parse(cfg.perk_rules ?? "{}");
  const levels = JSON.parse(cfg.crew_levels ?? "[]");
  let lv = levels[0];
  for (const l of levels) if (visits.length >= l.min) lv = l;
  const next = levels.find((l: any) => l.min > visits.length) ?? null;
  const rate = Math.max(lv?.rate ?? 0, m.vip ? (rules.vip?.rate ?? 10) : 0);
  const { data: coupons } = await sb.from("playn_coupons").select("id,kind,title,detail,amount,status,issued_at,expires_at,used_at").eq("phone", phone).order("issued_at", { ascending: false }).limit(40);
  const { data: led } = await sb.from("playn_pass_ledger").select("delta").eq("phone", phone);
  const { data: mil } = await sb.from("playn_military").select("status,note,created_at").eq("phone", phone).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return {
    name: m.name, since: m.created_at?.slice(0, 10), visits: visits.length, level: lv, next, levels, vip: !!m.vip, rate,
    deal: Number(cfg.deal_discount ?? 20), deal_today: Number(cfg.deal_discount_today ?? 35),
    badges: badges(visits, m, league ?? 0, rw.okCount), coupons: coupons ?? [], stack: rules.stack,
    vip_need: rules.vip?.friend_visits ?? 5, friend_visits: rw.friendVisits,
    ref_code: m.ref_code, invited: rw.friends, invited_ok: rw.okCount, referral_reward: cfg.referral_reward,
    pass_balance: (led ?? []).reduce((a, x) => a + x.delta, 0), pass: rules.pass ?? null,
    birthday: m.birthday ?? null,
    stamp: (() => { const bs = bbqStamp(rules); return { every: bs.every, people: bs.people, have: visits.length % bs.every, done: Math.floor(visits.length / bs.every) }; })(),
    military: { status: m.mil_until ? (m.mil_until >= kstToday() ? "approved" : "ended") : (mil?.status ?? "none"), until: m.mil_until ?? null, note: mil?.status === "rejected" ? mil.note : null },
  };
}

// 멤버 예약 견적: 할인은 1개만 (쿠폰 또는 할인율 중 고른 것)
const SITE = Deno.env.get("SUPABASE_URL") + "/functions/v1/playn-site";
async function sessionPhone(token: unknown) {
  const { data: s } = await sb.from("playn_sessions").select("phone,expires_at").eq("token", String(token ?? "")).maybeSingle();
  return s && new Date(s.expires_at) >= new Date() ? s.phone : null;
}
async function quote(cfg: Record<string, string>, phone: string, b: any): Promise<any> {
  const noCoupon = b.coupon_id === "none"; // v19: 손님이 '쿠폰 쓰지 않기'를 고른 경우만 자동 적용 안 함
  if (noCoupon) b = { ...b, coupon_id: null };
  const pr: any = await profile(phone, cfg);
  if (!pr) return { ok: false, error: "N CREW 멤버가 아니에요" };
  const sl = await (await fetch(SITE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "slot", date: b.date, branch: b.branch, pkg: b.pkg }) })).json();
  if (!sl.ok) return sl;
  if (!sl.regular) return { ok: false, error: "가격을 확인할 수 없어요. 호스트에게 문의해 주세요" };
  const people = Math.max(1, Math.min(30, Number(b.people) || 5));
  const extra = Math.max(0, people - 5) * 20000;
  const base = sl.regular;
  const rate = Math.max(sl.deal_rate, pr.rate);
  const round = (n: number) => Math.round(n / 1000) * 1000;
  // v17: 재방문권 요일 제한 (source는 손님 화면에 내보내지 않고 여기서만 읽음)
  const pRules = JSON.parse(cfg.perk_rules ?? "{}");
  const wonIds = pr.coupons.filter((c: any) => c.kind === "won").map((c: any) => c.id);
  const { data: srcs } = wonIds.length ? await sb.from("playn_coupons").select("id,source").in("id", wonIds) : { data: [] as any[] };
  const isRevisit = new Set((srcs ?? []).filter((x: any) => String(x.source ?? "").startsWith("revisit:")).map((x: any) => String(x.id)));
  const dayBlocked = (c: any) => !!pRules.revisit?.weekday && isRevisit.has(String(c.id)) && !revisitDayOk(cfg, String(b.date));
  // 할인 규칙 (2026-10-15): 예약 금액 할인은 최대 50% · 금·토(이용일 기준)는 가장 큰 할인 1개만, 일~목은 특가/VIP + 할인권 1장까지 같이 (합쳐서 50%까지)
  const dowD = new Date(String(b.date) + "T00:00:00Z").getUTCDay(), friSat = dowD === 5 || dowD === 6;
  const CAP = 0.5;
  const rateDisc = round(base * rate / 100), rateNote = rate ? `${rate}% 할인 (${rate === sl.deal_rate && sl.deal_rate ? (sl.deal_rate > 20 ? "당일 특가" : "빈자리 특가") : "VIP"})` : "";
  let price = base - Math.min(rateDisc, round(base * CAP)), note = rateNote || "정가";
  let upgrade = false, coupon: any = null;
  if (b.coupon_id) {
    coupon = pr.coupons.find((c: any) => String(c.id) === String(b.coupon_id) && c.status === "active");
    if (!coupon) return { ok: false, error: "쓸 수 있는 쿠폰이 아니에요" };
    if (coupon.expires_at && coupon.expires_at < kstToday()) return { ok: false, error: "기간이 지난 쿠폰이에요" };
    if (dayBlocked(coupon)) return { ok: false, error: "재방문 할인권은 " + REVISIT_DAYS_TXT };
    const weekend = [5, 6].includes(sl.dow);
    let cDisc = -1; // -1 = 무료권(상한 예외)
    if (coupon.kind === "won") cDisc = Number(coupon.amount) || 0;
    else if (coupon.kind === "full_free") {
      if (b.pkg === "full" && !weekend) { price = 0; note = coupon.title; }
      else if (b.pkg === "night" && weekend) { if (!sl.full_free) return { ok: false, error: "그날은 앞 예약 때문에 통대관 업그레이드가 어려워요. 다른 날짜를 골라주세요" }; price = base; upgrade = true; note = "금·토 야간 → 통대관 무료 업그레이드"; }
      else return { ok: false, error: "통대관 무료권은 일~목 통대관, 또는 금·토 야간(통대관 업그레이드)에 쓸 수 있어요" };
    } else if (HALF.includes(coupon.kind)) {
      if (coupon.kind === "night50" && b.pkg !== "night") return { ok: false, error: "평일 나이트 50% 할인권은 야간 패키지에만 쓸 수 있어요" };
      if (!halfDayOk(cfg, b.date)) return { ok: false, error: "50% 할인권은 월~목만 쓸 수 있어요 (공휴일·주말과 쉬는 날 전날 제외)" };
      cDisc = round(base * 0.5);
    } else if (coupon.kind === "day_free") {
      if (b.pkg === "day" && sl.dow >= 1 && sl.dow <= 5) { price = 0; note = coupon.title; }
      else return { ok: false, error: "평일 주간 무료권은 월~금 주간 패키지에만 쓸 수 있어요" };
    } else return { ok: false, error: "이 쿠폰은 입실할 때 호스트에게 말씀해 주세요 (서비스 쿠폰)" };
    if (cDisc >= 0) {
      const cap = round(base * CAP);
      if (friSat) { // 금·토: 큰 할인 하나만
        const d = Math.max(rateDisc, cDisc);
        price = base - Math.min(d, cap);
        note = (cDisc >= rateDisc ? coupon.title : rateNote + ` (금·토는 할인 1개만 · ${coupon.title}보다 커서 이걸로 적용)`) + (d > cap ? " · 최대 50%" : "");
        if (cDisc < rateDisc) coupon = null; // 쿠폰은 안 쓰고 돌려줌
      } else {
        const d = rateDisc + cDisc;
        price = base - Math.min(d, cap);
        note = [rateNote, coupon.title].filter(Boolean).join(" + ") + (d > cap ? " · 최대 50%까지" : "");
      }
    }
  }
  const total = price + extra;
  // 쿠폰을 안 골랐을 때 더 유리한 쿠폰이 있으면 알려주기
  let better = null;
  if (!b.coupon_id) for (const c of pr.coupons.filter((c: any) => c.status === "active" && c.kind === "won" && (!c.expires_at || c.expires_at >= kstToday()) && !dayBlocked(c))) {
    const d = friSat ? Math.max(rateDisc, c.amount) : rateDisc + c.amount;
    if (base - Math.min(d, round(base * CAP)) < price && (!better || c.amount > better.amount)) better = { id: c.id, title: c.title, amount: c.amount };
  }
  // v19: 쿠폰을 안 골랐으면 더 유리한 할인권을 자동으로 적용 (화면 '가장 큰 할인 자동 적용'과 같게)
  if (better && !noCoupon && !b._auto) {
    const auto = await quote(cfg, phone, { ...b, coupon_id: better.id, _auto: true });
    if (auto.ok) return { ...auto, auto_coupon: { id: better.id, title: better.title } };
  }
  return { ok: true, free: sl.free, label: sl.label, pkg_name: sl.pkg_name, time: sl.time, regular: base + extra, price: total, extra, note, upgrade, coupon_id: coupon?.id ?? null, better, pass_balance: pr.pass_balance, name: pr.name, crew_need: coupon && HALF.includes(coupon.kind) ? people : 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.has("league")) {
      const cfg = await cfgAll();
      const rules = JSON.parse(cfg.league_rules ?? "{}");
      const season = url.searchParams.get("season") || rules.season;
      const { data } = await sb.from("playn_league").select("id,season,branch,team,streak,play_date").eq("season", season).order("streak", { ascending: false }).order("play_date", { ascending: true }).limit(100);
      const { data: seasons } = await sb.from("playn_league").select("season");
      const { data: hof } = await sb.from("playn_league").select("season,branch,team,streak,play_date").order("streak", { ascending: false }).limit(10);
      return J({ season, rules, records: data ?? [], seasons: [...new Set([rules.season, ...(seasons ?? []).map((s) => s.season)])].sort().reverse(), hall: hof ?? [] });
    }
    return J(await gearBoard(await cfgAll()));
  }
  let b: any;
  try { b = await req.json(); } catch { return J({ error: "bad json" }, 400); }

  if (b.action === "vote") { // 월간 기어 입고 투표 (2026-10-17): 장비당 기기 1표/월 + 같은 인터넷 하루 5표까지
    const cfg = await cfgAll();
    const list = gearList(cfg);
    if (!list.some((c) => c.item === b.item && c.st === "active")) return J({ ok: false, error: "후보에 없는 장비예요" });
    const voter = String(b.voter ?? "").slice(0, 40);
    if (voter.length < 8) return J({ ok: false, error: "다시 시도해 주세요" });
    const ih = await ipHash(req, cfg.gear_salt ?? "");
    const { count } = await sb.from("playand_log").select("id", { count: "exact", head: true }).eq("source", "gear_vote").gte("at", new Date(Date.now() - 86400e3).toISOString()).contains("payload", { ip: ih, item: b.item });
    if ((count ?? 0) >= 5) return J({ ok: false, error: "같은 인터넷에서 이 장비에 오늘 투표가 너무 많아요. 내일 다시 눌러 주세요" });
    const { error } = await sb.from("playn_gear_votes").insert({ item: b.item, voter: monthKst() + ":" + voter });
    if (!error) await sb.from("playand_log").insert({ source: "gear_vote", payload: { ip: ih, item: b.item } });
    const bd = await gearBoard(cfg);
    return J({ ok: !error, already: !!error, votes: bd.candidates.find((c: any) => c.item === b.item)?.votes ?? null });
  }
  if (b.action === "gear_propose") { // 내가 쓰고 싶은 장비 직접 신청 → 바로 후보 등록 + 내 1표
    const cfg = await cfgAll();
    const name = String(b.item ?? "").replace(/\s+/g, " ").trim(), reason = String(b.reason ?? "").replace(/\s+/g, " ").trim();
    const voter = String(b.voter ?? "").slice(0, 40);
    if (voter.length < 8) return J({ ok: false, error: "다시 시도해 주세요" });
    if (name.length < 3 || name.length > 40) return J({ ok: false, error: "모델명은 3~40자로 적어 주세요" });
    if (reason.length > 60) return J({ ok: false, error: "이유는 60자 안으로 적어 주세요" });
    const all = name + " " + reason;
    if (/https?:|www\.|\.(com|kr|net|io)\b|@|01[016789][-\s]?\d{3,4}[-\s]?\d{4}/i.test(all)) return J({ ok: false, error: "링크나 연락처는 적을 수 없어요" });
    if (/(시발|씨발|ㅅㅂ|병신|섹스|도박|카지노|토토|대출|바카라)/.test(all)) return J({ ok: false, error: "적을 수 없는 단어가 들어 있어요" });
    const cat = ["mouse", "keyboard", "headset", "monitor", "etc"].includes(b.cat) ? b.cat : "etc";
    const ih = await ipHash(req, cfg.gear_salt ?? "");
    const { data: recent } = await sb.from("playand_log").select("payload").eq("source", "gear_propose").gte("at", new Date(Date.now() - 86400e3).toISOString());
    if ((recent ?? []).some((r: any) => r.payload?.voter === voter)) return J({ ok: false, error: "직접 신청은 하루에 한 번만 할 수 있어요" });
    if ((recent ?? []).filter((r: any) => r.payload?.ip === ih).length >= 3) return J({ ok: false, error: "같은 인터넷에서 오늘 신청이 많았어요. 내일 다시 해주세요" });
    const list = gearList(cfg);
    const norm = (x: string) => x.toLowerCase().replace(/[\s()\[\]\-·_.,]/g, "");
    const n = norm(name);
    const dup = list.find((c) => norm(c.item) === n || (n.length >= 6 && norm(c.item).includes(n)));
    if (dup && dup.st === "bought") return J({ ok: false, error: "이미 들여놓은 장비예요. 지점에서 써보세요!" });
    if (dup && dup.st !== "active") return J({ ok: false, error: "지금은 받을 수 없는 후보예요" });
    if (!dup && list.filter((c) => c.st === "active").length >= 30) return J({ ok: false, error: "이번 달 후보가 꽉 찼어요. 지금 있는 후보에 투표해 주세요" });
    const item = dup ? dup.item : name;
    if (!dup) {
      list.push({ item, cat, reason: reason || null, src: "user", st: "active", at: new Date().toISOString() });
      await sb.from("playand_config").update({ value: JSON.stringify(list) }).eq("key", "gear_candidates");
      await sb.from("hq_activity").insert({ who: "방문자", brand: "playn", text: `기어 입고 투표 새 후보 신청: ${item}${reason ? " · " + reason : ""}`, dedupe_key: "gearprop:" + Date.now() });
    }
    await sb.from("playand_log").insert({ source: "gear_propose", payload: { voter, ip: ih, item } });
    const { error } = await sb.from("playn_gear_votes").insert({ item, voter: monthKst() + ":" + voter });
    if (!error) await sb.from("playand_log").insert({ source: "gear_vote", payload: { ip: ih, item } });
    return J({ ok: true, item, existed: !!dup, voted: !error, ...(await gearBoard(await cfgAll())) });
  }

  // 문자 인증번호 보내기 (가입한 번호만). N CREW v1: 로그인 용도 번호, 발급 한도·5회 제한·1회 사용은 DB 함수
  if (b.action === "otp_send") {
    const phone = normPhone(b.phone);
    if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const { data: okm } = await sb.rpc("playn_member_ok", { p_phone: phone });
    if (okm !== true) return J({ ok: false, need_join: true, error: "N CREW 멤버가 아니에요. 먼저 가입해 주세요" });
    const { data: r, error } = await sb.rpc("member_otp_issue", { p_phone: phone, p_purpose: "login", p_ip_hash: await otpIpHash(req) });
    if (error || !r?.ok) return J({ ok: false, error: r?.error ?? "잠시 후 다시 시도해 주세요" });
    const cfg = await cfgAll();
    const sent = await sms(cfg, phone, `[플레이앤 N CREW] 인증번호 ${r.code} (5분 안에 입력해 주세요)`);
    return J({ ok: sent, error: sent ? undefined : "문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요" });
  }
  if (b.action === "otp_verify") {
    const phone = normPhone(b.phone);
    if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const { data: r, error } = await sb.rpc("member_otp_login", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12) });
    if (error) return J({ ok: false, error: "로그인을 마치지 못했어요. 잠시 후 다시 해 주세요" });
    if (!r?.ok || typeof r.token !== "string") return J({ ok: false, need_join: r?.need_join, error: r?.error ?? "인증번호가 맞지 않거나 시간이 지났어요", left: r?.left });
    return J({ ok: true, token: r.token });
  }
  if (b.action === "me") {
    const { data: s } = await sb.from("playn_sessions").select("phone,expires_at").eq("token", String(b.token ?? "")).maybeSingle();
    if (!s || new Date(s.expires_at) < new Date()) return J({ ok: false, expired: true });
    const p = await profile(s.phone, await cfgAll());
    if (!p) return J({ ok: false, expired: true });
    const { data: ad } = await sb.rpc("playn_ad_state", { p_phone: s.phone }); // 광고 알림 상태 (v1d)
    return J({ ok: true, ...p, ad: ad ?? null });
  }
  // 광고 알림 끄기 (v1d): 로그인 세션으로만 본인 확인. 본문의 번호는 쓰지 않음. 광고·야간 동의만 끄고 회원 자격·예약·혜택은 그대로
  if (b.action === "ad_off") {
    const { data: r, error } = await sb.rpc("playn_self_optout", { p_token: String(b.token ?? "").slice(0, 80) });
    if (error || !r) return J({ ok: false, error: "처리하지 못했어요. 잠시 후 다시 해 주세요" });
    return J(r);
  }
  if (b.action === "quote" || b.action === "member_request") {
    const phone = await sessionPhone(b.token);
    if (!phone) return J({ ok: false, expired: true, error: "다시 로그인해 주세요" });
    const cfg = await cfgAll();
    const q: any = await quote(cfg, phone, b);
    if (!q.ok || b.action === "quote") return J(q);
    if (!q.free) return J({ ok: false, error: "그 시간은 이미 예약이 있어요. 다른 날짜나 패키지를 골라주세요" });
    if (b.pay_pass && q.pass_balance < q.price) return J({ ok: false, error: `패스 잔액이 부족해요 (잔액 ${q.pass_balance.toLocaleString()}원)` });
    const since = new Date(Date.now() - 86400e3).toISOString();
    const { count } = await sb.from("playn_deal_requests").select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since);
    if ((count ?? 0) >= 3) return J({ ok: false, error: "하루 신청은 3건까지예요. 호스트에게 문의해 주세요" });
    const people = Math.max(1, Math.min(30, Number(b.people) || 5));
    const { data: ins, error } = await sb.from("playn_deal_requests").insert({ kind: "member", phone, name: q.name, branch: b.branch, use_date: b.date, pkg: b.pkg, regular_price: q.regular, deal_price: q.price, people, memo: String(b.memo ?? "").slice(0, 200), coupon_id: q.coupon_id, discount_note: q.note, pay_pass: !!b.pay_pass, upgrade_full: q.upgrade }).select("id").single();
    if (error) return J({ ok: false, error: "신청을 저장하지 못했어요. 잠시 후 다시 해주세요" });
    if (q.coupon_id) await sb.from("playn_coupons").update({ status: "held", request_id: ins.id }).eq("id", q.coupon_id);
    let crew: any = null;
    if (q.crew_need > 0) { // 50% 할인권: 이용 인원 전원 N CREW 인증해야 확정
      const code = rand(8);
      await sb.from("playn_crew_checks").insert({ request_id: ins.id, code, leader: phone, need: q.crew_need, phones: [phone], names: [q.name] });
      crew = { code, need: q.crew_need, have: 1, link: `https://playn.kr/crew/?g=${code}`, minutes: CREW_MIN, expires_at: new Date(Date.now() + CREW_MIN * 60e3).toISOString() };
    }
    // v18: 사장님 문자를 "홈페이지 예약 신청 확인" 한눈에 보이게 (누가·언제·어디·얼마·할 일)
    const ownerMsg = [
      `🔔 홈페이지 예약 신청 들어왔어요 (#${ins.id})`,
      `확인 후 확정해 주세요`,
      ``,
      `👤 ${q.name} · ${fmtPhone(phone)}`,
      `📍 ${b.branch}`,
      `📅 ${q.label} ${q.upgrade ? "통대관(업그레이드)" : q.pkg_name}${q.time ? ` ${q.upgrade ? "12:00 ~ 익일 10:00" : q.time}` : ""}`,
      `👥 ${people}명`,
      `💰 ${Number(q.price).toLocaleString()}원${q.note ? ` (${q.note})` : ""}${b.pay_pass ? " · 패스 결제(입금 불필요)" : Number(q.price) === 0 ? " · 무료(입금 불필요)" : ""}`,
      ...(String(b.memo ?? "").trim() ? [`📝 ${String(b.memo).trim().slice(0, 80)}`] : []),
      ...(crew ? [`⏳ 같이 오는 인원 N CREW 인증 대기 1/${crew.need} · 다 되면 다시 문자 드려요`] : []),
      ``,
      `➡ 확정·마감: playn.kr/admin.html`,
      b.pay_pass || Number(q.price) === 0 ? `확정 누르면 손님께 확정 문자가 가요` : `확정 누르면 손님께 금액·계좌 문자가 가요. 입금 받으시면 같은 화면에서 [입금 확인]`,
    ].join("\n");
    const okSent = await sms(cfg, cfg.owner_phone, ownerMsg);
    await sb.from("playand_log").insert({ source: "site_request_owner_sms", payload: { request: ins.id, sent: okSent } });
    if (crew) await sms(cfg, phone, `[플레이앤 N CREW] 50% 할인 예약 신청 완료!\n같이 오는 ${crew.need - 1}명도 ${CREW_MIN}분 안에 이 링크에서 N CREW 인증을 마쳐야 해요. 시간 안에 못 하면 신청이 자동 취소되고 할인권은 돌아와요 (지금 1/${crew.need})\n${crew.link}`);
    return J({ ok: true, id: ins.id, ...q, crew });
  }
  if (b.action === "set_birthday") {
    const phone = await sessionPhone(b.token);
    if (!phone) return J({ ok: false, expired: true });
    const v = String(b.birthday ?? "");
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) return J({ ok: false, error: "월-일을 확인해 주세요 (예: 03-15)" });
    const { data: m } = await sb.from("playn_members").select("birthday").eq("phone", phone).maybeSingle();
    if (m?.birthday) return J({ ok: false, error: "생일은 한 번만 등록할 수 있어요. 바꾸려면 호스트에게 문의해 주세요" });
    await sb.from("playn_members").update({ birthday: v }).eq("phone", phone);
    return J({ ok: true });
  }
  // 가입 직후 친구 초대 코드 연결: 가입 때 받은 1회용 표(10분)가 있어야 함 (N CREW v1, 번호만으로는 불가)
  if (b.action === "ref_attach") {
    const phone = normPhone(b.phone), code = String(b.ref ?? "").trim().toUpperCase();
    if (!phone) return J({ ok: false });
    const { data: r } = await sb.rpc("playn_ref_attach", { p_phone: phone, p_code: code, p_ticket: String(b.ticket ?? "").slice(0, 64) });
    return J({ ok: r?.ok === true });
  }

  // ── 50% 할인 예약: 같이 오는 사람 전원 N CREW 인증 ──
  if (b.action === "crew_status" || b.action === "crew_otp" || b.action === "crew_verify") {
    const code = String(b.g ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    const { data: ck } = await sb.from("playn_crew_checks").select("*").eq("code", code).maybeSingle();
    if (!ck) return J({ ok: false, error: "링크가 올바르지 않아요" });
    const { data: rq } = await sb.from("playn_deal_requests").select("branch,use_date,pkg,status,name").eq("id", ck.request_id).maybeSingle();
    const mask = (n: string) => n.length <= 1 ? n : n.length === 2 ? n[0] + "*" : n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
    const pub = () => ({ ok: true, need: ck.need, have: ck.phones.length, done: !!ck.done_at, names: ck.names.map(mask), leader: mask(rq?.name ?? ""), branch: rq?.branch, date: rq?.use_date, pkg: rq?.pkg, closed: !rq || !["pending", "confirmed"].includes(rq.status), expires_at: crewDeadline(ck).toISOString(), expired: rq?.status === "expired" || (!ck.done_at && Date.now() > crewDeadline(ck).getTime()) });
    if (b.action === "crew_status") return J(pub());
    if (!rq || rq.status !== "pending") return J({ ok: false, error: "이미 마감되거나 정리된 예약이에요" });
    if (!ck.done_at && Date.now() > crewDeadline(ck).getTime()) return J({ ok: false, error: `신청 후 ${CREW_MIN}분이 지나서 인증할 수 없어요. 대표자가 다시 신청해 주세요` });
    const phone = normPhone(b.phone);
    if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    if (ck.phones.includes(phone)) return J({ ...pub(), already: true });
    if (ck.phones.length >= ck.need) return J({ ok: false, error: "인원만큼 인증이 다 끝났어요" });
    if (b.action === "crew_otp") {
      const { data: r, error } = await sb.rpc("member_otp_issue", { p_phone: phone, p_purpose: "crew", p_ip_hash: await otpIpHash(req) });
      if (error || !r?.ok) return J({ ok: false, error: r?.error ?? "잠시 후 다시 시도해 주세요" });
      const cfg = await cfgAll();
      const sent = await sms(cfg, phone, `[플레이앤 N CREW] 인증번호 ${r.code} (5분 안에 입력해 주세요)`);
      return J({ ok: sent, error: sent ? undefined : "문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요" });
    }
    // crew_verify
    const name = String(b.name ?? "").trim().slice(0, 20);
    if (!name) return J({ ok: false, error: "이름을 적어 주세요" });
    if (!b.agree) return J({ ok: false, error: "N CREW 가입 동의가 필요해요" });
    const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "crew" });
    if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호가 맞지 않거나 시간이 지났어요" });
    const now = new Date().toISOString();
    const { data: ex } = await sb.from("playn_members").select("phone,status").eq("phone", phone).maybeSingle();
    if (!ex || ex.status !== "active") await sb.rpc("playn_member_join", { p_phone: phone, p_name: name, p_source: "crew_check", p_branch: null, p_marketing: b.marketing === true, p_night: b.night_agree === true }); // 광고 동의 별도·기본 꺼짐 (v1c)
    // 동시 인증 대비: 최신 상태 다시 읽고 추가
    const { data: cur } = await sb.from("playn_crew_checks").select("phones,names,need").eq("code", code).single();
    if (!cur.phones.includes(phone) && cur.phones.length < cur.need) {
      const phones = [...cur.phones, phone], names = [...cur.names, name], done = phones.length >= cur.need;
      await sb.from("playn_crew_checks").update({ phones, names, ...(done ? { done_at: now } : {}) }).eq("code", code);
      ck.phones = phones; ck.names = names; if (done) ck.done_at = now;
      if (done) {
        const cfg = await cfgAll();
        await sms(cfg, cfg.owner_phone, `[N CREW 전원 인증 완료 ✅ #${ck.request_id}]\n${rq.name} · ${rq.branch} ${rq.use_date} · ${cur.need}명 모두 인증\n이제 확정할 수 있어요: https://playn.kr/admin.html`);
        await sms(cfg, ck.leader, `[플레이앤 N CREW] ${cur.need}명 모두 인증 완료! 호스트가 확인하면 예약 확정 문자를 보내드려요.`);
      }
    }
    await sb.from("playand_log").insert({ source: "crew_check", payload: { req: ck.request_id, have: ck.phones.length, need: ck.need } });
    return J({ ...pub(), joined: !ex || ex.status !== "active" });
  }

  // 사장님 관리
  if (String(b.action ?? "").startsWith("admin")) {
    const cfg = await cfgAll();
    if (!cfg.admin_key || b.key !== cfg.admin_key) return J({ ok: false, error: "관리 키가 맞지 않아요" }, 401);
    const rules = JSON.parse(cfg.league_rules ?? "{}");
    if (b.action === "admin_league_add") {
      if (!BR.includes(b.branch) || !b.team || !(Number(b.streak) > 0)) return J({ ok: false, error: "지점·팀 이름·연승 수를 확인해 주세요" });
      const members = String(b.members ?? "").replace(/[^0-9,]/g, "").slice(0, 120);
      const { data: lg, error } = await sb.from("playn_league").insert({ season: b.season || rules.season, branch: b.branch, team: String(b.team).slice(0, 30), streak: Number(b.streak), play_date: b.date || kstToday(), members, note: String(b.note ?? "").slice(0, 200) }).select("id").single();
      const bonus = JSON.parse(cfg.perk_rules ?? "{}").league_bonus?.streak ?? 5;
      let given = 0;
      if (!error && Number(b.streak) >= bonus) for (const ph of members.split(",").map(normPhone).filter(Boolean) as string[]) {
        const { data: mm } = await sb.from("playn_members").select("phone").eq("phone", ph).maybeSingle();
        if (mm && await issue(cfg, ph, "league:" + lg.id, { kind: "service", title: `리그 ${b.streak}연승 도전 보상`, detail: "음료 2병. 다음 방문 때 호스트에게 말씀해 주세요." })) given++;
      }
      return J({ ok: !error, error: error?.message, bonus_given: given });
    }
    if (b.action === "admin_league_del") {
      await sb.from("playn_league").delete().eq("id", b.id);
      return J({ ok: true });
    }
    if (b.action === "admin_refs") {
      const { data: ms } = await sb.from("playn_members").select("name,phone,referred_by,ref_rewarded,created_at").not("referred_by", "is", null).order("created_at", { ascending: false }).limit(100);
      const out = [];
      for (const m of ms ?? []) {
        const { data: inv } = await sb.from("playn_members").select("name,phone,vip").eq("ref_code", m.referred_by).maybeSingle();
        out.push({ friend: m.name, friend_phone: m.phone, inviter: inv?.name, inviter_phone: inv?.phone, inviter_vip: !!inv?.vip, booked: (await bookedOf(m.phone)) > 0, visits: (await visitsOf(m.phone)).length, rewarded: m.ref_rewarded });
      }
      return J({ ok: true, refs: out });
    }
    if (b.action === "admin_ref_done") { // 예전 버튼 호환: 보상 다시 확인
      const p = normPhone(b.phone);
      if (p) await profile(p, cfg);
      return J({ ok: true });
    }
    if (b.action === "admin_member") {
      const p = normPhone(b.phone);
      if (!p) return J({ ok: false, error: "번호를 확인해 주세요" });
      const pr = await profile(p, cfg);
      if (!pr) return J({ ok: false, error: "N CREW 멤버가 아니에요" });
      return J({ ok: true, phone: p, ...pr });
    }
    if (b.action === "admin_coupon_use") {
      const note = String(b.note ?? "").slice(0, 100) || null;
      const { data } = await sb.from("playn_coupons").update({ status: "used", used_at: new Date().toISOString(), used_note: note }).eq("id", b.id).eq("status", "active").select("id").maybeSingle();
      return J({ ok: !!data });
    }
    if (b.action === "admin_coupon_add") {
      const p = normPhone(b.phone), amount = Number(b.amount) || null;
      if (!p || !b.title) return J({ ok: false, error: "번호와 쿠폰 이름을 확인해 주세요" });
      const ok = await issue(cfg, p, "manual:" + Date.now(), { kind: amount ? "won" : "service", title: String(b.title).slice(0, 40), detail: String(b.detail ?? "").slice(0, 200), amount: amount ?? undefined }, b.notify !== false);
      return J({ ok });
    }
    if (b.action === "admin_crew_sweep") { // 5분마다: 30분 지나도 전원 인증 안 된 50% 예약 자동 취소 + 할인권 반환
      const cut = new Date(Date.now() - CREW_MIN * 60e3).toISOString();
      const { data: cks } = await sb.from("playn_crew_checks").select("*").is("done_at", null).lt("created_at", cut);
      let n = 0;
      for (const ck of cks ?? []) {
        const { data: r } = await sb.from("playn_deal_requests").update({ status: "expired", decided_at: new Date().toISOString() }).eq("id", ck.request_id).eq("status", "pending").select("*").maybeSingle();
        if (!r) continue;
        n++;
        if (r.coupon_id) await sb.from("playn_coupons").update({ status: "active", request_id: null }).eq("id", r.coupon_id).eq("status", "held");
        await sms(cfg, r.phone, `[플레이앤 N CREW] ${CREW_MIN}분 안에 이용 인원 전원(${ck.phones.length}/${ck.need}) 인증이 끝나지 않아 ${r.branch} ${r.use_date} 50% 예약 신청이 자동 취소됐어요. 할인권은 그대로 돌려드렸어요. 친구들과 같이 있을 때 다시 신청해 주세요.\nhttps://playn.kr/me/`);
        await sms(cfg, cfg.owner_phone, `[50% 예약 #${r.id} 자동 취소] 인증 ${ck.phones.length}/${ck.need} · ${r.name} ${r.branch} ${r.use_date}`);
      }
      return J({ ok: true, expired: n });
    }
    if (b.action === "admin_sync_all") { // 매일 자동 실행: 쿠폰 지급 정리
      const { data: ms } = await sb.from("playn_members").select("phone").eq("status", "active");
      for (const x of ms ?? []) await profile(x.phone, cfg);
      await sb.from("playn_coupons").update({ status: "expired" }).eq("status", "active").lt("expires_at", kstToday());
      return J({ ok: true, members: (ms ?? []).length });
    }
    if (b.action === "admin_pass_charge") {
      const p = normPhone(b.phone), paid = Number(b.paid);
      if (!p || !(paid > 0)) return J({ ok: false, error: "번호와 입금액을 확인해 주세요" });
      const ps = JSON.parse(cfg.perk_rules ?? "{}").pass ?? { pay: 500000, credit: 600000 };
      const credit = paid >= ps.pay ? Math.floor(paid / ps.pay) * ps.credit + (paid % ps.pay) : paid;
      await sb.from("playn_pass_ledger").insert({ phone: p, delta: credit, note: `충전 ${paid.toLocaleString()}원 입금` });
      const { data: led } = await sb.from("playn_pass_ledger").select("delta").eq("phone", p);
      const bal = (led ?? []).reduce((a, x) => a + x.delta, 0);
      await sms(cfg, p, `[플레이앤 패스] ${paid.toLocaleString()}원 입금 확인 → ${credit.toLocaleString()}원 충전됐어요. 잔액 ${bal.toLocaleString()}원\n내 N CREW에서 예약할 때 패스로 결제할 수 있어요: https://playn.kr/me/`);
      return J({ ok: true, credit, balance: bal });
    }
    if (b.action === "admin_birthday") {
      const p = normPhone(b.phone);
      if (p) await sb.from("playn_members").update({ birthday: /^\d{2}-\d{2}$/.test(String(b.birthday)) ? b.birthday : null }).eq("phone", p);
      return J({ ok: true });
    }
    if (b.action === "admin_badge") {
      const p = normPhone(b.phone);
      if (!p || !/^[a-z]+$/.test(String(b.badge))) return J({ ok: false });
      const { data: m } = await sb.from("playn_members").select("badges").eq("phone", p).maybeSingle();
      if (!m) return J({ ok: false, error: "멤버가 아니에요" });
      const set = new Set([...(m.badges ?? []), b.badge]);
      await sb.from("playn_members").update({ badges: [...set] }).eq("phone", p);
      if (b.badge === "military") {
        const r = JSON.parse(cfg.perk_rules ?? "{}").military ?? {};
        await issue(cfg, p, "military", { kind: "won", title: `나라사랑 애국자 ${Number(r.first_booking ?? 50000).toLocaleString()}원 할인권`, detail: `군인 신분 첫 예약 1건에 ${Number(r.first_booking ?? 50000).toLocaleString()}원 할인 + 방문할 때 ${r.service ?? "음료 또는 물 2병"} 서비스.`, amount: r.first_booking ?? 50000 });
      }
      return J({ ok: true });
    }
  }
  return J({ error: "unknown action" }, 400);
});
