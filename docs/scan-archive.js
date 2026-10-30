/* Private, durable photo outbox. No room state or reviewer credentials belong here. */
(function(root){'use strict';
function create({url,key,onStatus=()=>{},uploadDelayMs=1500}){
 const endpoint=url+'/functions/v1/scan-collector',DB='squad-scan-archive-v1',S='captures';
 let enabled=true;try{enabled=localStorage.getItem('squad-save-scans')!=='off';}catch{}
 let opening,busy=false,destroyed=false,holds=0,timer=null,lastError='',saved=0,waiting=0;
 let resumeAt=0,idle=null;
 const pending=new Map(),unsaved=new Map();
 const notify=()=>onStatus({enabled,saved,waiting:waiting+unsaved.size,error:unsaved.size?unsaved.size+' photo(s) could not be saved on this device. Keep this page open and retry.':lastError});
 function db(){return opening||=(new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(S,{keyPath:'id'});req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);}));}
 async function keys(){const d=await db();return new Promise((resolve,reject)=>{const q=d.transaction(S).objectStore(S).getAllKeys();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
 async function get(id){const d=await db();return new Promise((resolve,reject)=>{const q=d.transaction(S).objectStore(S).get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
 async function edit(id,change){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction(S,'readwrite'),s=tx.objectStore(S),q=s.get(id);let value;q.onsuccess=()=>{value=change(q.result);if(value)s.put(value);};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error||Error('Photo storage failed'));});}
 async function count(){try{const d=await db();const totals=await new Promise((resolve,reject)=>{let saved=0,waiting=0;const tx=d.transaction(S),q=tx.objectStore(S).openCursor();q.onsuccess=()=>{const c=q.result;if(!c)return;const r=c.value;if(r.uploaded)saved++;if(r.photo||r.revision>r.ackedRevision)waiting++;c.continue();};tx.oncomplete=()=>resolve({saved,waiting});tx.onerror=tx.onabort=()=>reject(tx.error||Error('Photo count failed'));});saved=totals.saved;waiting=totals.waiting;notify();}catch(e){error(e);}}
 function error(e){lastError='Photo saving needs attention: '+(e?.message||'device storage unavailable');notify();}
 function identity(){
  let i;try{i=JSON.parse(localStorage.getItem('squad-scan-device'));}catch{}
  if(!i?.id||!i?.secret){i={id:crypto.randomUUID(),secret:Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('')};localStorage.setItem('squad-scan-device',JSON.stringify(i));}
  return i;
 }
 async function request(body){
  const i=identity(),r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,apikey:key,'x-scan-device':i.id,'x-scan-key':i.secret,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const data=await r.json();if(!r.ok)throw Error(data.error||'upload failed');return data;
 }
 function schedule(delay=250){if(destroyed)return;clearTimeout(timer);if(idle!==null){root.cancelIdleCallback?.(idle);idle=null;}timer=setTimeout(()=>{timer=null;if(root.requestIdleCallback)idle=root.requestIdleCallback(()=>{idle=null;void pump();},{timeout:2000});else void pump();},Math.max(delay,resumeAt-Date.now()));}
 async function pump(){
  if(destroyed||busy||holds||!enabled||navigator.onLine===false)return;
  if(Date.now()<resumeAt){schedule();return;}
  busy=true;let retry=false;
  try{
   for(const id of await keys()){
    if(destroyed||holds||!enabled)break;
    const row=await get(id);if(destroyed||holds||!enabled)break;if(!row)continue;
    if(!row.photo&&row.revision<=row.ackedRevision)continue;
    if(row.photo){
     const form=new FormData();form.set('id',row.id);form.set('metadata',JSON.stringify(row.metadata));form.set('photo',new Blob([row.photo.bytes],{type:row.photo.type}),'capture');
     await request(form);await edit(row.id,r=>({...r,photo:null,uploaded:true}));
    }
    // Re-read: OCR or cancellation may have updated this record during upload.
    if(destroyed||holds||!enabled)break;
    const latest=await get(row.id);if(!latest)continue;
    if(destroyed||holds||!enabled)break;
    if(latest.revision>latest.ackedRevision){await request({action:'observe',id:row.id,revision:latest.revision,observations:latest.observations});await edit(row.id,r=>({...r,ackedRevision:latest.revision}));}
   }
   lastError='';
  }catch(e){error(e);retry=true;}
  finally{busy=false;await count();if(enabled&&!holds&&waiting)schedule(retry?30000:500);}
 }
 function capture(source,metadata={}){
  if(!enabled)return null;
  const id=crypto.randomUUID();
  // Start canvas encoding now: callers may release their canvas after OCR.
  const photo=source instanceof Blob?Promise.resolve(source):new Promise((resolve,reject)=>{let owned;try{owned=document.createElement('canvas');owned.width=source.width;owned.height=source.height;owned.getContext('2d').drawImage(source,0,0);owned.toBlob(b=>{owned.width=owned.height=0;b?resolve(b):reject(Error('Could not save camera photo'));},'image/jpeg',.95);}catch(e){if(owned)owned.width=owned.height=0;reject(e);}});
  const task=photo.then(async blob=>{const record={id,photo:{bytes:await blob.arrayBuffer(),type:blob.type},metadata:{...metadata,selectedAt:Date.now()},observations:{outcome:'captured'},revision:1,ackedRevision:0,uploaded:false};unsaved.set(id,record);await edit(id,()=>record);unsaved.delete(id);lastError='';void count();schedule();}).catch(e=>{if(!unsaved.has(id))unsaved.set(id,null);error(e);});
  pending.set(id,task);task.finally(()=>pending.delete(id));return id;
 }
 function update(id,patch){
  if(!id)return Promise.resolve();
  return (pending.get(id)||Promise.resolve()).then(()=>{if(unsaved.get(id)){const r=unsaved.get(id);r.revision++;r.observations={...r.observations,...JSON.parse(JSON.stringify(patch))};return;}return edit(id,r=>r?{...r,revision:r.revision+1,observations:{...r.observations,...JSON.parse(JSON.stringify(patch))}}:null);}).then(()=>{schedule();}).catch(error);
 }
 const online=()=>schedule(0);root.addEventListener('online',online);
 void count();schedule(1000);
 return{capture,update,hold:()=>{holds++;},release:()=>{holds=Math.max(0,holds-1);resumeAt=Math.max(resumeAt,Date.now()+Math.max(0,uploadDelayMs));schedule();},retry:async()=>{for(const[id,r]of unsaved)if(r)try{await edit(id,()=>r);unsaved.delete(id);}catch(e){error(e);}await count();schedule(0);},status:()=>({enabled,saved,waiting:waiting+unsaved.size,error:unsaved.size?'Photo not saved on device; keep this page open and retry. '+lastError:lastError}),setEnabled:value=>{enabled=!!value;try{localStorage.setItem('squad-save-scans',enabled?'on':'off');}catch{}notify();if(enabled)schedule();},destroy:()=>{destroyed=true;clearTimeout(timer);if(idle!==null)root.cancelIdleCallback?.(idle);root.removeEventListener('online',online);}};
}
root.ScanArchive={create};
})(window);

