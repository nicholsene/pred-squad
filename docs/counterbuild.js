/* Confirmed-photo lobby counterbuild priorities; not win probabilities. */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.CounterBuild=factory();})(typeof self!=="undefined"?self:this,function(){
 "use strict";
 const ROLES=["OFFLANE","JUNGLE","MIDLANE","SUPPORT","CARRY"],finite=x=>typeof x==="number"&&Number.isFinite(x);
 const stat=(it,k)=>finite(it?.stats?.[k])?it.stats[k]:0,type=(it,...keys)=>keys.includes(it?.type),clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
 const current=(t,now,age)=>finite(t)&&t<=now&&now-t<=age;
 const finalItem=it=>it&&!it.hidden&&it.slot==="PASSIVE"&&it.cost>=1800&&(!it.rarity||["EPIC","LEGENDARY"].includes(it.rarity));
 function profile(names,C){
  const p={physical:0,magical:0,healing:0,shielding:0,health:0,physicalArmor:0,magicalArmor:0,crit:0,burst:0,antiHeal:0,antiShield:0,antiCrit:0,antiBurst:0};
  for(const n of names||[]){const it=C[n];if(!it||it.slot==="TRINKET")continue;
   p.physical+=stat(it,"PHYSICAL_POWER");p.magical+=stat(it,"MAGICAL_POWER");
   p.healing+=stat(it,"LIFESTEAL")+stat(it,"MAGICAL_LIFESTEAL")+stat(it,"OMNIVAMP")+(type(it,"SUSTAIN","REGEN","SUSTAINED_FIGHTING","HEALING_AND_SHIELDING")?10:0);
   p.shielding+=stat(it,"HEAL_AND_SHIELD_POWER")+(type(it,"SHIELDING","HEALING_AND_SHIELDING")?10:0);
   p.health+=stat(it,"HEALTH");p.physicalArmor+=stat(it,"PHYSICAL_ARMOR");p.magicalArmor+=stat(it,"MAGICAL_ARMOR");p.crit+=stat(it,"CRITICAL_CHANCE");
   p.burst+=type(it,"BURST","POKE","ULTIMATE_DAMAGE","DAMAGE_AMP")?1:0;
   p.antiHeal+=type(it,"ANTI_HEAL")?1:0;p.antiShield+=type(it,"ANTI_SHIELD")?1:0;p.antiCrit+=type(it,"ANTI_CRIT")?1:0;p.antiBurst+=type(it,"ANTI_BURST","SPELL_SHIELD")?1:0;
  }return p;
 }
 function observation(row,selected,boardAt,now,age,C){
  const hero=selected?.hero||row?.hero||null,identityOk=!!row&&(!selected?.hero||row.hero===selected.hero),inventoryAt=row?.inventoryAt??boardAt;
  const confirmed=identityOk&&row.inventoryConfirmed===true&&Array.isArray(row.items)&&current(inventoryAt,now,age,C);
  const names=confirmed?row.items.filter(n=>typeof n==="string"&&C[n]):[];
  const complete=confirmed&&(row.inventoryComplete===true||(row.inventoryComplete!==false&&row.items.length===0));
  const unread=confirmed&&!complete?row.items.filter(n=>!n||!C[n]).length+Math.max(0,6-row.items.length):0;
  return {hero,identityOk,confirmed,inventoryAt,names,complete,unread,profile:profile(names,C),row:identityOk?row:{}};
 }
 function damage(o,H,matches,C){
  const p=o.profile,total=p.physical+p.magical;
  if(total>0){if(p.physical/total>=.75)return{type:"physical",source:"observed items"};if(p.magical/total>=.75)return{type:"magical",source:"observed items"};return{type:"mixed",source:"observed items"};}
  const hero=H[o.hero];if(!hero)return{type:"unknown",source:"unknown hero"};
  const classes=hero.classes||[];
  if(classes.includes("MAGE"))return{type:"magical",source:"hero class; verify your build"};
  if(classes.includes("SHARPSHOOTER"))return{type:"physical",source:"hero class; verify your build"};
  let phys=0,mag=0,n=0;
  for(const m of matches)for(const x of m.players||[])if(x.hero===o.hero&&Array.isArray(x.items)){const q=profile(x.items,C);phys+=q.physical;mag+=q.magical;n++;}
  if(n>=5&&phys+mag>0){if(phys/(phys+mag)>=.8)return{type:"physical",source:`historical item preference (${n} games); verify your build`};if(mag/(phys+mag)>=.8)return{type:"magical",source:`historical item preference (${n} games); verify your build`};}
  return{type:"unknown",source:"insufficient damage-type evidence"};
 }
 const RULES=[
 {key:"magical",label:"magical-power build",test:p=>p.magical>=30,buy:it=>stat(it,"MAGICAL_ARMOR")>=20||type(it,"ANTI_MAGIC"),owned:p=>p.magicalArmor>=40,answer:"magical defense",personal:true},
 {key:"physical",label:"physical-power build",test:p=>p.physical>=25,buy:it=>stat(it,"PHYSICAL_ARMOR")>=20,owned:p=>p.physicalArmor>=40,answer:"physical defense",personal:true},
 {key:"healing",label:"healing / lifesteal items",test:p=>p.healing>0,buy:it=>type(it,"ANTI_HEAL"),owned:p=>p.antiHeal>0,answer:"anti-heal",team:true},
 {key:"shielding",label:"shield-oriented items",test:p=>p.shielding>0,buy:it=>type(it,"ANTI_SHIELD"),owned:p=>p.antiShield>0,answer:"anti-shield",team:true},
 {key:"physicalArmor",label:"physical armor stack",test:p=>p.physicalArmor>=50,buy:(it,d)=>d==="physical"&&(type(it,"PHYSICAL_SHRED")||stat(it,"PHYSICAL_PENETRATION")>=10),owned:()=>false,answer:"physical penetration / shred",damage:"physical"},
 {key:"magicalArmor",label:"magical armor stack",test:p=>p.magicalArmor>=50,buy:(it,d)=>d==="magical"&&(type(it,"MAGICAL_SHRED")||stat(it,"MAGICAL_PENETRATION")>=10),owned:()=>false,answer:"magical penetration / shred",damage:"magical"},
 {key:"health",label:"high-health items",test:p=>p.health>=600,buy:it=>type(it,"ANTI_TANK"),owned:()=>false,answer:"anti-tank damage"},
 {key:"crit",label:"critical-strike items",test:p=>p.crit>=20,buy:it=>type(it,"ANTI_CRIT"),owned:p=>p.antiCrit>0,answer:"anti-crit defense",personal:true},
 {key:"burst",label:"burst-oriented items",test:p=>p.burst>0,buy:it=>type(it,"ANTI_BURST","SPELL_SHIELD"),owned:p=>p.antiBurst>0,answer:"anti-burst / spell shield",personal:true}];
 function fit(it,d,classes){const phys=stat(it,"PHYSICAL_POWER"),mag=stat(it,"MAGICAL_POWER");if(d==="physical"&&mag>0||d==="magical"&&phys>0)return null;if(d==="unknown"&&(phys>0||mag>0))return null;return (d==="physical"&&phys>0||d==="magical"&&mag>0?.6:0)+(classes.includes(it.class)?.35:0);}
 function plan({items=[],heroes=[],matches=[],setup={},board=null,now=Date.now(),snapshotMaxAgeMs=180000,patchReview=null}={}){
  const C=Object.fromEntries(items.map(i=>[i.name,i])),H=Object.fromEntries(heroes.map(h=>[h.slug,h])),name=h=>H[h]?.name||h||"Unknown hero";
  const result={status:"needs-observation",threats:[],players:[],warnings:[]},fresh=!!board&&current(board.at,now,snapshotMaxAgeMs);
  if(!fresh){result.status=board?"stale":"needs-observation";result.warnings.push(board?"Snapshot is stale or has an invalid time. Confirm a new scoreboard and inventories.":"Confirm a scoreboard photo and inventories for current counterbuild advice.");}
  const us=ROLES.map((role,i)=>({...observation(fresh?board.ours?.[i]:null,setup.ours?.[role],board?.at,now,snapshotMaxAgeMs,C),role,who:setup.ours?.[role]?.who||null}));
  const them=ROLES.map((role,i)=>({...observation(fresh?board.theirs?.[i]:null,setup.theirs?.[role],board?.at,now,snapshotMaxAgeMs,C),role}));
  const confirmedEnemies=them.filter(o=>o.confirmed).length;
  if(fresh&&confirmedEnemies&&us.some(o=>o.who&&o.confirmed))result.status="ready";
  if(fresh&&confirmedEnemies<5)result.warnings.push(`${5-confirmedEnemies} enemy inventories are unconfirmed; lobby coverage is incomplete.`);
  for(let i=0;i<them.length;i++){
   const e=them[i];if(!e.hero)continue;const er=e.row,ar=us[i].row;
   const levelGap=finite(er.lvl)&&finite(ar.lvl)?er.lvl-ar.lvl:null,goldGap=finite(er.gold)&&finite(ar.gold)?er.gold-ar.gold:null;
   const killsLead=finite(er.k)&&finite(er.d)?Math.max(0,er.k-er.d):0,priority=1+clamp(levelGap||0,0,4)*.6+clamp((goldGap||0)/2500,0,2)+Math.min(1.5,killsLead*.12);
   const signals=e.confirmed?RULES.filter(r=>r.test(e.profile)).map(r=>({key:r.key,label:r.label,value:e.profile[r.key]})):[],reasons=[];
   if(levelGap>0)reasons.push(`${levelGap} levels above their same-role opponent`);if(goldGap>0)reasons.push(`${Math.round(goldGap)} more total earned gold than their same-role opponent`);
   if(!e.identityOk)reasons.push("Photo hero differs from the lineup; reconfirm this row");if(!e.confirmed)reasons.push("Inventory unconfirmed; no current item build is assumed");
   if(e.confirmed&&!e.names.length)reasons.push(e.complete?"Confirmed empty inventory":"No recognized items confirmed");
   result.threats.push({role:e.role,hero:e.hero,label:name(e.hero),priority,source:e.confirmed?"confirmed":"unknown",items:e.names,signals,levelGap,goldGap,reasons,inventoryAt:e.confirmed?e.inventoryAt:null,observationAgeMs:e.confirmed?now-e.inventoryAt:null});
  }
  result.threats.sort((a,b)=>b.priority-a.priority||a.role.localeCompare(b.role));
  const covered=new Map(),damageBy=new Map();for(const o of us)damageBy.set(o.role,damage(o,H,matches,C));
  const blocked=(it,o)=>(it.blockedBy||[]).some(n=>o.names.includes(n))||(it.blocks||[]).some(n=>o.names.includes(n))||o.names.some(n=>(C[n]?.blocks||[]).includes(it.name));
  const capacity=o=>o.complete&&o.names.filter(n=>C[n]?.slot==="PASSIVE").length<6?2:!o.complete?1:0;
  const options=(o,rule)=>{const d=damageBy.get(o.role).type;return items.filter(finalItem).filter(it=>!o.names.includes(it.name)&&!(o.row.excludedItems||[]).includes(it.name)).filter(it=>!blocked(it,o)&&rule.buy(it,d)).map(it=>({it,fit:fit(it,d,H[o.hero]?.classes||[])})).filter(x=>x.fit!=null).sort((a,b)=>b.fit-a.fit||a.it.cost-b.it.cost||a.it.name.localeCompare(b.it.name));};
  const utilityOwner=new Map();
  for(const rule of RULES.filter(r=>r.team)){
   const owners=us.filter(o=>o.confirmed&&rule.owned(o.profile));
   if(owners.length)covered.set(rule.key,owners.map(o=>o.who||`${name(o.hero)} (${o.role})`));
   else{const fits=us.filter(o=>o.who&&o.confirmed).map(o=>({o,best:options(o,rule)[0]})).filter(x=>x.best).sort((a,b)=>capacity(b.o)-capacity(a.o)||b.best.fit-a.best.fit||(a.o.role==="SUPPORT"?-1:b.o.role==="SUPPORT"?1:0));if(fits.length)utilityOwner.set(rule.key,fits[0].o.who);}
  }
  for(const o of us.filter(o=>o.who)){
   const d=damageBy.get(o.role),row=o.row,out={who:o.who,hero:o.hero,role:o.role,damageType:d.type,damageSource:d.source,status:!fresh?result.status:o.confirmed?"ready":"needs-inventory",levelDisadvantages:[],guidance:[],recommendations:[],ownedAnswers:[],observationAgeMs:o.confirmed?now-o.inventoryAt:null};result.players.push(out);
   if(!fresh){out.guidance.push("Reconfirm a recent scoreboard before relying on current build advice.");continue;}if(!o.identityOk){out.guidance.push("Photo hero differs from the selected hero. Confirm the lineup first.");continue;}
   if(!o.confirmed){out.guidance.push("Confirm your item slots, including unread slots, before checking purchases against your inventory.");continue;}
   if(o.unread)out.guidance.push(`${o.unread} unread item slots: check a suggested item is not already owned.`);
   const full=o.names.filter(n=>C[n]?.slot==="PASSIVE").length>=6;if(full)out.guidance.push("Six equipment slots are occupied. Evaluate any suggestion as a later swap; do not sell automatically.");
   for(const t of result.threats){const er=them.find(e=>e.role===t.role)?.row;if(finite(row.lvl)&&finite(er?.lvl)&&er.lvl-row.lvl>=2)out.levelDisadvantages.push({hero:t.hero,role:t.role,gap:er.lvl-row.lvl});}
   if(out.levelDisadvantages.length)out.guidance.push("You are at least two levels below an enemy threat. Take safe waves with vision and fight with teammates. A counter item does not remove the level gap.");
   for(const [key,owners]of covered)out.ownedAnswers.push(`${RULES.find(r=>r.key===key).answer} already held by ${owners.join(", ")}`);
   const candidates=[];
   for(const rule of RULES){
    const sources=result.threats.filter(t=>t.source==="confirmed"&&t.signals.some(s=>s.key===rule.key));
    if(!sources.length||rule.damage&&rule.damage!==d.type)continue;if(rule.team&&(covered.has(rule.key)||utilityOwner.get(rule.key)!==o.who))continue;
    if(rule.owned(o.profile)||o.names.some(n=>finalItem(C[n])&&rule.buy(C[n],d.type))){out.ownedAnswers.push(`${rule.answer} is already present in your confirmed items`);continue;}
    const candidate=options(o,rule)[0];if(!candidate)continue;const it=candidate.it,currentGold=finite(row.currentGold)&&row.currentGold>=0?row.currentGold:null;
    const components=o.names.some(n=>!finalItem(C[n])&&C[n]?.slot==="PASSIVE"),affordable=!o.complete||currentGold==null?null:currentGold>=it.cost?true:components?null:false;
    const priority=sources.reduce((n,t)=>n+t.priority,0)+(rule.personal&&out.levelDisadvantages.length?.8:0);
    const reasons=[`${sources.map(t=>`${t.label} (${t.role})`).join(", ")} show ${rule.label} in confirmed inventories across the lobby.`,`${rule.answer} answers that observed item pattern; it does not guarantee an outcome.`];
    if(rule.personal&&out.levelDisadvantages.length)reasons.push("This is a personal defensive option against threats outside your lane.");
    if(!o.complete)reasons.push("Verify unread inventory slots before buying; the item may already be owned or require a free slot.");if(currentGold==null)reasons.push("Spendable gold is unknown. Scoreboard total earned gold is never treated as your shopping budget.");if(components)reasons.push("Full catalogue price shown; check the shop for component upgrade cost. Recipe deductions are not inferred.");if(d.source!=="observed items")reasons.push(`Item fit uses ${d.source}.`);
    candidates.push({item:it,priority,answer:rule.answer,answerKey:rule.key,targets:sources.map(t=>t.hero),reasons,action:full?"consider-swap":!o.complete?"verify-inventory":affordable===true?"buy":"save",affordable,currentGold,fullCost:it.cost,remainingCost:components?null:it.cost,confidence:o.unread||sources.some(t=>them.find(e=>e.role===t.role)?.unread)?"limited":"observed",teamAssigned:!!rule.team});
   }
   candidates.sort((a,b)=>b.priority-a.priority||a.fullCost-b.fullCost||a.item.name.localeCompare(b.item.name));const selected=new Set();for(const c of candidates){if(selected.has(c.item.name))continue;out.recommendations.push(c);selected.add(c.item.name);if(out.recommendations.length===3)break;}
   if(!out.recommendations.length)out.guidance.push(confirmedEnemies?"No additional suitable counter is supported by the confirmed inventories, or the team already covers the observed utility need.":"Confirm enemy inventory slots to identify an actual counterbuild need.");
  }
  if(patchReview && !["reviewed","initial-baseline"].includes(patchReview.status)){
    result.status="patch-review-required";result.warnings.push("Patch data or counter rules changed. Review the patch delta before using item prescriptions.");
    for(const p of result.players){p.recommendations=[];p.status="patch-review-required";}
  }else if(patchReview?.status==="initial-baseline")result.warnings.push("Initial catalogue baseline: rules have not yet been signed off against official patch notes.");
  return result;
 }
 return{plan,profile};
});
