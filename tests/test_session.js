const assert=require("node:assert/strict");
const M=require("../docs/session.js"), Scan=require("../docs/minimap.js");
const plan={roles:{a:"MIDLANE",b:"CARRY"},heroes:{a:"gideon",b:"sparrow"}};
const s=M.fromPlan(plan,"test");
assert.equal(s.stage,"draft");assert.equal(s.setup.ours.MIDLANE.who,"a");assert.equal(s.setup.ours.CARRY.hero,"sparrow");
assert.throws(()=>M.start(s,"",1000));
const live=M.start(s,"a",1000);assert.equal(live.stage,"live");assert.equal(s.stage,"draft");
assert.equal(M.parseTime("3:45"),225);assert.equal(M.parseTime("3:99"),null);
assert.equal(M.objectiveStatus(null,600).text,"Unknown");
const e=M.objectiveEvent("countdown",600,120,"scan","a");assert.equal(e.respawnAt,720);
assert.equal(M.objectiveStatus(e,650).remaining,70);assert.equal(M.objectiveStatus(e,730).text,"Expected available — check map");
assert.throws(()=>M.objectiveEvent("countdown",null,120,"scan","a"));
assert.equal(M.objectiveEvent("defeated",600,null,"manual","a").respawnAt,null);
assert(M.validateSetup({ours:{CARRY:{who:"a",hero:"x"},MIDLANE:{who:"a",hero:"x"}}}).length>=2);
assert.deepEqual(Scan.candidates([[{t:"2:35",c:80}]]).map(x=>x.seconds),[155]);
assert.deepEqual(Scan.candidates([[{t:"2:99",c:80}]]),[]);
assert.throws(()=>M.validateBoard({ours:[],theirs:[]}));
console.log("ok: plan handoff, identity, lifecycle, timer parsing, unknown states and scan validation");

const P=require("../docs/photo-prep.js");
const h=P.mapping([{x:10,y:20},{x:110,y:20},{x:110,y:70},{x:10,y:70}]);
assert(Math.abs(h[0]-100)<1e-6 && Math.abs(h[4]-50)<1e-6 && Math.abs(h[2]-10)<1e-6);
assert.throws(()=>P.mapping([{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}]));
console.log("ok: perspective mapping and degenerate corner rejection");

assert.deepEqual(Scan.candidates([[{t:"36",c:90}]]).map(x=>x.seconds),[36]);
assert.equal(Scan.candidates([[{t:"2m+",c:90}]])[0].seconds,null);
assert.equal(Scan.candidates([[{t:"2m+",c:90}]])[0].minSeconds,120);
console.log("ok: seconds-only minimap counters and approximate timer rejection");

const validBoard={at:Date.now(),sessionId:"new",ours:Array.from({length:5},()=>({hero:null,items:[],inventoryConfirmed:false})),theirs:Array.from({length:5},()=>({hero:null,items:[],inventoryConfirmed:false}))};
assert.throws(()=>M.validateBoard({...validBoard,sessionId:"old"},{sessionId:"new"}));
assert.throws(()=>M.validateBoard({...validBoard,at:Date.now()+60000}));
validBoard.ours[0].items=["made-up-item"];
assert.throws(()=>M.validateBoard(validBoard,{items:[{name:"Sword"}]}));
validBoard.ours[0].items=[];validBoard.ours[0].currentGold=-1;
assert.throws(()=>M.validateBoard(validBoard));
console.log("ok: snapshot session, future age, canonical items and spendable gold validation");

assert.notEqual(M.blank().id,M.blank().id,"Clearing a match must invalidate old in-flight scans");

const originalSetup=M.clone(s.setup),changedLane=M.chooseLane(s.setup,"a","CARRY");
assert.equal(changedLane.ours.CARRY.who,"a");assert.equal(changedLane.ours.CARRY.hero,"gideon");
assert.equal(changedLane.ours.MIDLANE.who,"b");assert.equal(changedLane.ours.MIDLANE.hero,"sparrow");
assert.deepEqual(s.setup,originalSetup,"lane selection cannot mutate the source session");
assert.throws(()=>M.chooseLane(s.setup,"a","NOT_A_ROLE"));
const firstLane=M.chooseLane(M.blank().setup,"new","JUNGLE");assert.equal(firstLane.ours.JUNGLE.who,"new");
console.log("ok: quick lane selection preserves players and heroes without duplicates");

assert.equal(M.observedGameTime({sessionId:"current",at:1000,clock:80},"current",4000),83);
assert.equal(M.observedGameTime({sessionId:"old",at:1000,clock:80},"current",4000),null);
assert.equal(M.observedGameTime({sessionId:"current",at:5000,clock:80},"current",4000),null);
console.log("ok: observed game clock ages forward and rejects other-match/future observations");
const ended=M.finish(live,'win','a',2000);assert.equal(M.resultOf(ended).outcome,'win');assert.equal(ended.finishedAt,2000);assert.equal(live.stage,'live');
const edited=M.finish(ended,'loss','a',3000);assert.equal(M.resultOf(edited).outcome,'loss');assert.equal(edited.finishedAt,2000);assert.equal(edited.events.length,ended.events.length+1);
assert.equal(M.resultOf(M.normalize(JSON.parse(JSON.stringify(edited)))).outcome,'loss');assert.throws(()=>M.finish(live,'draw','a'));assert.throws(()=>M.finish(M.blank(),'win','a'));assert.equal(M.resultOf({...ended,id:'another'}),null);
console.log('ok: manual results persist, append edits and preserve finish time without crossing sessions');

const prior={sessionId:'s',at:100,clock:5,ours:Array.from({length:5},(_,i)=>({hero:'our'+i,lvl:10,k:1,d:2,cs:100,items:['secret-not-history'],readConfidence:{}})),theirs:Array.from({length:5},(_,i)=>({hero:'their'+i,lvl:10})),previous:{deep:true}};
const linked=M.linkBoard({...M.clone(prior),at:200,clock:6},prior);assert.equal(linked.previous.at,100);assert.equal(linked.previous.previous,undefined);assert.equal(linked.previous.ours[0].items,undefined);assert.equal(linked.previous.ours[0].readConfidence,undefined);
assert.equal(M.linkBoard({...linked,at:200},linked).previous,undefined);assert.equal(M.linkBoard({...linked,sessionId:'other',at:300},linked).previous,undefined);assert.equal(M.linkBoard({...linked,at:300001+linked.at},linked).previous,undefined);
assert.equal(JSON.parse(JSON.stringify(linked)).previous.ours[0].d,2);assert.equal(prior.previous.deep,true);
console.log('ok: bounded same-match scan history retains numeric evidence without recursive photos or confidence payloads');
