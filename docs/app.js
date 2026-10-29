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
  const allMatches = matchesF.matches || [];
  // Ranked-only filter (per device). Everything downstream reads `matches` / `ctx`.
  let rankedOnly = (() => { try { return localStorage.getItem("squad-ranked") === "1"; } catch { return false; } })();
  let matches, ctx;
  const applyMode = () => { matches = rankedOnly ? allMatches.filter(m => m.mode === "RANKED") : allMatches; ctx = E.context(matches, heroes, meta); };
  applyMode();
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
  const showStatus = () => {
    st.textContent = bits.concat(`${matches.length} ${rankedOnly ? "ranked " : ""}matches`, heroesF.patch ? [`Patch ${heroesF.patch}`] : []).join(" · ");
  };
  showStatus();
  const modeSw = $("#mode-switch");
  const paintMode = () => modeSw.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", (b.dataset.mode === "ranked") === rankedOnly));
  paintMode();
  modeSw.onclick = ev => {
    const b = ev.target.closest("button"); if (!b || (b.dataset.mode === "ranked") === rankedOnly) return;
    rankedOnly = b.dataset.mode === "ranked"; try { localStorage.setItem("squad-ranked", rankedOnly ? "1" : "0"); } catch {}
    applyMode(); paintMode(); showStatus(); window.__app.ctx = ctx; render(); if (window.__matchRender) window.__matchRender();
  };
  if (!allMatches.length || (status && status.errors && status.errors.length)) {
    st.classList.add("warn");
    st.textContent += " · " + ((status && status.errors && status.errors[0]) || "No match history yet — skill orders still work");
  }

  // ---------- state ----------
  const saved = (() => { try { return JSON.parse(localStorage.getItem("squad-sel") || "null"); } catch { return null; } })();
  const state = {
    selected: new Set(saved && saved.length ? saved.filter(k => squad.players.some(p => p.key === k)) : squad.players.map(p => p.key)),
    scope: "group",
    controls: (() => { try { return localStorage.getItem("squad-controls") === "pc" ? "pc" : "ps5"; } catch { return "ps5"; } })(),
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
      persist(); render();
    };
    picker.appendChild(b);
  }
  // PS5 / PC button labels for level-up orders (per device)
  const PC_KEYS = { BASIC: "LMB", PRIMARY: "Q", SECONDARY: "E", ALTERNATE: "RMB", ULTIMATE: "R", PASSIVE: "—" };
  const keyLabel = k => (state.controls === "pc" ? PC_KEYS : E.PS5)[k] || k;
  const ctlSwitch = () => `<span class="ctl" role="group" aria-label="Controls">${["ps5", "pc"].map(c =>
    `<button type="button" data-ctl="${c}" aria-pressed="${state.controls === c}">${c === "pc" ? "PC" : "PS5"}</button>`).join("")}</span>`;
  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-ctl]"); if (!b || b.dataset.ctl === state.controls) return;
    state.controls = b.dataset.ctl; try { localStorage.setItem("squad-controls", state.controls); } catch {}
    const y = scrollY; render(); if (window.__matchRender) window.__matchRender(); scrollTo(0, y);
  });
  const seg = document.querySelector(".seg");
  seg.querySelectorAll("button").forEach((b, i) => b.onclick = () => {
    seg.querySelectorAll("button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
    seg.dataset.pos = i; state.scope = b.dataset.scope; renderStats();
  });

  // ---------- 1: record ----------
  function groupRows() {
    const s = sel();
    const tm = E.togetherMatches(matches, s, false).map(x => x.match);
    return E.squadRows(tm).filter(r => s.includes(r.member) && s.every(m => r.together.includes(m)));
  }

  // one player selected: Record becomes that player's full profile
  function renderSolo(m) {
    const rows = ctx.rows.filter(r => r.member === m).sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const all = E.record(rows);
    $("#rec-h").innerHTML = `<span class="step">1</span>${esc(label(m))}'s record`;
    if (!all.games) { $("#record").innerHTML = `<p class="muted">No games for ${esc(label(m))} yet.</p>`; return; }
    const others = squad.players.map(p => p.key).filter(k => k !== m);
    const groups = [["Solo (no squad)", r => r.together.length === 1]]
      .concat(others.map(o => [`With ${label(o)} only`, r => r.together.length === 2 && r.together.includes(o)]))
      .concat(others.length > 1 ? [["With the full squad", r => r.together.length === others.length + 1]] : []);
    const recent = rows.slice(0, 10);
    const tbl = (head, list) => `<div class="scroll"><table class="fit"><thead><tr><th>${head}</th><th class="num">W–L</th><th class="num">Win</th></tr></thead><tbody>${list.map(([name, rec, sub]) =>
      `<tr><td><b>${esc(name)}</b>${sub ? `<br><span class="muted">${esc(sub)}</span>` : ""}</td><td class="num">${wl(rec)}</td><td class="num ${rec.wr >= .5 ? "good" : "bad"}">${pct(rec.wr)}</td></tr>`).join("")}</tbody></table></div>`;
    const byRole = [...new Set(rows.map(r => r.role))].map(role => {
      const rr = rows.filter(r => r.role === role);
      const top = [...new Set(rr.map(r => r.hero))].map(h => [h, rr.filter(r => r.hero === h).length]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, n]) => heroName(h) + (n > 1 ? " ×" + n : "")).join(", ");
      return [roleName(role), E.record(rr), top];
    }).sort((a, b) => b[1].games - a[1].games);
    const byHero = [...new Set(rows.map(r => r.hero))].map(h => [heroName(h), E.record(rows.filter(r => r.hero === h))]).sort((a, b) => b[1].games - a[1].games || b[1].wr - a[1].wr);
    let html = `<div class="tile hero-stat">
      <div><div class="who">${esc(label(m))} · all games</div>
        <div class="big">${wl(all)}<small>${pct(all.wr)} win rate</small></div></div>
      <div style="min-width:160px;flex:1;max-width:320px"><div class="bar-meter"><i style="width:${Math.round(all.wr * 100)}%"></i></div>
        <div class="muted" style="font-size:12px;margin-top:6px">${all.games} game${all.games === 1 ? "" : "s"} · last ${recent.length}: ${recent.map(r => `<b class="${r.win ? "good" : "bad"}">${r.win ? "W" : "L"}</b>`).join(" ")}</div></div>
    </div>`;
    html += `<div class="grid">${statTile(m, rows)}</div>`;
    html += `<h3 class="sub">Who you played with</h3>` + tbl("Group", groups.map(([n, f]) => [n, E.record(rows.filter(f))]).filter(x => x[1].games));
    html += `<h3 class="sub">By lane</h3>` + tbl("Lane", byRole);
    html += `<h3 class="sub">By hero</h3>` + tbl("Hero", byHero);
    $("#record").innerHTML = html;
  }

  function renderRecord() {
    const s = sel();
    if (s.length === 1) return renderSolo(s[0]);
    $("#rec-h").innerHTML = `<span class="step">1</span>Record together`;
    const c = E.comboReport(matches, s, false);
    const rows = groupRows();
    const perMatch = new Map(); rows.forEach(r => perMatch.set(r.matchId, r));
    const rec = E.record([...perMatch.values()]);
    const who = s.map(label).join(" + ");
    let html = `<div class="tile hero-stat">
      <div><div class="who">${esc(who)} · with or without others</div>
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
    $("#stats").innerHTML = s.map(m => statTile(m, base.filter(r => r.member === m))).join("");
  }

  function statTile(m, rows) {
    const cls = x => x >= .5 ? "good" : "bad";
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
      if (window.__applyLineup) window.__applyLineup(l.roles, Object.fromEntries(s.map(m => [m, (l.heroes[m][0] || {}).hero || ""])));
      if (matchMedia("(max-width: 760px)").matches) window.__showTab("match");
      else document.getElementById("match-h").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // ---------- 4: plan ----------
  function heroOptions(role, current) {
    const list = heroes.filter(h => !role || (h.roles || []).includes(role) || h.slug === current);
    return list.map(h => `<option value="${esc(h.slug)}" ${h.slug === current ? "selected" : ""}>${esc(h.name)}</option>`).join("");
  }

  function renderBrief(m, role, hero, opp, selected) {
    const p = { role, hero, opp };
    if (!p.hero) return "";
    const b = E.heroBrief(ctx, m, p.role, p.hero, selected && selected.length ? selected : [m], p.opp || null);
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
    const legend = [...new Map(b.skillOrder.map(s => [s.key, s]))].map(([, s]) => `<span><b>${esc(keyLabel(s.key))}</b> ${esc(s.name)}</span>`).join("");
    const skills = b.skillOrder.length ? `<div class="sub-h sub-row">Level-up order ${ctlSwitch()}</div><div class="skills">${b.skillOrder.map(s =>
      `<div class="skill k-${s.key} ${s.key === "ULTIMATE" ? "ult" : ""}"><b>${s.level}</b>${esc(keyLabel(s.key))}</div>`).join("")}</div>
      <div class="legend">${legend}</div>` : "";
    const builds = b.meta && b.meta.builds && b.meta.builds.length ? `<div class="sub-h">Core builds this patch</div><table><tbody>${b.meta.builds.map(x =>
      `<tr><td>${x.items.map(esc).join(" → ")}</td><td class="num">${x.wr != null ? x.wr.toFixed(1) + "%" : "—"}</td><td class="num muted">${num(x.games, 0)}</td></tr>`).join("")}</tbody></table>` : "";
    const mus = (b.best.length || b.worst.length) ? `<div class="grid" style="margin-top:6px">
      <div><div class="sub-h">Best lane matchups</div>${b.best.map(x => `<span class="pill good">${esc(heroName(x.hero))} ${x.wr.toFixed(0)}%</span>`).join("")}</div>
      <div><div class="sub-h">Worst lane matchups</div>${b.worst.map(x => `<span class="pill bad">${esc(heroName(x.hero))} ${x.wr.toFixed(0)}%</span>`).join("")}</div></div>` : "";
    const abil = (b.abilities || []).filter(a => a.key !== "BASIC").map(a => `<tr><td><b>${esc(keyLabel(a.key))}</b></td><td><b>${esc(a.name)}</b><br><span class="muted">${esc(a.desc)}</span></td></tr>`).join("");
    return `<div class="verdict">${lines.join("<br>")}</div>${skills}${builds}${mus}
      ${abil ? `<details><summary>Abilities</summary><table><tbody>${abil}</tbody></table></details>` : ""}`;
  }

  function render() { renderRecord(); renderStats(); renderSuggest(); }

  // ---------- phone tabs ----------
  const tabs = [...document.querySelectorAll(".tabbar button")];
  function showTab(name, scroll = true) {
    if (!document.getElementById("tab-" + name)) name = "record";
    document.querySelectorAll("section[data-tab]").forEach(s => s.classList.toggle("active", s.dataset.tab === name));
    tabs.forEach(t => { const on = t.dataset.go === name; t.classList.toggle("on", on); on ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current"); });
    try { localStorage.setItem("squad-tab", name); } catch {}
    if (scroll && matchMedia("(max-width: 760px)").matches) window.scrollTo({ top: 0, behavior: "auto" });
  }
  tabs.forEach(t => t.onclick = () => showTab(t.dataset.go));
  window.__showTab = showTab;
  showTab((() => { try { return localStorage.getItem("squad-tab"); } catch { return null; } })() || "record", false);

  render();

  // hand shared pieces to the live-match module
  window.__app = { ctx, heroes, squad, meta, T, esc, pct, wl, heroName, label, renderBrief };
  const ms = document.createElement("script"); ms.src = "match.js"; document.body.appendChild(ms);
})();
