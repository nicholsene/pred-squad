const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../docs/scan-archive.js'));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/scan-archive.js'?'application/javascript':'text/html');res.end(req.url==='/scan-archive.js'?source:'<script src="/scan-archive.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const engine of ['chromium','webkit']){
  const browser=await pw[engine].launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{get:()=>localStorage.getItem('__testOffline')!=='true'});});
   const open=async()=>{await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.evaluate(()=>{
    window.__calls=[];window.__mode='ok';
    window.__rows=()=>new Promise((resolve,reject)=>{const q=indexedDB.open('squad-scan-archive-v1',1);q.onsuccess=()=>{const d=q.result,r=d.transaction('captures').objectStore('captures').getAll();r.onsuccess=()=>{d.close();resolve(r.result);};r.onerror=()=>reject(r.error);};q.onerror=()=>reject(q.error);});
    window.fetch=async(url,options)=>{
     if(url!=='https://archive.invalid/functions/v1/scan-collector')throw Error('Unexpected network request: '+url);
     const body=options.body;let call;
     if(body instanceof FormData){const bitmap=await createImageBitmap(body.get('photo'));call={kind:'photo',id:body.get('id'),width:bitmap.width,height:bitmap.height,metadata:JSON.parse(body.get('metadata'))};bitmap.close();}
     else call={kind:'observe',...JSON.parse(body)};
     __calls.push(call);
     if(__mode==='fail')return new Response(JSON.stringify({error:'simulated upload failure'}),{status:503});
     if(__mode==='holdObserve'&&call.kind==='observe'){__mode='ok';await new Promise(r=>window.__releaseRequest=r);}
     return new Response(JSON.stringify({ok:true}),{status:200});
    };
    window.archive=ScanArchive.create({url:'https://archive.invalid',key:'test-public-key'});
   });};
   const wait=async(id,state)=>{for(let n=0;n<160;n++){if(await page.evaluate(async({id,state})=>{const r=(await __rows()).find(r=>r.id===id);return !!r&&(state==='queued'?!!r.photo:state==='saved'?!!r.uploaded&&!r.photo&&r.revision===r.ackedRevision:r.revision>r.ackedRevision);},{id,state}))return;await page.waitForTimeout(50);}throw Error('Photo did not reach '+state);};
   const capture=async(metadata={})=>page.evaluate(metadata=>{const c=document.createElement('canvas');c.width=1920;c.height=1080;c.getContext('2d').fillRect(0,0,c.width,c.height);const id=archive.capture(c,metadata);c.width=0;c.height=0;return id;},metadata);
   await open();await page.evaluate(()=>archive.hold());
   const first=await capture({screen:'scoreboard'});await wait(first,'queued');await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>__calls.length),0,'OCR hold prevents upload');
   await page.evaluate(()=>{__mode='fail';archive.release();});
   await page.evaluate(id=>archive.update(id,{strategyDisplayed:true}),first);
   await page.waitForTimeout(900);assert.equal(await page.evaluate(()=>__calls.length),0,'metadata updates cannot bypass the post-strategy upload delay');
   await page.waitForFunction(()=>__calls.length===1);await page.waitForFunction(()=>archive.status().error.includes('simulated upload failure'));await wait(first,'queued');
   const photo=await page.evaluate(()=>__calls[0]);assert.equal(photo.width,1920);assert.equal(photo.height,1080);assert.equal(photo.metadata.screen,'scoreboard');
   await page.evaluate(()=>{__mode='ok';archive.retry();});await wait(first,'saved');

   await page.evaluate(()=>localStorage.setItem('__testOffline','true'));
   const offline=await capture({screen:'shop'});await wait(offline,'queued');await open();await wait(offline,'queued');await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>__calls.length),0,'offline reload retains queued photo without uploading');
   await page.evaluate(()=>{localStorage.removeItem('__testOffline');window.dispatchEvent(new Event('online'));});await wait(offline,'saved');

   await page.evaluate(()=>{archive.hold();__mode='holdObserve';});const race=await capture();await page.evaluate(id=>archive.update(id,{outcome:'read'}),race);await page.evaluate(()=>archive.release());
   await page.waitForFunction(()=>typeof __releaseRequest==='function');await page.evaluate(id=>archive.update(id,{outcome:'accepted',repaired:true}),race);await page.waitForTimeout(400);
   await page.evaluate(()=>__releaseRequest());await wait(race,'saved');
   const revisions=await page.evaluate(id=>__calls.filter(c=>c.id===id&&c.kind==='observe'),race);assert.equal(revisions.length,2,'update during in-flight upload is sent automatically');assert.equal(revisions.at(-1).observations.outcome,'accepted');assert.equal(revisions.at(-1).observations.repaired,true);assert(revisions.at(-1).revision>revisions[0].revision);

   await page.evaluate(()=>archive.hold());const paused=await capture();await wait(paused,'queued');const before=await page.evaluate(()=>__calls.length);await page.evaluate(()=>{archive.setEnabled(false);archive.release();});await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>__calls.length),before,'pause prevents queued uploads');assert.equal(await capture(),null,'pause also stops collecting new photos');
   await page.evaluate(()=>archive.setEnabled(true));await wait(paused,'saved');assert.deepEqual(errors,[]);await page.evaluate(()=>archive.destroy());await page.close();console.log('ok:',engine,'durable private outbox, original canvas, offline reload, retry, in-flight revisions and pause');
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
