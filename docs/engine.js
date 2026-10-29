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
  function comboReport(matches, selected) {
    const sel = keyOf(selected);
    const games = togetherMatches(matches, sel, true);
    const rows = squadRows(games.map(g => g.match)).filter(r => sel.includes(r.member) && sameSet(r.together, sel));
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
    const { inS, other } = splitSquad(mine, selected);
    const o = record(other), sq = record(inS);
    const otherP = shrink(o.wins, o.games, prior, K_PERSONAL);
    let score = shrink(sq.wins, sq.games, otherP, K_SQUAD);
    let matchup = null, vsOpp = null;
    if (opp) {
      matchup = matchupPrior(meta, hero, role, opp);
      const mineVs = allRows.filter(r => r.member === member && r.hero === hero && r.laneOpponents.some(o => o.hero === opp));
      vsOpp = record(mineVs);
      // matchup shifts the score by how far it sits from the hero's own baseline
      if (matchup) score += (matchup.shrunk - prior);
      if (vsOpp.games) score = shrink(vsOpp.wins, vsOpp.games, score, K_SQUAD);
    }
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
  function suggestLineups(ctx, selected, limit = 3) {
    const sel = keyOf(selected);
    const combo = comboReport(ctx.matches, sel);
    const results = [];
    for (const a of assignments(sel, ROLES)) {
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
    // prefer evidence-backed lineups: break near-ties (within 1 point) by evidence
    results.sort((x, y) => (Math.abs(y.score - x.score) > 0.01 ? y.score - x.score : y.evidence - x.evidence));
    return results.slice(0, limit).map(r => ({
      ...r,
      heroes: Object.fromEntries(sel.map(m => [m, suggestHeroes(ctx, m, r.roles[m], sel, null, 3)])),
    }));
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
    let swap = null;
    if (opp) {
      const alts = suggestHeroes(ctx, member, role, selected, opp, 4).filter(x => x.hero !== hero);
      if (alts.length && alts[0].score - score.score > 0.02) swap = alts[0];
    }
    return { hero: h, role, meta: m, skillOrder, abilities: h ? h.abilities : [], best, worst, score, swap };
  }

  const api = {
    ROLES, ROLE_LABEL, PS5, LANE_OPPONENT_ROLES,
    shrink, squadRows, togetherMatches, summarize, comboReport, record,
    memberRoleScore, heroScore, suggestHeroes, suggestLineups, heroBrief, metaFor,
    context(matches, heroes, meta) { return { matches, heroes, meta, rows: squadRows(matches) }; },
  };
  root.SquadEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
