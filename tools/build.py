#!/usr/bin/env python3
"""playn.kr 정적 페이지 생성기
- 지점 페이지: /hongdae/ /yeonnam/ /yeontral/  (BRANCHES 데이터)
- 매거진 글 페이지: /m/<id>/  (playn-posts API → 인스타 발행 글)
- sitemap.xml, robots.txt
실행: python3 tools/build.py   (GitHub Actions 에서 6시간마다 자동 실행)
"""
import html, json, os, re, urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://playn.kr"
POSTS_API = "https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-posts"
HOST = "010-8339-5818"
E = html.escape

HEAD_COMMON = """<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#16133F">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="/assets/base.css">"""

TOP = """<header class="top"><div class="wrap"><a class="logo" href="/">PLAY <b>N</b></a>
<nav><a href="/#deals">공실특가</a><a href="/#magazine">매거진</a><a href="/#branches">지점</a><a href="/#crew" class="join">N CREW 가입</a></nav></div></header>"""

FOOT = f"""<footer><div class="wrap"><div class="row"><span>플레이앤 Play N</span><span>문의 <a href="tel:{HOST.replace('-','')}">{HOST}</a></span><span>카카오톡 채널 playn</span><span><a href="https://www.instagram.com/playn_no.1/" target="_blank" rel="noopener">@playn_no.1</a></span></div>
<div class="row" style="margin-top:8px"><a href="/hongdae/">홍대루프탑점</a><a href="/yeonnam/">연남루프탑점</a><a href="/yeontral/">연트럴파크점</a><a href="/#magazine">게임 매거진</a></div></div></footer>"""

SMARTSTORE = {'43667': 'https://smartstore.naver.com/playn_/products/9434661597', '55750': 'https://smartstore.naver.com/playn_/products/9430485644', '72605': 'https://smartstore.naver.com/playn_/products/12071850850'}

# ───────────────────────── 지점 데이터 (스페이스클라우드 공간 소개·시설 안내, 노션 안내문 기준 · 2026-10-03)
BRANCHES = [
  dict(
    slug="hongdae", code="hongdae", name="홍대루프탑점", sc="43667",
    tagline="홍대입구역 1번 출구 가까운 4층 단독 루프탑",
    addr="서울 마포구 동교동 158-19 몽달건물 4층", addr_hint="몽달 출입문 왼쪽 유리문으로 들어와서 4층",
    lat=37.55673863, lng=126.92235563, floor="4층 단독 · 엘리베이터 없음", cap="최대 16명", area="66㎡",
    rating=4.91, reviews_n=172,
    pcs=["게이밍 PC 5대, 전 좌석 더블모니터 (2024년 3월 업그레이드)", "27인치 QHD 165Hz 모니터 · 라이젠 5800X · RTX 3070 · RAM 16GB · SSD 1TB", "전동 모션데스크와 모니터암으로 높이·각도 조절", "KT 1기가 인터넷"],
    gear=[("마우스", "로지텍 G PRO X SUPERLIGHT 무선, G403·G703 무선, 레이저 데스에더 화이트, 바이퍼 미니, 제닉스 GX AIR 무선"),
          ("헤드셋", "레이저 바라쿠다 X, 젠하이저 GSP 670 무선, 하이퍼X 클라우드2 무선, 젠하이저 게임제로, 커세어 무선")],
    play=["PS5 (듀얼센스 2개) · UFC4, FIFA, 폴가이즈, 철권", "닌텐도 스위치 (조이콘 4개) · 마리오파티, 마리오카트, 1-2 Switch, 오버쿡", "75인치 TV · 넷플릭스·유튜브·디즈니+·스포츠 채널", "노래방 마이크 2개 (시간 제한 없음)", "보드게임 15종 이상 · 루미큐브, 아발론, 스플렌더, 클루, 뱅, 할리갈리 등", "루프탑 바베큐·불멍 화로대 (최대 16명)"],
    amen="에어컨 3대 · 온수 · 전자레인지 · 에어프라이어 · 대형 냉장고 · 실내 화장실(비데) · 일회용품·술잔 구비",
    minors="미성년자는 출입할 수 없어요. 부모님과 함께 오는 경우만 가능하고, 부모님이 퇴실할 때 같이 퇴실해요.",
    reviews=[("Sno**", "2026.08", "시설도 깨끗하고 컴퓨터도 웬만한 pc방정도로 좋아서 정말 즐겁게 놀고갑니다!"),
             ("임**", "2026.07", "보드게임 종류가 정말 다양해서 시간 가는 줄 모르고 놀았습니다"),
             ("chays**", "2026.08", "실내에 PC부터 닌텐도, TV, 다양한 보드게임이 갖춰져 있어서 부족함 없이 알차게 놀다 갑니다!")],
  ),
  dict(
    slug="yeonnam", code="yeonnam", name="연남루프탑점", sc="55750",
    tagline="홍대입구역 3번 출구 1분, 3층 단독 루프탑",
    addr="서울 마포구 동교동 147-6 꼬꼬순이건물 3층", addr_hint="꼬꼬순이 2층 계단으로 올라와서 3층",
    lat=37.55890269, lng=126.92607798, floor="3층 단독 · 엘리베이터 없음", cap="최대 16명", area="66㎡",
    rating=4.90, reviews_n=99,
    pcs=["게이밍 PC 5대, 더블모니터 (메인 모니터 선택 가능)", "27인치 QHD 165Hz + 27인치 FHD 240Hz · 라이젠 7500F · RTX 4070 · RAM 32GB · SSD 2TB", "전동 모션데스크", "기업용 1기가 광랜"],
    gear=[("마우스", "레이저 데스에더 V3 프로 (페이커 에디션), 지슈라, 콘퓨어 프로, 오로치 V2, 타이탄 GX AIR 등 전체 무선"),
          ("키보드", "닌자87 PRO 5대 (백축·녹축·황축·적축 등) 전체 무선, 타건 후 골라서 사용"),
          ("헤드셋", "커세어 HS80, 스틸시리즈 아크티스 9, 오디지 펜로즈, 젠하이저 GSP 670, 아수스 ROG 센츄리온")],
    play=["플레이스테이션·닌텐도 (조이스틱 각 4개, 철권 조이스틱 2개)", "대형 빔프로젝터 노래방 · 유튜브·넷플릭스", "노래방 마이크 스피커 2개 (시간 제한 없음)", "보드게임 · 시퀀스, 라스베가스, 클루, 사보타지, 달무티, 스플렌더, 뱅, 젝스님트 등", "루프탑 바베큐·불멍 화로대 (최대 16명)"],
    amen="방마다 냉난방기 · 단독 실내 화장실 · 일회용품 구비",
    minors="미성년자는 출입할 수 없어요. 부모님과 함께 오는 경우만 가능하고, 부모님이 퇴실할 때 같이 퇴실해요.",
    reviews=[("승*", "2026.09", "컴퓨터 사양도 좋고 친구들이랑 추억 쌓기 너무 좋은 곳입니다!!"),
             ("seunghun", "2026.09", "공간이 넓고 좋아요 컴퓨터 서능도 좋고 깔끔해요 밖에 테라스에서 멍 때리기 좋아요"),
             ("짠짜리", "2026.10", "정말 재밌게 잘놀았어요. 서울에서 이렇게 노는것도 재밌네요")],
  ),
  dict(
    slug="yeontral", code="yeontral", name="연트럴파크점", sc="72605",
    tagline="연트럴파크 옆, 5인 최적화 5층 게이밍 룸",
    addr="서울 마포구 연남동 260-28 계림빌딩 5층", addr_hint="1층 유키모찌 연남점, 2층 유언비어가 있는 건물 맨 위층",
    lat=37.56129859, lng=126.92445428, floor="5층 · 엘리베이터 없음", cap="최대 7명 (5명 최적)", area="23㎡",
    rating=4.85, reviews_n=13,
    pcs=["게이밍 PC 5대, 더블모니터", "24인치 FHD 320Hz + 34인치 QHD 165Hz · 라이젠 9600X / i7-13700K · RTX 5070 / 4070 · RAM 32GB · SSD 1TB", "높낮이 조절 테이블 + 180도 눕는 좌식 의자", "기업용 1기가 광랜"],
    gear=[("마우스", "벡시·잠자리·샤크·로지텍·레이저·제닉스 8K 마우스 11종, 유·무선 선택"),
          ("키보드", "8K 지원·래피드 트리거·자석축 키보드 8종, 타건 후 선택"),
          ("헤드셋", "로지텍·젠하이저·레이저 무선 헤드셋 5종")],
    play=["노래방 마이크 스피커 2개", "빔프로젝터 (사용법은 호스트에게 문의)", "루프탑 바베큐 (장작·숯·장갑·집게·불판 무제한, 인당 1만원)"],
    amen="냉난방기·선풍기 · 실내 소변기 + 2층 전용 화장실 · 일회용품·음료 구비",
    minors="미성년자는 부모님 연락처로 동의를 확인한 뒤 이용할 수 있어요. 음주·흡연은 엄격히 금지되고 적발 시 바로 퇴실이에요.",
    reviews=[("soso", "2026.09", "방과 컴터 관리가 잘되있어요, 인터넷도 빨라서 게임을 까는데 지장이 없어서 좋았어요"),
             ("리어맬릭스", "2026.09", "컴퓨터가 성능이 좋고 기본적인 음료나 일회용품 구비가 되어있어서 너무 편하게 이용하고 왔습니다"),
             ("노**", "2026.08", "컴퓨터 사양 좋고 장비도 좋았습니다. 게임 좋아하시는 분들 추천합니다")],
  ),
]
for b in BRANCHES:
    b["sc_url"] = f"https://www.spacecloud.kr/space/{b['sc']}"
    b["ss_url"] = SMARTSTORE[b["sc"]]
    b["map_url"] = f"https://map.naver.com/p/search/{urllib.request.quote('게임파티룸 플레이앤 ' + b['name'].replace('점',''))}"
    b["route_url"] = (f"http://map.naver.com/index.nhn?elng={b['lng']}&elat={b['lat']}&etext="
                      + urllib.request.quote('게임파티룸 플레이앤 ' + b['name']) + "&menu=route&pathType=1")


PACKAGES = [("주간", "11:00 ~ 17:30", "6시간 30분"), ("야간", "19:00 ~ 다음 날 09:30", "14시간 30분"), ("통대관", "12:00 ~ 다음 날 10:00", "22시간")]
RULES = [
    "보증금 20만원은 입실 후 입금, 퇴실 1~2일 뒤 돌려드려요 (기본 쓰레기봉투 4,000원 차감)",
    "기본 정리(설거지·분리수거·장비 원위치)가 안 돼 있으면 보증금에서 청소비가 차감돼요",
    "실내 흡연·전자담배 금지, 흡연은 루프탑 테라스에서만",
    "CCTV는 화장실 외 전 구역에 있어요. 가리거나 끄면 보증금을 돌려드리지 않아요",
    "장비 파손·분실은 구매가로 청구돼요",
    "반려동물은 함께 올 수 없어요",
    "바베큐 후에는 불씨를 끄고 사진을 보내주세요",
]
REFUND = "이용 8일 전까지 취소하면 100% 환불되고, 7일 전부터는 환불이 어려워요. (스페이스클라우드는 결제 후 2시간 안에 취소하면 100% 환불)"

BR_CSS = """
.bh{padding:26px 0 8px}
.bh h1{font-size:clamp(34px,7vw,60px)}
.bh .tag{color:var(--mute);font-size:17px;margin-top:8px}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.facts span{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:7px 11px;font-size:14px}
.facts .star{color:var(--lamp);font-weight:800}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.cta .btn{flex:1 1 180px}
.spec{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}
@media(max-width:720px){.spec{grid-template-columns:1fr}}
.card{background:var(--panel);border-radius:var(--r-md);padding:18px}
.card h3{font-size:18px;margin-bottom:8px}
.card ul{list-style:none}
.card li{padding:7px 0;border-top:1px solid var(--line);font-size:15px}
.card li:first-child{border-top:0}
.card dl{display:grid;grid-template-columns:72px 1fr;gap:8px 12px;font-size:15px}
.card dt{color:var(--lamp);font-weight:700}
.rv{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
@media(max-width:820px){.rv{grid-template-columns:1fr}}
.rv blockquote{background:var(--deep);border:1px solid var(--line);border-radius:var(--r-md);padding:16px;font-size:15px}
.rv cite{display:block;font-style:normal;color:var(--dim);font-size:13px;margin-top:10px}
.price{width:100%;min-width:560px;border-collapse:collapse;margin-top:16px;font-size:15px;font-variant-numeric:tabular-nums}
.price th,.price td{padding:11px 8px;border-bottom:1px solid var(--line);text-align:right}
.price th:first-child,.price td:first-child{text-align:left}
.price thead th{color:var(--mute);font-weight:600;font-size:13px}
.price td:first-child{font-weight:800}
.note{color:var(--dim);font-size:13.5px;margin-top:8px}
.rules{list-style:none;margin-top:14px}
.rules li{padding:10px 0 10px 26px;border-top:1px solid var(--line);position:relative;font-size:15px}
.rules li::before{content:"";position:absolute;left:4px;top:19px;width:8px;height:8px;border-radius:2px;background:var(--lamp)}
.map{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
"""

def won(n): return f"{n:,}원" if n else "-"

def ld_business(b):
    return {
        "@context": "https://schema.org", "@type": "EntertainmentBusiness",
        "name": f"게임파티룸 플레이앤 {b['name']}", "alternateName": f"Play N {b['name']}",
        "url": f"{SITE}/{b['slug']}/", "telephone": "+82-10-8339-5818",
        "address": {"@type": "PostalAddress", "streetAddress": b["addr"].replace("서울 마포구 ", ""), "addressLocality": "마포구", "addressRegion": "서울", "addressCountry": "KR"},
        "geo": {"@type": "GeoCoordinates", "latitude": b["lat"], "longitude": b["lng"]},
        "openingHours": "Mo-Su 00:00-24:00", "priceRange": "₩100,000~",
        "aggregateRating": {"@type": "AggregateRating", "ratingValue": b["rating"], "reviewCount": b["reviews_n"], "bestRating": 5},
        "sameAs": ["https://www.instagram.com/playn_no.1/", b["sc_url"], b["ss_url"]],
    }

def branch_page(b, prices):
    p = prices.get(b["name"], {})
    rows = ""
    for key, (nm, tm, du) in zip(["day", "night", "full"], PACKAGES):
        g = p.get(key, {})
        rows += f"<tr><td>{nm}<br><small style='color:var(--dim);font-weight:500;white-space:nowrap'>{tm.replace(' ~ 다음 날 ','~익일 ').replace(' ~ ','~')}</small></td><td>{won(g.get('A'))}</td><td>{won(g.get('B'))}</td><td>{won(g.get('C'))}</td><td>{won(g.get('D'))}</td></tr>"
    gear = "".join(f"<dt>{E(k)}</dt><dd>{E(v)}</dd>" for k, v in b["gear"])
    reviews = "".join(f"<blockquote>“{E(t)}”<cite>{E(n)} · {d} · 스페이스클라우드 후기</cite></blockquote>" for n, d, t in b["reviews"])
    desc = f"게임파티룸 플레이앤 {b['name']} · {b['tagline']}. 게이밍 PC 5대와 프로 무선 기어, 루프탑 바베큐. 평점 {b['rating']:.2f} (후기 {b['reviews_n']}개)."
    return f"""<!doctype html>
<html lang="ko"><head>
{HEAD_COMMON}
<title>플레이앤 {b['name']} | 홍대 게임파티룸 · 루프탑 바베큐</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{SITE}/{b['slug']}/">
<meta property="og:type" content="website"><meta property="og:url" content="{SITE}/{b['slug']}/">
<meta property="og:title" content="플레이앤 {b['name']} | 홍대 게임파티룸"><meta property="og:description" content="{E(desc)}">
<meta property="og:image" content="{SITE}/assets/og.png">
<script type="application/ld+json">{json.dumps(ld_business(b), ensure_ascii=False)}</script>
<style>{BR_CSS}</style>
</head><body>
{TOP}
<main class="wrap">
  <div class="crumb"><a href="/">플레이앤</a> / {b['name']}</div>
  <section class="bh">
    <h1 class="disp">{b['name']}</h1>
    <p class="tag">{E(b['tagline'])}</p>
    <div class="facts"><span class="star">★ {b['rating']:.2f} · 후기 {b['reviews_n']}개</span><span>{b['cap']}</span><span>{b['floor']}</span><span>{b['area']}</span><span>24시간 운영</span></div>
    <div class="cta">
      <a class="btn lamp" href="{b['ss_url']}" target="_blank" rel="noopener">네이버로 예약</a>
      <a class="btn lamp" href="{b['sc_url']}" target="_blank" rel="noopener">스페이스클라우드로 예약</a>
      <a class="btn pink" href="/?branch={b['name']}#deals">이번 주 멤버 특가 보기</a>
      <a class="btn ghost" href="tel:{HOST.replace('-','')}">전화 문의</a>
    </div>
  </section>

  <section class="s"><h2 class="disp">게이밍 장비</h2><p class="sub">프로게이머가 실제로 쓰는 장비를 진열장에서 골라 써볼 수 있어요.</p>
    <div class="spec">
      <div class="card"><h3>PC · 모니터</h3><ul>{''.join(f'<li>{E(x)}</li>' for x in b['pcs'])}</ul></div>
      <div class="card"><h3>기어</h3><dl>{gear}</dl></div>
    </div>
  </section>

  <section class="s"><h2 class="disp">같이 놀 거리</h2>
    <div class="spec"><div class="card"><ul>{''.join(f'<li>{E(x)}</li>' for x in b['play'])}</ul></div>
    <div class="card"><h3>편의 시설</h3><p style="font-size:15px">{E(b['amen'])}</p><p class="note">배달 음식·주류 반입 가능 · 주차는 없어요 (모두의주차장 앱 추천)</p></div></div>
  </section>

  <section class="s"><h2 class="disp">이용 후기</h2><p class="sub">스페이스클라우드 평점 {b['rating']:.2f}, 후기 {b['reviews_n']}개 중 최근 후기예요.</p>
    <div class="rv">{reviews}</div>
    <p class="note"><a href="{b['sc_url']}" target="_blank" rel="noopener">후기 전체 보기</a></p>
  </section>

  <section class="s"><h2 class="disp">요금</h2><p class="sub">패키지 요금이에요. 보증금 20만원은 별도이고 퇴실 후 돌려드려요.</p>
    <div style="overflow-x:auto"><table class="price"><thead><tr><th>패키지</th><th>평일</th><th>금요일·<br>공휴일 전날</th><th>토요일·<br>연휴 중</th><th>일요일·<br>공휴일 당일</th></tr></thead><tbody>{rows}</tbody></table></div>
    <p class="note">표가 잘리면 옆으로 밀어보세요 · 5명부터 1명 추가마다 2만원 · 바베큐 1인 1만원 · N CREW 멤버는 빈 날짜를 특가로 신청할 수 있어요.</p>
  </section>

  <section class="s"><h2 class="disp">이용 규칙</h2>
    <ul class="rules"><li>{E(b['minors'])}</li>{''.join(f'<li>{E(x)}</li>' for x in RULES)}<li>{E(REFUND)}</li></ul>
    <p class="note">자세한 이용 방법은 예약 후 받는 안내문에 있어요. 궁금한 건 <a href="/help/?b={b['code']}">AI 상담사</a>에게 바로 물어보세요.</p>
  </section>

  <section class="s"><h2 class="disp">오시는 길</h2>
    <p style="margin-top:10px;font-size:17px;font-weight:700">{E(b['addr'])}</p><p class="sub">{E(b['addr_hint'])}</p>
    <div class="map"><a class="btn lamp" href="{b['route_url']}" target="_blank" rel="noopener">네이버 지도 길찾기</a><a class="btn ghost" href="{b['map_url']}" target="_blank" rel="noopener">지도에서 보기</a></div>
  </section>
</main>
{FOOT}
<a class="fab" href="/help/?b={b['code']}"><i></i>AI 상담사</a>
</body></html>"""

# ───────────────────────── 매거진 글 페이지
POST_CSS = """
.pv{max-width:640px;margin:0 auto;padding:0 16px}
.pv .ser{color:var(--lamp);font-weight:800;font-size:14px;margin-top:22px}
.pv h1{font-size:clamp(26px,5.5vw,38px);line-height:1.25;margin-top:6px}
.pv .date{color:var(--dim);font-size:13.5px;margin-top:6px}
.pv .media{margin:20px -16px 0;background:#000}
.pv video{display:block;width:100%;max-height:78vh}
.pv .cards{display:flex;overflow-x:auto;scroll-snap-type:x mandatory}
.pv .cards img{flex:none;width:100%;scroll-snap-align:center;display:block}
.pv .txt{white-space:pre-wrap;font-size:16.5px;line-height:1.8;margin-top:22px}
.pv .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}
.pv .tags span{font-size:13px;background:var(--panel);color:var(--mute);padding:4px 10px;border-radius:999px}
.pv .acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.more{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px}
.more a{text-decoration:none;font-size:14px;font-weight:700}
.more img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:10px;display:block;margin-bottom:6px;background:var(--panel)}
"""

def post_page(p, cats, related):
    cat = next((c["name"] for c in cats if c["id"] == p["cat"]), "")
    title = p["headline"] or p["series"]
    desc = re.sub(r"\s+", " ", p["text"])[:150]
    if p["video"]:
        media = f'<video src="{E(p["video"])}" poster="{E(p["cover"] or "")}" controls playsinline preload="metadata"></video>'
    else:
        media = '<div class="cards">' + "".join(f'<img src="{E(u)}" alt="{E(p["series"])} {i+1}번째 카드" loading="{"eager" if i==0 else "lazy"}">' for i, u in enumerate(p["images"])) + "</div>"
    ld = {"@context": "https://schema.org", "@type": "Article", "headline": title[:110], "datePublished": p["date"], "image": [p["cover"]] if p["cover"] else [],
          "author": {"@type": "Organization", "name": "플레이앤 Play N"}, "publisher": {"@type": "Organization", "name": "플레이앤 Play N"}, "mainEntityOfPage": f"{SITE}/m/{p['id']}/"}
    rel = "".join(f'<a href="/m/{r["id"]}/"><img src="{E(r["cover"] or "")}" alt="" loading="lazy">{E(r["headline"][:40])}</a>' for r in related)
    return f"""<!doctype html>
<html lang="ko"><head>
{HEAD_COMMON}
<title>{E(title)} | 플레이앤 게임 매거진</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{SITE}/m/{p['id']}/">
<meta property="og:type" content="article"><meta property="og:url" content="{SITE}/m/{p['id']}/">
<meta property="og:title" content="{E(title)}"><meta property="og:description" content="{E(desc)}">
<meta property="og:image" content="{E(p['cover'] or SITE + '/assets/og.png')}">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
<style>{POST_CSS}</style>
</head><body>
{TOP}
<main class="pv">
  <div class="crumb"><a href="/">플레이앤</a> / <a href="/#magazine">게임 매거진</a> / {E(cat)}</div>
  <div class="ser">{E(p['series'])}</div>
  <h1 class="disp">{E(title)}</h1>
  <div class="date">{p['date'].replace('-', '.')}</div>
  <div class="media">{media}</div>
  <div class="txt">{E(p['text'])}</div>
  <div class="tags">{''.join(f'<span>#{E(t)}</span>' for t in p['tags'])}</div>
  <div class="acts"><a class="btn pink" href="{E(p['insta'] or 'https://www.instagram.com/playn_no.1/')}" target="_blank" rel="noopener">인스타그램에서 보기</a><a class="btn ghost" href="/#magazine">매거진 목록</a></div>
  <section class="s"><h2 class="disp" style="font-size:22px">같은 주제 글</h2><div class="more">{rel}</div></section>
  <section class="s"><h2 class="disp" style="font-size:22px">친구들이랑 직접 해보고 싶다면</h2><p class="sub">게이밍 PC 5대와 프로 기어가 있는 홍대·연남 게임파티룸이에요.</p>
    <div class="acts"><a class="btn lamp" href="/#deals">이번 주 빈자리 보기</a><a class="btn ghost" href="/#branches">지점 둘러보기</a></div></section>
</main>
{FOOT}
</body></html>"""

def main():
    def get(url):
        with urllib.request.urlopen(url, timeout=30) as r: return json.load(r)
    meta = get(POSTS_API + "?meta=1")
    data = get(POSTS_API)
    urls = [(f"{SITE}/", "daily", "1.0")]
    for b in BRANCHES:
        d = os.path.join(ROOT, b["slug"]); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w").write(branch_page(b, meta["prices"]))
        urls.append((f"{SITE}/{b['slug']}/", "weekly", "0.9"))
    mdir = os.path.join(ROOT, "m"); os.makedirs(mdir, exist_ok=True)
    keep = set()
    for p in data["posts"]:
        related = [r for r in data["posts"] if r["cat"] == p["cat"] and r["id"] != p["id"]][:3]
        d = os.path.join(mdir, str(p["id"])); os.makedirs(d, exist_ok=True); keep.add(str(p["id"]))
        open(os.path.join(d, "index.html"), "w").write(post_page(p, data["categories"], related))
        urls.append((f"{SITE}/m/{p['id']}/", "monthly", "0.6"))
    for old in os.listdir(mdir):  # 숨김 처리된 글 페이지 정리
        if old not in keep and old.isdigit():
            for f in os.listdir(os.path.join(mdir, old)): os.remove(os.path.join(mdir, old, f))
            os.rmdir(os.path.join(mdir, old))
    today = date.today().isoformat()
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(
        f"  <url><loc>{u}</loc><lastmod>{today}</lastmod><changefreq>{c}</changefreq><priority>{pr}</priority></url>\n" for u, c, pr in urls) + "</urlset>\n"
    open(os.path.join(ROOT, "sitemap.xml"), "w").write(sm)
    open(os.path.join(ROOT, "robots.txt"), "w").write(f"User-agent: *\nAllow: /\nDisallow: /admin.html\n\nSitemap: {SITE}/sitemap.xml\n")
    print(f"branches {len(BRANCHES)}, posts {len(keep)}, urls {len(urls)}")

if __name__ == "__main__":
    main()
