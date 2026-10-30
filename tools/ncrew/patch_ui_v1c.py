# N CREW v1c: 모든 가입 화면에서 가입 필수 동의와 광고 동의(선택·기본 꺼짐) 분리
import sys
def rep(s,a,b,name):
    c=s.count(a)
    if c!=1: sys.exit(f'[{name}] expected 1, got {c}: {a[:80]!r}')
    return s.replace(a,b)
REQ='N CREW 가입: 회원 확인과 혜택 제공을 위해 이름·휴대폰 번호 수집·이용에 동의해요'
MK='공실 특가·이벤트 광고 문자를 받을게요. 체크하지 않아도 가입과 혜택은 그대로예요'
NT='밤 9시~아침 8시 당일 특가 알림도 받을게요'
PRIV='목적: N CREW 회원 확인·혜택 제공, 광고 문자에 동의한 분께만 공실 특가·이벤트 알림'
def mkjs(mk,nt): return f'$("{mk}").onchange=()=>{{$("{nt}").disabled=!$("{mk}").checked;if(!$("{mk}").checked)$("{nt}").checked=false}};$("{nt}").disabled=true;'

# 홈페이지
p='index.html'; s=open(p,encoding='utf-8').read()
s=rep(s,'<label class="chk"><input type="checkbox" id="jAgree"><span><em>(필수)</em> 공실 특가·이벤트 등 광고성 정보를 카카오톡·문자로 받는 데 동의해요</span></label>\n      <label class="chk"><input type="checkbox" id="jNight"><span>(선택) 밤 9시 ~ 아침 8시 사이에 오는 당일 특가 알림도 받을게요</span></label>',
 f'<label class="chk"><input type="checkbox" id="jAgree"><span><em>(필수)</em> {REQ}</span></label>\n      <label class="chk"><input type="checkbox" id="jMk"><span>(선택) {MK}</span></label>\n      <label class="chk"><input type="checkbox" id="jNight"><span>(선택) {NT}</span></label>',p)
s=rep(s,'목적: 공실 특가·이벤트 알림, 특가 예약 확인 연락<br>',f'{PRIV}, 특가 예약 확인 연락<br>',p)
s=rep(s,'동의하지 않을 수 있지만, 그 경우 N CREW 가입과 특가 신청이 어려워요.','필수 동의를 하지 않으면 N CREW 가입과 특가 신청이 어려워요. 광고 문자는 선택이에요.',p)
s=rep(s,'m.textContent="특가 알림을 받으려면 필수 동의에 체크해 주세요.";return}','m.textContent="N CREW 가입 필수 동의에 체크해 주세요.";return}',p)
s=rep(s,'branch:$("jBranch").value,agree:true,night_agree:$("jNight").checked,source:new URLSearchParams','branch:$("jBranch").value,agree:true,marketing:$("jMk").checked,night_agree:$("jMk").checked&&$("jNight").checked,source:new URLSearchParams',p)
s=rep(s,'/* 가입 */\n','/* 가입 */\n'+mkjs('jMk','jNight')+'\n',p)
open(p,'w',encoding='utf-8').write(s)

# 내 N CREW 빠른 가입
p='me/index.html'; s=open(p,encoding='utf-8').read()
s=rep(s,'<label class="ck"><input type="checkbox" id="qjAg"> <span><em>(필수)</em> 공실 특가·이벤트 등 광고성 정보를 카카오톡·문자로 받는 데 동의해요. 수집: 이름·휴대폰 번호 / 보관: 수신 거부 시까지</span></label>\n<label class="ck"><input type="checkbox" id="qjNt"> <span>(선택) 밤 9시~아침 8시 당일 특가 알림도 받을게요</span></label>',
 f'<label class="ck"><input type="checkbox" id="qjAg"> <span><em>(필수)</em> {REQ}. 보관: N CREW 탈퇴 시까지</span></label>\n<label class="ck"><input type="checkbox" id="qjMk"> <span>(선택) {MK}</span></label>\n<label class="ck"><input type="checkbox" id="qjNt" disabled> <span>(선택) {NT}</span></label>',p)
s=rep(s,' $("qjName").focus();\n',' $("qjName").focus();\n $("qjMk").onchange=()=>{$("qjNt").disabled=!$("qjMk").checked;if(!$("qjMk").checked)$("qjNt").checked=false};\n',p)
s=rep(s,'agree:true,night_agree:$("qjNt").checked,so','agree:true,marketing:$("qjMk").checked,night_agree:$("qjMk").checked&&$("qjNt").checked,so',p)
open(p,'w',encoding='utf-8').write(s)

# 롤드컵 투표 가입
p='worlds/index.html'; s=open(p,encoding='utf-8').read()
s=rep(s,'<label><input type="checkbox" id="jAgree"><span><b>(필수)</b> 공실 특가·이벤트 등 광고성 정보를 카카오톡·문자로 받는 데 동의해요</span></label>\n      <label><input type="checkbox" id="jNight"><span>(선택) 밤 9시 ~ 아침 8시 당일 특가 알림도 받을게요</span></label>',
 f'<label><input type="checkbox" id="jAgree"><span><b>(필수)</b> {REQ}</span></label>\n      <label><input type="checkbox" id="jMk"><span>(선택) {MK}</span></label>\n      <label><input type="checkbox" id="jNight" disabled><span>(선택) {NT}</span></label>',p)
s=rep(s,'목적: 공실 특가·이벤트 알림, 롤드컵 투표 · 보관: 탈퇴(수신 거부) 시까지. 동의하지 않으면 가입·투표가 어려워요.',f'{PRIV}, 롤드컵 투표 · 보관: N CREW 탈퇴 시까지. 필수 동의를 하지 않으면 가입·투표가 어려워요. 광고 문자는 선택이에요.',p)
s=rep(s,'$("jGo").onclick=async()=>{','$("jMk").onchange=()=>{$("jNight").disabled=!$("jMk").checked;if(!$("jMk").checked)$("jNight").checked=false};\n$("jGo").onclick=async()=>{',p)
s=rep(s,'agree:true,night_agree:$("jNight").checked,source:"worlds_vote"','agree:true,marketing:$("jMk").checked,night_agree:$("jMk").checked&&$("jNight").checked,source:"worlds_vote"',p)
open(p,'w',encoding='utf-8').write(s)

# 팀 가입
p='team/index.html'; s=open(p,encoding='utf-8').read()
s=rep(s,'<label class="ck"><input type="checkbox" id="ag"><span>N CREW 가입 · 특가·이벤트 문자 수신 동의 (필수)<small>멤버 특가 20%(홈페이지 예약) · 방문할수록 등급 혜택 · 빈자리 특가 알림. 언제든 수신 거부할 수 있어요.</small></span></label>\n    <label class="ck"><input type="checkbox" id="nt"><span>밤 9시~아침 8시 당일 특가 알림도 받을게요 <small>(선택)</small></span></label>',
 f'<label class="ck"><input type="checkbox" id="ag"><span>{REQ} (필수)<small>멤버 특가 20%(홈페이지 예약) · 방문할수록 등급 혜택.</small></span></label>\n    <label class="ck"><input type="checkbox" id="mk"><span>{MK} <small>(선택) 언제든 수신 거부할 수 있어요.</small></span></label>\n    <label class="ck"><input type="checkbox" id="nt" disabled><span>{NT} <small>(선택)</small></span></label>',p)
s=rep(s,'$("f").onsubmit=async e=>{','$("mk").onchange=()=>{$("nt").disabled=!$("mk").checked;if(!$("mk").checked)$("nt").checked=false};\n$("f").onsubmit=async e=>{',p)
s=rep(s,'agree:$("ag").checked,night_agree:$("nt").checked}','agree:$("ag").checked,marketing:$("mk").checked,night_agree:$("mk").checked&&$("nt").checked}',p)
open(p,'w',encoding='utf-8').write(s)

# 연장 그룹(동행자) 가입
p='j/index.html'; s=open(p,encoding='utf-8').read()
s=rep(s,'<label class="ck"><input type="checkbox" id="ag"><span>N CREW 가입 (무료) · 특가·이벤트 알림 수신에 동의해요 (필수)<small>빈자리 특가 20% · 방문할수록 등급 혜택. 수집: 이름·휴대폰 번호 / 목적: 특가·이벤트 알림 / 보관: 수신 거부 시까지. 언제든 playn.kr 맨 아래에서 수신 거부할 수 있어요.</small></span></label>\n    <label class="ck"><input type="checkbox" id="nt"><span>밤 9시~아침 8시 당일 특가 알림도 받을게요<small>(선택)</small></span></label>',
 f'<label class="ck"><input type="checkbox" id="ag"><span>{REQ} (필수)<small>빈자리 특가 20% · 방문할수록 등급 혜택. 수집: 이름·휴대폰 번호 / 보관: N CREW 탈퇴 시까지</small></span></label>\n    <label class="ck"><input type="checkbox" id="mk"><span>{MK}<small>(선택) 언제든 playn.kr 맨 아래에서 수신 거부할 수 있어요.</small></span></label>\n    <label class="ck"><input type="checkbox" id="nt" disabled><span>{NT}<small>(선택)</small></span></label>',p)
s=rep(s,'$("fm").onsubmit=async e=>{','$("mk").onchange=()=>{$("nt").disabled=!$("mk").checked;if(!$("mk").checked)$("nt").checked=false};\n$("fm").onsubmit=async e=>{',p)
s=rep(s,'code:$("cd").value,agree:true,night_agree:$("nt").checked}','code:$("cd").value,agree:true,marketing:$("mk").checked,night_agree:$("mk").checked&&$("nt").checked}',p)
open(p,'w',encoding='utf-8').write(s)

# 동행자 인증(50% 예약)
p='crew/index.html'; s=open(p,encoding='utf-8').read()
s=rep(s,'<label class="chk"><input type="checkbox" id="ag"><span><b>(필수)</b> N CREW에 가입하고 공실 특가·이벤트 등 광고성 정보를 카카오톡·문자로 받는 데 동의해요 (이미 멤버면 그대로 유지)</span></label>',
 f'<label class="chk"><input type="checkbox" id="ag"><span><b>(필수)</b> {REQ} (이미 멤버면 그대로 유지)</span></label>\n  <label class="chk"><input type="checkbox" id="mk"><span>(선택) {MK} (이미 멤버면 기존 설정 유지)</span></label>',p)
s=rep(s,'목적: N CREW 멤버 확인, 예약 인원 인증, 공실 특가·이벤트 알림 · 보관: 탈퇴(수신 거부) 시까지.','목적: N CREW 멤버 확인, 예약 인원 인증, 광고 문자에 동의한 분께만 공실 특가·이벤트 알림 · 보관: N CREW 탈퇴 시까지.',p)
s=rep(s,'post({action:"crew_verify",phone,name,code,agree:true})','post({action:"crew_verify",phone,name,code,agree:true,marketing:$("mk").checked})',p)
open(p,'w',encoding='utf-8').write(s)

# 체크인(in·out 같은 화면)
for p in ['in/index.html','out/index.html']:
    s=open(p,encoding='utf-8').read()
    s=rep(s,'<label><input type="checkbox" id="crJ"><span>N CREW 가입하기 (무료)<small>다음 예약 멤버 특가 20%(홈페이지 예약) · 방문할수록 등급 혜택 · 빈자리 특가 알림. 특가·이벤트 문자 수신에 동의해요. 언제든 수신 거부할 수 있어요.</small></span></label>\n      <label id="crNl" hidden><input type="checkbox" id="crN"><span>',
     '<label><input type="checkbox" id="crJ"><span>N CREW 가입하기 (무료)<small>다음 예약 멤버 특가 20%(홈페이지 예약) · 방문할수록 등급 혜택. 회원 확인과 혜택 제공을 위해 이름·휴대폰 번호 수집·이용에 동의해요.</small></span></label>\n      <label id="crMl" hidden><input type="checkbox" id="crM"><span>공실 특가·이벤트 광고 문자도 받을게요<small>(선택) 체크하지 않아도 가입과 혜택은 그대로예요. 언제든 수신 거부할 수 있어요.</small></span></label>\n      <label id="crNl" hidden><input type="checkbox" id="crN"><span>',p)
    s=rep(s,'$("crJ").onchange=()=>$("crNl").hidden=!$("crJ").checked}',
     '$("crJ").onchange=()=>{$("crMl").hidden=!$("crJ").checked;if(!$("crJ").checked){$("crM").checked=false;$("crN").checked=false;$("crNl").hidden=true}};$("crM").onchange=()=>{$("crNl").hidden=!$("crM").checked;if(!$("crM").checked)$("crN").checked=false}}',p)
    s=rep(s,'crew_join:$("crJ").checked,crew_night:$("crN").checked}','crew_join:$("crJ").checked,crew_marketing:$("crJ").checked&&$("crM").checked,crew_night:$("crJ").checked&&$("crM").checked&&$("crN").checked}',p)
    open(p,'w',encoding='utf-8').write(s)
print('ui ok')
