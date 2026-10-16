/* Play N 방문 통계 (2026-10-10 → 10-15 확장) — 쿠키·IP 저장 없음. 무작위 방문자 번호와 유입 경로만 기록
   view: 페이지 열림 · click: 누른 버튼/링크 · scroll: 25/50/75/100% 도달 · leave: 머문 시간과 최대 스크롤 */
(() => {
  try {
    if (navigator.webdriver || /^(localhost|127\.)/.test(location.hostname)) return;
    const E = "https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-track";
    const rid = () => Math.random().toString(36).slice(2, 12);
    const keep = (st, k, f) => { try { let v = st.getItem(k); if (!v) { v = f(); st.setItem(k, v); } return v; } catch (e) { return f(); } };
    const vid = keep(localStorage, "pn_vid", rid), sid = keep(sessionStorage, "pn_sid", rid);
    const q = new URLSearchParams(location.search);
    const src0 = q.get("from") || q.get("utm_source") || "";
    try { if (src0) sessionStorage.setItem("pn_src", src0); } catch (e) {}
    let src = src0; try { src = src0 || sessionStorage.getItem("pn_src") || ""; } catch (e) {}
    let ref = ""; try { if (document.referrer) { const r = new URL(document.referrer); if (r.host !== location.host) ref = r.host; } } catch (e) {}
    // 2026-10-17: SNS 유입 채널 (화면 배지용). 저장하는 src 값은 바꾸지 않는다
    const CH = { ig: "ig", instagram: "ig", yt: "yt", youtube: "yt", th: "th", threads: "th", fb: "fb", facebook: "fb", tt: "tt", tiktok: "tt" };
    let ch = CH[String(src).toLowerCase()] || "";
    if (!ch && ref) ch = /instagram/.test(ref) ? "ig" : /youtu/.test(ref) ? "yt" : /threads/.test(ref) ? "th" : /facebook|fb\./.test(ref) ? "fb" : /tiktok/.test(ref) ? "tt" : "";
    window.pnChannel = ch;
    const send = (ev, label, extra) => {
      const b = JSON.stringify(Object.assign({ path: location.pathname, ev: ev || "view", label: label || "", src, ref, vid, sid }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(E, new Blob([b], { type: "text/plain" }));
      else fetch(E, { method: "POST", body: b, keepalive: true }).catch(() => {});
    };
    send("view");
    window.pnTrack = (label) => send("click", String(label || ""));
    // 2026-10-17: 예약 링크는 cta_reserve:<채널>:<지점>:<위치> 로 통일 (예: cta_reserve:naver:yeonnam:br_card)
    const BR = { "9434661597": "hongdae", "43667": "hongdae", "9430485644": "yeonnam", "55750": "yeonnam", "12071850850": "yeontral", "72605": "yeontral" };
    const reserveLabel = (a, href) => {
      const m = href.match(/smartstore\.naver\.com\/playn_\/products\/(\d+)|booking\.naver\.com|spacecloud\.kr\/space\/(\d+)/);
      if (!m) return "";
      const chn = /spacecloud/.test(href) ? "spacecloud" : "naver";
      const br = BR[m[1] || m[2]] || (location.pathname.match(/^\/(hongdae|yeonnam|yeontral)/) || [])[1] || "unknown";
      const pl = a.dataset.place || (a.closest("[data-place]") || {}).dataset?.place || (a.closest("section[id]") || {}).id || location.pathname.replace(/\//g, "") || "home";
      return ["cta_reserve", chn, br, pl].join(":");
    };
    window.pnReserveLabel = reserveLabel;
    // 클릭: 예약 링크 > 쿠팡(pick) > data-track > id > 외부 링크 주소 > 내부 링크 경로·글자
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a,button,[data-track],summary"); if (!a) return;
      const href = a.getAttribute && a.getAttribute("href") || "";
      let t = reserveLabel(a, href);
      if (!t && /coupang\.com/.test(href)) t = "pick_out:" + (a.dataset.no || "");
      if (!t) t = a.dataset && a.dataset.track || "";
      const txt = (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24);
      if (!t && /^(https?:|tel:|sms:)/.test(href) && !href.includes(location.host)) t = href.replace(/^https?:\/\//, "").slice(0, 60);
      if (!t && a.id) t = "#" + a.id;
      if (!t && href) t = (href.startsWith("#") ? href : href.replace(/^https?:\/\/[^/]+/, "")) + (txt ? " " + txt : "");
      if (!t && txt) t = txt;
      if (t) send("click", t.slice(0, 80));
    }, { capture: true });
    // 스크롤 깊이 (25·50·75·100%) 한 번씩
    let maxD = 0; const marks = [25, 50, 75, 100], hit = new Set();
    const onScroll = () => {
      const h = document.documentElement, total = h.scrollHeight - innerHeight;
      const d = total > 0 ? Math.min(100, Math.round((scrollY / total) * 100)) : 100;
      if (d > maxD) maxD = d;
      for (const m of marks) if (d >= m && !hit.has(m)) { hit.add(m); send("scroll", m + "%", { depth: m }); }
    };
    addEventListener("scroll", () => { clearTimeout(onScroll.t); onScroll.t = setTimeout(onScroll, 250); }, { passive: true });
    // 떠날 때: 실제로 화면에 떠 있던 시간과 최대 스크롤
    let shown = Date.now(), acc = 0, sent = false;
    document.addEventListener("visibilitychange", () => { if (document.hidden) { acc += Date.now() - shown; } else { shown = Date.now(); } });
    const leave = () => { if (sent) return; sent = true; if (!document.hidden) acc += Date.now() - shown; onScroll(); send("leave", "", { dur: Math.round(acc / 1000), depth: maxD }); };
    addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && !sent) { sent = true; send("leave", "", { dur: Math.round(acc / 1000), depth: maxD }); } });
  } catch (e) {}
})();
