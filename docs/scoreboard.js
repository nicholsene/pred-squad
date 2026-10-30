/* In-match scoreboard scanner. Runs on the phone, nothing is uploaded.
 *
 * Reads, for all 10 players: level, kills / deaths / assists and gold (hero names too
 * when the lineup isn't already known). Rows are in lane order on both sides
 * (Offlane, Jungle, Mid, Support, Carry) and your team is on the left.
 *
 * How: one OCR pass finds the gold totals ("14,457g"), which anchor each row. The
 * row grid is fitted from their spacing, then every number is read from a small
 * crop at a fixed offset. K/D/A and level digits are matched against templates of
 * the game's digit font (sb-digits.json) rather than OCR'd - faster and more accurate.
 * Distances below are in row-heights (u), measured from the gold value.
 */
(function (root) {
  "use strict";
  const ROLES = ["OFFLANE", "JUNGLE", "MIDLANE", "SUPPORT", "CARRY"];
  const GOLD = /^(\d{1,2})[,.](\d{3})g?$/i;
  const clamp=x=>Math.max(0,Math.min(1,x));
  const evidence=(value,source,metrics,resolved=true,extra={})=>({value,source,metrics,resolved,...extra});
  function parseGold(text){const m=GOLD.exec(String(text||"").replace(/\s+/g,""));return m?+(m[1]+m[2]):null;}
  function parseCount(text){const s=String(text??"").replace(/\s+/g,"");return /^\d{1,5}$/.test(s)?+s:null;}
  const MIN_MARGIN=.05;
  const readStrength=e=>e?.resolved&&!e.disputed&&Object.keys(e.metrics||{}).length?Math.min(...Object.values(e.metrics)):0;
  const TW = 14, TH = 22;            // template size
  const BASE_W = 2576;               // photos are normalised to this width (page = 2x this)
  let TPL = null;
  const templates = () => TPL ||= fetch("sb-digits.json").then(r => r.json()).then(o =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, center(Float32Array.from(v))])));

  function center(a) { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.map(v => v - m); }

  /* ---------- pixels ---------- */
  // channel values of a page-space box (page = 2x the normalised photo)
  function grab(src, f, box, mode) {
    const [x0, y0, x1, y1] = box.map(Math.round), w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.imageSmoothingQuality = "high";
    g.drawImage(src, x0 / (2 * f), y0 / (2 * f), w / (2 * f), h / (2 * f), 0, 0, w, h);
    const p = g.getImageData(0, 0, w, h).data, v = new Float32Array(w * h);
    for (let i = 0, j = 0; j < v.length; i += 4, j++) v[j] = mode === "min" ? Math.min(p[i], p[i + 1], p[i + 2]) : Math.max(p[i], p[i + 1], p[i + 2]);
    return { w, h, v, x0, y0 };
  }
  function otsu(v) {
    const hist = new Float64Array(256); for (const x of v) hist[Math.max(0, Math.min(255, x | 0))]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, t = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; const wF = v.length - wB; if (!wF) break;
      sB += i * hist[i]; const d = sB / wB - (sum - sB) / wF, b = wB * wF * d * d;
      if (b > best) { best = b; t = i; }
    }
    return t;
  }
  /** bright connected shapes (digits) inside a crop, as normalised templates */
  function blobs(c, hmin, hmax, floor = 150) {
    const t = Math.max(otsu(c.v), floor), { w, h } = c, seen = new Uint8Array(w * h), out = [];
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || c.v[s] <= t) continue;
      const stack = [s], px = []; seen[s] = 1;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      while (stack.length) {
        const q = stack.pop(), x = q % w, y = (q / w) | 0; px.push(q);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx; if (!seen[n] && c.v[n] > t) { seen[n] = 1; stack.push(n); }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bh < hmin * h || bh > hmax * h || px.length < 15 || bw > 1.2 * bh) continue;
      if (y0 === 0 || y1 >= h - 1) continue;              // panel borders run off the crop
      const m = new Uint8Array(bw * bh); for (const q of px) m[((q / w | 0) - y0) * bw + (q % w - x0)] = 1;
      out.push({ x: c.x0 + x0 + bw / 2, y: c.y0 + y0 + bh / 2, w: bw, h: bh, img: shrinkTo(m, bw, bh) });
    }
    return out.sort((a, b) => a.x - b.x);
  }
  function shrinkTo(m, bw, bh) {   // area-average a binary mask to TW x TH
    const o = new Float32Array(TW * TH);
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const xa = Math.floor(i * bw / TW), xb = Math.max(xa + 1, Math.floor((i + 1) * bw / TW));
      const ya = Math.floor(j * bh / TH), yb = Math.max(ya + 1, Math.floor((j + 1) * bh / TH));
      let s = 0, n = 0; for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { s += m[y * bw + x]; n++; }
      o[j * TW + i] = s / n;
    }
    return o;
  }
  function score(img, t) {
    const a = center(img); let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { ab += a[i] * t[i]; aa += a[i] * a[i]; bb += t[i] * t[i]; }
    return ab / (Math.sqrt(aa * bb) + 1e-9);
  }
  function classify(img,T,allowed="0123456789"){
    const ranked=[...allowed].map(ch=>[ch,score(img,T[ch])]).sort((a,b)=>b[1]-a[1]);
    return [ranked[0][0],ranked[0][1],ranked.length>1?ranked[0][1]-ranked[1][1]:Infinity];
  }
  /** Preserve suggestions from touching digits, but never certify an inferred glyph. */
  function readDigits(bl,T){
    let text="",correlation=1,margin=Infinity,resolved=bl.length>0;
    for(const blob of bl){
      const [ch,sc,gap]=classify(blob.img,T);
      correlation=Math.min(correlation,clamp(sc));margin=Math.min(margin,gap);
      if(blob.w>.75*blob.h&&sc<.75){text+="11";resolved=false;}
      else text+=ch;
      if(gap<MIN_MARGIN)resolved=false;
    }
    return {text,correlation,margin,resolved};
  }
  function group3(bl, u) {
    if (bl.length < 3) return null;
    const gaps = [...Array(bl.length - 1).keys()].map(i => i + 1).sort((a, b) => (bl[b].x - bl[b - 1].x) - (bl[a].x - bl[a - 1].x)).slice(0, 2);
    if (Math.min(...gaps.map(i => bl[i].x - bl[i - 1].x)) < 0.12 * u) return null;
    const [a, b] = gaps.sort((p, q) => p - q);
    return [bl.slice(0, a), bl.slice(a, b), bl.slice(b)];
  }

  /* ---------- OCR helpers (shared Tesseract worker from scan.js) ---------- */
  async function ocrBoxRead(src, f, box, params, up = 2, thr = 175, mode = "max") {
    const K = root.ScanKit;
    const c = K.prep(src, { x: box[0] / (2 * f), y: box[1] / (2 * f), w: (box[2] - box[0]) / (2 * f), h: (box[3] - box[1]) / (2 * f), scale: 2 * f * up, mode, thr });
    const lines = await K.words(c, params);
    return {lines,words:lines.flat(),text:lines.map(l=>l.map(w=>w.t).join(" ")).join(" ").trim()};
  }
  const ocrBox=async(...args)=>(await ocrBoxRead(...args)).text;
  function countRead(read,isGold){
    const words=read.words.filter(w=>/\d/.test(w.t)),text=words.map(w=>w.t).join("");
    const value=isGold?parseGold(text):parseCount(text);
    return {value,readConfidence:evidence(value,"ocr",{ocr:root.ScanKit.confidence(words)},value!==null)};
  }
  async function anchors(src, f, heroDict, squadDict) {
    const K=root.ScanKit,out={golds:[],heroes:[],tags:[]};
    for(const [mode,thr,up] of [["max",175,1],["max",140,1],["gray",140,1],["max",175,2]]){
      const c=K.prep(src,{scale:f*up,mode,thr});
      const lines=await K.words(c,{tessedit_pageseg_mode:"11"});
      // Only comma-formatted gold anchors are safe on the whole image. Live CS is separate.
      for(const w of lines.flat()){
        if(parseGold(w.t)===null||w.t.length>9)continue;
        const hit={t:w.t,c:K.confidence([w]),x:(w.x0+w.x1)/up,y:(w.y0+w.y1)/up};
        const old=out.golds.find(o=>Math.abs(o.x-hit.x)<40&&Math.abs(o.y-hit.y)<40);
        if(!old)out.golds.push(hit);else if(hit.c>old.c)Object.assign(old,hit);
      }
      for(const hit of K.findHeroes(lines,heroDict,up/2)){
        const old=out.heroes.find(o=>Math.abs(o.x-hit.x)<40&&Math.abs(o.y-hit.y)<40);
        if(!old)out.heroes.push(hit);else if(K.strength(hit)>K.strength(old))Object.assign(old,hit);
      }
      out.tags.push(...K.findTokens(lines,squadDict,up/2));
      const W=c.width*2/up;
      if(["L","R"].every(side=>out.golds.filter(g=>(g.x<W/2)===(side==="L")).length===5))break;
      if(heroGeometry(out.heroes,W,c.height*2/up)?.confidence.resolved)break;
    }
    return out;
  }
  // The live board has no earned-gold column. Locate its rows from all ten actual
  // hero labels; fixed screen coordinates alone never establish this profile.
  function heroGeometry(hits,W,H){
    const observed={},ys=[];
    for(const side of ["L","R"]){
      // Low-strength canonical reads can locate review crops, never certify them.
      const candidates=hits.filter(h=>h.c>=.1&&h.s>=.75&&h.y>H*.15&&
        Number.isFinite(h.x0)&&(h.x<W/2)===(side==="L")).sort((a,b)=>a.y-b.y);
      const groups=[];
      for(const hit of candidates){
        let group=groups.find(g=>Math.abs(g[0].y-hit.y)<H*.018);
        if(!group)groups.push(group=[]);group.push(hit);
      }
      if(groups.length<3||groups.length>5)return null;
      observed[side]=groups.map(g=>g.sort((a,b)=>root.ScanKit.strength(b)-root.ScanKit.strength(a))[0]);
      if(new Set(observed[side].map(h=>h.slug)).size!==observed[side].length)return null;
      ys.push(...observed[side].map(h=>h.y));
    }
    const u=fitDy(Object.values(observed).map(row=>row.map(h=>h.y)),H);
    if(!u)return null;
    const first=Math.min(...ys),span=Math.round((Math.max(...ys)-first)/u);
    if(span>4)return null;
    // Missing outside rows make the lane offset ambiguous. Center the review
    // crops on the observed rows and leave layout unresolved.
    const offset=Math.floor((4-span)/2),rows={},errors=[];
    let complete=span===4,actualCount=0;
    for(const side of ["L","R"]){
      const indexed=new Map();
      for(const hit of observed[side]){
        const index=Math.round((hit.y-first)/u)+offset;
        if(index<0||index>4||indexed.has(index))return null;
        indexed.set(index,hit);
      }
      const entries=[...indexed],base=median(entries.map(([i,h])=>h.y-i*u));
      const n=entries.length,sx=entries.reduce((s,[i])=>s+i,0),sy=entries.reduce((s,[,h])=>s+h.x0,0);
      const sxx=entries.reduce((s,[i])=>s+i*i,0),sxy=entries.reduce((s,[i,h])=>s+i*h.x0,0);
      const dx=(n*sxy-sx*sy)/(n*sxx-sx*sx||1),x0=(sy-dx*sx)/n;
      for(const [i,h]of entries){
        errors.push(Math.abs(h.y-base-i*u)/u);
        if(Math.abs(h.x0-x0-i*dx)>.6*u)return null;
      }
      rows[side]=Array.from({length:5},(_,i)=>{
        const hit=indexed.get(i);
        if(hit){actualCount++;return hit;}
        complete=false;
        return {slug:null,x0:x0+i*dx,x:x0+i*dx,y:base+i*u,c:0,s:0,ambiguous:true,inferred:true};
      });
    }
    const residual=Math.max(...errors);
    if(residual>.15)return null;
    const actual=Object.values(observed).flat();
    const resolved=complete&&actualCount===10&&residual<=.1&&
      actual.every(h=>h.c>=.9&&h.s>=.9&&!h.ambiguous);
    return {rows,u,actualCount,confidence:evidence("role-order","hero-grid",{
      ocr:actualCount===10?Math.min(...actual.map(h=>h.c)):0,match:clamp(1-residual)
    },resolved)};
  }

  function fitDy(sides, H) {
    let best = null;
    for (let dy = Math.round(H * 0.07); dy < H * 0.16; dy++) {
      let err = 0, n = 0;
      for (const ys of sides) for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) { const r = Math.abs(ys[j] - ys[i]) / dy; err += Math.abs(r - Math.round(r)); n++; }
      if (!n) return null;
      if (!best || err / n < best[0]) best = [err / n, dy];
    }
    return best && best[1];
  }
  const median = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

  function inventory(src,f,gx,gy,u,side,opts,liveHero) {
    const names=[],previews=[],candidates=[],allowed=(opts.items||[]).filter(i=>i.slot==="PASSIVE").map(i=>i.name);
    for(let i=0;i<6;i++){
      // Six equipment slots follow the larger crest slot below the level circle.
      const cx=liveHero?liveHero.x0+((side==="L"?.35:.25)+i*.42)*u:gx+(side==="L"?-3.14+i*.45:1.63+i*.45)*u,cy=liveHero?liveHero.y+.33*u:gy-.20*u,size=.38*u;
      const c=document.createElement("canvas");c.width=c.height=48;const g=c.getContext("2d");
      g.drawImage(src,(cx-size/2)/(2*f),(cy-size/2)/(2*f),size/(2*f),size/(2*f),0,0,48,48);
      const result=root.ItemVision?root.ItemVision.match(g.getImageData(0,0,48,48),opts.itemTemplates,{patch:opts.patch,allowedNames:allowed.length?allowed:undefined}):{name:null,reason:"no_templates",confidence:0,alternatives:[]};
      names.push(result.name||null);previews.push(c.toDataURL("image/png"));candidates.push(result);
    }
    return{items:names,itemPreviews:previews,itemCandidates:candidates,inventoryConfirmed:false,inventoryComplete:false};
  }

  /* ---------- main ---------- */
  async function scan(file, opts = {}) {
    const { heroes = [], known = {}, onProgress = () => {} } = opts;
    if (file._originalSource && !opts._singlePass) {
      onProgress("Comparing original and straightened reads…", .02);
      const original = await scan(file._originalSource, {...opts,_singlePass:true});
      const corrected = await scan(file, {...opts,_singlePass:true});
      let disagreements=0;
      const sameLayout=original.sourceLayout===corrected.sourceLayout,rawLayout=original.readConfidence?.layout?.resolved===true;
      for(const side of ["ours","theirs"])for(let i=0;i<5;i++){
        const raw=original[side]?.[i]||{},row=corrected[side]?.[i];if(!row)continue;
        row.readConfidence||={};row.alternatives||={};
        for(const key of ["hero","lvl","k","d","a","cs","gold"]){
          if(!sameLayout&&["cs","gold"].includes(key))continue;
          const conflict=raw[key]!=null&&row[key]!=null&&raw[key]!==row[key];
          if(conflict){row.alternatives[key]=[raw[key],row[key]];disagreements++;}
          const useRaw=raw[key]!=null&&((rawLayout&&sameLayout&&key!=="hero"&&(conflict||readStrength(raw.readConfidence?.[key])>readStrength(row.readConfidence[key])))||row[key]==null);
          if(useRaw){
            row[key]=raw[key];row.readConfidence[key]={...raw.readConfidence?.[key],value:raw[key]};
            if(!rawLayout||!sameLayout)row.readConfidence[key].resolved=false;
          }else if(rawLayout&&sameLayout&&raw[key]===row[key]&&
            readStrength(raw.readConfidence?.[key])>readStrength(row.readConfidence[key]))
            row.readConfidence[key]={...raw.readConfidence[key]};
          if(conflict)row.readConfidence[key]={...row.readConfidence[key],disputed:true};
        }
        for(let j=0;j<6;j++)if(raw.items?.[j]!=null&&row.items?.[j]!=null&&raw.items[j]!==row.items[j]){
          const e=row.readConfidence.items?.[j];if(e)e.disputed=true;
        }
      }
      corrected.readConfidence||={};
      if(!sameLayout&&rawLayout&&corrected.readConfidence.layout?.resolved)
        corrected.readConfidence.layout={...corrected.readConfidence.layout,disputed:true};
      if(corrected.readConfidence.ownTeam?.resolved&&original.readConfidence?.ownTeam?.resolved&&
        corrected.readConfidence.ownTeam.value!==original.readConfidence.ownTeam.value)
        corrected.readConfidence.ownTeam={...corrected.readConfidence.ownTeam,disputed:true};
      if(!corrected.readConfidence.ownTeam?.resolved&&original.readConfidence?.ownTeam?.resolved&&sameLayout)
        corrected.readConfidence.ownTeam={...original.readConfidence.ownTeam};
      if(disagreements)corrected.issues.push(`${disagreements} reads disagree between views. Check the highlighted fields.`);
      corrected.method="compared original and straightened reads";
      return corrected;
    }
    const K = root.ScanKit, T = await templates();
    onProgress("Reading the scoreboard…", 0.05);
    const src = await K.toCanvas(file), f = BASE_W / src.width;
    const rawIconSource=document.createElement("canvas"),rawImage=await createImageBitmap(file);
    rawIconSource.width=rawImage.width;rawIconSource.height=rawImage.height;rawIconSource.getContext("2d").drawImage(rawImage,0,0);rawImage.close();
    const W = 2 * BASE_W, H = 2 * src.height * f, issues = [];
    const aligned=!!file._screenAligned;
    const heroDict=heroes.map(h=>({slug:h.slug,key:h.name.toUpperCase().replace(/[^A-Z]/g,"")}));
    const squadDict=(opts.squad||[]).map(p=>({slug:p.key,key:p.label.toUpperCase().replace(/[^A-Z]/g,"")}));
    const detected=await anchors(src,f,heroDict,squadDict);let heroGrid=heroGeometry(detected.heroes,W,H);
    const golds=detected.golds.filter(g=>g.y>H*.15);
    if(aligned&&!golds.length&&!heroGrid){
      const step=H*.13,rows={};
      for(const side of ["L","R"])rows[side]=ROLES.map((_,i)=>({slug:null,x0:W*(side==="L"?.16:.68),x:W*(side==="L"?.16:.68),y:H*.20+i*step,c:0,s:0,ambiguous:true,inferred:true}));
      heroGrid={u:step,rows,confidence:evidence("role-order","heuristic-framed-grid",{match:0},false)};
    }
    const live=!!heroGrid&&!golds.length;
    const tagReads=[];
    onProgress("Finding rows…", 0.35);
    const sides = {};
    for (const [side, sel] of [["L", g => g.x < W / 2], ["R", g => g.x >= W / 2]]) {
      let gs = golds.filter(sel);
      if (gs.length) { const mx = median(gs.map(g => g.x)); gs = gs.filter(g => Math.abs(g.x - mx) < W * 0.04); }
      sides[side] = gs.sort((a, b) => a.y - b.y);
    }
    if(!aligned&&!live&&!sides.L.length&&!sides.R.length)
      return {ours:[],theirs:[],issues:["Couldn't locate ten clear scoreboard hero labels or gold anchors. Try a closer, straighter photo."],sourceLayout:"unknown"};
    const u=live?heroGrid.u:fitDy(Object.values(sides).filter(s=>s.length>=2).map(s=>s.map(g=>g.y)),H)||(aligned?H*.135:H*.11);
    const tops=live?Object.fromEntries(["L","R"].map(side=>{
      const hs=heroGrid.rows[side],xs=hs.map(h=>h.x0+(side==="L"?3.38:-1.52)*u);
      return [side,{y0:hs[0].y+.31*u,x0:xs[0],dx:(xs[4]-xs[0])/4,span:4,off:0}];
    })):aligned?{L:{y0:H*.32,x0:W*.417,dx:0,span:4,off:0},R:{y0:H*.32,x0:W*.58,dx:0,span:4,off:0}}:{};
    for (const [side, gs] of Object.entries(sides)) {
      if (!gs.length||live) continue;
      const idx = gs.map(g => Math.round((g.y - gs[0].y) / u));
      const span = Math.max(...idx), dx = span ? (gs[gs.length - 1].x - gs[0].x) / span : 0;
      tops[side] = { y0: gs[0].y, x0: gs[0].x, dx, span };
    }
    // which row is the first anchor in? use the other side's alignment, then look for gold text in the gaps
    for (const [side, t] of Object.entries(tops)) {
      const other = Object.entries(tops).find(([s]) => s !== side);
      let best = null;
      for (let off = 0; off <= 4 - t.span; off++) {
        const top = t.y0 - off * u; let sc = 0;
        if (other) { const k = (other[1].y0 - top) / u; sc -= Math.abs(k - Math.round(k)); if (Math.round(k) < 0 || Math.round(k) + other[1].span > 4) sc -= 5; }
        if (4 - t.span > 0) for (let i = 0; i < 5; i++) {
          if (i >= off && i <= off + t.span) continue;
          const gy = top + i * u, gx = t.x0 + (i - off) * t.dx;
          if (GOLD.test(await ocrBox(src, f, [gx - 0.45 * u, gy - 0.11 * u, gx + 0.45 * u, gy + 0.11 * u], { tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789,g" }))) sc += 1;
        }
        if (!best || sc > best[0]) best = [sc, off];
      }
      t.off = best[1];
    }
    onProgress("Reading numbers…", 0.6);
    const goldResiduals=Object.values(sides).flatMap(gs=>gs.map(g=>{
      const t=gs[0],index=Math.round((g.y-t.y)/u);return Math.abs(g.y-t.y-index*u)/u;
    }));
    const goldGridResolved=["L","R"].every(side=>sides[side].length===5&&
      new Set(sides[side].map(g=>Math.round((g.y-sides[side][0].y)/u))).size===5)&&
      goldResiduals.every(x=>x<=.1);
    const layout=live?heroGrid.confidence:evidence("role-order","gold-grid",{
      ocr:golds.length?Math.min(...golds.map(g=>g.c)):0,
      match:goldResiduals.length?clamp(1-Math.max(...goldResiduals)):0
    },goldGridResolved);
    const sourceLayout=live?"live":goldGridResolved?"gold":"unknown";
    const result={L:[],R:[]};
    // Restrict global exact-tag matches to the detected name bands.
    for(const tag of detected.tags){
      const side=tag.x<W/2?"L":"R",t=tops[side];if(!t)continue;
      for(let i=0;i<5;i++){
        const h=live?heroGrid.rows[side][i]:null;
        const gy=t.y0+(i-t.off)*u,gx=t.x0+(i-t.off)*t.dx;
        const x0=h?h.x0:gx+(side==="L"?-3.45:1.38)*u,y=h?h.y:gy-.4*u;
        if(tag.x>=x0-.1*u&&tag.x<=x0+2.5*u&&tag.y>=y-.4*u&&tag.y<=y+.13*u)
          tagReads.push({...tag,side,index:i});
      }
    }
    for (const side of ["L", "R"]) {
      const t = tops[side] || (() => { const o = tops[side === "L" ? "R" : "L"]; return { y0: o.y0 - o.off * u, x0: side === "L" ? W - o.x0 : W - o.x0, dx: -o.dx, span: 0, off: 0 }; })();
      for (let i = 0; i < 5; i++) {
        let gy = t.y0 + (i - t.off) * u, gx = t.x0 + (i - t.off) * t.dx; const role = ROLES[i];
        const liveHero=live?heroGrid.rows[side][i]:null;
        if(liveHero){gy=liveHero.y+.31*u;gx=liveHero.x0+(side==="L"?3.38:-1.52)*u;}
        const row={role,hero:(known[side]||[])[i]||null,lvl:null,k:null,d:null,a:null,gold:null,cs:null,readConfidence:{}};
        if(row.hero)row.readConfidence.hero=evidence(row.hero,"known-lineup",{},false);
        if(liveHero){row.hero=liveHero.slug;row.readConfidence.hero=K.hitEvidence(liveHero);}
        if(live)row.readConfidence.gold=evidence(null,"not-displayed",{},false,{available:false});
        // K / D / A
        const kb=blobs(grab(src,f,liveHero?[gx-.42*u,liveHero.y-.18*u,gx+.42*u,liveHero.y+.09*u]:[gx-.42*u,gy-.6*u,gx+.42*u,gy-.38*u],"max"),.35,.95);
        const g3 = group3(kb, u);
        if (g3) {
          g3.forEach((g,j)=>{
            const read=readDigits(g,T),key=["k","d","a"][j],n=parseInt(read.text,10),max=key==="a"?100:60;
            row[key]=Number.isInteger(n)&&n<=max?n:null;
            row.readConfidence[key]=evidence(row[key],"digit-template",{correlation:read.correlation},read.resolved&&row[key]!==null,{margin:read.margin});
          });
          // re-centre the row on the D column: more precise than the OCR'd gold box
          const mid = g3[1], cx = mid.reduce((s, b) => s + b.x, 0) / mid.length, cy = kb.reduce((s, b) => s + b.y, 0) / kb.length;
          if (Math.abs(cx - gx) < 0.3 * u) gx = cx;
          if(!liveHero&&Math.abs(cy+.49*u-gy)<.15*u)gy=cy+.49*u;
        }
        // level, inside the circle by the name
        const lc=liveHero?[liveHero.x0-.22*u,liveHero.y-.09*u]:side==="L"?[gx-3.59*u,gy-.5*u]:[gx+1.18*u,gy-.53*u];
        const win = grab(src, f, [lc[0] - 0.19 * u, lc[1] - 0.17 * u, lc[0] + 0.19 * u, lc[1] + 0.17 * u], "min");
        const cand = blobs(win, 0.06 * u / win.h, 0.17 * u / win.h, 90).filter(b => b.w < 0.12 * u);
        if (opts.debug) row._lv = cand.map(b => `${((b.x - lc[0]) / u).toFixed(2)},${((b.y - lc[1]) / u).toFixed(2)} h${(b.h / u).toFixed(2)} w${(b.w / u).toFixed(2)}`);
        if (cand.length) {
          const first = cand.reduce((a, b) => Math.abs(b.x - lc[0]) < Math.abs(a.x - lc[0]) ? b : a);
          let grp = cand.filter(b => Math.abs(b.x - first.x) < 0.13 * u && Math.abs(b.h - first.h) < 0.35 * first.h);
          grp = grp.sort((a, b) => Math.abs(a.x - first.x) - Math.abs(b.x - first.x)).slice(0, 2).sort((a, b) => a.x - b.x);
          const read=readDigits(grp,T),lv=parseInt(read.text,10);
          if(lv>=1&&lv<=18)row.lvl=lv;
          row.readConfidence.lvl=evidence(row.lvl,"digit-template",{correlation:read.correlation},read.resolved&&row.lvl!==null,{margin:read.margin});
        }
        // The live board's yellow value is CS; only the legacy comma-gold profile yields earned gold.
        const field=live?"cs":"gold",near=!live&&sides[side].find(g=>Math.abs(g.y-gy)<.3*u);
        if(near){
          row.gold=parseGold(near.t);
          row.readConfidence.gold=evidence(row.gold,"ocr",{ocr:near.c},row.gold!==null);
        }else{
          let best=null;
          for(const [mode,thr,up] of [["max",175,2],["gray",140,3]]){
            const read=await ocrBoxRead(src,f,[gx-.45*u,gy-.13*u,gx+.45*u,gy+.13*u],
              {tessedit_pageseg_mode:"7",tessedit_char_whitelist:live?"0123456789":"0123456789,g"},up,thr,mode);
            const candidate=countRead(read,!live);
            if(candidate.value!==null&&(!best||candidate.readConfidence.metrics.ocr>best.readConfidence.metrics.ocr))best=candidate;
            if(best?.readConfidence.metrics.ocr>=.9)break;
          }
          if(best){row[field]=best.value;row.readConfidence[field]=best.readConfidence;}
        }
        // Hero OCR also contains the gamertag. Keep confidence for the matched words only.
        if(heroDict.length&&(!liveHero||K.strength(liveHero)<.9||liveHero.ambiguous||!tagReads.some(t=>t.s===1&&t.c>=.9&&!t.ambiguous))){
          const hb=liveHero?[liveHero.x0-.04*u,liveHero.y-.34*u,liveHero.x0+2.5*u,liveHero.y+.14*u]:
            side==="L"?[gx-3.45*u,gy-.62*u,gx-1.5*u,gy-.26*u]:[gx+1.38*u,gy-.62*u,gx+3.5*u,gy-.26*u];
          let best=liveHero;
          for(const [mode,thr,psm] of [["max",175,"6"],["max",140,"6"],["gray",140,"6"]]){
            const read=await ocrBoxRead(src,f,hb,{tessedit_pageseg_mode:psm,tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZ.& "},2,thr,mode);
            const hits=K.findHeroes(read.lines,heroDict,1).sort((a,b)=>K.strength(b)-K.strength(a));
            if(hits.length&&(!best||K.strength(hits[0])>K.strength(best)))best=hits[0];
            for(const tag of K.findTokens(read.lines,squadDict,1))tagReads.push({...tag,side,index:i});
            if(opts.debug)row._hero=read.text;
            if(best&&K.strength(best)>=.9&&!best.ambiguous&&
              (!squadDict.length||tagReads.some(t=>t.s===1&&t.c>=.9&&!t.ambiguous)))break;
          }
          if(best){row.hero=best.slug;row.readConfidence.hero=K.hitEvidence(best);}
        }
        Object.assign(row,inventory(rawIconSource,f,gx,gy,u,side,opts,liveHero));
        row.readConfidence.items=row.itemCandidates.map(c=>evidence(c.name||null,"item-template",{similarity:c.confidence||0},c.reason==="visual_suggestion"&&!!c.name,{state:c.name?"item":"unknown"}));
        result[side].push(row);
        onProgress("Reading numbers…", 0.6 + 0.4 * (result.L.length + result.R.length) / 10);
      }
    }
    const strongTags=tagReads.filter(t=>t.s===1&&t.c>=.9&&!t.ambiguous);
    const teamSides=new Set(strongTags.map(t=>t.side));
    const ownTeam=evidence(strongTags[0]?.side==="R"?"right":"left","gamertag",{
      ocr:strongTags.length?Math.min(...strongTags.map(t=>t.c)):0,match:strongTags.length?1:0
    },teamSides.size===1);
    for(const t of strongTags.filter(t=>t.side==="L")){
      const row=result.L[t.index];if(!row)continue;
      if(row.who&&row.who!==t.slug){row.readConfidence.who.disputed=true;continue;}
      row.who=t.slug;row.readConfidence.who=K.hitEvidence(t,t.slug,"gamertag");
    }
    const missing=[...result.L,...result.R].filter(r=>["lvl","k","d","a",live?"cs":"gold"].some(k=>r[k]==null)).length;
    if (missing) issues.push(`${missing} row${missing === 1 ? "" : "s"} only partly read — check the numbers.`);
    onProgress("Done", 1);
    if(!layout.resolved)issues.push("Row alignment needs review; uncertain hero reads locate crops only.");
    if(!ownTeam.resolved)issues.push("Confirm which team is yours.");
    return {ours:result.L,theirs:result.R,issues,rowHeight:u,sourceLayout,readConfidence:{layout,ownTeam}};
  }

  root.ScoreboardScan={scan,_parseGold:parseGold,_parseCount:parseCount,_heroGeometry:heroGeometry};
  if(typeof module!=="undefined")module.exports=root.ScoreboardScan;
})(typeof window !== "undefined" ? window : globalThis);
