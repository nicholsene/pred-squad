const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=path.resolve(__dirname,'../docs'),server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local').pathname,f=path.resolve(root,'.'+(u==='/'?'/index.html':u));if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(f,(e,b)=>{res.writeHead(e?404:200,{'Content-Type':f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.json')?'application/json':'text/html'});res.end(e?'':b);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  const engine=process.env.MATCH_BROWSER||'chromium';browser=await pw[engine].launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('squad-save-scans','off');window.__said=[];window.SpeechSynthesisUtterance=function(text){this.text=text;};Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},speak(u){__said.push(u.text);}}});});
  const url='http://127.0.0.1:'+server.address().port+'/';await page.goto(url);await page.waitForFunction(()=>window.__matchFocus);
  const fixture=await page.evaluate(()=>{
   const s=SquadSession.blank(),roles=SquadEngine.ROLES,h=__app.heroes.slice(0,10).map(h=>h.slug),who=__app.squad.players[0].key,item=__app.items.find(i=>i.slot==='PASSIVE'&&!i.hidden);
   s.stage='live';s.clock={startedAt:Date.now()-60000};s.board={at:Date.now(),sessionId:s.id,ours:[],theirs:[]};
   roles.forEach((r,i)=>{s.setup.ours[r]={hero:h[i],who:i===0?who:''};s.setup.theirs[r]={hero:h[i+5]};for(const side of ['ours','theirs'])s.board[side].push({hero:h[i+(side==='theirs'?5:0)],lvl:10,cs:100,items:[],inventoryConfirmed:false});});
   localStorage.setItem('squad-match',JSON.stringify(s));localStorage.setItem('squad-me',JSON.stringify(who));return{who,item:item.name,label:item.label};
  });
  await page.reload();await page.waitForFunction(()=>window.__matchFocus);await page.locator('[data-go="match"]').click();
  await page.evaluate(()=>{window.__originalTrackerButton=document.querySelector('#tracker [data-step]');window.__clockButton=document.querySelector('#clock [data-adj]');window.__objectiveInput=document.querySelector('#objectives [data-time]');window.__clockText=document.querySelector('#clock .clock-big').textContent;__objectiveInput.value='0:10';});
  await page.waitForTimeout(2200);
  assert(await page.evaluate(()=>__originalTrackerButton===document.querySelector('#tracker [data-step]')),'clock ticks retain unchanged tracker controls');
  assert(await page.evaluate(()=>__clockButton===document.querySelector('#clock [data-adj]')&&__objectiveInput===document.querySelector('#objectives [data-time]')),'clock and objective controls survive timer ticks');
  assert.equal(await page.evaluate(()=>__objectiveInput.value),'0:10','unfinished countdown entry survives unfocused ticks');
  assert(await page.evaluate(()=>__clockText!==document.querySelector('#clock .clock-big').textContent),'clock text still advances');
  await page.evaluate(()=>document.querySelector('#objectives [data-countdown]').click());
  await page.waitForFunction(()=>!document.querySelector('#objectives [data-objective-remaining]').hidden);
  await page.evaluate(()=>{const input=document.querySelector('#objectives [data-time]');input.value='1:23';input.focus();window.__realNow=Date.now;Date.now=()=>__realNow()+11000;});
  await page.waitForFunction(()=>document.querySelector('#objectives [data-objective-remaining]').textContent==='0:00');
  assert.equal(await page.evaluate(()=>document.querySelector('#objectives [data-time]').value),'1:23','focused input is preserved while countdown expires');
  await page.evaluate(()=>{Date.now=__realNow;document.activeElement.blur();});
  await page.evaluate(()=>document.querySelector('#tracker [data-step]').click());
  assert(await page.evaluate(()=>__originalTrackerButton!==document.querySelector('#tracker [data-step]')),'a tracking change refreshes the controls');
  await page.evaluate(f=>{window.__optimizerResult=()=>({status:'stale'});window.__realBaseline=BuildPlans.getBaseline;BuildPlans.getBaseline=()=>({status:'ready',plan:{nextItem:f.item}});__matchFocus.render();},fixture);
  assert.equal(await page.locator('.mf-primary').count(),0,'stale optimizer cannot fall back to saved plan');
  await page.evaluate(()=>{window.__optimizerResult=()=>({status:'patch-review-required'});__matchFocus.render();});
  assert.equal(await page.locator('.mf-primary').count(),0,'patch gate cannot fall back to saved plan');
  await page.evaluate(f=>{window.__optimizerResult=()=>({status:'ready',assignment:[{who:f.who,item:f.item,targets:[],answers:[]}]});__matchFocus.render();__matchFocus.readUpdate();},fixture);
  assert.equal(await page.locator('.mf-primary').count(),1);assert((await page.evaluate(()=>__said.at(-1))).includes(fixture.label));
  assert.equal(await page.locator('#match-focus button[data-scan]:visible,#quick-scan:visible').count(),1,'one live camera action');
  await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+181000;__matchFocus.render();__matchFocus.readUpdate();});
  assert.equal(await page.locator('.mf-primary').count(),0);assert.match(await page.evaluate(()=>__said.at(-1)),/new scoreboard photo/);
  await page.evaluate(()=>BuildPlans.getBaseline=__realBaseline);
  for(let i=0;i<2;i++){
   await page.evaluate(()=>{document.querySelector('#objectives [data-time]').value='9:59';});page.once('dialog',d=>d.accept());await page.evaluate(()=>document.querySelector('#match-clear').click());
   await page.waitForFunction(()=>document.querySelector('#objectives [data-time]').value==='');
  }
  assert.deepEqual(errors,[]);console.log('ok: stable controls, advancing and focused timers, session input reset, stale/patch gates, fresh speech and camera action');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

