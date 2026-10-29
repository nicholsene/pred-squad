/* Live match: setup (manual or scanned), shared room, live tracking, strategy.
 * Depends on window.SquadEngine, window.LoadingScan and window.__app (from app.js). */
(function () {
  "use strict";
  const SUPABASE_URL = "https://hijfyfysjneqhqgbsypx.supabase.co";
  // Public API key. Existing rooms allow public reads and use room codes for editing.
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpamZ5Znlzam5lcWhxZ2JzeXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyNDk1NzEsImV4cCI6MjEwODgyNTU3MX0.-46Mh5IODrX4oKnHuWvkn0KaFRzenpqC-wwt_z1cgyA";
  const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

  const A = window.__app, E = window.SquadEngine;
  const $ = s => document.querySelector(s);
  const esc = A.esc, pct = A.pct, wl = A.wl, heroName = A.heroName, label = A.label, roleName = r => E.ROLE_LABEL[r] || r;
  const ROLES = E.ROLES;

  // ---------- state ----------
  const M = window.SquadSession;
  const blank = M.blank;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let S = M.normalize(store.get("squad-match", null));
  let previousScan = null, scanBusy = false, pendingPlanOpen = false;
  let room = null;          // { code, client, channel }
  let me = store.get("squad-me", "");
  let tick = null;

  // ---------- persistence: local or shared ----------
  const applyChanges = (state, changes) => {
    for (const c of changes) {
      let o = state;
      for (const k of c.path.slice(0,-1)) o = o[k] ||= {};
      const key = c.path.at(-1);
      o[key] = c.increment == null ? M.clone(c.value) : Math.max(0, (Number(o[key]) || 0) + c.increment);
    }
    return state;
  };
  function persist() { store.set("squad-match", S); }
  function receive(data) {
    if (!room || data.version < room.version) return;
    room.version = data.version; room.base = M.normalize(data.state);
    S = applyChanges(M.clone(room.base), room.pending.filter(p => !(data.state?._operations || []).includes(p.id)).flatMap(p => p.changes)); persist(); render();
  }
  async function refreshRoom() {
    const current = room; if (!current) return;
    const {data,error} = await current.client.from("rooms").select("state,version").eq("code",current.code).maybeSingle();
    if (room !== current) return;
    if (error || !data) { current.status = "Disconnected — retry"; renderRoom(); return; }
    receive(data);
  }
  async function flush() {
    const current = room;
    if (!current || current.sending || !navigator.onLine) return;
    current.sending = true;
    try {
      while (room === current && current.pending.length) {
        const op = current.pending[0]; current.status = "Changes pending"; renderRoom();
        const {data,error} = await current.client.rpc("patch_room_batch", {
          p_code:current.code, p_changes:op.changes, p_operation:op.id, p_expected_version:op.expected ?? null,
        });
        if (room !== current) return;
        if (error) {
          if (/conflict/i.test(error.message)) {
            current.pending.shift(); store.set("squad-outbox-"+current.code,current.pending);
            await refreshRoom(); toast("Room changed. Review the latest state and apply your scan again."); continue;
          }
          current.status = "Sync failed — retry"; toast("Sync failed: " + error.message); break;
        }
        current.pending.shift(); store.set("squad-outbox-"+current.code,current.pending);
        receive(data);
      }
      if (!current.pending.length) current.status = current.connected ? "Synced" : "Reconnecting";
    } catch (e) { current.status = "Offline — changes saved on this device"; }
    finally { current.sending = false; if (room === current) renderRoom(); }
  }
  function commit(changes, strict = false) {
    if (room) {
      room.pending.push({id:crypto.randomUUID(), changes:M.clone(changes), expected:strict === false ? null : typeof strict === "number" ? strict : room.version});
      store.set("squad-outbox-"+room.code,room.pending);
    }
    applyChanges(S, changes); persist(); render(); flush();
  }
  function setPath(path, value) { commit([{path,value}]); }
  function replaceState(next) { commit(Object.entries(next).filter(([k])=>!k.startsWith("_")).map(([k,value])=>({path:[k],value}))); }
  addEventListener("online", () => { refreshRoom().then(flush); });
  addEventListener("offline", () => { if(room){room.status="Offline — changes saved on this device";renderRoom();} });

  // ---------- live room ----------
  function loadSB() {
    if (window.supabase) return Promise.resolve(window.supabase);
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = SB_LIB; s.onload = () => res(window.supabase); s.onerror = () => rej(new Error("Couldn't load live sync (offline?)")); document.head.appendChild(s); });
  }
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % "ABCDEFGHJKMNPQRSTUVWXYZ23456789".length]).join("");

  async function joinRoom(code, create) {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 4 || code.length > 8) return toast("Room codes are 4–8 letters/numbers");
    setRoomStatus("Connecting…");
    try {
      const sb = await loadSB();
      const client = sb.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
      if (create) {
        let error;
        for (let attempt=0; attempt<4; attempt++) {
          const result = await client.from("rooms").insert({ code, state:S }); error=result.error;
          if (!error) break;
          if (error.code !== "23505") throw error;
          code=newCode();
        }
        if (error) throw error;
      }
      const { data, error } = await client.from("rooms").select("state,version").eq("code", code).maybeSingle();
      if (error) throw error;
      if (!data) { setRoomStatus(""); return toast("No room with that code (rooms last 3 days)"); }
      if (room) leaveRoom(true);
      S = M.normalize(data.state);
      const channel = client.channel("room:" + code, { config: { presence: { key: me || "guest-" + Math.random().toString(36).slice(2, 6) } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `code=eq.${code}` }, payload => {
          receive(payload.new);
        })
        .on("presence", { event: "sync" }, () => renderRoom())
        .subscribe(async st => {
          if (!room || room.code !== code) return;
          room.connected = st === "SUBSCRIBED";
          room.status = room.connected ? "Synced" : "Reconnecting";
          if (room.connected) { await channel.track({ who: me || "guest", at: Date.now() }); await refreshRoom(); flush(); }
          renderRoom();
        });
      room = { code, client, channel, version:data.version, base:M.clone(S), pending:store.get("squad-outbox-"+code, []), status:"Connecting", connected:false };
      S = applyChanges(S, room.pending.flatMap(p=>p.changes)); persist();
      const u = new URL(location.href); u.searchParams.set("room", code); history.replaceState(null, "", u);
      store.set("squad-room", code);
      render(); renderRoom();
      if (!wake.on && store.get("squad-wake",null)!==false) wake.enable();
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
  const matchVisible=()=>document.visibilityState==="visible"&&(!matchMedia("(max-width:760px)").matches||$("#tab-match").classList.contains("active"));
  const wake = {
    on: store.get("squad-wake",false), lock:null, pending:false, error:"",
    supported: "wakeLock" in navigator,
    async enable() {
      if(!this.supported){this.on=false;renderWake();return toast("Screen-on is unavailable in this browser. Adjust device auto-lock or try a supported browser.");}
      this.on=true;store.set("squad-wake",true);
      if(this.pending||this.lock||!matchVisible()){renderWake();return;}
      this.pending=true;this.error="";renderWake();
      try {
        const lock=await navigator.wakeLock.request("screen");
        if(!this.on||!matchVisible()){await lock.release();return;}
        this.lock=lock;
        lock.addEventListener("release",()=>{if(this.lock===lock)this.lock=null;renderWake();});
      }catch(e){this.error="Browser could not keep the screen on. Retry while Match is visible.";}
      finally{this.pending=false;renderWake();}
    },
    suspend(){const lock=this.lock;this.lock=null;if(lock)lock.release().catch(()=>{});renderWake();},
    disable(){this.on=false;this.error="";store.set("squad-wake",false);this.suspend();},
  };
  document.addEventListener("visibilitychange",()=>{
    if(matchVisible()&&wake.on&&!wake.lock)wake.enable();else if(!matchVisible())wake.suspend();
  });
  document.addEventListener("squad:tab",()=>{
    if(matchVisible()&&wake.on&&!wake.lock)wake.enable();else if(!matchVisible())wake.suspend();
  });
  function renderWake() {
    const t=$("#wake"),note=$("#wake-note");if(!t||!note)return;
    t.checked=!!wake.on;t.disabled=!wake.supported;
    note.textContent=!wake.supported?"Screen-on isn't supported by this browser.":wake.lock&&!wake.lock.released?"Screen stays on while Match is visible.":wake.pending?"Requesting screen-on…":wake.on?(wake.error||"Screen-on paused. Return to Match or retry to resume."):"Screen-on is off.";
    if(wake.supported&&wake.on&&!wake.lock&&!wake.pending&&matchVisible()){
      const b=document.createElement("button");b.type="button";b.className="chip ghost";b.textContent="Retry screen-on";b.onclick=()=>wake.enable();note.append(" ",b);
    }
  }

  // ---------- clock ----------
  const clockSec = () => S.clock && S.clock.startedAt ? Math.max(0, Math.floor(((S.stage === "finished" ? S.finishedAt : Date.now()) - S.clock.startedAt) / 1000)) : null;
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
      const setup = M.clone(S.setup);
      for (const role of ROLES) {
        if (ours[role]?.hero) setup.ours[role] = { ...setup.ours[role], ...ours[role] };
        if (theirs[role]?.hero) setup.theirs[role] = { ...setup.theirs[role], ...theirs[role] };
      }
      reviewSetup(setup, res.issues);
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
      reviewBoard(board, res.issues);
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
      <p class="note" style="margin:6px 0 0">${ago >= 3 ? "Snapshot is stale — rescan before acting. " : ""}Use Scan scoreboard to review and correct every number.</p></div>`;
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
        <div class="muted" style="font-size:12px">${people.length ? esc(people.join(", ")) + " connected" : "Room"} · ${esc(room.status)}</div></div>
        <div class="room-actions"><button class="chip cta" type="button" id="room-share">Share link</button><button class="chip ghost" type="button" id="room-retry">Retry sync</button><button class="chip ghost" type="button" id="room-leave">Leave</button></div></div>`;
      $("#room-share").onclick = async () => {
        const url = location.href;
        try { if (navigator.share) await navigator.share({ title: "Squad match " + room.code, url }); else { await navigator.clipboard.writeText(url); toast("Link copied"); } } catch {}
      };
      $("#room-retry").onclick = () => refreshRoom().then(flush);
      $("#room-leave").onclick = () => leaveRoom();
    } else {
      el.innerHTML = `<div class="room-start"><button class="chip cta" type="button" id="room-new">Share this plan</button>
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
    $("#setup").querySelectorAll("[data-path]").forEach(el => el.onchange = () => {
      const path = JSON.parse(el.dataset.path), value = el.type === "checkbox" ? el.checked : el.value;
      const setup=M.clone(S.setup); applyChanges({setup},[{path,value}]);
      const issues=M.validateSetup(setup).filter(x=>!x.startsWith("Choose a hero"));
      if(issues.length){toast(issues.join(" "));renderSetup();return;}
      commit([{path,value}, ...(S.stage === "ready" ? [{path:["stage"],value:"draft"}] : [])]);
    });
  }

  function renderLive() {
    const present = ROLES.map(r => (S.setup.ours[r] || {}).who).filter(Boolean);
    const sec = clockSec();
    const next = nextObjective(sec);
    $("#clock").innerHTML = sec == null
      ? `<button class="chip cta" type="button" id="clock-start">Start match</button><span class="muted" style="font-size:12px">Tap when the match starts (0:00) for objective timers.</span>`
      : `<div class="clock-big">${fmt(sec)}</div><div class="clock-next">${next ? `${esc(next.label)} in <b>${fmt(next.t - sec)}</b>` : "Record an objective observation below"}</div>
         <div class="clock-adj"><button class="chip ghost" data-adj="-10">−10s</button><button class="chip ghost" data-adj="10">+10s</button><button class="chip ghost" id="clock-reset">Reset</button></div>`;
    const cs = $("#clock-start"); if (cs) cs.onclick = startMatch;
    $("#clock").querySelectorAll("[data-adj]").forEach(b => b.onclick = () => setPath(["clock", "startedAt"], S.clock.startedAt - (+b.dataset.adj) * 1000));
    const cr = $("#clock-reset"); if (cr) cr.onclick = () => { if(confirm("Reset the clock and objective observations?")) commit([{path:["clock"],value:{}},{path:["objectives"],value:{}},{path:["stage"],value:"draft"}]); };

    $("#tracker").innerHTML = present.length ? present.map(m => {
      const lv = S.live[m] || {};
      const step = (k, v) => `<div class="stepper"><span>${k === "deaths" ? "Deaths" : "Wards"}</span><button type="button" data-step='${JSON.stringify([m, k, -1])}' aria-label="minus">−</button><b class="${k === "deaths" && v >= A.T.maxDeaths ? "bad" : k === "deaths" && v >= A.T.maxDeaths - 1 ? "warn" : ""}">${v || 0}</b><button type="button" data-step='${JSON.stringify([m, k, 1])}' aria-label="plus">+</button></div>`;
      return `<div class="track-row ${m === me ? "mine" : ""}"><div class="name">${esc(label(m))}${m === me ? ' <span class="muted">(you)</span>' : ""}</div>
        ${step("deaths", lv.deaths)}${step("wards", lv.wards)}
        <label class="fed"><input type="checkbox" data-obj="${esc(m)}" ${lv.obj ? "checked" : ""}> Objective dmg</label></div>`;
    }).join("") : `<p class="muted" style="margin:0">Mark which lanes you three are in (Your team → player) to track deaths and wards.</p>`;
    $("#tracker").querySelectorAll("[data-step]").forEach(b => b.onclick = () => {
      const [m, k, d] = JSON.parse(b.dataset.step); commit([{path:["live",m,k],increment:d}]);
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
    const st = S.board && Date.now()-S.board.at < 180000 ? E.boardState(S.board, S.setup, A.T, heroName) : null;
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

  function render() { renderLifecycle(); renderSetup(); renderLive(); renderBoard(); renderStrategy(); renderObjectives(); renderPostmatch(); }
  window.__matchRender = () => { renderStrategy(); renderPostmatch(); };

  // ---------- toast ----------
  let toastT; function toast(msg) {
    let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast glass"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200);
  }

  async function chooseIdentity(members) {
    return new Promise(resolve => {
      const dialog=document.createElement("dialog");
      dialog.setAttribute("aria-label","Who are you?");
      dialog.innerHTML=`<h2>Who are you?</h2><p>Your game plan will open with your lane first.</p>${members.map(m=>`<button type="button" class="chip ${m===me?"cta":""}" data-person="${esc(m)}">${esc(label(m))}</button>`).join("")}<p><button type="button" data-cancel>Cancel</button></p>`;
      document.body.append(dialog);
      const done=value=>{dialog.close();dialog.remove();resolve(value);};
      dialog.querySelectorAll("[data-person]").forEach(b=>b.onclick=()=>done(b.dataset.person));
      dialog.querySelector("[data-cancel]").onclick=()=>done(null);
      dialog.oncancel=e=>{e.preventDefault();done(null);}; dialog.showModal();
    });
  }
  async function consumePlan() {
    const handoff=window.SquadHandoff, plan=handoff?.pending;
    if(!plan || pendingPlanOpen)return;
    pendingPlanOpen=true;
    try {
      window.__showTab("match");
      if((S.stage==="live" || room) && !confirm("Open this recommendation as a new local plan? Your existing shared match will be left unchanged.")){handoff.clear();return;}
      const next=M.fromPlan(plan,crypto.randomUUID());
      const who=await chooseIdentity(Object.keys(plan.roles));
      if(!who){handoff.clear();return;}
      if(room)leaveRoom(true);
      me=who;store.set("squad-me",me);$("#me").value=me;
      S=next;persist();handoff.clear();previousScan=null;renderRoom();render();
      toast("Plan loaded. Edit lanes and heroes, then start the match.");
    } catch(e){toast(e.message);handoff.clear();}
    finally{pendingPlanOpen=false;}
  }
  async function startMatch() {
    try {
      if(!Object.values(S.setup.ours).some(p=>p.who===me)) {
        const who=await chooseIdentity(Object.values(S.setup.ours).map(p=>p.who).filter(Boolean));
        if(!who)return;me=who;store.set("squad-me",me);$("#me").value=me;
      }
      const next=M.start(S,me,Date.now());
      commit([{path:["stage"],value:next.stage},{path:["clock"],value:next.clock}]);
      if(wake.supported && store.get("squad-wake",null)!==false)wake.enable();
    }catch(e){toast(e.message);}
  }
  function renderLifecycle() {
    const issues=M.validateSetup(S.setup), el=$("#lifecycle");
    el.innerHTML=`${previousScan?'<button type="button" class="chip ghost" id="undo-scan">Undo last scan</button>':""}<b>${S.stage==="live"?"Match in progress":S.stage==="finished"?"Match finished":S.stage==="ready"?"Ready to play":"Pre-match plan"}</b>
      <p class="note">${S.stage==="live"?"Update your observations below as the match changes.":"Edit lanes, heroes and enemy picks before starting. Sharing a plan does not start the clock."}</p>
      ${issues.length?`<p class="warn">${issues.map(esc).join(" ")}</p>`:""}
      ${S.stage==="draft"?'<button type="button" class="chip" id="plan-ready">Mark ready</button>':""}
      ${S.stage==="live"?'<button type="button" class="chip" id="match-finish">Finish match</button>':""}`;
    const undo=$("#undo-scan");if(undo)undo.onclick=()=>{const old=previousScan;if(Object.entries(old.after).some(([k,value])=>JSON.stringify(S[k])!==JSON.stringify(value)))return toast("Match changed since this scan. Correct the current values instead of undoing newer edits.");previousScan=null;commit(Object.entries(old.before).map(([k,value])=>({path:[k],value})),true);};
    const ready=$("#plan-ready");if(ready)ready.onclick=()=>{if(issues.length)return toast(issues.join(" "));if(!Object.values(S.setup.ours).some(p=>p.who&&p.hero))return toast("Assign at least one player and hero.");setPath(["stage"],"ready");};
    const finish=$("#match-finish");if(finish)finish.onclick=()=>commit([{path:["stage"],value:"finished"},{path:["finishedAt"],value:Date.now()}]);
  }
  const OBJECTIVES=[{key:"fangtooth",label:"Fangtooth"},{key:"orb",label:"Orb Prime"},{key:"shaper",label:"Shaper"}];
  function nextObjective(now) {
    if(now==null)return null;
    return OBJECTIVES.map(o=>({label:o.label,t:S.objectives[o.key]?.respawnAt})).filter(o=>Number.isFinite(o.t)&&o.t>now).sort((a,b)=>a.t-b.t)[0]||null;
  }
  function recordObjective(key,kind,remaining,source="manual",at=clockSec()) {
    try {
      const event=M.objectiveEvent(kind,at,remaining,source,me);
      event.previous=S.objectives[key]?{...S.objectives[key],previous:undefined}:null;
      setPath(["objectives",key],event);
    }catch(e){toast(e.message);}
  }
  function renderObjectives() {
    const el=$("#objectives"), now=clockSec();
    if(el.contains(document.activeElement))return;
    el.innerHTML=`<p class="note">Record a visible countdown or a confirmed observation. Respawn periods vary by patch; no timer is guessed from a missing icon.</p>`+OBJECTIVES.map(o=>{
      const event=S.objectives[o.key], st=M.objectiveStatus(event,now);
      return `<div class="objective-row"><b>${o.label}</b> · ${esc(st.text)} ${st.remaining==null?"":`<strong>${fmt(st.remaining)}</strong>`}
        <div class="note">${event?`${esc(event.source)} · observed ${fmt(event.at)} by ${esc(label(event.who||"guest"))}`:"No confirmed observation"}</div>
        <button type="button" class="chip" data-available="${o.key}">Available</button>
        <button type="button" class="chip" data-taken="${o.key}">Taken now</button>
        <input aria-label="${o.label} countdown" data-time="${o.key}" placeholder="m:ss" inputmode="numeric">
        <button type="button" class="chip" data-countdown="${o.key}">Set countdown</button>
        ${event?`<button type="button" class="chip ghost" data-undo-objective="${o.key}">Undo</button>`:""}</div>`;
    }).join("");
    el.querySelectorAll("[data-available]").forEach(b=>b.onclick=()=>recordObjective(b.dataset.available,"available",null));
    el.querySelectorAll("[data-taken]").forEach(b=>b.onclick=()=>recordObjective(b.dataset.taken,"defeated",null));
    el.querySelectorAll("[data-countdown]").forEach(b=>b.onclick=()=>{const key=b.dataset.countdown,sec=M.parseTime(el.querySelector(`[data-time="${key}"]`).value);if(sec==null)return toast("Enter a countdown as m:ss.");recordObjective(key,"countdown",sec);});
    el.querySelectorAll("[data-undo-objective]").forEach(b=>b.onclick=()=>setPath(["objectives",b.dataset.undoObjective],S.objectives[b.dataset.undoObjective]?.previous||null));
  }
  async function preparePhoto(file,reader) {
    if(scanBusy)return toast("Wait for the current scan to finish.");
    try {
      const img=await createImageBitmap(file),dialog=document.createElement("dialog");
      dialog.setAttribute("aria-label","Prepare screen photo");
      dialog.innerHTML='<h3>Straighten the screen</h3><p>For an angled photo, tap the four screen corners inside the bezel: top left, top right, bottom right, bottom left.</p><canvas id="photo-corners" style="width:100%;height:auto;touch-action:none"></canvas><p id="photo-instruction" role="status">Tap top left.</p><button class="chip" id="photo-reset">Reset corners</button><button class="chip cta" id="photo-correct">Straighten and scan</button><button class="chip" id="photo-original">Scan original</button><button class="chip" id="photo-cancel">Cancel</button>';
      document.body.append(dialog);dialog.showModal();const c=dialog.querySelector("canvas");c.width=img.width;c.height=img.height;const g=c.getContext("2d");let points=[];
      const draw=()=>{g.drawImage(img,0,0);g.fillStyle="#ffdf52";g.strokeStyle="#ffdf52";g.lineWidth=Math.max(3,c.width/300);g.beginPath();points.forEach((p,i)=>{const x=p.x*c.width,y=p.y*c.height;i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();points.forEach(p=>{g.beginPath();g.arc(p.x*c.width,p.y*c.height,c.width/100,0,Math.PI*2);g.fill();});};draw();
      c.onpointerdown=e=>{if(points.length===4)return;const b=c.getBoundingClientRect();points.push({x:(e.clientX-b.left)/b.width,y:(e.clientY-b.top)/b.height});draw();$("#photo-instruction").textContent=["Tap top left.","Tap top right.","Tap bottom right.","Tap bottom left.","Four corners selected. Straighten and scan."][points.length];};
      const close=()=>{img.close();dialog.close();dialog.remove();};
      $("#photo-reset").onclick=()=>{points=[];draw();$("#photo-instruction").textContent="Tap top left.";};
      $("#photo-cancel").onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
      $("#photo-original").onclick=()=>{close();exclusiveScan(()=>reader(file));};
      $("#photo-correct").onclick=()=>{try{const corrected=window.PhotoPrep.rectify(img,points);corrected._originalSource=file;close();exclusiveScan(()=>reader(corrected));}catch(e){toast(e.message);}};
    }catch(e){toast("Couldn't open photo: "+e.message);}
  }
  async function exclusiveScan(fn) {
    if(scanBusy)return toast("Wait for the current scan to finish.");
    scanBusy=true;try{await fn();}catch(e){toast(e.message);}finally{scanBusy=false;}
  }
  function reviewSetup(setup,issues) {
    const reviewedVersion=room?.version;
    const el=$("#scan-review");el.hidden=false;
    el.innerHTML=`<h3>Review loading screen</h3><p class="note">${esc((issues||[]).join(" "))} Unread slots keep your existing choices.</p>`+ROLES.map(role=>`<div class="review-grid"><b>${roleName(role)}</b>${["ours","theirs"].map(side=>`<label>${side==="ours"?"Your team":"Enemy"}<select data-side="${side}" data-role="${role}"><option value="">Unknown</option>${A.heroes.map(h=>`<option value="${esc(h.slug)}" ${setup[side][role]?.hero===h.slug?"selected":""}>${esc(h.name)}</option>`).join("")}</select></label>`).join("")}</div>`).join("")+`<button class="chip cta" id="scan-apply">Apply scan</button><button class="chip" id="scan-cancel">Cancel</button>`;
    $("#scan-cancel").onclick=()=>el.hidden=true;
    $("#scan-apply").onclick=()=>{
      el.querySelectorAll("select").forEach(x=>{setup[x.dataset.side][x.dataset.role]={...setup[x.dataset.side][x.dataset.role],hero:x.value};});
      const issues=M.validateSetup(setup);if(issues.length)return toast(issues.join(" "));
      previousScan={before:{setup:M.clone(S.setup)},after:{setup:M.clone(setup)}};commit([{path:["setup"],value:setup}],reviewedVersion ?? true);el.hidden=true;
    };
  }
  function reviewBoard(board,issues) {
    const reviewedVersion=room?.version;
    const el=$("#scan-review");el.hidden=false;
    el.innerHTML=`<h3>Review scoreboard</h3><p class="note">${esc((issues||[]).join(" "))} Check uncertain numbers; blank means unknown.</p><div class="scroll"><table class="scan-table"><thead><tr><th>Side / lane</th><th>Hero</th>${["lvl","k","d","a","gold"].map(k=>`<th>${k}</th>`).join("")}</tr></thead><tbody>`+["ours","theirs"].flatMap(side=>board[side].map((row,i)=>`<tr><td>${side==="ours"?"Us":"Enemy"} · ${roleName(ROLES[i])}</td><td><select data-side="${side}" data-row="${i}" data-field="hero"><option value="">Unknown</option>${A.heroes.map(h=>`<option value="${esc(h.slug)}" ${row.hero===h.slug?"selected":""}>${esc(h.name)}</option>`).join("")}</select></td>${["lvl","k","d","a","gold"].map(k=>`<td><input class="${row.alternatives?.[k]?"uncertain":""}" title="${row.alternatives?.[k]?esc("Readings disagree: "+row.alternatives[k].join(" or ")):"Verify against photo"}" type="number" min="0" aria-label="${side} ${ROLES[i]} ${k}" data-side="${side}" data-row="${i}" data-field="${k}" value="${row[k]??""}"></td>`).join("")}</tr>`)).join("")+`</tbody></table></div><button class="chip cta" id="scan-apply">Apply scan</button><button class="chip" id="scan-cancel">Cancel</button>`;
    $("#scan-cancel").onclick=()=>el.hidden=true;
    $("#scan-apply").onclick=()=>{
      try {
        el.querySelectorAll("[data-field]").forEach(x=>board[x.dataset.side][+x.dataset.row][x.dataset.field]=x.dataset.field==="hero"?(x.value||null):(x.value===""?null:Number(x.value)));
        M.validateBoard(board);
        const setup=M.clone(S.setup),live=M.clone(S.live),st=E.boardState(board,setup,A.T);
        for(const side of ["ours","theirs"])ROLES.forEach((r,i)=>{if(board[side][i].hero)setup[side][r]={...setup[side][r],hero:board[side][i].hero};});
        const errors=M.validateSetup(setup);if(errors.length)throw new Error(errors.join(" "));
        ROLES.forEach((r,i)=>{const who=setup.ours[r]?.who;if(who&&board.ours[i].d!=null)live[who]={...live[who],deaths:board.ours[i].d};});
        for(const f of st.fed)setup.theirs[f.role]={...setup.theirs[f.role],fed:true};
        previousScan={before:{setup:M.clone(S.setup),live:M.clone(S.live),board:M.clone(S.board)},after:{setup:M.clone(setup),live:M.clone(live),board:M.clone(board)}};
        commit([{path:["setup"],value:setup},{path:["live"],value:live},{path:["board"],value:board}],reviewedVersion ?? true);el.hidden=true;
        toast("Confirmed scoreboard applied.");
      }catch(e){toast(e.message);}
    };
  }
  async function openMap(file) {
    if(clockSec()==null)return toast("Start the match clock before scanning a countdown.");
    const observedAt=clockSec(),el=$("#map-review");el.hidden=false;
    el.innerHTML='<h3>Scan a minimap countdown</h3><p>Drag a box tightly around one visible objective timer. Select its objective, check the readout, then apply.</p><canvas id="map-canvas"></canvas><label>Objective<select id="map-objective">'+OBJECTIVES.map(o=>`<option value="${o.key}">${o.label}</option>`).join("")+'</select></label><button class="chip" id="map-read">Read selected timer</button><label>Match time in screenshot<input id="map-observed" placeholder="m:ss" value="'+fmt(observedAt)+'"></label><label>Confirmed countdown<input id="map-time" placeholder="m:ss"></label><p id="map-message" role="status"></p><button class="chip cta" id="map-apply">Apply countdown</button><button class="chip" id="map-cancel">Cancel</button>';
    const image=await createImageBitmap(file),c=$("#map-canvas");c.width=image.width;c.height=image.height;
    const g=c.getContext("2d");let start=null,crop=null;
    const draw=()=>{g.drawImage(image,0,0);if(crop){g.strokeStyle="#ffdc5e";g.lineWidth=Math.max(3,c.width/300);g.strokeRect(crop.x*c.width,crop.y*c.height,crop.w*c.width,crop.h*c.height);}};draw();
    const point=e=>{const r=c.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
    c.onpointerdown=e=>{start=point(e);c.setPointerCapture(e.pointerId);};
    c.onpointermove=e=>{if(!start)return;const end=point(e);crop={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x),h:Math.abs(start.y-end.y)};draw();};
    c.onpointerup=()=>start=null;c.onpointercancel=()=>start=null;
    $("#map-read").onclick=()=>exclusiveScan(async()=>{
      if(!crop?.w||!crop?.h)return toast("Drag a box around the countdown first.");
      $("#map-message").textContent="Reading timer on this device…";
      const hits=await window.MinimapScan.scan(file,crop);
      $("#map-time").value=hits.length===1&&!hits[0].estimated?hits[0].text:"";
      $("#map-message").textContent=hits.length===1&&hits[0].estimated?`The game shows ${hits[0].text} (at least ${Math.floor(hits[0].minSeconds/60)} minutes). Wait for an exact countdown or enter one you can verify.`:hits.length===1?`Read ${hits[0].text}. Verify against the image before applying.`:hits.length?"Multiple times found. Tighten the crop or enter the visible countdown.":"No clear countdown found. Enter the visible countdown or try a tighter crop.";
    });
    $("#map-cancel").onclick=()=>{image.close();el.hidden=true;};
    $("#map-apply").onclick=()=>{const seconds=M.parseTime($("#map-time").value);if(seconds==null||seconds>1200)return toast("Enter a valid countdown from 0:00 to 20:00.");const observation=M.parseTime($("#map-observed").value);if(observation==null||observation>clockSec()+10)return toast("Check the match time shown in your screenshot.");recordObjective($("#map-objective").value,"countdown",seconds,"confirmed minimap scan",observation);image.close();el.hidden=true;};
  }
  function renderPostmatch() {
    const el=$("#postmatch");el.hidden=S.stage!=="finished";if(el.hidden)return;
    const selected=Object.values(S.setup.ours).map(p=>p.who).filter(Boolean);
    const candidates=A.allMatches.filter(m=>selected.every(who=>m.players.some(p=>p.squad===who))&&(!S.clock.startedAt||Math.abs(new Date(m.start)-S.clock.startedAt)<7200000)).slice(0,10);
    el.innerHTML='<h3>Post-match review</h3><p class="note">Choose the completed match after the next data refresh. Check the time and heroes before linking.</p><select id="review-match"><option value="">Select completed match</option>'+candidates.map(m=>`<option value="${esc(m.id)}" ${S.reviewMatch===m.id?"selected":""}>${esc(new Date(m.start).toLocaleString())} · ${esc(m.mode)} · ${m.players.filter(p=>selected.includes(p.squad)).map(p=>esc(heroName(p.hero))).join(", ")}</option>`).join("")+'</select><div id="review-content"></div>';
    $("#review-match").onchange=e=>setPath(["reviewMatch"],e.target.value);
    const match=candidates.find(m=>m.id===S.reviewMatch);if(!match)return;
    $("#review-content").innerHTML=selected.map(who=>{const x=window.SquadInsights.review(match,who,A.allMatches);return `<h3>${esc(label(who))} · ${x.win?"Win":"Loss"}</h3><p>${esc(x.focus)}</p><p class="note">${x.games} comparable games · Deaths ${x.deaths} · Wards ${x.wards} · Objective damage ${x.objectives||0} · Tower damage ${x.towers||0}</p>`;}).join("");
  }

  // ---------- init ----------
  function init() {
    const meSel = $("#me");
    meSel.innerHTML = `<option value="">Who are you?</option>` + A.squad.players.map(p => `<option value="${esc(p.key)}" ${p.key === me ? "selected" : ""}>${esc(p.label)}</option>`).join("");
    meSel.onchange = () => { me = meSel.value; store.set("squad-me", me); if (room) room.channel.track({ who: me || "guest", at: Date.now() }); render(); };
    $("#camera-open").onclick = () => {
      if(scanBusy)return toast("Wait for the current scan to finish.");
      window.CameraScan.open("loading",(kind,canvas)=>{
        if(kind==="minimap" || kind==="hud") { canvas.toBlob(blob=>{if(blob)openMap(blob);},"image/png"); }
        else exclusiveScan(()=>kind==="loading"?runScan(canvas):runBoardScan(canvas));
      },toast);
    };
    $("#wake").onchange = e => e.target.checked ? wake.enable() : wake.disable();
    $("#scan-file").onchange = e => { const f = e.target.files?.[0]; if (f) preparePhoto(f,runScan); e.target.value = ""; };
    $("#board-file").onchange = e => { const f = e.target.files?.[0]; if (f) preparePhoto(f,runBoardScan); e.target.value = ""; };
    $("#map-file").onchange = e => { const f=e.target.files?.[0]; if(f) openMap(f); e.target.value=""; };
    $("#match-clear").onclick = () => { if(!confirm("Clear this match for everyone in the room?"))return; replaceState(blank()); previousScan=null; toast("Match cleared"); };
    renderWake(); renderRoom(); render();
    const q = new URLSearchParams(location.search).get("room") || store.get("squad-room", null);
    if (q && !window.SquadHandoff?.pending) joinRoom(q, false);
    if(wake.on)wake.enable();
    clearInterval(tick); tick = setInterval(() => {
      if(document.visibilityState !== "visible") return;
      if(S.clock?.startedAt) { renderLive(); renderObjectives(); if(Math.floor(clockSec())%15===0){renderStrategy();renderBoard();} }
    },1000);
    document.addEventListener("visibilitychange", () => { if(document.visibilityState==="visible") { render(); refreshRoom().then(flush); } });
    document.addEventListener("squad:plan", consumePlan);
    consumePlan();
  }
  init();
})();
