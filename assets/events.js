/* 플레이앤 진행 중 이벤트 팝업 (2026-10-12)
   - 사이트에 들어오면 진행 중 이벤트를 카드로 보여줌. 이벤트 추가·종료는 아래 EVENTS 배열만 고치면 됨
   - until 이 지나면 자동으로 빠짐. 이벤트가 없으면 아무것도 안 뜸
   - "오늘 하루 안 보기" = 그날(한국 시간) 다시 안 뜸. 같은 방문(탭) 안에서는 한 번만 뜸
   - 다른 곳에서 열기: window.pnEvents.open()  /  data-events-open 속성이 있는 링크·버튼을 누르면 열림 */
(function () {
  var EVENTS = [
    { id: "meet1024", kick: "NEW · 14명 한정", title: "롤드컵 밤샘 소셜링",
      sub: "루프탑 바베큐 + 프리드링크 + 혼성 2인 1팀 칼바람 토너먼트, 새벽엔 롤드컵 같이 보기",
      meta: ["10/24(토) 19:00 → 일 12:00", "연남루프탑점", "1인 70,000원"], cta: "프로필 보내기",
      href: "/meet/", img: "https://bjrgtoyjrggxmdexnwib.supabase.co/storage/v1/object/public/playn-media/ugc/sc_1261339.jpg",
      accent: "#FF2E6E", until: "2026-10-23T18:00:00+09:00" },
    { id: "military", kick: "국군장병 감사 이벤트", title: "자랑스러운 국군장병\n여러분, 감사합니다",
      sub: "군인 인증하면 첫 예약 5만원 할인 + 조기입실·늦은퇴실 2시간권. 시간이 안 되는 날엔 바베큐 무료로 바꿔드려요.",
      meta: ["밀리패스로 온라인 인증", "같이 온 인원 모두 N CREW 가입", "올 때마다 음료 2병"], cta: "군인 인증하러 가기",
      href: "/for/military/", img: "https://bjrgtoyjrggxmdexnwib.supabase.co/storage/v1/object/public/playn-media/ugc/sc_1091459.jpg",
      accent: "#2BE07A", until: "2026-12-31T23:59:00+09:00" },
    { id: "worlds", kick: "롤드컵 2026 이벤트", title: "우승팀 맞히면\n최대 10만원 페이백",
      sub: "N CREW 1인 1표로 우승팀을 예언하세요. 나이트·통대관 팀이 맞히면 이용료를 돌려드려요.",
      meta: ["11/14까지 참여", "N CREW 전원 가입 팀", "8강 전 10만 · 이후 5만"], cta: "예언하러 가기",
      href: "/worlds/", img: null, accent: "#FFB547", until: "2026-11-14T23:59:00+09:00" }
  ];
  var path = location.pathname;
  var now = Date.now();
  var list = EVENTS.filter(function (e) { return new Date(e.until).getTime() > now && path.indexOf(e.href) !== 0; });
  var all = EVENTS.filter(function (e) { return new Date(e.until).getTime() > now; });
  var kst = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  function get(s, k) { try { return window[s].getItem(k); } catch (e) { return null; } }
  function set(s, k, v) { try { window[s].setItem(k, v); } catch (e) {} }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function track(n, o) { if (window.pnTrack) try { window.pnTrack(n, o || {}); } catch (e) {} }

  var css = ".pnev-bg{position:fixed;inset:0;z-index:90;background:rgba(8,6,24,.66);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .25s}" +
    ".pnev-bg.on{opacity:1}" +
    ".pnev{width:100%;max-width:440px;background:#16133F;border:1px solid #3A3580;border-radius:24px 24px 0 0;padding:18px 0 calc(16px + env(safe-area-inset-bottom));transform:translateY(40px);transition:transform .35s cubic-bezier(.16,1,.3,1);color:#F1EFFF;font-family:Pretendard,sans-serif}" +
    ".pnev-bg.on .pnev{transform:none}.pnev:focus{outline:0}" +
    "@media(min-width:640px){.pnev-bg{align-items:center}.pnev{border-radius:24px}}" +
    ".pnev-hd{display:flex;justify-content:space-between;align-items:center;padding:0 18px 12px}" +
    ".pnev-hd b{font:400 20px/1.2 'Black Han Sans',Pretendard,sans-serif}.pnev-hd b span{color:#FF2E6E;margin-left:6px;font-size:15px}" +
    ".pnev-x{background:none;border:0;color:#B3AFDF;font-size:28px;line-height:1;cursor:pointer;padding:4px 6px}" +
    ".pnev-track{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:0 18px 4px;scrollbar-width:none}.pnev-track::-webkit-scrollbar{display:none}" +
    ".pnev-card{flex:0 0 100%;scroll-snap-align:center;border-radius:20px;overflow:hidden;position:relative;min-height:340px;display:flex;flex-direction:column;justify-content:flex-end;text-decoration:none;color:#fff;background:#0E0C2C}" +
    ".pnev-card .im{position:absolute;inset:0;background-size:cover;background-position:center}" +
    ".pnev-card:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(14,12,44,.05) 10%,rgba(14,12,44,.92) 72%)}" +
    ".pnev-card .tx{position:relative;z-index:1;padding:18px}" +
    ".pnev-card .k{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.05em;padding:5px 10px;border-radius:999px;color:#fff}" +
    ".pnev-card h3{font:400 30px/1.12 'Black Han Sans',Pretendard,sans-serif;margin-top:10px;white-space:pre-line}" +
    ".pnev-card p{font-size:14.5px;line-height:1.6;color:#E3E0FF;margin-top:8px}" +
    ".pnev-card ul{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0;padding:0}.pnev-card li{font-size:12.5px;font-weight:700;background:rgba(255,255,255,.12);padding:5px 9px;border-radius:8px}" +
    ".pnev-card .go{display:block;text-align:center;margin-top:14px;padding:14px;border-radius:999px;font-weight:800;font-size:16px}" +
    ".pnev-dots{display:flex;justify-content:center;gap:6px;margin-top:12px}.pnev-dots i{width:7px;height:7px;border-radius:50%;background:#3A3580;transition:all .2s}.pnev-dots i.on{width:20px;border-radius:9px;background:#FFB547}" +
    ".pnev-ft{display:flex;justify-content:space-between;padding:12px 22px 0;font-size:14px}.pnev-ft button{background:none;border:0;color:#B3AFDF;font:inherit;cursor:pointer;padding:6px 0}.pnev-ft button.c{color:#F1EFFF;font-weight:700}" +
    "@media (prefers-reduced-motion:reduce){.pnev,.pnev-bg{transition:none}}";

  function open(src) {
    var L = src === "nav" ? all : list;
    if (!L.length || document.querySelector(".pnev-bg")) return;
    if (!document.getElementById("pnev-css")) { var st = document.createElement("style"); st.id = "pnev-css"; st.textContent = css; document.head.appendChild(st); }
    var bg = document.createElement("div"); bg.className = "pnev-bg";
    bg.innerHTML = '<div class="pnev" role="dialog" aria-modal="true" aria-labelledby="pnevT" tabindex="-1">' +
      '<div class="pnev-hd"><b id="pnevT">진행 중인 이벤트<span>' + L.length + '</span></b><button class="pnev-x" type="button" aria-label="닫기">×</button></div>' +
      '<div class="pnev-track">' + L.map(function (e) {
        var bgi = e.img ? 'background-image:url(' + e.img + ')' : 'background:radial-gradient(120% 90% at 80% 10%,' + e.accent + '55,transparent 60%),radial-gradient(100% 80% at 0% 100%,#3DF2FF33,transparent 60%),#0E0C2C';
        return '<a class="pnev-card" href="' + e.href + '" data-id="' + e.id + '"><div class="im" style="' + bgi + '"></div><div class="tx">' +
          '<span class="k" style="background:' + e.accent + ((e.accent === "#FFB547" || e.accent === "#2BE07A") ? ';color:#1B1640' : '') + '">' + esc(e.kick) + '</span>' +
          '<h3>' + esc(e.title) + '</h3><p>' + esc(e.sub) + '</p><ul>' + e.meta.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join("") + '</ul>' +
          '<span class="go" style="background:' + e.accent + ';color:' + ((e.accent === "#FFB547" || e.accent === "#2BE07A") ? '#1B1640' : '#fff') + '">' + esc(e.cta) + ' →</span></div></a>';
      }).join("") + '</div>' +
      (L.length > 1 ? '<div class="pnev-dots">' + L.map(function (_, i) { return '<i class="' + (i ? "" : "on") + '"></i>'; }).join("") + '</div>' : '') +
      '<div class="pnev-ft"><button type="button" class="d">오늘 하루 안 보기</button><button type="button" class="c">닫기</button></div></div>';
    document.body.appendChild(bg);
    var last = document.activeElement;
    requestAnimationFrame(function () { bg.classList.add("on"); });
    function close(why) { bg.classList.remove("on"); setTimeout(function () { bg.remove(); if (last && last.focus) last.focus(); }, 260); document.removeEventListener("keydown", onKey); track("events_close", { why: why }); }
    function onKey(ev) { if (ev.key === "Escape") close("esc"); }
    document.addEventListener("keydown", onKey);
    bg.addEventListener("click", function (ev) { if (ev.target === bg) close("bg"); });
    bg.querySelector(".pnev-x").onclick = function () { close("x"); };
    bg.querySelector(".pnev-ft .c").onclick = function () { close("close"); };
    bg.querySelector(".pnev-ft .d").onclick = function () { set("localStorage", "pn_ev_hide", kst); close("today"); };
    bg.querySelectorAll(".pnev-card").forEach(function (a) { a.addEventListener("click", function () { track("events_click", { id: a.dataset.id }); }); });
    var tr = bg.querySelector(".pnev-track"), dots = bg.querySelectorAll(".pnev-dots i");
    if (dots.length) tr.addEventListener("scroll", function () { var i = Math.round(tr.scrollLeft / tr.clientWidth); dots.forEach(function (d, j) { d.classList.toggle("on", i === j); }); }, { passive: true });
    bg.querySelector(".pnev").focus({ preventScroll: true });
    track("events_open", { n: L.length, src: src || "auto" });
  }
  window.pnEvents = { open: open, list: all };
  function chips() { document.querySelectorAll("[data-events-open]").forEach(function (a) { if (!all.length) a.hidden = true; var i = a.querySelector("i"); if (i) i.textContent = all.length; }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", chips); else chips();
  document.addEventListener("click", function (ev) { var a = ev.target.closest && ev.target.closest("[data-events-open]"); if (a) { ev.preventDefault(); open("nav"); } });
  if (!list.length || get("localStorage", "pn_ev_hide") === kst || get("sessionStorage", "pn_ev_seen")) return;
  if (/[?&](k|t)=/.test(location.search) || location.hash === "#admin") return;
  // 2026-10-17 자동 팝업 시점: SNS 유입(?from=·utm_source, 같은 세션 포함)은 첫 화면에 띄우지 않고
  // 50% 스크롤 또는 견적 바를 만진 뒤 5초. 직접 방문은 7초 또는 30% 스크롤. 견적 바 조건 창이 열려 있으면 닫힐 때까지 미룸
  var qs = new URLSearchParams(location.search), sns = !!(qs.get("from") || qs.get("utm_source") || get("sessionStorage", "pn_src"));
  var done = false, tm = null, need = sns ? 0.5 : 0.3;
  function fire() {
    if (done) return;
    var qp = document.getElementById("qPanel");
    if (qp && !qp.hidden) { clearTimeout(tm); tm = setTimeout(fire, 3000); return; }
    done = true; clearTimeout(tm); removeEventListener("scroll", onScroll);
    set("sessionStorage", "pn_ev_seen", "1"); open("auto");
  }
  function onScroll() { var h = document.documentElement.scrollHeight - innerHeight; if (h > 0 && scrollY / h >= need) fire(); }
  addEventListener("scroll", onScroll, { passive: true });
  if (sns) document.addEventListener("click", function (ev) { if (!done && ev.target.closest && ev.target.closest("#qbar")) { clearTimeout(tm); tm = setTimeout(fire, 5000); } });
  else tm = setTimeout(fire, 7000);
})();
