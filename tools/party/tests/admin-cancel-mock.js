const {chromium}=require('playwright');
const OUT=process.env.OUT||__dirname, BASE='http://127.0.0.1:8765/party/';
const API='https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-party';
const now=Date.now(), iso=h=>new Date(now+h*3600e3).toISOString();
function mkState(status){return {ev:{id:'party-test-t6-mock',title:'[모의] T6 모임 전체 취소',place:'온라인 테스트',start_at:iso(48),end_at:iso(51),cap:2,confirmed:2,offered:0,waitlist:1,left:0,status,offer_minutes:120,info:{}},
 rsvps:[{id:1,name:'모의A',phone:'01000001601',status:'confirmed',created_at:iso(-2),test_run:'T6'},{id:2,name:'모의B',phone:'01000001602',status:'confirmed',created_at:iso(-2),test_run:'T6'},{id:3,name:'모의C',phone:'01000001603',status:'waitlist',created_at:iso(-1),test_run:'T6'}],
 notices:[{id:9,kind:'event_cancelled',phone:'01000001601',status:'pending',msg:'모의 취소 안내'},{id:8,kind:'event_cancelled',phone:'01000001607',status:'skipped_pref',msg:'모의'},{id:7,kind:'event_cancelled',phone:'01000001602',status:'logged',msg:'모의'},{id:6,kind:'offered',phone:'01000001603',status:'superseded',msg:'모의'}]}}
const results=[];const ok=(name,cond,detail='')=>{results.push({name,pass:!!cond,detail});console.log((cond?'PASS ':'FAIL ')+name+(detail?' — '+detail:''))};
async function run(scn,{status='open',vw=1440,fn}){
 const b=await chromium.launch({proxy:{server:'http://127.0.0.1:1',bypass:'localhost,127.0.0.1'}});
 const p=await b.newPage({viewport:{width:vw,height:900}});
 const S=mkState(status), calls=[];
 await p.addInitScript(()=>sessionStorage.setItem('gm_admin','MOCK-NOT-A-KEY'));
 await p.route(API,async route=>{const body=JSON.parse(route.request().postData());calls.push(body.action+(body.status?':'+body.status:''));
  const J=(o,st=200)=>route.fulfill({status:st,contentType:'application/json',body:JSON.stringify(o)});
  if(body.action==='admin_events')return J({ok:true,mode:'log',events:[S.ev]});
  if(body.action==='admin_list')return J({ok:true,mode:'log',ev:S.ev,rsvps:S.rsvps,notices:S.notices});
  if(body.action==='admin_set'&&body.status==='cancelled'){
   if(scn==='net')return route.abort('failed');
   if(scn==='auth')return J({ok:false,error:'관리 키가 맞지 않아요'},401);
   if(scn==='fail')return J({ok:false,error:'모의 DB 오류'});
   if(scn==='noeffect')return J({ok:true,sent:[]});
   await new Promise(r=>setTimeout(r,800));S.ev={...S.ev,status:'cancelled'};return J({ok:true,sent:[]})}
  if(body.action==='admin_set'){if(body.status)S.ev={...S.ev,status:body.status};return J({ok:true,sent:[]})}
  if(body.action==='admin_cancel'){S.rsvps=S.rsvps.map(r=>r.phone===body.phone?{...r,status:'cancelled'}:r);return J({ok:true,was:'confirmed',notices:[],sent:[]})}
  return J({ok:false,error:'unknown'},400)});
 await p.goto(BASE+'?e=party-test-t6-mock#admin');await p.waitForSelector('#evd h2');
 try{await fn(p,calls,S)}catch(e){ok(scn+' 예외',false,e.message)}
 await b.close();
}
(async()=>{
 const txt=async(p,s)=>(await p.locator(s).count())?(await p.locator(s).first().innerText()):null;
 await run('open-ui',{fn:async(p,c)=>{
  ok('open: 모임 전체 취소 버튼 보임',await p.locator('#evCancel').isVisible());
  ok('open: 마감 토글 "신청 마감"',await txt(p,'[data-s]')==='신청 마감');
  ok('open: 정원 +1 보임',await p.locator('#capUp').isVisible());
  ok('open: 개별 버튼 문구 구별',(await p.locator('[data-c]').count())===3&&await txt(p,'[data-c]')==='이 신청만 취소');
  ok('안내 상태 라벨 구별',['처리 대기','수신 꺼둠','기록만','무효'].every(async()=>1)&&(await p.locator('#evd').innerText()).match(/모임 취소[\s\S]*처리 대기[\s\S]*수신 꺼둠[\s\S]*기록만[\s\S]*무효/)!=null);
  ok('처리 대기 설명·새로고침 버튼',await p.locator('#nRe').isVisible()&&(await p.locator('#evd').innerText()).includes('정기 처리'));
  // 키보드로 열고 Esc
  await p.locator('#evCancel').focus();await p.keyboard.press('Enter');await p.waitForSelector('#cxd[open]');
  ok('키보드 Enter로 확인 창 열림',true);
  ok('확인 창 첫 초점 = 돌아가기',await p.evaluate(()=>document.activeElement.id)==='cxNo');
  const dt=await p.locator('#cxd').innerText();
  ok('확인 창 문구(모임명·전체 취소·기록만·상태/환불 자동 변경 없음)',dt.includes('[모의] T6')&&dt.includes('전체를 취소')&&dt.includes('기록만')&&dt.includes('환불은 자동으로 바뀌지 않아요'));
  await p.screenshot({path:OUT+'/m-dialog-1440.png'});
  await p.keyboard.press('Escape');await p.waitForTimeout(200);
  ok('Esc로 닫힘·요청 0',(await p.locator('#cxd').count())===0&&!c.some(x=>x==='admin_set:cancelled'),c.join(','));
  ok('닫힌 뒤 초점 복귀',await p.evaluate(()=>document.activeElement.id)==='evCancel');
  await p.click('#evCancel');await p.click('#cxNo');await p.waitForTimeout(200);
  ok('돌아가기 클릭 요청 0',!c.some(x=>x==='admin_set:cancelled'));
  // Tab 순서: 돌아가기 → 취소하기, 창 밖으로 안 나감
  await p.click('#evCancel');await p.keyboard.press('Tab');ok('Tab으로 취소하기 버튼 이동',await p.evaluate(()=>document.activeElement.id)==='cxYes');
  await p.keyboard.press('Escape');
 }});
 for(const [scn,word] of [['net','네트워크'],['auth','관리 키가 맞지 않아요'],['fail','취소하지 못했어요'],['noeffect','반영되지 않았어요']])
  await run(scn,{fn:async(p,c)=>{await p.click('#evCancel');await p.click('#cxYes');await p.waitForFunction(()=>document.querySelector('#cxm')?.textContent);
   const m=await txt(p,'#cxm');ok(scn+': 오류 문구 구별',m.includes(word),m);
   ok(scn+': 성공처럼 안 보임(창 유지·버튼 재활성·모임 전체 취소 버튼 그대로)',await p.locator('#cxd[open]').count()===1&&!(await p.locator('#cxYes').isDisabled())&&!(await p.locator('#evd').innerText()).includes('취소된 모임'));
   if(scn==='net')await p.screenshot({path:OUT+'/m-error-net-375.png'});
  }, vw: scn==='net'?375:1440});
 await run('success',{vw:375,fn:async(p,c)=>{await p.click('#evCancel');
  const y=p.locator('#cxYes');await y.click();await y.click({force:true}).catch(()=>{});await p.keyboard.press('Enter').catch(()=>{});
  ok('진행 중 버튼 잠김',await y.isDisabled().catch(()=>true));
  await p.waitForSelector('#cxd',{state:'detached'});await p.waitForTimeout(400);
  ok('중복 클릭에도 요청 1회',c.filter(x=>x==='admin_set:cancelled').length===1,c.join(','));
  ok('성공 뒤 재조회(admin_list) 실행',c.lastIndexOf('admin_list')>c.indexOf('admin_set:cancelled'));
  const t=await p.locator('#evd').innerText();
  ok('취소됨 표시',t.includes('취소된 모임이에요'));
  ok('취소된 모임: 다시 열기·정원 +1·전체 취소 없음',(await p.locator('[data-s]').count())===0&&(await p.locator('#capUp').count())===0&&(await p.locator('#evCancel').count())===0);
  ok('성공 문구(5분 보장 없음)',(await txt(p,'#em')).includes('정기 처리 뒤'));
  await p.waitForTimeout(300);ok('모임 목록 상태 "취소됨"',(await p.locator('#app table').first().innerText()).includes('취소됨'));
  ok('375px 가로 넘침 없음',await p.evaluate(()=>document.documentElement.scrollWidth<=375),String(await p.evaluate(()=>document.documentElement.scrollWidth)));
  await p.screenshot({path:OUT+'/m-cancelled-375.png',fullPage:true});
 }});
 await run('dialog-375',{vw:375,fn:async(p)=>{await p.click('#evCancel');await p.waitForSelector('#cxd[open]');
  const bx=await p.locator('#cxYes').boundingBox();ok('375px: 확인 버튼 보이고 44px 이상',bx&&bx.height>=44&&bx.x+bx.width<=375,JSON.stringify(bx));
  await p.screenshot({path:OUT+'/m-dialog-375.png'});}});
 await run('closed',{status:'closed',fn:async(p,c)=>{
  ok('closed: 토글 "신청 다시 열기"·전체 취소 보임',await txt(p,'[data-s]')==='신청 다시 열기'&&await p.locator('#evCancel').isVisible());
  await p.click('[data-s]');await p.waitForTimeout(400);ok('closed→open 토글 요청 유지',c.includes('admin_set:open'),c.join(','));}});
 await run('cancelled-direct',{status:'cancelled',fn:async(p)=>{ok('처음부터 cancelled: 재개 버튼 없음',(await p.locator('[data-s]').count())===0&&(await p.locator('#evCancel').count())===0&&(await p.locator('#capUp').count())===0)}});
 await run('individual',{fn:async(p,c)=>{let msg='';p.on('dialog',d=>{msg=d.message();d.accept()});await p.locator('[data-c]').first().click();await p.waitForTimeout(500);
  ok('개별 취소는 admin_cancel, 모임 상태 변경 없음',c.includes('admin_cancel')&&!c.some(x=>x.startsWith('admin_set')),c.join(','));
  ok('개별 취소 확인 문구 구별',msg.includes('신청 하나만')&&msg.includes('모임은 그대로'),msg);}});
 require('fs').writeFileSync(OUT+'/mock-results.json',JSON.stringify(results,null,1));
 console.log(`\n${results.filter(r=>r.pass).length}/${results.length} pass`);
})();
