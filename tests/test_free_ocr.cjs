/* Exercises the shipped OCR models in real browsers without outside network access. */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http"),pw=require(process.env.PLAYWRIGHT_MODULE||"playwright");
(async()=>{const root=path.resolve(__dirname,"../docs"),counts=new Map(),server=http.createServer((req,res)=>{
const u=new URL(req.url,"http://local").pathname;if(u==="/"){res.setHeader("Content-Type","text/html");return res.end('<script src="/free-ocr.js"></script>');}
const f=path.resolve(root,"."+u);if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
counts.set(u,(counts.get(u)||0)+1);fs.readFile(f,(e,b)=>{res.writeHead(e?404:200,{"Content-Type":f.endsWith(".js")||f.endsWith(".mjs")?"application/javascript":f.endsWith(".json")?"application/json":"application/octet-stream"});res.end(e?"":b);});});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
try{for(const engine of (process.env.FREE_OCR_ENGINES||"chromium,webkit").split(",")){
const browser=await pw[engine].launch({headless:true,...(engine==="chromium"&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{const context=await browser.newContext({serviceWorkers:"block"}),page=await context.newPage(),errors=[],outside=[];
page.on("pageerror",e=>errors.push(e.message));await page.route("**/*",route=>{const u=new URL(route.request().url());if(!["blob:","data:"].includes(u.protocol)&&u.hostname!=="127.0.0.1"){outside.push(u.origin);return route.abort();}return route.continue();});
await page.goto("http://127.0.0.1:"+server.address().port+"/");
const run=()=>page.evaluate(async()=>{const c=document.createElement("canvas");c.width=900;c.height=240;const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);g.fillStyle="#111";g.font="bold 54px Arial";g.fillText("GREYSTONE",30,80);g.fillText("SKYLAR 150",30,170);const result=await FreeOCR.read(c);return{items:result.items,lines:result.lines};});
const result=await run(),text=result.items.map(i=>i.text).join(" ");assert.match(text,/GREYSTONE/);assert.match(text,/SKYLAR/);assert(result.items.every(i=>i.poly.length===4&&i.score>=0&&i.score<=1));
assert(result.lines.every(l=>l.length===1&&l[0].boxKind==="line"),"line boxes must not become invented word boxes");
const before=[...counts].filter(([k])=>k.endsWith(".gz"));await page.evaluate(()=>FreeOCR.cancel());await run();
assert.deepEqual([...counts].filter(([k])=>k.endsWith(".gz")),before,"verified models survive worker restart without another download");
// A cancelled decode must never submit its old bitmap to a replacement worker.
await page.evaluate(()=>{const original=window.createImageBitmap.bind(window);window.__originalBitmap=original;let first=true;window.createImageBitmap=(...args)=>{if(!first)return original(...args);first=false;return new Promise(resolve=>window.__releaseBitmap=()=>original(...args).then(resolve));};const c=document.createElement('canvas');c.width=200;c.height=100;window.__decodeControl=new AbortController();window.__decodeOutcome=null;FreeOCR.read(c,{signal:__decodeControl.signal}).then(()=>__decodeOutcome='unexpected',e=>__decodeOutcome=e.name);});
await page.waitForFunction(()=>typeof __releaseBitmap==='function');await page.evaluate(()=>__decodeControl.abort());await run();await page.evaluate(()=>__releaseBitmap());await page.waitForFunction(()=>__decodeOutcome!==null);assert.equal(await page.evaluate(()=>__decodeOutcome),'AbortError');
await page.evaluate(()=>window.createImageBitmap=window.__originalBitmap);await run();
await page.evaluate(()=>FreeOCR.cancel());await context.close();
// Aborting while the model is loading must terminate the worker and permit a retry.
const cold=await browser.newContext({serviceWorkers:"block"}),p=await cold.newPage();await p.goto("http://127.0.0.1:"+server.address().port+"/");
let release,intercepted;const reached=new Promise(r=>intercepted=r);
await p.route("**/runtime.wasm.gz",async route=>{intercepted();await new Promise(r=>release=r);try{await route.continue();}catch{}});
await p.evaluate(()=>{const c=document.createElement("canvas");c.width=200;c.height=100;window.__control=new AbortController();window.__done=null;FreeOCR.read(c,{signal:__control.signal}).then(()=>__done="unexpected",e=>__done=e.name);});
await reached;await p.evaluate(()=>__control.abort());await p.waitForFunction(()=>__done!==null);assert.equal(await p.evaluate(()=>__done),"AbortError");release();await p.unroute("**/runtime.wasm.gz");await p.evaluate(()=>FreeOCR.cancel());await cold.close();
assert.deepEqual(outside,[],"free OCR must not call an API or upload a photo");assert.deepEqual(errors,[]);console.log("ok:",engine,"real PaddleOCR text extraction, real line polygons, verified model cache, hard cancellation, zero external requests");
}finally{await browser.close();}}}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

