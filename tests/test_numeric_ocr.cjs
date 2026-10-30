/* Real isolated-digit model, cancellation, cache and source-coordinate evidence. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=path.resolve(__dirname,'../docs'),counts=new Map(),server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://local').pathname;if(u==='/'){res.setHeader('Content-Type','text/html');return res.end('<script src="/free-ocr.js"></script><script src="/numeric-ocr.js"></script>');}
  const f=path.resolve(root,'.'+u);if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}counts.set(u,(counts.get(u)||0)+1);
  fs.readFile(f,(e,b)=>{res.writeHead(e?404:200,{'Content-Type':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'application/octet-stream'});res.end(e?'':b);});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const engine of (process.env.NUMERIC_OCR_ENGINES||'chromium,webkit').split(',')){
  const browser=await pw[engine].launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
   const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],outside=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(!['blob:','data:'].includes(u.protocol)&&u.hostname!=='127.0.0.1'){outside.push(u.origin);return route.abort();}return route.continue();});
   await page.goto('http://127.0.0.1:'+server.address().port+'/');
   const run=()=>page.evaluate(async()=>{const crops=['0','7','15'].map((text,i)=>{const canvas=document.createElement('canvas');canvas.width=180;canvas.height=100;const g=canvas.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,180,100);g.fillStyle='#000';g.font='bold 48px Arial';g.fillText(text,30,70);return{id:String(i),canvas,x:100,y:200,scale:4,border:8};});try{return await NumericOCR.read(crops);}finally{crops.forEach(c=>c.canvas.width=c.canvas.height=0);}});
   const first=await run();assert.deepEqual(Object.values(first).map(r=>r.items.map(i=>i.text).join('')),['0','7','15']);
   for(const r of Object.values(first))for(const item of r.items){assert.equal(item.engine,'tesseract');assert(item.poly.length===4);assert(item.sourcePoly.every(([x,y])=>x>=100&&x<=145&&y>=200&&y<=225));}
   const before=[...counts].filter(([k])=>k.endsWith('.gz'));await page.evaluate(()=>NumericOCR.cancel());await run();assert.deepEqual([...counts].filter(([k])=>k.endsWith('.gz')),before,'verified assets survive worker restart');
   // Nominal boxes cut the digit baseline; geometry must find complete glyphs.
   const geometry=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=600;c.height=250;const g=c.getContext('2d');g.fillStyle='#202020';g.fillRect(0,0,600,250);g.fillStyle='#fff';g.font='bold 16px Arial';g.textAlign='center';['2','5','16'].forEach((v,i)=>g.fillText(v,312+i*25,140));
    g.font='8px Arial';['K','D','A'].forEach((v,i)=>g.fillText(v,312+i*25,112));g.fillRect(285,118,100,1);
    const cells=['k','d','a'].map((field,i)=>({id:'ours:0:'+field,side:'ours',row:0,field,x:290+i*28,y:100,w:28,h:27}));
    const crops=FreeOCR.digits(c,cells),found=crops.map(p=>({id:p.id,x:p.x,y:p.y,w:(p.canvas.width-16)/4,h:(p.canvas.height-16)/4}));crops.forEach(p=>p.canvas.width=p.canvas.height=0);
    g.fillStyle='#fff';g.font='bold 16px Arial';['3','4','8'].forEach((v,i)=>g.fillText(v,312+i*25,116));
    const ambiguous=FreeOCR.digits(c,cells);const count=ambiguous.length;ambiguous.forEach(p=>p.canvas.width=p.canvas.height=0);c.width=c.height=0;return{found,count};
   });assert.equal(geometry.found.length,3);assert(geometry.found.every(c=>c.y>120&&c.h>=12),'complete digit baseline, not clipped headers');assert.equal(geometry.count,0,'two plausible numeral rows stay ambiguous');
   // Cancel while encoding a crop: late completion must never reach a new worker.
   await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=80;const encode=c.toBlob.bind(c);c.toBlob=(resolve,...args)=>window.__releaseNumber=()=>encode(resolve,...args);window.__numberControl=new AbortController();window.__numberDone=null;NumericOCR.read([{id:'late',canvas:c,x:0,y:0,border:8,scale:4}],{signal:__numberControl.signal}).then(()=>__numberDone='unexpected',e=>__numberDone=e.name);});
   await page.waitForFunction(()=>typeof __releaseNumber==='function');await page.evaluate(()=>__numberControl.abort());await run();await page.evaluate(()=>__releaseNumber());await page.waitForFunction(()=>__numberDone!==null);assert.equal(await page.evaluate(()=>__numberDone),'AbortError');
   await page.evaluate(async()=>{NumericOCR.cancel();const cache=await caches.open('squad-number-reader-v1');await cache.put(new URL('./vendor/numericocr/eng.traineddata.gz',document.baseURI),new Response('corrupt'));});
   const downloads=counts.get('/vendor/numericocr/eng.traineddata.gz');await run();assert.equal(counts.get('/vendor/numericocr/eng.traineddata.gz'),downloads+1,'corrupt cached model is rejected and downloaded again');
   await page.evaluate(()=>NumericOCR.cancel());assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);await context.close();
   const cold=await browser.newContext({serviceWorkers:'block'}),p=await cold.newPage();await p.goto('http://127.0.0.1:'+server.address().port+'/');
   let release,reached;const intercepted=new Promise(r=>reached=r);await p.route('**/numericocr/worker.js.gz',async route=>{reached();await new Promise(r=>release=r);try{await route.continue();}catch{}});
   await p.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;window.__coldNumber=new AbortController();window.__coldDone=null;NumericOCR.read([{id:'cold',canvas,x:0,y:0,scale:4,border:8}],{signal:__coldNumber.signal}).then(()=>__coldDone='unexpected',e=>__coldDone=e.name);});
   await intercepted;await p.evaluate(()=>__coldNumber.abort());await p.waitForFunction(()=>__coldDone!==null);assert.equal(await p.evaluate(()=>__coldDone),'AbortError');release();await p.unroute('**/numericocr/worker.js.gz');await cold.close();
   console.log('ok:',engine,'real numeric OCR, source polygons, verified cache, complete crops, ambiguity rejection and cancellation');
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
