/* Independent invariants for evidence-led next-trip advice. No private corpus data. */
const assert=require('node:assert/strict'),E=require('../docs/engine.js');
const clone=x=>JSON.parse(JSON.stringify(x)),NOW=1_000_000,ROLE=E.ROLES;
function fixture(role='MIDLANE'){
 const setup={ours:{},theirs:{}},board={sessionId:'game-one',at:NOW-1000,clock:900,ours:[],theirs:[]};
 ROLE.forEach((r,i)=>{
  setup.ours[r]={hero:'ally-'+i,who:r===role?'me':'mate-'+i};setup.theirs[r]={hero:'enemy-'+i};
  board.ours.push({hero:'ally-'+i,lvl:10,k:2,d:2,a:3,cs:100,items:[],inventoryConfirmed:false});
  board.theirs.push({hero:'enemy-'+i,lvl:10,k:2,d:2,a:3,cs:100,items:[],inventoryConfirmed:false});
 });
 board.previous={sessionId:board.sessionId,at:board.at-60_000,clock:840,ours:clone(board.ours),theirs:clone(board.theirs)};
 return{board,setup,role,index:ROLE.indexOf(role)};
}
const run=(f,extra={})=>E.liveStrategy(f.board,f.setup,'me',{now:NOW,clock:900,nameOf:h=>'Hero '+h,...extra});
const allText=r=>[r.priority,r.lane,r.team,r.reason,...(r.evidence||[]),...(r.nextPush||[]),r.stop,r.rotation?.text].filter(Boolean).join(' ');
function shape(r){
 assert(Array.isArray(r.evidence),'visible supporting facts must be listed');
 assert(r.evidence.every(s=>typeof s==='string'&&s.trim()),'facts are readable sentences');
 assert.equal(r.nextPush?.length,3,'next trip gives three ordered actions');
 assert(r.nextPush.every(s=>typeof s==='string'&&s.trim()),'each action contains text');
 assert.equal(typeof r.stop,'string');assert(r.stop.trim().length>10,'a push needs an explicit exit condition');
 assert.equal(typeof r.decisionKey,'string');assert(r.decisionKey.length>0);
}
{
 const f=fixture(),r=run(f);shape(r);assert.equal(r.situation,'lane');assert.equal(r.rotation,null,'even lanes must not manufacture a rotation');
 assert.equal(r.decision.sessionId,f.board.sessionId);assert.equal(r.decision.hero,'ally-2');assert.equal(r.decision.role,'MIDLANE');assert.equal(r.decision.who,'me');
 const later=clone(f);later.board.scanId='another-capture';later.board.at+=500;later.board.ours[2].cs++;later.board.theirs[2].cs++;
 assert.equal(run(later).decisionKey,r.decisionKey,'scan IDs, time and minor farm changes do not create a new plan');
 const noPrevious=clone(f);delete noPrevious.board.previous;assert.equal(run(noPrevious).situation,'lane','one snapshot cannot establish a recent kill or death');
}
{
 const f=fixture();f.board.ours[f.index].d=3;const death=run(f);shape(death);assert.equal(death.situation,'reset');assert.match(death.evidence.join(' '),/death/i);
 const readAgain=run(f,{previousDecision:death.decision});assert.equal(readAgain.decisionKey,death.decisionKey,'re-rendering the same death scan must not count that death twice');assert.equal(readAgain.decision.repeatDeaths,false,'one observed death is not repeat deaths');
 assert(!/you are (?:still )?dead|you have respawned|enemy[^.]{0,30} (?:is|are) dead/i.test(allText(death)),'cumulative counters cannot prove current life or respawn state');
 const unchanged=clone(f);unchanged.board.previous={sessionId:f.board.sessionId,at:f.board.at,clock:900,ours:clone(f.board.ours),theirs:clone(f.board.theirs)};unchanged.board.at+=500;unchanged.board.ours[f.index].cs++;
 const carried=run(unchanged,{previousDecision:death.decision});assert.equal(carried.situation,'reset','a repeated scan does not erase the reset plan');assert.equal(carried.decisionKey,death.decisionKey);
 const wrong=clone(death.decision);wrong.sessionId='another-game';assert.notEqual(run(unchanged,{previousDecision:wrong}).situation,'reset','plans cannot carry across games');
 wrong.sessionId=f.board.sessionId;wrong.who='someone-else';assert.notEqual(run(unchanged,{previousDecision:wrong}).situation,'reset','plans cannot carry across players');
}
{
 const f=fixture();f.board.ours[f.index].k=3;const r=run(f);shape(r);assert.equal(r.situation,'convert');assert.match(r.evidence.join(' '),/kill/i);
 assert(!/enemy[^.]{0,30} (?:is|are) dead|respawn(?:s|ing)? in \d|\d+\s*(?:seconds|s) to push/i.test(allText(r)),'a kill gain is not a known remaining respawn window');
 f.board.ours[f.index].d=3;assert.equal(run(f).situation,'reset','a kill does not hide a new death');
}
{
 const mutations=[
  f=>{f.board.previous.sessionId='different-game';},
  f=>{f.board.previous.at=f.board.at+1;},
  f=>{f.board.previous.at=f.board.at-300_001;},
  f=>{f.board.previous.ours[f.index].hero='different-hero';},
  f=>{f.board.previous.theirs[0].hero='different-lineup';},
  f=>{f.board.ours[f.index].k=1;},
  f=>{f.board.ours[f.index].cs=99;},
 ];
 for(const mutate of mutations){const f=fixture();f.board.ours[f.index].d=3;mutate(f);assert.notEqual(run(f).situation,'reset','incomparable or regressing counters must not establish a new death');}
 const f=fixture();f.board.previous.ours[f.index].d=null;f.board.ours[f.index].d=3;assert.notEqual(run(f).situation,'reset','unread previous deaths are not zero');
 f.board.at=NOW-180_001;const stale=run(f);assert.equal(stale.fresh,false);assert.equal(stale.rotation,null);assert.notEqual(stale.situation,'convert');
}
{
 for(const field of ['k','d','lvl']){
  const missing=fixture();missing.board.ours[missing.index][field]=null;const r=run(missing);
  assert.equal(r.situation,'lane','a newly unread counter is not a kill/death event');
  assert.equal(r.decision.repeatDeaths,false,'unread measurements do not invent repeat deaths');
  assert(!/increased by/.test(r.evidence.join(' ')),'missing measurements are not fabricated counter increases');
 }
 const f=fixture();delete f.board.ours[f.index].lvl;delete f.board.theirs[f.index].lvl;const r=run(f);shape(r);assert.match(allText(r),/unread|unknown|not read/i);assert.notEqual(r.decision.posture,'pressure','missing levels with otherwise even stats cannot establish pressure');assert(!/you outlevel|you are \d+ levels? ahead/i.test(allText(r)),'missing levels cannot support an affirmative advantage');
}
{
 const f=fixture();f.board.theirs[0].lvl=13;const r=run(f);assert.equal(r.rotation?.kind,'avoid');assert.equal(r.rotation.role,'OFFLANE');assert.equal(r.rotation.hero,'enemy-0');assert.match(r.rotation.text,/solo|alone|without/i);
 const near=fixture();near.board.theirs[0].lvl=12;assert.notEqual(run(near).rotation?.kind,'avoid','two levels alone do not force an avoid call');near.board.theirs[0].k=7;near.board.theirs[0].d=1;assert.equal(run(near).rotation?.kind,'avoid','two levels plus a strong combat lead warrant caution');
}
{
 const f=fixture('JUNGLE');f.board.ours[f.index].lvl=12;f.board.ours[2].lvl=8;f.board.previous.ours[2].lvl=8;f.board.ours[2].d=3;f.board.theirs[2].lvl=10;
 const r=run(f);assert.equal(r.rotation?.kind,'support','a strong jungle lead can support a clearly struggling lane');assert.equal(r.rotation.role,'MIDLANE');assert.equal(r.rotation.hero,'ally-2');assert.match(r.rotation.text,/if|after|once|only/i,'rotation must state conditions, not invent a clear route');
 for(const me of ['CARRY','SUPPORT']){const duo=fixture(me),other=me==='CARRY'?3:4;duo.board.ours[duo.index].lvl=12;duo.board.ours[other].lvl=8;duo.board.previous.ours[other].lvl=8;duo.board.ours[other].d=3;duo.board.theirs[other].lvl=10;const call=run(duo).rotation;assert(!(call?.kind==='support'&&['CARRY','SUPPORT'].includes(call.role)),'Carry and Support must not be treated as separate rotation lanes');}
}
{
 const f=fixture(),event={kind:'countdown',at:850,respawnAt:930,source:'manual',confirmed:true,sessionId:f.board.sessionId,observedAt:NOW-1000};
 const call=ev=>run(f,{objectives:{fangtooth:ev}}),isObjective=r=>/fangtooth/i.test(allText(r));
 const prep=call(event);assert(isObjective(prep));assert.match(allText(prep),/vision|prepare|set up/i);
 const expected=call({...event,respawnAt:900});assert(isObjective(expected));assert.match(allText(expected),/expected|check.*map|verify/i,'elapsed timer requires verification, never confirmed availability');
 for(const change of [{confirmed:false},{sessionId:'other-game'},{observedAt:NOW-180_001},{observedAt:NOW+1},{at:901},{respawnAt:869},{respawnAt:961},{source:'estimated'}])assert(!isObjective(call({...event,...change})),'invalid, stale, far or unconfirmed timer cannot direct the next push');
 const support=fixture('JUNGLE');support.board.ours[support.index].lvl=12;support.board.ours[2].lvl=8;support.board.previous.ours[2].lvl=8;support.board.ours[2].d=3;
 const withObjective=run(support,{objectives:{fangtooth:{...event,sessionId:support.board.sessionId}}});
 assert.match(withObjective.priority,/Fangtooth/i);assert.notEqual(withObjective.rotation?.kind,'support','one next-push plan must not assign an objective setup and a separate lane rotation');
 const absent={...event};delete absent.sessionId;assert(!isObjective(call(absent)),'old provenance-free timers cannot direct a current match');
 assert(!isObjective(run(f,{clock:null,objectives:{fangtooth:event}})),'a timer requires a usable match clock');
}
{
 const f=fixture();f.board.ours[f.index].d=3;const reset=run(f),later=clone(f);later.board.previous=clone(f.board);delete later.board.previous.previous;later.board.at+=500;later.board.ours[later.index].lvl=null;
 assert.equal(run(later,{previousDecision:reset.decision}).decisionKey,reset.decisionKey,'an unread level alone does not reverse the conservative reset plan');
 const behind=fixture();behind.board.ours[behind.index].cs=70;behind.board.previous.ours[behind.index].cs=70;const recovery=run(behind);behind.board.ours[behind.index].cs=null;
 const unknown=run(behind,{previousDecision:recovery.decision});assert.equal(unknown.decision.posture,'recover');assert.equal(run(behind,{previousDecision:unknown.decision}).decisionKey,unknown.decisionKey,'repeated unread farm does not manufacture a recovery');
}
{
 const f=fixture('JUNGLE');f.board.ours[f.index].lvl=12;f.board.ours[2].lvl=9;f.board.previous.ours[2].lvl=9;f.board.ours[2].d=3;
 const initial=run(f);assert.equal(initial.rotation?.kind,'support');assert.equal(initial.rotation.role,'MIDLANE');
 const equivalent=clone(f);equivalent.board.previous={sessionId:f.board.sessionId,at:f.board.at,clock:f.board.clock,ours:clone(f.board.ours),theirs:clone(f.board.theirs)};equivalent.board.at+=500;
 const continued=run(equivalent,{previousDecision:initial.decision});
 assert.equal(continued.rotation?.kind,'support','an equivalent next scan must not discard the still-valid support intent');
 assert.equal(continued.rotation.role,'MIDLANE');assert.equal(continued.decisionKey,initial.decisionKey,'equivalent scan keeps the plan and automatic speech key');
 const recovered=clone(equivalent);recovered.board.ours[2].lvl=10;
 assert.notEqual(run(recovered,{previousDecision:continued.decision}).rotation?.kind,'support','a measured closed level gap can remove support intent');
 const objective={kind:'countdown',at:850,respawnAt:930,source:'manual',confirmed:true,sessionId:f.board.sessionId,observedAt:NOW-1000};
 const setupCall=run(equivalent,{previousDecision:continued.decision,objectives:{fangtooth:objective}});
 assert.match(setupCall.priority,/Fangtooth/);assert.notEqual(setupCall.rotation?.kind,'support','objective setup owns the next trip rather than retaining a competing rotation');
 const changedLineup=clone(equivalent);changedLineup.board.theirs[0].hero='new-enemy';changedLineup.setup.theirs.OFFLANE.hero='new-enemy';
 assert.notEqual(run(changedLineup,{previousDecision:continued.decision}).rotation?.kind,'support','a changed accepted lineup invalidates a prior-scan support event');
}
console.log('ok: concrete next-trip plans, comparable scan deltas, decision stability, optional lane calls and confirmed objective windows');

{
 const f=fixture();f.board.ours[f.index].lvl=8;f.board.ours[f.index].cs=70;
 const t=run(f);assert.match(t.nextPush[0],/two safe waves.*30 CS behind/);assert.match(t.nextPush[1],/Lv 10.*Lv 8/);
 const jungle=fixture('JUNGLE');jungle.board.ours[jungle.index].cs=70;assert.match(run(jungle).nextPush[0],/camp cycle/);
}
