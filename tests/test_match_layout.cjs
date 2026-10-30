const assert=require("node:assert/strict"),fs=require("node:fs"),http=require("node:http"),path=require("node:path");
const pw=require(process.env.PLAYWRIGHT_MODULE||"playwright");
(async()=>{
 const root=path.resolve(__dirname,"../docs"),server=http.createServer((req,res)=>{const u=new URL(req.url,"http://localhost").pathname,f=path.resolve(root,"."+(u==="/"?"/index.html":u));if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(f,(e,b)=>{res.writeHead(e?404:200,{"Content-Type":f.endsWith(".js")?"application/javascript":f.endsWith(".css")?"text/css":f.endsWith(".json")?"application/json":"text/html"});res.end(e?"":b);});});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 try{for(const engine of (process.env.MATCH_LAYOUT_ENGINES||"chromium,webkit").split(",")){
  const browser=await pw[engine].launch({headless:true,...(engine==="chromium"&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
   const context=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion:"no-preference",serviceWorkers:"block"}),page=await context.newPage(),errors=[];
   page.on("pageerror",e=>errors.push(e.message));
   await page.addInitScript(()=>{localStorage.removeItem("squad-motion");localStorage.removeItem("squad-solid");localStorage.removeItem("squad-room");});
   await page.goto("http://127.0.0.1:"+server.address().port+"/");
   await page.waitForFunction(()=>window.__matchFocus);
   const seed=await page.evaluate(()=>{const s=SquadSession.blank(),heroes=__app.heroes.slice(0,10).map(h=>h.slug),who=__app.squad.players[0].key;SquadEngine.ROLES.forEach((r,i)=>{s.setup.ours[r]={hero:heroes[i],who:i===4?who:""};s.setup.theirs[r]={hero:heroes[i+5]};});localStorage.setItem("squad-me",JSON.stringify(who));localStorage.setItem("squad-match",JSON.stringify(s));return {s,who};});
   await page.reload();await page.waitForFunction(()=>window.__matchFocus);
   const geometry=()=>page.evaluate(()=>{
    const f=document.querySelector("#match-focus"),n=document.querySelector("#lifecycle"),b=f.getBoundingClientRect(),nb=n.getBoundingClientRect(),start=document.querySelector("#clock-start")?.getBoundingClientRect(),main=f.querySelector(".mf-main").getBoundingClientRect();
    return {height:innerHeight,width:innerWidth,focus:{top:b.top,bottom:b.bottom,height:b.height},mainHeight:main.height,cardHeight:nb.height,start:start&&{top:start.top,bottom:start.bottom},font:parseFloat(getComputedStyle(document.querySelector("#me")).fontSize),scale:visualViewport?.scale||1,motion:matchMedia("(prefers-reduced-motion:reduce)").matches,animation:getComputedStyle(document.querySelector("#tab-match")).animationName};
   });
   for(const viewport of [{width:430,height:932},{width:390,height:844},{width:844,height:390}]){
    await page.setViewportSize(viewport);await page.locator('[data-go="record"]').click();await page.evaluate(()=>scrollTo(0,800));await page.locator('[data-go="match"]').click();
    await page.waitForTimeout(450);
    const g=await geometry();console.log(engine,"draft",JSON.stringify(g));
    assert.equal(g.motion,false);assert(g.focus.height>g.height-200,"Match surface must be viewport-sized with motion enabled: "+JSON.stringify(g));
    assert(g.mainHeight>g.height-250,"setup must not collapse: "+JSON.stringify(g));
    assert(g.cardHeight>180,"recommended build card must stay expanded: "+JSON.stringify(g));
    assert(g.start&&g.start.top>=g.focus.top&&g.start.bottom<=g.focus.bottom+1,"Start game must remain reachable: "+JSON.stringify(g));
    assert(g.font>=16,"identity select must not trigger iOS auto-zoom");
    assert(Math.abs(g.scale-1)<.01);
   }
   // Viewport-fixed UI remains anchored even when the original tab is transformed or filtered.
   await page.setViewportSize({width:430,height:932});
   await page.evaluate(()=>{const t=document.querySelector("#tab-match");t.style.setProperty("transform","translateY(10px)","important");t.style.setProperty("filter","opacity(1)","important");});
   const isolated=await geometry();assert(isolated.focus.height>700&&isolated.mainHeight>600,"fixed Match UI must be isolated from tab containing blocks");
   fs.mkdirSync(path.resolve(__dirname,"../.test-artifacts"),{recursive:true});
   await page.screenshot({path:path.resolve(__dirname,"../.test-artifacts/match-layout-"+engine+".png")});
   await page.evaluate(({s})=>{s.stage="live";s.clock={startedAt:Date.now()-300000};localStorage.setItem("squad-match",JSON.stringify(s));},seed);
   await page.reload();await page.waitForFunction(()=>window.__matchFocus);await page.locator('[data-go="match"]').click();await page.waitForTimeout(450);
   const live=await page.evaluate(()=>{const f=document.querySelector("#match-focus"),b=f.getBoundingClientRect();return {height:b.height,viewport:innerHeight,lanes:[...f.querySelectorAll(".mf-lane")].map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom};})};});
   assert(live.height>live.viewport-200);assert.equal(live.lanes.length,5);assert(live.lanes.every(n=>n.bottom>n.top&&n.top>=0&&n.bottom<live.viewport-65));
   assert.deepEqual(errors,[]);await context.close();console.log("ok:",engine,"animated tab entry, scrolled navigation, draft/live bounds, containing-block isolation and iOS select sizing");
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
