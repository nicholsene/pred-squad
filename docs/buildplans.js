/* Reviewed build intentions. Never treat these records as owned equipment. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BuildPlans=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const ROLES=['OFFLANE','JUNGLE','MIDLANE','SUPPORT','CARRY'],NEEDS=['magical','physical','healing','shielding','physicalArmor','magicalArmor','health','crit','burst'],bad=new Set(['__proto__','prototype','constructor']);
 function id(v,label){if(typeof v!=='string'||!v||v.length>160||bad.has(v))throw new Error('Check '+label+'.');return v;}
 function clock(v,now,label){if(!Number.isFinite(v)||v<0||v>now)throw new Error('Check '+label+' time.');return v;}
 function context(input){const now=input.now??Date.now();if(!Number.isFinite(now))throw new Error('Check current time.');return{now,C:Object.fromEntries((input.catalog||[]).map(i=>[i.name,i])),H:new Set((input.heroes||[]).map(h=>h.slug))};}
 function item(v,C){id(v,'item');if(!C[v]||C[v].hidden||C[v].slot!=='PASSIVE'||!Number.isFinite(C[v].cost)||C[v].cost<1800||(C[v].rarity&&!['EPIC','LEGENDARY'].includes(C[v].rarity)))throw new Error('Choose a current equipment item.');return v;}
 function hero(v,H){id(v,'hero');if(H.size&&!H.has(v))throw new Error('Choose a current hero.');return v;}
 function createBaseline(input){const{now,C,H}=context(input);if(input.confirmed!==true)throw new Error('Confirm all six intended items first.');if(!Array.isArray(input.items)||input.items.length!==6)throw new Error('The starting plan needs six reviewed equipment targets.');const who=id(input.who,'player'),h=hero(input.hero,H),patch=id(input.patch,'patch'),sessionId=id(input.sessionId,'match');if(!ROLES.includes(input.role))throw new Error('Choose a valid lane.');const items=input.items.map(n=>item(n,C)),nextItem=input.nextItem==null?null:item(input.nextItem,C);if(new Set(items).size!==items.length)throw new Error('Use each planned item once.');for(const n of items)if(items.some(other=>other!==n&&[...(C[n].blocks||[]),...(C[n].blockedBy||[])].includes(other)))throw new Error('These planned items cannot be equipped together.');if(nextItem&&!items.includes(nextItem))throw new Error('The next target must be in the starting plan.');return{schema:1,who,hero:h,role:input.role,patch,sessionId,items,nextItem,confirmed:true,source:input.source==='photo'?'photo':input.source==='suggestion'?'suggestion':'manual',...(STYLES.some(s=>s.id===input.style)?{style:input.style}:{}),reviewedAt:clock(input.reviewedAt??now,now,'review')};}
 function createPivot(input){const{now,C,H}=context(input),who=id(input.who,'player'),h=hero(input.hero,H),patch=id(input.patch,'patch'),sessionId=id(input.sessionId,'match'),target=item(input.item,C);if(!ROLES.includes(input.role))throw new Error('Choose the pivot lane.');if(!NEEDS.includes(input.answerKey))throw new Error('Choose a current counter need.');if(!Array.isArray(input.targets)||input.targets.length>5)throw new Error('Check enemy targets.');const targets=[...new Set(input.targets.map(t=>hero(t,H)))],boardAt=clock(input.boardAt,now,'snapshot'),selectedAt=clock(input.selectedAt??now,now,'selection');if(selectedAt<boardAt)throw new Error('Selection predates the snapshot.');return{schema:1,who,hero:h,role:input.role,patch,sessionId,item:target,targets,answerKey:input.answerKey,boardAt,selectedAt,countsAsOwned:false};}
 function getBaseline({plans={},who,hero:h,role,patch,sessionId,now=Date.now(),catalog=[],heroes=[]}={}){const r=plans?.[who];if(!r)return{status:'missing',plan:null,reasons:['Starting build not shared.']};let plan;try{plan=createBaseline({...r,now,catalog,heroes});}catch(e){return{status:'review-required',plan:null,reasons:[e.message]};}const reasons=[];if(plan.who!==who||plan.hero!==h)reasons.push('The player or hero changed.');if(role&&plan.role!==role)reasons.push("The player's lane changed.");if(plan.patch!==patch)reasons.push('The item patch changed.');if(plan.sessionId!==sessionId)reasons.push('This is a different match.');return{status:reasons.length?'review-required':'ready',plan,reasons};}
 function getPivot({pivots={},who,hero:h,role,patch,sessionId,boardAt,now=Date.now(),catalog=[],heroes=[],snapshotMaxAgeMs=180000}={}){const r=pivots?.[who];if(!r)return{status:'missing',intent:null,reasons:[]};let intent;try{intent=createPivot({...r,now,catalog,heroes});}catch(e){return{status:'review-required',intent:null,reasons:[e.message]};}const reasons=[];if(intent.who!==who||intent.hero!==h)reasons.push('The player or hero changed.');if(role&&intent.role!==role)reasons.push('The player’s lane changed.');if(intent.patch!==patch)reasons.push('The item patch changed.');if(intent.sessionId!==sessionId)reasons.push('This is a different match.');if(intent.boardAt!==boardAt)reasons.push('A new snapshot needs this intent reviewed again.');if(!Number.isFinite(boardAt)||boardAt>now||now-boardAt>snapshotMaxAgeMs)reasons.push('The supporting observation is stale.');return{status:reasons.length?'review-required':'current',intent,reasons};}
 function compare({baseline,pivot,owned=[],catalog=[]}={}){const C=Object.fromEntries(catalog.map(i=>[i.name,i])),target=typeof pivot==='string'?pivot:pivot?.item,plan=baseline?.plan||baseline,plannedNext=plan?.nextItem||null,label=n=>C[n]?.label||n;let kind='no-baseline',description='Share a reviewed starting plan to explain what this response delays.';if(target&&owned.includes(target)){kind='already-owned';description='This response item is already confirmed in your inventory.';}else if(plan?.confirmed===true&&target){if(target===plannedNext){kind='continue';description='Continue toward your planned '+label(target)+'; it also answers the observed threat.';}else if(plannedNext){kind=plan.items.includes(target)?'advance':'insert';description=(kind==='advance'?'Bring ':'Consider ')+label(target)+' before your planned '+label(plannedNext)+'. This delays that purchase; owned equipment stays unchanged.';}else{kind='review-order';description='Compare '+label(target)+' with your reviewed six-item plan; the next intended target is unknown.';}}return{kind,plannedNext,target:target||null,description,ownedChanged:false};}
 function team({plans={},pivots={},setup={},patch,sessionId,boardAt,now=Date.now(),catalog=[],heroes=[],snapshotMaxAgeMs=180000}={}){const members=[],reservations=[];for(const role of ROLES){const o=setup.ours?.[role];if(!o?.who)continue;const base=getBaseline({plans,who:o.who,hero:o.hero,role,patch,sessionId,now,catalog,heroes}),pivot=getPivot({pivots,who:o.who,hero:o.hero,role,patch,sessionId,boardAt,now,catalog,heroes,snapshotMaxAgeMs});members.push({who:o.who,hero:o.hero,role,baselineStatus:base.status,pivotStatus:pivot.status,plannedItem:pivot.intent?.item||null,reasons:[...base.reasons,...pivot.reasons]});if(pivot.status==='current')reservations.push({who:o.who,hero:o.hero,item:pivot.intent.item,answerKey:pivot.intent.answerKey,targets:pivot.intent.targets,selectedAt:pivot.intent.selectedAt,countsAsOwned:false,status:'planned'});}reservations.sort((a,b)=>a.selectedAt-b.selectedAt||a.who.localeCompare(b.who));return{members,reservations,baselinesReady:members.filter(m=>m.baselineStatus==='ready').length,membersCount:members.length,countsAsOwned:false};}
 // Starting suggestions use current catalogue stats; they are not observed inventory
 // or claims about optimal DPS/win rate. Adoption still uses createBaseline validation.
 const STYLES=[
  {id:'balanced',label:'Recommended',tip:'Balance your hero’s main job, sustain and useful protection or damage.'},
  {id:'aggressive',label:'Aggressive damage',tip:'Trade some protection for pressure. Keep an escape route and avoid isolated fights.'},
  {id:'attack-speed',label:'Attack speed',tip:'Favor repeated basic attacks. Keep moving between attacks and respect enemy crowd control.'},
  {id:'crit',label:'Critical strike',tip:'Build toward stronger basic attacks. Farm consistently and fight from a safe position.'},
  {id:'anti-tank',label:'Anti-tank',tip:'Favor penetration or shred. Hit a safe reachable target rather than chasing past their frontline.'},
  {id:'sustain',label:'Lifesteal / sustain',tip:'Recover through damage or regeneration. You still need a safe target; enemy anti-heal can reduce recovery.'},
  {id:'mana',label:'Mana regen / sustain',tip:'Favor mana regeneration and a larger mana pool. Manage ability use; sustain does not remove cooldowns.'},
  {id:'durable',label:'Durable',tip:'Add protection while keeping your hero’s main job. Defense is not a reason to dive alone.'}
 ];
 const stat=(it,k)=>Number.isFinite(it?.stats?.[k])?Math.max(0,it.stats[k]):0;
 function suggestionContext({hero:slug,role,catalog=[],heroes=[]}={}){
  const h=heroes.find(h=>h.slug===slug);if(!h||!ROLES.includes(role))return null;
  const classes=h.classes||[],marksman=classes.includes('SHARPSHOOTER'),tank=classes.some(c=>['TANK','WARDEN'].includes(c)),support=role==='SUPPORT'&&classes.some(c=>['ENCHANTER','SUPPORT','CATCHER'].includes(c));
  const desc=(h.abilities||[]).filter(a=>!['BASIC','PASSIVE'].includes(a.key)).map(a=>a.menuDescription||'').join(' '),ap=(desc.match(/APIconBlue/g)||[]).length,ad=(desc.match(/ADIconOrange/g)||[]).length;
  const damage=marksman?'physical':classes.some(c=>['MAGE','ENCHANTER'].includes(c))||ap>ad?'magical':'physical';
  const mana=(h.attributes||[]).find(a=>a.stat==='MAX_MANA'||a.stat==='MANA'),hasMana=!mana||mana.values?.[0]>0;
  const pool=catalog.filter(it=>{try{item(it.name,{[it.name]:it});}catch{return false;}const wrong=damage==='physical'?'MAGICAL_POWER':'PHYSICAL_POWER';if(stat(it,wrong)>0)return false;
   if(marksman&&stat(it,'HEAL_AND_SHIELD_POWER')>0)return false;
   // Pure healing/mana support equipment is not a carry's offensive core.
   return true;
  });return{h,role,classes,marksman,tank,support,damage,pool,hasMana};
 }
 function focused(it,style,c){
  if(style==='sustain')return stat(it,c.damage==='physical'?'LIFESTEAL':'MAGICAL_LIFESTEAL')+stat(it,'OMNIVAMP')>0||c.tank&&stat(it,'BASE_HEALTH_REGENERATION')>0||c.support&&stat(it,'HEAL_AND_SHIELD_POWER')>0;
  if(style==='mana')return stat(it,'BASE_MANA_REGENERATION')>0||stat(it,'MANA')>0;
  if(style==='crit')return stat(it,'CRITICAL_CHANCE')>0;
  if(style==='attack-speed')return stat(it,'ATTACK_SPEED')>0;
  if(style==='anti-tank')return ['ANTI_TANK',c.damage==='physical'?'PHYSICAL_SHRED':'MAGICAL_SHRED'].includes(it.type)||stat(it,c.damage==='physical'?'PHYSICAL_PENETRATION':'MAGICAL_PENETRATION')>0;
  if(style==='durable')return stat(it,'HEALTH')>0&&(stat(it,'PHYSICAL_ARMOR')>0||stat(it,'MAGICAL_ARMOR')>0)||['ANTI_BURST','SPELL_SHIELD'].includes(it.type);
  return false;
 }
 function stylesFor(input={}){const c=suggestionContext(input);if(!c)return[];return STYLES.filter(s=>s.id!=='mana'||c.hasMana).filter(s=>!['crit','attack-speed'].includes(s.id)||c.marksman).filter(s=>['balanced','aggressive'].includes(s.id)||c.pool.some(it=>focused(it,s.id,c))).map(s=>({...s,label:s.id==='durable'&&c.tank?'Tank / durability':s.id==='sustain'&&c.support?'Healing / sustain':s.label}));}
 function suggest(input={}){
  const c=suggestionContext(input),style=input.style||'balanced';if(!c)return{status:'needs-context',items:[],reason:'Choose your hero and lane to see a starting build.'};
  if(!['reviewed','initial-baseline'].includes(input.patchReview?.status))return{status:'review-required',items:[],reason:'Current item data needs review before a new build can be suggested.'};
  const choice=stylesFor(input).find(s=>s.id===style);if(!choice)return{status:'unsupported-style',items:[],reason:'Choose a style suited to this hero.'};
  const selected=[],totals={},power=c.damage==='physical'?'PHYSICAL_POWER':'MAGICAL_POWER',penetration=c.damage==='physical'?'PHYSICAL_PENETRATION':'MAGICAL_PENETRATION';
  const legal=it=>!selected.some(s=>s.name===it.name||[...(it.blocks||[]),...(it.blockedBy||[])].includes(s.name)||[...(s.blocks||[]),...(s.blockedBy||[])].includes(it.name));
  const score=it=>{
   let n=stat(it,power)/50*(c.tank?.6:1.5)+stat(it,'ABILITY_HASTE')/20*(c.marksman?.25:1)+stat(it,'HEALTH')/400*(c.tank?1.5:.35)+((stat(it,'PHYSICAL_ARMOR')+stat(it,'MAGICAL_ARMOR'))/50)*(c.tank?1.5:.2);
   if(c.classes.includes(it.class))n+=1;
   if(c.marksman)n+=stat(it,'ATTACK_SPEED')/35+Math.min(stat(it,'CRITICAL_CHANCE'),Math.max(0,100-(totals.CRITICAL_CHANCE||0)))/25*.65;
   if(c.support)n+=stat(it,'HEAL_AND_SHIELD_POWER')/10*2+stat(it,'BASE_MANA_REGENERATION')/100+(['SUPPORT'].includes(it.class)?1:0);
   if(style==='aggressive')n+=stat(it,power)/50*2+stat(it,penetration)/15+(it.type==='BURST'?1:0);
   if(style==='attack-speed')n+=stat(it,'ATTACK_SPEED')/30*3;
   if(style==='crit')n+=Math.min(stat(it,'CRITICAL_CHANCE'),Math.max(0,100-(totals.CRITICAL_CHANCE||0)))/20*3+(it.type==='CRIT_AMP'?1:0);
   if(style==='mana')n+=stat(it,'BASE_MANA_REGENERATION')/100*1.5+stat(it,'MANA')/400;
   if(style==='sustain')n+=(stat(it,c.damage==='physical'?'LIFESTEAL':'MAGICAL_LIFESTEAL')+stat(it,'OMNIVAMP'))/10*2;
   if(style==='durable')n+=((stat(it,'PHYSICAL_ARMOR')+stat(it,'MAGICAL_ARMOR'))/50+stat(it,'HEALTH')/400)*(c.tank?2:.25);
   // Diminish repeated utility; do not fill every slot with the same answer.
   if(it.type&&selected.some(s=>s.type===it.type))n-=.6;
   if((totals.CRITICAL_CHANCE||0)>=100&&stat(it,'CRITICAL_CHANCE')>0)n-=2;
   return n;
  };
  const add=filter=>{const it=c.pool.filter(it=>legal(it)&&(!filter||filter(it))).sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name))[0];if(!it)return false;selected.push(it);for(const[k,v]of Object.entries(it.stats||{}))if(Number.isFinite(v))totals[k]=(totals[k]||0)+v;return true;};
  // Start with the hero's core job, then satisfy the chosen style with real stat evidence.
  add(it=>c.tank?focused(it,'durable',c):c.support?it.class==='SUPPORT':stat(it,power)>0&&(c.marksman?stat(it,'ATTACK_SPEED')>0:true));
  if(!['balanced','aggressive'].includes(style)){
   const wanted=style==='durable'&&!c.tank?1:2;
   for(let n=selected.filter(it=>focused(it,style,c)).length;n<wanted;n++)if(!add(it=>focused(it,style,c)))break;
  }
  if(style==='balanced'&&!selected.some(it=>focused(it,'sustain',c)))add(it=>focused(it,'sustain',c));
  if(!c.support&&!c.tank&&!selected.some(it=>focused(it,'anti-tank',c)))add(it=>focused(it,'anti-tank',c));
  while(selected.length<6)if(!add(it=>c.marksman?stat(it,power)>0||stat(it,'ATTACK_SPEED')>0:c.tank?stat(it,'HEALTH')>0||stat(it,'PHYSICAL_ARMOR')>0||stat(it,'MAGICAL_ARMOR')>0:c.support?it.class==='SUPPORT'||stat(it,'HEAL_AND_SHIELD_POWER')>0:stat(it,power)>0))break;
  if(selected.length!==6)return{status:'insufficient-items',items:[],reason:'Six compatible current items are unavailable. Review a custom build instead.'};
  return{status:'ready',hero:c.h.slug,role:c.role,style,label:choice.label,tip:choice.tip,items:selected.map(it=>it.name),cost:selected.reduce((n,it)=>n+it.cost,0),stats:totals,damage:c.damage,countsAsOwned:false,source:'catalogue-suggestion'};
 }
 function serialize({plans={},pivots={},catalog=[],heroes=[],now=Date.now()}={}){const clean={plans:{},pivots:{}};for(const[who,r]of Object.entries(plans))try{const p=createBaseline({...r,catalog,heroes,now});if(p.who===who)clean.plans[who]=p;}catch{}for(const[who,r]of Object.entries(pivots))try{const p=createPivot({...r,catalog,heroes,now});if(p.who===who)clean.pivots[who]=p;}catch{}return clean;}
 return{suggest,stylesFor,createBaseline,createPivot,getBaseline,getPivot,compare,team,serialize};
});
