/* Conservative on-device canonical icon suggestions. Similarity is not probability. */
(function(root){"use strict";const GRID=8,clamp=x=>Math.max(0,Math.min(1,x));
 function descriptor(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<4||image.height<4||!image.data||image.data.length<image.width*image.height*4)return null;
  const values=[];let sum=0,sum2=0,count=0;const inset=.12;
  for(let gy=0;gy<GRID;gy++)for(let gx=0;gx<GRID;gx++){
   const x0=Math.floor(image.width*(inset+(1-2*inset)*gx/GRID)),x1=Math.max(x0+1,Math.ceil(image.width*(inset+(1-2*inset)*(gx+1)/GRID))),y0=Math.floor(image.height*(inset+(1-2*inset)*gy/GRID)),y1=Math.max(y0+1,Math.ceil(image.height*(inset+(1-2*inset)*(gy+1)/GRID)));
   let r=0,g=0,b=0,n=0;for(let y=y0;y<Math.min(image.height,y1);y++)for(let x=x0;x<Math.min(image.width,x1);x++){const i=(y*image.width+x)*4,a=image.data[i+3]/255;r+=image.data[i]*a/255;g+=image.data[i+1]*a/255;b+=image.data[i+2]*a/255;n++;}
   if(!n)return null;r/=n;g/=n;b/=n;values.push(r,g,b);const lum=.299*r+.587*g+.114*b;sum+=lum;sum2+=lum*lum;count++;
  }return{values,contrast:Math.sqrt(Math.max(0,sum2/count-(sum/count)**2)),meanLuma:sum/count,grid:GRID};
 }
 function vector(d){if(Array.isArray(d)||ArrayBuffer.isView(d))return d;if(typeof d?.values==="string"){try{return Float32Array.from(atob(d.values),c=>c.charCodeAt(0)/255);}catch{return null;}}return d?.values;}
 function distance(a,b){a=vector(a);b=vector(b);if(!a||!b||a.length!==GRID*GRID*3||b.length!==a.length||Array.from(b).some(x=>!Number.isFinite(x)||x<0||x>1))return Infinity;let total=0;for(let i=0;i<a.length;i++)total+=(a[i]-b[i])**2;return Math.sqrt(total/a.length);}
 function match(image,catalog,options={}){
  const templates=Array.isArray(catalog)?catalog:catalog?.templates||[],unknown=reason=>({name:null,confidence:0,alternatives:[],reason,confirmed:false}),d=descriptor(image);
  if(!d)return unknown("invalid_crop");if(!templates.length)return unknown("no_templates");if(d.contrast<(options.minContrast??.018))return unknown("low_detail");if(options.patch&&catalog?.patch&&options.patch!==catalog.patch)return unknown("template_patch_mismatch");
  const allowed=options.allowedNames?new Set(options.allowedNames):null,byName=new Map();
  for(const t of templates){if(!t||typeof t.name!=="string"||!t.name||allowed&&!allowed.has(t.name))continue;const variants=t.variants||[t.descriptor||t.values],score=Math.min(...variants.map(v=>distance(d,v)));if(Number.isFinite(score)&&(!byName.has(t.name)||score<byName.get(t.name)))byName.set(t.name,score);}
  const ranked=[...byName].map(([name,distance])=>({name,distance})).sort((a,b)=>a.distance-b.distance||a.name.localeCompare(b.name));if(!ranked.length)return unknown("no_valid_templates");
  const maxDistance=options.maxDistance??.14,minMargin=options.minMargin??.035,best=ranked[0],margin=ranked.length>1?ranked[1].distance-best.distance:Infinity,alternatives=ranked.slice(0,3).map(x=>({name:x.name,similarity:clamp(1-x.distance/maxDistance),distance:x.distance}));
  if(best.distance>maxDistance)return{...unknown("low_similarity"),alternatives};if(margin<minMargin)return{...unknown("ambiguous"),alternatives};return{name:best.name,confidence:clamp(1-best.distance/maxDistance),alternatives,reason:"visual_suggestion",confirmed:false,margin};
 }
 /* ---------- row matcher (Claude, 2026-11-01) ----------
    Photos of a TV shift brightness and colour, so raw RGB distances fail. Each 8x8 grid is z-scored per
    channel and compared by correlation. Slot positions drift with perspective and HUD scale, so the six
    slots of a row are aligned jointly: search offset and spacing, keep the alignment whose slots best
    match real item icons. Pure functions; the caller supplies an RGBA strip and nominal slot centres. */
 function integral(img){const w=img.width,h=img.height,W=w+1,I=new Float64Array(W*(h+1)*3);
  for(let y=0;y<h;y++){let r=0,g=0,b=0;for(let x=0;x<w;x++){const i=(y*w+x)*4;r+=img.data[i];g+=img.data[i+1];b+=img.data[i+2];const o=((y+1)*W+x+1)*3,u=(y*W+x+1)*3;I[o]=I[u]+r;I[o+1]=I[u+1]+g;I[o+2]=I[u+2]+b;}}
  return{I,W,w,h};}
 function boxSum(S,x0,y0,x1,y1,c){const W=S.W,I=S.I;return I[(y1*W+x1)*3+c]-I[(y0*W+x1)*3+c]-I[(y1*W+x0)*3+c]+I[(y0*W+x0)*3+c];}
 /** 8x8 RGB grid over the inner 76% of a square (same inset as the catalogue templates); null if off-strip */
 function gridAt(S,cx,cy,size){const v=new Float32Array(GRID*GRID*3),inset=.12,x0=cx-size/2,y0=cy-size/2;
  for(let gy=0;gy<GRID;gy++)for(let gx=0;gx<GRID;gx++){
   const ax=Math.round(x0+size*(inset+(1-2*inset)*gx/GRID)),bx=Math.max(ax+1,Math.round(x0+size*(inset+(1-2*inset)*(gx+1)/GRID)));
   const ay=Math.round(y0+size*(inset+(1-2*inset)*gy/GRID)),by=Math.max(ay+1,Math.round(y0+size*(inset+(1-2*inset)*(gy+1)/GRID)));
   if(ax<0||ay<0||bx>S.w||by>S.h)return null;const n=(bx-ax)*(by-ay),o=(gy*GRID+gx)*3;
   for(let c=0;c<3;c++)v[o+c]=boxSum(S,ax,ay,bx,by,c)/n/255;}
  return v;}
 /** z-score each colour channel across the 64 cells; returns null for flat (empty/dark) slots */
 function normalize(v,minStd=.025){const out=new Float32Array(v.length),N=GRID*GRID;let spread=0;
  for(let c=0;c<3;c++){let m=0;for(let k=0;k<N;k++)m+=v[k*3+c];m/=N;let sd=0;for(let k=0;k<N;k++)sd+=(v[k*3+c]-m)**2;sd=Math.sqrt(sd/N);spread+=sd;
   for(let k=0;k<N;k++)out[k*3+c]=sd>1e-6?(v[k*3+c]-m)/sd:0;}
  return spread/3<minStd?null:out;}
 const prepCache=new WeakMap();
 function prepared(catalog,allowed){const templates=Array.isArray(catalog)?catalog:catalog?.templates||[];let byKey=prepCache.get(templates);if(!byKey){byKey=new Map();prepCache.set(templates,byKey);}
  const key=allowed?[...allowed].sort().join("|"):"*";if(byKey.has(key))return byKey.get(key);
  const set=allowed?new Set(allowed):null,list=[];
  for(const t of templates){if(!t?.name||set&&!set.has(t.name))continue;const raw=vector(t.descriptor||t.values);if(!raw||raw.length!==GRID*GRID*3)continue;const n=normalize(raw,0);if(n)list.push({name:t.name,v:n});}
  byKey.set(key,list);return list;}
 function rank(vec,list,k=3){const top=[];const L=vec.length;
  for(const t of list){let d=0;for(let i=0;i<L;i++)d+=vec[i]*t.v[i];d/=L;
   if(top.length<k||d>top[top.length-1].s){top.push({name:t.name,s:d});top.sort((a,b)=>b.s-a.s);if(top.length>k)top.pop();}}
  return top;}
 /** slots: nominal {x,y} centres (strip pixels) for the six equipment slots; size: nominal icon box; u: row height in strip px */
 // Acceptance thresholds chosen 2026-11-01 by leave-one-photo-out on 6 end-of-match photos (355 scored slots,
 // labels from pred.gg final inventories): ~93% of accepted names correct on held-out photos. Re-tune with more photos.
 function matchRow(strip,catalog,{slots,size,u,allowedNames,minScore=.65,minMargin=.04,minSpread=.11}={}){
  const S=integral(strip),list=prepared(catalog,allowedNames);if(!list.length||!slots?.length)return{slots:[],offset:null};
  const mid=(slots.length-1)/2,step0=slots.length>1?(slots[slots.length-1].x-slots[0].x)/(slots.length-1):size;
  const evalCfg=(dx,dy,k)=>{let total=0;const per=[];for(let i=0;i<slots.length;i++){const x=slots[i].x+dx+(i-mid)*step0*(k-1),y=slots[i].y+dy;
    const g=gridAt(S,x,y,size*k),n=g&&normalize(g);if(!n){per.push(null);continue;}const r=rank(n,list,3);per.push({x,y,r});total+=Math.max(0,r[0]?.s||0);}
   return{total,per};};
  let best=null;const R=.18*u,Ry=.15*u;
  for(const k of [.93,1,1.07])for(let dx=-R;dx<=R+1e-9;dx+=.06*u)for(let dy=-Ry;dy<=Ry+1e-9;dy+=.05*u){const e=evalCfg(dx,dy,k);if(!best||e.total>best.e.total)best={dx,dy,k,e};}
  for(const k of [best.k-.03,best.k,best.k+.03])for(let dx=best.dx-.04*u;dx<=best.dx+.04*u+1e-9;dx+=.02*u)for(let dy=best.dy-.04*u;dy<=best.dy+.04*u+1e-9;dy+=.02*u){const e=evalCfg(dx,dy,k);if(e.total>best.e.total)best={dx,dy,k,e};}
  const spreadAt=(x,y)=>{const g=gridAt(S,x,y,size*best.k);if(!g)return 0;let t=0;for(let c=0;c<3;c++){let m=0;for(let q=0;q<64;q++)m+=g[q*3+c];m/=64;let sd=0;for(let q=0;q<64;q++)sd+=(g[q*3+c]-m)**2;t+=Math.sqrt(sd/64);}return t/3;};
  const out=best.e.per.map(p=>{if(!p)return{name:null,confidence:0,alternatives:[],reason:"empty_or_flat",confirmed:false};
   p.spread=spreadAt(p.x,p.y);
   const [a,b]=p.r,margin=a&&b?a.s-b.s:1,alternatives=p.r.map(x=>({name:x.name,similarity:clamp(x.s),score:x.s})),spread=p.spread;
   if(spread<minSpread)return{name:null,confidence:0,alternatives,reason:"low_detail",confirmed:false,center:[p.x,p.y],spread};
   if(!a||a.s<minScore)return{name:null,confidence:0,alternatives,reason:"low_similarity",confirmed:false,center:[p.x,p.y],spread};
   if(margin<minMargin)return{name:null,confidence:0,alternatives,reason:"ambiguous",confirmed:false,center:[p.x,p.y],spread};
   return{name:a.name,confidence:clamp(a.s),alternatives,reason:"visual_suggestion",confirmed:false,margin,center:[p.x,p.y],spread};});
  return{slots:out,offset:{dx:best.dx/u,dy:best.dy/u,scale:best.k,score:best.e.total}};}
 /** Browser helper: read all ten inventories from a photo using FreeScan's row geometry
    (hero-name boxes per row; u = row spacing, in the OCR image's pixels). Slots start ~0.33u right of the
    hero name's left edge and ~0.33u below it, 0.42u apart (measured on 2026-10 scoreboard photos); the row
    search in matchRow absorbs drift. Rows without a measured name box use the side's median x. */
 async function readBoard(source,geometry,{catalog,allowedNames,imageWidth}={}){
  if(typeof document==="undefined"||!geometry?.rows||!Number.isFinite(geometry.u))return null;
  const img=source instanceof Blob?await createImageBitmap(source):source,scale=imageWidth?img.width/imageWidth:1,u=geometry.u*scale,out={};
  for(const side of Object.keys(geometry.rows)){
   const rows=geometry.rows[side]||[],xs=rows.filter(h=>h&&Number.isFinite(h.x)).map(h=>h.x).sort((a,b)=>a-b),mx=xs.length?xs[xs.length>>1]:null;
   out[side]=rows.map(h=>{
    const hx=Number.isFinite(h?.x)?h.x:mx,hy=Number.isFinite(h?.cy)?h.cy:null;if(hx==null||hy==null)return null;
    const nominal=Array.from({length:6},(_,j)=>({x:(hx+(.33+j*.42)*geometry.u)*scale,y:(hy+.33*geometry.u)*scale})),size=.38*u;
    const x0=nominal[0].x-.6*u,x1=nominal[5].x+.6*u,y0=nominal[0].y-.5*u,y1=nominal[0].y+.5*u,k=80/u;
    const W=Math.max(8,Math.round((x1-x0)*k)),H=Math.max(8,Math.round((y1-y0)*k)),c=document.createElement("canvas");c.width=W;c.height=H;
    const g=c.getContext("2d",{willReadFrequently:true});g.imageSmoothingQuality="high";g.drawImage(img,x0,y0,x1-x0,y1-y0,0,0,W,H);
    const res=matchRow(g.getImageData(0,0,W,H),catalog,{slots:nominal.map(p=>({x:(p.x-x0)*k,y:(p.y-y0)*k})),size:size*k,u:80,allowedNames});
    const previews=res.slots.map((sl,j)=>{const ctr=sl.center||[(nominal[j].x-x0)*k,(nominal[j].y-y0)*k],p=document.createElement("canvas");p.width=p.height=48;p.getContext("2d").drawImage(c,ctr[0]-size*k/2,ctr[1]-size*k/2,size*k,size*k,0,0,48,48);return p.toDataURL("image/png");});
    c.width=c.height=0;
    return{items:res.slots.map(x=>x.name||null),itemPreviews:previews,itemCandidates:res.slots,itemAlignment:res.offset};
   });
  }
  if(source instanceof Blob&&img.close)img.close();
  return out;}
 const api={descriptor,describe:descriptor,match,distance,GRID,integral,gridAt,normalize,matchRow,readBoard};root.ItemVision=api;if(typeof module!=="undefined")module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
