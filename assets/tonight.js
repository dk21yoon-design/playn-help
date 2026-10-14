/* 오늘 밤 빈 방 배너 (2026-10-15)
   playn-site ?deals 의 오늘(0번째 날) 야간 빈자리를 보고, 빈 지점이 있으면 헤더 아래에 얇은 띠를 띄움.
   야간 시작 1시간 전(18시)이 지나면 서버가 free=false 로 주므로 자동으로 사라짐. 오늘 하루 닫기 지원 */
(function () {
  var SH = { "홍대루프탑점": "홍대", "연남루프탑점": "연남", "연트럴파크점": "연트럴" };
  var kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  try { if (localStorage.getItem("pn_tonight_hide") === kst) return; } catch (e) {}
  fetch("https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-site?deals=1").then(function (r) { return r.json(); }).then(function (d) {
    var day = d && d.days && d.days[0]; if (!day) return;
    var free = Object.keys(day.branches).filter(function (b) { var s = day.branches[b].night; return s && s.free; });
    if (!free.length) return;
    var min = Math.min.apply(null, free.map(function (b) { var s = day.branches[b].night; return s.deal || s.regular || 1e9; }));
    var flash = free.some(function (b) { return day.branches[b].night.kind === "flash"; });
    var css = ".pn-tn{position:relative;z-index:31;background:linear-gradient(90deg,#2BE07A,#3DF2FF);color:#0E0C2C;font:800 14px/1.4 Pretendard,sans-serif}" +
      ".pn-tn a{display:flex;gap:8px;align-items:center;justify-content:center;padding:9px 40px 9px 14px;color:inherit;text-decoration:none;text-align:center}" +
      ".pn-tn button{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:0;font-size:20px;line-height:1;color:#0E0C2C;cursor:pointer;padding:4px}";
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var bar = document.createElement("div"); bar.className = "pn-tn";
    var here = location.pathname === "/" || location.pathname === "/index.html";
    bar.innerHTML = '<a href="' + (here ? "#deals" : "/#deals") + '">🌙 오늘 밤 ' + free.map(function (b) { return SH[b] || b; }).join("·") + ' 비어 있어요' +
      (min < 1e9 ? ' · ' + min.toLocaleString("ko-KR") + '원부터' : '') + (flash ? ' ⚡' : '') + ' →</a><button type="button" aria-label="오늘 하루 닫기">×</button>';
    var top = document.querySelector("header.top");
    if (top && top.parentNode) top.parentNode.insertBefore(bar, top.nextSibling); else document.body.prepend(bar);
    bar.querySelector("button").onclick = function () { try { localStorage.setItem("pn_tonight_hide", kst); } catch (e) {} bar.remove(); };
    bar.querySelector("a").addEventListener("click", function () { if (window.pnTrack) try { pnTrack("tonight_click", { n: free.length }); } catch (e) {} });
    if (window.pnTrack) try { pnTrack("tonight_show", { n: free.length }); } catch (e) {}
  }).catch(function () {});
})();
