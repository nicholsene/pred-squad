/* Pure match lifecycle, draft handoff, objective events and scan validation. */
(function(root) {
  "use strict";
  const ROLES = ["OFFLANE", "JUNGLE", "MIDLANE", "SUPPORT", "CARRY"];
  const clone = x => JSON.parse(JSON.stringify(x));
  const blank = () => ({ schema: 2, id: typeof crypto!=="undefined" && crypto.randomUUID ? crypto.randomUUID() : "match-"+Date.now()+"-"+Math.random().toString(36).slice(2), stage: "draft", setup: { ours: {}, theirs: {} }, live: {}, clock: {}, board: null, objectives: {}, events: [], buildPlans: {}, pivotIntents: {} });
  function normalize(s) {
    const v = Object.assign(blank(), s && typeof s === "object" ? s : {});
    v.setup = { ours: v.setup?.ours || {}, theirs: v.setup?.theirs || {} };
    v.live ||= {}; v.clock ||= {}; v.objectives ||= {}; v.events ||= [];
    v.buildPlans = v.buildPlans && typeof v.buildPlans === "object" && !Array.isArray(v.buildPlans) ? v.buildPlans : {};
    v.pivotIntents = v.pivotIntents && typeof v.pivotIntents === "object" && !Array.isArray(v.pivotIntents) ? v.pivotIntents : {};
    if (!s?.stage && v.clock.startedAt) v.stage = "live";
    return v;
  }
  function linkBoard(board,previous){
    const next={...board};delete next.previous;
    if(!board?.sessionId||board.sessionId!==previous?.sessionId||!Number.isFinite(board.at)||!Number.isFinite(previous.at)||previous.at>=board.at||board.at-previous.at>300000)return next;
    if(!['ours','theirs'].every(side=>board[side]?.length===5&&previous[side]?.length===5&&board[side].every((r,i)=>r.hero&&r.hero===previous[side][i]?.hero)))return next;
    const snapshot={sessionId:previous.sessionId,at:previous.at};if(Number.isFinite(previous.clock))snapshot.clock=previous.clock;
    for(const side of ['ours','theirs'])snapshot[side]=previous[side].map(r=>Object.fromEntries(['hero','lvl','k','d','a','cs','gold'].filter(f=>f==='hero'||Number.isFinite(r[f])).map(f=>[f,r[f]])));
    next.previous=snapshot;return next;
  }
  function resultOf(s){return [...(s.events||[])].reverse().find(e=>e.type==='match-result'&&e.sessionId===s.id&&['win','loss'].includes(e.outcome))||null;}
  function finish(s,outcome,who,at=Date.now()){
    if(!['win','loss'].includes(outcome))throw Error('Choose win or loss.');
    if(!['live','finished'].includes(s.stage)&&s.board?.sessionId!==s.id)throw Error('Start or scan a match before finishing it.');
    return {...clone(s),stage:'finished',finishedAt:s.stage==='finished'&&Number.isFinite(s.finishedAt)?s.finishedAt:at,events:[...(s.events||[]),{type:'match-result',sessionId:s.id,outcome,who:who||'',at,source:'manual'}]};
  }
  function validateSetup(setup) {
    const issues = [], members = new Set();
    for (const side of ["ours", "theirs"]) {
      const heroes = new Set();
      for (const role of ROLES) {
        const p = setup?.[side]?.[role] || {};
        if (p.hero && heroes.has(p.hero)) issues.push(`Duplicate hero on ${side === "ours" ? "your" : "enemy"} team: ${p.hero}`);
        if (p.hero) heroes.add(p.hero);
        if (side === "ours" && p.who) {
          if (members.has(p.who)) issues.push(`${p.who} is assigned to more than one lane.`);
          members.add(p.who);
          if (!p.hero) issues.push(`Choose a hero for ${p.who}.`);
        }
      }
    }
    return issues;
  }
  function fromPlan(plan, id) {
    const s = blank(); s.id = id; s.recommendation = clone(plan);
    for (const [who, role] of Object.entries(plan.roles || {})) {
      if (!ROLES.includes(role)) throw new Error("Invalid suggested lane");
      s.setup.ours[role] = { who, hero: plan.heroes?.[who] || "" };
    }
    const issues = validateSetup(s.setup); if (issues.length) throw new Error(issues.join(" "));
    return s;
  }
  function observedGameTime(board, sessionId, now) {
    if(!board||board.sessionId!==sessionId||!Number.isFinite(board.at)||board.at>now||
       !Number.isFinite(board.clock)||board.clock<0)return null;
    return board.clock+Math.floor((now-board.at)/1000);
  }
  function chooseLane(setup, who, role) {
    if(!ROLES.includes(role)||typeof who!=="string"||!who)throw new Error("Choose your identity and a valid lane.");
    const next=clone(setup);next.ours ||= {};
    const old=ROLES.find(r=>next.ours[r]?.who===who);
    if(old===role)return next;
    if(old){const player=next.ours[old];next.ours[old]=next.ours[role]||{who:"",hero:""};next.ours[role]=player;}
    else {
      const displaced=next.ours[role];
      if(displaced?.who){const free=ROLES.find(r=>r!==role&&!next.ours[r]?.who&&!next.ours[r]?.hero);if(!free)throw new Error("Review the occupied lineup before choosing this lane.");next.ours[free]=displaced;next.ours[role]={who,hero:""};}
      else next.ours[role]={...(displaced||{}),who};
    }
    const issues=validateSetup(next).filter(s=>!s.startsWith("Choose a hero"));
    if(issues.length)throw new Error(issues.join(" "));
    return next;
  }
  function start(s, me, at) {
    const issues = validateSetup(s.setup);
    if (!me || !Object.values(s.setup.ours).some(p => p.who === me)) issues.push("Choose who you are in this lineup.");
    if (issues.length) throw new Error(issues.join(" "));
    return { ...clone(s), stage: "live", clock: { startedAt: at } };
  }
  function parseTime(text) {
    const m = String(text).trim().match(/^(\d{1,3}):([0-5]\d)$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function objectiveStatus(event, now) {
    if (!event || now == null) return { text: "Unknown", remaining: null };
    if (event.kind === "available") return { text: "Observed available", remaining: null };
    if (Number.isFinite(event.respawnAt)) {
      const remaining = Math.max(0, event.respawnAt - now);
      return { text: remaining ? "Respawns in" : "Expected available — check map", remaining };
    }
    return { text: "Defeated — timer unknown", remaining: null };
  }
  function objectiveEvent(kind, at, delay, source, who) {
    if (!Number.isFinite(at) || at < 0) throw new Error("Start or adjust the match clock first.");
    if (!["available", "defeated", "countdown"].includes(kind)) throw new Error("Invalid objective observation");
    if (kind === "countdown" && (!Number.isFinite(delay) || delay < 0 || delay > 1200)) throw new Error("Check the objective countdown (0–20 minutes).");
    return { kind, at, respawnAt: kind !== "available" && Number.isFinite(delay) ? at + delay : null, source, who, confirmed: true };
  }
  function validateBoard(board, context = {}) {
    const limits = { lvl: [1,18], k: [0,60], d: [0,60], a: [0,100], gold: [0,99999], cs: [0,1000] };
    for (const side of ["ours", "theirs"]) {
      if (board?.[side]?.length !== 5) throw new Error("Both teams need five scoreboard rows.");
      for (const row of board[side]) for (const [key, [lo, hi]] of Object.entries(limits)) {
        if (row[key] != null && (!Number.isInteger(row[key]) || row[key] < lo || row[key] > hi)) throw new Error(`Check ${key}: ${row[key]}`);
      }
    }
    if(context.sessionId!==undefined&&board.sessionId!==context.sessionId)throw new Error("Snapshot belongs to a different match.");
    if(board.at!=null&&(!Number.isFinite(board.at)||board.at>Date.now()+15000))throw new Error("Check the screenshot observation time.");
    const itemIds=context.items?new Set(context.items.map(i=>i.name)):null;
    const heroIds=context.heroes?new Set(context.heroes.map(h=>h.slug)):null;
    for(const side of ["ours","theirs"])for(const row of board[side]){
      if(heroIds&&row.hero&&!heroIds.has(row.hero))throw new Error("Choose a catalog hero.");
      if(row.items!=null&&(!Array.isArray(row.items)||row.items.length>6))throw new Error("Inventory must contain at most six item slots.");
      if(itemIds&&(row.items||[]).some(id=>id!=null&&!itemIds.has(id)))throw new Error("Choose valid catalog items.");
      for(const key of ["inventoryConfirmed","inventoryComplete"])if(row[key]!=null&&typeof row[key]!=="boolean")throw new Error("Confirm inventory status.");
      if(row.currentGold!=null&&(!Number.isInteger(row.currentGold)||row.currentGold<0||row.currentGold>99999))throw new Error("Check current spendable gold.");
    }
    return board;
  }
  const api = { linkBoard, finish, resultOf, ROLES, clone, blank, normalize, validateSetup, fromPlan, observedGameTime, chooseLane, start, parseTime, objectiveStatus, objectiveEvent, validateBoard };
  root.SquadSession = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
