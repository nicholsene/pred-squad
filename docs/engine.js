/* Squad analysis + recommendation engine. Pure functions; runs in the browser
 * (window.SquadEngine) and in Node (module.exports) for tests.
 *
 * Everything is conditioned on WHO is playing together, WHAT role each plays
 * and WHICH hero. Small samples are shrunk toward a sensible prior so one
 * lucky game never outranks a proven pick:
 *   member+role+hero inside this squad  -> shrunk toward ...
 *   member+role+hero across all games    -> shrunk toward ...
 *   patch meta win rate for hero+role    -> shrunk toward 50%
 */
(function (root) {
  "use strict";

  const ROLES = ["OFFLANE", "JUNGLE", "MIDLANE", "SUPPORT", "CARRY"];
  const ROLE_LABEL = { OFFLANE: "Offlane", JUNGLE: "Jungle", MIDLANE: "Mid", SUPPORT: "Support", CARRY: "Carry" };
  // Same-role opponent is the lane opponent; duo lane also faces the other duo member.
  const LANE_OPPONENT_ROLES = { OFFLANE: ["OFFLANE"], JUNGLE: ["JUNGLE"], MIDLANE: ["MIDLANE"], CARRY: ["CARRY", "SUPPORT"], SUPPORT: ["SUPPORT", "CARRY"] };

  // "K" = how many games of evidence it takes before the observed record counts as much as the prior.
  // MOBA records are noisy, so these are deliberately conservative.
  const K_SQUAD = 8;     // squad-specific record vs the member's general record
  const K_PERSONAL = 10; // member's record vs the patch meta
  const K_META = 200;  // meta win rates are huge samples; this only damps tiny meta samples
  const K_MATCHUP = 60;

  // shrink an observed win rate (wins/games) toward a prior (0-1)
  function shrink(wins, games, prior, k) {
    return (wins + k * prior) / (games + k);
  }

  // ---------------- indexing ----------------
  /** Flatten matches into one row per squad member per match, with team context. */
  function squadRows(matches) {
    const rows = [];
    for (const m of matches) {
      const squadHere = m.players.filter(p => p.squad);
      for (const p of squadHere) {
        const mates = squadHere.filter(q => q.team === p.team);
        const enemies = m.players.filter(q => q.team !== p.team);
        rows.push({
          matchId: m.id, start: m.start, duration: m.duration, mode: m.mode, patch: m.patch,
          member: p.squad, role: p.role, hero: p.hero, team: p.team,
          win: m.winner === p.team,
          together: mates.map(q => q.squad).sort(),               // squad members on my team, incl. me
          lineup: Object.fromEntries(mates.map(q => [q.squad, { role: q.role, hero: q.hero }])),
          laneOpponents: enemies.filter(e => (LANE_OPPONENT_ROLES[p.role] || []).includes(e.role)).map(e => ({ role: e.role, hero: e.hero })),
          s: p,
        });
      }
    }
    return rows;
  }

  const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const keyOf = sel => [...sel].sort();

  /** Matches where exactly the selected squad members played together on one team. */
  function togetherMatches(matches, selected, exact = true) {
    const want = keyOf(selected);
    const out = [];
    for (const m of matches) {
      for (const team of ["DAWN", "DUSK"]) {
        const here = m.players.filter(p => p.squad && p.team === team).map(p => p.squad).sort();
        const ok = exact ? sameSet(here, want) : want.every(w => here.includes(w));
        if (ok && here.length) { out.push({ match: m, team }); break; }
      }
    }
    return out;
  }

  // ---------------- stats ----------------
  function summarize(rows, targets) {
    const t = Object.assign({ maxDeaths: 4, minWards: 4, minObjectiveDamage: 1 }, targets || {});
    const n = rows.length;
    if (!n) return { games: 0 };
    const sum = f => rows.reduce((a, r) => a + (f(r) || 0), 0);
    const wins = rows.filter(r => r.win).length;
    const avg = f => sum(f) / n;
    const rate = f => rows.filter(f).length / n;
    return {
      games: n, wins, losses: n - wins, wr: wins / n,
      k: avg(r => r.s.k), d: avg(r => r.s.d), a: avg(r => r.s.a),
      kda: (sum(r => r.s.k) + sum(r => r.s.a)) / Math.max(1, sum(r => r.s.d)),
      wards: avg(r => r.s.wards), obj: avg(r => r.s.obj), towers: avg(r => r.s.towers),
      heroDmg: avg(r => r.s.heroDmg), unspent: avg(r => Math.max(0, r.s.gold - r.s.spent)),
      csPerMin: sum(r => r.s.cs) / Math.max(1, sum(r => (r.duration || 0) / 60)),
      hitDeaths: rate(r => r.s.d <= t.maxDeaths),
      hitWards: rate(r => r.s.wards >= t.minWards),
      hitObj: rate(r => r.s.obj >= t.minObjectiveDamage),
      hitAll: rate(r => r.s.d <= t.maxDeaths && r.s.wards >= t.minWards && r.s.obj >= t.minObjectiveDamage),
    };
  }

  function groupBy(rows, keyFn) {
    const g = new Map();
    for (const r of rows) { const k = keyFn(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    return g;
  }

  function record(rows) {
    const w = rows.filter(r => r.win).length;
    return { games: rows.length, wins: w, losses: rows.length - w, wr: rows.length ? w / rows.length : null };
  }

  // ---------------- combo record ----------------
  function comboReport(matches, selected, exact = true) {
    const sel = keyOf(selected);
    const games = togetherMatches(matches, sel, exact);
    const rows = squadRows(games.map(g => g.match)).filter(r => sel.includes(r.member) && (exact ? sameSet(r.together, sel) : sel.every(m => r.together.includes(m))));
    const perMatch = groupBy(rows, r => r.matchId);
    const lineups = new Map();
    for (const [, rs] of perMatch) {
      const key = rs.slice().sort((a, b) => a.member.localeCompare(b.member)).map(r => `${r.member}:${r.role}`).join("|");
      if (!lineups.has(key)) lineups.set(key, { key, roles: Object.fromEntries(rs.map(r => [r.member, r.role])), games: 0, wins: 0, heroes: {} });
      const L = lineups.get(key);
      L.games++; if (rs[0].win) L.wins++;
      for (const r of rs) { (L.heroes[r.member] ||= {})[r.hero] = ((L.heroes[r.member] || {})[r.hero] || 0) + 1; }
    }
    const total = record([...perMatch.values()].map(rs => rs[0]));
    return {
      selected: sel, ...total,
      lineups: [...lineups.values()].map(L => ({ ...L, wr: L.wins / L.games })).sort((a, b) => b.games - a.games || b.wr - a.wr),
      rows,
    };
  }

  // ---------------- meta helpers ----------------
  function metaFor(meta, hero, role) {
    return meta && meta.heroes && meta.heroes[hero] && meta.heroes[hero][role] || null;
  }
  function metaPrior(meta, hero, role) {
    const m = metaFor(meta, hero, role);
    if (!m || !m.games) return 0.5;
    return shrink(m.wins, m.games, 0.5, K_META);
  }
  function matchupPrior(meta, hero, role, opp) {
    const m = metaFor(meta, hero, role);
    const mu = m && m.matchups && m.matchups.find(x => x.hero === opp);
    if (!mu || mu.wr == null) return null;
    return { wr: mu.wr / 100, games: mu.games, shrunk: shrink((mu.wr / 100) * mu.games, mu.games, metaPrior(meta, hero, role), K_MATCHUP) };
  }

  // ---------------- scoring ----------------
  /** Score one member in one role (no hero chosen): squad-specific record shrunk toward the member's overall record in that role. */
  // Split a member's rows into games with exactly this squad and everything else,
  // so no game is counted twice when one record is shrunk toward the other.
  function splitSquad(rows, selected) {
    const k = keyOf(selected), inS = [], other = [];
    for (const r of rows) (sameSet(r.together, k) ? inS : other).push(r);
    return { inS, other };
  }

  function memberRoleScore(allRows, member, role, selected) {
    const mine = allRows.filter(r => r.member === member && r.role === role);
    const { inS, other } = splitSquad(mine, selected);
    const o = record(other), inSquad = record(inS);
    const otherP = shrink(o.wins, o.games, 0.5, K_PERSONAL);
    const p = shrink(inSquad.wins, inSquad.games, otherP, K_SQUAD);
    return { score: p, overall: record(mine), inSquad };
  }

  /** Score a member on a hero in a role, optionally against a lane opponent hero. */
  function heroScore(allRows, meta, member, role, hero, selected, opp) {
    const prior = metaPrior(meta, hero, role);
    const mine = allRows.filter(r => r.member === member && r.role === role && r.hero === hero);
    const personal = record(mine);
    const vsRows = opp ? mine.filter(r => r.laneOpponents.some(o => o.hero === opp)) : [];
    const baseline = opp ? mine.filter(r => !r.laneOpponents.some(o => o.hero === opp)) : mine;
    const { inS, other } = splitSquad(baseline, selected);
    const o = record(other), sq = record(splitSquad(mine, selected).inS);
    const otherP = shrink(o.wins, o.games, prior, K_PERSONAL);
    const baseSq = record(inS);
    let score = shrink(baseSq.wins, baseSq.games, otherP, K_SQUAD);
    let matchup = null, vsOpp = null;
    if (opp) {
      matchup = matchupPrior(meta, hero, role, opp);
      vsOpp = record(vsRows);
      if (matchup) score += matchup.shrunk - prior;
      if (vsOpp.games) score = shrink(vsOpp.wins, vsOpp.games, score, K_SQUAD);
    }
    score = Math.max(0, Math.min(1, score));
    return { hero, score, prior, meta: metaFor(meta, hero, role), personal, inSquad: sq, matchup, vsOpp };
  }

  /** Candidate heroes for a member in a role: anything they've played there plus the role's meta heroes. */
  function candidateHeroes(allRows, heroes, meta, member, role) {
    const set = new Set(allRows.filter(r => r.member === member && r.role === role).map(r => r.hero));
    for (const h of heroes) if ((h.roles || []).includes(role) && metaFor(meta, h.slug, role)) set.add(h.slug);
    if (!meta || !meta.heroes) for (const h of heroes) if ((h.roles || []).includes(role)) set.add(h.slug);
    return [...set].filter(Boolean);
  }

  function suggestHeroes(ctx, member, role, selected, opp, limit = 3) {
    const { rows, heroes, meta } = ctx;
    return candidateHeroes(rows, heroes, meta, member, role)
      .map(h => heroScore(rows, meta, member, role, h, selected, opp))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function* assignments(members, roles) {
    if (!members.length) { yield {}; return; }
    const [m, ...rest] = members;
    for (const r of roles) for (const sub of assignments(rest, roles.filter(x => x !== r))) yield { [m]: r, ...sub };
  }

  /** Rank role assignments for the selected squad members. */
  function suggestLineups(ctx, selected, limit = 3, draft = {}) {
    const sel = keyOf(selected);
    const combo = comboReport(ctx.matches, sel);
    if (!sel.length || sel.length > ROLES.length) return [];
    const results = [];
    for (const a of assignments(sel, ROLES)) {
      if (sel.some(m => draft.locks?.[m]?.role && draft.locks[m].role !== a[m])) continue;
      const parts = sel.map(m => ({ member: m, role: a[m], ...memberRoleScore(ctx.rows, m, a[m], sel) }));
      // Each member-role score already includes this squad's games, so the exact-lineup
      // record is shown as evidence and used to break ties, not counted again.
      const score = parts.reduce((s, p) => s + p.score, 0) / parts.length;
      const base = score;
      const lkey = sel.map(m => `${m}:${a[m]}`).join("|");
      const L = combo.lineups.find(x => x.key === lkey);
      const evidence = parts.reduce((s, p) => s + p.inSquad.games + p.overall.games, 0) + (L ? L.games * 2 : 0);
      results.push({ roles: a, score, base, lineupRecord: L ? { games: L.games, wins: L.wins } : null, parts, evidence });
    }
    results.sort((x, y) => y.score - x.score || y.evidence - x.evidence);
    const valid = [];
    for (const r of results) {
      const options = Object.fromEntries(sel.map(m => [m, suggestHeroes(ctx, m, r.roles[m], sel, null, 100)
        .filter(h => !(draft.excluded || []).includes(h.hero) && (!draft.familiar || h.personal.games > 0) && (!draft.locks?.[m]?.hero || h.hero === draft.locks[m].hero))]));
      // Backtrack so each selected player gets a distinct legal hero.
      const chosen = {}, used = new Set();
      function choose(i) {
        if (i === sel.length) return true;
        const m = sel[i];
        for (const h of options[m]) {
          if (used.has(h.hero)) continue;
          used.add(h.hero); chosen[m] = h.hero;
          if (choose(i+1)) return true;
          used.delete(h.hero); delete chosen[m];
        }
        return false;
      }
      if (!choose(0)) continue;
      valid.push({ ...r, chosenHeroes: chosen, heroes: Object.fromEntries(sel.map(m => [m, [options[m].find(h => h.hero === chosen[m]), ...options[m].filter(h => h.hero !== chosen[m])].slice(0,3)])) });
      if (valid.length >= limit) break;
    }
    return valid;
  }

  // ---------------- character brief ----------------
  const PS5 = { BASIC: "R2", PRIMARY: "L1", SECONDARY: "L2", ALTERNATE: "R1", ULTIMATE: "L1+R1", PASSIVE: "—" };

  function heroBrief(ctx, member, role, hero, selected, opp) {
    const h = ctx.heroes.find(x => x.slug === hero);
    const m = metaFor(ctx.meta, hero, role);
    const abilityByKey = Object.fromEntries((h && h.abilities || []).map(a => [a.key, a]));
    const skillOrder = (h && h.skills || []).map((k, i) => ({ level: i + 1, key: k, button: PS5[k], name: (abilityByKey[k] || {}).name || k }));
    const mus = (m && m.matchups || []).filter(x => x.games >= 30 && x.wr != null);
    const best = mus.slice().sort((a, b) => b.wr - a.wr).slice(0, 4);
    const worst = mus.slice().sort((a, b) => a.wr - b.wr).slice(0, 4);
    const score = heroScore(ctx.rows, ctx.meta, member, role, hero, selected, opp);
    let swap = null, laneVs = null;
    if (opp) {
      // any squad member, any hero, in this lane, against this enemy hero
      laneVs = record(ctx.rows.filter(r => r.role === role && r.laneOpponents.some(o => o.hero === opp)));
      const alts = suggestHeroes(ctx, member, role, selected, opp, 4).filter(x => x.hero !== hero);
      if (alts.length && alts[0].score - score.score > 0.02) swap = alts[0];
    }
    return { hero: h, role, meta: m, skillOrder, abilities: h ? h.abilities : [], best, worst, score, swap, laneVs };
  }

  // ---------------- full match plan (10 heroes) ----------------
  // Objective timings: patch 1.17.2 notes (camps 0:20, river 0:30, first Fangtooth 3:30)
  // and in-game loading tips (Fangtooth every 5:00, Orb Prime at 20:00).
  const TIMELINE = [
    { t: 20, label: "Jungle camps spawn" },
    { t: 30, label: "River buff spawns" },
    { t: 210, label: "First Fangtooth" },
    { t: 1200, label: "Orb Prime" },
  ];

  function verdict(p) { return p >= 0.53 ? "Favored" : p <= 0.47 ? "Tough" : "Even"; }

  /**
   * setup = { ours: {ROLE: {hero, who}}, theirs: {ROLE: {hero, fed}} }
   * live  = { member: {deaths, wards, obj} }, clock = seconds since match start (or null)
   */
  function matchPlan(ctx, setup, live, clock, targets) {
    const T = Object.assign({ maxDeaths: 4, minWards: 4 }, targets || {});
    const nm = slug => ((ctx.heroes || []).find(h => h.slug === slug) || {}).name || slug;
    const ours = (setup && setup.ours) || {}, theirs = (setup && setup.theirs) || {};
    const squadHere = ROLES.map(r => ours[r] && ours[r].who).filter(Boolean).sort();
    const lanes = ROLES.map(role => {
      const o = ours[role] || {}, e = theirs[role] || {};
      const oppHeroes = (LANE_OPPONENT_ROLES[role] || []).map(r => (theirs[r] || {}).hero).filter(Boolean);
      const opp = e.hero || null;
      let est = null, ev = {};
      if (o.hero) {
        if (o.who) {
          const s = heroScore(ctx.rows, ctx.meta, o.who, role, o.hero, squadHere.length ? squadHere : [o.who], opp);
          est = s.score; ev = { personal: s.personal, inSquad: s.inSquad, vsOpp: s.vsOpp, matchup: s.matchup, meta: s.meta };
        } else {
          est = metaPrior(ctx.meta, o.hero, role);
          const mu = opp ? matchupPrior(ctx.meta, o.hero, role, opp) : null;
          if (mu) est += mu.shrunk - est;
          ev = { matchup: mu, meta: metaFor(ctx.meta, o.hero, role) };
        }
        if (opp) ev.laneVs = record(ctx.rows.filter(r => r.role === role && r.laneOpponents.some(x => x.hero === opp)));
      }
      return { role, hero: o.hero || null, who: o.who || null, opp, oppHeroes, fed: !!e.fed, est, verdict: est == null ? null : verdict(est), ev };
    });

    // enemy threats: fed first, then strongest meta pick for its role, then squad's worst record against it
    const threats = ROLES.filter(r => theirs[r] && theirs[r].hero).map(role => {
      const hero = theirs[role].hero, m = metaFor(ctx.meta, hero, role);
      const vs = record(ctx.rows.filter(r => r.laneOpponents.some(x => x.hero === hero) || false));
      const score = (theirs[role].fed ? 1 : 0) + (m && m.wr ? (m.wr - 50) / 10 : 0) + (vs.games >= 3 ? (0.5 - vs.wr) : 0);
      return { role, hero, fed: !!theirs[role].fed, metaWr: m ? m.wr : null, vs, score };
    }).sort((a, b) => b.score - a.score);

    const rated = lanes.filter(l => l.est != null && l.role !== "JUNGLE");
    const weakest = rated.slice().sort((a, b) => a.est - b.est)[0] || null;
    const strongest = rated.slice().sort((a, b) => b.est - a.est)[0] || null;
    const jungle = lanes.find(l => l.role === "JUNGLE");

    const calls = [];
    if (jungle && jungle.est != null) {
      if (jungle.verdict === "Tough") calls.push(`Jungle is the tough matchup${jungle.opp ? ` vs ${nm(jungle.opp)}` : ""}: ward both jungle entrances early and don't contest camps 1v1 — give up the camp and clear the other side.`);
      else if (jungle.verdict === "Favored") calls.push(`Jungle is favored${jungle.opp ? ` vs ${nm(jungle.opp)}` : ""}: invade their side early with a laner and take river objectives.`);
    }
    if (weakest && weakest.verdict === "Tough") calls.push(`${ROLE_LABEL[weakest.role]} is our weakest lane — jungler, gank or cover it before 6:00; laner, farm safe under tower.`);
    if (strongest && strongest.verdict === "Favored") calls.push(`${ROLE_LABEL[strongest.role]} is our strongest lane — gank there to snowball, then push its tower after every kill.`);
    const tracked=threats.find(t=>t.fed||Number.isFinite(t.metaWr)&&t.metaWr>50||t.vs.games>=3&&t.vs.wr<.5);
    if(tracked)calls.push(`Threat to track: ${nm(tracked.hero)} (${ROLE_LABEL[tracked.role]})${tracked.fed?" — marked ahead":tracked.metaWr>50?" — patch results favor this pick":" — difficult in your recorded games"}. Watch for their rotations when missing.`);
    else calls.push("Watch missing enemies before extending your lane; current evidence does not identify a leading threat.");
    calls.push("After a won fight, consider a safe objective or tower rather than chasing kills.");

    const now = clock == null ? null : clock;
    const next = now == null ? null : TIMELINE.find(x => x.t > now) || null;

    const members = {};
    for (const l of lanes) if (l.who) {
      const lv = (live && live[l.who]) || {};
      const deaths = Number.isFinite(lv.deaths)?lv.deaths:null, wards=Number.isFinite(lv.wards)?lv.wards:null;
      const rules = [];
      if (deaths != null && deaths >= T.maxDeaths) rules.push({ level: "bad", text: `At ${deaths} deaths — past the limit. Farm under tower, fight only next to the team.` });
      else if (deaths != null && deaths >= T.maxDeaths - 1) rules.push({ level: "warn", text: `At ${deaths} deaths — behind-mode: no solo fights. Say "I'm at ${deaths}" on voice.` });
      if (now != null) {
        const want = Math.min(T.minWards + 2, Math.floor(now / 300));
        if (wards != null && wards < want) rules.push({ level: "warn", text: `Wards ${wards} — about ${want} by now. Place one on your next trip out of base.` });
      }
      if (now != null && now > 240 && lv.obj === false) rules.push({ level: "info", text: "No objective damage yet — join the next Fangtooth when your wave is pushed." });
      members[l.who] = { role: l.role, hero: l.hero, opp: l.opp, rules };
    }

    return { lanes, threats, calls, weakest, strongest, next, timeline: TIMELINE, members, squadHere };
  }

  /* ---------- scoreboard snapshot -> state of the game ----------
     board = { ours: [{role, hero, lvl, k, d, a, gold}], theirs: [...] }  (rows in lane order)
     Returns team totals, per-lane gaps, who is snowballing, and plain calls. */
  function boardState(board, setup, T = {}, nameOf = x => x) {
    if (!board || !board.ours || !board.theirs) return null;
    const sum = (rows, k) => rows.every(r => Number.isFinite(r[k])) ? rows.reduce((a, r) => a + r[k], 0) : null;
    const known = (rows, k) => rows.filter(r => r[k] != null);
    const avg = (rows, k) => { const x = known(rows, k); return x.length ? sum(x, k) / x.length : null; };
    const us = { gold: sum(board.ours, "gold"), kills: sum(board.ours, "k"), lvl: avg(board.ours, "lvl") };
    const them = { gold: sum(board.theirs, "gold"), kills: sum(board.theirs, "k"), lvl: avg(board.theirs, "lvl") };
    // compare averages x5, so one unread value can't flip the result
    const goldKnown = known(board.ours, "gold").length >= 3 && known(board.theirs, "gold").length >= 3;
    const goldDiff = goldKnown ? Math.round(5 * (avg(board.ours, "gold") - avg(board.theirs, "gold"))) : null;
    const late = (us.lvl != null && us.lvl >= 13) || (board.clock != null && board.clock >= 1200);
    const lvlDiff = us.lvl != null && them.lvl != null ? us.lvl - them.lvl : null;
    const lanes = ROLES.map((role, i) => {
      const o = board.ours[i] || {}, e = board.theirs[i] || {};
      const who = ((setup && setup.ours && setup.ours[role]) || {}).who || null;
      return { role, who, hero: o.hero, opp: e.hero, lvlDiff: o.lvl != null && e.lvl != null ? o.lvl - e.lvl : null,
        goldDiff: o.gold != null && e.gold != null ? o.gold - e.gold : null, o, e };
    });
    // an enemy is "ahead" when clearly richer than their team or with a big positive score
    const theirAvgGold = avg(board.theirs, "gold");
    const fed = board.theirs.map((e, i) => ({ role: ROLES[i], hero: e.hero, e,
      ahead: (e.gold != null && theirAvgGold && e.gold >= 1.15 * theirAvgGold) || (e.k != null && e.d != null && e.k >= 5 && e.k >= e.d + 4) }))
      .filter(x => x.ahead);
    const calls = [];
    const k = x => `${(Math.abs(x) / 1000).toFixed(1)}k`;
    if (goldDiff != null) {
      if (goldDiff <= -2500) calls.push({ level: "bad", text: `Behind ${k(goldDiff)} gold${lvlDiff != null && lvlDiff <= -0.5 ? ` and ${Math.abs(lvlDiff).toFixed(1)} levels` : ""}. Don't take even fights: group, ward around your jungle, farm side lanes and only fight on objectives they have to come to.` });
      else if (goldDiff >= 2500) calls.push({ level: "good", text: `Ahead ${k(goldDiff)} gold. Press it: group, take Fangtooth/Orb and push the next tower instead of chasing kills.` });
      else calls.push({ level: "info", text: `Gold is close (${goldDiff >= 0 ? "+" : "−"}${k(goldDiff)}). The next objective fight decides it — be there with vision first.` });
    }
    for (const f of fed) calls.push({ level: "warn", text: `${f.hero ? nameOf(f.hero) : ROLE_LABEL[f.role]} (${ROLE_LABEL[f.role]}) is snowballing (${f.e.k}/${f.e.d}/${f.e.a}${f.e.gold ? `, ${k(f.e.gold)} gold` : ""}). Don't fight them alone — focus them first in team fights.` });
    for (const l of lanes) {
      const who = `${ROLE_LABEL[l.role]}${l.who ? ` (${l.who})` : ""}`;
      if (l.lvlDiff != null && l.lvlDiff <= -2) calls.push({ level: "warn", text: late
        ? `${who} is ${-l.lvlDiff} levels behind ${l.opp ? nameOf(l.opp) : "their laner"} — stay with the team and soak side waves; don't duel.`
        : `${who} is ${-l.lvlDiff} levels behind their laner — soak waves safely and avoid trades until the level gap closes.` });
      else if (l.goldDiff != null && l.goldDiff <= -2500) calls.push({ level: "warn", text: late
        ? `${who} is ${k(l.goldDiff)} gold behind ${l.opp ? nameOf(l.opp) : "their laner"} — don't get caught alone; fight next to your team.`
        : `${who} is ${k(l.goldDiff)} gold behind their laner — needs jungle help or a lane swap.` });
      if (l.lvlDiff != null && l.lvlDiff >= 2) calls.push({ level: "good", text: `${who} is ${l.lvlDiff} levels up — ${l.role === "JUNGLE" ? "invade their camps and gank the lane that's even" : "use the window: dive with the jungler or take their tower"}.` });
    }
    const goldEstimated = goldKnown && (known(board.ours, "gold").length < 5 || known(board.theirs, "gold").length < 5);
    return { us, them, goldDiff, goldEstimated, lvlDiff, lanes, fed, calls, late };
  }

  // Transparent snapshot heuristic, not a fight/win probability. Missing fields
  // contribute no points and never amplify the weights of the remaining fields.
  const LEAD_WEIGHTS = Object.freeze({lvl:35,cs:15,gold:20,k:15,d:10,a:5});
  function laneLead(ours={},theirs={},role) {
    const weights=role==='SUPPORT'?{lvl:35,cs:5,gold:15,k:10,d:20,a:15}:LEAD_WEIGHTS;
    const scales={lvl:3,cs:30,gold:3000,k:5,d:5,a:8},metrics=[];
    for(const field of Object.keys(weights)){
      const a=ours[field],b=theirs[field];
      if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0||field==='lvl'&&(a<1||b<1||a>18||b>18))continue;
      const delta=a-b,contribution=Math.max(-1,Math.min(1,delta/scales[field]))*weights[field]*(field==='d'?-1:1);
      metrics.push({field,delta,weight:weights[field],contribution});
    }
    return {score:metrics.length?metrics.reduce((s,m)=>s+m.contribution,0):null,coverage:metrics.reduce((s,m)=>s+m.weight,0),metrics,weights:{...weights}};
  }
  function liveStrategy(board,setup={},who,{now=Date.now(),clock=null,objectives={},nameOf=x=>x}={}) {
    const roles=ROLES.filter(r=>who&&setup.ours?.[r]?.who===who),mine=roles.length===1?roles[0]:null;
    const matches=board&&ROLES.every((r,i)=>['ours','theirs'].every(s=>!setup[s]?.[r]?.hero||board[s]?.[i]?.hero===setup[s][r].hero));
    const fresh=!!matches&&Number.isFinite(board.at)&&now>=board.at&&now-board.at<=180000;
    const base=mine==='JUNGLE'?'Clear safe camps and look for nearby support; avoid blind invades.':mine==='SUPPORT'?'Protect your carry’s farm, maintain vision and avoid isolated trades.':'Collect safe farm, protect your tower and check missing enemies before extending.';
    if(!fresh)return {fresh:false,role:mine,priority:'Get a current scoreboard',lane:base,team:'Protect towers and collect safe farm until current leads are known.',reason:board?'Snapshot expired or lineup changed.':'No current scoreboard.',lanes:[]};
    const lanes=ROLES.map((role,i)=>({role,ours:board.ours?.[i]||{},theirs:board.theirs?.[i]||{},...laneLead(board.ours?.[i],board.theirs?.[i],role)}));
    const own=lanes.find(l=>l.role===mine),delta=(row,f)=>row?.metrics.find(m=>m.field===f)?.delta??null,ld=delta(own,'lvl'),cs=delta(own,'cs');
    let lane=base,priority='Farm safely and build pressure';
    if(!mine){priority='Choose your identity';lane='Choose who you are to receive your lane’s specific call.';}
    else if((ld!==null&&ld<=-1)||(own?.score!==null&&own?.score<=-12)){
      priority='Stay back and recover';lane=mine==='JUNGLE'?'Clear safe camps and ask teammates to cover entrances; avoid solo contests.':mine==='SUPPORT'?'Stay with your carry, protect safe farm and avoid isolated trades.':'Stay back and farm safely. Avoid solo trades; ask for cover while the gap closes.';
    }else if(ld!==null&&ld>=1&&own.score>=0){
      priority='Use your level lead';lane=mine==='JUNGLE'?'Use your level lead to support a nearby lane; keep an escape route and check enemy positions.':mine==='SUPPORT'?'Apply pressure together with your carry; ward exits before moving forward.':'You outlevel your counterpart. Push safe waves and pressure the tower when enemy positions, health and cooldowns allow.';
    }else if(cs!==null&&cs<=-15&&mine!=='SUPPORT'){priority='Catch up on farm';lane=mine==='JUNGLE'?'Recover your camp clear before forcing another fight.':'Prioritize safe last hits and experience before roaming or forcing a fight.';}
    else if(own?.score>=12&&own.coverage>=35){priority='Convert your measured lead';lane=mine==='SUPPORT'?'Help your carry convert pressure into safe tower damage, then reset together.':'Pressure a safe wave, look for tower damage and reset before you overextend.';}
    const measured=lanes.filter(l=>l.score!==null),mean=measured.length>=3?measured.reduce((s,l)=>s+l.score,0)/measured.length:null;
    let team=mean!==null&&mean<=-8?'Defend towers, recover farm and avoid isolated fights. Set safe vision before contesting.':mean!==null&&mean>=8?'Push safe waves together, then turn pressure into tower damage or a verified objective.':'Keep waves covered, establish vision and regroup before a committed fight.';
    const threats=lanes.filter(l=>Number.isFinite(l.theirs.k)&&Number.isFinite(l.theirs.d)&&l.theirs.k>=5&&l.theirs.k-l.theirs.d>=4).sort((a,b)=>(b.theirs.k-b.theirs.d)-(a.theirs.k-a.theirs.d));
    if(threats.length)team='Respect '+nameOf(threats[0].theirs.hero)+'’s observed kill lead. Cover teammates and avoid fighting this threat alone; protect farm first.';
    const upcoming=Number.isFinite(clock)?Object.entries(objectives).filter(([,e])=>e&&Number.isFinite(e.respawnAt)&&e.respawnAt-clock>0&&e.respawnAt-clock<=60&&!/estimated|heuristic/i.test(e.source||'')).sort((a,b)=>a[1].respawnAt-b[1].respawnAt)[0]:null;
    if(upcoming){const names={fangtooth:'Fangtooth',orb:'Orb Prime',shaper:'Shaper'},name=names[upcoming[0]]||'the objective';team='Prepare safe vision for '+name+' in about '+Math.ceil(upcoming[1].respawnAt-clock)+'s. Cover nearby waves and check the map before committing'+(mean!==null&&mean<0?'; avoid forcing an even fight.':'.');if(!own||ld===null||ld>=0)priority='Prepare the next objective';}
    const reason=!own?'Lane identity is unassigned.':ld===null?'Level comparison unread; using other observed stats.':(ld>0?'Up ':ld<0?'Down ':'Even at ')+Math.abs(ld)+' level'+(Math.abs(ld)===1?'':'s')+' versus the same-role counterpart.';
    return {fresh:true,role:mine,priority,lane,team,reason,lanes,coverage:own?.coverage||0};
  }

  const api = {
    LEAD_WEIGHTS,laneLead,liveStrategy,
    ROLES, ROLE_LABEL, PS5, LANE_OPPONENT_ROLES, TIMELINE, boardState,
    shrink, squadRows, togetherMatches, summarize, comboReport, record,
    memberRoleScore, heroScore, suggestHeroes, suggestLineups, heroBrief, metaFor, matchPlan,
    context(matches, heroes, meta) { return { matches, heroes, meta, rows: squadRows(matches) }; },
  };
  root.SquadEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
