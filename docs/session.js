/* Pure match lifecycle, draft handoff, objective events and scan validation. */
(function(root) {
  "use strict";
  const ROLES = ["OFFLANE", "JUNGLE", "MIDLANE", "SUPPORT", "CARRY"];
  const clone = x => JSON.parse(JSON.stringify(x));
  const blank = () => ({ schema: 2, id: null, stage: "draft", setup: { ours: {}, theirs: {} }, live: {}, clock: {}, board: null, objectives: {}, events: [] });
  function normalize(s) {
    const v = Object.assign(blank(), s && typeof s === "object" ? s : {});
    v.setup = { ours: v.setup?.ours || {}, theirs: v.setup?.theirs || {} };
    v.live ||= {}; v.clock ||= {}; v.objectives ||= {}; v.events ||= [];
    if (!s?.stage && v.clock.startedAt) v.stage = "live";
    return v;
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
  function validateBoard(board) {
    const limits = { lvl: [1,18], k: [0,60], d: [0,60], a: [0,100], gold: [0,99999] };
    for (const side of ["ours", "theirs"]) {
      if (board?.[side]?.length !== 5) throw new Error("Both teams need five scoreboard rows.");
      for (const row of board[side]) for (const [key, [lo, hi]] of Object.entries(limits)) {
        if (row[key] != null && (!Number.isInteger(row[key]) || row[key] < lo || row[key] > hi)) throw new Error(`Check ${key}: ${row[key]}`);
      }
    }
    return board;
  }
  const api = { ROLES, clone, blank, normalize, validateSetup, fromPlan, start, parseTime, objectiveStatus, objectiveEvent, validateBoard };
  root.SquadSession = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
