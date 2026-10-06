#!/usr/bin/env python3
"""PLAY N 릴스 빌더 v3.1 (2026-10-05 레이아웃 정돈: 가독성 판·배지 재디자인·겹침 자동 축소·선수 보이스 장면)
  새 장면 옵션: "mic": true 또는 "mic": "T1 팀 보이스" → 그 장면은 원본 소리(선수 마이크·인게임 보이스)를 살리고 음악을 낮춤. clip.file 필요.
               "caption": "자막" → 영상 아래쪽 노란 자막(보이스 번역·대사용).
              "preview_music": {"url": "<인스타 음악 preview URL>", "start": "auto"} → out_preview.mp4 (사장님 확인용, 실제 인스타 곡). music.start도 "auto"면 드롭 지점 자동 탐색.
  "vs": {"a": "로고A.png", "b": "로고B.png", "an": "HLE", "bn": "BLG", "tag": "MSI 결승 3:2 리매치?"} → 영상 가운데 로고 맞대결 카드.
  "logo": "팀로고.png" → 아래 팀 이름 왼쪽에 로고.
  badge: "4위"·"후보 4"·"1" 처럼 숫자를 넣으면 숫자 크게 + 라벨 작게.
사용법: python3 playn_reel_v3.py spec.json out.mp4
  → out.mp4(음악 있으면 음악 포함, 없으면 무음 트랙) + out_silent.mp4(항상 무음 트랙) + out_cover.jpg

화면(1080x1920): 흐린 배경(같은 영상) + 가운데 1080x720 영상(y 620~1340) + 핑크 라인 #FF2E6E
  상단 y 200~600 : kicker 알약 + 2줄 제목(한 줄 10자 안팎). [무료] → 초록 #2BE07A 박스, {단어} → 핑크 강조
  영상 위       : 순위 배지(좌상), 가운데 큰 문구(center), Steam 한국어 리뷰 카드(좌하), 출처(우하, 작게)
  영상 아래     : 게임명 / 칩(무료·최대 ○인·한국어) / 펀치라인 1줄 / 하단 PLAY N · @playn_no.1 (y 1600 안쪽)
  CTA 장면      : cta=true → 영상 아래에 큰 2줄 문구 + 알약("📌 저장 …")

spec.json 예시
{
 "kicker": "N명이 모이면 · 무료 TOP3",
 "title": ["중간고사 끝나면", "넷이 할 [무료] {게임}"],
 "scenes": [
  {"dur": 1.5, "clip": {"steam_appid": 1172470, "start": 12}, "center": "TOP 3", "sub": "설치 0원, 오늘 밤 바로 가능"},
  {"dur": 3.2, "clip": {"steam_appid": 843380, "trailer": 0, "start": 30, "crop_top": true},
   "badge": "3위", "name": "슈퍼 애니멀 로얄", "chips": ["무료", "최대 4인 스쿼드", "한국어"],
   "line": "귀여운 동물로 하는 {배그} 🐾", "review": "도파민이 터져요", "credit": "영상: Pixile 공식 Steam 트레일러"},
  {"dur": 2.0, "clip": {"file": "local.mp4", "start": 3}, "center": "대망의 {1위}는…?", "sub": "친구랑 하면 {우정 파괴} 확정"},
  {"dur": 2.0, "image": "https://…/cover.jpg", "cta": true, "line": "시험 끝난 친구 {태그}하고\\n오늘 밤 바로 ㄱㄱ 👇", "pill": "📌 저장해두고 시험 끝나면 꺼내보기"}
 ],
 "music": {"url": "<CC 곡 URL 또는 로컬 mp3>", "start": 0}
}
- clip: steam_appid(+trailer id, 생략 시 첫 트레일러) 또는 file. start=초. crop_top=true 면 원본 위쪽 900/1080만 사용(트레일러에 영문 자막이 박혀 있을 때)
- image: URL·로컬 경로·data URI. 천천히 확대(Ken Burns). 제품 사진은 "fit": "contain"(+ "pad": "white") → 잘림 없이 전체 표시. 실사 사진(공식 제품 이미지·보도사진)만. AI 생성 이미지 금지.
- 자막 노출 시간 기준: 단어당 0.3초 + 0.5초. 마지막 1.5~2초는 CTA.
- 음악: loudnorm I=-14 TP=-1.5, 끝 0.8초 페이드아웃. 인스타 음악(audio_id)을 쓸 땐 out_silent.mp4 를 video_url_silent 로 등록.
"""
import sys, json, re, os, html as H, subprocess, asyncio, urllib.request, shutil, base64

FPS = 30
specf, out = sys.argv[1], sys.argv[2]
spec = json.load(open(specf, encoding='utf-8'))
base = os.path.splitext(out)[0]
W = os.path.abspath(os.path.dirname(out) or '.') + '/_v3work'
shutil.rmtree(W, ignore_errors=True); os.makedirs(W)
UA = {'User-Agent': 'Mozilla/5.0', 'Cookie': 'birthtime=0; wants_mature_content=1'}


def run(cmd):
    subprocess.run(cmd, check=True)


def fetch(url, dst):
    if url.startswith('data:'):
        open(dst, 'wb').write(base64.b64decode(url.split(',', 1)[1]))
    elif re.match(r'https?://', url):
        open(dst, 'wb').write(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
    else:
        shutil.copy(url, dst)
    return dst


def steam_hls(appid, tid=None):
    h = H.unescape(urllib.request.urlopen(urllib.request.Request(f'https://store.steampowered.com/app/{appid}/?l=koreana', headers=UA), timeout=40).read().decode('utf-8', 'ignore')).replace('\\/', '/')
    us = list(dict.fromkeys(re.findall(r'https://video[^"\s]+?hls_264_master\.m3u8[^"\s,]*', h)))
    if tid:
        us = [u for u in us if f'/{tid}/' in u] or us
    if not us:
        raise SystemExit(f'no trailer for {appid}')
    return us[0]


_trailers = {}


def source_audio(c):
    if c.get('file'):
        return c['file']
    raise SystemExit('mic 장면은 clip.file(원본 소리가 있는 파일)만 지원')


def source(c):
    if c.get('file'):
        return c['file']
    k = (c['steam_appid'], c.get('trailer'))
    if k not in _trailers:
        dst = f'{W}/t{len(_trailers)}.mp4'
        run(['ffmpeg', '-y', '-loglevel', 'error', '-i', steam_hls(*k), '-an', '-c', 'copy', dst])
        _trailers[k] = dst
    return _trailers[k]


def mark(t):
    t = H.escape(str(t)).replace('\\n', '<br>').replace('\n', '<br>')
    t = re.sub(r'\[(.+?)\]', r'<span class="gb">\1</span>', t)
    return re.sub(r'\{(.+?)\}', r'<em>\1</em>', t)


CSS = '''
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1920px;background:transparent;overflow:hidden;font-family:'Pretendard',sans-serif;color:#fff;-webkit-font-smoothing:antialiased;word-break:keep-all}
.num{font-family:'Chakra Petch','Pretendard',sans-serif}
em{font-style:normal;color:#FF3D7F}
.sh{text-shadow:0 3px 14px rgba(0,0,0,.75),0 1px 3px rgba(0,0,0,.85)}
/* 가독성용 어두운 그라데이션 판 */
.scrimT{position:absolute;left:0;right:0;top:0;height:640px;background:linear-gradient(180deg,rgba(8,8,14,.92) 0%,rgba(8,8,14,.78) 70%,rgba(8,8,14,0) 100%)}
.scrimB{position:absolute;left:0;right:0;top:1330px;height:590px;background:linear-gradient(180deg,rgba(8,8,14,0) 0%,rgba(8,8,14,.86) 10%,rgba(8,8,14,.94) 100%)}
.top{position:absolute;left:96px;right:96px;top:170px;height:420px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:22px}
.kick{display:inline-flex;align-items:center;gap:10px;font-size:28px;font-weight:700;color:#fff;background:rgba(255,61,127,.16);border:1.5px solid rgba(255,61,127,.7);border-radius:999px;padding:9px 24px;letter-spacing:.5px}
.kick:before{content:"";width:10px;height:10px;border-radius:50%;background:#FF3D7F;box-shadow:0 0 10px #FF3D7F}
.title{font-size:88px;font-weight:900;line-height:1.14;letter-spacing:-2.5px}
.title div{white-space:nowrap}
.gb{display:inline-block;background:#2BE07A;color:#08080E;border-radius:14px;padding:0 16px;margin:0 4px;line-height:1.1;text-shadow:none}
.line{position:absolute;left:0;right:0;height:4px;background:#FF3D7F;box-shadow:0 0 16px rgba(255,61,127,.7)}
/* 순위·후보 배지: 숫자 + 작은 라벨 */
.rank{position:absolute;left:32px;top:652px;display:flex;align-items:baseline;gap:10px;background:rgba(8,8,14,.78);border:1.5px solid rgba(255,255,255,.18);border-left:6px solid #FF3D7F;border-radius:14px;padding:8px 20px 8px 16px;backdrop-filter:blur(6px)}
.rank .n{font-size:54px;font-weight:700;line-height:1;color:#fff}
.rank .l{font-size:26px;font-weight:800;color:#FF8FB4;letter-spacing:1px;line-height:1.1}
.rank.txt .l{font-size:32px;color:#fff}
.rank.big{left:50%;top:1360px;transform:translateX(-50%);border-left:1.5px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 44px;background:#FF3D7F}
.rank.big .n{font-size:150px}
.center{position:absolute;left:70px;right:70px;top:640px;height:680px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px}
.center .c{font-size:104px;font-weight:900;letter-spacing:-2.5px;line-height:1.12;padding:10px 34px;border-radius:24px;background:radial-gradient(closest-side,rgba(8,8,14,.6),rgba(8,8,14,0))}
.center .c.num{font-size:136px}
.cap{position:absolute;left:60px;right:60px;top:1190px;display:flex;justify-content:center}
.cap span{font-size:40px;font-weight:800;line-height:1.3;text-align:center;background:rgba(8,8,14,.78);border-radius:12px;padding:8px 20px;color:#FFE45C}
.mic{position:absolute;right:32px;top:652px;font-size:24px;font-weight:800;background:#FF3D7F;border-radius:999px;padding:8px 18px}
.review{position:absolute;left:32px;right:32px;top:1196px;display:flex;justify-content:flex-start}
.review .bx{max-width:760px;background:rgba(8,8,14,.84);border:1.5px solid rgba(255,255,255,.16);border-radius:16px;padding:12px 20px;display:flex;gap:14px;align-items:center}
.review .ic{width:44px;height:44px;border-radius:10px;background:#1B6FD1;display:flex;align-items:center;justify-content:center;font-size:24px;flex:none}
.review .src{font-size:20px;color:#A3A3B2;font-weight:600}
.review .q{font-size:30px;font-weight:800;margin-top:2px;line-height:1.3}
.cred{position:absolute;right:40px;top:1354px;font-size:18px;color:rgba(255,255,255,.55);max-width:700px;text-align:right}
.vs{position:absolute;left:0;right:0;top:700px;height:560px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:radial-gradient(ellipse at center,rgba(8,8,14,.82) 0%,rgba(8,8,14,.55) 55%,rgba(8,8,14,0) 80%)}
.vrow{display:flex;align-items:center;gap:34px}
.vt{display:flex;flex-direction:column;align-items:center;gap:12px}
.vl{width:250px;height:250px;border-radius:28px;background:#F4F4F7;border:3px solid rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.vl img{max-width:200px;max-height:190px;object-fit:contain}
.vn{font-size:40px;font-weight:900;color:#fff;letter-spacing:1px}
.vx{font-size:76px;font-weight:700;color:#FF3D7F;text-shadow:0 0 30px rgba(255,61,127,.6)}
.vtag{font-size:36px;font-weight:800;background:#FFE14D;color:#111;border-radius:14px;padding:8px 22px}
.nlogo{height:58px;max-width:150px;object-fit:contain;vertical-align:middle;margin-right:16px;margin-top:-8px;background:#F4F4F7;border-radius:12px;padding:6px 10px}
.bug{position:absolute;left:40px;top:1352px;font-size:20px;font-weight:700;color:rgba(255,255,255,.8);letter-spacing:2px}
.bug b{color:#FF3D7F}
.low{position:absolute;left:96px;right:96px;top:1404px;height:226px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;gap:14px;overflow:hidden}
.name{font-size:60px;font-weight:900;letter-spacing:-1.5px;line-height:1.12}
.chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.chip{font-size:27px;font-weight:700;padding:6px 16px;border-radius:10px;background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.25);line-height:1.25}
.chip.g{background:#2BE07A;color:#08080E;border-color:#2BE07A}
.say{font-size:44px;font-weight:800;line-height:1.28;letter-spacing:-1px}
.sub{font-size:46px;font-weight:800;line-height:1.3;letter-spacing:-1px}
.cta{font-size:58px;font-weight:900;line-height:1.26;letter-spacing:-1.5px}
.pill{display:inline-block;font-size:28px;font-weight:800;background:#3DF2FF;color:#08080E;border-radius:999px;padding:9px 26px}
.ai{position:absolute;right:28px;top:652px;font-size:20px;color:rgba(255,255,255,.7)}
'''

KIDS_CSS = '''
html,body{font-family:'Jua','Pretendard',sans-serif;color:#4A3426}
.sh{text-shadow:none}
.scrimT,.scrimB,.line{display:none}
.kframe{position:absolute;left:44px;right:44px;top:648px;height:664px;border-radius:56px;box-shadow:0 0 0 1600px #FFF4E6;border:8px solid #fff;outline:6px dashed #FFC7D6;outline-offset:10px}
.deco{position:absolute;font-size:64px;line-height:1}
.dot{position:absolute;border-radius:50%}
.kick{color:#fff;background:#FF8FAB;border:none;font-weight:400;font-size:32px;padding:10px 28px}
.kick:before{background:#FFE066;box-shadow:none}
.title{font-weight:400;font-size:96px;letter-spacing:-1px;color:#4A3426}
.gb{background:#FFE066;color:#4A3426;border-radius:22px}
em{color:#FF6B8B}
.rank{background:#7ED3C3;border:none;border-radius:999px;left:72px;top:610px;padding:8px 26px;box-shadow:0 6px 0 #5BB5A4}
.rank .n{color:#fff;font-weight:400;font-size:76px}
.rank .l,.rank.txt .l{color:#fff;font-weight:400;font-size:44px}
.center .c{font-weight:400;color:#fff;background:rgba(255,143,171,.88);border-radius:40px;padding:14px 40px;font-size:92px;box-shadow:0 8px 0 #E8708F}
.cred{color:#B39A88;top:1330px;right:60px}
.bug{color:#FF8FAB;top:1330px;left:60px;letter-spacing:1px}
.bug b{color:#7ED3C3}
.low{top:1392px}
.name{font-weight:400;font-size:64px;color:#4A3426}
.chip{background:#fff;border:3px solid #FFD3DD;color:#4A3426;border-radius:999px;font-weight:400;font-size:30px}
.chip.g{background:#7ED3C3;border-color:#7ED3C3;color:#fff}
.say,.sub{font-weight:400;font-size:48px;color:#6B5444}
.cta{font-weight:400;color:#4A3426}
.pill{background:#FFE066;color:#4A3426;font-weight:400}
'''
HEAD = ('<!doctype html><html><head><meta charset="utf-8">'
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">'
        '<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&display=swap" rel="stylesheet">'
        f'<style>{CSS}</style></head><body>')


def img_uri(path):
    if not path: return ''
    if path.startswith('data:'): return path
    ext = 'png' if path.lower().endswith('.png') else 'jpeg'
    loc = path if not re.match(r'https?://', path) else fetch(path, f'{W}/logo_{abs(hash(path)) % 10**8}')
    return f'data:image/{ext};base64,' + base64.b64encode(open(loc, 'rb').read()).decode()

def overlay_html(sc):
    kids = spec.get('theme') == 'kids'
    t = spec.get('title', [])
    t = t if isinstance(t, list) else [t]
    head = HEAD.replace('</style>', KIDS_CSS + '</style>').replace('<link href="https://fonts.googleapis.com/css2?family=Chakra', '<link href="https://fonts.googleapis.com/css2?family=Jua&display=swap" rel="stylesheet"><link href="https://fonts.googleapis.com/css2?family=Chakra') if kids else HEAD
    h = [head, '<div class="scrimT"></div><div class="scrimB"></div>']
    if kids:
        h.append('<div class="kframe"></div>')
        for x, y, e in [(40, 120, '🎈'), (960, 150, '⭐'), (70, 1820, '🧸'), (950, 1800, '🎂'), (980, 560, '✨'), (30, 560, '🌈')]:
            h.append(f'<div class="deco" style="left:{x}px;top:{y}px">{e}</div>')
        for x, y, r, c in [(200, 60, 18, '#FFC7D6'), (860, 80, 14, '#7ED3C3'), (120, 1700, 16, '#FFE066'), (900, 1690, 20, '#FFC7D6'), (520, 1860, 12, '#7ED3C3')]:
            h.append(f'<div class="dot" style="left:{x}px;top:{y}px;width:{r*2}px;height:{r*2}px;background:{c}"></div>')
    h.append('<div class="top sh">')
    if spec.get('kicker'):
        h.append(f'<div class="kick">{H.escape(spec["kicker"])}</div>')
    h.append('<div class="title" id="ttl">' + ''.join(f'<div>{mark(x)}</div>' for x in t) + '</div></div>')
    h.append('<div class="line" style="top:616px"></div><div class="line" style="top:1340px"></div>')
    if sc.get('badge'):
        b = str(sc['badge']).strip()
        m = re.fullmatch(r'(\D*?)\s*(\d+)\s*(\D*)', b)
        if m:
            pre, suf = m.group(1).strip(), m.group(3).strip()
            h.append(('<div class="rank big">' if re.fullmatch(r'\d', b) else '<div class="rank">') + (f'<span class="l">{H.escape(pre)}</span>' if pre else '') + f'<span class="n num">{m.group(2)}</span>' + (f'<span class="l">{H.escape(suf)}</span>' if suf else '') + '</div>')
        else:
            h.append(f'<div class="rank txt"><span class="l">{H.escape(b)}</span></div>')
    if sc.get('mic'):
        h.append(f'<div class="mic">🎙 {H.escape(sc["mic"] if isinstance(sc["mic"], str) else "실제 팀 보이스")}</div>')
    if sc.get('center'):
        c = sc['center']
        cls = 'c num' if re.fullmatch(r'[A-Za-z0-9 #.-]+', c) else 'c'
        h.append(f'<div class="center sh"><div class="{cls}">{mark(c)}</div></div>')
    if sc.get('vs'):
        v = sc['vs']
        h.append('<div class="vs"><div class="vrow">'
                 f'<div class="vt"><div class="vl"><img src="{img_uri(v.get("a"))}"></div><div class="vn">{H.escape(v.get("an", ""))}</div></div>'
                 '<div class="vx num">VS</div>'
                 f'<div class="vt"><div class="vl"><img src="{img_uri(v.get("b"))}"></div><div class="vn">{H.escape(v.get("bn", ""))}</div></div></div>'
                 + (f'<div class="vtag">{mark(v["tag"])}</div>' if v.get('tag') else '') + '</div>')
    if sc.get('caption'):
        h.append(f'<div class="cap"><span>{mark(sc["caption"])}</span></div>')
    if sc.get('review'):
        src = H.escape(sc.get('review_src', 'Steam 한국어 리뷰 · 추천'))
        h.append(f'<div class="review"><div class="bx"><div class="ic">👍</div><div><div class="src">{src}</div><div class="q">“{H.escape(sc["review"])}”</div></div></div></div>')
    if sc.get('credit'):
        h.append(f'<div class="cred sh">{H.escape(sc["credit"])}</div>')
    h.append(f'<div class="bug sh">{H.escape(spec["bug"])}</div>' if spec.get('bug') else f'<div class="bug num sh">PLAY <b>N</b></div>')
    if sc.get('ai'):
        h.append('<div class="ai sh">이미지: AI 생성</div>')
    h.append('<div class="low sh" id="low">')
    if sc.get('cta'):
        h.append(f'<div class="cta">{mark(sc.get("line", ""))}</div>')
        if sc.get('pill'):
            h.append(f'<div class="pill">{H.escape(sc["pill"])}</div>')
    else:
        if sc.get('name'):
            lg = f'<img class="nlogo" src="{img_uri(sc["logo"])}">' if sc.get('logo') else ''
            h.append(f'<div class="name">{lg}{H.escape(sc["name"])}</div>')
        if sc.get('chips'):
            h.append('<div class="chips">' + ''.join(f'<span class="chip{" g" if re.search("무료|0원|할인|%", x) else ""}">{H.escape(x)}</span>' for x in sc['chips']) + '</div>')
        if sc.get('line'):
            h.append(f'<div class="say">{mark(sc["line"])}</div>')
        if sc.get('sub'):
            h.append(f'<div class="sub">{mark(sc["sub"])}</div>')
    h.append('</div>')
    # 넘치면 글자 크기 자동 축소 (겹침 방지)
    h.append("""<script>
function fitW(el,max){let f=parseFloat(getComputedStyle(el).fontSize);while(el.scrollWidth>max&&f>40){f-=2;el.style.fontSize=f+'px'}}
const T=document.getElementById('ttl');[...T.children].forEach(d=>fitW(d,888));
const L=document.getElementById('low');let k=1;while(L.scrollHeight>L.clientHeight+1&&k>0.6){k-=0.04;[...L.querySelectorAll('.name,.say,.sub,.cta,.chip,.pill')].forEach(e=>{e.style.fontSize=(parseFloat(getComputedStyle(e).fontSize)*0.96)+'px'})}
document.querySelectorAll('.center .c').forEach(c=>fitW(c,940));
</script></body></html>""")
    return ''.join(h)


async def render_overlays(scenes):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1080, 'height': 1920})
        for i, sc in enumerate(scenes):
            open(f'{W}/o{i}.html', 'w', encoding='utf-8').write(overlay_html(sc))
            await pg.goto('file://' + f'{W}/o{i}.html', wait_until='networkidle')
            await pg.evaluate('document.fonts.ready')
            await pg.wait_for_timeout(150)
            await pg.screenshot(path=f'{W}/o{i}.png', omit_background=True)
        await b.close()


def scene_video(i, sc):
    d = float(sc.get('dur', 3.0))
    outp = f'{W}/s{i}.mp4'
    fg_crop = 'crop=iw:ih*0.8333:0:0,' if (sc.get('clip') or {}).get('crop_top') else ''
    if sc.get('clip'):
        c = sc['clip']
        src = source(c)
        inp = ['-ss', str(c.get('start', 0)), '-t', f'{d + 0.2}', '-i', src]
        pre = f'[0:v]fps={FPS},{fg_crop}setpts=PTS-STARTPTS,split[a][b]'
    else:
        img = fetch(sc['image'], f'{W}/img{i}')
        n = int(d * FPS) + 6
        inp = ['-loop', '1', '-t', f'{d + 0.2}', '-i', img]
        if sc.get('fit') == 'contain':
            # 제품 사진: 잘리지 않게 전체를 박스 안에 넣고 남는 곳은 배경색(pad, 기본 흰색)으로
            padc = sc.get('pad', 'white')
            pre = (f'[0:v]scale=2052:1368:force_original_aspect_ratio=decrease,pad=2160:1440:(ow-iw)/2:(oh-ih)/2:color={padc},'
                   f'zoompan=z=\'min(1+0.0006*on,1.08)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d={n}:s=1080x720:fps={FPS},setsar=1,split[a][b]')
        else:
            pre = (f'[0:v]scale=2160:-2,zoompan=z=\'min(1+0.0009*on,1.25)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d={n}:s=1080x1350:fps={FPS},'
                   f'setsar=1,split[a][b]')
    fc = (pre + ';'
          '[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:2,eq=brightness=-0.32:saturation=0.8[bg];'
          '[b]scale=1080:720:force_original_aspect_ratio=increase,crop=1080:720[fg];'
          '[bg][fg]overlay=0:620[v];[v][1:v]overlay=0:0,format=yuv420p[o]')
    run(['ffmpeg', '-y', '-loglevel', 'error', *inp, '-i', f'{W}/o{i}.png', '-filter_complex', fc, '-map', '[o]',
         '-t', f'{d}', '-r', str(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', outp])
    # 장면 오디오: mic(선수 보이스) 장면은 원본 소리, 나머지는 무음
    ap = f'{W}/a{i}.wav'
    if sc.get('mic') and sc.get('clip'):
        c = sc['clip']
        run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(c.get('start', 0)), '-t', f'{d}', '-i', source_audio(c), '-vn', '-ac', '2', '-ar', '44100',
             '-af', f'apad=whole_dur={d},loudnorm=I=-16:TP=-1.5,afade=t=in:d=0.08,afade=t=out:st={max(0, d - 0.15):.2f}:d=0.15', '-t', f'{d}', ap])
    else:
        run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', f'{d}', ap])
    return outp, d


# ---- 클립 신선도 검사 (사장님 지시 2026-10-06: 릴스마다 주제에 맞는 새 클립) ----
# 규칙: ① 이전 릴스와 같은 원본·겹치는 구간 금지 ② 한 원본은 최대 2개 릴스까지
#       ③ 릴스 장면의 60% 이상은 처음 쓰는 원본 ④ 예외는 spec "allow_reuse": [장면번호]
# ⑤ 기록은 서버 공용(playn_clip_registry, playn-publish ?mode=clips) — 모든 시리즈(릴스·키즈·이벤트·e스포츠) 한 곳에서 검사
#    환경변수 PLAYN_KEY(= playand_config.intake_key) 필수. 없으면 빌드 중단(CLIP_CHECK_OFF=1 일 때만 생략)
import hashlib as _hl
CLIPS_API = 'https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-publish?mode=clips'
def _reg_load():
    k = os.environ.get('PLAYN_KEY')
    if not k:
        if os.environ.get('CLIP_CHECK_OFF'): return []
        print('❌ PLAYN_KEY 없음: 공용 클립 기록을 못 읽어서 중단 (playand_config.intake_key)', file=sys.stderr); sys.exit(3)
    r = urllib.request.urlopen(urllib.request.Request(CLIPS_API, headers={'x-playand-key': k}), timeout=30)
    return json.load(r)['rows']
def _reg_save(rid, rows):
    k = os.environ.get('PLAYN_KEY')
    if not k: return
    req = urllib.request.Request(CLIPS_API, data=json.dumps({'reel': rid, 'rows': rows}).encode(), headers={'x-playand-key': k, 'content-type': 'application/json'})
    print('클립 기록 저장:', urllib.request.urlopen(req, timeout=30).read().decode())
def _reel_id(spec):
    r = spec.get('reel_id') or os.path.splitext(os.path.basename(specf))[0]
    m = re.match(r'^([a-zA-Z]+\d+)', r)
    return (m.group(1) if m else r).upper()
def _clip_key(sc):
    c = sc.get('clip') or {}
    if c.get('file') and os.path.exists(c['file']):
        with open(c['file'], 'rb') as fh: return 'f:' + _hl.md5(fh.read(1 << 20)).hexdigest()[:12], os.path.basename(c['file'])
    if c.get('steam_appid'): return f"steam:{c['steam_appid']}:{c.get('trailer')}", f"steam {c['steam_appid']}"
    if sc.get('image'):
        im = sc['image']
        if os.path.exists(im):
            with open(im, 'rb') as fh: return 'i:' + _hl.md5(fh.read(1 << 20)).hexdigest()[:12], os.path.basename(im)
        return 'u:' + im, im.split('/')[-1]
    return None, None
def clip_check(spec, scenes):
    rid = _reel_id(spec)
    reg = _reg_load()
    others = [r for r in reg if r['reel'] != rid]
    allow = set(spec.get('allow_reuse', []))
    errs, fresh, rows = [], 0, []
    for i, sc in enumerate(scenes):
        k, name = _clip_key(sc)
        if not k: continue
        c = sc.get('clip') or {}
        a = float(c.get('start', 0)); b = a + float(sc.get('dur', 3))
        prev = [r for r in others if r['key'] == k]
        reels = sorted({r['reel'] for r in prev})
        if not prev: fresh += 1
        if i not in allow:
            ov = [r for r in prev if not (b <= r['start'] or a >= r['end'])]
            if ov: errs.append(f"장면 {i} {name} {a:.0f}-{b:.0f}초: {', '.join(sorted({r['reel'] for r in ov}))}에서 이미 쓴 구간")
            elif len(reels) >= 2: errs.append(f"장면 {i} {name}: 이미 {len(reels)}개 릴스({', '.join(reels)})에서 쓴 원본")
        rows.append({'reel': rid, 'key': k, 'name': name, 'start': a, 'end': b})
    n = len(rows)
    if n and fresh / n < 0.6: errs.append(f"새 원본 비율 {fresh}/{n} (60% 미만): 주제에 맞는 새 클립을 더 받아오세요")
    if errs and not os.environ.get('CLIP_CHECK_OFF'):
        print('❌ 클립 재사용 검사 실패\n- ' + '\n- '.join(errs), file=sys.stderr); sys.exit(3)
    return reg, rows, rid
def clip_commit(reg, rows, rid):
    _reg_save(rid, rows)


scenes = spec['scenes']
_reg, _rows, _rid = clip_check(spec, scenes)
asyncio.run(render_overlays(scenes))
parts = [scene_video(i, sc) for i, sc in enumerate(scenes)]
total = sum(d for _, d in parts)
lst = f'{W}/list.txt'
open(lst, 'w').write(''.join(f"file '{p}'\n" for p, _ in parts))
vid = f'{W}/video.mp4'
run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS), vid])
# 보이스 트랙 (mic 장면만 소리, 나머지 무음)
alst = f'{W}/alist.txt'
open(alst, 'w').write(''.join(f"file '{W}/a{i}.wav'\n" for i in range(len(parts))))
voice = f'{W}/voice.wav'
run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', alst, '-c', 'copy', voice])
has_mic = any(sc.get('mic') for sc in scenes)
# 무음(인스타 음악용) 버전: mic 장면 소리만 남김
run(['ffmpeg', '-y', '-loglevel', 'error', '-i', vid, '-i', voice, '-map', '0:v', '-map', '1:a', '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', base + '_silent.mp4'])
def auto_start(path, dur):
    """곡에서 dur초 구간 중 첫 2초가 세고 전체 에너지가 높은 시작점(드롭) 찾기"""
    import numpy as np
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    hop = 4000  # 0.5초
    n = len(x) // hop
    if n < 4: return 0.0
    r = np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1) + 1e-9)
    w = int(dur * 2); best, bs = 0, -1
    for i in range(0, max(1, n - w)):
        head = r[i:i + 4].mean(); body = r[i:i + w].mean()
        jump = head / (r[max(0, i - 4):i].mean() + 1e-6) if i >= 4 else 1.0
        sc = head * 1.2 + body + min(jump, 3) * body * 0.15
        if sc > bs: bs, best = sc, i
    return best * 0.5

def mix_music(mspec, dst):
    mp = fetch(mspec['url'], f'{W}/music_{abs(hash(mspec["url"])) % 10**8}')
    st = mspec.get('start', 'auto')
    if st == 'auto': st = auto_start(mp, total)
    duck, t0 = [], 0.0
    for (p_, d_), sc in zip(parts, scenes):
        if sc.get('mic'):
            duck.append(f"between(t,{t0:.2f},{t0 + d_:.2f})")
        t0 += d_
    vol = f"volume='if({'+'.join(duck)},0.18,1)':eval=frame," if duck else ''
    af = f"[1:a]atrim=start={st},asetpts=PTS-STARTPTS,loudnorm=I=-14:TP=-1.5:LRA=11,{vol}afade=t=out:st={max(0, total - 0.8):.2f}:d=0.8[mu];[2:a]volume=1.6[vo];[mu][vo]amix=inputs=2:duration=first:normalize=0[a]"
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', vid, '-i', mp, '-i', voice, '-filter_complex', af, '-map', '0:v', '-map', '[a]',
         '-t', f'{total}', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', dst])
    return round(float(st), 1)

res_extra = {}
m = spec.get('music')
if m and m.get('url'):
    res_extra['music_start'] = mix_music(m, out)
else:
    shutil.copy(base + '_silent.mp4', out)
# 사장님 확인용: 실제 인스타 음악(preview URL)을 입힌 버전 → 영상마다 곡이 다르게 들림
pm = spec.get('preview_music')
if pm and pm.get('url'):
    res_extra['preview'] = base + '_preview.mp4'
    res_extra['preview_start'] = mix_music(pm, base + '_preview.mp4')
# 커버: 첫 장면이 아니라 훅이 가장 잘 보이는 장면(cover 지정 or 두 번째 장면)
ci = spec.get('cover_scene', 1 if len(parts) > 1 else 0)
t0 = sum(d for _, d in parts[:ci]) + min(1.0, parts[ci][1] / 2)
run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t0:.2f}', '-i', out, '-frames:v', '1', '-q:v', '2', base + '_cover.jpg'])
clip_commit(_reg, _rows, _rid)
print(json.dumps({'out': out, 'silent': base + '_silent.mp4', 'cover': base + '_cover.jpg', 'duration': round(total, 2), **res_extra}, ensure_ascii=False))
