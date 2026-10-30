/* Live match: setup (manual or scanned), shared room, live tracking, strategy.
 * Depends on window.SquadEngine, window.LoadingScan and window.__app (from app.js). */
(function () {
  "use strict";
  const SUPABASE_URL = "https://hijfyfysjneqhqgbsypx.supabase.co";
  // Public API key. Existing rooms allow public reads and use room codes for editing.
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpamZ5Znlzam5lcWhxZ2JzeXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyNDk1NzEsImV4cCI6MjEwODgyNTU3MX0.-46Mh5IODrX4oKnHuWvkn0KaFRzenpqC-wwt_z1cgyA";
  const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

  const A = window.__app, E = window.SquadEngine;
  const $ = s => document.querySelector(s);
  const esc = A.esc, pct = A.pct, wl = A.wl, heroName = A.heroName, label = A.label, roleName = r => E.ROLE_LABEL[r] || r;
  const ROLES = E.ROLES;
  const num=(x,d=0)=>Number(x).toLocaleString(undefined,{maximumFractionDigits:d});

  // ---------- state ----------
  const M = window.SquadSession;
  const blank = M.blank;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let S = M.normalize(store.get("squad-match", null));
  let previousScan = null, scanBusy = false, pendingPlanOpen = false;
  let room = null;          // { code, client, channel }
  let me = store.get("squad-me", "");
  let tick = null, lastLifecycleStage = null, intakeMode = "scan", draftGameTime = null, draftGameSession = S.id;
  const planningUI=window.SquadPlanning.create({app:A,getState:()=>S,getMe:()=>me,commit,toast,exclusiveScan});
  const optimizerUI=window.SquadOptimizerUI.create({app:A,getState:()=>S,getMe:()=>me,planningUI,toast});
  window.__optimizerResult=()=>optimizerUI.getResult();

  // ---------- persistence: local or shared ----------
  const applyChanges = (state, changes) => {
    for (const c of changes) {
      let o = state;
      for (const k of c.path.slice(0,-1)) o = o[k] ||= {};
      const key = c.path.at(-1);
      o[key] = c.increment == null ? M.clone(c.value) : Math.max(0, (Number(o[key]) || 0) + c.increment);
    }
    return state;
  };
  function persist() { store.set("squad-match", S); }
  function receive(data) {
    if (!room || data.version < room.version) return;
    room.version = data.version; room.base = M.normalize(data.state);
    for(const [id,notice] of scanAnnouncements){if((data.state?._operations||[]).includes(id)){scanAnnouncements.delete(id);if(notice.sessionId===data.state.id&&notice.roomCode===room.code)queueMicrotask(()=>{if(room?.code!==notice.roomCode||S.id!==notice.sessionId||me!==notice.who||room.pending.some(p=>!(room.base._operations||[]).includes(p.id))||scanEvidenceKey(S)!==notice.evidence)return;matchFocus?.noticeScan(notice.kind,id);});}}
    S = applyChanges(M.clone(room.base), room.pending.filter(p => !(data.state?._operations || []).includes(p.id)).flatMap(p => p.changes)); persist(); render();
  }
  async function refreshRoom() {
    const current = room; if (!current) return;
    const {data,error} = await current.client.from("rooms").select("state,version").eq("code",current.code).maybeSingle();
    if (room !== current) return;
    if (error || !data) { current.status = "Disconnected — retry"; renderRoom(); return; }
    receive(data);
  }
  async function flush() {
    const current = room;
    if (!current || current.sending || !navigator.onLine) return;
    current.sending = true;
    try {
      while (room === current && current.pending.length) {
        const op = current.pending[0]; current.status = "Changes pending"; renderRoom();
        const {data,error} = await current.client.rpc("patch_room_batch", {
          p_code:current.code, p_changes:op.changes, p_operation:op.id, p_expected_version:op.expected ?? null,
        });
        if (room !== current) return;
        if (error) {
          if (/conflict/i.test(error.message)) {
            scanAnnouncements.delete(op.id);current.pending.shift(); store.set("squad-outbox-"+current.code,current.pending);
            await refreshRoom(); toast("Room changed. Review the latest state and apply your scan again."); continue;
          }
          current.status = "Sync failed — retry"; toast("Sync failed: " + error.message); break;
        }
        current.pending.shift(); store.set("squad-outbox-"+current.code,current.pending);
        receive(data);
      }
      if (!current.pending.length) current.status = current.connected ? "Synced" : "Reconnecting";
    } catch (e) { current.status = "Offline — changes saved on this device"; }
    finally { current.sending = false; if (room === current) renderRoom(); }
  }
  function commit(changes, strict = false) {
    if (room) {
      room.pending.push({id:crypto.randomUUID(), changes:M.clone(changes), expected:strict === false ? null : typeof strict === "number" ? strict : room.version});
      store.set("squad-outbox-"+room.code,room.pending);
    }
    applyChanges(S, changes); persist(); render(); flush();return room?.pending.at(-1)?.id||null;
  }
  function setPath(path, value) { commit([{path,value}]); }
  function replaceState(next) { commit(Object.entries(next).filter(([k])=>!k.startsWith("_")).map(([k,value])=>({path:[k],value}))); }
  addEventListener("online", () => { refreshRoom().then(flush); });
  addEventListener("offline", () => { if(room){room.status="Offline — changes saved on this device";renderRoom();} });

  // ---------- live room ----------
  function loadSB() {
    if (window.supabase) return Promise.resolve(window.supabase);
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = SB_LIB; s.onload = () => res(window.supabase); s.onerror = () => rej(new Error("Couldn't load live sync (offline?)")); document.head.appendChild(s); });
  }
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % "ABCDEFGHJKMNPQRSTUVWXYZ23456789".length]).join("");

  async function joinRoom(code, create) {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 4 || code.length > 8) return toast("Room codes are 4–8 letters/numbers");
    setRoomStatus("Connecting…");
    try {
      const sb = await loadSB();
      const client = sb.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
      if (create) {
        let error;
        for (let attempt=0; attempt<4; attempt++) {
          const result = await client.from("rooms").insert({ code, state:S }); error=result.error;
          if (!error) break;
          if (error.code !== "23505") throw error;
          code=newCode();
        }
        if (error) throw error;
      }
      const { data, error } = await client.from("rooms").select("state,version").eq("code", code).maybeSingle();
      if (error) throw error;
      if (!data) { setRoomStatus(""); return toast("No room with that code (rooms last 3 days)"); }
      if (room) leaveRoom(true);
      S = M.normalize(data.state);
      const channel = client.channel("room:" + code, { config: { presence: { key: me || "guest-" + Math.random().toString(36).slice(2, 6) } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `code=eq.${code}` }, payload => {
          receive(payload.new);
        })
        .on("presence", { event: "sync" }, () => renderRoom())
        .subscribe(async st => {
          if (!room || room.code !== code) return;
          room.connected = st === "SUBSCRIBED";
          room.status = room.connected ? "Synced" : "Reconnecting";
          if (room.connected) { await channel.track({ who: me || "guest", at: Date.now() }); await refreshRoom(); flush(); }
          renderRoom();
        });
      room = { code, client, channel, version:data.version, base:M.clone(S), pending:store.get("squad-outbox-"+code, []), status:"Connecting", connected:false };
      S = applyChanges(S, room.pending.flatMap(p=>p.changes)); persist();
      const u = new URL(location.href); u.searchParams.set("room", code); history.replaceState(null, "", u);
      store.set("squad-room", code);
      render(); renderRoom();
      if (!wake.on && store.get("squad-wake",null)!==false) wake.enable();
    } catch (e) { setRoomStatus(""); toast("Couldn't connect: " + (e.message || e)); }
  }
  function leaveRoom(silent) {
    if (!room) return;
    try { room.client.removeChannel(room.channel); } catch {}
    room = null; store.set("squad-room", null);
    const u = new URL(location.href); u.searchParams.delete("room"); history.replaceState(null, "", u);
    if (!silent) { renderRoom(); render(); }
  }
  function roomPeople() {
    if (!room) return [];
    const st = room.channel.presenceState(); return [...new Set(Object.values(st).flat().map(p => p.who).filter(Boolean))];
  }
  function setRoomStatus(t) { const el = $("#room-status"); if (el) el.textContent = t; }

  // ---------- wake lock ----------
  const matchVisible=()=>document.visibilityState==="visible"&&(!matchMedia("(max-width:760px)").matches||$("#tab-match").classList.contains("active"));
  const wake = {
    on: store.get("squad-wake",false), lock:null, pending:false, error:"",
    supported: "wakeLock" in navigator,
    async enable() {
      if(!this.supported){this.on=false;renderWake();return toast("Screen-on is unavailable in this browser. Adjust device auto-lock or try a supported browser.");}
      this.on=true;store.set("squad-wake",true);
      if(this.pending||this.lock||!matchVisible()){renderWake();return;}
      this.pending=true;this.error="";renderWake();
      try {
        const lock=await navigator.wakeLock.request("screen");
        if(!this.on||!matchVisible()){await lock.release();return;}
        this.lock=lock;
        lock.addEventListener("release",()=>{if(this.lock===lock)this.lock=null;renderWake();});
      }catch(e){this.error="Browser could not keep the screen on. Retry while Match is visible.";}
      finally{this.pending=false;renderWake();}
    },
    suspend(){const lock=this.lock;this.lock=null;if(lock)lock.release().catch(()=>{});renderWake();},
    disable(){this.on=false;this.error="";store.set("squad-wake",false);this.suspend();},
  };
  document.addEventListener("visibilitychange",()=>{
    if(matchVisible()&&wake.on&&!wake.lock)wake.enable();else if(!matchVisible())wake.suspend();
  });
  document.addEventListener("squad:tab",()=>{
    if(matchVisible()&&wake.on&&!wake.lock)wake.enable();else if(!matchVisible())wake.suspend();
  });
  function renderWake() {
    const t=$("#wake"),note=$("#wake-note");if(!t||!note)return;
    t.checked=!!wake.on;t.disabled=!wake.supported;
    note.textContent=!wake.supported?"Screen-on isn't supported by this browser.":wake.lock&&!wake.lock.released?"Screen stays on while Match is visible.":wake.pending?"Requesting screen-on…":wake.on?(wake.error||"Screen-on paused. Return to Match or retry to resume."):"Screen-on is off.";
    if(wake.supported&&wake.on&&!wake.lock&&!wake.pending&&matchVisible()){
      const b=document.createElement("button");b.type="button";b.className="chip ghost";b.textContent="Retry screen-on";b.onclick=()=>wake.enable();note.append(" ",b);
    }
  }

  // ---------- clock ----------
  const clockSec = () => S.clock && S.clock.startedAt ? Math.max(0, Math.floor(((S.stage === "finished" ? S.finishedAt : Date.now()) - S.clock.startedAt) / 1000)) : null;
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;


  // Photo context is captured before OCR; a reset, identity or room change invalidates it.
  const photoTime=window.PhotoTime;
  let matchFocus=null,lastBoardRead=null;
  const scanAnnouncements=new Map();
  function scanTicket(file){
    photoTime.stamp(file);
    return file._scanTicket ||= {sessionId:S.id,roomCode:room?.code||null,version:room?.version??null,setup:JSON.stringify(S.setup),stage:S.stage,clock:JSON.stringify(S.clock),who:me};
  }
  function currentScan(t){
    return t&&!t.cancelled&&S.id===t.sessionId&&(room?.code||null)===t.roomCode&&(room?.version??null)===t.version&&JSON.stringify(S.setup)===t.setup&&S.stage===t.stage&&JSON.stringify(S.clock)===t.clock&&me===t.who;
  }
  function requireScan(t){if(!currentScan(t))throw new Error("Match or room changed. Scan again for the current match.");}
  function scanEvidenceKey(state){return JSON.stringify([state.setup,state.board,state.objectives,state.buildPlans,state.pivotIntents,state.stage,state.clock]);}
  function savedScan(changes,ticket,kind="scoreboard"){
    requireScan(ticket);
    const id=commit(changes,ticket.version??true);
    if(room)scanAnnouncements.set(id,{sessionId:ticket.sessionId,roomCode:ticket.roomCode,kind,who:me,evidence:scanEvidenceKey(S)});
    else matchFocus?.noticeScan(kind,crypto.randomUUID());
    return id;
  }
  let activePhoto=null;
  const photoAbort=()=>new DOMException("Photo scan cancelled.","AbortError");
  function requirePhoto(job){if(activePhoto!==job||job.controller.signal.aborted)throw photoAbort();requireScan(job.ticket);}
  function finishPhoto(job){
    if(job.url){job.preview.removeAttribute("src");URL.revokeObjectURL(job.url);job.url=null;}
    if(job.image){job.image.width=job.image.height=0;job.image=null;}
    if(activePhoto!==job)return;
    activePhoto=null;scanBusy=false;hideScanProgress();
    const box=$("#scan-progress");box.classList.remove("photo-scan-progress");box.innerHTML='<div class="bar-meter"><i></i></div><span class="muted"></span>';
  }
  function cancelPhoto(message="Photo scan cancelled.",quiet=false){
    const job=activePhoto;if(!job)return;job.ticket.cancelled=true;job.controller.abort();window.FreeOCR?.cancel();finishPhoto(job);if(!quiet)matchFocus?.scanFeedback(message);
  }
  function photoProgress(job,message,fraction){
    if(activePhoto!==job||job.controller.signal.aborted)return;
    if(!currentScan(job.ticket)){cancelPhoto("Match changed. Take a new photo for this match.");return;}
    job.message.textContent=message;const n=Number(fraction);job.bar.style.width=(Number.isFinite(n)?Math.round(Math.max(0,Math.min(1,n))*100):0)+"%";
  }
  function beginPhoto(file){
    if(scanBusy&&!activePhoto){toast("Wait for the current scan to finish.");return null;}cancelPhoto("",true);
    const job={ticket:scanTicket(file),controller:new AbortController(),url:null,image:null};
    const box=$("#scan-progress");box.innerHTML='<img class="photo-scan-preview" alt="Selected game photo"><div><span class="photo-scan-message" role="status">Opening photo…</span><div class="bar-meter"><i></i></div></div><button type="button" class="chip">Cancel</button>';
    job.preview=box.querySelector("img");job.message=box.querySelector("span");job.bar=box.querySelector("i");
    if(file instanceof Blob){job.url=URL.createObjectURL(file);job.preview.src=job.url;}
    else{const c=document.createElement("canvas"),w=file.width||1,h=file.height||1,s=Math.min(96/w,72/h);c.width=Math.max(1,Math.round(w*s));c.height=Math.max(1,Math.round(h*s));c.getContext("2d").drawImage(file,0,0,c.width,c.height);job.preview.src=c.toDataURL("image/jpeg",.65);c.width=c.height=0;}
    box.querySelector("button").onclick=()=>cancelPhoto();activePhoto=job;scanBusy=true;box.classList.add("photo-scan-progress");box.hidden=false;$("#board-progress").hidden=true;return job;
  }
  async function decodePhoto(file,job){
    const signal=job.controller.signal;let source=file,bitmap=null,fallback=null;
    const check=()=>{if(signal.aborted)throw photoAbort();};check();
    try{
      if(file instanceof Blob){
        if(window.createImageBitmap){try{bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});source=bitmap;}catch{check();}}
        check();
        if(!bitmap){fallback=await new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>stop(new Error("Could not open this photo. Try a JPEG or PNG.")),15000),clear=()=>{clearTimeout(timer);img.onload=img.onerror=null;signal.removeEventListener("abort",abort);},stop=error=>{clear();img.src="";reject(error);},abort=()=>stop(photoAbort());img.onload=()=>{clear();resolve(img);};img.onerror=()=>stop(new Error("Could not open this photo. Try a JPEG or PNG."));signal.addEventListener("abort",abort,{once:true});img.src=job.url;});source=fallback;}
      }
      check();const w=source.naturalWidth||source.width,h=source.naturalHeight||source.height;if(!(w>0&&h>0))throw new Error("Photo dimensions are invalid.");
      const scale=Math.min(1,2048/w,2048/h),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));canvas.getContext("2d").drawImage(source,0,0,canvas.width,canvas.height);photoTime.copy(file,canvas);return canvas;
    }finally{bitmap?.close();if(fallback)fallback.src="";}
  }
  function scanProgress(id,message,fraction){
    if(activePhoto){photoProgress(activePhoto,message,fraction);return;}
    const box=$(id);box.querySelectorAll("button").forEach(b=>b.remove());box.hidden=false;box.querySelector("span").textContent=message;
    box.querySelector("i").style.width=Math.round((fraction||0)*100)+"%";
  }
  function hideScanProgress(){ $("#scan-progress").hidden=true;$("#board-progress").hidden=true; }
  function scanFeedback(message){hideScanProgress();matchFocus?.scanFeedback(message);toast(message);}
  function setupFromRead(res){
    const setup=M.clone(S.setup),identified=new Set();
    for(const side of ["ours","theirs"])for(const role of ROLES){
      const row=res[side]?.[role];if(!row?.hero)continue;
      const previous=setup[side][role]||{};
      setup[side][role]={...previous,hero:row.hero};
      if(side==="ours"&&row.who&&row.readConfidence?.who?.metrics?.match===1&&window.ScanQuality.reliability(row.readConfidence.who,row.who)>=90){identified.add(row.who);setup.ours[role].who=row.who;}
      else if(side==="ours"&&previous.hero!==row.hero)setup.ours[role].who="";
    }
    for(const role of ROLES)if(identified.has(setup.ours[role]?.who)&&res.ours?.[role]?.who!==setup.ours[role].who)setup.ours[role].who="";
    return setup;
  }
  async function runScan(file,{handsFree=false,ocr=null,signal,guard=()=>{}}={}){
    const ticket=scanTicket(file);
    try{
      const res=ocr?(window.FreeScan.loading?.(ocr,{heroes:A.heroes,squad:A.squad.players})||{ours:{},theirs:{},issues:["Loading screen unclear."]}):await window.LoadingScan.scan(file,A.heroes,A.squad.players,(m,f)=>scanProgress("#scan-progress",m,f));
      guard();
      requireScan(ticket);
      const setup=setupFromRead(res),quality=window.ScanQuality.assess("loading",res,{heroes:A.heroes,items:A.items,squad:A.squad.players});
      if(quality.auto&&!M.validateSetup(setup).length){
        previousScan={before:{setup:M.clone(S.setup)},after:{setup:M.clone(setup)}};
        guard();savedScan([{path:["setup"],value:setup}],ticket,"loading");hideScanProgress();toast("Lineup updated.");
      }else if(handsFree){
        scanFeedback("Lineup unclear. Fill the frame with the loading screen and take another photo.");
      }else{
        reviewSetup(setup,[...(res.issues||[]),...quality.issues],ticket);
        hideScanProgress();
      }
    }catch(e){if(signal?.aborted)return;if(ocr&&!currentScan(ticket))throw e;if(handsFree)scanFeedback("Couldn't read this photo. Take another photo of the full screen.");else scanProgress("#scan-progress","Scan needs attention: "+(e.message||e),1);}
  }
  let sbLib=null;
  const loadScoreboard=()=>sbLib||=(window.ScoreboardScan?Promise.resolve():new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.src="scoreboard.js";script.onload=resolve;script.onerror=()=>reject(new Error("Couldn't load the scoreboard reader"));document.head.append(script);
  }));
  function cleanBoard(board){
    const out={at:board.at,capturedAt:board.capturedAt,clock:board.clock,sessionId:board.sessionId,scanId:crypto.randomUUID(),sourceLayout:board.sourceLayout,autoApplied:board.autoApplied===true};
    for(const side of ["ours","theirs"])out[side]=board[side].map((r,i)=>{
      const row={role:ROLES[i],hero:r.hero||null,items:Array.from({length:6},(_,j)=>r.items?.[j]??null),
        inventoryConfirmed:r.inventoryConfirmed===true,inventoryComplete:r.inventoryComplete===true,inventoryAt:board.at};
      for(const k of ["lvl","k","d","a","gold","cs","currentGold"])row[k]=Number.isFinite(r[k])?r[k]:null;
      if(r.who)row.who=r.who;
      return row;
    });
    return out;
  }
  function boardChanges(board,whoRows){
    if(S.board?.sessionId===S.id&&board.at<S.board.at-1000)throw new Error("A newer scoreboard is already saved. Scan a current photo.");
    M.validateBoard(board,{items:A.items,heroes:A.heroes,sessionId:S.id});
    const setup=M.clone(S.setup),live=M.clone(S.live),identified=new Set();
    for(const side of ["ours","theirs"])ROLES.forEach((role,i)=>{
      const row=board[side][i],old=setup[side][role]||{};
      setup[side][role]={...old,hero:row.hero||""};
      if(side==="ours"){
        const who=whoRows?whoRows[i]:row.who||(old.hero===row.hero?old.who:"");
        setup.ours[role].who=who||"";if(row.who)identified.add(row.who);
      }
    });
    if(!whoRows)ROLES.forEach((role,i)=>{const who=setup.ours[role].who;if(identified.has(who)&&board.ours[i].who!==who)setup.ours[role].who="";});
    const errors=M.validateSetup(setup);if(errors.length)throw new Error(errors.join(" "));
    ROLES.forEach((r,i)=>{const who=setup.ours[r].who;if(who&&board.ours[i].d!=null)live[who]={...live[who],deaths:board.ours[i].d};});
    for(const role of ROLES)setup.theirs[role].fed=false;
    const st=E.boardState(board,setup,A.T);
    for(const f of st.fed)setup.theirs[f.role]={...setup.theirs[f.role],fed:true};
    previousScan={before:{setup:M.clone(S.setup),live:M.clone(S.live),board:M.clone(S.board)},after:{setup:M.clone(setup),live:M.clone(live),board:M.clone(board)}};
    return [{path:["setup"],value:setup},{path:["live"],value:live},{path:["board"],value:board}];
  }
  async function runBoardScan(file,detected,{handsFree=false,ocr=null,signal,guard=()=>{}}={}){
    const ticket=scanTicket(file);
    try{
      let res;
      if(ocr){
        const prepared=window.FreeScan.prepareBoard(ocr,{heroes:A.heroes,squad:A.squad.players});
        if(prepared.cells?.length){
          const sheet=window.FreeOCR.atlas(file,prepared.cells);
          try{const enlarged=await window.FreeOCR.read(sheet.canvas,{signal,onProgress:(m,f)=>scanProgress("#board-progress",m.startsWith("Reading")?"Reading enlarged player stats…":m,f)});guard();res=window.FreeScan.applyCells(prepared,sheet.reads(enlarged));}
          finally{sheet.canvas.width=sheet.canvas.height=0;}
        }else res=prepared.result;
      }else{
        await loadScoreboard();
        res=await window.ScoreboardScan.scan(file,{heroes:A.heroes,known:{},squad:A.squad.players,itemTemplates:A.itemTemplates,items:A.items,patch:A.itemPatch,onProgress:(m,f)=>scanProgress("#board-progress",m,f)});
      }
      guard();
      requireScan(ticket);
      if(!res.ours?.length){
        if(handsFree){scanFeedback("Scoreboard unclear. Move closer, keep the whole scoreboard in the frame, and retake.");return;}
        scanProgress("#board-progress",(res.issues||["No scoreboard rows found."]).join(" "),1);
        const button=document.createElement("button");button.type="button";button.className="chip";button.textContent="Straighten photo and retry";button.onclick=()=>{hideScanProgress();preparePhoto(file,runBoardScan);};$("#board-progress").append(button);return;
      }
      const options={heroes:A.heroes,items:A.items,squad:A.squad.players};
      let quality;
      if(handsFree){const automatic=window.ScanQuality.automaticBoard(res,options);res=automatic.result;quality=automatic.quality;}
      else quality=window.ScanQuality.assess("scoreboard",res,options);
      const board={at:file._capturedAt,capturedAt:file._capturedAt,clock:detected?.clockRead?.seconds??(window.ScanQuality.reliability(res.readConfidence?.clock,res.clock)>=90?res.clock:photoTime.gameTime(file,S.clock.startedAt)),sessionId:S.id,sourceLayout:res.sourceLayout,ours:res.ours,theirs:res.theirs};
      lastBoardRead={board:M.clone(board),issues:res.issues||[],sessionId:S.id};
      if(quality.auto){
        board.autoApplied=true;
        for(const side of ["ours","theirs"])board[side].forEach((row,i)=>{
          row.inventoryConfirmed=quality.inventoryReady[side][i];row.inventoryComplete=row.inventoryConfirmed;
          if(!row.inventoryConfirmed)row.items=Array(6).fill(null);
        });
        const clean=cleanBoard(board),changes=boardChanges(clean);
        guard();savedScan(changes,ticket,"scoreboard");
        lastBoardRead.ticket={sessionId:S.id,roomCode:room?.code||null,version:room?.version??null,setup:JSON.stringify(S.setup),stage:S.stage,clock:JSON.stringify(S.clock),who:me};
        hideScanProgress();toast("Scoreboard updated. Unclear values stay unknown.");
      }else if(handsFree){scanFeedback("Scoreboard unclear. Move closer, hold the phone level, and take another photo.");}
      else{reviewBoard(board,[...(res.issues||[]),...quality.issues],ticket);hideScanProgress();}
    }catch(e){if(signal?.aborted)return;if(ocr&&!currentScan(ticket))throw e;if(handsFree)scanFeedback("Couldn't update from this photo. Take another photo of the current scoreboard.");else scanProgress("#board-progress","Scan needs attention: "+(e.message||e),1);}
  }
  window.__reviewLastScan=()=>{
    if(!lastBoardRead||lastBoardRead.sessionId!==S.id||Date.now()-lastBoardRead.board.at>180000)return toast("Scan a fresh scoreboard first.");
    const t={sessionId:S.id,roomCode:room?.code||null,version:room?.version??null,setup:JSON.stringify(S.setup),stage:S.stage,clock:JSON.stringify(S.clock),who:me};
    reviewBoard(M.clone(lastBoardRead.board),lastBoardRead.issues,t,true);
  };
  async function runAutoPhoto(file,forcedKind){
    const job=beginPhoto(file);if(!job)return;
    $("#scan-review").hidden=true;$("#map-review").hidden=true;
    try{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      requirePhoto(job);job.image=await decodePhoto(file,job);requirePhoto(job);
      const ocr=await window.FreeOCR.read(job.image,{signal:job.controller.signal,onProgress:(m,f)=>photoProgress(job,m,f)});
      requirePhoto(job);photoProgress(job,"Checking the photo…",.92);
      const detected=forcedKind?{kind:forcedKind}:window.PhotoRouter.classify(ocr.lines,{heroes:A.heroes,items:A.items,width:job.image.width,height:job.image.height});
      const options={handsFree:true,ocr,signal:job.controller.signal,guard:()=>requirePhoto(job)};
      if(detected.kind==="scoreboard"||detected.kind==="unknown")await runBoardScan(job.image,detected,options);
      else if(detected.kind==="loading")await runScan(job.image,options);
      else if(detected.kind==="build"||detected.kind==="shop")scanFeedback("Item shop recognized. Photograph the scoreboard to update live player stats.");
      else scanFeedback("HUD recognized. Open the scoreboard and take a photo to update player stats.");
    }catch(e){if(activePhoto===job&&!job.controller.signal.aborted)scanFeedback(currentScan(job.ticket)?(e.message||"Could not read this photo. Try a closer scoreboard photo."):"Match changed. Take a new photo for this match.");}
    finally{finishPhoto(job);}
  }

  function renderBoard() {
    const el = $("#board"); if (!el) return;
    const b = S.board;
    if (!b || !b.ours) { el.innerHTML = ""; return; }
    const st = E.boardState(b, S.setup, A.T, heroName);
    const ago = Math.max(0, Math.round((Date.now() - b.at) / 60000));
    const kda = r => r.k == null ? "—" : `${r.k}/${r.d ?? "?"}/${r.a ?? "?"}`;
    const g = x => x == null ? "—" : `${(x / 1000).toFixed(1)}k`;
    const diff = (x, unit, digits = 0) => x == null ? "" : `<span class="${x > 0 ? "good" : x < 0 ? "bad" : "muted"}">${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(digits)}${unit}</span>`;
    const side = (hero, r) => `<span class="bl-side"><b>${esc(hero ? heroName(hero) : "—")}</b> <span class="muted">L${r.lvl ?? "?"} · ${kda(r)} · ${g(r.gold)}</span></span>`;
    const rows = st.lanes.map(l => `<div class="bl-row"><div class="bl-head"><b>${esc(roleName(l.role))}</b>${l.who ? ` <span class="muted">${esc(label(l.who))}</span>` : ""}
        <span class="bl-gap">${diff(l.lvlDiff, " lv")}${l.goldDiff == null ? "" : " · " + diff(l.goldDiff / 1000, "k", 1)}</span></div>
      <div class="bl-vs">${side(l.hero, l.o)}<span class="muted">vs</span>${side(l.opp, l.e)}</div></div>`).join("");
    el.innerHTML = `<div class="tile board">
      <div class="board-head"><b>Scoreboard</b> <span class="muted">${b.clock != null ? `at ${fmt(b.clock)} · ` : ""}${ago ? `${ago} min ago` : "just now"}</span>
        <span class="board-tot">Gold ${st.goldDiff == null ? "—" : (st.goldEstimated ? "≈" : "") + diff(st.goldDiff / 1000, "k", 1)} · Kills ${st.us.kills??"—"}–${st.them.kills??"—"} · Avg level ${st.lvlDiff == null ? "—" : diff(st.lvlDiff, "", 1)}</span></div>
      <div class="bl">${rows}</div>
      <p class="note" style="margin:6px 0 0">${ago >= 3 ? "Snapshot is stale — rescan before acting. " : ""}Use Scan scoreboard to review and correct every number.</p></div>`;
  }

  // ---------- render ----------
  function heroSelect(path, current, role) {
    const list = A.heroes.filter(h => !role || (h.roles || []).includes(role) || h.slug === current);
    return `<select data-path='${JSON.stringify(path)}' aria-label="Hero"><option value="">—</option>${list.map(h => `<option value="${esc(h.slug)}" ${h.slug === current ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select>`;
  }
  function whoSelect(path, current) {
    return `<select data-path='${JSON.stringify(path)}' aria-label="Player"><option value="">Teammate</option>${A.squad.players.map(p => `<option value="${esc(p.key)}" ${p.key === current ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>`;
  }

  function renderRoom() {
    const el = $("#room"); if (!el) return;
    if (room) {
      const people = roomPeople();
      el.innerHTML = `<div class="room-live"><span class="dot"></span><div><div class="room-code">${esc(room.code)}</div>
        <div class="muted" style="font-size:12px">${people.length ? esc(people.join(", ")) + " connected" : "Room"} · ${esc(room.status)}</div></div>
        <div class="room-actions"><button class="chip cta" type="button" id="room-share">Share link</button><button class="chip ghost" type="button" id="room-retry">Retry sync</button><button class="chip ghost" type="button" id="room-leave">Leave</button></div></div>`;
      $("#room-share").onclick = async () => {
        const url = location.href;
        try { if (navigator.share) await navigator.share({ title: "Squad match " + room.code, url }); else { await navigator.clipboard.writeText(url); toast("Link copied"); } } catch {}
      };
      $("#room-retry").onclick = () => refreshRoom().then(flush);
      $("#room-leave").onclick = () => leaveRoom();
    } else {
      el.innerHTML = `<div class="room-start"><button class="chip cta" type="button" id="room-new">Share this plan</button>
        <form id="room-join" class="join"><input id="room-code" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="8" placeholder="Code" aria-label="Room code"><button class="chip ghost" type="submit">Join</button></form></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">One person sets up the match; everyone joins with the code and sees the same plan. <span id="room-status"></span></p>`;
      $("#room-new").onclick = () => joinRoom(newCode(), true);
      $("#room-join").onsubmit = e => { e.preventDefault(); joinRoom($("#room-code").value, false); };
    }
  }

  function renderSetup() {
    const o = S.setup.ours || {}, t = S.setup.theirs || {};
    const setupHTML = `<div class="setup-grid">
      <div class="sg-row sg-head"><div class="sg-h"></div><div class="sg-h">Your team</div><div class="sg-h">Enemy</div></div>
      ${ROLES.map(r => `<div class="sg-row"><div class="sg-role">${esc(roleName(r))}</div>
        <div class="sg-cell">${heroSelect(["setup", "ours", r, "hero"], (o[r] || {}).hero, r)}${whoSelect(["setup", "ours", r, "who"], (o[r] || {}).who)}</div>
        <div class="sg-cell">${heroSelect(["setup", "theirs", r, "hero"], (t[r] || {}).hero, r)}
          <label class="fed"><input type="checkbox" data-path='${JSON.stringify(["setup", "theirs", r, "fed"])}' ${(t[r] || {}).fed ? "checked" : ""}> Ahead</label></div></div>`).join("")}
    </div>
    <p class="note" style="margin:8px 0 0">Tick <b>Ahead</b> when an enemy is snowballing (several kills, items ahead of everyone). They jump to the top of the threat list and their lane is flagged, so the squad plays around them.</p>`;
    for(const container of [$("#setup"),$("#plan-setup")].filter(Boolean)){container.innerHTML=setupHTML;container.querySelectorAll("[data-path]").forEach(el => el.onchange = () => {
      const path = JSON.parse(el.dataset.path), value = el.type === "checkbox" ? el.checked : el.value;
      const setup=M.clone(S.setup); applyChanges({setup},[{path,value}]);
      const issues=M.validateSetup(setup).filter(x=>!x.startsWith("Choose a hero"));
      if(issues.length){toast(issues.join(" "));renderSetup();return;}
      commit([{path,value}, ...(S.stage === "ready" ? [{path:["stage"],value:"draft"}] : [])]);
    });}
  }

  function renderLive() {
    const present = ROLES.map(r => (S.setup.ours[r] || {}).who).filter(Boolean);
    const sec = clockSec();
    const next = nextObjective(sec);
    $("#clock").hidden=sec==null;
    $("#clock").innerHTML = sec == null
      ? ""
      : `<div class="clock-big">${fmt(sec)}</div><div class="clock-next">${next ? `${esc(next.label)} in <b>${fmt(next.t - sec)}</b>` : "Record an objective observation below"}</div>
         <div class="clock-adj"><button class="chip ghost" data-adj="-10">−10s</button><button class="chip ghost" data-adj="10">+10s</button><button class="chip ghost" id="clock-reset">Reset</button></div>`;
    const cs = $("#clock-start"); if (cs) cs.onclick = startMatch;
    $("#clock").querySelectorAll("[data-adj]").forEach(b => b.onclick = () => setPath(["clock", "startedAt"], S.clock.startedAt - (+b.dataset.adj) * 1000));
    const cr = $("#clock-reset"); if (cr) cr.onclick = () => { if(confirm("Reset the clock and objective observations?")){draftGameTime="0:00";commit([{path:["clock"],value:{}},{path:["objectives"],value:{}},{path:["stage"],value:"draft"}]);} };

    $("#tracker").innerHTML = present.length ? present.map(m => {
      const lv = S.live[m] || {};
      const step = (k, v) => `<div class="stepper"><span>${k === "deaths" ? "Deaths" : "Wards"}</span><button type="button" data-step='${JSON.stringify([m, k, -1])}' aria-label="minus">−</button><b class="${k === "deaths" && v >= A.T.maxDeaths ? "bad" : k === "deaths" && v >= A.T.maxDeaths - 1 ? "warn" : ""}">${v || 0}</b><button type="button" data-step='${JSON.stringify([m, k, 1])}' aria-label="plus">+</button></div>`;
      return `<div class="track-row ${m === me ? "mine" : ""}"><div class="name">${esc(label(m))}${m === me ? ' <span class="muted">(you)</span>' : ""}</div>
        ${step("deaths", lv.deaths)}${step("wards", lv.wards)}
        <label class="fed"><input type="checkbox" data-obj="${esc(m)}" ${lv.obj ? "checked" : ""}> Objective dmg</label></div>`;
    }).join("") : `<p class="muted" style="margin:0">Mark which lanes you three are in (Your team → player) to track deaths and wards.</p>`;
    $("#tracker").querySelectorAll("[data-step]").forEach(b => b.onclick = () => {
      const [m, k, d] = JSON.parse(b.dataset.step); commit([{path:["live",m,k],increment:d}]);
      if (navigator.vibrate) navigator.vibrate(8);
    });
    $("#tracker").querySelectorAll("[data-obj]").forEach(c => c.onchange = () => setPath(["live", c.dataset.obj, "obj"], c.checked));
  }

  function renderStrategy() {
    renderCounterBuild();
    const plan = E.matchPlan(A.ctx, S.setup, S.live, clockSec(), A.T);
    const anyHero = plan.lanes.some(l => l.hero || l.opp);
    if (!anyHero) { $("#strategy").innerHTML = `<p class="muted" style="margin:0">Scan the loading screen or pick heroes above to get the plan.</p>`; return; }
    const tag = v => v ? `<span class="vtag v-${v.toLowerCase()}">${v}</span>` : "";
    const lanes = plan.lanes.map(l => {
      const ev = [];
      if (l.ev.inSquad && l.ev.inSquad.games) ev.push(`${wl(l.ev.inSquad)} with group`);
      if (l.ev.personal && l.ev.personal.games) ev.push(`${wl(l.ev.personal)} on this hero`);
      if (l.ev.vsOpp && l.ev.vsOpp.games) ev.push(`${wl(l.ev.vsOpp)} vs ${esc(heroName(l.opp))}`);
      if (l.ev.laneVs && l.ev.laneVs.games) ev.push(`squad ${wl(l.ev.laneVs)} vs ${esc(heroName(l.opp))} here`);
      if (l.ev.matchup) ev.push(`meta matchup ${(l.ev.matchup.wr * 100).toFixed(0)}%`);
      else if (l.ev.meta && l.ev.meta.wr != null) ev.push(`hero meta ${l.ev.meta.wr.toFixed(1)}%`);
      return `<div class="lane-row"><div class="lane-role">${esc(roleName(l.role))}</div>
        <div class="lane-vs"><b>${esc(l.hero ? heroName(l.hero) : "—")}</b>${l.who ? ` <span class="muted">${esc(label(l.who))}</span>` : ""} <span class="muted">vs</span> <b>${esc(l.opp ? heroName(l.opp) : "—")}</b>${l.fed ? ' <span class="vtag v-tough">ahead</span>' : ""}
          ${ev.length ? `<div class="muted" style="font-size:12px">${ev.join(" · ")}</div>` : ""}</div>
        <div class="lane-est">${l.est != null ? `<b>${pct(l.est)}</b>${tag(l.verdict)}` : ""}</div></div>`;
    }).join("");
    const mine = Object.entries(plan.members).map(([m, x]) => {
      const brief = x.hero ? A.renderBrief(m, x.role, x.hero, x.opp, plan.squadHere) : "";
      return `<div class="planrow ${m === me ? "mine" : ""}"><h3>${esc(label(m))} · ${esc(roleName(x.role))}</h3>
        ${x.rules.map(r => `<div class="rule r-${r.level}">${esc(r.text)}</div>`).join("")}${brief}</div>`;
    });
    // put "me" first
    const order = Object.keys(plan.members).sort((a, b) => (b === me) - (a === me));
    // scoreboard calls come first: they are the freshest information
    const st = S.board && Date.now()-S.board.at < 180000 ? E.boardState(S.board, S.setup, A.T, heroName) : null;
    const boardCalls = st ? st.calls.map(c => `<div class="call c-${c.level}">${esc(c.text)}</div>`).join("") : "";
    $("#strategy").innerHTML = `${boardCalls ? `<div class="sub-h">Right now · from the scoreboard</div><div class="calls">${boardCalls}</div><div class="sub-h">Game plan · from the lineup</div>` : ""}
      <div class="calls">${plan.calls.map(c => `<div class="call">${esc(c)}</div>`).join("")}</div>
      <div class="sub-h">Lanes</div><div class="lanes">${lanes}</div>
      ${order.length ? `<div class="sub-h">Your squad</div>` : ""}${order.map(m => mine[Object.keys(plan.members).indexOf(m)]).join("")}`;
  }

  function render() { planningUI.render(); renderLifecycle(); renderSetup(); renderLive(); renderBoard(); renderStrategy(); renderObjectives(); renderPostmatch();matchFocus?.render(); }
  window.__matchRender = () => { renderStrategy(); renderPostmatch();matchFocus?.render(); };

  // ---------- toast ----------
  let toastT; function toast(msg) {
    let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast glass"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200);
  }

  async function chooseIdentity(members) {
    return new Promise(resolve => {
      const dialog=document.createElement("dialog");
      dialog.setAttribute("aria-label","Who are you?");
      dialog.innerHTML=`<h2>Who are you?</h2><p>Your game plan will open with your lane first.</p>${members.map(m=>`<button type="button" class="chip ${m===me?"cta":""}" data-person="${esc(m)}">${esc(label(m))}</button>`).join("")}<p><button type="button" data-cancel>Cancel</button></p>`;
      document.body.append(dialog);
      const done=value=>{dialog.close();dialog.remove();resolve(value);};
      dialog.querySelectorAll("[data-person]").forEach(b=>b.onclick=()=>done(b.dataset.person));
      dialog.querySelector("[data-cancel]").onclick=()=>done(null);
      dialog.oncancel=e=>{e.preventDefault();done(null);}; dialog.showModal();
    });
  }
  async function consumePlan() {
    const handoff=window.SquadHandoff, plan=handoff?.pending;
    if(!plan || pendingPlanOpen)return;
    pendingPlanOpen=true;
    try {
      window.__showTab("match");
      if((S.stage==="live" || room) && !confirm("Open this recommendation as a new local plan? Your existing shared match will be left unchanged.")){handoff.clear();return;}
      const next=M.fromPlan(plan,crypto.randomUUID());
      const who=await chooseIdentity(Object.keys(plan.roles));
      if(!who){handoff.clear();return;}
      if(room)leaveRoom(true);
      me=who;store.set("squad-me",me);$("#me").value=me;
      S=next;persist();handoff.clear();previousScan=null;renderRoom();render();
      toast("Recommended build loaded. Choose your lane, review the build and start game.");
    } catch(e){toast(e.message);handoff.clear();}
    finally{pendingPlanOpen=false;}
  }
  async function startMatch() {
    try {
      if(!Object.values(S.setup.ours).some(p=>p.who===me)) {
        const who=await chooseIdentity(Object.values(S.setup.ours).map(p=>p.who).filter(Boolean));
        if(!who)return;me=who;store.set("squad-me",me);$("#me").value=me;
      }
      if(S.stage==="live")return;
      let seconds=M.parseTime($("#game-time")?.value||"0:00");if(seconds==null)throw new Error("Enter the current game time as m:ss.");
      const observed=M.observedGameTime(S.board,S.id,Date.now());if(draftGameTime===null&&observed!=null)seconds=observed;
      const next=M.start(S,me,Date.now()-seconds*1000);
      commit([{path:["stage"],value:next.stage},{path:["clock"],value:next.clock}]);
      if(wake.supported && store.get("squad-wake",null)!==false)wake.enable();
    }catch(e){toast(e.message);}
  }
  function renderLifecycle() {
    const issues=M.validateSetup(S.setup),el=$("#lifecycle"),pregame=S.stage!=="live"&&S.stage!=="finished";
    if(draftGameSession!==S.id){draftGameSession=S.id;draftGameTime=null;}
    if(lastLifecycleStage!==S.stage){const details=$("#match-lineup-details");if(details)details.open=false;lastLifecycleStage=S.stage;}
    const ownRole=ROLES.find(r=>S.setup.ours[r]?.who===me),own=ownRole?S.setup.ours[ownRole]:null;
    const base=own?window.BuildPlans.getBaseline(planningUI.context(me)):null,plan=base?.status==="ready"?base.plan:null;
    const sampledClock=M.observedGameTime(S.board,S.id,Date.now())??0,time=draftGameTime??fmt(sampledClock);
    const laneButtons=pregame?'<div class="quick-lanes" role="group" aria-label="Your lane">'+ROLES.map(r=>'<button type="button" data-quick-lane="'+r+'" aria-pressed="'+(ownRole===r)+'">'+esc(roleName(r))+'</button>').join('')+'</div>':'';
    const hero=pregame&&own?'<label class="quick-hero">Your hero<select id="quick-hero" aria-label="Your hero"><option value="">Choose hero</option>'+A.heroes.map(h=>'<option value="'+esc(h.slug)+'" '+(own.hero===h.slug?'selected':'')+'>'+esc(h.name)+'</option>').join('')+'</select></label>':'';
    const items=pregame&&plan?'<ol class="quick-build-items">'+plan.items.map(n=>'<li>'+planningUI.icon(A.items.find(i=>i.name===n),32)+'<span>'+esc(planningUI.itemName(n))+'</span></li>').join('')+'</ol>':'';
    const intake=S.stage==="finished"?'':'<div class="intake-switch" role="group" aria-label="Build input"><button type="button" data-intake="scan" aria-pressed="'+(intakeMode==="scan")+'">Scan scoreboard &amp; builds</button><button type="button" data-intake="manual" aria-pressed="'+(intakeMode==="manual")+'">Build manually</button></div><div class="intake-panel">'+(intakeMode==="scan"?'<p class="note">Scan the scoreboard and equipment, then review the suggested response.</p><button class="chip ghost" type="button" id="prep-board">Scan scoreboard &amp; builds</button>':'<p class="note">Choose and review your six intended items. These stay separate from owned equipment.</p><button class="chip ghost" type="button" id="prep-manual">Choose build items</button>')+'</div>';
    el.innerHTML='<b>'+(pregame?'Recommended build':S.stage==="live"?'Match in progress':'Match finished')+'</b>'+(pregame?'<p class="note">Choose your lane, review your build and start tracking the game.</p>':'')+laneButtons+hero+items+intake+(issues.length?'<p class="warn">'+issues.map(esc).join(' ')+'</p>':'')+(pregame?'<label class="quick-game-time">Game time now<input id="game-time" aria-label="Game time now" inputmode="numeric" value="'+esc(time)+'" placeholder="0:00"></label><p class="note">Enter the time already showing in game. A reviewed screenshot clock is used automatically.</p>':'')+'<div class="lifecycle-actions">'+(pregame?'<button type="button" class="chip cta" id="clock-start">Start game</button>':'')+(S.stage==="live"?'<button type="button" class="chip" id="match-finish">Finish match</button>':'')+(previousScan?'<button type="button" class="chip ghost" id="undo-scan">Undo last scan</button>':'')+'</div>';
    el.querySelectorAll('[data-intake]').forEach(b=>b.onclick=()=>{intakeMode=b.dataset.intake;renderLifecycle();});
    el.querySelectorAll('[data-quick-lane]').forEach(b=>b.onclick=async()=>{try{
      if(!me){const who=await chooseIdentity(A.squad.players.map(p=>p.key));if(!who)return;me=who;store.set("squad-me",me);$("#me").value=me;}
      const setup=M.chooseLane(S.setup,me,b.dataset.quickLane);commit([{path:["setup"],value:setup},{path:["stage"],value:"draft"}],true);
    }catch(e){toast(e.message);}});
    const hs=$("#quick-hero");if(hs)hs.onchange=()=>{const setup=M.clone(S.setup);setup.ours[ownRole].hero=hs.value;const bad=M.validateSetup(setup).filter(s=>!s.startsWith("Choose a hero"));if(bad.length){toast(bad.join(" "));renderLifecycle();return;}commit([{path:["setup"],value:setup},{path:["stage"],value:"draft"}],true);};
    const timeInput=$("#game-time");if(timeInput)timeInput.oninput=()=>draftGameTime=timeInput.value;
    const scan=$("#prep-board");if(scan)scan.onclick=()=>$("#auto-photo-file").click();
    const manual=$("#prep-manual");if(manual)manual.onclick=()=>planningUI.open(me);
    const start=$("#clock-start");if(start)start.onclick=startMatch;
    const undo=$("#undo-scan");if(undo)undo.onclick=()=>{const old=previousScan;if(Object.entries(old.after).some(([k,value])=>JSON.stringify(S[k])!==JSON.stringify(value)))return toast("Match changed since this scan. Correct the current values instead of undoing newer edits.");previousScan=null;commit(Object.entries(old.before).map(([k,value])=>({path:[k],value})),true);};
    const finish=$("#match-finish");if(finish)finish.onclick=()=>commit([{path:["stage"],value:"finished"},{path:["finishedAt"],value:Date.now()}]);
  }
  const OBJECTIVES=[{key:"fangtooth",label:"Fangtooth"},{key:"orb",label:"Orb Prime"},{key:"shaper",label:"Shaper"}];
  function nextObjective(now) {
    if(now==null)return null;
    return OBJECTIVES.map(o=>({label:o.label,t:S.objectives[o.key]?.respawnAt})).filter(o=>Number.isFinite(o.t)&&o.t>now).sort((a,b)=>a.t-b.t)[0]||null;
  }
  function recordObjective(key,kind,remaining,source="manual",at=clockSec()) {
    try {
      const event=M.objectiveEvent(kind,at,remaining,source,me);
      event.previous=S.objectives[key]?{...S.objectives[key],previous:undefined}:null;
      setPath(["objectives",key],event);
    }catch(e){toast(e.message);}
  }
  function renderObjectives() {
    const el=$("#objectives"), now=clockSec();
    if(el.contains(document.activeElement))return;
    el.innerHTML=`<p class="note">Record a visible countdown or a confirmed observation. Respawn periods vary by patch; no timer is guessed from a missing icon.</p>`+OBJECTIVES.map(o=>{
      const event=S.objectives[o.key], st=M.objectiveStatus(event,now);
      return `<div class="objective-row"><b>${o.label}</b> · ${esc(st.text)} ${st.remaining==null?"":`<strong>${fmt(st.remaining)}</strong>`}
        <div class="note">${event?`${esc(event.source)} · observed ${fmt(event.at)} by ${esc(label(event.who||"guest"))}`:"No confirmed observation"}</div>
        <button type="button" class="chip" data-available="${o.key}">Available</button>
        <button type="button" class="chip" data-taken="${o.key}">Taken now</button>
        <input aria-label="${o.label} countdown" data-time="${o.key}" placeholder="m:ss" inputmode="numeric">
        <button type="button" class="chip" data-countdown="${o.key}">Set countdown</button>
        ${event?`<button type="button" class="chip ghost" data-undo-objective="${o.key}">Undo</button>`:""}</div>`;
    }).join("");
    el.querySelectorAll("[data-available]").forEach(b=>b.onclick=()=>recordObjective(b.dataset.available,"available",null));
    el.querySelectorAll("[data-taken]").forEach(b=>b.onclick=()=>recordObjective(b.dataset.taken,"defeated",null));
    el.querySelectorAll("[data-countdown]").forEach(b=>b.onclick=()=>{const key=b.dataset.countdown,sec=M.parseTime(el.querySelector(`[data-time="${key}"]`).value);if(sec==null)return toast("Enter a countdown as m:ss.");recordObjective(key,"countdown",sec);});
    el.querySelectorAll("[data-undo-objective]").forEach(b=>b.onclick=()=>setPath(["objectives",b.dataset.undoObjective],S.objectives[b.dataset.undoObjective]?.previous||null));
  }
  async function preparePhoto(file,reader) {
    if(scanBusy)return toast("Wait for the current scan to finish.");
    scanTicket(file);
    try {
      const img=await createImageBitmap(file),dialog=document.createElement("dialog");
      dialog.setAttribute("aria-label","Prepare screen photo");
      dialog.innerHTML='<h3>Straighten the screen</h3><p>For an angled photo, tap the four screen corners inside the bezel: top left, top right, bottom right, bottom left.</p><canvas id="photo-corners" style="width:100%;height:auto;touch-action:none"></canvas><p id="photo-instruction" role="status">Tap top left.</p><button class="chip" id="photo-reset">Reset corners</button><button class="chip cta" id="photo-correct">Straighten and scan</button><button class="chip" id="photo-original">Scan original</button><button class="chip" id="photo-cancel">Cancel</button>';
      document.body.append(dialog);dialog.showModal();const c=dialog.querySelector("canvas");c.width=img.width;c.height=img.height;const g=c.getContext("2d");let points=[];
      const draw=()=>{g.drawImage(img,0,0);g.fillStyle="#ffdf52";g.strokeStyle="#ffdf52";g.lineWidth=Math.max(3,c.width/300);g.beginPath();points.forEach((p,i)=>{const x=p.x*c.width,y=p.y*c.height;i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();points.forEach(p=>{g.beginPath();g.arc(p.x*c.width,p.y*c.height,c.width/100,0,Math.PI*2);g.fill();});};draw();
      c.onpointerdown=e=>{if(points.length===4)return;const b=c.getBoundingClientRect();points.push({x:(e.clientX-b.left)/b.width,y:(e.clientY-b.top)/b.height});draw();$("#photo-instruction").textContent=["Tap top left.","Tap top right.","Tap bottom right.","Tap bottom left.","Four corners selected. Straighten and scan."][points.length];};
      const close=()=>{img.close();dialog.close();dialog.remove();};
      $("#photo-reset").onclick=()=>{points=[];draw();$("#photo-instruction").textContent="Tap top left.";};
      $("#photo-cancel").onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
      $("#photo-original").onclick=()=>{close();exclusiveScan(()=>reader(file));};
      $("#photo-correct").onclick=()=>{try{const corrected=window.PhotoPrep.rectify(img,points);photoTime.copy(file,corrected);corrected._originalSource=file;close();exclusiveScan(()=>reader(corrected));}catch(e){toast(e.message);}};
    }catch(e){toast("Couldn't open photo: "+e.message);}
  }
  async function exclusiveScan(fn) {
    if(scanBusy)return toast("Wait for the current scan to finish.");
    scanBusy=true;try{return await fn();}catch(e){toast(e.message);}finally{scanBusy=false;}
  }

  function reviewPager(el){
    const pages=[...el.querySelectorAll(".review-player")];let index=Math.max(0,pages.findIndex(p=>p.dataset.side==="ours"&&S.setup.ours[ROLES[+p.dataset.row]]?.who===me));
    const nav=document.createElement("div");nav.className="review-nav";
    nav.innerHTML='<button class="chip" data-prev aria-label="Previous player">‹</button><select id="review-player" aria-label="Player to review">'+pages.map((p,i)=>'<option value="'+i+'">'+esc(p.dataset.title)+'</option>').join("")+'</select><button class="chip" data-next aria-label="Next player">›</button>';
    el.querySelector(".review-players").before(nav);
    const show=()=>{pages.forEach((p,i)=>p.hidden=i!==index);nav.querySelector("select").value=String(index);nav.querySelector("[data-prev]").disabled=index===0;nav.querySelector("[data-next]").disabled=index===pages.length-1;};
    nav.querySelector("select").onchange=e=>{index=+e.target.value;show();};nav.querySelector("[data-prev]").onclick=()=>{index=Math.max(0,index-1);show();};nav.querySelector("[data-next]").onclick=()=>{index=Math.min(pages.length-1,index+1);show();};show();
  }
  function reviewSetup(setup,issues,ticket){
    const el=$("#scan-review");el.hidden=false;
    el.innerHTML='<h3>Review lineup</h3><p class="note">'+esc((issues||[]).join(" "))+'</p><div class="review-players">'+ROLES.map((role,i)=>'<article class="review-player" data-side="ours" data-row="'+i+'" data-title="'+esc(roleName(role))+'"><b>'+esc(roleName(role))+'</b>'+["ours","theirs"].map(side=>'<label>'+(side==="ours"?"Your team":"Enemy")+'<select data-side="'+side+'" data-role="'+role+'"><option value="">Unknown</option>'+A.heroes.map(h=>'<option value="'+esc(h.slug)+'" '+(setup[side][role]?.hero===h.slug?"selected":"")+'>'+esc(h.name)+'</option>').join("")+'</select></label>').join("")+'</article>').join("")+'</div><div class="review-footer"><button class="chip cta" id="scan-apply">Apply lineup</button><button class="chip" id="scan-cancel">Cancel</button></div>';
    reviewPager(el);$("#scan-cancel").onclick=()=>el.hidden=true;
    $("#scan-apply").onclick=()=>{try{
      requireScan(ticket);
      el.querySelectorAll("select[data-side]").forEach(x=>setup[x.dataset.side][x.dataset.role]={...setup[x.dataset.side][x.dataset.role],hero:x.value});
      const errors=M.validateSetup(setup);if(errors.length)throw new Error(errors.join(" "));
      previousScan={before:{setup:M.clone(S.setup)},after:{setup:M.clone(setup)}};
      guard();savedScan([{path:["setup"],value:setup}],ticket,"loading");el.hidden=true;
    }catch(e){toast(e.message);}};
  }
  function reviewBoard(board,issues,ticket,equipment=false){
    const el=$("#scan-review");el.hidden=false;
    const catalog=new Map(A.items.map(it=>[it.name,it])),itemByInput=v=>A.items.find(it=>[it.name,it.label].some(n=>n?.toLowerCase()===v.trim().toLowerCase()));
    const options=A.items.filter(it=>!["TRINKET","CREST"].includes(it.slot)),fields=board.sourceLayout==="live"?["lvl","k","d","a","cs"]:["lvl","k","d","a","gold"];
    el.innerHTML='<h3>Review photo</h3><p class="note">'+esc((issues||[]).slice(0,2).join(" "))+' '+(board.sourceLayout==="live"?"Yellow number = farm / CS.":"Gold = total earned, not spendable.")+'</p><label class="review-photo-time">Game time in photo<input id="board-clock" placeholder="m:ss" inputmode="numeric" value="'+(board.clock==null?"":fmt(board.clock))+'"></label><p class="note">Upload time assumes the photo was taken 10 seconds before selection. Change its game time if older.</p><input type="checkbox" id="board-now" checked hidden><datalist id="inventory-catalog">'+options.map(it=>'<option value="'+esc(it.label)+'">'+esc(it.name)+'</option>').join("")+'</datalist><div class="review-players">'+
    ["ours","theirs"].flatMap(side=>board[side].map((row,i)=>{
      const title=(side==="ours"?"Your team":"Enemy")+" · "+roleName(ROLES[i]);
      return '<article class="review-player" data-side="'+side+'" data-row="'+i+'" data-title="'+esc(title)+'"><h4>'+esc(title)+'</h4><div class="review-identities"><label>Hero<select data-side="'+side+'" data-row="'+i+'" data-field="hero"><option value="">Unknown</option>'+A.heroes.map(h=>'<option value="'+esc(h.slug)+'" '+(row.hero===h.slug?"selected":"")+'>'+esc(h.name)+'</option>').join("")+'</select></label>'+
      (side==="ours"?'<label>Player<select data-player-row="'+i+'" aria-label="Player in '+esc(roleName(ROLES[i]))+'"><option value="">Other teammate</option>'+A.squad.players.map(p=>'<option value="'+esc(p.key)+'" '+((row.who||(S.setup.ours[ROLES[i]]?.hero===row.hero?S.setup.ours[ROLES[i]]?.who:""))===p.key?"selected":"")+'>'+esc(p.label)+'</option>').join("")+'</select></label>':"")+'</div><div class="review-stats">'+fields.map(k=>'<label>'+({lvl:"Level",k:"Kills",d:"Deaths",a:"Assists",gold:"Total gold",cs:"CS"})[k]+'<input class="'+(row.alternatives?.[k]||window.ScanQuality.reliability(row.readConfidence?.[k],row[k])<90?"uncertain":"")+'" title="Verify against the photo" type="number" min="0" aria-label="'+side+' '+ROLES[i]+' '+k+'" data-side="'+side+'" data-row="'+i+'" data-field="'+k+'" value="'+(row[k]??"")+'"></label>').join("")+'</div>'+
      '<details class="inventory-review" data-inventory="'+side+'-'+i+'" '+(equipment?"open":"")+'><summary>Review equipment</summary><div class="inventory-slots">'+Array.from({length:6},(_,j)=>'<label>Slot '+(j+1)+(row.itemPreviews?.[j]?'<img class="item-crop" alt="Item slot '+(j+1)+' from photo" src="'+esc(row.itemPreviews[j])+'">':"")+'<input list="inventory-catalog" data-item-side="'+side+'" data-item-row="'+i+'" data-item-slot="'+j+'" aria-label="'+side+' '+ROLES[i]+' item '+(j+1)+'" placeholder="Unknown / empty" value="'+esc(catalog.get(row.items?.[j])?.label||"")+'"></label>').join("")+'</div>'+
      '<label><input type="checkbox" data-confirm-side="'+side+'" data-confirm-row="'+i+'" '+(row.inventoryConfirmed?"checked":"")+'> I checked these item names</label><label><input type="checkbox" data-complete-side="'+side+'" data-complete-row="'+i+'" '+(row.inventoryComplete?"checked":"")+'> All six slots visible; blanks are empty</label>'+
      (side==="ours"?'<label>Spendable gold (optional, HUD)<input type="number" min="0" max="99999" data-current-gold="'+i+'" value="'+(row.currentGold??"")+'" placeholder="Unknown"></label>':"")+'</details></article>';
    })).join("")+'</div><div class="review-footer"><button class="chip cta" id="scan-apply">Update strategy</button><button class="chip" id="scan-cancel">Cancel</button></div>';
    reviewPager(el);$("#scan-cancel").onclick=()=>el.hidden=true;
    $("#scan-apply").onclick=()=>{try{
      requireScan(ticket);
      const text=$("#board-clock").value.trim(),pictureClock=M.parseTime(text);
      if(text&&pictureClock==null)throw new Error("Enter the photo's game time as m:ss.");
      if(pictureClock!=null&&S.clock.startedAt){
        if(pictureClock>clockSec()+10)throw new Error("Photo time is ahead of the app clock. Adjust the match clock first.");
        if(pictureClock!==board.clock)board.at=S.clock.startedAt+pictureClock*1000;board.clock=pictureClock;
      }else if(pictureClock!=null)board.clock=pictureClock;
      el.querySelectorAll("[data-field]").forEach(x=>board[x.dataset.side][+x.dataset.row][x.dataset.field]=x.dataset.field==="hero"?(x.value||null):(x.value===""?null:Number(x.value)));
      for(const side of ["ours","theirs"])for(let i=0;i<5;i++){
        const row=board[side][i];row.items=[];
        for(const input of el.querySelectorAll('[data-item-side="'+side+'"][data-item-row="'+i+'"]')){
          const it=input.value.trim()?itemByInput(input.value):null;
          if(input.value.trim()&&!it)throw new Error("Choose an item from the catalogue.");
          if(it&&["CREST","TRINKET"].includes(it.slot))throw new Error("Use equipment items; crests and trinkets have separate slots.");
          row.items.push(it?.name||null);
        }
        row.inventoryConfirmed=el.querySelector('[data-confirm-side="'+side+'"][data-confirm-row="'+i+'"]').checked;
        row.inventoryComplete=row.inventoryConfirmed&&el.querySelector('[data-complete-side="'+side+'"][data-complete-row="'+i+'"]').checked;
        if(side==="ours"){const v=el.querySelector('[data-current-gold="'+i+'"]').value;row.currentGold=v===""?null:Number(v);}
      }
      const clean=cleanBoard(board),whoRows=[...el.querySelectorAll("[data-player-row]")].map(x=>x.value);
      savedScan(boardChanges(clean,whoRows),ticket,"scoreboard");el.hidden=true;
      toast(room?"Snapshot saved locally; syncing strategy…":"Strategy updated.");
    }catch(e){toast(e.message);}};
  }

  function renderCounterBuild() {
    optimizerUI.render();
    const el=$('#counterbuild');if(!el)return;
    const board=S.board?.sessionId===S.id?S.board:null;
    const plan=window.CounterBuild.plan({items:A.items,heroes:A.heroes,matches:A.ctx.matches,setup:S.setup,board,patchReview:A.patchReview,buildPlans:S.buildPlans,pivotIntents:S.pivotIntents,patch:A.itemPatch,sessionId:S.id});
    planningUI.renderTeam();
    const key=JSON.stringify([board,S.setup,S.buildPlans,S.pivotIntents,me,A.patchReview,plan.status,A.ctx.matches.length]);
    const age=board?Math.max(0,Math.floor((Date.now()-board.at)/1000)):null;
    const ageText=age==null?'Review a scoreboard and the current inventories to adapt your next purchase.':`Snapshot ${Math.floor(age/60)}:${String(age%60).padStart(2,'0')} ago · ${plan.status==='stale'?'Rescan needed':'Reviewed observations'}`;
    if(el._counterKey===key){const status=el.querySelector('#counter-age');if(status&&status.textContent!==ageText)status.textContent=ageText;return;}
    el._counterKey=key;
    const opened=new Set([...el.querySelectorAll('details[open][data-section]')].map(d=>d.dataset.section)),choices=new Map();
    const rolePurpose={CARRY:'protect your damage uptime while you fight from range',SUPPORT:'stay alive while protecting your teammates',JUNGLE:'stay healthy enough to contest objectives',OFFLANE:'stay in the frontline when you rotate',MIDLANE:'keep casting instead of being forced out of the fight'};
    const answerText={magical:'Add magical armor to reduce the spell pressure you take',physical:'Add physical armor against their physical damage',healing:'Coordinate anti-heal to answer their sustain',shielding:'Coordinate anti-shield coverage',physicalArmor:'Add penetration or shred for your physical damage',magicalArmor:'Add penetration or shred for your magical damage',health:'Consider damage that answers high-health builds',crit:'Consider defense against critical damage',burst:'Consider a defensive response to their burst'};
    const threatPattern={magical:'magical-power pressure',physical:'physical-power pressure',healing:'healing or lifesteal',shielding:'shielding',physicalArmor:'stacked physical armor',magicalArmor:'stacked magical armor',health:'high health',crit:'critical-strike damage',burst:'burst-oriented effects'};
    function needView(p,need,index){const featured=plan.threats.find(t=>need.targets.includes(t.hero)),ownRow=board?.ours?.[ROLES.indexOf(p.role)],enemyRow=board?.theirs?.find(r=>r.hero===featured?.hero),gap=Number.isFinite(ownRow?.lvl)&&Number.isFinite(enemyRow?.lvl)?enemyRow.lvl-ownRow.lvl:null;
      const lead=featured?`${heroName(featured.hero)}${gap>0?` is ${gap} level${gap===1?'':'s'} ahead of ${heroName(p.hero)}`:' has a relevant confirmed item build'}. `:'';
      const intro=lead+`Their observed items suggest ${threatPattern[need.key]||'a relevant item pattern'}. That can affect rotations and objective fights across the lobby. ${answerText[need.key]||'Adapt to the observed build'} so you can ${rolePurpose[p.role]||'carry out your role'}.`;
      const base=window.BuildPlans.getBaseline(planningUI.context(p.who)),reviewed=base.status==='ready'?base.plan:null;
      const body=`<div class="need-context"><h4>${esc(featured?heroName(featured.hero)+' matters beyond your lane':'Adapt to the confirmed lobby')}</h4><p>${esc(intro)}</p><p class="note">Estimated pressure from reviewed items and levels, not measured incoming damage.</p>${reviewed?`<p class="baseline-summary">Your plan: <b>${esc(planningUI.itemName(reviewed.nextItem))}</b> next</p>`:''}<button class="text-button" type="button" data-review-build="${esc(p.who)}">${reviewed?'Review starting build':'Add your starting build'} →</button></div><div class="need-heading"><h4>${need.alternatives.length} ranked option${need.alternatives.length===1?'':'s'} · ${esc(need.answer)}</h4><p class="note">Choose one direction for your next item slot. Rankings use catalogue signals and fit; check passive details in the shop.</p></div><ol class="counter-purchases">${need.alternatives.map((rec,i)=>{const choiceKey=p.who+'-'+index+'-'+i;choices.set(choiceKey,{who:p.who,rec});const action=rec.action==='consider-swap'?'Full inventory · evaluate a later swap':rec.action==='verify-inventory'?'Verify unread slots before buying':rec.affordable===true?'Affordable with confirmed current gold':rec.affordable===false?'Save toward this item':'Check shop cost and current budget';return `<li><div class="counter-item-head"><span class="counter-rank">${i+1}</span>${planningUI.icon(rec.item,52)}<div><h4>${esc(rec.item.label)}</h4><span>${num(rec.fullCost)}g full cost</span></div></div><p class="option-benefit">${esc(rec.fitExplanation)}</p>${reviewed?`<p class="pivot-comparison">${esc(rec.baselineComparison.description)}</p>`:''}<details data-section="item-${esc(choiceKey)}"><summary>Components, tradeoff &amp; evidence</summary><p>${esc(rec.tradeoff)}</p>${rec.recipe.length?`<div class="recipe-list">${rec.recipe.map(it=>`<span>${planningUI.icon(A.items.find(i=>i.name===it.name),24)}${esc(it.label)}${it.owned?' · owned':''}</span>`).join('')}</div>`:''}<p>${rec.reasons.map(esc).join(' ')}</p><p class="note">${esc(action)}. Component upgrade costs are checked in the shop.</p></details><button class="pivot-choice ${rec.selectedIntent?'selected':''}" type="button" data-choose-pivot="${esc(choiceKey)}" aria-pressed="${!!rec.selectedIntent}">${rec.selectedIntent?'✓ Planned pivot · purchase unconfirmed':p.who===me?'I plan to pivot to this':'Plan this for '+esc(label(p.who))}</button><p class="note">Answers ${rec.targets.map(heroName).map(esc).join(', ')} · ${rec.confidence==='observed'?'Confirmed inventory evidence':'Incomplete inventory evidence'}</p></li>`;}).join('')}</ol>`;
      return index===0?body:`<details class="additional-need" data-section="need-${esc(p.who)}-${esc(need.key)}"><summary>Also consider · ${esc(need.answer)}</summary>${body}</details>`;
    }
    const players=plan.players.slice().sort((a,b)=>(b.who===me)-(a.who===me)).map(p=>{const body=`<article class="counter-player ${p.who===me?'mine':''}"><div class="counter-player-title"><div><p class="eyebrow">${esc(label(p.who))}</p><h3>${esc(heroName(p.hero))} · ${esc(roleName(p.role))}</h3></div></div>${p.needs.map((n,i)=>needView(p,n,i)).join('')}${p.guidance.map(g=>`<p class="guidance">${esc(g)}</p>`).join('')}${p.ownedAnswers.length?`<details data-section="owned-${esc(p.who)}"><summary>Current team coverage</summary><p>${p.ownedAnswers.map(esc).join(' · ')}</p></details>`:''}</article>`;return p.who===me?body:`<details data-section="player-${esc(p.who)}"><summary>${esc(label(p.who))} · squad build response</summary>${body}</details>`;}).join('');
    const pr=A.patchReview,patchLabel={reviewed:'Reviewed','initial-baseline':'Initial baseline · review pending','review-required':'Review needed','source-incomplete':'Refresh incomplete'},changed=[...(pr?.changes?.items||[]),...(pr?.changes?.heroes||[])];
    el.innerHTML=`<div class="counter-toolbar"><div><p class="eyebrow">Whole lobby · personal response</p><p id="counter-age" class="note" role="status">${esc(ageText)}</p></div><button class="chip cta" id="counterbuild-scan" type="button">Scan scoreboard / builds</button></div><div class="counter-player-grid">${players||'<p class="empty-advice">Choose your heroes and player assignments in Plan, then confirm a scoreboard for item advice.</p>'}</div>${plan.threats.length?`<details data-section="threats"><summary>Why these responses · lobby threats</summary><ol class="lobby-threats">${plan.threats.map(t=>`<li><b>${esc(heroName(t.hero))}</b> · ${esc(roleName(t.role))}<p>${t.reasons.map(esc).join(' · ')||'Review the current item build.'}</p><div class="threat-items">${t.items.map(n=>`<span>${planningUI.icon(A.items.find(it=>it.name===n),28)}${esc(planningUI.itemName(n))}</span>`).join('')||'Inventory unconfirmed'}</div></li>`).join('')}</ol></details>`:''}<details class="patch-review" data-section="patch"><summary>Patch data · ${esc(patchLabel[pr?.status]||'Unavailable')}</summary><p>${changed.length} catalogue entries changed.</p>${/^https:\/\/(www\.)?predecessorgame\.com\//.test(pr?.officialNotesUrl||'')?`<a href="${esc(pr.officialNotesUrl)}" target="_blank" rel="noopener">Official patch notes</a>`:''}<p class="note">New mechanics require a rule review. The app does not automatically interpret patch-note prose.</p></details>${plan.warnings.length?`<details data-section="coverage" ${['stale','patch-review-required'].includes(plan.status)?'open':''}><summary>Advice coverage · ${plan.status==='patch-review-required'?'patch review needed':plan.status==='stale'?'rescan needed':'check evidence'}</summary>${plan.warnings.map(w=>`<p class="note">${esc(w)}</p>`).join('')}</details>`:''}`;
    el.querySelectorAll('details[data-section]').forEach(d=>{if(opened.has(d.dataset.section))d.open=true;});
    el.querySelector('#counterbuild-scan').onclick=()=>$('#auto-photo-file').click();
    el.querySelectorAll('[data-review-build]').forEach(b=>b.onclick=()=>planningUI.open(b.dataset.reviewBuild));
    el.querySelectorAll('[data-choose-pivot]').forEach(b=>b.onclick=()=>{const choice=choices.get(b.dataset.choosePivot);if(choice)planningUI.select(choice.who,choice.rec);});
  }

  async function openMap(file){
    if(clockSec()==null)return toast("Start the match clock before scanning a countdown.");
    const ticket=scanTicket(file),observedAt=photoTime.gameTime(file,S.clock.startedAt),el=$("#map-review");el.hidden=false;
    el.innerHTML='<h3>Read one objective timer</h3><p class="note">Drag a tight box around one countdown. Choose the objective it belongs to.</p><canvas id="map-canvas"></canvas><label>Objective<select id="map-objective"><option value="">Choose objective</option>'+OBJECTIVES.map(o=>'<option value="'+o.key+'">'+o.label+'</option>').join("")+'</select></label><button class="chip" id="map-read">Read timer</button><label>Game time in photo<input id="map-observed" placeholder="m:ss" value="'+fmt(observedAt)+'"></label><label>Countdown<input id="map-time" placeholder="m:ss"></label><p id="map-message" role="status"></p><div class="review-footer"><button class="chip cta" id="map-apply">Apply timer</button><button class="chip" id="map-cancel">Cancel</button></div>';
    const image=await createImageBitmap(file);if(!el.isConnected||!currentScan(ticket)){image.close();el.hidden=true;return;}
    const canvas=$("#map-canvas");canvas.width=image.width;canvas.height=image.height;const g=canvas.getContext("2d");
    let start=null,crop=null,revision=0,closed=false,prior=null,objective="";
    const close=()=>{if(closed)return;closed=true;revision++;image.close();el.hidden=true;};
    const draw=()=>{g.drawImage(image,0,0);if(crop){g.strokeStyle="#ffdc5e";g.lineWidth=Math.max(3,canvas.width/300);g.strokeRect(crop.x*canvas.width,crop.y*canvas.height,crop.w*canvas.width,crop.h*canvas.height);}};draw();
    const point=e=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
    canvas.onpointerdown=e=>{start=point(e);revision++;$("#map-time").value="";canvas.setPointerCapture(e.pointerId);};
    canvas.onpointermove=e=>{if(!start)return;const end=point(e);crop={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x),h:Math.abs(start.y-end.y)};draw();};
    canvas.onpointerup=canvas.onpointercancel=()=>start=null;
    $("#map-objective").onchange=e=>{revision++;objective=e.target.value;prior=JSON.stringify(S.objectives[objective]??null);$("#map-time").value="";};
    const apply=()=>{
      requireScan(ticket);if(!objective)throw new Error("Choose the objective shown in this crop.");
      if(JSON.stringify(S.objectives[objective]??null)!==prior)throw new Error("This objective changed. Review the latest timer first.");
      const seconds=M.parseTime($("#map-time").value),observation=M.parseTime($("#map-observed").value);
      if(seconds==null||seconds>1200)throw new Error("Enter a countdown from 0:00 to 20:00.");
      if(observation==null||observation>clockSec()+10)throw new Error("Check the game time shown in the photo.");
      const event=M.objectiveEvent("countdown",observation,seconds,"minimap photo",me);event.previous=S.objectives[objective]??null;
      savedScan([{path:["objectives",objective],value:event}],ticket,"minimap");close();toast("Objective timer updated.");
    };
    $("#map-read").onclick=()=>exclusiveScan(async()=>{
      if(!crop?.w||!crop?.h)return toast("Drag a box around one countdown first.");
      if(!objective)return toast("Choose its objective first.");
      requireScan(ticket);const token=revision,selected=objective;
      $("#map-message").textContent="Reading timer on this device…";
      const hits=await window.MinimapScan.scan(file,{...crop});
      if(closed||token!==revision||selected!==objective||!currentScan(ticket))return;
      $("#map-time").value=hits.length===1&&!hits[0].estimated?hits[0].text:"";
      if(hits.autoRead){$("#map-time").value=hits.autoRead.text;try{apply();}catch(e){toast(e.message);}return;}
      $("#map-message").textContent=hits.length===1&&hits[0].estimated?"This is an approximate "+hits[0].text+" timer. Wait for an exact countdown.":hits.length===1?"Check "+hits[0].text+" against the photo and apply.":hits.length?"Multiple timers found. Tighten the crop.":"No clear timer found. Enter a verified countdown.";
    });
    $("#map-cancel").onclick=close;$("#map-apply").onclick=()=>{try{apply();}catch(e){toast(e.message);}};
  }

  function renderPostmatch() {
    const el=$("#postmatch");el.hidden=S.stage!=="finished";if(el.hidden)return;
    const selected=Object.values(S.setup.ours).map(p=>p.who).filter(Boolean);
    const candidates=A.allMatches.filter(m=>selected.every(who=>m.players.some(p=>p.squad===who))&&(!S.clock.startedAt||Math.abs(new Date(m.start)-S.clock.startedAt)<7200000)).slice(0,10);
    el.innerHTML='<h3>Post-match review</h3><p class="note">Choose the completed match after the next data refresh. Check the time and heroes before linking.</p><select id="review-match"><option value="">Select completed match</option>'+candidates.map(m=>`<option value="${esc(m.id)}" ${S.reviewMatch===m.id?"selected":""}>${esc(new Date(m.start).toLocaleString())} · ${esc(m.mode)} · ${m.players.filter(p=>selected.includes(p.squad)).map(p=>esc(heroName(p.hero))).join(", ")}</option>`).join("")+'</select><div id="review-content"></div>';
    $("#review-match").onchange=e=>setPath(["reviewMatch"],e.target.value);
    const match=candidates.find(m=>m.id===S.reviewMatch);if(!match)return;
    $("#review-content").innerHTML=selected.map(who=>{const x=window.SquadInsights.review(match,who,A.allMatches);return `<h3>${esc(label(who))} · ${x.win?"Win":"Loss"}</h3><p>${esc(x.focus)}</p><p class="note">${x.games} comparable games · Deaths ${x.deaths} · Wards ${x.wards} · Objective damage ${x.objectives||0} · Tower damage ${x.towers||0}</p>`;}).join("");
  }

  // ---------- init ----------
  function init() {
    const meSel = $("#me");
    meSel.innerHTML = `<option value="">Who are you?</option>` + A.squad.players.map(p => `<option value="${esc(p.key)}" ${p.key === me ? "selected" : ""}>${esc(p.label)}</option>`).join("");
    meSel.onchange = () => { me = meSel.value; store.set("squad-me", me); if (room) room.channel.track({ who: me || "guest", at: Date.now() }); render(); };
    $("#quick-scan").onclick=()=>{window.__showTab("match");$("#camera-open").click();};
    $("#camera-open").onclick=()=>{
      if(scanBusy)return toast("Wait for the current scan to finish.");
      window.CameraScan.open("auto",(kind,canvas)=>{
        if(kind==="upload")return $("#auto-photo-file").click();
        scanTicket(canvas);matchFocus?.reading();runAutoPhoto(canvas,kind==="auto"?null:kind);
      },toast);
    };
    $("#wake").onchange=e=>e.target.checked?wake.enable():wake.disable();
    for(const id of ["auto-photo-file","scan-file","board-file","map-file"]){$("#"+id).onchange=e=>{const file=e.target.files?.[0];if(file){scanTicket(file);matchFocus?.reading();runAutoPhoto(file);}e.target.value="";};}
    $("#match-clear").onclick=()=>{
      if(!confirm("Clear this match for everyone in the room?"))return;
      cancelPhoto("",true);scanAnnouncements.clear();lastBoardRead=null;previousScan=null;$("#scan-review").hidden=true;$("#map-review").hidden=true;hideScanProgress();replaceState(blank());toast("Match cleared");
    };
    matchFocus=window.SquadMatchFocus.create({app:A,getState:()=>S,getMe:()=>me,planningUI,toast,onScan:()=>$("#camera-open").click()});window.__matchFocus=matchFocus;
    renderWake(); renderRoom(); render();
    const q = new URLSearchParams(location.search).get("room") || store.get("squad-room", null);
    if (q && !window.SquadHandoff?.pending) joinRoom(q, false);
    if(wake.on)wake.enable();
    clearInterval(tick); tick = setInterval(() => {
      if(document.visibilityState !== "visible") return;
      if(S.board && Math.floor(Date.now()/1000)%15===0)renderCounterBuild();
      matchFocus?.render();if(S.clock?.startedAt) { renderLive(); renderObjectives(); if(Math.floor(clockSec())%15===0){renderStrategy();renderBoard();} }
    },1000);
    document.addEventListener("visibilitychange", () => { if(document.visibilityState==="visible") { render(); refreshRoom().then(flush); } });
    document.addEventListener("squad:plan", consumePlan);
    consumePlan();
  }
  init();
})();
