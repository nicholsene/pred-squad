/* Historical preferences and measured rates, not personality or win predictions. */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.SquadProfiles=factory();})(typeof self!=="undefined"?self:this,function(){
"use strict";
const LIMITS=Object.freeze({personal:5,role:10,reference:10,prior:5,maxWeight:.05}),ROLES=["OFFLANE","JUNGLE","MIDLANE","SUPPORT","CARRY"];
const DEFINITIONS={farming:["cs","Minions per minute"],damage:["heroDmg","Hero damage per minute"],vision:["wards","Wards placed per minute"],deaths:["d","Deaths per minute"]};
const finite=x=>typeof x==="number"&&Number.isFinite(x),stamp=x=>finite(x)?x:typeof x==="string"?Date.parse(x):NaN,validNumber=x=>finite(x)&&x>=0;
function measured(p,key){return p?.measured?.[key]===true&&validNumber(p[key]);}
function summarize(rows,key){const valid=rows.filter(r=>measured(r.p,key)),total=valid.reduce((s,r)=>s+r.p[key],0),minutes=valid.reduce((s,r)=>s+r.minutes,0);return{appearances:valid.length,matches:new Set(valid.map(r=>r.m.id)).size,missing:rows.length-valid.length,total,minutes,rate:minutes>0?total/minutes:null};}
function compare(rows,who,hero,key,label){
 const mine=rows.filter(r=>r.p.squad===who),others=rows.filter(r=>r.p.squad!==who),personalHeroRole=summarize(mine.filter(r=>r.p.hero===hero),key),personalRole=summarize(mine,key),referenceHeroRole=summarize(others.filter(r=>r.p.hero===hero),key),referenceRole=summarize(others,key),evidence={personalHeroRole,personalRole,referenceHeroRole,referenceRole};
 let scope="hero-role",p=personalHeroRole,b=referenceHeroRole,min=LIMITS.personal;
 if(!(p.matches>=min&&b.matches>=LIMITS.reference)){scope="role";p=personalRole;b=referenceRole;min=LIMITS.role;}
 if(!(p.matches>=min&&b.matches>=LIMITS.reference))return{status:"insufficient-data",scope:null,label,evidence,confidence:"insufficient",direction:"unknown",shrunkRate:null,relativeDifference:null,text:"Not enough measured history in this patch and mode."};
 const strength=p.matches/(p.matches+LIMITS.prior),shrunkRate=strength*p.rate+(1-strength)*b.rate,relativeDifference=b.rate>0?(shrunkRate-b.rate)/b.rate:null,direction=relativeDifference===null?"unknown":relativeDifference>.2?"above":relativeDifference<-.2?"below":"similar",confidence=scope==="hero-role"&&p.matches>=20&&b.matches>=20?"moderate":"limited";
 return{status:"descriptive",scope,label,evidence,confidence,shrunkRate,relativeDifference,direction,text:direction==="unknown"?label+" recorded; the comparison rate is zero.":label+" "+(direction==="similar"?"within 20% of":direction)+" the measured "+(scope==="hero-role"?"same-hero, same-role":"same-role across heroes")+" comparison. This does not identify a cause."};
}
function legalItems(catalog){return new Set((Array.isArray(catalog)?catalog:[]).filter(i=>i&&typeof i.name==="string"&&!["__proto__","prototype","constructor"].includes(i.name)&&i.hidden!==true&&i.slot==="PASSIVE"&&finite(i.cost)&&i.cost>=1800&&(!i.rarity||["EPIC","LEGENDARY"].includes(i.rarity))).map(i=>i.name));}
function build(input={}){
 const {who,hero,role,patch,mode,cutoff,excludeMatchId,catalog}=input,until=stamp(cutoff),context={who,hero,role,patch,mode,cutoff:finite(until)?until:null,excludeMatchId:excludeMatchId??null};
 const out={schema:1,status:"needs-context",context,sampleCount:0,preferenceWeight:0,items:{},confidence:"insufficient",metrics:{},notes:["Historical final-item frequency is a preference, not purchase order, combat suitability or a win-rate benefit.","Missing or unflagged measurements remain unknown; confidence is a sample-size label, not a calibrated probability.","Comparisons are not adjusted for rank or team composition."]};
 if(![who,hero,patch,mode].every(v=>typeof v==="string"&&v.length>0)||!ROLES.includes(role)||!finite(until))return out;
 const matches=Array.isArray(input.matches)?input.matches:input.matches?.matches||[],seen=new Set(),rows=[];
 for(const m of matches){if(!m||typeof m.id!=="string"||seen.has(m.id))continue;seen.add(m.id);const start=stamp(m.start);
 if(m.id===excludeMatchId||m.patch!==patch||m.mode!==mode||!["DAWN","DUSK"].includes(m.winner)||!finite(start)||!finite(m.duration)||m.duration<=0||start+m.duration*1000>until||!Array.isArray(m.players))continue;
 const duplicates=m.players.filter(p=>p?.squad===who).length>1;for(const p of m.players)if(p&&p.role===role&&!(duplicates&&p.squad===who))rows.push({m,p,minutes:m.duration/60});
 }
 out.status="descriptive";for(const[name,[key,label]]of Object.entries(DEFINITIONS))out.metrics[name]=compare(rows,who,hero,key,label);
 const exact=rows.filter(r=>r.p.squad===who&&r.p.hero===hero),known=exact.filter(r=>r.p.measured?.items===true&&Array.isArray(r.p.items)&&r.p.items.every(n=>typeof n==="string"));
 out.sampleCount=known.length;out.confidence=known.length>=20?"moderate":known.length>=LIMITS.personal?"limited":"insufficient";
 const allowed=legalItems(catalog),counts=new Map();for(const r of known)for(const n of new Set(r.p.items))if(allowed.has(n))counts.set(n,(counts.get(n)||0)+1);
 out.items=Object.fromEntries([...counts].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([n,c])=>[n,c/(known.length+LIMITS.prior)]));
 out.preferenceWeight=allowed.size&&known.length>=LIMITS.personal?LIMITS.maxWeight*Math.min(1,known.length/20):0;
 out.inventoryEvidence={exactAppearances:exact.length,measured:known.length,missing:exact.length-known.length,shrinkagePrior:LIMITS.prior};
 if(!allowed.size)out.notes.push("A current legal item catalogue is required before historical item preferences influence optimization.");
 if(!known.length)out.notes.push("No measured final inventories in the exact player, hero, role, patch and mode context.");
 return out;
}
return{build,LIMITS};
});
