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
// 5v5 plan
{
  const lane=(games,wins,extra={})=>group(games,wins,extra);
  const short=[[20,14],[20,10],[20,6]],long=[[20,6],[20,10],[20,14]];
  const RT={heroes:{
    a:{OFFLANE:{...lane(100,50,{length:short}),vs:{x:lane(40,30)}}},
    b:{JUNGLE:{...lane(100,50,{length:short}),vs:{y:lane(40,12)}}},
    c:{MIDLANE:{...lane(100,50,{length:short}),vs:{z:lane(30,15)}}},
    d:{SUPPORT:{...lane(100,50,{length:short}),vs:{}}},
    sky:{CARRY:{...lane(100,50,{length:short}),vs:{gun:lane(20,10)}}},
    x:{OFFLANE:lane(80,40,{length:long})},y:{JUNGLE:lane(80,40,{length:long})},z:{MIDLANE:lane(80,40,{length:long})},gun:{CARRY:lane(80,40,{length:long})}}};
  const hs=[...heroes,...'abcdxyz'.split('').map(s=>({slug:s,name:s.toUpperCase(),classes:['FIGHTER']}))];
  const t=P.teamPlan({research:RT,ours:{OFFLANE:'a',JUNGLE:'b',MIDLANE:'c',SUPPORT:'d',CARRY:'sky'},theirs:{OFFLANE:'x',JUNGLE:'y',MIDLANE:'z',SUPPORT:'mage',CARRY:'gun'},heroes:hs,items,me:'CARRY'});
  assert.equal(t.status,'ready');assert.deepEqual(t.counts,{favoured:1,unfavoured:1,even:2,unknown:1});
  assert.match(t.findings[0].text,/1 favour us, 1 favour them, 2 even, 1 without enough/);
  assert(t.findings.some(f=>f.kind==='timing'&&/We are the early team/.test(f.text)));
  assert(t.findings.some(f=>f.kind==='focus'&&/Play through Offlane: A vs X won 75% of 40/.test(f.text)));
  assert(t.findings.some(f=>f.kind==='danger'&&/Our jungle is the hardest matchup/.test(f.text)));
  assert(t.lanes.find(l=>l.role==='CARRY').mine);assert.equal(t.lanes.find(l=>l.role==='SUPPORT').usual.games,100);
  assert.equal(P.teamPlan({research:RT,ours:{OFFLANE:'a'},theirs:{OFFLANE:'x'},heroes:hs}).status,'incomplete');
  assert.equal(P.teamPlan({research:null}).status,'no-data');
  console.log('ok: 5v5 plan counts, early/late team, play-through and danger lanes, your lane, incomplete lineups');
}
