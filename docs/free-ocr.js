/* Free on-device PaddleOCR. Pinned upstream worker; see vendor/paddleocr/NOTICE.txt. */
(function(root){'use strict';
 const base=new URL('./vendor/paddleocr/',document.baseURI),cacheName='squad-free-ocr-v1';
 let worker=null,workerURL=null,ready=null,controller=null,generation=0,sequence=0,listener=()=>{},manifest=null;
 const pending=new Map(),abortError=()=>new DOMException('Photo scan cancelled.','AbortError');
 function cancel(error=abortError()){
  generation++;controller?.abort();controller=null;worker?.terminate();worker=null;ready=null;
  if(workerURL){URL.revokeObjectURL(workerURL);workerURL=null;}
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();
 }
 async function download(url,spec,signal,progress){
  let cache;try{cache=await caches.open(cacheName);const found=await cache.match(url);if(found){const b=new Uint8Array(await found.arrayBuffer());if(await digest(b)===spec.sha256)return b;await cache.delete(url);}}catch{}
  const res=await fetch(url,{signal,cache:'no-cache'});if(!res.ok)throw Error('The free reader could not download. Check your connection and retry.');
  const reader=res.body?.getReader();let data;
  if(reader){const parts=[];let length=0;while(true){const next=await reader.read();if(next.done)break;parts.push(next.value);length+=next.value.length;if(length>spec.bytes+1024){reader.cancel();throw Error('Reader download was larger than expected.');}progress?.(length,spec.bytes);}data=new Uint8Array(length);let at=0;for(const p of parts){data.set(p,at);at+=p.length;}}
  else data=new Uint8Array(await res.arrayBuffer());
  if(await digest(data)!==spec.sha256)throw Error('Reader download was incomplete. Retry the photo.');
  try{await cache?.put(url,new Response(data,{headers:{'Content-Type':'application/octet-stream'}}));}catch{}
  return data;
 }
 async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 // Runs before the unmodified SDK inside its owned worker. Only model/runtime
 // asset requests are mapped to the compressed, verified files on this site.
 function workerPrelude(config){
  const original=self.fetch.bind(self),cacheName=config.cacheName;
  async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
  self.fetch=async function(input,init){
   const url=typeof input==='string'?input:input.url||String(input),asset=config.mapping[url];if(!asset)return original(input,init);
   let cache,compressed;try{cache=await caches.open(cacheName);const found=await cache.match(asset.url);if(found){compressed=new Uint8Array(await found.arrayBuffer());if(await digest(compressed)!==asset.sha256){compressed=null;await cache.delete(asset.url);}}}catch{}
   if(!compressed){
    const res=await original(asset.url,{signal:AbortSignal.timeout(45000)});if(!res.ok)throw Error('Free reader download failed. Check your connection.');
    const reader=res.body?.getReader();if(reader){const chunks=[];let n=0;while(true){const v=await reader.read();if(v.done)break;chunks.push(v.value);n+=v.value.length;if(n>asset.bytes+1024){reader.cancel();throw Error('Unexpected reader asset size.');}self.postMessage({kind:'free-ocr-progress',label:asset.label,loaded:n,total:asset.bytes});}compressed=new Uint8Array(n);let at=0;for(const c of chunks){compressed.set(c,at);at+=c.length;}}
    else compressed=new Uint8Array(await res.arrayBuffer());
    if(await digest(compressed)!==asset.sha256)throw Error('Free reader download was incomplete. Retry.');
    try{await cache?.put(asset.url,new Response(compressed));}catch{}
   }
   self.postMessage({kind:'free-ocr-progress',label:asset.label,loaded:asset.bytes,total:asset.bytes});
   const data=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
   return new Response(data,{headers:{'Content-Type':asset.mime,'Content-Length':String(data.byteLength)}});
  };
 }
 function request(type,payload,transfer=[],timeout=45000){
  const owned=worker;if(!owned)return Promise.reject(Error('The free reader stopped. Retry the photo.'));
  return new Promise((resolve,reject)=>{
   const requestId=++sequence,timer=setTimeout(()=>{if(worker===owned)cancel(Error('Reading took too long. Retry a closer photo.'));},timeout);
   pending.set(requestId,{resolve,reject,timer});
   try{owned.postMessage({kind:'worker-transport-request',requestId,type,payload},transfer);}catch(e){clearTimeout(timer);pending.delete(requestId);reject(e);}
  });
 }
 async function initialize(){
  if(ready)return ready;
  const gen=generation;controller=new AbortController();const signal=controller.signal,timer=setTimeout(()=>{if(gen===generation)cancel(Error('The free reader took too long to load. Check your connection and retry.'));},90000);
  ready=(async()=>{
   if(!root.Worker||!root.createImageBitmap||!root.DecompressionStream)throw Error('Update your browser to use the free photo reader.');
   listener('Loading free reader. First use downloads the models…',.05);
   if(!manifest){const res=await fetch(new URL('manifest.json',base),{signal});if(!res.ok)throw Error('Free reader files are unavailable. Reload the app.');manifest=await res.json();}
   const spec=manifest.assets['worker.js.gz'];
   const zipped=await download(new URL('worker.js.gz',base).href,spec,signal,(n,t)=>{if(gen===generation)listener('Downloading free reader '+Math.round(n/t*100)+'%…',.05+.1*n/t);});
   const code=await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
   if(signal.aborted||gen!==generation)throw abortError();
   const mapping={},add=(name,file,label,mime)=>mapping[new URL(name,base).href]={...manifest.assets[file],url:new URL(file,base).href,label,mime};
   add('ort-wasm-simd-threaded.jsep.wasm','runtime.wasm.gz','runtime','application/wasm');
   add('det.tar','det.tar.gz','text detector','application/octet-stream');
   add('rec.tar','rec.tar.gz','text reader','application/octet-stream');
   const prelude='('+workerPrelude.toString()+')('+JSON.stringify({cacheName,mapping})+');\n';
   const url=URL.createObjectURL(new Blob([prelude,code],{type:'application/javascript'}));workerURL=url;
   worker=new Worker(url,{type:'module'});
   worker.onmessage=({data:m})=>{
    if(gen!==generation)return;
    if(m?.kind==='free-ocr-progress'){listener('Loading '+m.label+' '+Math.round(m.loaded/m.total*100)+'%…',.15+.2*m.loaded/m.total);return;}
    if(m?.kind!=='worker-transport-response')return;const p=pending.get(m.requestId);if(!p)return;
    pending.delete(m.requestId);clearTimeout(p.timer);
    m.status==='success'?p.resolve(m.payload):p.reject(Error(m.error?.message||'Free reader failed.'));
   };
   worker.onerror=e=>{if(gen===generation)cancel(Error(e.message||'Free reader could not start. Retry.'));};
   worker.onmessageerror=()=>{if(gen===generation)cancel(Error('Free reader returned an unreadable result. Retry.'));};
   const options={
    pipelineConfig:{pipelineName:'OCR',raw:{},warnings:[],unsupportedFeatures:[],
     modelSelection:{textDetectionModelName:'PP-OCRv6_tiny_det',textRecognitionModelName:'PP-OCRv6_tiny_rec'},
     assets:{det:{url:new URL('det.tar',base).href},rec:{url:new URL('rec.tar',base).href}},
     runtimeDefaults:{text_det_limit_side_len:2048,text_det_limit_type:'max',text_det_max_side_limit:2048,text_det_thresh:.2,text_det_box_thresh:.4,text_rec_score_thresh:0},
     pipelineBatchSize:1,textDetectionBatchSize:1,textRecognitionBatchSize:1},
    ortOptions:{backend:'wasm',numThreads:1,simd:true,proxy:false,disableWasmProxy:true,wasmPaths:base.href}};
   await request('init',{options},[],90000);if(gen!==generation)throw abortError();
   URL.revokeObjectURL(url);if(workerURL===url)workerURL=null;
  })().catch(e=>{if(gen===generation)cancel(e);throw e;}).finally(()=>clearTimeout(timer));return ready;
 }
 async function read(canvas,{signal,onProgress=()=>{}}={}){
  if(signal?.aborted)throw abortError();const gen=generation;listener=onProgress;const abort=()=>cancel();signal?.addEventListener('abort',abort,{once:true});
  let bitmap;try{
   await initialize();if(signal?.aborted||gen!==generation)throw abortError();
   onProgress('Reading photo on your device…',.45);bitmap=await createImageBitmap(canvas);if(signal?.aborted||gen!==generation)throw abortError();
   const [result]=await request('predict',{sources:[{kind:'imageBitmap',imageBitmap:bitmap}],params:{}},[bitmap]);
   if(signal?.aborted||gen!==generation)throw abortError();
   onProgress('Photo read. Checking the values…',.9);
   const lines=(result.items||[]).map(item=>{const xs=item.poly.map(p=>p[0]),ys=item.poly.map(p=>p[1]);return[{t:item.text,c:item.score*100,x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys),boxKind:'line'}];});
   return{...result,lines};
  }finally{bitmap?.close();signal?.removeEventListener('abort',abort);}
 }
 function statCrops(source,cells){
  const out=new Map(),ctx=source.getContext('2d');
  for(const side of['ours','theirs'])for(let row=0;row<5;row++){
   const group=cells.filter(c=>c.side===side&&c.row===row&&['k','d','a'].includes(c.field));if(group.length!==3)continue;
   // Hero labels locate the panel, not the numeral baseline. Perspective can put
   // the actual digits outside their nominal boxes; search a bounded panel first.
   const expected=group.find(c=>c.field==='d'),unit=expected.h/.27,cx=expected.x+expected.w/2,cy=expected.y+.18*unit;
   const x=Math.max(0,Math.floor(cx-.8*unit)),y=Math.max(0,Math.floor(cy-.4*unit)),right=Math.min(source.width,Math.ceil(cx+.8*unit)),bottom=Math.min(source.height,Math.ceil(cy+.4*unit)),w=right-x,h=bottom-y;if(!(unit>0&&w>0&&h>0))continue;
   const data=ctx.getImageData(x,y,w,h).data,seen=new Uint8Array(w*h),shapes=[];
   for(let start=0;start<w*h;start++){if(seen[start]||Math.min(data[start*4],data[start*4+1],data[start*4+2])<150)continue;
    const todo=[start];seen[start]=1;let x0=w,y0=h,x1=0,y1=0,n=0;
    while(todo.length){const p=todo.pop(),px=p%w,py=Math.floor(p/w);x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);n++;
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=px+dx,yy=py+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const q=yy*w+xx;if(!seen[q]&&Math.min(data[q*4],data[q*4+1],data[q*4+2])>=150){seen[q]=1;todo.push(q);}}}
    const bw=x1-x0+1,bh=y1-y0+1;
    if(n>=4&&bh>=Math.max(4,unit*.075)&&bh<=unit*.18&&bw<=unit*.28&&x0>0&&y0>0&&x1<w-1&&y1<h-1)shapes.push({x:x+x0,y:y+y0,w:bw,h:bh});
   }
   const center=b=>b.x+b.w/2,middle=b=>b.y+b.h/2,candidates=new Map();
   for(const base of shapes){
    const mid=middle(base);if(Math.abs(mid-cy)>unit*.28)continue;
    const band=shapes.filter(b=>Math.abs(middle(b)-mid)<unit*.055&&Math.max(base.h,b.h)<=Math.min(base.h,b.h)*1.5).sort((a,b)=>a.x-b.x),parts=[];
    for(const b of band){const last=parts.at(-1);if(last&&b.x-Math.max(...last.map(q=>q.x+q.w))<unit*.065)last.push(b);else parts.push([b]);}
    for(let start=0;start+2<parts.length;start++){
     const bounds=parts.slice(start,start+3).map(ps=>{const left=Math.min(...ps.map(s=>s.x)),top=Math.min(...ps.map(s=>s.y));return{x:left,y:top,w:Math.max(...ps.map(s=>s.x+s.w))-left,h:Math.max(...ps.map(s=>s.y+s.h))-top};});
     const gaps=[center(bounds[1])-center(bounds[0]),center(bounds[2])-center(bounds[1])],heights=bounds.map(b=>b.h);
     if(bounds.some(b=>b.w>unit*.28||Math.abs(middle(b)-mid)>unit*.065)||Math.max(...heights)>Math.min(...heights)*1.5||gaps.some(g=>g<=unit*.16||g>=unit*.34)||Math.abs(gaps[0]-gaps[1])>(gaps[0]+gaps[1])*.125||Math.abs(center(bounds[1])-cx)>unit*.35)continue;
     candidates.set(JSON.stringify(bounds),bounds);
    }
   }
   // A second plausible triplet can be the header or an icon fragment. Abstain.
   if(candidates.size!==1)continue;
   const bounds=[...candidates.values()][0];
   ['k','d','a'].forEach((field,i)=>{const b=bounds[i];out.set(side+':'+row+':'+field,{x:b.x-2,y:b.y-2,w:b.w+4,h:b.h+4});});
  }
  return out;
 }
 function digits(source,cells,{image=source}={}){
  const out=[],ratioX=(image.naturalWidth||image.width)/source.width,ratioY=(image.naturalHeight||image.height)/source.height;
  for(const[id,rect]of statCrops(source,cells)){
   const x=Math.max(0,rect.x),y=Math.max(0,rect.y),w=Math.min(source.width-x,rect.w),h=Math.min(source.height-y,rect.h),scale=4,border=8;
   if(!(w>0&&h>0&&ratioX>0&&ratioY>0))continue;
   const canvas=document.createElement('canvas');canvas.width=Math.ceil(w*scale)+border*2;canvas.height=Math.ceil(h*scale)+border*2;const g=canvas.getContext('2d',{willReadFrequently:true});g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height);
   g.drawImage(image,x*ratioX,y*ratioY,w*ratioX,h*ratioY,border,border,w*scale,h*scale);
   const patch=g.getImageData(border,border,Math.ceil(w*scale),Math.ceil(h*scale)),data=patch.data,hist=new Uint32Array(256),gray=new Uint8Array(data.length/4);
   for(let i=0;i<gray.length;i++){const v=Math.round(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114);gray[i]=v;hist[v]++;}
   let total=0;for(let i=0;i<256;i++)total+=i*hist[i];let weight=0,sum=0,best=-1,threshold=0;
   for(let i=0;i<256;i++){weight+=hist[i];sum+=i*hist[i];if(!weight||weight===gray.length)continue;const delta=sum/weight-(total-sum)/(gray.length-weight),variance=weight*(gray.length-weight)*delta*delta;if(variance>best){best=variance;threshold=i;}}
   for(let i=0;i<gray.length;i++){const v=gray[i]>threshold?0:255;data[i*4]=data[i*4+1]=data[i*4+2]=v;data[i*4+3]=255;}g.putImageData(patch,border,border);
   out.push({id,canvas,x,y,scale,border});
  }
  return out;
 }
 // Independent shape evidence only rejects incomplete level reads. It never
 // assigns a number, and ambiguous components provide no digit-count evidence.
 function levelDigitCount(source,c){
  const x=Math.max(0,Math.floor(c.x)),y=Math.max(0,Math.floor(c.y)),w=Math.min(source.width-x,Math.ceil(c.w)),h=Math.min(source.height-y,Math.ceil(c.h));if(w<8||h<8)return null;
  const a=source.getContext('2d').getImageData(x,y,w,h).data,seen=new Uint8Array(w*h),parts=[];
  for(let i=0;i<w*h;i++){
   if(seen[i]||Math.min(a[i*4],a[i*4+1],a[i*4+2])<150)continue;
   const todo=[i];seen[i]=1;let x0=w,y0=h,x1=0,y1=0,n=0;
   while(todo.length){const q=todo.pop(),px=q%w,py=Math.floor(q/w);x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);n++;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=px+dx,yy=py+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const z=yy*w+xx;if(!seen[z]&&Math.min(a[z*4],a[z*4+1],a[z*4+2])>=150){seen[z]=1;todo.push(z);}}}
   const bh=y1-y0+1,bw=x1-x0+1;if(n>=3&&bh>=h*.17&&bh<=h*.6&&bw<=h*.6&&x0>w*.08&&x1<w*.92&&y0>h*.12&&y1<h*.88)parts.push({x0,y0,x1,y1,h:bh});
  }
  if(parts.length!==2)return null;parts.sort((a,b)=>a.x0-b.x0);const[a1,b]=parts;
  if(b.x0<=a1.x1||b.x0-a1.x1>h*.3||Math.max(a1.h,b.h)>Math.min(a1.h,b.h)*1.8||Math.abs(a1.y0+a1.y1-b.y0-b.y1)>h*.2||Math.abs((a1.x0+b.x1)/2-w/2)>w*.2)return null;
  return 2;
 }
 function atlas(source,cells,{image=source}={}){
  const ratioX=(image.naturalWidth||image.width)/source.width,ratioY=(image.naturalHeight||image.height)/source.height;
  if(!(ratioX>0&&ratioY>0&&Number.isFinite(ratioX)&&Number.isFinite(ratioY)))throw Error('Photo detail source is unavailable.');
  const widths={hero:300,name:340,lvl:96,k:96,d:96,a:96,cs:144},fields=['hero','name','lvl','k','d','a','cs'],gap=20,rowH=90;
  const x={},width=fields.reduce((sum,f)=>{x[f]=sum;return sum+widths[f]+gap;},gap);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=10*rowH+gap;const g=canvas.getContext('2d');g.fillStyle='#181b21';g.fillRect(0,0,canvas.width,canvas.height);
  const regions=[],stats=statCrops(source,cells);
  for(let cell of cells){if(['k','d','a'].includes(cell.field)){const crop=stats.get(cell.id);if(!crop)continue;cell={...cell,...crop};}if(!widths[cell.field]||cell.w<=0||cell.h<=0)continue;const bx=x[cell.field],by=gap+(cell.side==='ours'?0:5)*rowH+cell.row*rowH,bw=widths[cell.field],bh=rowH-gap;
   const sx=Math.max(0,cell.x),sy=Math.max(0,cell.y),sw=Math.min(source.width-sx,cell.w),sh=Math.min(source.height-sy,cell.h);if(!(sw>0&&sh>0))continue;
   const scale=Math.min((bw-10)/sw,(bh-8)/sh,5),dw=sw*scale,dh=sh*scale,dx=bx+(bw-dw)/2,dy=by+(bh-dh)/2;
   g.drawImage(image,sx*ratioX,sy*ratioY,sw*ratioX,sh*ratioY,dx,dy,dw,dh);
   regions.push({cell,sx,sy,scale,dx,dy,dw,dh});
  }
  return{canvas,reads(result){const out={};for(const r of regions){const items=(result.items||[]).filter(item=>item.poly.every(([px,py])=>px>=r.dx-3&&px<=r.dx+r.dw+3&&py>=r.dy-3&&py<=r.dy+r.dh+3)).map(item=>({...item,sourcePoly:item.poly.map(([px,py])=>[r.sx+(px-r.dx)/r.scale,r.sy+(py-r.dy)/r.scale])}));out[r.cell.id]={items,...(r.cell.field==='lvl'?{levelGlyphCount:levelDigitCount(source,r.cell)}:{})};}return out;}};
 }
 root.FreeOCR={read,cancel,atlas,digits};
})(window);

