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
    const send = (ev, label, extra) => {
      const b = JSON.stringify(Object.assign({ path: location.pathname, ev: ev || "view", label: label || "", src, ref, vid, sid }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(E, new Blob([b], { type: "text/plain" }));
      else fetch(E, { method: "POST", body: b, keepalive: true }).catch(() => {});
    };
    send("view");
    window.pnTrack = (label) => send("click", String(label || ""));
    // 클릭: data-track > id > 외부 링크 주소 > 내부 링크 경로·글자
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a,button,[data-track],summary"); if (!a) return;
      let t = a.dataset && a.dataset.track || "";
      const href = a.getAttribute && a.getAttribute("href") || "";
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
