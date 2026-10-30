const a=require('node:assert/strict'),O=require('../docs/optimizer.js'),R=['OFFLANE','JUNGLE','MIDLANE','SUPPORT','CARRY'],N=2000000,Q=x=>Math.round(x*1e6)/1e6,K=['healing','shielding','physical','magical'];
const it=(name,type='OFFENSE',stats={},more={})=>({name,type,stats,slot:'PASSIVE',rarity:'EPIC',cost:2500,...more});
function fixture(n=3,keys=K){
 const catalog=[it('H','ANTI_HEAL'),it('S','ANTI_SHIELD'),it('P','DEFENSE',{PHYSICAL_ARMOR:40}),it('M','ANTI_MAGIC',{MAGICAL_ARMOR:40}),it('E0','HEALING_AND_SHIELDING',{PHYSICAL_POWER:35}),it('E1','OFFENSE',{MAGICAL_POWER:45}),...Array.from({length:6},(_,i)=>it('A'+i))],setup={ours:{},theirs:{}};
 const row=(i,enemy)=>({role:R[i],hero:(enemy?'e':'h')+i,items:enemy?['E'+i]:[],inventoryConfirmed:true,inventoryComplete:true});
 const ours=R.map((_,i)=>row(i,false)),theirs=R.map((_,i)=>row(i,true)),threats=[0,1].map(i=>({role:R[i],hero:'e'+i,items:['E'+i],inventoryAt:N-1,source:'confirmed',priority:3-i,levelGap:i?0:2,signals:(i?['magical']:K.slice(0,3)).map(key=>({key}))}));
 for(let i=0;i<n;i++)setup.ours[R[i]]={who:'P'+i,hero:'h'+i};for(let i=0;i<2;i++)setup.theirs[R[i]]={hero:'e'+i};
 const players=Array.from({length:n},(_,i)=>({who:'P'+i,hero:'h'+i,role:R[i],status:'ready',needs:keys.map(key=>({key,targets:[key==='magical'?'e1':'e0'],alternatives:[{item:catalog[K.indexOf(key)],answerKey:key,rank:key==='physical'?2:1}]}))}));
 return{catalog,setup,board:{at:N-1,sessionId:'s',ours,theirs},counterPlan:{status:'ready',threats,players},sessionId:'s',patch:'p',now:N};
}
const run=f=>O.optimize(f),cmp=(x,y)=>x<y?-1:x>y?1:0,opts=(r,i=0)=>r.candidateSpace[i].options;
// Independent exhaustive fixture oracle, without reading candidateSpace/scoring helpers.
function oracle(f){
 const weights=[[1,1],[1.75,1],[1.5,1],[1,1.5]].map(([x,y])=>[x*5/(3*x+2*y),y*5/(3*x+2*y)]);
 const choices=f.counterPlan.players.map(p=>[null,...p.needs.map(n=>({id:n.alternatives[0].item.name,key:n.key,q:1-.04*(n.alternatives[0].rank-1)}))]),all=[];
 function visit(i,items){if(i<choices.length){for(const v of choices[i])visit(i+1,[...items,v]);return;}
 const scores=weights.map(w=>{const shared={};let v=0;for(const x of items.filter(Boolean)){const t=x.key==='magical'?1:0,p=(3-t)*w[t];if(['healing','shielding'].includes(x.key))shared[x.key]=Math.max(shared[x.key]||0,p*(1+x.q));else v+=p*(1+x.q);}return v+Object.values(shared).reduce((s,x)=>s+x,0);});
 all.push({signature:items.map((v,j)=>'P'+j+'='+(v?v.id:'~keep')).join('|'),changes:items.filter(Boolean).length,scores,score:.75*scores.reduce((s,x)=>s+x,0)/4+.25*Math.min(...scores)});}
 visit(0,[]);all.sort((x,y)=>Math.abs(y.score-x.score)>1e-9?y.score-x.score:x.changes-y.changes||cmp(x.signature,y.signature));return{all,weights};
}
for(const n of [1,2,3])for(const keys of [['healing'],['healing','shielding'],K]){
 const f=fixture(n,keys),before=JSON.stringify(f),e=oracle(f),r=run(f);
 a.deepEqual(r.solutions.map(x=>[x.signature,x.score]),e.all.slice(0,3).map(x=>[x.signature,Q(x.score)]));a.deepEqual(r.solutions[0].scenarioScores.map(x=>x.score),e.all[0].scores.map(Q));a.equal(r.search.evaluatedCombinations,(keys.length+1)**n);
 r.scenarios.forEach((s,i)=>{const w=Object.values(s.weights);a(Math.abs(3*w[0]+2*w[1]-5)<1e-12);w.forEach((v,j)=>a(Math.abs(v-e.weights[i][j])<1e-12));});a.equal(JSON.stringify(f),before);a.deepEqual(run(f),r);
}
let f=fixture(3,['healing']),r=run(f);a.equal(r.assignment.filter(x=>x.item).length,1);a.equal(r.assignment[0].item,'H');a.equal(r.coverage.planned.length,1);a.equal(r.selectionStability.winningScenarioCount,4);
f=fixture(3,['healing']);f.counterPlan.players.forEach((p,i)=>p.needs[0].alternatives[0].rank=3-i);r=run(f);a.equal(r.assignment[2].item,'H');a.equal(r.assignment.filter(x=>x.item).length,1);
f=fixture(2,['healing','shielding']);a.deepEqual(new Set(run(f).assignment.map(x=>x.item)),new Set(['H','S']));
f=fixture(2,['physical']);r=run(f);a(r.assignment.every(x=>x.item==='P'));a.equal(r.coverage.planned.length,2);
f=fixture(1);delete f.board.ours[0].inventoryComplete;a.equal(run(f).status,'needs-inventory');
for(const items of [[],Array(6).fill(null)]){f=fixture(1);f.board.ours[0].items=items;a.equal(run(f).status,'ready');}
for(const items of [null,['unknown']]){f=fixture(1);f.board.ours[0].items=items;a.equal(run(f).status,'needs-inventory');}
f=fixture(1);f.board.ours[0].inventoryComplete=false;a.equal(run(f).status,'needs-inventory');
f=fixture(1);f.board.ours[0].items=Array.from({length:6},(_,i)=>'A'+i);a.equal(run(f).status,'needs-swap');
f=fixture(2);f.setup.ours.JUNGLE.who='P0';r=run(f);a.equal(r.candidateSpace[0].status,'ambiguous-identity');a(r.assignment.every(x=>x.keepCurrent));
for(const prop of ['blocks','blockedBy'])for(const reverse of [false,true]){f=fixture(1,['healing']);f.board.ours[0].items=['A0'];f.catalog.find(x=>x.name===(reverse?'A0':'H'))[prop]=[reverse?'H':'A0'];a(run(f).assignment[0].keepCurrent);}
for(const t of [N+1,N-180001]){f=fixture(1);f.board.at=t;a.equal(run(f).status,'stale');}
f=fixture(1);f.board.sessionId='other';a.equal(run(f).status,'context-mismatch');
for(const change of [f=>f.board.theirs[0].hero='wrong',f=>f.counterPlan.threats[0].inventoryAt--,f=>f.counterPlan.threats[0].items=['E1']]){f=fixture(1,['healing']);change(f);a(run(f).assignment[0].keepCurrent);}
f=fixture(2,['healing']);f.pivotIntents={P0:{who:'P0',hero:'h0',role:R[0],item:'H',answerKey:'healing',targets:['e0'],patch:'p',sessionId:'s',boardAt:N-1,selectedAt:N}};r=run(f);a.equal(r.coverage.owned.length,0);a(opts(r,1).some(x=>x.item==='H'));a(r.assignment[0].fixedIntent);
f.board.ours[0].items=['H'];r=run(f);a.equal(r.coverage.owned.length,1);a(r.assignment.every(x=>x.keepCurrent));
f=fixture(1,['healing']);f.board.ours[0].gold=999999;a.equal(run(f).assignment[0].affordable,null);f.board.ours[0].currentGold=10;a.equal(run(f).assignment[0].affordable,false);f.board.ours[0].currentGold=2500;a.equal(run(f).assignment[0].action,'buy');
f=fixture();r=run({...f,maxCombinations:4,maxCandidatesPerPlayer:3});a(r.search.totalCombinations<=4);a.equal(r.search.evaluatedCombinations,r.search.totalCombinations);a(r.search.truncatedCandidates>0);a(r.candidateSpace.every(p=>p.options.some(x=>x.keepCurrent)));
f=fixture(1);f.profiles={P0:{sampleCount:1e9,preferenceWeight:100,items:{H:100,S:-100}}};r=run(f);a(opts(r).every(x=>Math.abs(x.profile.effectiveFactor)<=.1));a(r.assignment.every(x=>Math.abs(x.preferenceContribution)<=.1*x.individualScore+1e-6));
// A dual-purpose buyer makes an extra utility-only buyer redundant, independent of names.
f=fixture(2,['healing','physical']);const dual=it('Dual','ANTI_HEAL',{PHYSICAL_ARMOR:40});f.catalog.push(dual);
f.counterPlan.players[0].needs.forEach(n=>n.alternatives=[{item:dual,rank:1,answerKey:n.key}]);f.counterPlan.players[1].needs=f.counterPlan.players[1].needs.filter(n=>n.key==='healing');
r=run(f);a.deepEqual(r.assignment.map(x=>x.item),['Dual',null]);const score=r.score;
for(const [i,name]of ['zoe','alice'].entries()){f.setup.ours[R[i]].who=name;f.counterPlan.players[i].who=name;}
r=run(f);a.equal(r.score,score);a.deepEqual(r.assignment.map(x=>x.item),['Dual',null]);
// Unrelated/future history cannot create candidate damage fit in coordinated mode.
const CB=require('../docs/counterbuild.js');f=fixture(1,['healing']);f.catalog[0].stats={PHYSICAL_POWER:30};f.catalog.push(it('HistoricPower','OFFENSE',{PHYSICAL_POWER:50}));
const history=Array.from({length:5},(_,i)=>({id:'future'+i,start:'2099-01-01',patch:'old',mode:'wrong',players:[{hero:'h0',items:['HistoricPower']}]}));
const args={items:f.catalog,heroes:[{slug:'h0',classes:['FIGHTER']}],setup:f.setup,board:f.board,now:N,matches:history,sessionId:'s'};
a.equal(CB.plan(args).players[0].damageType,'physical');a.equal(CB.plan({...args,coordinated:true}).players[0].damageType,'unknown');
console.log('ok: independent joint oracle, scenario normalization, no redundant utility, identity invariance, evidence/context gates, conflicts, ownership, budgets, bounds, profile caps and historical isolation');

// Coordinated candidate generation must leave utility choices open to both buyers.
f=fixture(2,['healing']);const coordinated=CB.plan({items:f.catalog,setup:f.setup,board:f.board,now:N,coordinated:true,sessionId:'s'});
a(coordinated.players.every(p=>p.needs.some(n=>n.key==='healing')));
console.log('ok: coordinated pool considers all eligible utility buyers');

{
 const B=require('../docs/buildplans.js'),f=fixture(1,[]);
 f.board.ours[0].items=['A0'];
 f.buildPlans={P0:B.createBaseline({who:'P0',hero:'h0',role:R[0],patch:'p',sessionId:'s',items:['A0','A1','A2','A3','A4','A5'],nextItem:'A0',confirmed:true,now:N,catalog:f.catalog})};
 a.equal(run(f).assignment[0].keepTarget,null,'owned planned target is not recommended as next purchase');
 f.board.ours[0].items=[];a.equal(run(f).assignment[0].keepTarget,'A0','unowned reviewed target remains eligible');
}
console.log('ok: owned starting target is not repeated as a next-item direction');
