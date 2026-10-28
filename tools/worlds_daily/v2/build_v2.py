#!/usr/bin/env python3
"""롤드컵 데일리 W 캐러셀 v2 빌더 (2026-10-17)

사용:
  PLAYN_KEY=<intake_key> python3 tools/worlds_daily/v2/build_v2.py tools/worlds_daily/specs/<date>.json [--no-upload]

하는 일:
  1) spec의 assets(URL)를 작업 폴더로 받는다 (공식 하이라이트 프레임·팀 로고·매장 사진)
  2) 슬라이드 타입별 HTML(카드 규칙 v3 디자인)을 만들어 Playwright로 1080x1350 JPG 렌더
  3) 자동 검사(card_qa) — 하나라도 실패하면 업로드하지 않고 종료 코드 2
  4) playn-publish ?mode=upload 로 promo/worlds_daily/<date>/NN.jpg 업로드
  5) out/<date>/insert.sql 출력 (status ready, publish_at = spec.publish_at)

슬라이드 타입: cover / score / steps / next / list / cta  (아래 render_* 참고)
규칙: 출처·Riot 고지문은 카드에 넣지 않는다(캡션 끝 '출처' 블록). 매장 사진은 cta 장에만.
"""
import json, os, sys, re, hashlib, io, subprocess, urllib.request, html as H
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = "https://bjrgtoyjrggxmdexnwib.supabase.co"
STORE = BASE + "/storage/v1/object/public/playn-media/"

def esc(s):  # 텍스트(강조 마크업 허용: [노란박스] {빨강} )
    s = H.escape(str(s))
    s = re.sub(r"\[(.+?)\]", r'<span class="hl">\1</span>', s)
    s = re.sub(r"\{(.+?)\}", r'<span class="q">\1</span>', s)
    s = re.sub(r"\*(.+?)\*", r"<em>\1</em>", s)
    return s.replace("\n", "<br>")

CSS = (HERE / "v2.css").read_text(encoding="utf-8")

def top(series):
    return f'<div class="top"><span><b>PLAY N</b> · {esc(series)}</span><img class="logo" src="logo.svg"></div>'

def foot(i, n, nxt="넘겨보기 →"):
    return f'<div class="pg">{i} / {n}</div><div class="nx">{esc(nxt)}</div>'

def photo(src, top_px, bottom_px, cap=None, pos="center", capsize=40):
    c = f'<div class="cap" style="font-size:{capsize}px">{esc(cap)}</div>' if cap else ""
    return f'<div class="photo" style="top:{top_px}px;bottom:{bottom_px}px;background-image:url({src});background-position:{pos}">{c}</div>'

def render_cover(s, i, n, series):
    return (top(series) + '<div style="position:absolute;left:84px;right:84px;top:168px">'
            + (f'<span class="pill">{esc(s["pill"])}</span>' if s.get("pill") else "")
            + f'<h1 class="t" style="font-size:{s.get("size",104)}px;margin-top:36px">{esc(s["title"])}</h1></div>'
            + photo(s["photo"], s.get("photo_top", 735), 132, s.get("cap"), s.get("pos", "center"))
            + foot(i, n))

def team(t):
    return (f'<div class="tm"><img src="{t["logo"]}" alt=""><b>{esc(t["name"])}</b>'
            + (f'<small>{esc(t["sub"])}</small>' if t.get("sub") else "") + "</div>")

def render_score(s, i, n, series):
    a, b = s["a"], s["b"]
    wa, wb = ("w", "l") if a["score"] > b["score"] else ("l", "w")
    sets = "".join(f'<div class="{c}">{esc(k)}<b>{esc(v)}</b></div>' for k, v, c in s.get("sets", []))
    cols = max(1, len(s.get("sets", [])))
    body = (f'<div style="position:absolute;left:84px;right:84px;top:170px;display:grid;gap:34px">'
            f'<h2 class="t" style="font-size:{s.get("size",84)}px">{esc(s["title"])}</h2>'
            f'<div class="mt">{team(a)}<div class="sc"><span class="{wa}">{a["score"]}</span><i>:</i><span class="{wb}">{b["score"]}</span></div>{team(b)}</div>'
            + (f'<div class="sets" style="grid-template-columns:repeat({cols},1fr)">{sets}</div>' if sets else "") + "</div>")
    ph = photo(s["photo"], s.get("photo_top", 940), 132, s.get("cap"), s.get("pos", "center 30%"), 34) if s.get("photo") else ""
    return top(series) + body + ph + foot(i, n)

def render_steps(s, i, n, series):
    steps = "".join(f'<div class="st"><span class="k">{esc(k)}</span><p>{esc(m)}<br><span>{esc(sub)}</span></p></div>' for k, m, sub in s["steps"])
    stats = "".join(f'<div><small>{esc(l)}</small><b class="{"sm" if len(re.sub("<[^>]+>","",v))>9 else ""}">{esc(v)}</b></div>' for l, v in s.get("stats", []))
    return (top(series) + f'<div style="position:absolute;left:84px;right:84px;top:170px;display:grid;gap:34px">'
            f'<h2 class="t" style="font-size:{s.get("size",84)}px">{esc(s["title"])}</h2><div class="steps">{steps}</div>'
            + (f'<div class="stats" style="grid-template-columns:repeat({len(s["stats"])},1fr)">{stats}</div>' if s.get("stats") else "")
            + "</div>" + foot(i, n))

def side(t, right=False):
    if t.get("logo"):
        img = f'<img src="{t["logo"]}" alt="">'
    elif t.get("abbr"):  # 로고 없는 팀: 로고 자리에 약칭 텍스트
        img = f'<span class="tbd" style="font-size:{34 if len(t["abbr"])>2 else 42}px;border-style:solid">{esc(t["abbr"])}</span>'
    else:
        img = '<span class="tbd">?</span>'
    nm = f'<span style="font-size:{32 if len(t["name"])>5 else 40}px">{esc(t["name"])}</span>'
    return f'<div class="side{" r" if right else ""}">' + (nm + img if right else img + nm) + "</div>"

def render_next(s, i, n, series):
    ms = "".join(
        f'<div class="mc{" hot" if m.get("hot") else ""}"><div class="d">{esc(m["date"])}</div>'
        f'<div class="row">{side(m["a"])}<div class="vs">VS</div>{side(m["b"], True)}</div>'
        + (f'<p>{esc(m["note"])}</p>' if m.get("note") else "") + "</div>" for m in s["matches"])
    chips = "".join(f"<span>{esc(c)}</span>" for c in s.get("chips", []))
    return (top(series) + f'<div style="position:absolute;left:84px;right:84px;top:170px;display:grid;gap:26px">'
            f'<h2 class="t" style="font-size:{s.get("size",80)}px">{esc(s["title"])}</h2>{ms}'
            + (f'<div class="chips">{chips}</div>' if chips else "") + "</div>" + foot(i, n))

def render_list(s, i, n, series):
    items = "".join(f'<div class="st"><span class="k">{esc(k)}</span><p>{esc(m)}' + (f'<br><span>{esc(sub)}</span>' if sub else "") + "</p></div>" for k, m, sub in s["items"])
    return (top(series) + f'<div style="position:absolute;left:84px;right:84px;top:170px;display:grid;gap:30px">'
            f'<h2 class="t" style="font-size:{s.get("size",84)}px">{esc(s["title"])}</h2><div class="steps">{items}</div></div>' + foot(i, n))

def render_cta(s, i, n, series):
    return (top(series) + f'<div style="position:absolute;left:84px;right:84px;top:168px"><h2 class="t" style="font-size:{s.get("size",96)}px">{esc(s["title"])}</h2></div>'
            + photo(s["photo"], s.get("photo_top", 640), 330, s.get("cap"), s.get("pos", "center 60%"), 34)
            + f'<div style="position:absolute;left:84px;right:84px;bottom:128px;display:grid;gap:18px">'
            f'<p class="line">{esc(s["line"])}</p><div><span class="url">{esc(s.get("url","playn.kr/worlds"))}</span></div></div>'
            + foot(i, n, s.get("next", "같이 볼 친구한테 보내 👀")))

R = {"cover": render_cover, "score": render_score, "steps": render_steps, "next": render_next, "list": render_list, "cta": render_cta}

def fetch_assets(spec, work):
    for name, url in spec.get("assets", {}).items():
        dst = work / name
        if dst.exists():
            continue
        if url.startswith("http"):
            urllib.request.urlretrieve(url, dst)
        else:
            dst.write_bytes(Path(url).read_bytes())
    for f in ("jalnan.woff", "logo.svg"):
        if not (work / f).exists():
            urllib.request.urlretrieve(STORE + "templates/worlds_v2/" + f, work / f)

BANNED = ["협업", "공식 파트너", "파트너십", "후원", "제휴", "출처", "Riot Games", "영상:", "사진:"]

def qa(page, n, spec, work):
    errs = []
    info = page.evaluate("""() => [...document.querySelectorAll('.s')].map(s => {
      const r = s.getBoundingClientRect(); const bad = [];
      s.querySelectorAll('h1,h2,p,span,b,small,div.cap,div.d,.chips span,.url').forEach(e => {
        const q = e.getBoundingClientRect(); if (!q.width) return;
        if (q.left < r.left - 1 || q.right > r.right + 1 || q.top < r.top - 1 || q.bottom > r.bottom + 1) bad.push(e.textContent.trim().slice(0, 20));
        if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow === 'hidden') bad.push('잘림:' + e.textContent.trim().slice(0, 20));
      });
      const imgs = [...s.querySelectorAll('img')].filter(i => !i.complete || !i.naturalWidth).map(i => i.src.split('/').pop());
      const bgs = [...s.querySelectorAll('.photo')].map(p => p.style.backgroundImage);
      return {w: r.width, h: r.height, text: s.innerText, bad, imgs, bgs};
    })""")
    if len(info) != n: errs.append(f"장수 {len(info)} != {n}")
    if not page.evaluate("document.fonts.check('40px Jalnan')"): errs.append("잘난체 폰트 로드 실패")
    for k, s in enumerate(info, 1):
        if (round(s["w"]), round(s["h"])) != (1080, 1350): errs.append(f"{k}장 크기 {s['w']}x{s['h']}")
        if s["bad"]: errs.append(f"{k}장 넘침: {s['bad'][:3]}")
        if s["imgs"]: errs.append(f"{k}장 이미지 로드 실패: {s['imgs']}")
        for w in BANNED:
            if w in s["text"]: errs.append(f"{k}장 금지어 '{w}' (출처·고지문은 캡션으로)")
        for m in re.finditer(r"(\d+)\s*표", s["text"]):
            if int(m.group(1)) < 10: errs.append(f"{k}장 표 수 {m.group(0)} — 10표 미만은 숫자 대신 순위·문구로")
        if f"{k} / {n}" not in s["text"]: errs.append(f"{k}장 쪽수 표기 없음")
    # 매장 사진은 cta 장에만
    store = set(spec.get("store_photos", []))
    for k, sl in enumerate(spec["slides"], 1):
        if sl["type"] != "cta" and sl.get("photo") in store: errs.append(f"{k}장에 매장 사진 — 매장 사진은 마지막 cta 장에만")
        if sl["type"] == "cover" and "promo/worlds_frames/" not in str(spec.get("assets", {}).get(sl.get("photo", ""), "")):
            errs.append("표지 사진은 공식 경기 장면(storage promo/worlds_frames/)이어야 함")
    # 표지 사진 중복(직전 3편)
    cov = next((sl.get("photo") for sl in spec["slides"] if sl["type"] == "cover"), None)
    if cov and (work / cov).exists():
        h = hashlib.md5((work / cov).read_bytes()).hexdigest()
        used = HERE / "used_covers.json"
        hist = json.loads(used.read_text()) if used.exists() else []
        if h in [x["md5"] for x in hist[-3:]]: errs.append("표지 사진이 직전 3편과 같음")
        spec["_cover_md5"] = h
    return errs

def main():
    spec_path = Path(sys.argv[1]); no_up = "--no-upload" in sys.argv
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    date = spec["date"]; series = spec.get("series", "롤드컵 데일리")
    work = HERE / "out" / date; work.mkdir(parents=True, exist_ok=True)
    fetch_assets(spec, work)
    n = len(spec["slides"])
    body = "".join(f'<div class="s" id="c{i}">{R[s["type"]](s, i, n, series)}</div>' for i, s in enumerate(spec["slides"], 1))
    page_html = ('<!doctype html><html lang="ko"><head><meta charset="utf-8">'
                 '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">'
                 f"<style>{CSS}</style></head><body>{body}</body></html>")
    (work / "cards.html").write_text(page_html, encoding="utf-8")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1080, "height": 1350})
        pg.goto("file://" + str(work / "cards.html")); pg.wait_for_timeout(1500)
        errs = qa(pg, n, spec, work)
        for i in range(1, n + 1):
            pg.query_selector(f"#c{i}").screenshot(path=str(work / f"{i:02d}.png"))
        b.close()
    from PIL import Image
    for i in range(1, n + 1):
        Image.open(work / f"{i:02d}.png").convert("RGB").save(work / f"{i:02d}.jpg", quality=92)
    if errs:
        print("자동 검사 실패:"); [print(" -", e) for e in errs]; sys.exit(2)
    print("자동 검사 통과", n, "장")
    if no_up:
        return
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "reelkit"))
    from upload import upload  # PLAYN_KEY 또는 PLAYN_TICKET(예약 작업용 3시간 티켓)
    urls = [upload(str(work / f"{i:02d}.jpg"), f"promo/worlds_daily/{date}/{i:02d}.jpg") for i in range(1, n + 1)]
    q = lambda s: "$c$" + s + "$c$"
    sql = ("insert into playn_ig_queue(title,kind,status,publish_at,image_urls,caption,first_comment) values ("
           f"{q(spec['title'])},'carousel','{spec.get('status','ready')}','{spec['publish_at']}',array[{','.join(repr(u) for u in urls)}],"
           f"{q(spec['caption'])},{q(spec.get('first_comment',''))}) returning id;")
    (work / "insert.sql").write_text(sql, encoding="utf-8")
    if spec.get("_cover_md5"):
        used = HERE / "used_covers.json"
        hist = json.loads(used.read_text()) if used.exists() else []
        hist.append({"date": date, "md5": spec["_cover_md5"]}); used.write_text(json.dumps(hist[-30:], ensure_ascii=False, indent=1))
    print("업로드 완료 · SQL:", work / "insert.sql")

if __name__ == "__main__":
    main()
