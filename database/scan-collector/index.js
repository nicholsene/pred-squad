// Private collector. Browser device capabilities can submit observations, never verified labels.
// Reviewer capabilities are provisioned out of band and never shipped with the app.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const TYPES=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif']);
const cors={'Access-Control-Allow-Origin':'https://nicholsene.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-scan-device,x-scan-key,x-scan-reviewer','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function handler(req,env){
 const origin=req.headers.get('origin');
 if(origin&&origin!=='https://nicholsene.github.io'&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))return reply({error:'Origin denied'},403);
 const headers={...cors};if(origin?.startsWith('http://'))headers['Access-Control-Allow-Origin']=origin;
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 const url=env.get('SUPABASE_URL'),key=env.get('SUPABASE_SERVICE_ROLE_KEY');
 const api=async(path,options={})=>{
  const r=await fetch(url+path,{...options,headers:{Authorization:'Bearer '+key,apikey:key,'Content-Type':'application/json',...options.headers}});
  const t=await r.text();let value;try{value=JSON.parse(t);}catch{value=t;}
  if(!r.ok)throw Object.assign(Error('Storage request failed'),{status:r.status,detail:value});
  return value;
 };
 const db=(table,query='',options={})=>api('/rest/v1/'+table+query,options);
 const respond=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...headers,'Content-Type':'application/json','Cache-Control':'no-store'}});
 try{
  const reviewer=req.headers.get('x-scan-reviewer'),device=req.headers.get('x-scan-device'),secret=req.headers.get('x-scan-key');
  if(!UUID.test(reviewer||device||'')||!HEX.test(secret||''))return respond({error:'Private collection key required'},401);
  const hash=await sha(new TextEncoder().encode(secret)),table=reviewer?'scan_reviewers':'scan_devices',id=reviewer||device;
  let owners=await db(table,'?id=eq.'+id+'&select=id,key_hash');
  const multipart=(req.headers.get('content-type')||'').startsWith('multipart/form-data');
  if(!reviewer&&!owners.length&&multipart){
   try{await db(table,'',{method:'POST',body:JSON.stringify({id,key_hash:hash})});}catch(e){if(e.status!==409)throw e;}
   owners=await db(table,'?id=eq.'+id+'&select=id,key_hash');
  }
  if(owners[0]?.key_hash!==hash)return respond({error:'Private collection key rejected'},403);
  if(Number(req.headers.get('content-length')||0)>53500000)return respond({error:'Photo exceeds 50 MB; retained on device'},413);
  if(multipart){
   if(reviewer)return respond({error:'Device required'},403);
   const form=await req.formData(),photo=form.get('photo'),metaText=String(form.get('metadata')||'{}'),capture=String(form.get('id')||'');
   if(!UUID.test(capture)||!(photo instanceof Blob)||!TYPES.has(photo.type)||photo.size<1||photo.size>52428800||metaText.length>32768)return respond({error:'Unsupported photo or metadata'},400);
   const metadata=JSON.parse(metaText),bytes=await photo.arrayBuffer(),content_sha256=await sha(bytes),object_path=device+'/'+capture;
   let rows=await db('scan_captures','?id=eq.'+capture+'&select=*');
   if(rows.length&&(rows[0].device_id!==device||rows[0].content_sha256!==content_sha256))return respond({error:'Capture identity conflict'},409);
   if(!rows.length){await db('scan_captures','',{method:'POST',body:JSON.stringify({id:capture,device_id:device,object_path,content_sha256,byte_size:photo.size,mime:photo.type,metadata})});}
   if(!rows[0]?.image_uploaded){
    try{await api('/storage/v1/object/scan-corpus/'+object_path,{method:'POST',headers:{'Content-Type':photo.type,'x-upsert':'false'},body:bytes});}
    catch(e){if(e.status!==409&&e.detail?.statusCode!=='409'&&e.detail?.error!=='Duplicate')throw e;}
    await db('scan_captures','?id=eq.'+capture+'&device_id=eq.'+device,{method:'PATCH',body:JSON.stringify({image_uploaded:true})});
   }
   return respond({id:capture,saved:true,sha256:content_sha256});
  }
  const raw=await req.text();if(raw.length>1500000)return respond({error:'Observation too large'},413);
  const b=JSON.parse(raw);
  if(reviewer){
   if(b.action==='list'){
    const filter=b.all?'':'&review_status=eq.pending';const offset=Number.isInteger(b.offset)&&b.offset>=0?b.offset:0;
    const rows=await db('scan_captures','?image_uploaded=eq.true'+filter+'&order=created_at.asc,id.asc&limit=100&offset='+offset);
    for(const row of rows){
     const signed=await api('/storage/v1/object/sign/scan-corpus/'+row.object_path,{method:'POST',body:JSON.stringify({expiresIn:300})});
     row.image_url=url+'/storage/v1'+signed.signedURL;
     row.reviews=await db('scan_labels','?capture_id=eq.'+row.id+'&order=created_at.desc');
    }
    return respond({captures:rows,nextOffset:rows.length===100?offset+100:null});
   }
   if(b.action==='review'){
    if(!UUID.test(b.id)||!['verified','partial','unreadable'].includes(b.status)||!Array.isArray(b.labels)||b.labels.length>250||JSON.stringify(b.labels).length>150000)return respond({error:'Invalid review'},400);
    for(const l of b.labels)if(typeof l.field!=='string'||l.field.length>100||!['correct','incorrect','unreadable','unobserved'].includes(l.verdict)||!Array.isArray(l.region)||l.region.length!==4||l.region.some(n=>!Number.isFinite(n)||n<0||n>1)||l.region[2]<=l.region[0]||l.region[3]<=l.region[1]||!Object.hasOwn(l,'correct'))return respond({error:'Every label needs a field, verdict, correct value and normalized evidence region'},400);
    const [capture]=await db('scan_captures','?id=eq.'+b.id+'&image_uploaded=eq.true');
    if(!capture||b.image_sha256!==capture.content_sha256||b.observation_revision!==capture.revision)return respond({error:'Photo or observation changed; fetch again'},409);
    const review={id:crypto.randomUUID(),capture_id:b.id,reviewer_id:reviewer,image_sha256:capture.content_sha256,observation_revision:capture.revision,status:b.status,labels:b.labels,assessment:b.assessment||{}};
    await db('scan_labels','',{method:'POST',body:JSON.stringify(review)});
    await db('scan_captures','?id=eq.'+b.id+'&revision=eq.'+capture.revision,{method:'PATCH',body:JSON.stringify({review_status:b.status})});
    return respond({review:review.id,saved:true});
   }
   return respond({error:'Unknown reviewer action'},400);
  }
  if(b.action==='observe'){
   if(!UUID.test(b.id)||!Number.isInteger(b.revision)||b.revision<1||!b.observations||typeof b.observations!=='object')return respond({error:'Invalid observation'},400);
   // Never accept labels, reviewed status, or file paths from a collector.
   const rows=await db('scan_captures','?id=eq.'+b.id+'&device_id=eq.'+device+'&select=id');
   if(!rows.length)return respond({error:'Photo not saved yet'},409);
   await db('scan_captures','?id=eq.'+b.id+'&device_id=eq.'+device+'&revision=lt.'+b.revision,{method:'PATCH',body:JSON.stringify({observations:b.observations,revision:b.revision,review_status:'pending'})});
   return respond({saved:true});
  }
  if(b.action==='status'){
   const rows=await db('scan_captures','?device_id=eq.'+device+'&image_uploaded=eq.true&select=id,review_status');
   return respond({saved:rows.length,reviewed:rows.filter(r=>r.review_status!=='pending').length});
  }
  return respond({error:'Unknown action'},400);
 }catch(e){if(String(e.detail?.message||'').includes('photo_collection_capacity'))return respond({error:'Private collection capacity reached; photo retained on device'},429);return respond({error:e instanceof SyntaxError?'Invalid request':'Photo collection unavailable; retry later'},e instanceof SyntaxError?400:503);}
}
if(typeof Deno!=='undefined')Deno.serve(req=>handler(req,Deno.env));

