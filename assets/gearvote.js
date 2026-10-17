/* Play N 월간 기어 입고 투표 (2026-10-17) — 홈(#gear)과 /gear/ 가 같이 쓰는 위젯
   데이터: playn-community (GET 후보·이번 달 표 / POST vote · gear_propose)
   규칙: 이번 달 10표 넘은 후보 중 최다 득표 1개를 매달 실제로 구매 */
(() => {
  const API = "https://bjrgtoyjrggxmdexnwib.supabase.co/functions/v1/playn-community";
  const CAT = { mouse: "마우스", keyboard: "키보드", headset: "헤드셋", monitor: "모니터", etc: "기타" };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  let voter = ls.get("pn_voter");
  if (!voter) { voter = Math.random().toString(36).slice(2) + Date.now().toString(36); ls.set("pn_voter", voter); }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const track = (l) => { if (window.pnTrack) window.pnTrack(l); };

  function mount(root) {
    if (!root || root.dataset.gvOn) return; root.dataset.gvOn = "1";
    let D = null, busy = false;
    const key = () => "pn_voted_" + (D ? D.month : "");
    const mine = () => { try { return JSON.parse(ls.get(key()) || "[]"); } catch (e) { return []; } };
    const addMine = (it) => ls.set(key(), JSON.stringify([...new Set([...mine(), it])]));
    root.innerHTML = `<div class="gv-list" aria-live="polite"><p class="gv-msg">투표 불러오는 중이에요</p></div>
      <form class="gv-form" novalidate>
        <p class="gv-ft"><b>후보에 없으면 직접 신청</b><span>신청하면 바로 후보에 올라가고 내 1표가 들어가요 · 하루 한 번</span></p>
        <div class="gv-row">
          <label class="gv-sr" for="gvItem-${root.id}">모델명</label>
          <input id="gvItem-${root.id}" name="item" maxlength="40" autocomplete="off" placeholder="모델명 (예: 레이저 바이퍼 V3 프로)" required>
          <label class="gv-sr" for="gvCat-${root.id}">종류</label>
          <select id="gvCat-${root.id}" name="cat">${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        </div>
        <label class="gv-sr" for="gvWhy-${root.id}">써보고 싶은 이유</label>
        <input id="gvWhy-${root.id}" name="reason" maxlength="60" autocomplete="off" placeholder="써보고 싶은 이유 한 줄 (선택)">
        <div class="gv-row gv-act"><button type="submit" class="gv-go">후보로 신청하고 1표</button><span class="gv-fmsg" role="status"></span></div>
      </form>`;
    const list = root.querySelector(".gv-list"), form = root.querySelector(".gv-form"), fmsg = root.querySelector(".gv-fmsg");

    function draw() {
      if (!D) return;
      const done = mine(), min = D.min || 10;
      const cs = [...D.candidates].sort((a, b) => b.votes - a.votes || a.item.localeCompare(b.item));
      const lead = cs.find((c) => c.votes >= min && c.votes === Math.max(...cs.map((x) => x.votes)));
      list.innerHTML = "";
      cs.forEach((c) => {
        const ok = c.votes >= min, voted = done.includes(c.item), pct = Math.min(100, (c.votes / min) * 100);
        const el = document.createElement("div");
        el.className = "gv-c" + (ok ? " ok" : "") + (lead && lead.item === c.item ? " lead" : "");
        el.innerHTML = `<div class="gv-top"><span class="gv-k">${esc(CAT[c.cat] || "장비")}${c.fresh ? ' · <em>새로 신청</em>' : ""}</span>
            <b class="gv-n" aria-label="이번 달 ${c.votes}표">${c.votes}<small>표</small></b></div>
          <p class="gv-name">${esc(c.item)}</p>${c.reason ? `<p class="gv-why">“${esc(c.reason)}”</p>` : ""}
          <div class="gv-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${min}" aria-valuenow="${Math.min(c.votes, min)}" aria-label="입고 조건 ${min}표까지"><i style="width:${pct}%"></i></div>
          <p class="gv-st">${ok ? (lead && lead.item === c.item ? "✅ 구매 후보 자격 달성 · 지금 1위 🔥" : "✅ 구매 후보 자격 달성") : `입고 조건까지 <b>${min - c.votes}표</b> 남음 (${c.votes}/${min})`}</p>
          <button type="button" class="gv-vote" ${voted ? "disabled" : ""}>${voted ? "이번 달 투표 완료" : "써보고 싶어요 +1"}</button>`;
        const b = el.querySelector(".gv-vote");
        b.onclick = async () => {
          if (busy || voted) return; busy = true;
          c.votes++; addMine(c.item); draw(); track("cta_gear_vote:" + c.item); // 낙관적 업데이트: 화면 먼저
          const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "vote", item: c.item, voter }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "네트워크가 끊겼어요" }));
          busy = false;
          if (r.ok) { if (typeof r.votes === "number") c.votes = r.votes; draw(); }
          else if (r.already) { c.votes = Math.max(0, c.votes - 1); draw(); }
          else { c.votes = Math.max(0, c.votes - 1); ls.set(key(), JSON.stringify(mine().filter((x) => x !== c.item))); draw(); say(r.error || "투표가 안 됐어요. 다시 눌러 주세요"); }
        };
        list.appendChild(el);
      });
      if (!cs.length) list.innerHTML = '<p class="gv-msg">이번 달 후보가 아직 없어요. 아래에서 첫 후보를 신청해 주세요.</p>';
      root.dispatchEvent(new CustomEvent("gv:data", { detail: D, bubbles: true }));
    }
    function say(m, ok) { fmsg.textContent = m; fmsg.className = "gv-fmsg" + (ok ? " ok" : " err"); }
    async function load() {
      const j = await fetch(API, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (!j || !Array.isArray(j.candidates)) { list.innerHTML = '<p class="gv-msg">투표를 불러오지 못했어요. 새로고침해 주세요.</p>'; return; }
      D = j; draw();
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      const item = form.item.value.trim(), reason = form.reason.value.trim();
      if (item.length < 3) { say("모델명을 3자 이상 적어 주세요"); form.item.focus(); return; }
      const last = ls.get("pn_gear_prop");
      if (last && Date.now() - +last < 864e5) { say("직접 신청은 하루에 한 번만 할 수 있어요"); return; }
      const btn = form.querySelector(".gv-go"); btn.disabled = true; say("신청하는 중…", true);
      const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "gear_propose", item, reason, cat: form.cat.value, voter }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "네트워크가 끊겼어요" }));
      btn.disabled = false;
      if (!r.ok) { say(r.error || "신청이 안 됐어요"); return; }
      ls.set("pn_gear_prop", String(Date.now())); D = { month: r.month, min: r.min, candidates: r.candidates, bought: r.bought };
      if (r.voted !== false) addMine(r.item);
      draw(); form.reset(); track("cta_gear_propose");
      say(r.existed ? `이미 있는 후보라 「${r.item}」에 1표 넣었어요` : `「${r.item}」 후보 등록 완료! 친구들한테 표 부탁해 보세요`, true);
    };
    load(); setInterval(() => { if (!document.hidden && !busy) load(); }, 60000);
  }
  const boot = () => document.querySelectorAll("[data-gearvote]").forEach(mount);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
