import sys
S='next/'; N='next2/'
def load(n): return open(S+n+'.ts',encoding='utf-8').read()
def rep(s,a,b,name):
    c=s.count(a)
    if c!=1: sys.exit(f'[{name}] expected 1 match, got {c}: {a[:90]!r}')
    return s.replace(a,b)
# 광고 동의는 b.marketing === true(불리언) 일 때만. 문자열 "true"·누락·false 는 모두 꺼짐
# ── playn-site join
s=load('playn-site'); n='site'
s=rep(s,'''    const joinOtp = cfg.ncrew_join_otp === "on";
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
    await sb.from("playand_log").insert({ source: "member_join", payload: { phone: phone.slice(-4), again: !!ex, verified: joinOtp } });''',
'''    // 가입 필수 동의(개인정보 수집·이용)와 광고 동의는 분리 (N CREW v1c). 광고 동의는 b.marketing === true 일 때만, 인증 스위치와 무관
    if (!b.agree) return J({ ok: false, error: "N CREW 가입 필수 동의에 체크해 주세요" });
    const joinOtp = cfg.ncrew_join_otp === "on";
    if (joinOtp) {
      const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "join" });
      if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호를 확인해 주세요" });
    }
    const { data: jr } = await sb.rpc("playn_member_join", { p_phone: phone, p_name: name, p_source: String(b.source ?? "web").slice(0, 30), p_branch: BR.includes(b.branch) ? b.branch : null, p_marketing: b.marketing === true, p_night: b.night_agree === true });
    if (!jr?.ok) return J({ ok: false, error: jr?.error ?? "잠시 후 다시 해 주세요" });
    const ex = jr.again;
    await sb.from("playand_log").insert({ source: "member_join", payload: { phone: phone.slice(-4), again: !!ex, verified: joinOtp, marketing: b.marketing === true } });''',n)
open(N+'playn-site.ts','w',encoding='utf-8').write(s)

# ── playn-community crew_verify (동행자 인증)
s=load('playn-community'); n='community'
s=rep(s,'''    if (!ex || ex.status !== "active") await sb.from("playn_members").upsert({ phone, name, marketing_agree: true, night_agree: !!b.night_agree, agreed_at: now, source: "crew_check", status: "active", updated_at: now });''',
'''    if (!ex || ex.status !== "active") await sb.rpc("playn_member_join", { p_phone: phone, p_name: name, p_source: "crew_check", p_branch: null, p_marketing: b.marketing === true, p_night: b.night_agree === true }); // 광고 동의 별도·기본 꺼짐 (v1c)''',n)
open(N+'playn-community.ts','w',encoding='utf-8').write(s)

# ── playn-settle: 체크인 가입, 팀 가입, 연장 그룹 가입
s=load('playn-settle'); n='settle'
s=rep(s,'''      await sb.from("playn_members").upsert({ phone: String(s.phone).replace(/\\D/g, ""), name: String(s.guest || checkin.depositor).slice(0, 20), marketing_agree: true, night_agree: !!b.crew_night, agreed_at: now, source: "checkin", fav_branch: s.branch, status: "active", updated_at: now });''',
'''      // 광고 동의 별도·기본 꺼짐 (v1c): crew_marketing === true 일 때만. 이미 활성 회원은 isMember 로 걸러져 체크인이 동의를 바꾸지 않음
      await sb.rpc("playn_member_join", { p_phone: String(s.phone).replace(/\\D/g, ""), p_name: String(s.guest || checkin.depositor).slice(0, 20), p_source: "checkin", p_branch: s.branch, p_marketing: b.crew_marketing === true, p_night: b.crew_night === true });''',n)
s=rep(s,'''      // 준비(설정 ncrew_join_otp=on): 가입 인증번호 확인 필수, 광고 동의는 따로 선택(기본 꺼짐). 지금은 꺼짐 → 기존과 같음
      const joinOtp = cfg.ncrew_join_otp === "on";
      let marketing = true;
      if (joinOtp) {
        const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "join" });
        if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호를 확인해 주세요" });
        marketing = b.marketing === true;
      } else if (!b.agree) return J({ ok: false, error: "특가·이벤트 알림 수신 동의가 필요해요" });
      const now = new Date().toISOString();
      const { data: ex } = await sb.from("playn_members").select("phone,status").eq("phone", phone).maybeSingle();
      if (!ex || ex.status !== "active") await sb.from("playn_members").upsert({ phone, name, marketing_agree: marketing, night_agree: marketing && !!b.night_agree, agreed_at: now, source: "worlds_team", fav_branch: p.branch, status: "active", updated_at: now });''',
'''      // 가입 필수 동의와 광고 동의 분리 (v1c). 광고 동의는 b.marketing === true 일 때만, 인증 스위치와 무관
      if (!b.agree) return J({ ok: false, error: "N CREW 가입 필수 동의에 체크해 주세요" });
      if (cfg.ncrew_join_otp === "on") {
        const { data: v } = await sb.rpc("member_otp_verify", { p_phone: phone, p_code: String(b.code ?? "").slice(0, 12), p_purpose: "join" });
        if (!v?.ok) return J({ ok: false, error: v?.error ?? "인증번호를 확인해 주세요" });
      }
      const { data: ex } = await sb.from("playn_members").select("phone,status").eq("phone", phone).maybeSingle();
      if (!ex || ex.status !== "active") await sb.rpc("playn_member_join", { p_phone: phone, p_name: name, p_source: "worlds_team", p_branch: p.branch, p_marketing: b.marketing === true, p_night: b.night_agree === true });''',n)
s=rep(s,'''    if (!b.agree) return J({ ok: false, error: "특가·이벤트 알림 수신 동의가 필요해요 (N CREW 가입 조건)" });''',
'''    if (!b.agree) return J({ ok: false, error: "N CREW 가입 필수 동의에 체크해 주세요" });''',n)
s=rep(s,'''    if (!ex || ex.status !== "active") await sb.from("playn_members").upsert({ phone, name, marketing_agree: true, night_agree: !!b.night_agree, agreed_at: now, source: "fx_group", fav_branch: g.branch, status: "active", updated_at: now });''',
'''    if (!ex || ex.status !== "active") await sb.rpc("playn_member_join", { p_phone: phone, p_name: name, p_source: "fx_group", p_branch: g.branch, p_marketing: b.marketing === true, p_night: b.night_agree === true }); // 광고 동의 별도·기본 꺼짐 (v1c)''',n)
open(N+'playn-settle.ts','w',encoding='utf-8').write(s)
print('ok')
