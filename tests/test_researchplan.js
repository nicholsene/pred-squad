// Matchup strategy: verdicts, lane importance, game length, counter items, team profile, and the build bonus.
const assert=require('node:assert/strict'),P=require('../docs/researchplan.js'),B=require('../docs/buildplans.js');
const heroes=[{slug:'sky',name:'Sky',classes:['SHARPSHOOTER']},{slug:'tank',name:'Tank',classes:['TANK']},{slug:'mage',name:'Mage',classes:['MAGE']},{slug:'mage2',name:'Mage2',classes:['MAGE']},{slug:'mage3',name:'Mage3',classes:['ENCHANTER']},{slug:'gun',name:'Gun',classes:['SHARPSHOOTER']}];
const items=[{name:'Pen',label:'Penetrator'},{name:'Crit',label:'Crit Blade'},{name:'Ward',label:'Magic Ward'}];
const group=(games,wins,extra={})=>({games,wins,early:{Crit:[Math.round(games*.8),Math.round(wins*.8)],...(extra.early||{})},lane:extra.lane||{lead10:0,leadGames:games,ahead:[20,12],behind:[20,8]},length:extra.length||[[20,10],[20,10],[20,10]],minutes:[9,16,22,26,30,34],kda:[6,4,7]});
const R={heroes:{sky:{CARRY:{...group(200,100,{early:{Pen:[20,10]}}),
  vs:{tank:group(40,26,{early:{Pen:[24,16]},lane:{lead10:400,leadGames:40,ahead:[15,13],behind:[15,4]},length:[[12,10],[16,9],[12,4]]}),
      gun:group(5,1)},
  vsComp:{MAGICAL:group(30,15,{early:{Ward:[12,7]}})}}}}};
const p=P.plan({research:R,hero:'sky',role:'CARRY',enemy:'tank',enemyTeam:['tank','mage','mage2','mage3',null],heroes,items});
const kinds=p.findings.map(f=>f.kind);
assert.equal(p.status,'ready');assert.deepEqual(kinds,['matchup','lane','timing','counter','comp']);
assert.match(p.findings[0].text,/favoured/);assert.equal(p.matchup.games,40);assert(p.matchup.adjusted<p.matchup.winRate,'shrunk toward the usual result');
assert.match(p.findings[1].text,/Lane decides a lot vs Tank/);assert.match(p.findings[1].text,/\+400 gold/);
assert.match(p.findings[2].text,/Wins short games/);assert.match(p.findings[2].text,/~16 min/);
assert.equal(p.counters[0].item,'Pen');assert.match(p.findings[3].text,/Penetrator \(60% vs 10% usually/);
assert.equal(p.comp,'MAGICAL');assert.equal(p.compCounters[0].item,'Ward');
// thin matchup: no verdict, falls back to the hero's own lane/timing data
const thin=P.plan({research:R,hero:'sky',role:'CARRY',enemy:'gun',heroes,items});
assert.match(thin.findings[0].text,/only 5 top-player games/);assert(!thin.counters.length);assert.match(thin.findings[1].text,/for Sky here/);
// hero too thin for lane/timing -> lane-wide fallback, named as such
const R2={roles:{CARRY:group(300,150)},heroes:{sky:{CARRY:{...group(6,3,{lane:{lead10:0,leadGames:6,ahead:[2,1],behind:[2,1]},length:[[2,1],[2,1],[2,1]]}),vs:{}}}}};
const fb=P.plan({research:R2,hero:'sky',role:'CARRY',heroes,items});assert.match(fb.findings[0].text,/carries in general/);assert.match(fb.findings[1].text,/carries in general/);
assert.equal(P.plan({research:R,hero:'none',role:'CARRY',heroes}).status,'no-data');
// bonus feeds the build: Penetrator gets a positive bonus, Crit (no change) none
const bonus=P.counterBonus(p);assert(bonus.get('Pen')>0&&!bonus.has('Crit'));
console.log('ok: matchup verdict with shrinkage, lane swing, game length, counter items, team profile, thin-sample fallback, build bonus');
