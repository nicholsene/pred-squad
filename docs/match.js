/* Live match: setup (manual or scanned), shared room, live tracking, strategy.
 * Depends on window.SquadEngine, window.LoadingScan and window.__app (from app.js). */
(function () {
  "use strict";
  const SUPABASE_URL = "https://hijfyfysjneqhqgbsypx.supabase.co";
  // Public "anon" key: safe to ship in a web page; table access is limited by row-level security.
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpamZ5Znlzam5lcWhxZ2JzeXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyNDk1NzEsImV4cCI6MjEwODgyNTU3MX0.-46Mh5IODrX4oKnHuWvkn0KaFRzenpqC-wwt_z1cgyA";
  const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

  const A = window.__app, E = window.SquadEngine;
  const $ = s => document.querySelector(s);
  const esc = A.esc, pct = A.pct, wl = A.wl, heroName = A.heroName, label = A.label, roleName = r => E.ROLE_LABEL[r] || r;
  const ROLES = E.ROLES;

  // ---------- state ----------
  const blank = () => ({ setup: { ours: {}, theirs: {} }, live: {}, clock: {}, board: null });
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let S = store.get("squad-match", null) || blank();
  let room = null;          // { code, client, channel }
  let me = store.get("squad-me", "");
  let tick = null;

  // ---------- persistence: local or shared ----------
  function setPath(path, value) {
    let o = S;
    for (let i = 0; i < path.length - 1; i++) o = (o[path[i]] = (o[path[i]] && typeof o[path[i]] === "object") ? o[path[i]] : {});
    o[path[path.length - 1]] = value;
    store.set("squad-match", S);
    render();
    if (room) room.client.rpc("patch_room", { p_code: room.code, p_path: path.map(String), p_value: value ?? null })
      .then(({ error }) => { if (error) toast("Sync failed — " + error.message); });
  }

  // ---------- live room ----------
  function loadSB() {
    if (window.supabase) return Promise.resolve(window.supabase);
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = SB_LIB; s.onload = () => res(window.supabase); s.onerror = () => rej(new Error("Couldn't load live sync (offline?)")); document.head.appendChild(s); });
  }
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 31]).join("");

  async function joinRoom(code, create) {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 4) return toast("Room codes are 4–8 letters/numbers");
    setRoomStatus("Connecting…");
    try {
      const sb = await loadSB();
      const client = sb.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
      if (create) {
        const { error } = await client.from("rooms").insert({ code });
        if (error) throw error;
        // seed the room with whatever this phone already has
        for (const [k, v] of Object.entries({ setup: S.setup, live: S.live, clock: S.clock })) {
          const r = await client.rpc("patch_room", { p_code: code, p_path: [k], p_value: v }); if (r.error) throw r.error;
        }
      }
      const { data, error } = await client.from("rooms").select("state").eq("code", code).maybeSingle();
      if (error) throw error;
      if (!data) { setRoomStatus(""); return toast("No room with that code (rooms last 3 days)"); }
      if (room) leaveRoom(true);
      S = Object.assign(blank(), data.state || {});
      const channel = client.channel("room:" + code, { config: { presence: { key: me || "guest-" + Math.random().toString(36).slice(2, 6) } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `code=eq.${code}` }, payload => {
          S = Object.assign(blank(), payload.new.state || {}); store.set("squad-match", S); render();
        })
        .on("presence", { event: "sync" }, () => renderRoom())
        .subscribe(async st => { if (st === "SUBSCRIBED") await channel.track({ who: me || "guest", at: Date.now() }); renderRoom(); });
      room = { code, client, channel };
      const u = new URL(location.href); u.searchParams.set("room", code); history.replaceState(null, "", u);
      store.set("squad-room", code);
      render(); renderRoom();
      if (!wake.on) wake.enable(); // live match → keep screen on by default
    } catch (e) { setRoomStatus(""); toast("Couldn't connect: " + (e.message || e)); }
  }
  function leaveRoom(silent) {
    if (!room) return;
    try { room.client.removeChannel(room.channel); } catch {}
    room = null; store.set("squad-room", null);
    const u = new URL(location.href); u.searchParams.delete("room"); history.replaceState(null, "", u);
    if (!silent) { renderRoom(); render(); }
  }
  function roomPeople() {
    if (!room) return [];
    const st = room.channel.presenceState(); return [...new Set(Object.values(st).flat().map(p => p.who).filter(Boolean))];
  }
  function setRoomStatus(t) { const el = $("#room-status"); if (el) el.textContent = t; }

  // ---------- wake lock ----------
  const wake = {
    on: false, lock: null,
    supported: "wakeLock" in navigator,
    async enable() {
      if (!this.supported) return toast("This browser can't keep the screen on — update iOS/Chrome, or raise auto-lock in Settings");
      try { this.lock = await navigator.wakeLock.request("screen"); this.on = true; this.lock.addEventListener("release", () => { this.lock = null; }); }
      catch (e) { this.on = false; toast("Screen-on was blocked: " + e.message); }
      store.set("squad-wake", this.on); renderWake();
    },
    disable() { this.on = false; if (this.lock) this.lock.release().catch(() => {}); this.lock = null; store.set("squad-wake", false); renderWake(); },
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wake.on && !wake.lock) wake.enable(); });
  function renderWake() {
    const t = $("#wake"); if (!t) return;
    t.checked = wake.on; $("#wake-note").textContent = wake.supported ? (wake.on ? "Screen stays on while this page is open" : "") : "Not supported on this browser";
  }

  // ---------- clock ----------
  const clockSec = () => S.clock && S.clock.startedAt ? Math.max(0, Math.floor((Date.now() - S.clock.startedAt) / 1000)) : null;
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ---------- scan ----------
  async function runScan(file) {
    const box = $("#scan-progress"); box.hidden = false;
    const bar = box.querySelector("i"), txt = box.querySelector("span");
    try {
      const res = await window.LoadingScan.scan(file, A.heroes, A.squad.players, (msg, f) => { txt.textContent = msg; bar.style.width = Math.round(f * 100) + "%"; });
      const ours = {}, theirs = {};
      for (const r of ROLES) {
        if (res.ours[r]) ours[r] = { hero: res.ours[r].hero || "", who: res.ours[r].who || ((S.setup.ours[r] || {}).who) || "" };
        if (res.theirs[r]) theirs[r] = { hero: res.theirs[r].hero || "" };
      }
      setPath(["setup"], { ours, theirs });
      txt.textContent = res.issues.length ? res.issues.join(" ") : "All 10 heroes read — tap who's who if needed.";
      bar.style.width = "100%";
    } catch (e) { txt.textContent = "Scan failed: " + (e.message || e); }
  }

  // ---------- scoreboard scan (mid-match) ----------
  let sbLib = null;
  const loadScoreboard = () => sbLib ||= (window.ScoreboardScan ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "scoreboard.js"; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the scoreboard reader")); document.head.appendChild(s);
  }));
  async function runBoardScan(file) {
    const box = $("#board-progress"); box.hidden = false;
    const bar = box.querySelector("i"), txt = box.querySelector("span");
    try {
      await loadScoreboard();
      const known = { L: ROLES.map(r => (S.setup.ours[r] || {}).hero || null), R: ROLES.map(r => (S.setup.theirs[r] || {}).hero || null) };
      const res = await window.ScoreboardScan.scan(file, { heroes: A.heroes, known, onProgress: (m, f) => { txt.textContent = m; bar.style.width = Math.round(f * 100) + "%"; } });
      if (!res.ours.length) { txt.textContent = res.issues.join(" "); return; }
      const board = { at: Date.now(), clock: clockSec(), ours: res.ours, theirs: res.theirs };
      // fill any heroes the lineup didn't have yet
      const setup = JSON.parse(JSON.stringify(S.setup));
      ROLES.forEach((r, i) => {
        if (res.ours[i] && res.ours[i].hero && !(setup.ours[r] || {}).hero) setup.ours[r] = Object.assign({}, setup.ours[r], { hero: res.ours[i].hero });
        if (res.theirs[i] && res.theirs[i].hero && !(setup.theirs[r] || {}).hero) setup.theirs[r] = Object.assign({}, setup.theirs[r], { hero: res.theirs[i].hero });
      });
      // enemies who are clearly snowballing get marked "Ahead" (never un-marked automatically)
      const st = E.boardState(board, setup, A.T);
      for (const f of st.fed) setup.theirs[f.role] = Object.assign({}, setup.theirs[f.role], { fed: true });
      // squad deaths come straight off the board
      const live = JSON.parse(JSON.stringify(S.live || {}));
      ROLES.forEach((r, i) => { const who = (setup.ours[r] || {}).who; if (who && res.ours[i] && res.ours[i].d != null) live[who] = Object.assign({}, live[who], { deaths: res.ours[i].d }); });
      setPath(["setup"], setup); setPath(["live"], live); setPath(["board"], board);
      txt.textContent = res.issues.length ? res.issues.join(" ") : "Scoreboard read — the plan below is updated for everyone.";
      bar.style.width = "100%";
    } catch (e) { txt.textContent = "Scan failed: " + (e.message || e); }
  }

  function renderBoard() {
    const el = $("#board"); if (!el) return;
    const b = S.board;
    if (!b || !b.ours) { el.innerHTML = ""; return; }
    const st = E.boardState(b, S.setup, A.T, heroName);
    const ago = Math.max(0, Math.round((Date.now() - b.at) / 60000));
    const kda = r => r.k == null ? "—" : `${r.k}/${r.d ?? "?"}/${r.a ?? "?"}`;
    const g = x => x == null ? "—" : `${(x / 1000).toFixed(1)}k`;
    const diff = (x, unit, digits = 0) => x == null ? "" : `<span class="${x > 0 ? "good" : x < 0 ? "bad" : "muted"}">${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(digits)}${unit}</span>`;
    const side = (hero, r) => `<span class="bl-side"><b>${esc(hero ? heroName(hero) : "—")}</b> <span class="muted">L${r.lvl ?? "?"} · ${kda(r)} · ${g(r.gold)}</span></span>`;
    const rows = st.lanes.map(l => `<div class="bl-row"><div class="bl-head"><b>${esc(roleName(l.role))}</b>${l.who ? ` <span class="muted">${esc(label(l.who))}</span>` : ""}
        <span class="bl-gap">${diff(l.lvlDiff, " lv")}${l.goldDiff == null ? "" : " · " + diff(l.goldDiff / 1000, "k", 1)}</span></div>
      <div class="bl-vs">${side(l.hero, l.o)}<span class="muted">vs</span>${side(l.opp, l.e)}</div></div>`).join("");
    el.innerHTML = `<div class="tile board">
      <div class="board-head"><b>Scoreboard</b> <span class="muted">${b.clock != null ? `at ${fmt(b.clock)} · ` : ""}${ago ? `${ago} min ago` : "just now"}</span>
        <span class="board-tot">Gold ${st.goldDiff == null ? "—" : (st.goldEstimated ? "≈" : "") + diff(st.goldDiff / 1000, "k", 1)} · Kills ${st.us.kills}–${st.them.kills} · Avg level ${st.lvlDiff == null ? "—" : diff(st.lvlDiff, "", 1)}</span></div>
      <div class="bl">${rows}</div>
      <p class="note" style="margin:6px 0 0">Wrong number? Rescan, or fix deaths in the tracker below.</p></div>`;
  }

  // ---------- render ----------
  function heroSelect(path, current, role) {
    const list = A.heroes.filter(h => !role || (h.roles || []).includes(role) || h.slug === current);
    return `<select data-path='${JSON.stringify(path)}' aria-label="Hero"><option value="">—</option>${list.map(h => `<option value="${esc(h.slug)}" ${h.slug === current ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select>`;
  }
  function whoSelect(path, current) {
    return `<select data-path='${JSON.stringify(path)}' aria-label="Player"><option value="">Teammate</option>${A.squad.players.map(p => `<option value="${esc(p.key)}" ${p.key === current ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>`;
  }

  function renderRoom() {
    const el = $("#room"); if (!el) return;
    if (room) {
      const people = roomPeople();
      el.innerHTML = `<div class="room-live"><span class="dot"></span><div><div class="room-code">${esc(room.code)}</div>
        <div class="muted" style="font-size:12px">${people.length ? esc(people.join(", ")) + " connected" : "Live"}</div></div>
        <div class="room-actions"><button class="chip cta" type="button" id="room-share">Share link</button><button class="chip ghost" type="button" id="room-leave">Leave</button></div></div>`;
      $("#room-share").onclick = async () => {
        const url = location.href;
        try { if (navigator.share) await navigator.share({ title: "Squad match " + room.code, url }); else { await navigator.clipboard.writeText(url); toast("Link copied"); } } catch {}
      };
      $("#room-leave").onclick = () => leaveRoom();
    } else {
      el.innerHTML = `<div class="room-start"><button class="chip cta" type="button" id="room-new">Start live match</button>
        <form id="room-join" class="join"><input id="room-code" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="8" placeholder="Code" aria-label="Room code"><button class="chip ghost" type="submit">Join</button></form></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">One person sets up the match; everyone joins with the code and sees the same plan. <span id="room-status"></span></p>`;
      $("#room-new").onclick = () => joinRoom(newCode(), true);
      $("#room-join").onsubmit = e => { e.preventDefault(); joinRoom($("#room-code").value, false); };
    }
  }

  function renderSetup() {
    const o = S.setup.ours || {}, t = S.setup.theirs || {};
    $("#setup").innerHTML = `<div class="setup-grid">
      <div class="sg-row sg-head"><div class="sg-h"></div><div class="sg-h">Your team</div><div class="sg-h">Enemy</div></div>
      ${ROLES.map(r => `<div class="sg-row"><div class="sg-role">${esc(roleName(r))}</div>
        <div class="sg-cell">${heroSelect(["setup", "ours", r, "hero"], (o[r] || {}).hero, r)}${whoSelect(["setup", "ours", r, "who"], (o[r] || {}).who)}</div>
        <div class="sg-cell">${heroSelect(["setup", "theirs", r, "hero"], (t[r] || {}).hero, r)}
          <label class="fed"><input type="checkbox" data-path='${JSON.stringify(["setup", "theirs", r, "fed"])}' ${(t[r] || {}).fed ? "checked" : ""}> Ahead</label></div></div>`).join("")}
    </div>
    <p class="note" style="margin:8px 0 0">Tick <b>Ahead</b> when an enemy is snowballing (several kills, items ahead of everyone). They jump to the top of the threat list and their lane is flagged, so the squad plays around them.</p>`;
    $("#setup").querySelectorAll("[data-path]").forEach(el => el.onchange = () => setPath(JSON.parse(el.dataset.path), el.type === "checkbox" ? el.checked : el.value));
  }

  function renderLive() {
    const present = ROLES.map(r => (S.setup.ours[r] || {}).who).filter(Boolean);
    const sec = clockSec();
    const next = sec == null ? null : E.TIMELINE.find(x => x.t > sec);
    $("#clock").innerHTML = sec == null
      ? `<button class="chip cta" type="button" id="clock-start">Start match clock</button><span class="muted" style="font-size:12px">Tap when the match starts (0:00) for objective timers.</span>`
      : `<div class="clock-big">${fmt(sec)}</div><div class="clock-next">${next ? `${esc(next.label)} in <b>${fmt(next.t - sec)}</b>` : "All timed objectives are up"}</div>
         <div class="clock-adj"><button class="chip ghost" data-adj="-10">−10s</button><button class="chip ghost" data-adj="10">+10s</button><button class="chip ghost" id="clock-reset">Reset</button></div>`;
    const cs = $("#clock-start"); if (cs) cs.onclick = () => setPath(["clock", "startedAt"], Date.now());
    $("#clock").querySelectorAll("[data-adj]").forEach(b => b.onclick = () => setPath(["clock", "startedAt"], S.clock.startedAt - (+b.dataset.adj) * 1000));
    const cr = $("#clock-reset"); if (cr) cr.onclick = () => setPath(["clock", "startedAt"], null);

    $("#tracker").innerHTML = present.length ? present.map(m => {
      const lv = S.live[m] || {};
      const step = (k, v) => `<div class="stepper"><span>${k === "deaths" ? "Deaths" : "Wards"}</span><button type="button" data-step='${JSON.stringify([m, k, -1])}' aria-label="minus">−</button><b class="${k === "deaths" && v >= A.T.maxDeaths ? "bad" : k === "deaths" && v >= A.T.maxDeaths - 1 ? "warn" : ""}">${v || 0}</b><button type="button" data-step='${JSON.stringify([m, k, 1])}' aria-label="plus">+</button></div>`;
      return `<div class="track-row ${m === me ? "mine" : ""}"><div class="name">${esc(label(m))}${m === me ? ' <span class="muted">(you)</span>' : ""}</div>
        ${step("deaths", lv.deaths)}${step("wards", lv.wards)}
        <label class="fed"><input type="checkbox" data-obj="${esc(m)}" ${lv.obj ? "checked" : ""}> Objective dmg</label></div>`;
    }).join("") : `<p class="muted" style="margin:0">Mark which lanes you three are in (Your team → player) to track deaths and wards.</p>`;
    $("#tracker").querySelectorAll("[data-step]").forEach(b => b.onclick = () => {
      const [m, k, d] = JSON.parse(b.dataset.step); const v = Math.max(0, ((S.live[m] || {})[k] || 0) + d); setPath(["live", m, k], v);
      if (navigator.vibrate) navigator.vibrate(8);
    });
    $("#tracker").querySelectorAll("[data-obj]").forEach(c => c.onchange = () => setPath(["live", c.dataset.obj, "obj"], c.checked));
  }

  function renderStrategy() {
    const plan = E.matchPlan(A.ctx, S.setup, S.live, clockSec(), A.T);
    const anyHero = plan.lanes.some(l => l.hero || l.opp);
    if (!anyHero) { $("#strategy").innerHTML = `<p class="muted" style="margin:0">Scan the loading screen or pick heroes above to get the plan.</p>`; return; }
    const tag = v => v ? `<span class="vtag v-${v.toLowerCase()}">${v}</span>` : "";
    const lanes = plan.lanes.map(l => {
      const ev = [];
      if (l.ev.inSquad && l.ev.inSquad.games) ev.push(`${wl(l.ev.inSquad)} with group`);
      if (l.ev.personal && l.ev.personal.games) ev.push(`${wl(l.ev.personal)} on this hero`);
      if (l.ev.vsOpp && l.ev.vsOpp.games) ev.push(`${wl(l.ev.vsOpp)} vs ${esc(heroName(l.opp))}`);
      if (l.ev.laneVs && l.ev.laneVs.games) ev.push(`squad ${wl(l.ev.laneVs)} vs ${esc(heroName(l.opp))} here`);
      if (l.ev.matchup) ev.push(`meta matchup ${(l.ev.matchup.wr * 100).toFixed(0)}%`);
      else if (l.ev.meta && l.ev.meta.wr != null) ev.push(`hero meta ${l.ev.meta.wr.toFixed(1)}%`);
      return `<div class="lane-row"><div class="lane-role">${esc(roleName(l.role))}</div>
        <div class="lane-vs"><b>${esc(l.hero ? heroName(l.hero) : "—")}</b>${l.who ? ` <span class="muted">${esc(label(l.who))}</span>` : ""} <span class="muted">vs</span> <b>${esc(l.opp ? heroName(l.opp) : "—")}</b>${l.fed ? ' <span class="vtag v-tough">ahead</span>' : ""}
          ${ev.length ? `<div class="muted" style="font-size:12px">${ev.join(" · ")}</div>` : ""}</div>
        <div class="lane-est">${l.est != null ? `<b>${pct(l.est)}</b>${tag(l.verdict)}` : ""}</div></div>`;
    }).join("");
    const mine = Object.entries(plan.members).map(([m, x]) => {
      const brief = x.hero ? A.renderBrief(m, x.role, x.hero, x.opp, plan.squadHere) : "";
      return `<div class="planrow ${m === me ? "mine" : ""}"><h3>${esc(label(m))} · ${esc(roleName(x.role))}</h3>
        ${x.rules.map(r => `<div class="rule r-${r.level}">${esc(r.text)}</div>`).join("")}${brief}</div>`;
    });
    // put "me" first
    const order = Object.keys(plan.members).sort((a, b) => (b === me) - (a === me));
    // scoreboard calls come first: they are the freshest information
    const st = S.board ? E.boardState(S.board, S.setup, A.T, heroName) : null;
    const boardCalls = st ? st.calls.map(c => `<div class="call c-${c.level}">${esc(c.text)}</div>`).join("") : "";
    // build answers to what the enemy is building / likely to build
    let builds = "";
    const L = A.lab && A.lab();
    if (L) {
      const enemy = ROLES.map((r, i) => ({ hero: (S.setup.theirs[r] || {}).hero, ahead: !!(S.setup.theirs[r] || {}).fed }));
      const ours = ROLES.map(r => S.setup.ours[r] || {}).filter(o => o.who && o.hero).map(o => ({ who: o.who, hero: o.hero, deaths: (S.live[o.who] || {}).deaths || 0 }));
      if (ours.length && enemy.some(e => e.hero)) {
        const res = window.ItemLab.respond(L, enemy, ours);
        builds = res.calls.filter(c => c.pick).slice(0, 4).map(c => {
          const ev = c.evidence, a = ev.answered, b = ev.unanswered;
          const evText = Math.min(a.games, b.games) >= 8 ? `In your matches, teams facing heavy ${c.threat.label} won ${pct(a.wins / a.games)} with ${c.threat.answer} vs ${pct(b.wins / b.games)} without (${a.games + b.games} games).` : "";
          const from = c.who.length ? ` — ${c.who.map(heroName).join(" & ")}` : "";
          return `<div class="build-call"><div><b>Enemy ${esc(c.threat.label)}</b><span class="muted">${esc(from)}</span></div>
            <div>${esc(label(c.pick.who))} (${esc(heroName(c.pick.hero))}): buy <b>${esc(c.pick.item.label)}</b>${c.pick.alt ? ` <span class="muted">or ${esc(c.pick.alt.label)}</span>` : ""}${c.pick.seen ? ` <span class="muted">· ${c.pick.seen}× by ${esc(heroName(c.pick.hero))} players in your games</span>` : ""}</div>
            ${evText ? `<div class="muted" style="font-size:12px">${esc(evText)}</div>` : ""}</div>`;
        }).join("");
      }
    }
    $("#strategy").innerHTML = `${boardCalls ? `<div class="sub-h">Right now · from the scoreboard</div><div class="calls">${boardCalls}</div><div class="sub-h">Game plan · from the lineup</div>` : ""}
      <div class="calls">${plan.calls.map(c => `<div class="call">${esc(c)}</div>`).join("")}</div>
      ${builds ? `<div class="sub-h">Build to answer them</div><div class="builds">${builds}</div>` : ""}
      <div class="sub-h">Lanes</div><div class="lanes">${lanes}</div>
      ${order.length ? `<div class="sub-h">Your squad</div>` : ""}${order.map(m => mine[Object.keys(plan.members).indexOf(m)]).join("")}`;
  }

  function render() { renderSetup(); renderLive(); renderBoard(); renderStrategy(); }
  window.__matchRender = renderStrategy;

  // ---------- toast ----------
  let toastT; function toast(msg) {
    let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast glass"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200);
  }

  // ---------- init ----------
  function init() {
    const meSel = $("#me");
    meSel.innerHTML = `<option value="">Who are you?</option>` + A.squad.players.map(p => `<option value="${esc(p.key)}" ${p.key === me ? "selected" : ""}>${esc(p.label)}</option>`).join("");
    meSel.onchange = () => { me = meSel.value; store.set("squad-me", me); if (room) room.channel.track({ who: me || "guest", at: Date.now() }); render(); };
    $("#wake").onchange = e => e.target.checked ? wake.enable() : wake.disable();
    $("#scan-file").onchange = e => { const f = e.target.files && e.target.files[0]; if (f) runScan(f); e.target.value = ""; };
    $("#board-file").onchange = e => { const f = e.target.files && e.target.files[0]; if (f) runBoardScan(f); e.target.value = ""; };
    $("#match-clear").onclick = () => { setPath(["setup"], { ours: {}, theirs: {} }); setPath(["live"], {}); setPath(["clock"], {}); setPath(["board"], null); toast("Match cleared"); };
    renderWake(); renderRoom(); render();
    const q = new URLSearchParams(location.search).get("room") || store.get("squad-room", null);
    if (q) joinRoom(q, false);
    if (store.get("squad-wake", false)) document.addEventListener("pointerdown", () => wake.on || wake.enable(), { once: true }); // needs a user gesture
    clearInterval(tick); tick = setInterval(() => { if (S.clock && S.clock.startedAt && document.visibilityState === "visible") { renderLive(); } }, 1000);
    // lineup suggestion -> match setup
    window.__applyLineup = (roles, heroesBy) => {
      const ours = Object.assign({}, S.setup.ours);
      for (const r of ROLES) if (ours[r] && ours[r].who && Object.keys(roles).includes(ours[r].who)) ours[r] = Object.assign({}, ours[r], { who: "" });
      for (const [m, r] of Object.entries(roles)) ours[r] = Object.assign({}, ours[r], { who: m, hero: heroesBy[m] || (ours[r] || {}).hero || "" });
      setPath(["setup", "ours"], ours);
    };
  }
  init();
})();
