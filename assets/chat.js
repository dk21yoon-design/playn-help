/* 플레이앤 AI 상담 위젯 v1
   - 페이지를 떠나지 않고 오른쪽 아래에서 바로 상담 (모바일은 전체 화면 시트)
   - 기존 /help/ 링크(.fab, 하단 도크, 본문 링크)를 가로채서 위젯을 엶. JS가 꺼져 있으면 원래 링크대로 /help/ 이동
   - 대화는 세션 동안 유지 (다른 페이지로 넘어가도 이어짐)
   - 참고: 채널톡·Intercom 런처 패턴, 모바일은 전체 화면, 빠른 질문 칩, 상담원(호스트) 연결 */
(()=>{
if(window.__pnChat)return;window.__pnChat=1;
const API="https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-chat";
const HOST="010-8339-5818";
const BR={hongdae:"홍대루프탑",yeonnam:"연남루프탑",yeontral:"연트럴파크"};
const ss={get(k){try{return JSON.parse(sessionStorage.getItem(k))}catch(e){return null}},set(k,v){try{sessionStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const path=location.pathname;
const pageBr=(path.match(/^\/(hongdae|yeonnam|yeontral)\//)||[])[1]||new URLSearchParams(location.search).get("b");
let S=ss.get("pn_chat")||{b:null,msgs:[],sid:Math.random().toString(36).slice(2,10)};
if(pageBr&&BR[pageBr]&&!S.msgs.length)S.b=pageBr;
let busy=false,pending=null;
const isHome=path==="/"||path==="/index.html";
const L=(h)=>h.startsWith("/")?h:(isHome?"/"+h:h);

const css=`
.pnc-l{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom));z-index:60;display:flex;align-items:center;gap:9px;border:0;cursor:pointer;background:#F3F1FF;color:#16133F;font:800 14.5px Pretendard,-apple-system,sans-serif;padding:13px 18px;border-radius:999px;box-shadow:0 14px 34px -10px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08);transition:transform .25s cubic-bezier(.16,1,.3,1)}
.pnc-l:hover{transform:translateY(-2px)}.pnc-l i{width:9px;height:9px;border-radius:50%;background:#3DDC97;box-shadow:0 0 0 3px rgba(61,220,151,.25)}
.pnc-tip{position:fixed;right:20px;bottom:calc(78px + env(safe-area-inset-bottom));z-index:60;max-width:260px;background:#F3F1FF;color:#16133F;border-radius:16px 16px 4px 16px;padding:12px 34px 12px 14px;font:600 14px/1.5 Pretendard,sans-serif;box-shadow:0 14px 34px -10px rgba(0,0,0,.6);cursor:pointer;animation:pncUp .35s cubic-bezier(.16,1,.3,1)}
.pnc-tip b{display:block;font-weight:800}.pnc-tip button{position:absolute;top:6px;right:6px;border:0;background:none;font-size:18px;color:#6F6AAB;cursor:pointer;padding:4px 8px}
.pnc{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom));z-index:70;width:380px;height:min(620px,calc(100vh - 40px));display:flex;flex-direction:column;background:#0E0C2C;color:#F3F1FF;border-radius:22px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,.75),0 0 0 1px rgba(166,162,214,.18);font-family:Pretendard,-apple-system,sans-serif;animation:pncUp .3s cubic-bezier(.16,1,.3,1)}
@keyframes pncUp{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
.pnc-h{display:flex;align-items:center;gap:10px;padding:14px 14px 12px 18px;background:linear-gradient(180deg,#1C1850,#16133F);border-bottom:1px solid rgba(166,162,214,.16)}
.pnc-h .t{font-weight:800;font-size:16px;line-height:1.25}.pnc-h .t small{display:block;font-weight:500;font-size:12.5px;color:#B3AFDF}
.pnc-h .t small i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#3DDC97;margin-right:5px;vertical-align:1px}
.pnc-h .sp{flex:1}.pnc-h button{border:0;background:rgba(255,255,255,.07);color:#F3F1FF;width:34px;height:34px;border-radius:50%;font-size:18px;cursor:pointer}
.pnc-h a{color:#B3AFDF;font-size:12.5px;text-decoration:none;padding:8px}
.pnc-b{flex:1;overflow-y:auto;padding:16px 14px 8px;overscroll-behavior:contain}
.pnc-m{max-width:86%;padding:11px 14px;border-radius:18px;line-height:1.55;font-size:15px;margin:6px 0;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}
.pnc-m.a{background:#1C1850;border:1px solid rgba(166,162,214,.16);border-top-left-radius:6px}
.pnc-m.u{background:#FFB547;color:#1B1640;margin-left:auto;border-top-right-radius:6px;font-weight:600}
.pnc-c{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 6px}
.pnc-c button,.pnc-c a{border:1px solid rgba(166,162,214,.28);background:rgba(255,255,255,.04);color:#F3F1FF;border-radius:999px;padding:8px 13px;font:600 13.5px Pretendard,sans-serif;cursor:pointer;text-decoration:none}
.pnc-c button:hover,.pnc-c a:hover{background:rgba(255,255,255,.09)}
.pnc-c .on{background:#FFB547;color:#1B1640;border-color:#FFB547}
.pnc-lab{font-size:12px;color:#8682BE;margin:12px 2px 0;font-weight:700;letter-spacing:.02em}
.pnc-e{background:rgba(255,46,110,.10);border:1px solid rgba(255,46,110,.35);border-radius:16px;padding:12px;margin:8px 0;max-width:90%}
.pnc-e p{font-size:13.5px;color:#FFC2D4;margin-bottom:9px}.pnc-e a{display:inline-block;margin:0 6px 4px 0;background:#FF2E6E;color:#fff;text-decoration:none;border-radius:999px;padding:8px 14px;font-size:13.5px;font-weight:700}.pnc-e a.s{background:rgba(255,255,255,.1)}
.pnc-ty{display:flex;gap:4px;padding:12px 4px}.pnc-ty i{width:7px;height:7px;border-radius:50%;background:#8682BE;animation:pncB 1s infinite}.pnc-ty i:nth-child(2){animation-delay:.15s}.pnc-ty i:nth-child(3){animation-delay:.3s}
@keyframes pncB{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}
.pnc-f{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid rgba(166,162,214,.16);background:#0E0C2C}
.pnc-f textarea{flex:1;resize:none;background:#16133F;color:#F3F1FF;border:1px solid rgba(166,162,214,.28);border-radius:16px;padding:11px 13px;font:16px/1.4 Pretendard,sans-serif;max-height:110px}
.pnc-f textarea:focus{outline:none;border-color:#FFB547}
.pnc-f button{border:0;background:#FFB547;color:#1B1640;border-radius:16px;padding:0 16px;font:800 15px Pretendard,sans-serif;cursor:pointer}.pnc-f button:disabled{opacity:.4}
.pnc-n{font-size:11.5px;color:#6F6AAB;text-align:center;padding:2px 0 8px}
@media(max-width:760px){.pnc{inset:0;width:auto;height:100%;height:100dvh;border-radius:0}.pnc-l.hasdock{display:none}.pnc-l{right:16px;bottom:calc(16px + env(safe-area-inset-bottom))}.pnc-tip{bottom:calc(84px + env(safe-area-inset-bottom));right:16px}}
@media(prefers-reduced-motion:reduce){.pnc,.pnc-tip,.pnc-ty i{animation:none}}
`;
const st=document.createElement("style");st.textContent=css;document.head.appendChild(st);
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};

/* 런처: 기존 .fab 링크가 있으면 숨기고 위젯 런처로 대체 */
document.querySelectorAll("a.fab").forEach(a=>a.style.display="none");
const launcher=el("button","pnc-l");launcher.type="button";launcher.setAttribute("aria-label","AI 상담 열기");launcher.innerHTML="<i></i>AI 상담";
if(document.querySelector(".dock"))launcher.classList.add("hasdock");document.body.appendChild(launcher);launcher.onclick=()=>open();

/* /help/ 로 가는 링크는 위젯으로 열기 */
document.addEventListener("click",e=>{const a=e.target.closest&&e.target.closest("a[href]");if(!a)return;const h=a.getAttribute("href")||"";
  if(/(^|\/)help\/?(\?|$)/.test(h)&&!e.metaKey&&!e.ctrlKey){const b=(h.match(/[?&]b=(\w+)/)||[])[1];if(b&&BR[b]&&!S.msgs.length)S.b=b;e.preventDefault();open()}},true);

let box,log,ta,btn;
function save(){ss.set("pn_chat",S)}
function scroll(){log.scrollTop=log.scrollHeight}
function bubble(role,text){const m=el("div","pnc-m "+(role==="user"?"u":"a"),text);log.appendChild(m);scroll();return m}
function escCard(){const d=el("div","pnc-e");d.appendChild(el("p",null,"호스트에게 바로 연결할 수 있어요"));const t=HOST.replace(/-/g,"");
  const a=el("a",null,"전화하기");a.href="tel:"+t;const s=el("a","s","문자 보내기");s.href="sms:"+t;d.append(a,s);log.appendChild(d);scroll()}
function quick(){
  log.appendChild(el("div","pnc-lab","바로 보기"));
  const q=el("div","pnc-c");
  [["이번 주 빈자리·특가","/#deals"],["인원별 요금 계산","/#calc"],["지점 3곳 비교","/#branches"],["N CREW 혜택","/#crew"]].forEach(([t,h])=>{const a=el("a",null,t);a.href=h;a.onclick=e=>{close();if(isHome){e.preventDefault();const id=h.split("#")[1];const x=document.getElementById(id);x&&x.scrollIntoView({behavior:"smooth",block:"start"})}};q.appendChild(a)});
  log.appendChild(q)}
function brPick(){
  log.appendChild(el("div","pnc-lab","어느 지점 기준으로 알려드릴까요?"));
  const c=el("div","pnc-c");Object.entries(BR).forEach(([k,v])=>{const b=el("button",S.b===k?"on":null,v);b.type="button";b.onclick=()=>{S.b=k;save();[...c.children].forEach(x=>x.classList.remove("on"));b.classList.add("on");
    if(pending){const p=pending;pending=null;send(p,true)}else bubble("assistant",v+"점 기준으로 답할게요. 궁금한 걸 적어주세요.")};c.appendChild(b)});log.appendChild(c);scroll()}
function asks(){
  log.appendChild(el("div","pnc-lab","자주 묻는 질문"));
  const c=el("div","pnc-c");["바베큐 되나요?","주차는 어떻게 해요?","보증금은 언제 돌려받아요?","최대 몇 명까지 돼요?","에어컨·장비가 안 돼요"].forEach(t=>{const b=el("button",null,t);b.type="button";b.onclick=()=>send(t);c.appendChild(b)});log.appendChild(c)}
function render(){
  log.innerHTML="";
  bubble("assistant","안녕하세요! 플레이앤 AI 상담이에요 🎮\n요금·예약·이용 방법·장비 문제까지 24시간 바로 답해 드려요.");
  if(!S.msgs.length){quick();asks();brPick()}
  else{S.msgs.forEach(m=>bubble(m.role,m.content));}
  log.appendChild(el("div","pnc-n","AI 안내예요. 예약 확정·보증금·환불은 호스트가 확인해요."));scroll()}
function build(){
  box=el("div","pnc");box.setAttribute("role","dialog");box.setAttribute("aria-label","플레이앤 AI 상담");
  const h=el("div","pnc-h");const t=el("div","t");t.innerHTML='플레이앤 AI 상담<small><i></i>24시간 · 보통 5초 안에 답해요</small>';
  const full=el("a",null,"크게 보기");full.href="/help/"+(S.b?"?b="+S.b:"");full.addEventListener("click",e=>e.stopPropagation(),true);
  const x=el("button",null,"×");x.type="button";x.setAttribute("aria-label","닫기");x.onclick=close;
  h.append(t,el("div","sp"),full,x);
  log=el("div","pnc-b");log.setAttribute("aria-live","polite");
  const f=el("form","pnc-f");ta=el("textarea");ta.rows=1;ta.placeholder="예: 금요일 밤 8명 얼마예요?";ta.setAttribute("enterkeyhint","send");btn=el("button",null,"전송");f.append(ta,btn);
  f.onsubmit=e=>{e.preventDefault();send(ta.value)};
  ta.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();send(ta.value)}});
  ta.addEventListener("input",()=>{ta.style.height="";ta.style.height=Math.min(ta.scrollHeight,110)+"px"});
  box.append(h,log,f);document.body.appendChild(box);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&box&&!box.hidden)close()})}
function open(){tip&&tip.remove();try{sessionStorage.setItem("pn_chat_tip","1")}catch(e){}
  if(!box){build();render()}box.hidden=false;launcher.hidden=true;
  if(matchMedia("(max-width:760px)").matches)document.documentElement.style.overflow="hidden";
  setTimeout(()=>{if(!matchMedia("(max-width:760px)").matches)ta.focus()},60);
  try{window.pnTrack&&window.pnTrack("chat_open")}catch(e){}}
function close(){if(box)box.hidden=true;launcher.hidden=false;document.documentElement.style.overflow=""}
async function send(text,shown){text=(text||"").trim();if(!text||busy)return;
  if(!S.b){ta.value="";bubble("user",text);pending=text;
    bubble("assistant","지점마다 장비·요금이 조금씩 달라요. 어느 지점 기준으로 알려드릴까요?");brPick();return}
  busy=true;btn.disabled=true;ta.value="";ta.style.height="";
  if(!shown)bubble("user",text);
  S.msgs.push({role:"user",content:text});save();try{window.pnTrack&&window.pnTrack("chat_send")}catch(e){}
  const ty=el("div","pnc-ty");ty.innerHTML="<i></i><i></i><i></i>";log.appendChild(ty);scroll();
  try{const r=await fetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({b:S.b,sid:S.sid,messages:S.msgs.slice(-12),page:path})});const j=await r.json();ty.remove();
    const ans=j.answer||"잠시 연결이 원활하지 않아요. 호스트에게 연락 주세요.";bubble("assistant",ans);S.msgs.push({role:"assistant",content:ans});save();
    if(/요금|가격|얼마|빈자리|예약|특가|할인/.test(text)){const c=el("div","pnc-c");const a=el("a",null,"이번 주 빈자리·특가 보기 →");a.href="/#deals";a.onclick=e=>{close();if(isHome){e.preventDefault();document.getElementById("deals").scrollIntoView({behavior:"smooth"})}};const b=el("a",null,"요금 계산기");b.href="/#calc";b.onclick=e=>{close();if(isHome){e.preventDefault();document.getElementById("calc").scrollIntoView({behavior:"smooth"})}};c.append(a,b);log.appendChild(c);scroll()}
    if(j.escalate)escCard()}
  catch(e){ty.remove();bubble("assistant","네트워크가 불안정해요. 잠시 후 다시 시도하시거나 호스트에게 연락 주세요.");escCard()}
  busy=false;btn.disabled=false}

/* 먼저 말 걸기: 세션당 1번, 40초 머문 뒤 (예약·결제·체크인 페이지 제외) */
let tip=null;
if(!/^\/(in|out|me|j|help)\//.test(path)){let seen=null;try{seen=sessionStorage.getItem("pn_chat_tip")}catch(e){}
  if(!seen)setTimeout(()=>{if(box&&!box.hidden)return;if(document.querySelector(".sheet-bg:not([hidden])"))return;
    tip=el("div","pnc-tip");tip.innerHTML="<b>몇 명이서 오세요?</b>날짜·인원만 알려주시면 요금이랑 빈자리 바로 찾아드려요";
    const x=el("button",null,"×");x.type="button";x.setAttribute("aria-label","닫기");x.onclick=e=>{e.stopPropagation();tip.remove();tip=null};tip.appendChild(x);tip.onclick=open;document.body.appendChild(tip);
    try{sessionStorage.setItem("pn_chat_tip","1")}catch(e){}},40000)}
})();
