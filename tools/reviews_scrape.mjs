import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const [space,pages]=[process.argv[2],+process.argv[3]||4];
const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const pg=await br.newPage({viewport:{width:1280,height:900}});
await pg.goto('https://www.spacecloud.kr/space/'+space,{waitUntil:'networkidle',timeout:60000});
const grab=()=>pg.evaluate(()=>{const ul=[...document.querySelectorAll('ul.review_list')].pop();if(!ul)return[];
 return [...ul.querySelectorAll(':scope > li')].map(li=>{const g=li.querySelector('[class*="guest_name"]');const p=li.querySelector('[class*="p_review"]');
  const t=(li.textContent.match(/\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}/)||[])[0];const imgs=[...li.querySelectorAll('img')].map(i=>i.src).filter(s=>/naverncp|spacecloud/.test(s)&&!/ico_/.test(s));
  const stars=li.querySelectorAll('[class*="star"] [class*="on"], .on').length;
  return {guest:g?.textContent.trim(),body:p?.textContent.trim(),when:t,imgs:imgs.slice(0,3)}})});
let all=[...(await grab())];
for(let n=2;n<=pages;n++){
 const ok=await pg.evaluate((n)=>{const ul=[...document.querySelectorAll('ul.review_list')].pop();let el=ul;while(el&&!el.parentElement.querySelector('.paging'))el=el.parentElement;const pag=el?.parentElement.querySelector('.paging');if(!pag)return false;
   const a=[...pag.querySelectorAll('a')].find(x=>x.textContent.trim()===String(n));if(!a)return false;a.click();return true},n);
 if(!ok)break;await pg.waitForTimeout(2500);all.push(...(await grab()));}
const seen=new Set();all=all.filter(r=>r.body&&!seen.has(r.guest+r.when)&&seen.add(r.guest+r.when));
console.log(JSON.stringify(all));await br.close();
