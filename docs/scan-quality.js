/* Weakest measured evidence gates automatic application; inventories are independent. */
(function(root){'use strict';
 const ROLES=['OFFLANE','JUNGLE','MIDLANE','SUPPORT','CARRY'],METRICS=['ocr','match','correlation','similarity','confirmation'],badSource=/(?:^|[^a-z])(assumed|known|prior|heuristic|fallback)(?:$|[^a-z])/i;
 const owns=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
 function disputed(x){return x===true||Array.isArray(x)&&x.length>0||typeof x==='string'&&x.length>0;}
 function reliability(e,value){if(!e||typeof e!=='object'||!owns(e,'value')||e.value!==value||!e.source||badSource.test(e.source)||e.resolved===false||disputed(e.disputed))return 0;const scores=METRICS.filter(k=>owns(e.metrics,k)).map(k=>e.metrics[k]);return scores.length&&scores.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)?Math.min(...scores)*100:0;}
 function assess(type,result={},options={}){const issues=[],scores=[],ready={ours:Array(5).fill(false),theirs:Array(5).fill(false)},heroSet=new Set((options.heroes||[]).map(h=>h?.slug).filter(Boolean)),itemSet=new Set((options.items||[]).filter(i=>i?.name&&!i.hidden&&(!i.slot||i.slot==='PASSIVE')).map(i=>i.name));
  const fail=s=>issues.push(s),measure=(e,value,label)=>{const s=reliability(e,value);scores.push(s);if(s<90)fail(label+' needs reliable evidence at 90% or higher.');};
  if(!['scoreboard','loading'].includes(type))return{auto:false,score:0,issues:['This photo type needs its own review.'],inventoryReady:ready};
  const rc=result.readConfidence||{};
  measure(rc.layout,'role-order','Screen geometry and role order');
  const ownValue=rc.ownTeam?.value,validOwn=type==='scoreboard'?ownValue==='left':['top','bottom'].includes(ownValue);
  if(!validOwn){scores.push(0);fail('Your team must be identified from the photo.');}else{measure(rc.ownTeam,ownValue,'Your team');if(rc.ownTeam.metrics?.match!==1&&!(rc.ownTeam.source==='human'&&rc.ownTeam.metrics?.confirmation===1)){scores.push(0);fail('Your team needs an exact squad-tag match or explicit human confirmation.');}}
  const live=type==='scoreboard'&&result.sourceLayout==='live',legacy=type==='scoreboard'&&result.sourceLayout==='gold';
  if(type==='scoreboard'&&!live&&!legacy){scores.push(0);fail('The scoreboard layout is unverified.');}
  for(const side of['ours','theirs']){
   const group=result[side],rows=Array.isArray(group)?group:ROLES.map(r=>group?.[r]);
   if(!group||rows.length!==5){scores.push(0);fail(side+': all five players are required.');}
   const seen=new Set();
   for(let i=0;i<5;i++){const row=rows[i]||{},e=row.readConfidence||{},label=side+' '+ROLES[i];
    if(!heroSet.has(row.hero)||seen.has(row.hero)){scores.push(0);fail(label+': choose a canonical hero, unique on this team.');}else seen.add(row.hero);
    measure(e.hero,row.hero,label+' hero');
    if(side==='ours'&&row.who){if(!(options.squad||[]).some(p=>p.key===row.who)||e.who?.metrics?.match!==1){scores.push(0);fail(label+' player identity needs an exact known squad match.');}measure(e.who,row.who,label+' player identity');}
    if(row.role&&row.role!==ROLES[i]){scores.push(0);fail(label+': role order conflicts with the detected row.');}
    if(type==='scoreboard'){
     for(const field of['lvl','k','d','a',...(live?['cs']:legacy?['gold']:[])]){const n=row[field];if(options.allowUnknownNumbers&&n===null)continue;if(!Number.isInteger(n)||n<0||field==='lvl'&&(n<1||n>18)){scores.push(0);fail(label+' '+field+': a valid measured number is required.');}measure(e[field],n,label+' '+field);}
     if(live&&row.gold!==null){scores.push(0);fail(label+': this layout displays CS; gold must remain unknown.');}
     if(Array.isArray(row.items)&&row.items.length===6&&Array.isArray(e.items)&&e.items.length===6)ready[side][i]=row.items.every((name,j)=>{const ev=e.items[j];if(name===null)return ev?.source==='human'&&ev.confirmed===true&&ev.state==='empty'&&ev.metrics?.confirmation===1&&reliability(ev,null)>=90;return typeof name==='string'&&itemSet.has(name)&&reliability(ev,name)>=90;});
    }
   }
  }
  const score=scores.length?Math.min(...scores):0;
  return{auto:issues.length===0&&score>=90,score,issues:[...new Set(issues)],inventoryReady:ready};
 }
 // Automatic photos may apply measured cells independently. Unknown cells never
 // borrow a value from the old board, and structural evidence is still required.
 function automaticBoard(result={},options={}){
  const safe={...result},limits={lvl:[1,18],k:[0,60],d:[0,60],a:[0,100],cs:[0,1000],gold:[0,99999],currentGold:[0,99999]};let observed=0;
  for(const side of['ours','theirs'])safe[side]=(result[side]||[]).map(row=>{
   const out={...row},e=row.readConfidence||{};
   for(const[field,[lo,hi]]of Object.entries(limits)){
    const n=row[field],displayed=field!=='gold'||result.sourceLayout==='gold';
    out[field]=displayed&&Number.isInteger(n)&&n>=lo&&n<=hi&&reliability(e[field],n)>=90?n:null;
    if(field!=='currentGold'&&out[field]!==null)observed++;
   }
   if(row.who&&(!(options.squad||[]).some(p=>p.key===row.who)||e.who?.metrics?.match!==1||reliability(e.who,row.who)<90))delete out.who;
   return out;
  });
  const quality=assess('scoreboard',safe,{...options,allowUnknownNumbers:true});
  if(!observed){quality.auto=false;quality.issues.push('No reliable scoreboard numbers were found.');}
  return{result:safe,quality};
 }
 const api={assess,reliability,automaticBoard};root.ScanQuality=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
