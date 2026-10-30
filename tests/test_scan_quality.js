const assert=require('node:assert/strict'),Q=require('../docs/scan-quality.js');
const roles=['OFFLANE','JUNGLE','MIDLANE','SUPPORT','CARRY'],heroes=Array.from({length:10},(_,i)=>({slug:'hero'+i})),items=[{name:'Sword',slot:'PASSIVE'}],opts={heroes,items},ev=(value,source='ocr',score=.99)=>({value,source,metrics:{ocr:score},resolved:true}),empty=()=>({value:null,source:'human',metrics:{confirmation:1},confirmed:true,state:'empty',resolved:true});
const team=value=>({...ev(value,'gamertag'),metrics:{ocr:.99,match:1}});
function board(layout='live'){const b={sourceLayout:layout,readConfidence:{layout:ev('role-order','measured-grid'),ownTeam:team('left')},ours:[],theirs:[]};for(const[side,offset]of[['ours',0],['theirs',5]])for(let i=0;i<5;i++){const r={role:roles[i],hero:'hero'+(offset+i),lvl:8,k:0,d:0,a:0,cs:93,gold:layout==='live'?null:14000,items:Array(6).fill(null),readConfidence:{}};for(const k of['hero','lvl','k','d','a',layout==='live'?'cs':'gold'])r.readConfidence[k]=ev(r[k]);b[side].push(r);}return b;}
let b=board(),r=Q.assess('scoreboard',b,opts);assert(r.auto);assert.equal(r.score,99);assert(r.inventoryReady.ours.every(x=>!x));
b.ours[0].readConfidence.k.metrics.ocr=.89;r=Q.assess('scoreboard',b,opts);assert(!r.auto);assert.equal(r.score,89);
for(const source of['assumed','known-lineup','prior','heuristic','raw-fallback']){b=board();b.ours[0].readConfidence.hero.source=source;assert(!Q.assess('scoreboard',b,opts).auto);}
b=board();delete b.readConfidence.layout;assert(!Q.assess('scoreboard',b,opts).auto);
b=board();b.readConfidence.ownTeam.resolved=false;assert(!Q.assess('scoreboard',b,opts).auto);
b=board();b.ours[0].readConfidence.hero.disputed=true;assert(!Q.assess('scoreboard',b,opts).auto);
b=board();b.ours[0].hero='not-canonical';b.ours[0].readConfidence.hero.value='not-canonical';assert(!Q.assess('scoreboard',b,opts).auto);
b=board();b.ours[1].hero=b.ours[0].hero;b.ours[1].readConfidence.hero.value=b.ours[1].hero;assert(!Q.assess('scoreboard',b,opts).auto);
b=board();b.ours[0].gold=212;assert(!Q.assess('scoreboard',b,opts).auto);
b=board();b.ours[0].cs=null;assert(!Q.assess('scoreboard',b,opts).auto);
b=board('gold');assert(Q.assess('scoreboard',b,opts).auto);delete b.ours[0].gold;assert(!Q.assess('scoreboard',b,opts).auto);
b=board('unknown');assert(!Q.assess('scoreboard',b,opts).auto);
b=board();b.ours[0].readConfidence.items=Array.from({length:6},empty);assert(Q.assess('scoreboard',b,opts).inventoryReady.ours[0]);
b.ours[0].readConfidence.items[0]={value:null,source:'ocr',metrics:{ocr:1},resolved:true};assert(!Q.assess('scoreboard',b,opts).inventoryReady.ours[0]);
b.ours[0].items[0]='Sword';b.ours[0].readConfidence.items[0]=ev('Sword');assert(Q.assess('scoreboard',b,opts).inventoryReady.ours[0]);
b.ours[0].readConfidence.items[0].metrics.ocr=.8;assert(!Q.assess('scoreboard',b,opts).inventoryReady.ours[0]);assert(Q.assess('scoreboard',b,opts).auto);
b=board();const loading={readConfidence:{layout:ev('role-order','measured-grid'),ownTeam:team('top')},ours:Object.fromEntries(b.ours.map((r,i)=>[roles[i],r])),theirs:Object.fromEntries(b.theirs.map((r,i)=>[roles[i],r]))};assert(Q.assess('loading',loading,opts).auto);delete loading.theirs.CARRY;assert(!Q.assess('loading',loading,opts).auto);
assert.equal(Q.reliability(ev(0,'ocr',.9),0),90);assert.equal(Q.reliability({value:0,source:'ocr',metrics:{ocr:99}},0),0);
console.log('ok: weakest evidence, canonical identity, geometry, team, live CS, legacy gold and separate inventories');

b=board();b.ours[0].who='alice';b.ours[0].readConfidence.who={...ev('alice','gamertag',.99),metrics:{ocr:.99,match:1}};assert(Q.assess('scoreboard',b,{...opts,squad:[{key:'alice'}]}).auto);
b.ours[0].readConfidence.who.metrics.ocr=.4;assert(!Q.assess('scoreboard',b,{...opts,squad:[{key:'alice'}]}).auto);
b.ours[0].readConfidence.who.metrics.ocr=.99;b.ours[0].readConfidence.who.disputed=true;assert(!Q.assess('scoreboard',b,{...opts,squad:[{key:'alice'}]}).auto);
console.log('ok: all supplied player assignments require reliable exact squad identity');
