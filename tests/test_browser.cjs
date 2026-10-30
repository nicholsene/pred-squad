const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
(async()=>{
const root=path.resolve(__dirname,"../docs"),errors=[];
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname),file=path.resolve(root,"."+(pathname==="/"?"/index.html":pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);res.end();return;}res.setHeader("Content-Type",file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":file.endsWith(".json")?"application/json":"text/html");res.end(b);});
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,args:["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"}),page=await context.newPage();
 page.on("pageerror",e=>errors.push(e.message));
 // Flow fixture: source-gating behavior is covered by test_counterbuild.js.
 await page.route("**/data/patch-review.json*",async route=>{const report=JSON.parse(fs.readFileSync(path.join(root,"data/patch-review.json")));await route.fulfill({contentType:"application/json",body:JSON.stringify({...report,status:"initial-baseline",sourceProblems:[]})});});

 // Deliberately delay Match to exercise the original handoff race.
 await page.route("**/match.js",async route=>{await new Promise(r=>setTimeout(r,1200));await route.continue();});
 await page.addInitScript(()=>{
   window.__wakeRequests=0;window.__wakeReleases=0;
   Object.defineProperty(navigator,"wakeLock",{configurable:true,value:{request:async()=>{
     window.__wakeRequests++;if(window.__wakeFailNext){window.__wakeFailNext=false;throw new Error("simulated browser denial");}const lock=new EventTarget();lock.released=false;
     lock.release=async()=>{if(lock.released)return;lock.released=true;window.__wakeReleases++;lock.dispatchEvent(new Event("release"));};return lock;
   }}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.locator('[data-go="picks"]').click();
 await page.locator('[data-apply="0"]').click();
 const expected=await page.evaluate(()=>window.SquadHandoff.pending);
 assert(expected&&Object.keys(expected.roles).length);
 await page.locator('dialog [data-person]').first().click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem("squad-match")||"null")?.recommendation);
 let state=await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")));
 for(const [who,role] of Object.entries(expected.roles)){assert.equal(state.setup.ours[role].who,who);assert.equal(state.setup.ours[role].hero,expected.heroes[who]);}
 assert.equal(state.stage,"draft");assert(!state.clock.startedAt);
 const current=Object.values(state.setup.ours).map(p=>p.hero),heroChoices=await page.locator('#setup select[data-path]').first().locator('option').evaluateAll(os=>os.map(o=>o.value));
 const alternate=heroChoices.find(h=>h&&!current.includes(h));
 if(alternate){await page.locator('#setup select[data-path]').first().selectOption(alternate);state=await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")));assert.equal(state.setup.ours.OFFLANE.hero,alternate);}
 // Reviewed starting-build flow. Text suggestions are mocked here; parser/OCR gates have separate tests.
 await page.locator('[data-go="picks"]').click();
 await page.locator('#starting-build-open').click();
 const plannedIds=['Overlord','Augmentation','Basilisk','Legacy','MistmeadowBuckler','Elafrost'];
 const planItems=await page.evaluate(ids=>ids.map(n=>window.__app.items.find(i=>i.name===n)),plannedIds);
 for(let i=0;i<6;i++)await page.locator(`[data-build-item="${i}"]`).fill(planItems[i].label);
 await page.locator('#build-next').selectOption('Augmentation');
 await page.locator('#build-save').click();assert.match(await page.locator('#build-error').innerText(),/Confirm/);
 await page.locator('#build-confirm').check();await page.locator('#build-save').click();
 await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('squad-match')).buildPlans).length===1);
 const storedBaseline=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('squad-match'));return Object.values(s.buildPlans)[0];});
 assert.equal(storedBaseline.items.length,6);assert.equal(storedBaseline.nextItem,'Augmentation');assert(!JSON.stringify(storedBaseline).includes('data:image'));
 await page.locator('#starting-build-open').click();
 await page.locator('#build-next').selectOption('');
 await page.locator('[data-build-item="5"]').fill(planItems[5].label);
 assert.equal(await page.locator('#build-next').inputValue(),'','an explicitly undecided purchase must remain undecided');
 await page.evaluate(ids=>window.BuildScan.scan=async()=>({items:ids,suggestions:ids.map(name=>({name,label:window.__app.items.find(i=>i.name===name).label})),uncertain:[],issues:['Review suggested names'],requiresReview:true}),plannedIds);
 await page.locator('#build-photo').setInputFiles({name:'build.png',mimeType:'image/png',buffer:Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=4;return c.toDataURL('image/png').split(',')[1];}),'base64')});
 await page.waitForFunction(()=>document.querySelector('#build-read-progress').textContent.includes('Review suggested names'));
 assert(!await page.locator('#build-confirm').isChecked());
 await page.locator('[data-build-item="3"]').focus();
 await page.locator('[data-candidate="Basilisk"]').click();assert.equal(await page.locator('[data-build-item="3"]').inputValue(),'Basilisk');
 await page.locator('dialog [data-close]').click();
 await page.locator('[data-go="match"]').click();
 await page.locator('#clock-start').click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem("squad-match")).stage==="live");
 if(!await page.locator('#wake').isChecked())await page.locator('label.toggle').click();await page.waitForFunction(()=>document.querySelector('#wake-note').textContent.includes('Screen stays on'));
 await page.locator('[data-go="record"]').click();await page.waitForFunction(()=>window.__wakeReleases>=1);
 await page.locator('[data-go="match"]').click();await page.waitForFunction(()=>window.__wakeRequests>=2 && document.querySelector('#wake-note').textContent.includes('Screen stays on'));
 await page.locator('label.toggle').click();assert.match(await page.locator('#wake-note').innerText(),/off/);
 await page.evaluate(()=>window.__wakeFailNext=true);
 await page.locator('label.toggle').click();await page.getByRole('button',{name:'Retry screen-on'}).waitFor();
 await page.getByRole('button',{name:'Retry screen-on'}).click();await page.waitForFunction(()=>document.querySelector('#wake-note').textContent.includes('Screen stays on'));
 await page.locator('label.toggle').click();assert.match(await page.locator('#wake-note').innerText(),/off/);
 await page.locator('[data-time="fangtooth"]').fill("2:00");
 await page.locator('[data-countdown="fangtooth"]').click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem("squad-match")).objectives.fangtooth?.respawnAt>=120);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#objectives')?.innerText.includes('Respawns in'));
 assert.match(await page.locator('#objectives').innerText(),/Respawns in/);
 // Scanner integration: uncertain results need a review and must not mutate state first.
 await page.evaluate(()=>{window.ScoreboardScan={scan:async()=>({ours:Array.from({length:5},()=>({hero:null,lvl:10,k:1,d:2,a:3,gold:5000})),theirs:Array.from({length:5},()=>({hero:null,lvl:10,k:2,d:1,a:3,gold:6000})),issues:["Check numbers"]})};});
 await page.locator('#board-file').setInputFiles({name:"board.png",mimeType:"image/png",buffer:Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=c.height=4;return c.toDataURL("image/png").split(",")[1];}),"base64")});
 await page.locator('#photo-original').click();
 await page.waitForSelector('#scan-review:not([hidden])');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board),null);
 await page.locator('#scan-review input[data-side="ours"][data-row="0"][data-field="d"]').fill("4");
 await page.locator('#board-now').check();
 assert(await page.locator('#scan-review').evaluate(el=>el.scrollWidth<=el.clientWidth+1),"review cards must fit phone width");
 assert.equal(await page.locator('#scan-review input[data-field="lvl"]').first().evaluate(el=>getComputedStyle(el).fontSize),'16px');
 fs.mkdirSync(path.resolve(__dirname,"../.test-artifacts"),{recursive:true});
 await page.locator('#scan-review').screenshot({path:path.resolve(__dirname,"../.test-artifacts/photo-review-mobile.png")});
 const observed=await page.evaluate(()=>{
   const cat=window.__app.items;
   const enemy=cat.find(i=>i.slot==="PASSIVE"&&!i.hidden&&i.stats.MAGICAL_POWER>=70);
   const own=cat.find(i=>i.slot==="PASSIVE"&&!i.hidden&&i.stats.MAGICAL_POWER>0&&i.cost>0&&i.cost<1500);
   const setup=JSON.parse(localStorage.getItem("squad-match")).setup;
   return {enemy,own,setup,playerIndex:["OFFLANE","JUNGLE","MIDLANE","SUPPORT","CARRY"].findIndex(r=>setup.ours[r]?.who===JSON.parse(localStorage.getItem("squad-me")))};
 });
 for(const [i,role] of ["OFFLANE","JUNGLE","MIDLANE","SUPPORT","CARRY"].entries())if(observed.setup.ours[role]?.hero)await page.locator(`#scan-review select[data-side="ours"][data-row="${i}"]`).selectOption(observed.setup.ours[role].hero);
 await page.locator('#scan-review select[data-side="theirs"][data-row="2"]').selectOption('gideon');
 await page.locator('#scan-review input[data-side="theirs"][data-row="2"][data-field="lvl"]').fill('14');
 await page.locator('#scan-review input[data-side="theirs"][data-row="2"][data-field="gold"]').fill('19000');
 await page.locator('[data-inventory="theirs-2"] summary').click();
 const enemySlot=page.locator('[data-item-side="theirs"][data-item-row="2"][data-item-slot="0"]');
 await enemySlot.fill('not-a-real-item');await page.locator('#scan-apply').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board),null);
 await enemySlot.fill(observed.enemy.label);
 await page.locator('[data-confirm-side="theirs"][data-confirm-row="2"]').check();
 await page.locator(`[data-inventory="ours-${observed.playerIndex}"] summary`).click();
 await page.locator(`[data-item-side="ours"][data-item-row="${observed.playerIndex}"][data-item-slot="0"]`).fill(observed.own.label);
 await page.locator(`[data-confirm-side="ours"][data-confirm-row="${observed.playerIndex}"]`).check();
 await page.locator(`[data-complete-side="ours"][data-complete-row="${observed.playerIndex}"]`).check();
 await page.locator('#scan-apply').click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem("squad-match")).board?.ours[0].d===4);
 const confirmed=await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board);
 assert.equal(confirmed.theirs[2].items[0],observed.enemy.name);assert.equal(confirmed.theirs[2].inventoryConfirmed,true);
 assert.equal(confirmed.theirs[2].inventoryComplete,false);assert(!JSON.stringify(confirmed).includes('data:image'));
 assert.equal(confirmed.ours[observed.playerIndex].currentGold,null);
 assert.match(await page.locator('#counterbuild').innerText(),/Gideon/);
 await page.waitForFunction(()=>window.__optimizerResult?.()?.assignment.some(a=>a.item));
 const optimized=await page.evaluate(()=>window.__optimizerResult());
 assert.equal(optimized.status,'ready');assert(optimized.search.evaluatedCombinations>1);
 assert(optimized.scenarios.some(s=>s.id==='magical-pressure'));
 await page.locator('[data-opt-scope="solo"]').click();
 assert.equal(await page.evaluate(()=>window.__optimizerResult().assignment.length),1);
 await page.locator('[data-opt-scope="squad"]').click();
 await page.locator('#optimizer-mode').selectOption('STANDARD');
 await page.locator('#optimizer [data-opt-section="profile"] > summary').click();
 assert.match(await page.locator('#optimizer [data-opt-section="profile"]').innerText(),/Standard/);
 await page.locator('#optimizer-mode').selectOption('RANKED');
 const selected=await page.evaluate(()=>window.__optimizerResult().assignment.find(a=>a.item));
 await page.locator('#optimizer [data-opt-player="'+selected.who+'"] [data-opt-choose]').first().click();
 await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('squad-match')).pivotIntents).length>0);
 assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('squad-match')).pivotIntents)[0].countsAsOwned),false);
 await page.locator('#optimizer').screenshot({path:path.resolve(__dirname,'../.test-artifacts/optimizer-mobile.png')});

 assert(await page.locator("#counterbuild .counter-purchases li").count()>0,"reviewed lobby build must produce a visible response");
 assert.doesNotMatch(await page.locator('#counterbuild').innerText(),/Affordable with confirmed current gold/);
 await page.locator('#counterbuild details[data-section="threats"]').evaluate(el=>el.open=true);
 await page.waitForTimeout(16000);
 assert(await page.locator('#counterbuild details[data-section="threats"]').evaluate(el=>el.open),"periodic updates must preserve opened evidence");
 assert(await page.locator('#counterbuild').evaluate(el=>el.querySelector('.counter-player.mine').compareDocumentPosition(el.querySelector('[data-section="threats"]'))&Node.DOCUMENT_POSITION_FOLLOWING));
 fs.mkdirSync(path.resolve(__dirname,"../.test-artifacts"),{recursive:true});
 await page.locator("#counterbuild").screenshot({path:path.resolve(__dirname,"../.test-artifacts/counterbuild-mobile.png")});
 const ownChoices=page.locator('#counterbuild .counter-player.mine .counter-purchases').first().locator('[data-choose-pivot]');
 assert.equal(await ownChoices.count(),3,'one counter need should offer three eligible alternatives');
 assert(await page.locator('#counterbuild .counter-player.mine img.item-image').count()>0,'recommendations show actual item artwork');
 await ownChoices.first().click();
 await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('squad-match')).pivotIntents).length===1);
 const intent=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('squad-match')).pivotIntents)[0]);
 assert.equal(intent.countsAsOwned,false);assert(intent.role);assert(!JSON.stringify(intent).includes('data:image'));
 await page.locator('#team-intents summary').click();
 assert.match(await page.locator('#team-intents').innerText(),/Purchase unconfirmed/);
 // Phone visual/accessibility checks for the deployed design.
 await page.setViewportSize({width:320,height:760});
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.classList.add('reduce-motion','solid-surfaces');});
 const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right,text:el.textContent.slice(0,60)})));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Match must fit a narrow phone: '+JSON.stringify(overflow));
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:path.resolve(__dirname,'../.test-artifacts/focus-dark-320.png')});
 const artwork=page.locator('#counterbuild .item-art').first();
 await artwork.locator('img').evaluate(img=>img.dispatchEvent(new Event('error')));
 assert(await artwork.evaluate(el=>el.classList.contains('image-missing')),'missing artwork keeps its fallback');
 await page.locator('[data-go="picks"]').click();
 await page.locator('#starting-build-open').click();
 assert(await page.locator('.build-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'starting-plan review must fit a narrow phone');
 await page.screenshot({path:path.resolve(__dirname,'../.test-artifacts/focus-plan-dark-320.png')});
 await page.locator('dialog [data-close]').click();
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.classList.remove('reduce-motion','solid-surfaces');});
 await page.locator('[data-go="match"]').click();
 await page.locator('#undo-scan').click();
 // Headless fake camera verifies framing and track cleanup, without recording a real camera.
 await page.evaluate(()=>{window.__cameraStreams=[];const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async opts=>{const stream=await get(opts);window.__cameraStreams.push(stream);return stream;};});
 await page.locator('#camera-open').click();await page.locator('#camera-capture:not([disabled])').waitFor();
 await page.locator('#camera-mode').selectOption('scoreboard');
 assert.equal(await page.locator('.camera-row').count(),10);
 await page.locator('#camera-mode').selectOption('hud');assert.equal(await page.locator('.camera-hud-map').count(),1);
 await page.locator('#camera-mode').selectOption('minimap');assert.equal(await page.locator('.camera-map-diamond').count(),1);
 await page.locator('#camera-cancel').click();
 assert(await page.evaluate(()=>window.__cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board),null);
 await page.locator('#match-finish').click();await page.waitForSelector('#postmatch:not([hidden])');
 fs.mkdirSync(path.resolve(__dirname,"../.test-artifacts"),{recursive:true});
 await page.screenshot({path:path.resolve(__dirname,"../.test-artifacts/match-mobile.png"),fullPage:true});
 assert.deepEqual(errors,[]);console.log("ok: slow-module handoff, identity, editable setup, start, timers, reload, scan review, correction, undo, camera guides, reviewed starting plans, solo/squad scenario optimizer, three item alternatives, planned pivots, narrow-phone layout, image fallbacks, wake-lock acquisition/release/retry and finish");
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
