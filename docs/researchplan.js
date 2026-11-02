/* Matchup strategy from the research catalogue (top leaderboard players' ranked games, data/research.json).
   Pure: plan({research, hero, role, enemy, enemyTeam, heroes, items}) -> findings with sample sizes.
   Correlations, not causes: every claim carries its game count and is shrunk toward the hero's overall result. */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.ResearchPlan = factory(); })(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const MIN = 8;                                  // smallest group we draw a conclusion from
  const rate = a => (a && a[0] ? a[1] / a[0] : null);
  const shrink = (w, n, p0, k) => (w + k * p0) / (n + k);
  const pct = x => Math.round(x * 100) + "%";

  function damageOf(h) {
    const c = h?.classes || [];
    if (c.includes("SHARPSHOOTER")) return "physical";
    if (c.some(x => x === "MAGE" || x === "ENCHANTER")) return "magical";
    const d = (h?.abilities || []).filter(a => !["BASIC", "PASSIVE"].includes(a.key)).map(a => a.menuDescription || "").join(" ");
    return (d.match(/APIconBlue/g) || []).length > (d.match(/ADIconOrange/g) || []).length ? "magical" : "physical";
  }
  function profile(team, heroes) {
    const known = (team || []).filter(Boolean).map(s => heroes.find(h => h.slug === s)).filter(Boolean);
    if (known.length < 3) return null;
    const p = known.filter(h => damageOf(h) === "physical").length, m = known.length - p;
    return p >= known.length - 1 && p >= 3 ? "PHYSICAL" : m >= known.length - 1 && m >= 3 ? "MAGICAL" : "MIXED";
  }

  /* Items top players pick more often in this situation than usual, with their win rate there. */
  function adapted(group, base, items) {
    if (!group || group.games < MIN || !base?.games) return [];
    const name = n => items.find(i => i.name === n)?.label || n;
    return Object.entries(group.early || {}).map(([n, [g, w]]) => {
      const usual = (base.early?.[n]?.[0] || 0) / base.games, here = g / group.games;
      return { item: n, label: name(n), games: g, share: here, usual, ratio: usual ? here / usual : here > 0 ? 9 : 0, winRate: w / g };
    }).filter(x => x.games >= 4 && x.ratio >= 1.4 && x.share >= 0.12).sort((a, b) => b.ratio * b.share - a.ratio * a.share).slice(0, 3);
  }

  function plan({ research: R, hero, role, enemy, enemyTeam = [], heroes = [], items = [] } = {}) {
    const H = R?.heroes?.[hero]?.[role];
    if (!H) return { status: "no-data", findings: [] };
    const heroName = s => heroes.find(h => h.slug === s)?.name || s;
    const base = shrink(H.wins, H.games, 0.5, 20);           // this hero in this lane, any enemy
    const V = enemy ? H.vs?.[enemy] : null;
    const out = { status: "ready", hero, role, enemy: enemy || null, games: H.games, findings: [], counters: [], compCounters: [] };
    const say = (kind, text, games) => out.findings.push({ kind, text, games });

    // 1. Matchup (a mirror is always 50/50 and has no counter items)
    if (enemy && enemy === hero) { say("matchup", `Mirror match vs ${heroName(enemy)}: the lane result decides it.`, V?.games || 0); }
    else if (V && V.games >= MIN) {
      const p = shrink(V.wins, V.games, base, 15);
      out.matchup = { games: V.games, winRate: V.wins / V.games, adjusted: p };
      const verdict = p >= base + 0.04 ? "favoured" : p <= base - 0.04 ? "harder than usual" : "about even";
      say("matchup", `vs ${heroName(enemy)}: ${verdict}. Top players won ${pct(V.wins / V.games)} of ${V.games} games (usual for this hero here: ${pct(H.wins / H.games)}).`, V.games);
    } else if (enemy) say("matchup", `vs ${heroName(enemy)}: only ${V?.games || 0} top-player games, so no matchup verdict yet; the rest uses broader games.`, V?.games || 0);

    // 2. Lane: how much the 10-minute gold lead decides the game, and who usually wins lane
    const RL = R.roles?.[role], laneName = { CARRY: "carries", MIDLANE: "mid laners", OFFLANE: "offlaners", JUNGLE: "junglers", SUPPORT: "supports" }[role] || "this lane";
    const enough = l => l?.ahead?.[0] >= MIN && l?.behind?.[0] >= MIN;
    const [L, scope] = V && V.lane?.leadGames >= MIN && enough(V.lane) ? [V.lane, `vs ${heroName(enemy)}`] : enough(H.lane) ? [H.lane, `for ${heroName(hero)} here`] : enough(RL?.lane) ? [RL.lane, `for ${laneName} in general`] : [null, ""];
    if (L) {
      const up = rate(L.ahead), down = rate(L.behind), swing = up - down;
      out.lane = { lead10: L.lead10, aheadWin: up, behindWin: down, swing, games: L.leadGames };
      const lead = L.lead10 >= 250 ? ` They are usually ahead (+${L.lead10} gold at 10 min): press your lane.` : L.lead10 <= -250 ? ` They usually fall behind (${L.lead10} gold at 10 min): play safe and ask for jungle help.` : "";
      say("lane", swing >= 0.25
        ? `Lane decides a lot ${scope}: 500+ gold ahead at 10 min, top players win ${pct(up)}; behind, ${pct(down)}. Fight for the early lead.${lead}`
        : swing <= 0.12
          ? `Lane matters less ${scope} (${pct(up)} ahead vs ${pct(down)} behind at 10 min). Don't force risky trades; farm and scale.${lead}`
          : `Lane matters ${scope}: ${pct(up)} win when ahead at 10 min, ${pct(down)} when behind.${lead}`, L.leadGames);
    }

    // 3. Game length: short or long games
    const okT = t => t && t[0][0] >= MIN && t[2][0] >= MIN;
    const [T, tscope] = V && okT(V.length) ? [V.length, ""] : okT(H.length) ? [H.length, ""] : okT(RL?.length) ? [RL.length, ` (${laneName} in general)`] : [null, ""];
    if (T) {
      const early = rate(T[0]), late = rate(T[2]);
      out.length = { short: early, long: late, games: [T[0][0], T[1][0], T[2][0]] };
      const spike = H.minutes?.[1];
      if (early - late >= 0.12) say("timing", `Wins short games${tscope}: ${pct(early)} under 25 min vs ${pct(late)} past 35. Group and take objectives once your second item lands${spike ? ` (~${spike} min)` : ""}; end before the enemy scales.`, T[0][0] + T[2][0]);
      else if (late - early >= 0.12) say("timing", `Wins long games${tscope}: ${pct(late)} past 35 min vs ${pct(early)} under 25. Avoid early coin-flip fights, trade objectives, and play for late teamfights.`, T[0][0] + T[2][0]);
      else say("timing", `No strong early/late lean${tscope}: ${pct(early)} win under 25 min, ${pct(late)} past 35. Follow the lane result.`, T[0][0] + T[2][0]);
    }

    // 4. Counter items: what top players switch to against this enemy laner and this enemy team
    out.counters = enemy === hero ? [] : adapted(V, H, items);
    if (out.counters.length) say("counter", `Against ${heroName(enemy)} top players add: ` + out.counters.map(c => `${c.label} (${pct(c.share)} vs ${pct(c.usual)} usually; won ${pct(c.winRate)} of ${c.games})`).join("; ") + ".", V.games);
    const comp = profile(enemyTeam, heroes);
    if (comp) {
      const C = H.vsComp?.[comp];
      out.comp = comp;
      out.compCounters = adapted(C, H, items);
      const word = comp === "PHYSICAL" ? "mostly physical damage" : comp === "MAGICAL" ? "mostly magical damage" : "mixed damage";
      if (out.compCounters.length) say("comp", `Enemy team is ${word}. Top players then add: ` + out.compCounters.map(c => `${c.label} (${pct(c.share)} vs ${pct(c.usual)})`).join("; ") + ".", C.games);
      else if (C) say("comp", `Enemy team is ${word}; top players don't change their items much for it (${C.games} games).`, C.games);
    }
    if (H.kda) out.kda = H.kda;
    return out;
  }

  /* Bonus for buildplans.suggest(): items top players lean toward against this laner or team (0..2). */
  function counterBonus(p) {
    const m = new Map();
    for (const c of [...(p?.counters || []), ...(p?.compCounters || [])]) m.set(c.item, Math.max(m.get(c.item) || 0, Math.min(2, (c.ratio - 1) * c.share * 4)));
    return m;
  }

  /* 5v5 plan from a full lineup (loading screen or scoreboard): every lane's matchup, which side is the
     early team, where to play through and where to cover, and the enemy damage mix. No overall win
     probability is claimed: lane results are not independent and team compositions are too sparse. */
  const ROLES = ["OFFLANE", "JUNGLE", "MIDLANE", "SUPPORT", "CARRY"];
  const LANE = { OFFLANE: "Offlane", JUNGLE: "Jungle", MIDLANE: "Mid", SUPPORT: "Support", CARRY: "Carry" };
  function lean(R, hero, role) {                     // short-game win rate minus long-game win rate
    const t = R?.heroes?.[hero]?.[role]?.length;
    return t && t[0][0] >= MIN && t[2][0] >= MIN ? rate(t[0]) - rate(t[2]) : null;
  }
  const mean = v => { v = v.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  function teamPlan({ research: R, ours = {}, theirs = {}, heroes = [], items = [], me = null } = {}) {
    if (!R?.heroes) return { status: "no-data", findings: [], lanes: [] };
    const heroName = s => heroes.find(h => h.slug === s)?.name || s;
    const both = ROLES.filter(r => ours[r] && theirs[r]);
    if (both.length < 4) return { status: "incomplete", findings: [], lanes: [], known: both.length };
    const enemyTeam = ROLES.map(r => theirs[r]).filter(Boolean);
    const lanes = ROLES.map(role => {
      const hero = ours[role], enemy = theirs[role];
      if (!hero || !enemy) return { role, hero, enemy, verdict: "unknown", games: 0 };
      const p = plan({ research: R, hero, role, enemy, enemyTeam, heroes, items });
      const edge = p.matchup ? p.matchup.adjusted - 0.5 : null;
      const H = R.heroes?.[hero]?.[role];
      return { role, hero, enemy, mine: role === me, games: p.matchup?.games || 0, winRate: p.matchup?.winRate ?? null, edge,
        usual: H ? { games: H.games, winRate: H.wins / H.games } : null,
        verdict: hero === enemy ? "mirror" : edge == null ? "unknown" : edge >= 0.03 ? "favoured" : edge <= -0.03 ? "unfavoured" : "even",
        swing: p.lane?.swing ?? null, counters: p.counters, compCounters: p.compCounters, findings: p.findings };
    });
    const out = { status: "ready", lanes, findings: [] };
    const say = (kind, text) => out.findings.push({ kind, text });
    const fav = lanes.filter(l => l.verdict === "favoured"), unf = lanes.filter(l => l.verdict === "unfavoured"), unknown = lanes.filter(l => l.verdict === "unknown");
    out.counts = { favoured: fav.length, unfavoured: unf.length, even: lanes.filter(l => ["even", "mirror"].includes(l.verdict)).length, unknown: unknown.length };
    say("summary", `Lane matchups: ${fav.length} favour us, ${unf.length} favour them, ${out.counts.even} even` + (unknown.length ? `, ${unknown.length} without enough top-player games` : "") + ".");

    // Early team vs late team
    const us = mean(ROLES.map(r => ours[r] && lean(R, ours[r], r))), them = mean(ROLES.map(r => theirs[r] && lean(R, theirs[r], r)));
    const nUs = ROLES.filter(r => ours[r] && lean(R, ours[r], r) != null).length, nThem = ROLES.filter(r => theirs[r] && lean(R, theirs[r], r) != null).length;
    const spikes = ROLES.map(r => R.heroes?.[ours[r]]?.[r]?.minutes?.[1]).filter(Number.isFinite).sort((a, b) => a - b);
    const spike = spikes.length ? spikes[Math.floor(spikes.length / 2)] : null;
    if (us != null && them != null && nUs >= 3 && nThem >= 3) {
      const d = us - them;
      out.timing = { us, them, diff: d, spike };
      if (d >= 0.06) say("timing", `We are the early team: compared with games past 35 min, our heroes gain ${Math.round(d * 100)} points more win rate in games under 25 min than theirs do. Fight for the first objectives and group once most of us have two items${spike ? ` (~${spike} min)` : ""}; don't let it drag past 35 min.`);
      else if (d <= -0.06) say("timing", `They are the early team (their heroes' short-game edge is ${Math.round(-d * 100)} points bigger than ours). Avoid even fights before${spike ? ` ~${spike} min when most of us have two items` : " your second items"}; trade objectives instead of contesting, and play for late teamfights.`);
      else say("timing", "Neither team leans clearly early or late. Play around whichever lanes win.");
    }

    // Where to play through, where to cover
    const known = lanes.filter(l => l.edge != null && l.verdict !== "mirror").sort((a, b) => b.edge - a.edge);
    const best = known[0], worst = known[known.length - 1];
    if (best && best.verdict === "favoured") say("focus", best.role === "JUNGLE"
      ? `Our jungle is the strongest matchup: ${heroName(best.hero)} vs ${heroName(best.enemy)} won ${pct(best.winRate)} of ${best.games} top-player games. Contest their jungle and early objectives; lanes should be ready to follow.`
      : `Play through ${LANE[best.role]}: ${heroName(best.hero)} vs ${heroName(best.enemy)} won ${pct(best.winRate)} of ${best.games} top-player games.` + (best.swing >= 0.25 ? " Early jungle visits there snowball: a lead in this lane decides a lot." : ""));
    if (worst && worst.verdict === "unfavoured" && worst !== best) say("danger", worst.role === "JUNGLE"
      ? `Our jungle is the hardest matchup: ${heroName(worst.hero)} vs ${heroName(worst.enemy)} won ${pct(worst.winRate)} of ${worst.games}. Avoid early 1v1s and invades; lanes with priority should help cover jungle entrances.`
      : `${LANE[worst.role]} is our hardest lane: ${heroName(worst.hero)} vs ${heroName(worst.enemy)} won ${pct(worst.winRate)} of ${worst.games}. Play it safe, ward, and cover it early rather than forcing fights there.`);

    // Damage mix
    const theirMix = profile(enemyTeam, heroes), ourMix = profile(ROLES.map(r => ours[r]).filter(Boolean), heroes);
    out.mix = { ours: ourMix, theirs: theirMix };
    if (theirMix === "PHYSICAL" || theirMix === "MAGICAL") {
      const kind = theirMix === "PHYSICAL" ? "physical" : "magical", fixes = lanes.flatMap(l => (l.compCounters || []).slice(0, 1).map(c => `${heroName(l.hero)}: ${c.label}`));
      say("damage", `Their damage is mostly ${kind}, so ${kind} armor is worth more for everyone.` + (fixes.length ? ` Top players then add — ${fixes.join("; ")}.` : ""));
    } else if (theirMix) say("damage", "Their damage is mixed; build defence against whoever is fed rather than one damage type.");
    if (ourMix && ourMix !== "MIXED") say("damage", `Our damage is mostly ${ourMix === "PHYSICAL" ? "physical" : "magical"}: expect them to stack ${ourMix === "PHYSICAL" ? "physical" : "magical"} armor; anti-tank items gain value later.`);
    return out;
  }

  return { plan, teamPlan, counterBonus, damageOf, profile };
});
