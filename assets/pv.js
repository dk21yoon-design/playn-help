/* Play N 방문 통계 (2026-10-10) — 쿠키·IP 저장 없음. 무작위 방문자 번호와 유입 경로(from/utm)만 기록 */
(() => {
  try {
    if (navigator.webdriver || /^(localhost|127\.)/.test(location.hostname)) return;
    const E = "https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-growth";
    const rid = () => Math.random().toString(36).slice(2, 12);
    const keep = (st, k, f) => { try { let v = st.getItem(k); if (!v) { v = f(); st.setItem(k, v); } return v; } catch (e) { return f(); } };
    const vid = keep(localStorage, "pn_vid", rid), sid = keep(sessionStorage, "pn_sid", rid);
    const q = new URLSearchParams(location.search);
    const src0 = q.get("from") || q.get("utm_source") || "";
    try { if (src0) sessionStorage.setItem("pn_src", src0); } catch (e) {}
    let src = src0; try { src = src0 || sessionStorage.getItem("pn_src") || ""; } catch (e) {}
    let ref = ""; try { if (document.referrer) { const r = new URL(document.referrer); if (r.host !== location.host) ref = r.host; } } catch (e) {}
    const send = (ev, label) => {
      const b = JSON.stringify({ action: "pv", path: location.pathname, ev: ev || "view", label: label || "", src, ref, vid, sid });
      if (navigator.sendBeacon) navigator.sendBeacon(E, new Blob([b], { type: "text/plain" }));
      else fetch(E, { method: "POST", body: b, keepalive: true }).catch(() => {});
    };
    send("view");
    window.pnTrack = (label) => send("click", label);
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a,button"); if (!a) return;
      let t = a.dataset.track || "";
      if (!t && a.href && /smartstore|spacecloud|naver\.|booking|tel:|kakao|instagram|youtube|map/.test(a.href)) t = a.href.replace(/^https?:\/\//, "").slice(0, 60);
      if (!t && a.tagName === "BUTTON" && a.id) t = "#" + a.id;
      if (t) send("click", t);
    }, { capture: true });
  } catch (e) {}
})();
