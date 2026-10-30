'use strict';
const assert=require('node:assert/strict'),F=require('../docs/free-scan.js'),Q=require('../docs/scan-quality.js');
const roles=['OFFLANE','JUNGLE','MIDLANE','SUPPORT','CARRY'];
const heroes=['Greystone','Neon','Shinbi','Phase','Skylar','Akeron','Serath','Argus','Zinx','Sparrow'].map(name=>({name,slug:name.toLowerCase()}));
const squad=[{key:'me',label:'STEALINNICKELS'}];
const line=(text,x,y,score=.99,w=text.length*7,h=12)=>({text,score,poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});
function fixture(){const items=[];for(let side=0;side<2;side++)for(let i=0;i<5;i++){const x=side?770:280,y=220+i*80;items.push(line(heroes[side*5+i].name.toUpperCase(),x,y));}items.push(line('STEALINNICKELS',280,220+4*80-16));return{image:{width:1280,height:720},items};}
function numericReads(p){return Object.fromEntries(p.cells.filter(c=>['lvl','k','d','a','cs'].includes(c.field)).map(c=>[c.id,{items:[{text:c.field==='lvl'?'12':c.field==='cs'?'120':'0',score:.99}]}]));}
let input=fixture(),p=F.prepareBoard(input,{heroes,squad});
assert.equal(p.cells.length,70);assert(p.result.readConfidence.layout.resolved);assert(p.result.readConfidence.ownTeam.resolved);assert.equal(p.result.ours[4].who,'me');
assert.deepEqual(p.result.ours.map(r=>r.role),roles);assert.deepEqual(p.result.theirs.map(r=>r.hero),heroes.slice(5).map(h=>h.slug));
assert(p.result.ours.every(r=>r.gold===null&&r.items.length===6&&r.items.every(i=>i===null)&&!r.inventoryConfirmed));
const before=JSON.stringify(p),fixed=F.applyCells(p,numericReads(p));assert.equal(JSON.stringify(p),before,'pure repair');assert(Q.automaticBoard(fixed,{heroes,squad}).quality.auto);assert.equal(fixed.ours[0].k,0);
{
 const read=fixture();read.items=read.items.filter(it=>it.text!=='NEON');const missing=F.prepareBoard(read,{heroes,squad});
 assert.equal(missing.result.ours.length,5);assert.equal(missing.result.ours[1].hero,null);assert.equal(missing.result.ours[2].hero,'shinbi');assert(!missing.result.readConfidence.layout.resolved);assert.equal(missing.cells.filter(c=>c.field==='hero').length,10);
 const repaired=F.applyCells(missing,{'ours:1:hero':{items:[{text:'NEON',score:.99}]}});assert.equal(repaired.ours[1].hero,'neon');assert(!repaired.readConfidence.layout.resolved,'a predicted crop is not a measured anchor');
}
{
 const read=fixture();read.items=read.items.filter(it=>it.text!=='GREYSTONE'&&it.text!=='NEON'&&it.text!=='SHINBI');assert.equal(F.prepareBoard(read,{heroes,squad}).cells.length,0,'need three measured rows on each side');
}
{
 const read=fixture();read.items.find(it=>it.text==='SHINBI').text='SHINBI18O G';read.items.find(it=>it.text==='SPARROW').text='SPARROWO730 G';const r=F.prepareBoard(read,{heroes,squad}).result;assert.equal(r.ours[2].hero,'shinbi');assert.equal(r.theirs[4].hero,'sparrow');assert(r.readConfidence.layout.resolved);
}
{
 const read=fixture();read.items.find(it=>it.text==='SKYLAR').text='SKLAR';const weak=F.prepareBoard(read,{heroes,squad});assert.equal(weak.result.ours[4].hero,'skylar');assert(!weak.result.ours[4].readConfidence.hero.resolved);assert(!weak.result.readConfidence.layout.resolved);const r=F.applyCells(weak,{'ours:4:hero':{items:[{text:'SKYLAR',score:.98}]}});assert(r.readConfidence.layout.resolved,'real cell read repairs a weak existing measured anchor');
}
{
 const read=fixture();read.items.find(it=>it.text==='NEON').text='GREYSTONE';const r=F.prepareBoard(read,{heroes,squad}).result;assert(!r.readConfidence.layout.resolved,'duplicates never establish order');
}
{
 const r=F.applyCells(p,{'ours:0:k':{items:[{text:'O',score:.99}]},'ours:0:d':{items:[{text:'0',score:.4}]},'ours:0:lvl':{items:[{text:'19',score:.99}]}});assert.equal(r.ours[0].k,null);assert.equal(r.ours[0].lvl,null);assert.equal(r.ours[0].d,0);assert.equal(r.ours[0].readConfidence.d.metrics.ocr,.4);assert(!r.ours[0].readConfidence.d.resolved);assert(!Q.automaticBoard(r,{heroes,squad}).quality.auto);
}
{
 const read=fixture();read.items.find(it=>it.text==='STEALINNICKELS').text='STEAL1NNICKELS';assert(!F.prepareBoard(read,{heroes,squad}).result.readConfidence.ownTeam.resolved,'digits never disappear from exact squad identity');
 const right=fixture();right.items.find(it=>it.text==='STEALINNICKELS').poly=[[770,524],[875,524],[875,536],[770,536]];const r=F.prepareBoard(right,{heroes,squad}).result;assert.equal(r.readConfidence.ownTeam.value,'right');assert(!Q.automaticBoard(F.applyCells(F.prepareBoard(right,{heroes,squad}),numericReads(p)),{heroes,squad}).quality.auto);
}
assert.equal(F.loading(fixture(),{heroes,squad}),null);
console.log('FreeScan: real-box geometry, missing rows, exact tags, repair and measured confidence passed.');

{
 const items=[];for(let i=0;i<5;i++){items.push(line('MASTER '+heroes[i].name,330+160*i,200,.99,70));items.push(line('ADEPT '+heroes[i+5].name,330+160*i,500,.99,70));items.push(line(roles[4-i],315+160*i,350,.99,70));}
 items.push(line('STEALINNICKELS',330,516,.99,100));const read={image:{width:1280,height:720},items},r=F.loading(read,{heroes,squad});assert(r);assert.equal(r.ours.CARRY.hero,'akeron');assert.equal(r.ours.CARRY.who,'me');assert(Q.assess('loading',r,{heroes,squad}).auto);
 read.items=items.filter(it=>it.text!=='CARRY');assert.equal(F.loading(read,{heroes,squad}),null);read.items=items.filter(it=>it.text!=='STEALINNICKELS');assert.equal(F.loading(read,{heroes,squad}),null);
}
{
 const data=fixture(),first=F.prepareBoard(data,{heroes,squad}),c=first.cells.find(c=>c.id==='ours:0:cs');data.items.push(line('≥110',c.x+5,c.y+2,.85,35,12));const p=F.prepareBoard(data,{heroes,squad});assert.equal(p.result.ours[0].readConfidence.cs.candidateValue,110);
 const r=F.applyCells(p,{'ours:0:cs':{items:[{text:'11',score:.99}]}});assert(r.ours[0].readConfidence.cs.disputed);assert.equal(Q.automaticBoard(r,{heroes,squad}).result.ours[0].cs,null);
}
console.log('FreeScan: observed loading roles and contradictory farm reads are conservative.');

{
 const items=[];for(let i=0;i<5;i++){items.push(line('EXPERT '+heroes[i].name,330+160*i,200,.99,70));items.push(line('ADEPT '+heroes[i+5].name,330+160*i,500,.99,70));items.push(line(roles[4-i],315+160*i,350,.99,70));}
 items.push(line('STEALINNICKELS',330,516,.99,100));const read={image:{width:1280,height:720},items};
 assert.equal(F.loadingCells(read,{heroes}).length,20);assert(F.loading(read,{heroes,squad}));
 assert.equal(F.loadingCells({...read,items:items.filter(it=>it.text!=='CARRY')},{heroes}).length,0);
 const sparse=items.filter(it=>!/^EXPERT /.test(it.text)||it.text.includes(heroes[0].name)||it.text.includes(heroes[1].name));
 assert.equal(F.loadingCells({...read,items:sparse},{heroes}).length,0);
 const wrong=items.map(it=>it.text==='STEALINNICKELS'?{...it,text:'STEALLNNICKELS'}:it);
 assert.equal(F.loading({...read,items:wrong},{heroes,squad}),null);
}
console.log('FreeScan: loading crop proposals require measured roles and anchors; identity remains exact');
