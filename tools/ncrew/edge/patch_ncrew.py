import sys
S='src/'; N='next/'
def load(n): return open(S+n+'.ts',encoding='utf-8').read()
def rep(s,a,b,name):
    c=s.count(a)
    if c!=1: sys.exit(f'[{name}] expected 1 match, got {c}: {a[:80]!r}')
    return s.replace(a,b)
HELPERS='''
// ── N CREW v1 (2026-10-30): 광고 판단·수신 거부 링크·접속 구분 (DB 함수 playn_ad_ok / playn_optout_link)
async function adOk(phone: string) { const { data } = await sb.rpc("playn_ad_ok", { p_phone: phone }); return data === true; }
async function adFooter(phone: string) { const { data: t } = await sb.rpc("playn_optout_link", { p_phone: phone }); return t ? `수신거부 playn.kr/stop/?t=${t}` : "수신거부: playn.kr 맨 아래"; }
async function withFooter(msg: string, phone: string) { return msg.replace("수신거부: playn.kr 맨 아래", await adFooter(phone)); }
async function otpIpHash(req: Request) {
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim(); if (!ip) return null;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ncrew-otp:" + ip)));
  return Array.from(d.slice(0, 8)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
'''
def add_helpers(s,anchor,name):
    return rep(s,anchor,anchor+HELPERS,name)

# ── playn-site
s=load('playn-site'); n='site'
s=add_helpers(s,'const normPhone = (p: unknown) => { const d = String(p ?? "").replace(/\\D/g, ""); return /^01\\d{8,9}$/.test(d) ? d : null; };\n',n)
s=rep(s,'    return J({ ok: true, kakao: cfg.kakao_channel_url ?? null });',
 '    return J({ ok: true, kakao: cfg.kakao_channel_url ?? null, optout_mode: cfg.ncrew_optout_mode === "verified" ? "verified" : "legacy", join_otp: cfg.ncrew_join_otp === "on" });',n)
old_join=s[s.index('  if (b.action === "join") {'):s.index('  if (b.action === "check") {')]
new_join='''  // 가입 인증번호 (준비: 설정 ncrew_join_otp=on 일 때만. 지금은 꺼짐 → 문자 안 나감)
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
    const joinOtp = cfg.ncrew_join_otp === "on";
    // 준비된 새 방식(설정 on): 번호 인증 필수, 광고 동의는 따로 선택(기본 꺼짐)
    // 지금 방식(설정 off): 기존과 같음. 수신 거부한 번호는 DB 보호 장치가 광고 동의를 켜지 않음
    let marketing = true;
    if (joinOtp) {
      const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "join" });
      if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호를 확인해 주세요" });
      marketing = b.marketing === true;
    } else if (!b.agree) return J({ ok: false, error: "특가 알림 수신 동의가 필요해요" });
    const { data: ex } = await sb.from("playn_members").select("phone").eq("phone", phone).maybeSingle();
    const now = new Date().toISOString();
    await sb.from("playn_members").upsert({ phone, name, marketing_agree: marketing, night_agree: marketing && !!b.night_agree, agreed_at: now, source: String(b.source ?? "web").slice(0, 30), fav_branch: BR.includes(b.branch) ? b.branch : null, status: "active", updated_at: now });
    await sb.from("playand_log").insert({ source: "member_join", payload: { phone: phone.slice(-4), again: !!ex, verified: joinOtp } });
    const { data: ticket } = await sb.rpc("playn_join_ticket", { p_phone: phone }); // 초대 코드 연결용 1회 표(10분)
    return J({ ok: true, again: !!ex, name, ticket });
  }

'''
s=s.replace(old_join,new_join)
old_leave=s[s.index('  if (b.action === "leave") {'):s.index('  if (b.action === "request") {')]
new_leave='''  // 광고 수신 거부: 광고 동의 끄기 + 수신 거부 기록만. 회원 자격·로그인·예약·혜택은 그대로 (N CREW v1)
  //  verified(본인 확인): 인증번호 확인 뒤 처리 / legacy(전환 전 임시): 기존 홈페이지 경로 유지, 광고만 끔
  if (b.action === "optout_link") {
    const { data: r } = await sb.rpc("playn_optout_by_link", { p_token: String(b.t ?? "").slice(0, 40) });
    return J(r ?? { ok: false, error: "잠시 후 다시 해 주세요" });
  }
  if (b.action === "optout_otp") {
    if (cfg.ncrew_optout_mode !== "verified") return J({ ok: false, error: "본인 확인 수신 거부는 아직 준비 중이에요" });
    const phone = normPhone(b.phone); if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    const { data: r, error } = await sb.rpc("member_otp_issue", { p_phone: phone, p_purpose: "optout", p_ip_hash: await otpIpHash(req) });
    if (error || !r?.ok) return J({ ok: false, error: r?.error ?? "잠시 후 다시 해 주세요" });
    const sent = await sms(cfg, phone, `[플레이앤] 수신 거부 인증번호 ${r.code} (5분 안에 입력해 주세요)`);
    return J({ ok: sent, error: sent ? undefined : "문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요" });
  }
  if (b.action === "leave") {
    const phone = normPhone(b.phone);
    if (!phone) return J({ ok: false, error: "휴대폰 번호를 확인해 주세요" });
    if (cfg.ncrew_optout_mode === "verified") {
      if (!b.code) return J({ ok: false, need_code: true, error: "본인 확인 인증번호를 받아 주세요" });
      const { data: r } = await sb.rpc("playn_optout_verified", { p_phone: phone, p_code: String(b.code).slice(0, 12) });
      return J(r ?? { ok: false, error: "잠시 후 다시 해 주세요" });
    }
    await sb.rpc("playn_optout_apply", { p_phone: phone, p_method: "site_legacy" });
    return J({ ok: true });
  }

'''
s=s.replace(old_leave,new_leave)
open(N+'playn-site.ts','w',encoding='utf-8').write(s)

# ── playn-community
s=load('playn-community'); n='community'
s=add_helpers(s,'const normPhone = (p: unknown) => { const d = String(p ?? "").replace(/\\D/g, ""); return /^01\\d{8,9}$/.test(d) ? d : null; };\n',n)
s=rep(s,'''  if (notify && h >= 8 && h < 21) await sms(cfg, phone, `(광고)[플레이앤 N CREW] 🎁 ${c.title} 지급\\n${c.detail ?? ""}\\n내 쿠폰: https://playn.kr/me/\\n수신거부: playn.kr 맨 아래`);''',
'''  // N CREW v1: 쿠폰은 그대로 지급, (광고) 문자는 광고 판단(동의·수신 거부·활성·08~21시)을 통과할 때만
  if (notify && h >= 8 && h < 21 && (await adOk(phone))) await sms(cfg, phone, await withFooter(`(광고)[플레이앤 N CREW] 🎁 ${c.title} 지급\\n${c.detail ?? ""}\\n내 쿠폰: https://playn.kr/me/\\n수신거부: playn.kr 맨 아래`, phone));''',n)
old=s[s.index('  // 문자 인증번호 보내기 (가입한 번호만, 1시간 3회)'):s.index('  if (b.action === "me") {')]
new='''  // 문자 인증번호 보내기 (가입한 번호만). N CREW v1: 로그인 용도 번호, 발급 한도·5회 제한·1회 사용은 DB 함수
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
'''
s=s.replace(old,new)
old=s[s.index('  // 가입 직후 친구 초대 코드 연결 (가입 10분 이내, 한 번만)'):s.index('  // ── 50% 할인 예약: 같이 오는 사람 전원 N CREW 인증 ──')]
new='''  // 가입 직후 친구 초대 코드 연결: 가입 때 받은 1회용 표(10분)가 있어야 함 (N CREW v1, 번호만으로는 불가)
  if (b.action === "ref_attach") {
    const phone = normPhone(b.phone), code = String(b.ref ?? "").trim().toUpperCase();
    if (!phone) return J({ ok: false });
    const { data: r } = await sb.rpc("playn_ref_attach", { p_phone: phone, p_code: code, p_ticket: String(b.ticket ?? "").slice(0, 64) });
    return J({ ok: r?.ok === true });
  }

'''
s=s.replace(old,new)
old='''      const since = new Date(Date.now() - 3600e3).toISOString();
      const { count } = await sb.from("playn_otp").select("phone", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since);
      if ((count ?? 0) >= 3) return J({ ok: false, error: "인증번호는 1시간에 3번까지 받을 수 있어요" });
      const otp = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      await sb.from("playn_otp").insert({ phone, code: otp });
      const cfg = await cfgAll();
      const sent = await sms(cfg, phone, `[플레이앤 N CREW] 인증번호 ${otp} (5분 안에 입력해 주세요)`);'''
new='''      const { data: r, error } = await sb.rpc("member_otp_issue", { p_phone: phone, p_purpose: "crew", p_ip_hash: await otpIpHash(req) });
      if (error || !r?.ok) return J({ ok: false, error: r?.error ?? "잠시 후 다시 시도해 주세요" });
      const cfg = await cfgAll();
      const sent = await sms(cfg, phone, `[플레이앤 N CREW] 인증번호 ${r.code} (5분 안에 입력해 주세요)`);'''
s=rep(s,old,new,n)
old='''    const since = new Date(Date.now() - 5 * 60e3).toISOString();
    const { data: o } = await sb.from("playn_otp").select("code").eq("phone", phone).eq("used", false).gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!o || o.code !== String(b.code ?? "").trim()) return J({ ok: false, error: "인증번호가 맞지 않거나 시간이 지났어요" });
    await sb.from("playn_otp").update({ used: true }).eq("phone", phone).eq("code", o.code);
    const now = new Date().toISOString();
    const { data: ex } = await sb.from("playn_members").select("phone,status").eq("phone", phone).maybeSingle();'''
new='''    const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "crew" });
    if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호가 맞지 않거나 시간이 지났어요" });
    const now = new Date().toISOString();
    const { data: ex } = await sb.from("playn_members").select("phone,status").eq("phone", phone).maybeSingle();'''
s=rep(s,old,new,n)
open(N+'playn-community.ts','w',encoding='utf-8').write(s)

# ── playn-settle
s=load('playn-settle'); n='settle'
s=add_helpers(s,'const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);\n',n)
old='''      const since = new Date(Date.now() - 3600e3).toISOString();
      const { count } = await sb.from("playn_otp").select("phone", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since);
      if ((count ?? 0) >= 3) return J({ ok: false, error: "인증번호는 1시간에 3번까지 받을 수 있어요" });
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      await sb.from("playn_otp").insert({ phone, code });
      const sent = await sms(cfg, phone, `[플레이앤 N CREW] 인증번호 ${code} (5분 안에 입력해 주세요)`);'''
new='''      const { data: r, error } = await sb.rpc("member_otp_issue", { p_phone: phone, p_purpose: "fx", p_ip_hash: await otpIpHash(req) });
      if (error || !r?.ok) return J({ ok: false, error: r?.error ?? "잠시 후 다시 시도해 주세요" });
      const sent = await sms(cfg, phone, `[플레이앤 N CREW] 인증번호 ${r.code} (5분 안에 입력해 주세요)`);'''
s=rep(s,old,new,n)
old='''    const since = new Date(Date.now() - 5 * 60e3).toISOString();
    const { data: o } = await sb.from("playn_otp").select("code").eq("phone", phone).eq("used", false).gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!o || o.code !== String(b.code ?? "").trim()) return J({ ok: false, error: "인증번호가 맞지 않거나 시간이 지났어요" });
    await sb.from("playn_otp").update({ used: true }).eq("phone", phone).eq("code", o.code);'''
new='''    const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "fx" });
    if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호가 맞지 않거나 시간이 지났어요" });'''
s=rep(s,old,new,n)
old='''      if (!b.agree) return J({ ok: false, error: "특가·이벤트 알림 수신 동의가 필요해요" });
      const now = new Date().toISOString();
      const { data: ex } = await sb.from("playn_members").select("phone,status").eq("phone", phone).maybeSingle();
      if (!ex || ex.status !== "active") await sb.from("playn_members").upsert({ phone, name, marketing_agree: true, night_agree: !!b.night_agree, agreed_at: now, source: "worlds_team", fav_branch: p.branch, status: "active", updated_at: now });'''
new='''      // 준비(설정 ncrew_join_otp=on): 가입 인증번호 확인 필수, 광고 동의는 따로 선택(기본 꺼짐). 지금은 꺼짐 → 기존과 같음
      const joinOtp = cfg.ncrew_join_otp === "on";
      let marketing = true;
      if (joinOtp) {
        const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "join" });
        if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호를 확인해 주세요" });
        marketing = b.marketing === true;
      } else if (!b.agree) return J({ ok: false, error: "특가·이벤트 알림 수신 동의가 필요해요" });
      const now = new Date().toISOString();
      const { data: ex } = await sb.from("playn_members").select("phone,status").eq("phone", phone).maybeSingle();
      if (!ex || ex.status !== "active") await sb.from("playn_members").upsert({ phone, name, marketing_agree: marketing, night_agree: marketing && !!b.night_agree, agreed_at: now, source: "worlds_team", fav_branch: p.branch, status: "active", updated_at: now });'''
s=rep(s,old,new,n)
open(N+'playn-settle.ts','w',encoding='utf-8').write(s)

# ── playn-auto
s=load('playn-auto'); n='auto'
s=add_helpers(s,'const normPhone = (p: unknown) => { const d = String(p ?? "").replace(/\\D/g, ""); return /^01\\d{8,9}$/.test(d) ? d : null; };\n',n)
old='''  const { data: ms } = await sb.from("playn_members").select("phone").eq("status", "active").eq("marketing_agree", true);
  const since = new Date(Date.now() - 7 * 86400e3).toISOString(); let sent = 0;
  for (const m of ms ?? []) {
    const { count } = await sb.from("playn_alert_log").select("id", { count: "exact", head: true }).eq("phone", m.phone).eq("kind", "vacancy").gte("sent_at", since);
    if ((count ?? 0) >= (rules.vacancy_weekly_max ?? 2)) continue;
    if (await sms(cfg, m.phone, msg)) { await sb.from("playn_alert_log").insert({ phone: m.phone, kind: "vacancy" }); sent++; }'''
new='''  // N CREW v1: 광고 대상은 공통 판단(playn_ad_audience + playn_ad_ok: 활성·동의·수신 거부 없음·08~21시)
  const { data: ms } = await sb.from("playn_ad_audience").select("phone");
  const since = new Date(Date.now() - 7 * 86400e3).toISOString(); let sent = 0;
  for (const m of ms ?? []) {
    if (!(await adOk(m.phone))) continue;
    const { count } = await sb.from("playn_alert_log").select("id", { count: "exact", head: true }).eq("phone", m.phone).eq("kind", "vacancy").gte("sent_at", since);
    if ((count ?? 0) >= (rules.vacancy_weekly_max ?? 2)) continue;
    if (await sms(cfg, m.phone, await withFooter(msg, m.phone))) { await sb.from("playn_alert_log").insert({ phone: m.phone, kind: "vacancy" }); sent++; }'''
s=rep(s,old,new,n)
open(N+'playn-auto.ts','w',encoding='utf-8').write(s)

# ── playn-growth
s=load('playn-growth'); n='growth'
s=add_helpers(s,'const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);\n',n)
old='''  const { data: ms } = await sb.from("playn_members").select("phone").eq("status", "active").eq("marketing_agree", true);
  const out = await optoutSet(); let sent = 0;
  for (const m of ms ?? []) {
    if (out.has(digits(m.phone))) continue;
    if ((await weekCount(m.phone)) >= (rules.vacancy_weekly_max ?? 2)) continue;
    if (await sms(cfg, m.phone, msg)) {'''
new='''  // N CREW v1: 광고 대상은 공통 판단(playn_ad_audience + playn_ad_ok)
  const { data: ms } = await sb.from("playn_ad_audience").select("phone");
  const out = await optoutSet(); let sent = 0;
  for (const m of ms ?? []) {
    if (out.has(digits(m.phone)) || !(await adOk(m.phone))) continue;
    if ((await weekCount(m.phone)) >= (rules.vacancy_weekly_max ?? 2)) continue;
    if (await sms(cfg, m.phone, await withFooter(msg, m.phone))) {'''
s=rep(s,old,new,n)
old='''  const { data: ms } = await sb.from("playn_members").select("phone,name").eq("status", "active").eq("marketing_agree", true);
  const out = await optoutSet(), today = kstToday(), res: any[] = [];
  for (const m of ms ?? []) {
    if (res.length >= W.per_run) break;
    const p = digits(m.phone); if (out.has(p)) continue;'''
new='''  const { data: ms } = await sb.from("playn_ad_audience").select("phone,name");
  const out = await optoutSet(), today = kstToday(), res: any[] = [];
  for (const m of ms ?? []) {
    if (res.length >= W.per_run) break;
    const p = digits(m.phone); if (out.has(p) || !(await adOk(m.phone))) continue;'''
s=rep(s,old,new,n)
# winback 문자 꼬리도 개인 링크로
i=s.index('const ok = await sms(cfg, p, `(광고)[플레이앤 N CREW]')
j=s.index(');',i)
seg=s[i:j+2]
if seg.count('`')!=2 or '수신거부: playn.kr 맨 아래' not in seg: sys.exit('[growth] winback sms segment unexpected')
seg2=seg.replace('await sms(cfg, p, `','await sms(cfg, p, await withFooter(`',1)
k=seg2.rindex('`')
seg2=seg2[:k+1]+', p)'+seg2[k+1:]
s=s[:i]+seg2+s[j+2:]
open(N+'playn-growth.ts','w',encoding='utf-8').write(s)
print('patched ok')
