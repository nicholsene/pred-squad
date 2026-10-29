/* Squad Planner UI. Loads data/*.json and renders with SquadEngine. */
(async function () {
  "use strict";
  const E = window.SquadEngine;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = x => (x == null || isNaN(x)) ? "—" : `${Math.round(x * 100)}%`;
  const num = (x, d = 1) => (x == null || isNaN(x)) ? "—" : Number(x).toLocaleString(undefined, { maximumFractionDigits: d });
  const wl = r => `${r.wins}–${r.losses ?? (r.games - r.wins)}`;

  async function load(name, fallback) {
    try { const r = await fetch(`data/${name}?v=${Date.now()}`); if (!r.ok) throw 0; return await r.json(); }
    catch { return fallback; }
  }
  const [squad, heroesF, matchesF, meta, status] = await Promise.all([
    load("squad.json", { players: [], targets: {} }),
    load("heroes.json", { heroes: [] }),
    load("matches.json", { matches: [] }),
    load("meta.json", null),
    load("status.json", null),
  ]);
  const heroes = heroesF.heroes || [];
  const matches = matchesF.matches || [];
  const ctx = E.context(matches, heroes, meta);
  const T = Object.assign({ maxDeaths: 4, minWards: 4, minObjectiveDamage: 1 }, squad.targets || {});
  const heroName = slug => (heroes.find(h => h.slug === slug) || {}).name || slug || "?";
  const label = key => (squad.players.find(p => p.key === key) || {}).label || key;
  const roleName = r => E.ROLE_LABEL[r] || r;

  // ---------- status ----------
  const st = $("#status");
  const bits = [];
  if (matchesF.updatedAt) {
    const mins = Math.round((Date.now() - new Date(matchesF.updatedAt)) / 60000);
    bits.push(mins < 60 ? `Updated ${Math.max(1, mins)} min ago` : `Updated ${new Date(matchesF.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
  }
  bits.push(`${matches.length} matches`);
  if (heroesF.patch) bits.push(`Patch ${heroesF.patch}`);
  st.textContent = bits.join(" · ");
  if (!matches.length || (status && status.errors && status.errors.length)) {
    st.classList.add("warn");
    st.textContent += " · " + ((status && status.errors && status.errors[0]) || "No match history yet — skill orders still work");
  }

  // ---------- state ----------
  const saved = (() => { try { return JSON.parse(localStorage.getItem("squad-sel") || "null"); } catch { return null; } })();
  const state = {
    selected: new Set(saved && saved.length ? saved.filter(k => squad.players.some(p => p.key === k)) : squad.players.map(p => p.key)),
    exact: true, scope: "group", plan: {},
  };
  if (!state.selected.size) squad.players.forEach(p => state.selected.add(p.key));
  const persist = () => { try { localStorage.setItem("squad-sel", JSON.stringify([...state.selected])); } catch {} };
  const sel = () => [...state.selected].sort();

  // ---------- picker ----------
  const picker = $("#picker");
  for (const p of squad.players) {
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = p.label; b.type = "button";
    b.setAttribute("aria-pressed", state.selected.has(p.key));
    b.onclick = () => {
      if (state.selected.has(p.key) && state.selected.size === 1) { b.animate([{ transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "none" }], { duration: 220 }); return; }
      state.selected.has(p.key) ? state.selected.delete(p.key) : state.selected.add(p.key);
      b.setAttribute("aria-pressed", state.selected.has(p.key));
      state.plan = {}; persist(); render();
    };
    picker.appendChild(b);
  }
  $("#exact").onchange = e => { state.exact = e.target.checked; render(); };
  const seg = document.querySelector(".seg");
  seg.querySelectorAll("button").forEach((b, i) => b.onclick = () => {
    seg.querySelectorAll("button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
    seg.dataset.pos = i; state.scope = b.dataset.scope; renderStats();
  });

  // ---------- 1: record ----------
  function groupRows() {
    const s = sel();
    if (state.exact) return E.comboReport(matches, s).rows;
    const tm = E.togetherMatches(matches, s, false).map(x => x.match);
    return E.squadRows(tm).filter(r => s.includes(r.member) && s.every(m => r.together.includes(m)));
  }

  function renderRecord() {
    const s = sel();
    const c = E.comboReport(matches, s);
    const rows = groupRows();
    const perMatch = new Map(); rows.forEach(r => perMatch.set(r.matchId, r));
    const rec = E.record([...perMatch.values()]);
    const who = s.map(label).join(" + ");
    let html = `<div class="tile hero-stat">
      <div><div class="who">${esc(who)}${state.exact ? "" : " · plus anyone"}</div>
        <div class="big">${rec.games ? wl(rec) : "0–0"}<small>${rec.games ? pct(rec.wr) + " win rate" : "no games together yet"}</small></div></div>
      <div style="min-width:160px;flex:1;max-width:320px"><div class="bar-meter"><i style="width:${rec.games ? Math.round(rec.wr * 100) : 0}%"></i></div>
        <div class="muted" style="font-size:12px;margin-top:6px">${rec.games} game${rec.games === 1 ? "" : "s"}${c.lineups.length ? ` · ${c.lineups.length} lineup${c.lineups.length === 1 ? "" : "s"}` : ""}</div></div>
    </div>`;
    if (c.lineups.length) {
      html += `<div class="scroll"><table><thead><tr>${s.map(m => `<th>${esc(label(m))}</th>`).join("")}<th class="num">W–L</th><th class="num">Win</th></tr></thead><tbody>`;
      c.lineups.forEach((L, idx) => {
        if (idx === 6) html += `</tbody><tbody class="more" hidden>`;
        html += `<tr>${s.map(m => {
          const hs = Object.entries(L.heroes[m] || {}).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${heroName(h)}${n > 1 ? " ×" + n : ""}`).join(", ");
          return `<td><b>${esc(roleName(L.roles[m]))}</b><br><span class="muted">${esc(hs)}</span></td>`;
        }).join("")}<td class="num">${L.wins}–${L.games - L.wins}</td><td class="num ${L.wr >= .5 ? "good" : "bad"}">${pct(L.wr)}</td></tr>`;
      });
      html += `</tbody></table></div>`;
      if (c.lineups.length > 6) html += `<button class="chip ghost" type="button" id="morelineups" style="margin-top:10px">Show all ${c.lineups.length} lineups</button>`;
    }
    $("#record").innerHTML = html;
    const more = $("#morelineups");
    if (more) more.onclick = () => { document.querySelectorAll("#record tbody.more").forEach(t => t.hidden = false); more.remove(); };
  }

  // ---------- 2: stats ----------
  function renderStats() {
    const s = sel();
    const base = state.scope === "group" ? groupRows() : ctx.rows;
    const cls = x => x >= .5 ? "good" : "bad";
    $("#stats").innerHTML = s.map(m => {
      const rows = base.filter(r => r.member === m);
      const x = E.summarize(rows, T);
      if (!x.games) return `<div class="tile"><h3>${esc(label(m))}</h3><p class="muted" style="margin:0">No games in this view.</p></div>`;
      const roles = [...new Set(rows.map(r => r.role))].map(role => [role, E.record(rows.filter(r => r.role === role))]).sort((a, b) => b[1].games - a[1].games);
      const hs = [...new Set(rows.map(r => r.hero))].map(h => [h, E.record(rows.filter(r => r.hero === h))]).sort((a, b) => b[1].games - a[1].games).slice(0, 5);
      return `<div class="tile"><h3>${esc(label(m))}</h3>
        <div class="big">${x.wins}–${x.losses}<small>${pct(x.wr)}</small></div>
        <div class="kv">
          <span>K / D / A</span><span>${num(x.k)} / ${num(x.d)} / ${num(x.a)}</span>
          <span>≤ ${T.maxDeaths} deaths</span><span class="${cls(x.hitDeaths)}">${pct(x.hitDeaths)}</span>
          <span>≥ ${T.minWards} wards</span><span class="${cls(x.hitWards)}">${pct(x.hitWards)} · avg ${num(x.wards)}</span>
          <span>Objective dmg</span><span class="${cls(x.hitObj)}">${pct(x.hitObj)} · avg ${num(x.obj, 0)}</span>
          <span>All 3 targets</span><span>${pct(x.hitAll)}</span>
          <span>Tower dmg</span><span>${num(x.towers, 0)}</span>
          <span>Unspent gold</span><span class="${x.unspent > 1500 ? "bad" : ""}">${num(x.unspent, 0)}</span>
          <span>CS / min</span><span>${num(x.csPerMin)}</span>
        </div>
        <div class="tags">${roles.map(([r, rec]) => `<span class="pill"><b>${esc(roleName(r))}</b> ${wl(rec)}</span>`).join("")}</div>
        <div>${hs.map(([h, rec]) => `<span class="pill">${esc(heroName(h))} ${wl(rec)}</span>`).join("")}</div>
      </div>`;
    }).join("");
  }

  // ---------- 3: suggestions ----------
  function heroPill(h) {
    const ev = [];
    if (h.inSquad.games) ev.push(`${wl(h.inSquad)} with group`);
    if (h.personal.games) ev.push(`${wl(h.personal)} overall`);
    if (h.meta && h.meta.wr != null) ev.push(`meta ${h.meta.wr.toFixed(1)}%`);
    return `<span class="pill" title="${esc(ev.join(" · "))}"><b>${esc(heroName(h.hero))}</b> ${pct(h.score)}${ev.length ? ` <span class="muted">· ${esc(ev[0])}</span>` : ""}</span>`;
  }

  function renderSuggest() {
    const s = sel();
    const L = E.suggestLineups(ctx, s, 3);
    $("#suggest").innerHTML = L.map((l, i) => `<div class="lineup ${i === 0 ? "top1" : ""}">
      <div class="lineup-head">
        <span>${i === 0 ? '<span class="badge">Best bet</span>' : `<b>Option ${i + 1}</b>`}</span>
        <span class="chance"><strong>${pct(l.score)}</strong> est. · ${l.lineupRecord ? `${l.lineupRecord.wins}–${l.lineupRecord.games - l.lineupRecord.wins} as this lineup` : "new lineup"}</span>
      </div>
      <div class="assign">${s.map(m => {
        const p = l.parts.find(x => x.member === m);
        const ev = p.inSquad.games ? `${wl(p.inSquad)} here with group` : p.overall.games ? `${wl(p.overall)} here overall` : "no games in this lane";
        return `<div><div class="name">${esc(label(m))}</div><div class="role">${esc(roleName(l.roles[m]))} · ${ev}</div></div><div>${l.heroes[m].map(heroPill).join("")}</div>`;
      }).join("")}</div>
      <button class="chip cta" type="button" data-apply="${i}">Use in game plan →</button>
    </div>`).join("");
    $("#suggest").querySelectorAll("[data-apply]").forEach(b => b.onclick = () => {
      const l = L[+b.dataset.apply];
      state.plan = Object.fromEntries(s.map(m => [m, { role: l.roles[m], hero: (l.heroes[m][0] || {}).hero || "", opp: "" }]));
      renderPlan(); document.getElementById("plan-h").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    if (!Object.keys(state.plan).length && L[0]) {
      state.plan = Object.fromEntries(s.map(m => [m, { role: L[0].roles[m], hero: (L[0].heroes[m][0] || {}).hero || "", opp: "" }]));
    }
  }

  // ---------- 4: plan ----------
  function heroOptions(role, current) {
    const list = heroes.filter(h => !role || (h.roles || []).includes(role) || h.slug === current);
    return list.map(h => `<option value="${esc(h.slug)}" ${h.slug === current ? "selected" : ""}>${esc(h.name)}</option>`).join("");
  }

  function renderBrief(m, p) {
    if (!p.hero) return `<p class="muted" style="margin:0">Pick a hero to see the plan.</p>`;
    const b = E.heroBrief(ctx, m, p.role, p.hero, sel(), p.opp || null);
    const sc = b.score;
    const ev = [];
    if (sc.inSquad.games) ev.push(`${wl(sc.inSquad)} with this group`);
    if (sc.personal.games) ev.push(`${wl(sc.personal)} for ${esc(label(m))} overall`);
    else ev.push(`${esc(label(m))} hasn't played this here yet`);
    if (b.meta && b.meta.wr != null) ev.push(`meta ${b.meta.wr.toFixed(1)}% over ${num(b.meta.games, 0)} games`);
    const lines = [`<div class="headline"><b>${esc(heroName(p.hero))}</b> · ${esc(roleName(p.role))} — <b>${pct(sc.score)}</b> est. win chance</div>`, ev.join(" · ")];
    if (p.opp) {
      if (sc.matchup) lines.push(`Vs <b>${esc(heroName(p.opp))}</b>: meta ${(sc.matchup.wr * 100).toFixed(1)}% over ${num(sc.matchup.games, 0)} games.`);
      else if (meta && meta.matchupsAvailable === false) lines.push(`pred.gg doesn't share lane-matchup stats with outside apps, so this uses your own games vs ${esc(heroName(p.opp))}.`);
      if (sc.vsOpp && sc.vsOpp.games) lines.push(`${esc(label(m))} on this hero vs ${esc(heroName(p.opp))}: <b>${wl(sc.vsOpp)}</b>.`);
      if (b.laneVs && b.laneVs.games) lines.push(`Squad in ${esc(roleName(p.role))} vs ${esc(heroName(p.opp))}, any hero: <b>${wl(b.laneVs)}</b>.`);
      else lines.push(`<span class="muted">No squad games in ${esc(roleName(p.role))} against ${esc(heroName(p.opp))} yet.</span>`);
      if (b.swap) lines.push(`<span class="warn">Consider <b>${esc(heroName(b.swap.hero))}</b> instead (${pct(b.swap.score)}).</span>`);
    }
    const legend = [...new Map(b.skillOrder.map(s => [s.key, s]))].map(([, s]) => `<span><b>${esc(s.button)}</b> ${esc(s.name)}</span>`).join("");
    const skills = b.skillOrder.length ? `<div class="sub-h">Level-up order</div><div class="skills">${b.skillOrder.map(s =>
      `<div class="skill k-${s.key} ${s.key === "ULTIMATE" ? "ult" : ""}"><b>${s.level}</b>${esc(s.button)}</div>`).join("")}</div>
      <div class="legend">${legend}</div>` : "";
    const builds = b.meta && b.meta.builds && b.meta.builds.length ? `<div class="sub-h">Core builds this patch</div><table><tbody>${b.meta.builds.map(x =>
      `<tr><td>${x.items.map(esc).join(" → ")}</td><td class="num">${x.wr != null ? x.wr.toFixed(1) + "%" : "—"}</td><td class="num muted">${num(x.games, 0)}</td></tr>`).join("")}</tbody></table>` : "";
    const mus = (b.best.length || b.worst.length) ? `<div class="grid" style="margin-top:6px">
      <div><div class="sub-h">Best lane matchups</div>${b.best.map(x => `<span class="pill good">${esc(heroName(x.hero))} ${x.wr.toFixed(0)}%</span>`).join("")}</div>
      <div><div class="sub-h">Worst lane matchups</div>${b.worst.map(x => `<span class="pill bad">${esc(heroName(x.hero))} ${x.wr.toFixed(0)}%</span>`).join("")}</div></div>` : "";
    const abil = (b.abilities || []).filter(a => a.key !== "BASIC").map(a => `<tr><td><b>${esc(E.PS5[a.key])}</b></td><td><b>${esc(a.name)}</b><br><span class="muted">${esc(a.desc)}</span></td></tr>`).join("");
    return `<div class="verdict">${lines.join("<br>")}</div>${skills}${builds}${mus}
      ${abil ? `<details><summary>Abilities</summary><table><tbody>${abil}</tbody></table></details>` : ""}`;
  }

  function renderPlan() {
    const s = sel();
    $("#plan").innerHTML = s.map(m => {
      const p = state.plan[m] || (state.plan[m] = { role: E.ROLES[0], hero: "", opp: "" });
      return `<div class="planrow" data-m="${esc(m)}"><h3>${esc(label(m))}</h3>
        <div class="controls">
          <label class="f">Lane<select data-k="role">${E.ROLES.map(r => `<option value="${r}" ${r === p.role ? "selected" : ""}>${roleName(r)}</option>`).join("")}</select></label>
          <label class="f">Hero<select data-k="hero"><option value="">Choose…</option>${heroOptions(p.role, p.hero)}</select></label>
          <label class="f">Enemy laner<select data-k="opp"><option value="">Unknown</option>${heroOptions(null, p.opp)}</select></label>
        </div>
        <div class="brief">${renderBrief(m, p)}</div></div>`;
    }).join("");
    $("#plan").querySelectorAll("select").forEach(el => el.onchange = () => {
      const m = el.closest("[data-m]").dataset.m; state.plan[m][el.dataset.k] = el.value; renderPlan();
    });
  }

  function render() { renderRecord(); renderStats(); renderSuggest(); renderPlan(); }
  render();
})();
