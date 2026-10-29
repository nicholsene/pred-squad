/* Run with OCR_PHOTOS pointing at the private example directory; photos are never committed. */
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
(async()=>{
const root=path.resolve(__dirname,"../docs"),photos=process.env.OCR_PHOTOS;
if(!photos)throw new Error("Set OCR_PHOTOS to your local example directory");
const labels=require("./ocr-examples.json"),requested=(process.env.OCR_IDS||Object.keys(labels).join(",")).split(",");
const server=http.createServer((req,res)=>{const p=new URL(req.url,"http://localhost").pathname;let file;
if(p==="/"){res.setHeader("Content-Type","text/html");res.end('<script src="/photo-prep.js"></script><script src="/scan.js"></script><script src="/scoreboard.js"></script>');return;}
if(p.startsWith("/photo/")){const id=p.split("/").at(-1);if(!labels[id]){res.writeHead(404);res.end();return;}file=path.join(photos,`${id}-Photo-${id}.jpg`);}
else file=path.join(root,p.startsWith("/data/")?"data/"+path.basename(p):path.basename(p));
fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);res.end();return;}res.setHeader("Content-Type",file.endsWith(".js")?"application/javascript":file.endsWith(".jpg")?"image/jpeg":"application/json");res.end(b);});});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
const page=await browser.newPage({ignoreHTTPSErrors:true});page.setDefaultTimeout(180000);
page.on("pageerror",e=>console.error("browser:",e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);const results=[];
for(const id of requested){
const result=await page.evaluate(async({id,type,corners,rectify})=>{let blob=await(await fetch('/photo/'+id)).blob(),heroes=(await(await fetch('/data/heroes.json')).json()).heroes,squad=(await(await fetch('/data/squad.json')).json()).players;
if(rectify){const img=await createImageBitmap(blob);const raw=blob;blob=PhotoPrep.rectify(img,corners.map(([x,y])=>({x:x/img.width,y:y/img.height})));blob._originalSource=raw;img.close();}
const t=performance.now();const result=type==="loading"?await LoadingScan.scan(blob,heroes,squad):await ScoreboardScan.scan(blob,{heroes});return{result,ms:Math.round(performance.now()-t),preview:rectify?blob.toDataURL("image/png"):null};},{id,type:labels[id].type,corners:labels[id].corners,rectify:process.env.OCR_RECTIFY==="1"});
if(result.preview){fs.mkdirSync(path.resolve(__dirname,"../.test-artifacts"),{recursive:true});fs.writeFileSync(path.resolve(__dirname,"../.test-artifacts/prepared-"+id+".png"),Buffer.from(result.preview.split(",")[1],"base64"));delete result.preview;}
const rows=labels[id].type==="loading"?{ours:Object.values(["OFFLANE","JUNGLE","MIDLANE","SUPPORT","CARRY"].map(r=>result.result.ours[r]?.hero)),theirs:["OFFLANE","JUNGLE","MIDLANE","SUPPORT","CARRY"].map(r=>result.result.theirs[r]?.hero)}:{ours:result.result.ours.map(r=>r.hero),theirs:result.result.theirs.map(r=>r.hero)};
let correct=0;for(const side of ["ours","theirs"])labels[id][side].forEach((h,i)=>correct+=h===rows[side][i]);
results.push({id,type:labels[id].type,correct,total:10,...result});console.log(`Photo ${id}: ${correct}/10 hero slots, ${result.ms}ms`);
}
const out=path.resolve(__dirname,"../.test-artifacts/ocr-"+(process.env.OCR_LABEL||"results")+".json");fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(results,null,2));
console.log("Total",results.reduce((s,r)=>s+r.correct,0),"/",results.length*10,"hero slots");
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
