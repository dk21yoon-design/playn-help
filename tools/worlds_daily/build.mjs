// 롤드컵 데일리 홍보 캐러셀 빌더
// 사용: PLAYN_KEY=<intake_key> node tools/worlds_daily/build.mjs tools/worlds_daily/specs/2026-10-08.json [--no-upload]
// 결과: out/<date>/NN.jpg 렌더 → (업로드) playn-media/promo/worlds_daily/<date>/NN.jpg → 큐 INSERT SQL 출력
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
let chromium;
try { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); } catch { ({ chromium } = await import("playwright")); }
const DIR = path.dirname(fileURLToPath(import.meta.url));
const specPath = process.argv[2]; const noUp = process.argv.includes("--no-upload");
if (!specPath) { console.error("spec path required"); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const out = path.join(DIR, "out", spec.date); fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(DIR, "template.html"), "utf8").replace("<script>", `<script>window.SPEC=${JSON.stringify(spec)};</script><script>`);
const tmp = path.join(DIR, `_render_${spec.date}.html`); fs.writeFileSync(tmp, html);
const br = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
const pg = await br.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await pg.goto("file://" + tmp, { waitUntil: "networkidle" }); await pg.waitForTimeout(1200);
// 넘침 검사: 본문이 하단 푸터(1350-150) 침범하면 실패
const ov = await pg.evaluate(() => [...document.querySelectorAll("section.s")].map((s, i) => { const r = s.getBoundingClientRect(); let w = 0; s.querySelectorAll(".in *").forEach(e => { const b = e.getBoundingClientRect(); w = Math.max(w, b.bottom - r.top); }); return [i + 1, Math.round(w)]; }));
const bad = ov.filter(([, b]) => b > 1200);
const files = []; const secs = await pg.$$("section.s");
for (let i = 0; i < secs.length; i++) { const f = path.join(out, String(i + 1).padStart(2, "0") + ".jpg"); await secs[i].screenshot({ path: f, type: "jpeg", quality: 92 }); files.push(f); }
await br.close(); fs.unlinkSync(tmp);
console.log(JSON.stringify({ overflow: ov, bad }));
if (bad.length) { console.error("OVERFLOW — 텍스트 줄이고 다시 빌드"); process.exit(2); }
if (noUp) { console.log(JSON.stringify({ files })); process.exit(0); }
const KEY = process.env.PLAYN_KEY; if (!KEY) { console.error("PLAYN_KEY missing"); process.exit(1); }
const urls = [];
for (const f of files) {
  const p = `${spec.folder || "promo/worlds_daily/" + spec.date}/${path.basename(f)}`;
  const r = await fetch(`https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-publish?mode=upload&path=${encodeURIComponent(p)}`, { method: "POST", headers: { "x-playand-key": KEY, "content-type": "image/jpeg" }, body: fs.readFileSync(f) });
  const j = await r.json(); if (!j.ok) { console.error("upload fail", f, j); process.exit(3); } urls.push(j.url);
}
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sql = `insert into playn_ig_queue (title,kind,image_urls,caption,first_comment,publish_at,status) values (${q(spec.title)},'carousel',array[${urls.map(q).join(",")}],${q(spec.caption)},${spec.first_comment ? q(spec.first_comment) : "null"},${q(spec.publish_at)},'ready') returning id;`;
fs.writeFileSync(path.join(out, "insert.sql"), sql);
console.log(JSON.stringify({ urls, sql_file: path.join(out, "insert.sql") }));
