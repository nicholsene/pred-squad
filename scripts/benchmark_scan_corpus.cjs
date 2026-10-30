/* Run the real local reader against a PRIVATE visually reviewed corpus. Never commit its output. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(process.argv[2]||path.join(root,'.scan-private/verified-seed.json'))),out=process.argv[3]||path.join(root,'.scan-private/benchmark.json'),photos=manifest.photos;
 const source=process.env.SCAN_SOURCE_ROOT||manifest.sourceRoot||root;
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://local').pathname;
  if(u==='/'){res.setHeader('Content-Type','text/html');return res.end(['free-ocr','numeric-ocr','free-scan','photo-router','scan-quality'].map(n=>'<script src="/'+n+'.js"></script>').join(''));}
  const f=u.startsWith('/photo/')?path.resolve(source,photos[Number(u.split('/').at(-1))].path):path.resolve(root,'docs','.'+u);
  if(!u.startsWith('/photo/')&&!f.startsWith(path.join(root,'docs')+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(f,(e,b)=>{res.writeHead(e?404:200,{'Content-Type':/\.m?js$/.test(f)?'application/javascript':f.endsWith('.json')?'application/json':f.endsWith('.jpg')?'image/jpeg':'application/octet-stream'});res.end(e?'':b);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;const results=[];
 try{
  const engine=process.env.SCAN_BROWSER||'chromium';browser=await pw[engine].launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.evaluate(async()=>{window.__catalog={};for(const k of ['heroes','items','squad'])__catalog[k]=await(await fetch('/data/'+k+'.json')).json();});
  for(let i=0;i<photos.length;i++){
   let read;try{read=await page.evaluate(async i=>{
    const t=performance.now(),blob=await(await fetch('/photo/'+i)).blob(),bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas'),scale=Math.min(1,2048/bitmap.width,2048/bitmap.height);canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    try{
     const ocr=await FreeOCR.read(canvas),heroes=__catalog.heroes.heroes,squad=__catalog.squad.players,items=__catalog.items.items,detected=PhotoRouter.classify(ocr.lines,{heroes,items,width:canvas.width,height:canvas.height});
     let parsed=null,quality=null,numericRetry=null,numericRetryError=null;
     if(['scoreboard','unknown'].includes(detected.kind)){
      let p=FreeScan.prepareBoard(ocr,{heroes,squad});
      if(p.cells.length){const sheet=FreeOCR.atlas(canvas,p.cells);try{const enlarged=await FreeOCR.read(sheet.canvas);p=FreeScan.applyCells(p,sheet.reads(enlarged),{withGeometry:true});parsed=p.result;}finally{sheet.canvas.width=sheet.canvas.height=0;}
       let crops=[];try{crops=FreeOCR.digits(canvas,p.cells);numericRetry=await NumericOCR.read(crops);parsed=FreeScan.applyCells(p,numericRetry);}catch(e){numericRetryError=e.message;}finally{crops.forEach(c=>{c.canvas.width=c.canvas.height=0;});}
      }else parsed=p.result;
      const a=ScanQuality.automaticBoard(parsed,{heroes,squad,items});parsed=a.result;quality=a.quality;
     }else if(detected.kind==='loading'){
      parsed=FreeScan.loading(ocr,{heroes,squad});
      if(!parsed){const cells=FreeScan.loadingCells(ocr,{heroes});if(cells.length){const sheet=FreeOCR.atlas(canvas,cells);try{const enlarged=await FreeOCR.read(sheet.canvas),mapped=Object.values(sheet.reads(enlarged)).flatMap(r=>r.items.filter(i=>i.sourcePoly).map(i=>({...i,poly:i.sourcePoly})));parsed=FreeScan.loading({...ocr,items:[...ocr.items,...mapped]},{heroes,squad});}finally{sheet.canvas.width=sheet.canvas.height=0;}}}
      if(parsed)quality=ScanQuality.assess('loading',parsed,{heroes,squad,items});
     }
     return{detected,parsed,quality,ocr,numericRetry,numericRetryError,ms:Math.round(performance.now()-t)};
    }finally{canvas.width=canvas.height=0;}
   },i);}catch(e){read={error:e.message};await page.evaluate(()=>FreeOCR.cancel());}
   results.push({path:photos[i].path,captureId:photos[i].captureId,expectedType:photos[i].screenType,...read});
   fs.writeFileSync(out,JSON.stringify({schema:1,results},null,2));
   console.log(JSON.stringify({photo:i+1,total:photos.length,type:read.detected?.kind,auto:read.quality?.auto,error:read.error,ms:read.ms}));
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

