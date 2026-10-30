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
  const num=(x,d=0)=>Number(x).toLocaleString(undefined,{maximumFractionDigits:d});

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
  let tick = null, lastLifecycleStage = null;
  const planningUI=window.SquadPlanning.create({app:A,getState:()=>S,getMe:()=>me,commit,toast,exclusiveScan});
  const optimizerUI=window.SquadOptimizerUI.create({app:A,getState:()=>S,getMe:()=>me,planningUI,toast});
  window.__optimizerResult=()=>optimizerUI.getResult();

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
    const scanStartedAt=Date.now(), scanClock=clockSec(), sessionId=S.id;
    const box = $("#board-progress"); box.hidden = false;
    const bar = box.querySelector("i"), txt = box.querySelector("span");
    try {
      await loadScoreboard();
      const known = {}; // Read heroes again; previous setup may be wrong or from another match.
      const res = await window.ScoreboardScan.scan(file, { heroes: A.heroes, known, itemTemplates:A.itemTemplates, items:A.items, patch:A.itemPatch, onProgress: (m, f) => { txt.textContent = m; bar.style.width = Math.round(f * 100) + "%"; } });
      if (!res.ours.length) { txt.textContent = res.issues.join(" "); return; }
      if(S.id!==sessionId)return toast("Match changed while scanning. Scan again for the current match.");
      const board = { at: file._capturedAt || scanStartedAt, capturedAt:file._capturedAt || null, clock:scanClock, sessionId, ours:res.ours, theirs:res.theirs };
      reviewBoard(board, res.issues);
      txt.textContent = res.issues.length ? res.issues.join(" ") : "Scoreboard read — review heroes, levels and items before updating the plan.";
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
    const setupHTML = `<div class="setup-grid">
      <div class="sg-row sg-head"><div class="sg-h"></div><div class="sg-h">Your team</div><div class="sg-h">Enemy</div></div>
      ${ROLES.map(r => `<div class="sg-row"><div class="sg-role">${esc(roleName(r))}</div>
        <div class="sg-cell">${heroSelect(["setup", "ours", r, "hero"], (o[r] || {}).hero, r)}${whoSelect(["setup", "ours", r, "who"], (o[r] || {}).who)}</div>
        <div class="sg-cell">${heroSelect(["setup", "theirs", r, "hero"], (t[r] || {}).hero, r)}
          <label class="fed"><input type="checkbox" data-path='${JSON.stringify(["setup", "theirs", r, "fed"])}' ${(t[r] || {}).fed ? "checked" : ""}> Ahead</label></div></div>`).join("")}
    </div>
    <p class="note" style="margin:8px 0 0">Tick <b>Ahead</b> when an enemy is snowballing (several kills, items ahead of everyone). They jump to the top of the threat list and their lane is flagged, so the squad plays around them.</p>`;
    for(const container of [$("#setup"),$("#plan-setup")].filter(Boolean)){container.innerHTML=setupHTML;container.querySelectorAll("[data-path]").forEach(el => el.onchange = () => {
      const path = JSON.parse(el.dataset.path), value = el.type === "checkbox" ? el.checked : el.value;
      const setup=M.clone(S.setup); applyChanges({setup},[{path,value}]);
      const issues=M.validateSetup(setup).filter(x=>!x.startsWith("Choose a hero"));
      if(issues.length){toast(issues.join(" "));renderSetup();return;}
      commit([{path,value}, ...(S.stage === "ready" ? [{path:["stage"],value:"draft"}] : [])]);
    });}
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
    renderCounterBuild();
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
    $("#strategy").innerHTML = `${boardCalls ? `<div class="sub-h">Right now · from the scoreboard</div><div class="calls">${boardCalls}</div><div class="sub-h">Game plan · from the lineup</div>` : ""}
      <div class="calls">${plan.calls.map(c => `<div class="call">${esc(c)}</div>`).join("")}</div>
      <div class="sub-h">Lanes</div><div class="lanes">${lanes}</div>
      ${order.length ? `<div class="sub-h">Your squad</div>` : ""}${order.map(m => mine[Object.keys(plan.members).indexOf(m)]).join("")}`;
  }

  function render() { planningUI.render(); renderLifecycle(); renderSetup(); renderLive(); renderBoard(); renderStrategy(); renderObjectives(); renderPostmatch(); }
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
    if(lastLifecycleStage!==S.stage){const details=$("#match-lineup-details");if(details)details.open=S.stage!=="live";lastLifecycleStage=S.stage;}
    el.innerHTML=`<b>${S.stage==="live"?"Match in progress":S.stage==="finished"?"Match finished":S.stage==="ready"?"Ready to play":"Pre-match plan"}</b>
      <p class="note">${S.stage==="live"?"Update your observations below as the match changes.":"Edit lanes, heroes and enemy picks before starting. Sharing a plan does not start the clock."}</p>
      ${issues.length?`<p class="warn">${issues.map(esc).join(" ")}</p>`:""}
      <div class="lifecycle-actions">${S.stage==="draft"?'<button type="button" class="chip" id="plan-ready">Mark ready</button>':""}
      ${S.stage==="live"?'<button type="button" class="chip" id="match-finish">Finish match</button>':""}${previousScan?'<button type="button" class="chip ghost" id="undo-scan">Undo last scan</button>':""}</div>`;
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
    const reviewedVersion=room?.version, reviewedSession=S.id;
    const el=$("#scan-review");el.hidden=false;
    const itemByInput=value=>(A.items||[]).find(it=>it.name.toLowerCase()===value.trim().toLowerCase()||it.label.toLowerCase()===value.trim().toLowerCase());
    const catalog=new Map((A.items||[]).map(it=>[it.name,it]));
    const options=(A.items||[]).filter(it=>it.slot!=="TRINKET"&&it.slot!=="CREST");
    el.innerHTML=`<h3>Review lobby and builds</h3><p class="note">${esc((issues||[]).join(" "))} Verify heroes, levels and the six equipment slots for both teams (exclude crests and trinkets). Gold on the scoreboard is total earned, not spendable.</p>
      <label>Game time shown in photo <input id="board-clock" placeholder="m:ss" inputmode="numeric"></label>
      <label><input type="checkbox" id="board-now" ${board.capturedAt&&Date.now()-board.capturedAt<90000?"checked":""}> This photo was taken just now</label>
      <p class="note">Enter the screenshot's game time to avoid using an old build as current. If the app clock is not running, explicitly confirm a newly taken photo.</p>
      <datalist id="inventory-catalog">${options.map(it=>`<option value="${esc(it.label)}">${esc(it.name)}</option>`).join("")}</datalist>
      <div class="review-players">`+
      ["ours","theirs"].flatMap(side=>board[side].map((row,i)=>`<article class="review-player"><h4>${side==="ours"?"Your team":"Enemy"} · ${roleName(ROLES[i])}</h4><label>Hero<select data-side="${side}" data-row="${i}" data-field="hero"><option value="">Unknown</option>${A.heroes.map(h=>`<option value="${esc(h.slug)}" ${row.hero===h.slug?"selected":""}>${esc(h.name)}</option>`).join("")}</select></label>${side==="ours"?`<label>Player<select data-player-row="${i}" aria-label="Player in ${roleName(ROLES[i])}"><option value="">Other teammate</option>${A.squad.players.map(p=>`<option value="${esc(p.key)}" ${S.setup.ours[ROLES[i]]?.who===p.key?"selected":""}>${esc(p.label)}</option>`).join("")}</select></label>`:""}<div class="review-stats">${["lvl","k","d","a","gold"].map(k=>`<label>${({lvl:"Level",k:"Kills",d:"Deaths",a:"Assists",gold:"Total gold"})[k]}<input class="${row.alternatives?.[k]?"uncertain":""}" title="${row.alternatives?.[k]?esc("Readings disagree: "+row.alternatives[k].join(" or ")):"Verify against photo"}" type="number" min="0" aria-label="${side} ${ROLES[i]} ${k}" data-side="${side}" data-row="${i}" data-field="${k}" value="${row[k]??""}"></label>`).join("")}</div>
        <details class="inventory-review" data-inventory="${side}-${i}"><summary>Review equipment · ${(row.items||[]).filter(Boolean).length} suggested reads</summary>
        <div class="inventory-slots">${Array.from({length:6},(_,j)=>`<label>Slot ${j+1}${row.itemPreviews?.[j]?`<img class="item-crop" alt="Item slot ${j+1} from photo" src="${esc(row.itemPreviews[j])}">`:""}<input list="inventory-catalog" data-item-side="${side}" data-item-row="${i}" data-item-slot="${j}" aria-label="${side} ${ROLES[i]} item ${j+1}" placeholder="Unknown / empty" value="${esc(catalog.get(row.items?.[j])?.label||"")}"></label>`).join("")}</div>
        <label><input type="checkbox" data-confirm-side="${side}" data-confirm-row="${i}"> I checked these item names</label>
        <label><input type="checkbox" data-complete-side="${side}" data-complete-row="${i}"> All six slots are visible; blank slots are empty</label>
        ${side==="ours"?`<label>Current spendable gold (optional, from your HUD)<input type="number" min="0" max="99999" data-current-gold="${i}" placeholder="Unknown"></label>`:""}
        </details></article>`)).join("")+`</div><button class="chip cta" id="scan-apply">Apply lobby snapshot</button><button class="chip" id="scan-cancel">Cancel</button>`;
    $("#scan-cancel").onclick=()=>el.hidden=true;
    $("#scan-apply").onclick=()=>{
      try {
        if(S.id!==reviewedSession)throw new Error("Match changed. Scan again for the current match.");
        const pictureClock=M.parseTime($("#board-clock").value);
        if(pictureClock!=null&&S.clock.startedAt){
          if(pictureClock>clockSec()+10)throw new Error("Screenshot time is ahead of your app clock. Adjust the clock first.");
          board.clock=pictureClock;board.at=S.clock.startedAt+pictureClock*1000;
        }else if($("#board-now").checked){board.at=board.capturedAt||board.at;board.clock=board.clock??clockSec();}
        else throw new Error("Enter the screenshot game time or confirm the photo was taken just now.");
        el.querySelectorAll("[data-field]").forEach(x=>board[x.dataset.side][+x.dataset.row][x.dataset.field]=x.dataset.field==="hero"?(x.value||null):(x.value===""?null:Number(x.value)));
        for(const side of ["ours","theirs"])for(let i=0;i<5;i++){
          const row=board[side][i];row.items=[];
          for(const input of el.querySelectorAll(`[data-item-side="${side}"][data-item-row="${i}"]`)){
            const it=input.value.trim()?itemByInput(input.value):null;
            if(it&&["CREST","TRINKET"].includes(it.slot))throw new Error("Use equipment items here; crests and trinkets are separate slots.");
            if(input.value.trim()&&!it)throw new Error(`Choose a catalog item for ${side} ${roleName(ROLES[i])}, slot ${+input.dataset.itemSlot+1}.`);
            row.items.push(it?.name||null);
          }
          row.inventoryConfirmed=el.querySelector(`[data-confirm-side="${side}"][data-confirm-row="${i}"]`).checked;
          row.inventoryComplete=row.inventoryConfirmed&&el.querySelector(`[data-complete-side="${side}"][data-complete-row="${i}"]`).checked;
          row.inventoryAt=board.at;row.role=ROLES[i];
          if(side==="ours"){const value=el.querySelector(`[data-current-gold="${i}"]`).value;row.currentGold=value===""?null:Number(value);}
          delete row.itemPreviews;delete row.itemCandidates; // Images and descriptors never enter shared state.
        }
        M.validateBoard(board,{items:A.items,heroes:A.heroes,sessionId:S.id});
        const setup=M.clone(S.setup),live=M.clone(S.live),st=E.boardState(board,setup,A.T);
        for(const side of ["ours","theirs"])ROLES.forEach((r,i)=>{if(board[side][i].hero)setup[side][r]={...setup[side][r],hero:board[side][i].hero};});
        ROLES.forEach((r,i)=>{setup.ours[r]={...setup.ours[r],who:el.querySelector(`[data-player-row="${i}"]`).value};});
        const errors=M.validateSetup(setup);if(errors.length)throw new Error(errors.join(" "));
        ROLES.forEach((r,i)=>{const who=setup.ours[r]?.who;if(who&&board.ours[i].d!=null)live[who]={...live[who],deaths:board.ours[i].d};});
        for(const f of st.fed)setup.theirs[f.role]={...setup.theirs[f.role],fed:true};
        previousScan={before:{setup:M.clone(S.setup),live:M.clone(S.live),board:M.clone(S.board)},after:{setup:M.clone(setup),live:M.clone(live),board:M.clone(board)}};
        commit([{path:["setup"],value:setup},{path:["live"],value:live},{path:["board"],value:board}],reviewedVersion ?? true);el.hidden=true;
        toast("Lobby snapshot applied. Build advice updated for your squad.");
      }catch(e){toast(e.message);}
    };
  }
  function renderCounterBuild() {
    optimizerUI.render();
    const el=$('#counterbuild');if(!el)return;
    const board=S.board?.sessionId===S.id?S.board:null;
    const plan=window.CounterBuild.plan({items:A.items,heroes:A.heroes,matches:A.ctx.matches,setup:S.setup,board,patchReview:A.patchReview,buildPlans:S.buildPlans,pivotIntents:S.pivotIntents,patch:A.itemPatch,sessionId:S.id});
    planningUI.renderTeam();
    const key=JSON.stringify([board,S.setup,S.buildPlans,S.pivotIntents,me,A.patchReview,plan.status,A.ctx.matches.length]);
    const age=board?Math.max(0,Math.floor((Date.now()-board.at)/1000)):null;
    const ageText=age==null?'Review a scoreboard and the current inventories to adapt your next purchase.':`Snapshot ${Math.floor(age/60)}:${String(age%60).padStart(2,'0')} ago · ${plan.status==='stale'?'Rescan needed':'Reviewed observations'}`;
    if(el._counterKey===key){const status=el.querySelector('#counter-age');if(status&&status.textContent!==ageText)status.textContent=ageText;return;}
    el._counterKey=key;
    const opened=new Set([...el.querySelectorAll('details[open][data-section]')].map(d=>d.dataset.section)),choices=new Map();
    const rolePurpose={CARRY:'protect your damage uptime while you fight from range',SUPPORT:'stay alive while protecting your teammates',JUNGLE:'stay healthy enough to contest objectives',OFFLANE:'stay in the frontline when you rotate',MIDLANE:'keep casting instead of being forced out of the fight'};
    const answerText={magical:'Add magical armor to reduce the spell pressure you take',physical:'Add physical armor against their physical damage',healing:'Coordinate anti-heal to answer their sustain',shielding:'Coordinate anti-shield coverage',physicalArmor:'Add penetration or shred for your physical damage',magicalArmor:'Add penetration or shred for your magical damage',health:'Consider damage that answers high-health builds',crit:'Consider defense against critical damage',burst:'Consider a defensive response to their burst'};
    const threatPattern={magical:'magical-power pressure',physical:'physical-power pressure',healing:'healing or lifesteal',shielding:'shielding',physicalArmor:'stacked physical armor',magicalArmor:'stacked magical armor',health:'high health',crit:'critical-strike damage',burst:'burst-oriented effects'};
    function needView(p,need,index){const featured=plan.threats.find(t=>need.targets.includes(t.hero)),ownRow=board?.ours?.[ROLES.indexOf(p.role)],enemyRow=board?.theirs?.find(r=>r.hero===featured?.hero),gap=Number.isFinite(ownRow?.lvl)&&Number.isFinite(enemyRow?.lvl)?enemyRow.lvl-ownRow.lvl:null;
      const lead=featured?`${heroName(featured.hero)}${gap>0?` is ${gap} level${gap===1?'':'s'} ahead of ${heroName(p.hero)}`:' has a relevant confirmed item build'}. `:'';
      const intro=lead+`Their observed items suggest ${threatPattern[need.key]||'a relevant item pattern'}. That can affect rotations and objective fights across the lobby. ${answerText[need.key]||'Adapt to the observed build'} so you can ${rolePurpose[p.role]||'carry out your role'}.`;
      const base=window.BuildPlans.getBaseline(planningUI.context(p.who)),reviewed=base.status==='ready'?base.plan:null;
      const body=`<div class="need-context"><h4>${esc(featured?heroName(featured.hero)+' matters beyond your lane':'Adapt to the confirmed lobby')}</h4><p>${esc(intro)}</p><p class="note">Estimated pressure from reviewed items and levels, not measured incoming damage.</p>${reviewed?`<p class="baseline-summary">Your plan: <b>${esc(planningUI.itemName(reviewed.nextItem))}</b> next</p>`:''}<button class="text-button" type="button" data-review-build="${esc(p.who)}">${reviewed?'Review starting build':'Add your starting build'} →</button></div><div class="need-heading"><h4>${need.alternatives.length} ranked option${need.alternatives.length===1?'':'s'} · ${esc(need.answer)}</h4><p class="note">Choose one direction for your next item slot. Rankings use catalogue signals and fit; check passive details in the shop.</p></div><ol class="counter-purchases">${need.alternatives.map((rec,i)=>{const choiceKey=p.who+'-'+index+'-'+i;choices.set(choiceKey,{who:p.who,rec});const action=rec.action==='consider-swap'?'Full inventory · evaluate a later swap':rec.action==='verify-inventory'?'Verify unread slots before buying':rec.affordable===true?'Affordable with confirmed current gold':rec.affordable===false?'Save toward this item':'Check shop cost and current budget';return `<li><div class="counter-item-head"><span class="counter-rank">${i+1}</span>${planningUI.icon(rec.item,52)}<div><h4>${esc(rec.item.label)}</h4><span>${num(rec.fullCost)}g full cost</span></div></div><p class="option-benefit">${esc(rec.fitExplanation)}</p>${reviewed?`<p class="pivot-comparison">${esc(rec.baselineComparison.description)}</p>`:''}<details data-section="item-${esc(choiceKey)}"><summary>Components, tradeoff &amp; evidence</summary><p>${esc(rec.tradeoff)}</p>${rec.recipe.length?`<div class="recipe-list">${rec.recipe.map(it=>`<span>${planningUI.icon(A.items.find(i=>i.name===it.name),24)}${esc(it.label)}${it.owned?' · owned':''}</span>`).join('')}</div>`:''}<p>${rec.reasons.map(esc).join(' ')}</p><p class="note">${esc(action)}. Component upgrade costs are checked in the shop.</p></details><button class="pivot-choice ${rec.selectedIntent?'selected':''}" type="button" data-choose-pivot="${esc(choiceKey)}" aria-pressed="${!!rec.selectedIntent}">${rec.selectedIntent?'✓ Planned pivot · purchase unconfirmed':p.who===me?'I plan to pivot to this':'Plan this for '+esc(label(p.who))}</button><p class="note">Answers ${rec.targets.map(heroName).map(esc).join(', ')} · ${rec.confidence==='observed'?'Confirmed inventory evidence':'Incomplete inventory evidence'}</p></li>`;}).join('')}</ol>`;
      return index===0?body:`<details class="additional-need" data-section="need-${esc(p.who)}-${esc(need.key)}"><summary>Also consider · ${esc(need.answer)}</summary>${body}</details>`;
    }
    const players=plan.players.slice().sort((a,b)=>(b.who===me)-(a.who===me)).map(p=>{const body=`<article class="counter-player ${p.who===me?'mine':''}"><div class="counter-player-title"><div><p class="eyebrow">${esc(label(p.who))}</p><h3>${esc(heroName(p.hero))} · ${esc(roleName(p.role))}</h3></div></div>${p.needs.map((n,i)=>needView(p,n,i)).join('')}${p.guidance.map(g=>`<p class="guidance">${esc(g)}</p>`).join('')}${p.ownedAnswers.length?`<details data-section="owned-${esc(p.who)}"><summary>Current team coverage</summary><p>${p.ownedAnswers.map(esc).join(' · ')}</p></details>`:''}</article>`;return p.who===me?body:`<details data-section="player-${esc(p.who)}"><summary>${esc(label(p.who))} · squad build response</summary>${body}</details>`;}).join('');
    const pr=A.patchReview,patchLabel={reviewed:'Reviewed','initial-baseline':'Initial baseline · review pending','review-required':'Review needed','source-incomplete':'Refresh incomplete'},changed=[...(pr?.changes?.items||[]),...(pr?.changes?.heroes||[])];
    el.innerHTML=`<div class="counter-toolbar"><div><p class="eyebrow">Whole lobby · personal response</p><p id="counter-age" class="note" role="status">${esc(ageText)}</p></div><button class="chip cta" id="counterbuild-scan" type="button">Scan scoreboard / builds</button></div><div class="counter-player-grid">${players||'<p class="empty-advice">Choose your heroes and player assignments in Plan, then confirm a scoreboard for item advice.</p>'}</div>${plan.threats.length?`<details data-section="threats"><summary>Why these responses · lobby threats</summary><ol class="lobby-threats">${plan.threats.map(t=>`<li><b>${esc(heroName(t.hero))}</b> · ${esc(roleName(t.role))}<p>${t.reasons.map(esc).join(' · ')||'Review the current item build.'}</p><div class="threat-items">${t.items.map(n=>`<span>${planningUI.icon(A.items.find(it=>it.name===n),28)}${esc(planningUI.itemName(n))}</span>`).join('')||'Inventory unconfirmed'}</div></li>`).join('')}</ol></details>`:''}<details class="patch-review" data-section="patch"><summary>Patch data · ${esc(patchLabel[pr?.status]||'Unavailable')}</summary><p>${changed.length} catalogue entries changed.</p>${/^https:\/\/(www\.)?predecessorgame\.com\//.test(pr?.officialNotesUrl||'')?`<a href="${esc(pr.officialNotesUrl)}" target="_blank" rel="noopener">Official patch notes</a>`:''}<p class="note">New mechanics require a rule review. The app does not automatically interpret patch-note prose.</p></details>${plan.warnings.length?`<details data-section="coverage" ${['stale','patch-review-required'].includes(plan.status)?'open':''}><summary>Advice coverage · ${plan.status==='patch-review-required'?'patch review needed':plan.status==='stale'?'rescan needed':'check evidence'}</summary>${plan.warnings.map(w=>`<p class="note">${esc(w)}</p>`).join('')}</details>`:''}`;
    el.querySelectorAll('details[data-section]').forEach(d=>{if(opened.has(d.dataset.section))d.open=true;});
    el.querySelector('#counterbuild-scan').onclick=()=>$('#board-file').click();
    el.querySelectorAll('[data-review-build]').forEach(b=>b.onclick=()=>planningUI.open(b.dataset.reviewBuild));
    el.querySelectorAll('[data-choose-pivot]').forEach(b=>b.onclick=()=>{const choice=choices.get(b.dataset.choosePivot);if(choice)planningUI.select(choice.who,choice.rec);});
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
    $("#quick-scan").onclick=()=>{window.__showTab("match");$("#camera-open").click();};
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
      if(S.board && Math.floor(Date.now()/1000)%15===0)renderCounterBuild();
      if(S.clock?.startedAt) { renderLive(); renderObjectives(); if(Math.floor(clockSec())%15===0){renderStrategy();renderBoard();} }
    },1000);
    document.addEventListener("visibilitychange", () => { if(document.visibilityState==="visible") { render(); refreshRoom().then(flush); } });
    document.addEventListener("squad:plan", consumePlan);
    consumePlan();
  }
  init();
})();
