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
 await page.addInitScript(()=>{window.__said=[];window.SpeechSynthesisUtterance=function(text){this.text=text;};Object.defineProperty(window,"speechSynthesis",{configurable:true,value:{cancel(){},getVoices(){return[];},speak(u){window.__said.push(u.text);u.onend?.();}}});});
 const url="http://127.0.0.1:"+server.address().port+"/";
 await page.goto(url);await page.waitForFunction(()=>window.__app&&window.SquadSession);
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
   window.PhotoRouter.detect=async()=>({kind:"scoreboard",clockRead:{seconds:590}});
   window.ScanQuality.assess=()=>({auto:true,score:90,issues:[],inventoryReady:{ours:Array(5).fill(false),theirs:Array(5).fill(false)}});
   const result={sourceLayout:"live",ours:heroes.slice(0,5).map((hero,i)=>({hero,lvl:12,k:2,d:3,a:4,cs:100+i,gold:null,items:["Unknown"]})),theirs:heroes.slice(5).map((hero,i)=>({hero,lvl:13,k:4,d:1,a:2,cs:80+i,gold:null})),issues:[]};
   window.ScoreboardScan={scan:mode==="deferred"?()=>new Promise(r=>window.__finishOCR=()=>r(result)):async()=>result};
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
 // Adjusting the match clock during OCR invalidates its captured observation context.
 const oldScan=board.scanId;await install("deferred");await upload();await page.waitForFunction(()=>typeof window.__finishOCR==="function");
 await page.evaluate(()=>document.querySelector('[data-adj="10"]').click());await page.evaluate(()=>window.__finishOCR());await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board.scanId),oldScan);
 // Reset during OCR must invalidate the original session.
 await install("deferred");await upload();await page.waitForFunction(()=>typeof window.__finishOCR==="function");
 page.once("dialog",d=>d.accept());await page.evaluate(()=>document.querySelector("#match-clear").click());
 await page.evaluate(()=>window.__finishOCR());await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board),null);
 // A shop route exposes name candidates without assigning them to owned slots.
 await page.evaluate(({S,who})=>{localStorage.setItem("squad-match",JSON.stringify({...S,clock:{startedAt:Date.now()-600000}}));localStorage.setItem("squad-me",JSON.stringify(who));},fixture);
 await page.reload();await page.waitForFunction(()=>window.__matchFocus);await page.locator('[data-go="match"]').click();
 await page.evaluate(()=>{PhotoRouter.detect=async()=>({kind:"build",lines:[[{t:"Storm",c:99},{t:"Breaker",c:99}]]});});
 await upload();await page.locator("#build-save").waitFor();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("squad-match")).board),null);
 assert.equal(await page.locator("#build-confirm").isChecked(),false);await page.locator("dialog [data-close]").click();
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
 assert.deepEqual(errors,[]);console.log("ok: automatic numeric apply, unknown inventories, upload age, stale-session rejection, shop candidates and server-ACK/conflict speech");
 await context.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
