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

  return { plan, counterBonus, damageOf, profile };
});
