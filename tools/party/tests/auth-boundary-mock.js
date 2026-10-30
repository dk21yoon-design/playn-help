const {chromium}=require('playwright');const API='https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-party';
const res=[];const ok=(n,c,d='')=>{res.push({n,pass:!!c,d});console.log((c?'PASS ':'FAIL ')+n+(d?' — '+d:''))};
const EV={id:'m',title:'[모의] T7R',place:'온라인',start_at:new Date(Date.now()+3*864e5).toISOString(),end_at:new Date(Date.now()+3*864e5+36e5).toISOString(),cap:4,confirmed:0,offered:0,waitlist:0,left:4,status:'open',offer_minutes:120,info:{}};
async function page(b,seed){const p=await b.newPage({viewport:{width:375,height:900}});const calls=[];const live=new Set(['GM-TOKEN-'.padEnd(48,'x')]);
 await p.addInitScript(s=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');for(const[k,v]of Object.entries(s))localStorage.setItem(k,v)}},seed);
 await p.route(API,async r=>{const j=JSON.parse(r.request().postData());calls.push({a:j.action,t:j.token,n:j.ncrew_token});const F=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
  const valid=j.token&&live.has(j.token);
  if(j.action==='c_logout'){const n=live.delete(j.token)?1:0;return F({ok:true,revoked:n})}
  if(j.action==='c_bridge'){const t='BRIDGE-TOKEN-'.padEnd(48,'y');live.add(t);return F({ok:true,token:t,member:false})}
  if(j.action==='c_me')return F(valid?{ok:true,member:{nick:'모의',notify_sms:false,marketing_sms:false}}:{ok:false,expired:true});
  if(j.action==='list')return F({ok:true,events:[]});
  if(j.action==='info')return F({ok:true,ev:EV,login:!!valid,member:valid?{nick:'모의'}:null,rsvp:null});
  return F({ok:false})});return {p,calls}}
(async()=>{const b=await chromium.launch({proxy:{server:'http://127.0.0.1:1',bypass:'localhost,127.0.0.1'}});
 const GM='GM-TOKEN-'.padEnd(48,'x'),PN='PN-NCREW-TOKEN-0000000000';
 // 1) gm+pn → 로그아웃 → 새로고침
 {const {p,calls}=await page(b,{gm_token:GM,pn_token:PN});await p.goto('http://127.0.0.1:8765/party/');await p.waitForSelector('#logout');
  ok('gm+pn: 게임 모임 로그인 상태로 시작',await p.locator('#logout').count()===1);
  await p.click('#logout');await p.waitForTimeout(800);
  const lo=calls.filter(c=>c.a==='c_logout');ok('로그아웃은 gm_token 으로만 1회',lo.length===1&&lo[0].t===GM,JSON.stringify(lo));
  ok('pn_token 유지·gm_token 삭제',await p.evaluate(()=>localStorage.getItem('pn_token'))==='PN-NCREW-TOKEN-0000000000'&&await p.evaluate(()=>localStorage.getItem('gm_token'))===null);
  ok('새로고침 뒤 게임 모임 로그인 아님(설정 영역 없음)',await p.locator('#logout').count()===0);
  ok('pn_token 을 게임 모임 서버에 보내지 않음',!calls.some(c=>c.t===PN));
  await p.goto('http://127.0.0.1:8765/party/?e=m');await p.waitForSelector('#login');
  ok('모임 화면: 로그인 필요 + N CREW 이어받기 버튼',await p.locator('#bridge').count()===1);await p.close()}
 // 2) pn 만 있음 → 자동 로그인 없음 → 버튼 눌러야 이어받기
 {const {p,calls}=await page(b,{pn_token:PN});await p.goto('http://127.0.0.1:8765/party/?e=m');await p.waitForSelector('#login');
  ok('pn 만: 자동 로그인 없음',!calls.some(c=>c.t===PN)&&!calls.some(c=>c.a==='c_bridge'));
  await p.click('#bridge');await p.waitForTimeout(800);
  const br=calls.filter(c=>c.a==='c_bridge');ok('버튼을 눌러야 c_bridge(pn_token) 1회',br.length===1&&br[0].n===PN);
  ok('이어받은 뒤 gm_token 은 새 토큰, pn_token 유지',await p.evaluate(()=>localStorage.getItem('gm_token'))==='BRIDGE-TOKEN-'.padEnd(48,'y')&&await p.evaluate(()=>localStorage.getItem('pn_token'))==='PN-NCREW-TOKEN-0000000000');
  await p.screenshot({path:__dirname+'/t7r-bridge-375.png',fullPage:true});await p.close()}
 // 3) 토큰 없음 → 이어받기 버튼 없음
 {const {p}=await page(b,{});await p.goto('http://127.0.0.1:8765/party/?e=m');await p.waitForSelector('#login');ok('토큰 없음: 이어받기 버튼 없음',await p.locator('#bridge').count()===0);await p.close()}
 // 4) 회귀: 홈 메뉴 숨김·약관 noindex
 {const p=await b.newPage();await p.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());await p.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  ok('홈 게임 모임 링크 2곳 숨김 유지',await p.locator('a[data-party-menu][hidden]').count()===2);
  await p.goto('http://127.0.0.1:8765/party/terms/');ok('약관 noindex 유지',await p.locator('meta[name=robots][content=noindex]').count()===1);await p.close()}
 await b.close();console.log(`\n${res.filter(r=>r.pass).length}/${res.length} pass`);require('fs').writeFileSync(__dirname+'/t7rui.json',JSON.stringify(res,null,1))})();
