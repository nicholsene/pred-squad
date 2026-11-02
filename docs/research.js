/* Research catalogue panel (Plan tab): what top-ranked players build by hero, lane and enemy laner.
   Data: data/research.json, written daily by scripts/research.py. */
(function () {
  "use strict";
  const LANES = [["CARRY", "Carry"], ["MIDLANE", "Mid"], ["OFFLANE", "Offlane"], ["JUNGLE", "Jungle"], ["SUPPORT", "Support"]];
  const R = (window.Research = { data: null, loaded: false });
  const pick = { hero: null, role: "CARRY", vs: "" };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (w, g) => (g ? Math.round((100 * w) / g) + "%" : "–");

  async function load() {
    try {
      const r = await fetch("data/research.json?v=" + Date.now());
      R.data = r.ok ? await r.json() : null;
    } catch { R.data = null; }
    R.loaded = true;
    document.dispatchEvent(new CustomEvent("squad:research"));
    render();
  }

  function render() {
    const el = document.getElementById("research"), A = window.__app;
    if (!el) return;
    if (!A) { setTimeout(render, 300); return; }
    const D = R.data, body = el.querySelector(".research-body") || el;
    if (!R.loaded) { body.innerHTML = '<p class="note">Loading research…</p>'; return; }
    if (!D || !D.heroes) {
      body.innerHTML = '<p class="note">Top-player builds appear here after the next daily data update. They refresh once a day from the ranked games of the top 200 leaderboard players.</p>';
      return;
    }
    const heroName = s => (A.heroes.find(h => h.slug === s)?.name) || s;
    const itemName = n => A.items.find(i => i.name === n)?.label || n;
    const heroes = Object.keys(D.heroes).sort((a, b) => heroName(a).localeCompare(heroName(b)));
    if (!pick.hero || !D.heroes[pick.hero]) pick.hero = heroes[0];
    const roles = LANES.filter(([r]) => D.heroes[pick.hero]?.[r]);
    if (!D.heroes[pick.hero]?.[pick.role]) pick.role = roles[0]?.[0];
    const base = D.heroes[pick.hero]?.[pick.role];
    const enemies = base ? Object.entries(base.vs || {}).sort((a, b) => b[1].games - a[1].games) : [];
    const classes = base ? Object.entries(base.vsClass || {}).sort((a, b) => b[1].games - a[1].games) : [];
    if (pick.vs && !(pick.vs.startsWith("class:") ? base?.vsClass?.[pick.vs.slice(6)] : base?.vs?.[pick.vs])) pick.vs = "";
    const S = !pick.vs ? base : pick.vs.startsWith("class:") ? base.vsClass[pick.vs.slice(6)] : base.vs[pick.vs];
    const vsLabel = !pick.vs ? "" : pick.vs.startsWith("class:") ? " vs " + pick.vs.slice(6).toLowerCase() + "s" : " vs " + heroName(pick.vs);
    const classify = names => (window.BuildPlans?.classify ? window.BuildPlans.classify(names, A.items) : null);
    let html = '<div class="research-controls">' +
      '<label>Hero <select data-r="hero">' + heroes.map(h => `<option value="${esc(h)}"${h === pick.hero ? " selected" : ""}>${esc(heroName(h))}</option>`).join("") + "</select></label>" +
      '<label>Lane <select data-r="role">' + roles.map(([r, l]) => `<option value="${r}"${r === pick.role ? " selected" : ""}>${l} (${D.heroes[pick.hero][r].games})</option>`).join("") + "</select></label>" +
      '<label>Against <select data-r="vs"><option value="">Any enemy</option>' +
      classes.map(([c, v]) => `<option value="class:${esc(c)}"${pick.vs === "class:" + c ? " selected" : ""}>${esc(c.charAt(0) + c.slice(1).toLowerCase())}s (${v.games})</option>`).join("") +
      enemies.map(([e, v]) => `<option value="${esc(e)}"${pick.vs === e ? " selected" : ""}>${esc(heroName(e))} (${v.games})</option>`).join("") +
      "</select></label></div>";
    if (S) {
      const thin = S.games < 10;
      html += `<p class="research-head"><b>${S.games}</b> high-ranked ${S.games === 1 ? "build" : "builds"} of ${esc(heroName(pick.hero))} ${esc((LANES.find(l => l[0] === pick.role) || [])[1] || "")}${esc(vsLabel)} · won ${pct(S.wins, S.games)}` +
        (thin ? ' <span class="research-thin">Small sample: treat as examples, not a rule.</span>' : "") + "</p>";
      if (S.openings?.length) {
        html += '<div class="sub-h">Most common first three items</div><ol class="research-open">' + S.openings.map(o => {
          const c = classify(o.items);
          return `<li>${o.items.map(n => esc(itemName(n))).join(" → ")} <small>${o.games} games · won ${pct(o.wins, o.games)}${c && c.primary !== "balanced" ? " · " + esc(c.label) : ""}</small></li>`;
        }).join("") + "</ol>";
      }
      const rows = Object.entries(S.items || {}).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12)
        .sort((a, b) => a[1][2] / a[1][0] - b[1][2] / b[1][0]);
      html += '<div class="sub-h">Items they finish, in usual buy order</div><table class="research-items"><thead><tr><th>Item</th><th>Built</th><th>Won</th><th>Buy #</th></tr></thead><tbody>' +
        rows.map(([n, [g, w, p]]) => `<tr><td>${esc(itemName(n))}</td><td>${pct(g, S.games)}</td><td>${pct(w, g)}</td><td>${(p / g + 1).toFixed(1)}</td></tr>`).join("") + "</tbody></table>";
      const mins = (S.minutes || []).map((m, k) => (m == null ? null : `#${k + 1} ~${m} min`)).filter(Boolean);
      if (mins.length) html += `<p class="note">Typical time each item is affordable (from gold earned): ${mins.join(" · ")}</p>`;
    }
    html += `<p class="note">From ${D.matches} ranked matches of the top ${D.sampledPlayers} leaderboard players; builds from ${Math.round(D.minPoints)}+ rank points only. Final items only: "Buy #" is slot order, which follows purchase order. Updated ${esc((D.updatedAt || "").slice(0, 10))}.</p>`;
    body.innerHTML = html;
    body.querySelectorAll("select[data-r]").forEach(s => (s.onchange = () => { pick[s.dataset.r] = s.value; if (s.dataset.r !== "vs") pick.vs = ""; render(); }));
  }

  R.render = render;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
