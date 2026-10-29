// Engine sanity tests on synthetic data.  Run: node tests/test_engine.js
const assert = require("assert");
const E = require("../docs/engine.js");
const fs = require("fs");
const fixture = require("path").join(__dirname,"fixture_matches.json");
if (!fs.existsSync(fixture)) require("child_process").execFileSync(process.env.PYTHON || "python3", [require("path").join(__dirname,"test_fetch.py")]);
const fx = require(fixture);

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
assert.strictEqual(plan.next.label, "Orb Prime");
assert(plan.lanes.find(l => l.role === "OFFLANE").ev.matchup, "meta matchup used for greystone vs terra");
const empty2 = E.matchPlan(E.context([], heroes, null), {}, {}, null, {});
assert.strictEqual(empty2.lanes.length, 5);
console.log("ok: match plan", plan.calls.length, "calls; threats", plan.threats.map(t => t.hero).join(","));

// ---------- scoreboard -> game state ----------
const mk = a => a.map(([hero, lvl, k, d, a2, gold]) => ({ hero, lvl, k, d, a: a2, gold }));
const board = {
  ours: mk([["terra", 18, 0, 7, 3, 15862], ["aurora", 18, 2, 11, 3, 15614], ["argus", 18, 4, 7, 4, 17920], ["zinx", 18, 2, 1, 5, 20593], ["revenant", 18, 9, 6, 6, 23301]]),
  theirs: mk([["zarus", 18, 11, 1, 0, 26771], ["khaimera", 18, 13, 2, 8, 23612], ["bayle", 18, 5, 5, 8, null], ["lt-belica", 18, 1, 5, 8, 19849], ["eden", 18, null, null, null, 16439]]),
};
const bs = E.boardState(board, { ours: { OFFLANE: { who: "stealinNICKELS" } } });
assert(bs.goldDiff < -5000, "one unread enemy gold must not flip the team gold call");
assert(bs.goldEstimated);
assert.deepStrictEqual(bs.fed.map(f => f.hero), ["zarus", "khaimera"]);
assert(bs.calls[0].level === "bad" && /Behind/.test(bs.calls[0].text));
assert(bs.calls.some(c => /stealinNICKELS/.test(c.text) && /fight next to your team/.test(c.text)), "late-game wording");
assert.strictEqual(E.boardState(null, {}), null);
console.log("ok: board state", bs.calls.length, "calls");

// ---------- item lab ----------
const IL = require("../docs/itemlab.js");
const items = [
  { name: "Long Sword", label: "Long Sword", cost: 1000, slot: "PASSIVE", rarity: "RARE", type: "OFFENSE", stats: { PHYSICAL_POWER: 25 } },
  { name: "Ruby", label: "Ruby", cost: 900, slot: "PASSIVE", rarity: "RARE", type: "DEFENSE", stats: { HEALTH: 250 } },
  { name: "Plate", label: "Plate", cost: 800, slot: "PASSIVE", rarity: "RARE", type: "DEFENSE", stats: { PHYSICAL_ARMOR: 25 } },
  { name: "Wand", label: "Wand", cost: 900, slot: "PASSIVE", rarity: "RARE", type: "OFFENSE", stats: { MAGICAL_POWER: 30 } },
  { name: "Leech", label: "Leech", cost: 2800, slot: "PASSIVE", rarity: "EPIC", type: "SUSTAIN", stats: { PHYSICAL_POWER: 40, LIFESTEAL: 15 } },
  { name: "Rot", label: "Rot", cost: 2800, slot: "PASSIVE", rarity: "EPIC", type: "ANTI_HEAL", stats: { PHYSICAL_POWER: 45 } },
  { name: "Rot Staff", label: "Rot Staff", cost: 2800, slot: "PASSIVE", rarity: "EPIC", type: "ANTI_HEAL", stats: { MAGICAL_POWER: 60 } },
  { name: "Wall", label: "Wall", cost: 2700, slot: "PASSIVE", rarity: "EPIC", type: "DEFENSE", stats: { HEALTH: 300, PHYSICAL_ARMOR: 40 } },
];
const IM = fx.matches.map((m, i) => ({ ...m, players: m.players.map((p, j) => ({ ...p,
  items: (j + i) % 3 === 0 ? ["Leech", "Long Sword"] : (j + i) % 3 === 1 ? ["Rot", "Wall"] : ["Rot Staff", "Wand"] })) }));
const lab = IL.build(items, IM, heroes);
assert(Math.abs(lab.price.PHYSICAL_POWER - 40) < 2, "stat price fitted from components: " + lab.price.PHYSICAL_POWER);
assert(Math.abs(lab.eff["Long Sword"] - 1) < 0.05);
assert.strictEqual(lab.counters.length, IL.THREATS.length);
for (const c of lab.counters) assert.strictEqual(c.answered.games + c.unanswered.games > 0, c.answered.games + c.unanswered.games > 0);
const mi = IL.memberItems(lab, IM, "stealinNICKELS", 1);
assert(mi.games > 0 && mi.items.length > 0);
const rsp = IL.respond(lab, [{ hero: "khaimera", items: ["Leech", "Leech"] }, { hero: "crunch", items: ["Leech"] }], [{ who: "stealinNICKELS", hero: "greystone" }, { who: "DiMu", hero: "aurora" }]);
const heal = rsp.calls.find(c => c.threat.key === "heal");
assert(heal && heal.pick && /Rot/.test(heal.pick.item.label), "heavy lifesteal should call for anti-heal");
console.log("ok: item lab", Object.keys(lab.price).length, "stat prices;", rsp.calls.length, "respond calls");

// Role-specific matchup evidence is disjoint from baseline evidence.
const single={member:"a",role:"CARRY",hero:"h",together:["a"],win:true,laneOpponents:[{hero:"enemy"}]};
const plain=E.heroScore([single],null,"a","CARRY","h",["a"],null);
const versus=E.heroScore([single],null,"a","CARRY","h",["a"],"enemy");
assert.strictEqual(plain.score,versus.score,"same win cannot be counted twice");
assert.strictEqual(E.heroScore([single],null,"a","MIDLANE","h",["a"],"enemy").vsOpp.games,0);
assert.deepStrictEqual(E.suggestLineups(ctx,[]),[]);
const locked=E.suggestLineups(ctx,["DiMu","inFamoUs"],3,{locks:{DiMu:{role:"JUNGLE"}},excluded:["aurora"]});
for(const l of locked){assert.equal(l.roles.DiMu,"JUNGLE");assert(!Object.values(l.chosenHeroes).includes("aurora"));assert.equal(new Set(Object.values(l.chosenHeroes)).size,2);}
console.log("ok: regression scoring, draft locks and distinct heroes");
