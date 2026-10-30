const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
(async()=>{
 const root=path.resolve(__dirname,"../docs"),errors=[];
 const server=http.createServer((req,res)=>{const f=path.resolve(root,"."+new URL(req.url,"http://localhost").pathname.replace(/\/$/,"/index.html"));if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(f,(e,b)=>{res.writeHead(e?404:200,{"Content-Type":f.endsWith(".js")?"application/javascript":f.endsWith(".css")?"text/css":f.endsWith(".json")?"application/json":"text/html"});res.end(e?"":b);});});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"}),page=await context.newPage();
 page.on("pageerror",e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__said=[];window.SpeechSynthesisUtterance=function(text){this.text=text;};Object.defineProperty(window,"speechSynthesis",{configurable:true,value:{cancel(){},getVoices(){return[];},speak(u){window.__said.push(u.text);u.onend?.();}}});window.__revokedPhotoURLs=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.__revokedPhotoURLs.push(url);revoke(url);};});
 const url="http://127.0.0.1:"+server.address().port+"/";
 await page.addInitScript(()=>localStorage.setItem('squad-save-scans','off'));await page.goto(url);await page.waitForFunction(()=>window.__app&&window.SquadSession);
 const fixture=await page.evaluate(()=>{
   const S=SquadSession.blank(),roles=SquadEngine.ROLES,heroes=__app.heroes.slice(0,10).map(h=>h.slug),who=__app.squad.players[0].key;
   S.stage="live";S.clock={startedAt:Date.now()-600000};
   roles.forEach((r,i)=>{S.setup.ours[r]={hero:heroes[i],who:i===4?who:""};S.setup.theirs[r]={hero:heroes[i+5]};});
   localStorage.setItem("squad-me",JSON.stringify(who));localStorage.setItem("squad-match",JSON.stringify(S));
   return {S,who,heroes};
 });
 await page.reload();await page.waitForFunction(()=>window.__matchFocus);await page.locator('[data-go="match"]').click();
 const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=c.height=4;return c.toDataURL().split(",")[1];}),"base64");
 const install=async(mode="auto")=>page.evaluate(({heroes,mode})=>{
   window.__realAtlas ||= window.FreeOCR.atlas;
   window.PhotoRouter.classify=lines=>{window.__routedSameLines=lines===window.__lastRead?.lines;return{kind:"scoreboard",clockRead:{seconds:590}};};
   
   const result={sourceLayout:"live",ours:heroes.slice(0,5).map((hero,i)=>({hero,lvl:12,k:2,d:3,a:4,cs:100+i,gold:null,items:["Unknown"]})),theirs:heroes.slice(5).map((hero,i)=>({hero,lvl:13,k:4,d:1,a:2,cs:80+i,gold:null})),issues:[]};
   const ev=value=>({value,source:"measured-ocr",metrics:{ocr:.99},resolved:true});
   result.readConfidence={layout:ev("role-order"),ownTeam:{...ev("left"),source:"gamertag",metrics:{ocr:.99,match:1}}};
   for(const side of ["ours","theirs"])for(const row of result[side]){row.readConfidence={};for(const f of ["hero","lvl","k","d","a","cs"])row.readConfidence[f]=ev(row[f]);}
   if(mode==="partial")result.ours[0].readConfidence.k.metrics.ocr=.4;
   if(mode==="empty"){result.ours=[];result.theirs=[];}
   window.__ocrCalls=0;window.__ocrDone=false;window.__ocrJobs=[];window.__finishOCR=null;window.__cancelCalls=0;
   window.FreeScan={prepareBoard:read=>{window.__parsedSameRead=read===window.__lastRead;return{result:read.fixtureboard,cells:[]};}};
   window.FreeOCR={cancel:()=>window.__cancelCalls++,read:(image,{signal,onProgress}={})=>{
     window.__ocrCalls++;
     const job={width:image.width,height:image.height,aborted:signal?.aborted===true};window.__ocrJobs.push(job);
     signal?.addEventListener('abort',()=>job.aborted=true,{once:true});
     onProgress?.('Loading free reader…',.1);onProgress?.('Reading scoreboard…',.4);
     return new Promise(resolve=>{
       job.finish=()=>{window.__ocrDone=true;const read={lines:[],fixtureboard:JSON.parse(JSON.stringify(result))};window.__lastRead=read;resolve(read);};
       if(mode==='deferred')window.__finishOCR=job.finish;else job.finish();
     });
   }};
 },{heroes:fixture.heroes,mode});
 const upload=()=>page.locator("#auto-photo-file").setInputFiles({name:"scan.png",mimeType:"image/png",buffer:png});
 await install();await upload();await page.waitForFunction(()=>JSON.parse(localStorage.getItem("squad-match")).board);
 let board=await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board);
 assert.equal(board.sourceLayout,"live");assert.equal(board.ours[0].cs,100);assert.equal(board.ours[0].gold,null);
 assert(board.ours.every(r=>r.inventoryConfirmed===false&&r.items.every(x=>x===null)));
 assert(Date.now()-board.at>=9000&&Date.now()-board.at<20000,"uploads retain ten-second observation age");
 assert.equal(await page.locator("#scan-review").isHidden(),true);
 assert(!JSON.stringify(board).includes("readConfidence")&&!JSON.stringify(board).includes("data:image"));
 assert(await page.evaluate(()=>window.__said.length>0),"reading and accepted update can use speech");
 assert.equal(await page.evaluate(()=>window.__ocrCalls),1,"routing and parsing share one OCR result");
 assert(await page.evaluate(()=>window.__routedSameLines&&window.__parsedSameRead),"router and parser receive the same read");
 // The optional number pass must never discard a valid main-reader board.
 for(const failure of ['crop','reader']){
   const previous=await page.evaluate(()=>JSON.parse(localStorage.getItem('squad-match')).board.scanId);await install();
   await page.evaluate(failure=>{
     const prepare=FreeScan.prepareBoard;FreeScan.prepareBoard=read=>({...prepare(read),cells:[{id:'ours:0:k'}]});
     FreeScan.applyCells=(p,reads,options)=>options?.withGeometry?{...p,result:p.result}:p.result;
     FreeOCR.atlas=()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=20;return{canvas,reads:()=>({})};};
     FreeOCR.digits=()=>{if(failure==='crop')throw Error('Crop allocation failed');return[];};
     window.__realNumberRead ||= NumericOCR.read;NumericOCR.read=async()=>{throw Error('Number reader unavailable');};
   },failure);
   await upload();await page.waitForFunction(id=>JSON.parse(localStorage.getItem('squad-match')).board.scanId!==id,previous);assert.equal(await page.locator('#scan-review').isHidden(),true);
 }
 await page.evaluate(()=>NumericOCR.read=__realNumberRead);
 assert(await page.evaluate(()=>{const b=JSON.parse(localStorage.getItem('squad-match')).board;return b.previous?.sessionId===b.sessionId&&b.previous.ours[0].cs===100&&!b.previous.previous&&!b.previous.ours[0].items;}),'accepted scan stores bounded prior observations for tactical comparisons');
 // New photographs are not by themselves a reason to announce a different plan.
 const strategySpeech=()=>page.evaluate(()=>__said.filter(s=>s.startsWith('Main priority:')).length);
 assert.equal(await strategySpeech(),1,'identical accepted scans do not repeat strategy speech');
 const deathScan=async()=>{await install();await page.evaluate(()=>{const prepare=FreeScan.prepareBoard;FreeScan.prepareBoard=read=>{const p=prepare(read),r=p.result.ours[4];r.d=4;r.readConfidence.d.value=4;return p;};});const id=await page.evaluate(()=>JSON.parse(localStorage.getItem('squad-match')).board.scanId);await upload();await page.waitForFunction(id=>JSON.parse(localStorage.getItem('squad-match')).board.scanId!==id,id);};
 await deathScan();assert.equal(await strategySpeech(),2,'an observed death changes the next-trip plan once');
 assert.doesNotMatch(await page.locator('.mf-tactics h2').innerText(),/repeat deaths/i,'one death is never counted twice during render and speech');
 await deathScan();assert.equal(await strategySpeech(),2,'another photo of the same death counter keeps the plan');
 assert.match(await page.locator('#mf-age').innerText(),/plan unchanged/);
 await page.locator("#me").selectOption("");assert.equal(await page.locator(".mf-lane.mine").count(),0,"unassigned identity must not highlight any lane as yours");await page.locator("#me").selectOption(fixture.who);
 // An uncertain screen is verified by the scoreboard reader without asking for its type.
 await install("partial");await page.evaluate(()=>PhotoRouter.classify=()=>({kind:"unknown"}));await upload();
 await page.waitForFunction(()=>window.__ocrDone&&JSON.parse(localStorage.getItem("squad-match")).board.ours[0].k===null);
 assert.equal(await page.locator("dialog.screen-choice").count(),0);
 assert.equal(await page.locator("#scan-review").isHidden(),true);
 board=await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board);
 const accepted=board.scanId;
 // Unreadable photos keep the saved snapshot and request a retake, never data entry.
 await install("empty");await upload();await page.waitForFunction(()=>window.__ocrDone);
 await page.waitForFunction(()=>document.querySelector("#mf-age")?.textContent.includes("retake"));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board.scanId),accepted);
 assert.equal(await page.locator("#scan-review").isHidden(),true);assert.equal(await page.locator("#map-review").isHidden(),true);
 // A HUD route must never open the old objective/crop form.
 await page.evaluate(()=>PhotoRouter.classify=()=>({kind:"minimap"}));await upload();
 await page.waitForFunction(()=>document.querySelector("#mf-age")?.textContent.includes("HUD recognized"));
 assert.equal(await page.locator("#map-review").isHidden(),true);
 // Detail crops sample original pixels; all evidence stays in overview coordinates.
 const detailPNG=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=4097;c.height=2305;c.getContext('2d').fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];}),'base64');
 await install('deferred');
 await page.evaluate(()=>{
   const prepare=FreeScan.prepareBoard;
   FreeScan.prepareBoard=read=>{const p=prepare(read);p.result.readConfidence.layout.resolved=false;p.cells=[{id:'ours:0:hero',side:'ours',row:0,field:'hero',x:10,y:10,w:40,h:20}];return p;};
   FreeScan.applyCells=(p,reads,options)=>options?.withGeometry?{...p,result:p.result}:p.result;
   FreeOCR.atlas=(overview,cells,options)=>{
     window.__detailFrame=options?.image;window.__detailAtlas={overview:[overview.width,overview.height],original:[options.image.width,options.image.height],draws:[]};
     const original=CanvasRenderingContext2D.prototype.drawImage;
     CanvasRenderingContext2D.prototype.drawImage=function(...args){if(args[0]===options.image)__detailAtlas.draws.push(args.slice(1));return original.apply(this,args);};
     let sheet;try{sheet=__realAtlas(overview,cells,options);}finally{CanvasRenderingContext2D.prototype.drawImage=original;}
     __detailAtlas.sourcePoly=sheet.reads({items:[{text:'HERO',score:.99,poly:[[108,24],[232,24],[232,86],[108,86]]}]})['ours:0:hero'].items[0].sourcePoly;return sheet;
   };
 });
 await page.locator('#auto-photo-file').setInputFiles({name:'detail.png',mimeType:'image/png',buffer:detailPNG});await page.waitForFunction(()=>__ocrJobs.length===1);await page.evaluate(()=>__ocrJobs[0].finish());await page.waitForFunction(()=>__ocrJobs.length===2);
 const detail=await page.evaluate(()=>__detailAtlas);assert.deepEqual(detail.overview,[2048,1152]);assert.deepEqual(detail.original,[4097,2305]);assert.equal(detail.draws.length,1);
 const [sx,sy,sw,sh]=detail.draws[0];assert(Math.abs(sx-10*4097/2048)<1e-8);assert(Math.abs(sy-10*2305/1152)<1e-8);assert(Math.abs(sw-40*4097/2048)<1e-8);assert(Math.abs(sh-20*2305/1152)<1e-8);
 assert.deepEqual(detail.sourcePoly,[[10,10],[50,10],[50,30],[10,30]]);await page.evaluate(()=>__ocrJobs[1].finish());await page.waitForFunction(()=>document.querySelector('#scan-progress').hidden);await page.waitForFunction(()=>__detailFrame.width===0);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('squad-match')).board.scanId),accepted);
 // A decoder resolving after cancellation must close its bitmap, never attach it.
 await install('deferred');await page.evaluate(()=>{const create=window.createImageBitmap.bind(window);window.__originalCreateBitmap=create;let first=true;window.createImageBitmap=(...args)=>{if(!first)return create(...args);first=false;return new Promise(resolve=>window.__releasePhotoDecode=()=>create(...args).then(bitmap=>{window.__latePhotoBitmap=bitmap;resolve(bitmap);}));};});
 await upload();await page.waitForFunction(()=>typeof __releasePhotoDecode==='function');await page.locator('#scan-progress button').click();await upload();await page.waitForFunction(()=>__ocrJobs.length===1);await page.evaluate(()=>__releasePhotoDecode());await page.waitForFunction(()=>__latePhotoBitmap?.width===0);
 assert.equal(await page.evaluate(()=>__ocrJobs.length),1);await page.locator('#scan-progress button').click();await page.evaluate(()=>{__ocrJobs[0].finish();window.createImageBitmap=__originalCreateBitmap;});
 // HTML-image fallback releases its retained source and event handlers after scanning.
 await install('empty');await page.evaluate(()=>{window.__originalImage=window.Image;window.Image=function(...args){const img=new __originalImage(...args);window.__fallbackPhoto=img;return img;};window.createImageBitmap=async()=>{throw Error('Decoder unavailable');};});
 await page.locator('#auto-photo-file').setInputFiles({name:'fallback.png',mimeType:'image/png',buffer:detailPNG});await page.waitForFunction(()=>__ocrDone&&document.querySelector('#scan-progress').hidden);assert(await page.evaluate(()=>__fallbackPhoto.getAttribute('src')===''&&__fallbackPhoto.onload===null&&__fallbackPhoto.onerror===null));
 await page.evaluate(()=>{window.Image=__originalImage;window.createImageBitmap=__originalCreateBitmap;});
 // Oversized originals are released before OCR; only the bounded overview remains.
 const widePNG=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=6001;c.height=2;return c.toDataURL('image/png').split(',')[1];}),'base64');
 await install('deferred');await page.evaluate(()=>{window.createImageBitmap=async(...args)=>{const bitmap=await __originalCreateBitmap(...args);window.__oversizeBitmap=bitmap;return bitmap;};const read=FreeOCR.read;FreeOCR.read=(image,options)=>{window.__oversizeDetail=image._detailImage||null;return read(image,options);};});
 await page.locator('#auto-photo-file').setInputFiles({name:'oversize.png',mimeType:'image/png',buffer:widePNG});await page.waitForFunction(()=>__ocrJobs.length===1);assert.equal(await page.evaluate(()=>__oversizeDetail),null);assert.equal(await page.evaluate(()=>__oversizeBitmap.width),0);await page.locator('#scan-progress button').click();await page.evaluate(()=>{__ocrJobs[0].finish();window.createImageBitmap=__originalCreateBitmap;});
 // Camera callers can release their frame immediately after the capture callback.
 await install('deferred');await page.evaluate(()=>{
   window.__originalCameraOpen=CameraScan.open;CameraScan.open=(kind,capture)=>{const c=document.createElement('canvas');c.width=4097;c.height=2305;c._captureSource='camera';c._capturedAt=Date.now();window.__callerCamera=c;capture('auto',c);c.width=c.height=0;};
   const read=FreeOCR.read;FreeOCR.read=(image,options)=>{window.__cameraDetail=image._detailImage;return read(image,options);};document.querySelector('#camera-open').click();
 });await page.waitForFunction(()=>__ocrJobs.length===1);assert.equal(await page.evaluate(()=>__callerCamera.width),0);assert.deepEqual(await page.evaluate(()=>[__cameraDetail.width,__cameraDetail.height]),[4097,2305]);
 await page.locator('#scan-progress button').click();assert.equal(await page.evaluate(()=>__cameraDetail.width),0);await page.evaluate(()=>{__ocrJobs[0].finish();CameraScan.open=__originalCameraOpen;});
 // The selected image stays visible while reading; cancellation owns its URL and signal.
 const largePNG=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=4096;c.height=2304;return c.toDataURL('image/png').split(',')[1];}),'base64');
 const uploadLarge=()=>page.locator('#auto-photo-file').setInputFiles({name:'large-board.png',mimeType:'image/png',buffer:largePNG});
 await install('deferred');await uploadLarge();await page.waitForFunction(()=>window.__ocrJobs.length===1);
 const progress=page.locator('#scan-progress'),preview=progress.locator('.photo-scan-preview');
 assert(await preview.isVisible());await page.waitForFunction(()=>{const n=document.querySelector('.photo-scan-preview');return n?.complete&&n.naturalWidth>0;});
 assert.match(await progress.locator('.photo-scan-message').innerText(),/Reading scoreboard/);
 assert(await progress.getByRole('button',{name:'Cancel',exact:true}).isVisible(),'progress updates preserve Cancel');
 const bounded=await page.evaluate(()=>window.__ocrJobs[0]);
 assert(Math.max(bounded.width,bounded.height)<=2048&&Math.max(bounded.width,bounded.height)>0,'OCR image is bounded to 2048 pixels');
 assert(Math.abs(bounded.width/bounded.height-16/9)<.01,'downscaling preserves the photo aspect ratio');
 const previewURL=await preview.getAttribute('src'),beforeCancelSpeech=await page.evaluate(()=>window.__said.length);
 await progress.getByRole('button',{name:'Cancel',exact:true}).click();
 assert(await progress.isHidden());assert(await page.evaluate(()=>window.__ocrJobs[0].aborted));
 assert.equal(await page.evaluate(()=>window.__cancelCalls),1,'Cancel terminates the owned worker');
 assert(await page.evaluate(url=>window.__revokedPhotoURLs.includes(url),previewURL),'Cancel revokes the preview URL');
 await page.evaluate(()=>window.__ocrJobs[0].finish());await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('squad-match')).board.scanId),accepted,'late cancelled OCR cannot mutate the match');
 assert.equal(await page.evaluate(()=>window.__said.length),beforeCancelSpeech,'late cancelled OCR cannot announce acceptance');
 // A replacement photo gets its own lease; an old finally must leave its preview visible.
 await upload();await page.waitForFunction(()=>window.__ocrJobs.length===2);
 await uploadLarge();await page.waitForFunction(()=>window.__ocrJobs.length===3);
 assert(await page.evaluate(()=>window.__ocrJobs[1].aborted),'replacement aborts the previous read');
 const replacementURL=await preview.getAttribute('src'),beforeLateSpeech=await page.evaluate(()=>window.__said.length);
 await page.evaluate(()=>window.__ocrJobs[1].finish());await page.waitForTimeout(100);
 assert(await progress.isVisible(),'old cleanup must not hide replacement progress');assert.equal(await preview.getAttribute('src'),replacementURL);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('squad-match')).board.scanId),accepted);
 assert.equal(await page.evaluate(()=>window.__said.length),beforeLateSpeech);
 await page.evaluate(()=>window.__ocrJobs[2].finish());await page.waitForFunction(id=>JSON.parse(localStorage.getItem('squad-match')).board.scanId!==id,accepted);
 await progress.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__ocrCalls),3,'each photo gets one OCR read');
 assert(await page.evaluate(url=>window.__revokedPhotoURLs.includes(url),replacementURL),'successful cleanup revokes the replacement URL');
 board=await page.evaluate(()=>JSON.parse(localStorage.getItem('squad-match')).board);
 // Adjusting the match clock during OCR invalidates its captured observation context.
 const oldScan=board.scanId;await install("deferred");await upload();await page.waitForFunction(()=>typeof window.__finishOCR==="function");
 await page.evaluate(()=>document.querySelector('[data-adj="10"]').click());await page.evaluate(()=>window.__finishOCR());await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board.scanId),oldScan);
 // Reset during OCR must invalidate the original session.
 await install("deferred");await upload();await page.waitForFunction(()=>typeof window.__finishOCR==="function");
 page.once("dialog",d=>d.accept());await page.evaluate(()=>document.querySelector("#match-clear").click());
 await page.evaluate(()=>window.__finishOCR());await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board),null);
 await page.evaluate(()=>window.__matchFocus.readUpdate());assert.match(await page.evaluate(()=>window.__said.at(-1)),/new scoreboard photo/);
 await page.evaluate(()=>window.__matchFocus.scanFeedback("Take another photo."));assert.equal(await page.locator(".mf-draft-notice").isVisible(),true);
 // A weak loading photo must request a retake without opening a manual lineup form.
 await page.evaluate(({S,who})=>{localStorage.setItem("squad-match",JSON.stringify({...S,clock:{startedAt:Date.now()-600000}}));localStorage.setItem("squad-me",JSON.stringify(who));},fixture);
 await page.reload();await page.waitForFunction(()=>window.__matchFocus);await page.locator('[data-go="match"]').click();
 await page.evaluate(({heroes,who})=>{
   PhotoRouter.classify=()=>({kind:"loading"});ScanQuality.assess=()=>({auto:false,score:20,issues:[]});
   window.FreeOCR={read:async()=>({lines:[]}),cancel(){}};
   window.FreeScan={loading:()=>({ours:Object.fromEntries(SquadEngine.ROLES.map((r,i)=>[r,{hero:heroes[i],...(i===0?{who,readConfidence:{who:{value:who,source:"gamertag",metrics:{ocr:.2,match:1},resolved:true}}}:{})}])),theirs:Object.fromEntries(SquadEngine.ROLES.map((r,i)=>[r,{hero:heroes[i+5]}])),issues:[]})};
 },{heroes:fixture.heroes,who:fixture.who});
 await upload();await page.waitForFunction(()=>document.querySelector("#mf-age")?.textContent.includes("Lineup unclear"));assert.equal(await page.locator("#scan-review").isHidden(),true);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).setup.ours.OFFLANE.who),"");
 // A shop route is recognized without opening an input form or claiming ownership.
 await page.evaluate(({S,who})=>{localStorage.setItem("squad-match",JSON.stringify({...S,clock:{startedAt:Date.now()-600000}}));localStorage.setItem("squad-me",JSON.stringify(who));},fixture);
 await page.reload();await page.waitForFunction(()=>window.__matchFocus);await page.locator('[data-go="match"]').click();
 await page.evaluate(()=>{PhotoRouter.classify=()=>({kind:"build"});window.FreeOCR={read:async()=>({lines:[[{t:"Storm",c:99},{t:"Breaker",c:99}]]}),cancel(){}};});
 await upload();await page.waitForFunction(()=>document.querySelector("#mf-age")?.textContent.includes("Item shop recognized"));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board),null);assert.equal(await page.locator("dialog[open]").count(),0);
 // Shared speech is emitted only after the exact operation is acknowledged.
 await page.addInitScript(({seed})=>{
   if(!localStorage.getItem("test-room-enabled"))return;
   let remote=JSON.parse(JSON.stringify(seed)),version=7;
   const channel={on(){return this;},subscribe(cb){setTimeout(()=>cb("SUBSCRIBED"),0);return this;},track:async()=>{},presenceState:()=>({})};
   const client={channel:()=>channel,removeChannel(){},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{state:remote,version},error:null})})})}),rpc:async(name,args)=>new Promise(resolve=>{window.__roomACK=(conflict=false)=>{
     if(conflict)return resolve({data:null,error:{message:"conflict: room changed"}});
     for(const c of args.p_changes){let o=remote;for(const k of c.path.slice(0,-1))o=o[k]||={};o[c.path.at(-1)]=c.value;}
     remote._operations=[...(remote._operations||[]),args.p_operation];version++;resolve({data:{state:remote,version},error:null});
   };})};
   window.supabase={createClient:()=>client};
 },{seed:{...fixture.S,clock:{startedAt:Date.now()-600000}}});
 await page.evaluate(()=>{localStorage.setItem("test-room-enabled","1");localStorage.setItem("squad-room",JSON.stringify("TESTACK"));});
 await page.reload();await page.waitForFunction(()=>document.querySelector("#room")?.textContent.includes("TESTACK"));await page.locator('[data-go="match"]').click();
 await install();await upload();await page.waitForFunction(()=>typeof window.__roomACK==="function");
 const count=await page.evaluate(()=>window.__said.length);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__said.length),count,"optimistic render must not announce accepted strategy");
 await page.evaluate(()=>window.__roomACK());await page.waitForFunction(n=>window.__said.length>n,count);
 // A rejected operation refreshes server state and never announces acceptance.
 await page.evaluate(()=>window.__roomACK=null);await upload();await page.waitForFunction(()=>typeof window.__roomACK==="function");
 const rejected=await page.evaluate(()=>window.__said.length);await page.evaluate(()=>window.__roomACK(true));await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>window.__said.length),rejected);
 assert.deepEqual(errors,[]);console.log("ok: shared OCR, original-detail crops, camera ownership, fallback/decode cleanup, cancellation, bounded memory, automatic numeric apply, unknown inventories, stale-session and server-ACK guards");
 await context.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
