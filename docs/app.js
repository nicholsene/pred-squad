/* Squad Planner UI. Loads data/*.json and renders with SquadEngine. */
(async function () {
  "use strict";
  const E = window.SquadEngine;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = x => (x == null || isNaN(x)) ? "—" : `${Math.round(x * 100)}%`;
  const num = (x, d = 1) => (x == null || isNaN(x)) ? "—" : Number(x).toLocaleString(undefined, { maximumFractionDigits: d });

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
  const heroName = slug => (heroes.find(h => h.slug === slug) || {}).name || slug || "?";
  const label = key => (squad.players.find(p => p.key === key) || {}).label || key;

  // ---------- status ----------
  const st = $("#status");
  const bits = [];
  if (matchesF.updatedAt) bits.push(`Matches updated ${new Date(matchesF.updatedAt).toLocaleString()}`);
  bits.push(`${matches.length} squad matches`);
  if (heroesF.patch) bits.push(`patch ${heroesF.patch}`);
  if (meta && meta.patch) bits.push("meta loaded"); else bits.push("meta not loaded");
  st.textContent = bits.join(" · ");
  if (!matches.length || (status && status.errors && status.errors.length)) {
    st.classList.add("warn");
    st.textContent += " — " + ((status && status.errors && status.errors[0]) || "No match history yet. Hero skill orders still work.");
  }

  // ---------- state ----------
  const saved = (() => { try { return JSON.parse(localStorage.getItem("squad-sel") || "null"); } catch { return null; } })();
  const state = {
    selected: new Set(saved && saved.length ? saved : squad.players.map(p => p.key)),
    exact: true, scope: "group", plan: {},
  };
  const persist = () => { try { localStorage.setItem("squad-sel", JSON.stringify([...state.selected])); } catch {} };

  // ---------- picker ----------
  const picker = $("#picker");
  for (const p of squad.players) {
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = p.label; b.type = "button";
    b.setAttribute("aria-pressed", state.selected.has(p.key));
    b.onclick = () => {
      if (state.selected.has(p.key) && state.selected.size === 1) return;
      state.selected.has(p.key) ? state.selected.delete(p.key) : state.selected.add(p.key);
      b.setAttribute("aria-pressed", state.selected.has(p.key));
      state.plan = {}; persist(); render();
    };
    picker.appendChild(b);
  }
  $("#exact").onchange = e => { state.exact = e.target.checked; render(); };
  document.querySelectorAll(".seg button").forEach(b => b.onclick = () => {
    document.querySelectorAll(".seg button").forEach(x => x.classList.toggle("on", x === b));
    state.scope = b.dataset.scope; renderStats();
  });

  const sel = () => [...state.selected].sort();

  // ---------- 2: record ----------
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
    let html = `<div class="grid"><div class="tile"><div class="muted">${esc(who)}${state.exact ? "" : " (and anyone else)"}</div>
      <div class="big">${rec.wins}–${rec.losses}</div><div>${rec.games ? pct(rec.wr) + " win rate" : "No games together yet"}</div></div></div>`;
    if (c.lineups.length) {
      html += `<h3 style="margin-top:14px">Lineups you've played${state.exact ? "" : " (exact group only)"}</h3><div class="scroll"><table><thead><tr>
        ${s.map(m => `<th>${esc(label(m))}</th>`).join("")}<th class="num">W–L</th><th class="num">Win%</th></tr></thead><tbody>`;
      c.lineups.forEach((L, idx) => {
        if (idx === 8) html += `</tbody><tbody class="more" hidden>`;
        html += `<tr>${s.map(m => {
          const hs = Object.entries(L.heroes[m] || {}).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${heroName(h)}${n > 1 ? " ×" + n : ""}`).join(", ");
          return `<td><b>${esc(E.ROLE_LABEL[L.roles[m]] || L.roles[m])}</b><br><span class="muted">${esc(hs)}</span></td>`;
        }).join("")}<td class="num">${L.wins}–${L.games - L.wins}</td><td class="num ${L.wr >= .5 ? "good" : "bad"}">${pct(L.wr)}</td></tr>`;
      });
      html += `</tbody></table></div>`;
      if (c.lineups.length > 8) html += `<button class="chip" type="button" id="morelineups" style="margin-top:8px">Show all ${c.lineups.length} lineups</button>`;
    }
    $("#record").innerHTML = html;
    const more = $("#morelineups");
    if (more) more.onclick = () => { document.querySelectorAll("#record tbody.more").forEach(t => t.hidden = false); more.remove(); };
  }

  // ---------- 3: stats ----------
  function renderStats() {
    const s = sel();
    const base = state.scope === "group" ? groupRows() : ctx.rows;
    $("#stats").innerHTML = s.map(m => {
      const rows = base.filter(r => r.member === m);
      const x = E.summarize(rows, squad.targets);
      if (!x.games) return `<div class="tile"><h3>${esc(label(m))}</h3><p class="muted">No games in this view.</p></div>`;
      const roles = [...new Map(rows.map(r => [r.role, 0]))].map(([role]) => { const rr = rows.filter(r => r.role === role); return [role, E.record(rr)]; })
        .sort((a, b) => b[1].games - a[1].games);
      const heroesPlayed = [...new Set(rows.map(r => r.hero))].map(h => [h, E.record(rows.filter(r => r.hero === h))]).sort((a, b) => b[1].games - a[1].games).slice(0, 5);
      return `<div class="tile"><h3>${esc(label(m))}</h3>
        <div class="big">${x.wins}–${x.losses} <span class="muted" style="font-size:15px">${pct(x.wr)}</span></div>
        <div class="kv">
          <span>K / D / A</span><span>${num(x.k)} / ${num(x.d)} / ${num(x.a)}</span>
          <span>Deaths ≤ ${squad.targets.maxDeaths ?? 4}</span><span class="${x.hitDeaths >= .5 ? "good" : "bad"}">${pct(x.hitDeaths)} of games</span>
          <span>Wards ≥ ${squad.targets.minWards ?? 4}</span><span class="${x.hitWards >= .5 ? "good" : "bad"}">${pct(x.hitWards)} (avg ${num(x.wards)})</span>
          <span>Objective dmg &gt; 0</span><span class="${x.hitObj >= .5 ? "good" : "bad"}">${pct(x.hitObj)} (avg ${num(x.obj, 0)})</span>
          <span>All 3 targets</span><span>${pct(x.hitAll)}</span>
          <span>Tower dmg / game</span><span>${num(x.towers, 0)}</span>
          <span>Unspent gold / game</span><span class="${x.unspent > 1500 ? "bad" : ""}">${num(x.unspent, 0)}</span>
          <span>CS / min</span><span>${num(x.csPerMin)}</span>
        </div>
        <div style="margin-top:8px">${roles.map(([r, rec]) => `<span class="pill">${esc(E.ROLE_LABEL[r] || r)} ${rec.wins}–${rec.losses}</span>`).join("")}</div>
        <div>${heroesPlayed.map(([h, rec]) => `<span class="pill">${esc(heroName(h))} ${rec.wins}–${rec.losses}</span>`).join("")}</div>
      </div>`;
    }).join("");
  }

  // ---------- 4: suggestions ----------
  function heroLine(h) {
    const ev = [];
    if (h.inSquad.games) ev.push(`${h.inSquad.wins}–${h.inSquad.losses} with this group`);
    if (h.personal.games) ev.push(`${h.personal.wins}–${h.personal.losses} overall`);
    if (h.meta && h.meta.wr != null) ev.push(`meta ${h.meta.wr.toFixed(1)}%`);
    return `<span class="pill" title="${esc(ev.join(" · "))}"><b>${esc(heroName(h.hero))}</b> ~${pct(h.score)}${ev.length ? " · " + esc(ev[0]) : ""}</span>`;
  }

  function renderSuggest() {
    const s = sel();
    const L = E.suggestLineups(ctx, s, 3);
    $("#suggest").innerHTML = L.map((l, i) => `<div class="lineup ${i === 0 ? "top1" : ""}">
      <div class="lineup-head"><b>${i === 0 ? "Best bet" : "Option " + (i + 1)}</b>
        <span>~${pct(l.score)} est. win chance · ${l.lineupRecord ? `${l.lineupRecord.wins}–${l.lineupRecord.games - l.lineupRecord.wins} as this exact lineup` : "lineup not played together yet"}</span></div>
      ${s.map(m => {
        const p = l.parts.find(x => x.member === m);
        const ev = p.inSquad.games ? `${p.inSquad.wins}–${p.inSquad.losses} in this role with group` : p.overall.games ? `${p.overall.wins}–${p.overall.losses} in this role overall` : "no games in this role";
        return `<div style="margin-bottom:6px"><b>${esc(label(m))}</b> → ${esc(E.ROLE_LABEL[l.roles[m]])} <span class="muted">(${ev})</span><br>${l.heroes[m].map(heroLine).join("")}</div>`;
      }).join("")}
      <button class="chip" type="button" data-apply="${i}">Use this in game plan</button>
    </div>`).join("");
    $("#suggest").querySelectorAll("[data-apply]").forEach(b => b.onclick = () => {
      const l = L[+b.dataset.apply];
      state.plan = Object.fromEntries(s.map(m => [m, { role: l.roles[m], hero: (l.heroes[m][0] || {}).hero || "", opp: "" }]));
      renderPlan(); document.getElementById("plan-h").scrollIntoView({ behavior: "smooth" });
    });
    if (!Object.keys(state.plan).length && L[0]) {
      state.plan = Object.fromEntries(s.map(m => [m, { role: L[0].roles[m], hero: (L[0].heroes[m][0] || {}).hero || "", opp: "" }]));
    }
  }

  // ---------- 5: plan ----------
  function heroOptions(role, current) {
    const list = heroes.filter(h => !role || (h.roles || []).includes(role) || h.slug === current);
    return list.map(h => `<option value="${esc(h.slug)}" ${h.slug === current ? "selected" : ""}>${esc(h.name)}</option>`).join("");
  }

  function renderBrief(m, p) {
    if (!p.hero) return `<p class="muted">Pick a hero.</p>`;
    const b = E.heroBrief(ctx, m, p.role, p.hero, sel(), p.opp || null);
    const sc = b.score;
    const lines = [];
    lines.push(`Estimated win chance on <b>${esc(heroName(p.hero))}</b> (${esc(E.ROLE_LABEL[p.role])}): <b>~${pct(sc.score)}</b>.`);
    const ev = [];
    if (sc.inSquad.games) ev.push(`${sc.inSquad.wins}–${sc.inSquad.losses} with this group`);
    if (sc.personal.games) ev.push(`${sc.personal.wins}–${sc.personal.losses} for ${esc(label(m))} overall`);
    else ev.push(`${esc(label(m))} hasn't played this hero here yet`);
    if (b.meta && b.meta.wr != null) ev.push(`patch meta ${b.meta.wr.toFixed(1)}% over ${num(b.meta.games, 0)} games`);
    lines.push(ev.join(" · ") + ".");
    if (p.opp) {
      if (sc.matchup) lines.push(`Vs <b>${esc(heroName(p.opp))}</b>: meta ${(sc.matchup.wr * 100).toFixed(1)}% over ${num(sc.matchup.games, 0)} games.`);
      else lines.push(`No meta matchup data vs ${esc(heroName(p.opp))}.`);
      if (sc.vsOpp && sc.vsOpp.games) lines.push(`Your record vs ${esc(heroName(p.opp))} on this hero: ${sc.vsOpp.wins}–${sc.vsOpp.losses}.`);
      if (b.swap) lines.push(`<span class="warn">Consider <b>${esc(heroName(b.swap.hero))}</b> instead (~${pct(b.swap.score)}).</span>`);
    }
    const skills = b.skillOrder.length ? `<h3 style="margin-top:12px">Level-up order</h3><div class="skills">${b.skillOrder.map(s =>
      `<div class="skill ${s.key === "ULTIMATE" ? "ult" : ""}"><b>Lv ${s.level}</b>${esc(s.button)}</div>`).join("")}</div>
      <p class="note" style="margin-top:6px">${[...new Map(b.skillOrder.map(s => [s.key, s]))].map(([k, s]) => `${esc(s.button)} = ${esc(s.name)}`).join(" · ")}. Order is the game's recommended order from pred.gg; buttons assume default PS5 layout.</p>` : "";
    const abil = (b.abilities || []).filter(a => a.key !== "BASIC").map(a => `<tr><td><b>${esc(E.PS5[a.key])}</b></td><td><b>${esc(a.name)}</b><br><span class="muted">${esc(a.desc)}</span></td></tr>`).join("");
    const builds = b.meta && b.meta.builds && b.meta.builds.length ? `<h3 style="margin-top:12px">Core builds this patch</h3><table><tbody>${b.meta.builds.map(x =>
      `<tr><td>${x.items.map(esc).join(" → ")}</td><td class="num">${x.wr != null ? x.wr.toFixed(1) + "%" : "—"}</td><td class="num muted">${num(x.games, 0)} g</td></tr>`).join("")}</tbody></table>` : "";
    const mus = (b.best.length || b.worst.length) ? `<div class="grid" style="margin-top:12px">
      <div><h3>Best lane matchups</h3>${b.best.map(x => `<span class="pill good">${esc(heroName(x.hero))} ${x.wr.toFixed(0)}%</span>`).join("") || '<span class="muted">—</span>'}</div>
      <div><h3>Worst lane matchups</h3>${b.worst.map(x => `<span class="pill bad">${esc(heroName(x.hero))} ${x.wr.toFixed(0)}%</span>`).join("") || '<span class="muted">—</span>'}</div></div>` : "";
    return `<div class="verdict">${lines.join("<br>")}</div>${skills}${builds}${mus}
      ${abil ? `<details style="margin-top:12px"><summary>Abilities</summary><table><tbody>${abil}</tbody></table></details>` : ""}`;
  }

  function renderPlan() {
    const s = sel();
    $("#plan").innerHTML = s.map(m => {
      const p = state.plan[m] || (state.plan[m] = { role: E.ROLES[0], hero: "", opp: "" });
      return `<div class="planrow" data-m="${esc(m)}"><h3>${esc(label(m))}</h3>
        <div class="controls">
          <label class="f">Lane<select data-k="role">${E.ROLES.map(r => `<option value="${r}" ${r === p.role ? "selected" : ""}>${E.ROLE_LABEL[r]}</option>`).join("")}</select></label>
          <label class="f">Hero<select data-k="hero"><option value="">—</option>${heroOptions(p.role, p.hero)}</select></label>
          <label class="f">Enemy laner (optional)<select data-k="opp"><option value="">—</option>${heroOptions(null, p.opp)}</select></label>
        </div>
        <div class="brief">${renderBrief(m, p)}</div></div>`;
    }).join("");
    $("#plan").querySelectorAll("select").forEach(el => el.onchange = () => {
      const m = el.closest("[data-m]").dataset.m; state.plan[m][el.dataset.k] = el.value; renderPlan();
    });
  }

  function render() { renderRecord(); renderStats(); state.plan = state.plan || {}; renderSuggest(); renderPlan(); }
  render();
})();
