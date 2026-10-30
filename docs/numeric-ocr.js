/* Selective Tesseract number crops. All assets are pinned and run on-device. */
(function(root){'use strict';
 const base=new URL('./vendor/numericocr/',document.baseURI),cacheName='squad-number-reader-v1';
 let worker=null,ready=null,controller=null,workerURL=null,generation=0,sequence=0;
 const pending=new Map(),abortError=()=>new DOMException('Number scan cancelled.','AbortError');
 function cancel(error=abortError()){
  generation++;controller?.abort();controller=null;worker?.terminate();worker=null;ready=null;
  if(workerURL){URL.revokeObjectURL(workerURL);workerURL=null;}
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();
 }
 const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 async function asset(name,spec,signal){
  const url=new URL(name,base);let cache;
  try{cache=await caches.open(cacheName);const found=await cache.match(url);if(found){const bytes=new Uint8Array(await found.arrayBuffer());if(bytes.length===spec.bytes&&await digest(bytes)===spec.sha256)return bytes;await cache.delete(url);}}catch{}
  const response=await fetch(url,{signal,cache:'no-cache'});if(!response.ok)throw Error('Number reader download failed.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==spec.bytes||await digest(bytes)!==spec.sha256)throw Error('Number reader download was incomplete.');
  try{await cache?.put(url,new Response(bytes));}catch{}return bytes;
 }
 function call(action,payload,timeout=30000){
  if(!worker)return Promise.reject(Error('Number reader stopped.'));
  const jobId='number-'+(++sequence);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>cancel(Error('Number reading took too long.')),timeout);pending.set(jobId,{resolve,reject,timer});try{worker.postMessage({workerId:'squad-numbers',jobId,action,payload});}catch(e){clearTimeout(timer);pending.delete(jobId);reject(e);}});
 }
 async function initialize(onProgress){
  if(ready)return ready;const gen=generation;controller=new AbortController();const signal=controller.signal,timer=setTimeout(()=>{if(gen===generation)cancel(Error('Number reader could not finish loading.'));},90000);
  ready=(async()=>{
   onProgress('Loading the free number reader…',.1);
   const response=await fetch(new URL('manifest.json',base),{signal});if(!response.ok)throw Error('Number reader unavailable.');const manifest=await response.json();
   const [bundle,model]=await Promise.all([asset('worker.js.gz',manifest.assets['worker.js.gz'],signal),asset('eng.traineddata.gz',manifest.assets['eng.traineddata.gz'],signal)]);
   const code=await new Response(new Blob([bundle]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
   if(signal.aborted||gen!==generation)throw abortError();
   workerURL=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));worker=new Worker(workerURL);
   worker.onmessage=({data:m})=>{if(gen!==generation)return;const p=pending.get(m?.jobId);if(!p||m.status==='progress')return;pending.delete(m.jobId);clearTimeout(p.timer);m.status==='resolve'?p.resolve(m.data):p.reject(Error(String(m.data||'Number reader failed.')));};
   worker.onerror=e=>{if(gen===generation)cancel(Error(e.message||'Number reader failed to start.'));};worker.onmessageerror=()=>{if(gen===generation)cancel(Error('Number reader returned an invalid message.'));};
   await call('load',{options:{lstmOnly:true}});
   await call('loadLanguage',{langs:[{code:'eng',data:model}],options:{cacheMethod:'none',gzip:true,lstmOnly:true}});
   await call('initialize',{langs:'eng',oem:1,config:{load_system_dawg:'0',load_freq_dawg:'0'}});
   await call('setParameters',{params:{tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789'}});
   if(gen!==generation)throw abortError();URL.revokeObjectURL(workerURL);workerURL=null;
  })().catch(e=>{if(gen===generation)cancel(e);throw e;}).finally(()=>clearTimeout(timer));return ready;
 }
 function png(canvas,signal){
  return new Promise((resolve,reject)=>{
   let settled=false;const finish=(value,error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);},abort=()=>finish(null,abortError()),timer=setTimeout(()=>finish(null,Error('Number crop could not open.')),10000);
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();
   try{canvas.toBlob(b=>b?finish(b):finish(null,Error('Number crop could not open.')),'image/png');}catch(e){finish(null,e);}
  });
 }
 async function read(crops,{signal,onProgress=()=>{}}={}){
  if(signal?.aborted)throw abortError();if(!crops?.length)return{};
  const gen=generation,abort=()=>cancel();signal?.addEventListener('abort',abort,{once:true});
  const check=()=>{if(signal?.aborted||gen!==generation)throw abortError();};
  try{
   await initialize(onProgress);check();const reads={};
   for(let i=0;i<crops.length;i++){
    const crop=crops[i];onProgress('Checking isolated numbers…',.2+.75*i/crops.length);
    const blob=await png(crop.canvas,signal);check();
    const image=new Uint8Array(await blob.arrayBuffer());check();
    const data=await call('recognize',{image,options:{},output:{text:true,tsv:true}},10000);check();
    const text=String(data.text||'').trim(),words=String(data.tsv||'').trim().split('\n').slice(1).map(l=>l.split('\t')).filter(a=>a[0]==='5'&&a.slice(11).join('\t').trim());
    const items=[];
    if(/^\d{1,3}$/.test(text)&&words.length===1&&words[0].slice(11).join('\t').trim()===text){
     const a=words[0],x=Number(a[6]),y=Number(a[7]),w=Number(a[8]),h=Number(a[9]),score=Math.max(0,Math.min(Number(data.confidence),Number(a[10])))/100;
     if([x,y,w,h,score].every(Number.isFinite)&&w>0&&h>0&&x>=crop.border-1&&y>=crop.border-1&&x+w<=crop.canvas.width-crop.border+1&&y+h<=crop.canvas.height-crop.border+1){
      const poly=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],sourcePoly=poly.map(([px,py])=>[crop.x+(px-crop.border)/crop.scale,crop.y+(py-crop.border)/crop.scale]);items.push({text,score,poly,sourcePoly,engine:'tesseract'});
     }
    }
    reads[crop.id]={items};
   }
   return reads;
  }finally{signal?.removeEventListener('abort',abort);}
 }
 root.NumericOCR={read,cancel};
})(window);
