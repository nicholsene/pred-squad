const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
(async()=>{
 const {handler}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('database/scan-collector/index.js','utf8')).toString('base64'));
 const device=crypto.randomUUID(),reviewer=crypto.randomUUID(),secret='a'.repeat(64),hash=crypto.createHash('sha256').update(secret).digest('hex'),capture=crypto.randomUUID();
 const tables={scan_devices:[],scan_reviewers:[{id:reviewer,key_hash:hash}],scan_captures:[],scan_labels:[]},env={get:k=>k==='SUPABASE_URL'?'https://private.test':'server-only'};
 const original=global.fetch;global.fetch=async(url,o={})=>{
  assert.equal(o.headers.Authorization,'Bearer server-only');
  const u=new URL(url);if(u.pathname.startsWith('/storage/'))return Response.json({signedURL:'/object/sign/private?token=temporary'});
  const name=u.pathname.split('/').at(-1),rows=tables[name];assert(rows,name);const matches=r=>[...u.searchParams].every(([k,v])=>!v.startsWith('eq.')&&!v.startsWith('lt.')|| (v.startsWith('eq.')?String(r[k])===v.slice(3):r[k]<Number(v.slice(3))));
  if(o.method==='POST'){const r=JSON.parse(o.body);if(rows.some(x=>x.id===r.id))return Response.json({}, {status:409});rows.push({...r,revision:r.revision||0,image_uploaded:r.image_uploaded||false});return Response.json({});}
  if(o.method==='PATCH'){for(const r of rows.filter(matches))Object.assign(r,JSON.parse(o.body));return Response.json({});}
  return Response.json(rows.filter(matches));
 };
 try{
  const call=(body,who=device,key=secret,review=false)=>handler(new Request('https://collector.test',{method:'POST',headers:{'Content-Type':'application/json',[review?'x-scan-reviewer':'x-scan-device']:who,'x-scan-key':key},body:JSON.stringify(body)}),env);
  assert.equal((await handler(new Request('https://collector.test',{method:'POST',body:'{}'}),env)).status,401);
  const form=new FormData();form.set('id',capture);form.set('metadata','{"sessionId":"game-one"}');form.set('photo',new Blob(['original photo bytes'],{type:'image/jpeg'}),'photo.jpg');
  let r=await handler(new Request('https://collector.test',{method:'POST',headers:{'x-scan-device':device,'x-scan-key':secret},body:form}),env);assert.equal(r.status,200);assert.equal(tables.scan_captures[0].image_uploaded,true);
  assert.equal((await call({action:'status'},device,'b'.repeat(64))).status,403);
  assert.equal((await call({action:'list'})).status,400);
  assert.equal((await call({action:'review',id:capture})).status,400);
  assert.equal((await call({action:'observe',id:capture,revision:2,observations:{parsed:{k:4},verified:true},labels:['forged']})).status,200);assert.equal(tables.scan_labels.length,0);assert.equal(tables.scan_captures[0].review_status,'pending');
  assert.equal((await call({action:'observe',id:capture,revision:1,observations:{parsed:{k:99}}})).status,200);assert.equal(tables.scan_captures[0].observations.parsed.k,4);
  const body={action:'review',id:capture,image_sha256:tables.scan_captures[0].content_sha256,observation_revision:2,status:'partial',labels:[{field:'ours.0.k',correct:4,observed:4,verdict:'correct',region:[.1,.2,.3,.4]}]};
  assert.equal((await call({...body,image_sha256:'wrong'},reviewer,secret,true)).status,409);
  assert.equal((await call({...body,labels:[{field:'k',correct:4,verdict:'correct'}]},reviewer,secret,true)).status,400);
  assert.equal((await call(body,reviewer,secret,true)).status,200);assert.equal(tables.scan_labels.length,1);
  const list=await(await call({action:'list',all:true},reviewer,secret,true)).json();assert.equal(list.captures.length,1);assert.match(list.captures[0].image_url,/object\/sign/);
  assert.equal((await call({action:'observe',id:capture,revision:3,observations:{parsed:{k:5}}})).status,200);assert.equal(tables.scan_captures[0].review_status,'pending');assert.equal(tables.scan_labels.length,1);
  const preflight=await handler(new Request('https://collector.test',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:1234'}}),env);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:1234');
  assert.equal((await handler(new Request('https://collector.test',{method:'OPTIONS',headers:{Origin:'https://other.test'}}),env)).status,403);
  console.log('ok: private collector capabilities, no collector label promotion, revision ordering, evidence validation and CORS');
 }finally{global.fetch=original;}
})().catch(e=>{console.error(e);process.exitCode=1});

