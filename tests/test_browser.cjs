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
 await page.locator('#scan-apply').click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem("squad-match")).board?.ours[0].d===4);
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
 assert.deepEqual(errors,[]);console.log("ok: slow-module handoff, identity, editable setup, start, timers, reload, scan review, correction, undo, camera guides, wake-lock acquisition/release/retry and finish");
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
