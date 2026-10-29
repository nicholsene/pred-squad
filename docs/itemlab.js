/* Item lab: item value, build profiles, counter matrix and in-game responses.
   Works on data/items.json + data/matches.json (final inventories of all 10 players).
   Browser: window.ItemLab.  Node: require("./itemlab.js"). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ItemLab = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const shrink = (wins, games, prior, k) => (wins + prior * k) / (games + k);
  const has = (it, ...types) => types.includes(it.type);

  /* ---------- gold value of each stat (least squares on component items) ---------- */
  function statPrices(items) {
    const base = items.filter(i => i.cost > 0 && i.slot === "PASSIVE" && ["UNCOMMON", "RARE"].includes(i.rarity) && Object.keys(i.stats).length);
    const stats = [...new Set(base.flatMap(i => Object.keys(i.stats)))];
    const w = Object.fromEntries(stats.map(s => [s, 0]));
    // non-negative least squares on relative error, by coordinate descent
    const pred = i => stats.reduce((a, s) => a + (i.stats[s] || 0) * w[s], 0);
    for (let sweep = 0; sweep < 300; sweep++) {
      for (const s of stats) {
        let g = 0, h = 0;
        for (const i of base) {
          const x = (i.stats[s] || 0) / i.cost; if (!x) continue;
          g += x * (pred(i) / i.cost - 1); h += x * x;
        }
        if (h > 0) w[s] = Math.max(0, w[s] - g / h);
      }
    }
    return w;
  }

  /* ---------- what a set of items does ---------- */
  function profile(names, C) {
    const p = { phys: 0, mag: 0, heal: 0, shield: 0, tank: 0, crit: 0, burst: 0, n: 0, gold: 0,
      antiHeal: 0, antiShield: 0, antiTank: 0, physArmor: 0, magArmor: 0, antiCrit: 0, antiBurst: 0, def: 0 };
    for (const n of names) {
      const it = C[n]; if (!it || it.slot === "TRINKET") continue;
      const s = it.stats || {};
      const core = it.slot !== "CREST" && it.cost >= 2000;
      if (core) { p.n++; p.gold += it.cost; }
      p.phys += s.PHYSICAL_POWER || 0;
      p.mag += s.MAGICAL_POWER || 0;
      p.heal += (s.LIFESTEAL || 0) + (s.MAGICAL_LIFESTEAL || 0) + 1.5 * (s.OMNIVAMP || 0) + (has(it, "SUSTAIN", "REGEN", "SUSTAINED_FIGHTING", "HEALING_AND_SHIELDING") ? 10 : 0);
      p.shield += (s.HEAL_AND_SHIELD_POWER || 0) + (has(it, "SHIELDING", "HEALING_AND_SHIELDING") ? 10 : 0);
      p.tank += (s.HEALTH || 0) / 50 + (s.PHYSICAL_ARMOR || 0) / 5 + (s.MAGICAL_ARMOR || 0) / 5;
      p.crit += s.CRITICAL_CHANCE || 0;
      p.burst += has(it, "BURST", "POKE", "ULTIMATE_DAMAGE", "DAMAGE_AMP") ? 1 : 0;
      p.antiHeal += has(it, "ANTI_HEAL") ? 1 : 0;
      p.antiShield += has(it, "ANTI_SHIELD") ? 1 : 0;
      p.antiTank += has(it, "ANTI_TANK", "PHYSICAL_SHRED", "MAGICAL_SHRED") ? 1 : 0;
      p.physArmor += s.PHYSICAL_ARMOR || 0;
      p.magArmor += (s.MAGICAL_ARMOR || 0) + (has(it, "ANTI_MAGIC") ? 20 : 0);
      p.antiCrit += has(it, "ANTI_CRIT") ? 1 : 0;
      p.antiBurst += has(it, "ANTI_BURST", "SPELL_SHIELD") ? 1 : 0;
      if (core && ((s.HEALTH || 0) + 10 * ((s.PHYSICAL_ARMOR || 0) + (s.MAGICAL_ARMOR || 0)) >= 350)) p.def++;
    }
    return p;
  }
  const add = (a, b) => { const o = { ...a }; for (const k in b) o[k] = (o[k] || 0) + b[k]; return o; };

  /* threats the enemy team can pose, and what answers them */
  const THREATS = [
    { key: "heal", label: "healing / lifesteal", of: p => p.heal, answered: p => p.antiHeal > 0, buy: it => has(it, "ANTI_HEAL"), answer: "anti-heal" },
    { key: "shield", label: "shields", of: p => p.shield, answered: p => p.antiShield > 0, buy: it => has(it, "ANTI_SHIELD"), answer: "anti-shield" },
    { key: "tank", label: "tankiness", of: p => p.tank, answered: p => p.antiTank > 0, buy: it => has(it, "ANTI_TANK", "PHYSICAL_SHRED", "MAGICAL_SHRED"), answer: "armor shred / anti-tank" },
    { key: "phys", label: "physical damage", of: p => (p.phys + p.mag) ? p.phys / (p.phys + p.mag) : 0, answered: p => p.physArmor >= 60, buy: it => (it.stats.PHYSICAL_ARMOR || 0) >= 25, answer: "physical armor" },
    { key: "mag", label: "magical damage", of: p => (p.phys + p.mag) ? p.mag / (p.phys + p.mag) : 0, answered: p => p.magArmor >= 60, buy: it => (it.stats.MAGICAL_ARMOR || 0) >= 25 || has(it, "ANTI_MAGIC"), answer: "magical armor" },
    { key: "crit", label: "crit damage", of: p => p.crit, answered: p => p.antiCrit > 0, buy: it => has(it, "ANTI_CRIT"), answer: "anti-crit" },
    { key: "burst", label: "burst", of: p => p.burst, answered: p => p.antiBurst > 0, buy: it => has(it, "ANTI_BURST", "SPELL_SHIELD"), answer: "anti-burst / spell shield" },
  ];

  /* ---------- build everything once ---------- */
  function build(items, matches, heroes) {
    const C = Object.fromEntries(items.map(i => [i.name, i]));
    const price = statPrices(items);
    const value = it => Object.entries(it.stats || {}).reduce((a, [s, v]) => a + (price[s] || 0) * v, 0);
    const eff = Object.fromEntries(items.filter(i => i.cost > 0).map(i => [i.name, value(i) / i.cost]));
    const core = n => C[n] && C[n].slot !== "CREST" && C[n].slot !== "TRINKET" && C[n].cost >= 2000;

    // one record per team per match
    const teamGames = [];
    for (const m of matches) {
      if (!m.players.every(p => p.items)) continue;
      for (const team of ["DAWN", "DUSK"]) {
        const us = m.players.filter(p => p.team === team), them = m.players.filter(p => p.team !== team);
        teamGames.push({
          match: m, team, win: m.winner === team, squad: us.filter(p => p.squad).map(p => p.squad),
          us: us.reduce((a, p) => add(a, profile(p.items, C)), {}),
          them: them.reduce((a, p) => add(a, profile(p.items, C)), {}),
          themHeroes: them.map(p => p.hero),
        });
      }
    }

    // counter matrix: when the enemy leaned hard on a threat, did answering it win more?
    const counters = THREATS.map(t => {
      const vals = teamGames.map(g => t.of(g.them)).sort((a, b) => a - b);
      const cut = vals[Math.floor(vals.length * 0.6)];          // top 40% = "heavy"
      const heavy = teamGames.filter(g => t.of(g.them) >= cut && t.of(g.them) > 0);
      const yes = heavy.filter(g => t.answered(g.us)), no = heavy.filter(g => !t.answered(g.us));
      const rec = gs => ({ games: gs.length, wins: gs.filter(g => g.win).length });
      const a = rec(yes), b = rec(no);
      return { ...t, cut, answered: a, unanswered: b,
        lift: shrink(a.wins, a.games, 0.5, 10) - shrink(b.wins, b.games, 0.5, 10) };
    });

    // what each hero tends to build (all 10 players of every stored match)
    const heroBuilds = {};
    for (const m of matches) for (const p of m.players) {
      if (!p.items || !p.hero) continue;
      const h = heroBuilds[p.hero] || (heroBuilds[p.hero] = { games: 0, wins: 0, items: {}, prof: {} });
      h.games++; if (m.winner === p.team) h.wins++;
      h.prof = add(h.prof, profile(p.items, C));
      for (const n of p.items.filter(core)) { const r = h.items[n] || (h.items[n] = { games: 0, wins: 0 }); r.games++; if (m.winner === p.team) r.wins++; }
    }
    for (const h of Object.values(heroBuilds)) {
      h.avg = Object.fromEntries(Object.entries(h.prof).map(([k, v]) => [k, v / h.games]));
      h.damage = h.avg.mag > h.avg.phys ? "magical" : "physical";
      h.top = Object.entries(h.items).map(([n, r]) => ({ item: n, ...r })).sort((a, b) => b.games - a.games);
    }
    const typical = teamGames.length ? Object.fromEntries(Object.keys(teamGames[0].them).map(k =>
      [k, teamGames.reduce((a, g) => a + (g.them[k] || 0), 0) / teamGames.length])) : {};

    return { C, price, eff, value, core, teamGames, counters, heroBuilds, typical, heroes: heroes || [] };
  }

  /* ---------- a squad member's item record ---------- */
  function memberItems(lab, matches, member, minGames = 4) {
    const rows = [];
    for (const m of matches) { const p = m.players.find(x => x.squad === member); if (p && p.items) rows.push({ p, win: m.winner === p.team }); }
    const base = rows.length ? rows.filter(r => r.win).length / rows.length : 0.5;
    const by = {};
    for (const r of rows) for (const n of new Set(r.p.items.filter(lab.core))) { const x = by[n] || (by[n] = { games: 0, wins: 0 }); x.games++; if (r.win) x.wins++; }
    const list = Object.entries(by).filter(([, x]) => x.games >= minGames).map(([n, x]) => ({
      item: n, label: lab.C[n].label, ...x, wr: x.wins / x.games, est: shrink(x.wins, x.games, base, 6), lift: shrink(x.wins, x.games, base, 6) - base,
    })).sort((a, b) => b.lift - a.lift);
    // defensive items: how many of the core items were defensive, vs result
    const style = [0, 1, 2].map(k => {
      const g = rows.filter(r => { const d = profile(r.p.items, lab.C).def; return k === 2 ? d >= 2 : d === k; });
      return { label: k === 2 ? "2+ defensive items" : `${k} defensive item${k === 1 ? "" : "s"}`, games: g.length, wins: g.filter(r => r.win).length };
    });
    return { games: rows.length, base, items: list, style };
  }

  /* ---------- in-game: what is the enemy doing and how should each of us answer ---------- */
  function respond(lab, enemy, ours) {
    // enemy: [{hero, items?:[names], ahead?:bool}]  ours: [{who, hero}]
    let them = {}; const sources = {};
    for (const e of enemy) {
      if (!e || !e.hero) continue;
      const hb = lab.heroBuilds[e.hero];
      const prof = e.items && e.items.length ? profile(e.items, lab.C) : hb ? hb.avg : null;
      if (!prof) continue;
      const w = e.ahead ? 1.5 : 1;
      them = add(them, Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, v * w])));
      for (const t of THREATS) { const v = t.of(prof); if (v > 0) (sources[t.key] = sources[t.key] || []).push({ hero: e.hero, v: v * w, known: !!(e.items && e.items.length) }); }
    }
    const calls = [];
    for (const t of THREATS) {
      const cm = lab.counters.find(c => c.key === t.key);
      const v = t.of(them), typ = t.of(lab.typical);
      if (!(v > 0) || v < (cm ? cm.cut : typ * 1.2)) continue;
      const who = (sources[t.key] || []).sort((a, b) => b.v - a.v).slice(0, 2).map(s => s.hero);
      const picks = [];
      const defensive = ["phys", "mag", "crit", "burst"].includes(t.key);
      for (const o of ours) {
        if (!o.hero) continue;
        const hb = lab.heroBuilds[o.hero];
        const dmg = hb ? hb.damage : null;
        const fits = it => !dmg || (dmg === "physical" ? (it.stats.MAGICAL_POWER || 0) === 0 : (it.stats.PHYSICAL_POWER || 0) === 0);
        const options = Object.values(lab.C).filter(it => lab.core(it.name) && !it.hidden && t.buy(it) && fits(it));
        if (!options.length) continue;
        // prefer what players of this hero actually buy, then stat value per gold
        const used = n => ((hb && hb.items[n]) || {}).games || 0;
        options.sort((a, b) => used(b.name) - used(a.name) || (lab.eff[b.name] || 0) - (lab.eff[a.name] || 0));
        // who should carry it: defensive answers go to the front line / whoever keeps dying,
        // damage answers (anti-heal, shred) to whoever already buys that kind of item
        const fit = defensive ? ((hb ? hb.avg.tank : 0) + 8 * (o.deaths || 0)) : used(options[0].name) * 3 + (hb ? hb.avg.phys + hb.avg.mag : 0) / 40;
        picks.push({ who: o.who, hero: o.hero, item: options[0], alt: options[1] || null, seen: used(options[0].name), fit });
      }
      picks.sort((a, b) => b.fit - a.fit);
      calls.push({ threat: t, value: v, vsTypical: typ ? v / typ : null, who, picks, evidence: cm });
    }
    calls.sort((a, b) => (b.vsTypical || 0) - (a.vsTypical || 0));
    // hand each answer to the best-suited player, spreading purchases across the squad
    const load = {};
    for (const c of calls) {
      const top = Math.max(1e-9, ...c.picks.map(p => p.fit));
      const best = c.picks.map(p => ({ p, score: p.fit / top - 0.6 * (load[p.who] || 0) })).sort((a, b) => b.score - a.score)[0];
      c.pick = best ? best.p : null;
      if (c.pick) load[c.pick.who] = (load[c.pick.who] || 0) + 1;
    }
    return { calls, them };
  }

  return { statPrices, profile, THREATS, build, memberItems, respond, shrink };
});
