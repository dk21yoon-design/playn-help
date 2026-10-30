const {chromium}=require('playwright');const OUT=process.env.OUT||__dirname;
const API='https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-party';
const res=[];const ok=(n,c,d='')=>{res.push({n,pass:!!c,d});console.log((c?'PASS ':'FAIL ')+n+(d?' — '+d:''))};
(async()=>{
 const b=await chromium.launch({proxy:{server:'http://127.0.0.1:1',bypass:'localhost,127.0.0.1'}});
 // 1) 가입 화면 (모의 응답)
 for(const vw of [375,1440]){
 const p=await b.newPage({viewport:{width:vw,height:900}});const calls=[];
 await p.addInitScript(()=>localStorage.setItem('gm_token','MOCKTOKEN-0000000000'));
 await p.route(API,async r=>{const j=JSON.parse(r.request().postData());calls.push(j);
  const F=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
  if(j.action==='c_me')return F({ok:true,member:null});
  if(j.action==='info')return F({ok:true,login:true,member:null,rsvp:null,ev:{id:'m',title:'[모의] 가입 시험',place:'온라인',start_at:new Date(Date.now()+86400e3*3).toISOString(),end_at:new Date(Date.now()+86400e3*3+3600e3).toISOString(),cap:4,confirmed:1,offered:0,waitlist:0,left:3,status:'open',offer_minutes:120,info:{}}});
  if(j.action==='c_join')return F({ok:false,error:'모의 중단'});return F({ok:false})});
 await p.goto('http://127.0.0.1:8765/party/?e=m');await p.waitForSelector('#joinGo');
 const t=await p.locator('#join').innerText();
 ok(vw+': N CREW와 별개 안내',t.includes('N CREW 가입·문자 동의와는 별개'));
 ok(vw+': 필수 2개(만14세·약관)·선택 2개',t.includes('(필수) 만 14세 이상')&&t.includes('(필수) 이용 약관')&&t.includes('(선택) 신청한 모임 안내')&&t.includes('(선택) 새 모임·이벤트 광고'));
 ok(vw+': 체크 기본값 모두 꺼짐',await p.evaluate(()=>['age14','terms','nsms','msms'].every(id=>!document.getElementById(id).checked)));
 ok(vw+': 약관·개인정보 링크',await p.locator('#join a[href="terms/#terms"]').count()===1&&await p.locator('#join a[href="terms/#privacy"]').count()===1);
 await p.fill('#nick','모의닉');await p.click('#joinGo');await p.waitForTimeout(200);
 ok(vw+': 만14세 미체크 → 요청 없음',!calls.some(c=>c.action==='c_join')&&(await p.locator('#m').innerText()).includes('만 14세'));
 await p.check('#age14');await p.click('#joinGo');await p.waitForTimeout(200);
 ok(vw+': 약관 미체크 → 요청 없음',!calls.some(c=>c.action==='c_join'));
 await p.check('#terms');await p.click('#joinGo');await p.waitForTimeout(400);
 const cj=calls.find(c=>c.action==='c_join');
 ok(vw+': 전송값 age14·terms·약관 판·선택 false',cj&&cj.age14===true&&cj.terms===true&&cj.terms_version==='party-2026-10-30-draft'&&cj.notify_sms===false&&cj.marketing_sms===false,JSON.stringify(cj&&{...cj,token:'-'}));
 ok(vw+': 가로 넘침 없음',await p.evaluate(w=>document.documentElement.scrollWidth<=w,vw));
 await p.screenshot({path:OUT+`/t7-join-${vw}.png`,fullPage:true});await p.close();}
 // 2) 설정: 탈퇴·로그아웃
 {const p=await b.newPage({viewport:{width:375,height:900}});const calls=[];
 await p.addInitScript(()=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('gm_token','MOCKTOKEN-0000000000')}});
 let left=false;
 await p.route(API,async r=>{const j=JSON.parse(r.request().postData());calls.push(j.action);const F=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
  if(j.action==='c_me')return F(left?{ok:true,member:null}:{ok:true,member:{nick:'모의',notify_sms:true,marketing_sms:false}});
  if(j.action==='list')return F({ok:true,events:[]});
  if(j.action==='c_leave'){if(calls.filter(x=>x==='c_leave').length===1)return F({ok:false,error:'진행 중인 신청 1건을 먼저 취소해 주세요'});left=true;return F({ok:true})}
  if(j.action==='c_logout')return F({ok:true});return F({ok:true})});
 let dmsg='';p.on('dialog',d=>{dmsg=d.message();d.accept()});
 await p.goto('http://127.0.0.1:8765/party/');await p.waitForSelector('#leave');
 await p.click('#leave');await p.waitForTimeout(400);
 ok('탈퇴 확인 문구(N CREW 영향 없음)',dmsg.includes('N CREW에는 영향이 없어요'));
 ok('진행 중 신청 있으면 오류 표시·로그아웃 안 함',(await p.locator('#sMsg').innerText()).includes('먼저 취소')&&!calls.includes('c_logout'));
 await p.click('#leave');await p.waitForTimeout(800);
 ok('탈퇴 성공 → 서버 로그아웃 호출·토큰 삭제',calls.includes('c_logout')&&await p.evaluate(()=>localStorage.getItem('gm_token'))===null);
 await p.close();}
 // 3) N CREW 토큰(pn_token)만 있을 때 로그아웃은 서버 세션을 끝내지 않음
 {const p=await b.newPage();const calls=[];
 await p.addInitScript(()=>{localStorage.setItem('pn_token','NCREWTOKEN-000000000')});
 await p.route(API,async r=>{const j=JSON.parse(r.request().postData());calls.push(j.action);const F=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
  if(j.action==='c_me')return F({ok:true,member:{nick:'모의',notify_sms:false,marketing_sms:false}});if(j.action==='list')return F({ok:true,events:[]});return F({ok:true})});
 await p.goto('http://127.0.0.1:8765/party/');await p.waitForSelector('#logout');await p.click('#logout');await p.waitForTimeout(600);
 ok('N CREW 로그인 토큰은 서버 로그아웃 안 보냄·pn_token 유지',!calls.includes('c_logout')&&await p.evaluate(()=>localStorage.getItem('pn_token'))==='NCREWTOKEN-000000000');
 await p.close();}
 // 4) 홈 메뉴: 게임 모임 링크 준비만, 화면에 안 보임
 for(const vw of [1440,375]){const p=await b.newPage({viewport:{width:vw,height:900}});
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
  await p.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  if(vw===375){await p.click('#menuBtn').catch(()=>{});await p.waitForTimeout(400)}
  const n=await p.locator('a[data-party-menu]').count();
  const vis=await p.locator('a[data-party-menu]').evaluateAll(as=>as.filter(a=>a.offsetParent!==null&&getComputedStyle(a).display!=='none').length);
  ok(vw+': 홈 메뉴 게임 모임 링크 2곳 준비·보이는 것 0',n===2&&vis===0,`count=${n} visible=${vis}`);
  const order=await p.evaluate(()=>[...document.querySelectorAll('header nav a')].map(a=>a.textContent).join('|'));
  if(vw===1440)ok('상단 순서: 롤드컵 이벤트|게임 모임|리그',order.includes('롤드컵 이벤트|게임 모임|리그'),order);
  await p.close();}
 // 5) 약관 페이지
 {const p=await b.newPage({viewport:{width:375,height:900}});await p.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());await p.goto('http://127.0.0.1:8765/party/terms/');
  const t=await p.innerText('main');ok('약관: 초안 표시·noindex·보관 기간·국외 보관·야간 광고 금지',t.includes('초안')&&t.includes('1년')&&t.includes('일본(도쿄)')&&t.includes('밤 9시')&&await p.locator('meta[name=robots][content=noindex]').count()===1);
  ok('약관 375px 가로 넘침 없음',await p.evaluate(()=>document.documentElement.scrollWidth<=375));
  await p.screenshot({path:OUT+'/t7-terms-375.png',fullPage:true});await p.close();}
 await b.close();require('fs').writeFileSync(OUT+'/t7ui.json',JSON.stringify(res,null,1));
 console.log(`\n${res.filter(r=>r.pass).length}/${res.length} pass`);
})();
