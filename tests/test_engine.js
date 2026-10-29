// Engine sanity tests on synthetic data.  Run: node tests/test_engine.js
const assert = require("assert");
const E = require("../docs/engine.js");
const fx = require("./fixture_matches.json");

const heroes = ["greystone", "sparrow", "khaimera", "crunch", "steel", "phase", "renna", "legion", "terra", "aurora"].map(s => ({
  slug: s, name: s[0].toUpperCase() + s.slice(1), roles: E.ROLES, skills: ["PRIMARY", "SECONDARY", "ALTERNATE", "PRIMARY", "PRIMARY", "ULTIMATE"],
  abilities: [{ key: "PRIMARY", name: "Q thing", desc: "" }],
}));
const meta = { patch: "1.17.2", heroes: { greystone: { OFFLANE: { games: 1000, wins: 521, wr: 52.1, builds: [{ items: ["Overlord"], games: 50, wr: 55 }],
  matchups: [{ hero: "terra", games: 120, wr: 46 }, { hero: "crunch", games: 80, wr: 58 }] } },
  aurora: { JUNGLE: { games: 3874, wins: 2077, wr: 53.6, matchups: [], builds: [] } } } };

const ctx = E.context(fx.matches, heroes, meta);
assert(ctx.rows.length > 0);

// shrink: no games -> prior; many games -> observed
assert.strictEqual(E.shrink(0, 0, 0.5, 5), 0.5);
assert(Math.abs(E.shrink(70, 100, 0.5, 5) - 0.69) < 0.02);

// combo report counts each match once and only exact groups
const sel = ["DiMu", "stealinNICKELS"];
const c = E.comboReport(fx.matches, sel);
const tm = E.togetherMatches(fx.matches, sel, true);
assert.strictEqual(c.games, tm.length);
assert.strictEqual(c.lineups.reduce((s, l) => s + l.games, 0), c.games);
for (const r of c.rows) assert.deepStrictEqual(r.together, sel);

// lineups: unique roles per member, sorted by score
const L = E.suggestLineups(ctx, ["stealinNICKELS", "DiMu", "inFamoUs"], 3);
assert.strictEqual(L.length, 3);
for (const l of L) {
  const roles = Object.values(l.roles);
  assert.strictEqual(new Set(roles).size, roles.length);
  for (const m of Object.keys(l.roles)) assert(l.heroes[m].length > 0);
}
assert(L[0].score >= L[2].score - 0.011);

// matchup moves the score in the right direction
const good = E.heroScore(ctx.rows, meta, "inFamoUs", "OFFLANE", "greystone", ["inFamoUs"], "crunch");
const bad = E.heroScore(ctx.rows, meta, "inFamoUs", "OFFLANE", "greystone", ["inFamoUs"], "terra");
assert(good.score > bad.score, "favourable matchup should score higher");

// brief: skill order + swap logic do not throw
const b = E.heroBrief(ctx, "stealinNICKELS", "OFFLANE", "greystone", ["stealinNICKELS"], "terra");
assert.strictEqual(b.skillOrder[0].button, "L1");
assert.strictEqual(b.skillOrder[5].key, "ULTIMATE");

// summary targets
const s = E.summarize(ctx.rows.filter(r => r.member === "stealinNICKELS"), { maxDeaths: 4, minWards: 4, minObjectiveDamage: 1 });
assert(s.games > 0 && s.hitDeaths >= 0 && s.hitDeaths <= 1);

// empty data must not crash
const empty = E.context([], heroes, null);
assert.strictEqual(E.suggestLineups(empty, ["DiMu"], 3).length, 3);
assert.strictEqual(E.comboReport([], ["DiMu"]).games, 0);

console.log(`ok: ${ctx.rows.length} rows, combo ${c.wins}-${c.losses}, top lineup`, L[0].roles, (L[0].score * 100).toFixed(1) + "%");

// full match plan
const setup = { ours: { OFFLANE: { hero: "greystone", who: "stealinNICKELS" }, JUNGLE: { hero: "aurora" }, MIDLANE: { hero: "renna", who: "DiMu" }, SUPPORT: { hero: "phase" }, CARRY: { hero: "sparrow", who: "inFamoUs" } },
  theirs: { OFFLANE: { hero: "terra" }, JUNGLE: { hero: "khaimera", fed: true }, MIDLANE: { hero: "legion" }, SUPPORT: { hero: "steel" }, CARRY: { hero: "crunch" } } };
const plan = E.matchPlan(ctx, setup, { stealinNICKELS: { deaths: 3, wards: 1 } }, 600, {});
assert.strictEqual(plan.lanes.length, 5);
assert.deepStrictEqual(plan.squadHere, ["DiMu", "inFamoUs", "stealinNICKELS"]);
assert.strictEqual(plan.threats[0].hero, "khaimera", "fed enemy should top threats");
assert(plan.members.stealinNICKELS.rules.some(r => /behind-mode/.test(r.text)));
assert(plan.members.stealinNICKELS.rules.some(r => /Wards 1/.test(r.text)));
assert.strictEqual(plan.next.label, "Fangtooth respawn");
assert(plan.lanes.find(l => l.role === "OFFLANE").ev.matchup, "meta matchup used for greystone vs terra");
const empty2 = E.matchPlan(E.context([], heroes, null), {}, {}, null, {});
assert.strictEqual(empty2.lanes.length, 5);
console.log("ok: match plan", plan.calls.length, "calls; threats", plan.threats.map(t => t.hero).join(","));
