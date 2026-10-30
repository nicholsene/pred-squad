/* Loading-screen scanner. Runs entirely on the phone (Tesseract.js, no upload).
 *
 * Reads hero names off the 10 player cards and the lane labels between the
 * two rows, then works out which row is ours from the squad gamertags.
 * Returns { ours: {ROLE: {hero, who}}, theirs: {ROLE: {hero}}, issues: [...] }.
 * Anything it can't read is left blank for the player to fill in.
 */
(function (root) {
  "use strict";
  const CFG = Object.assign({
    lib: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
  }, root.SCAN_CONFIG || {});
  const ROLES = ["OFFLANE", "JUNGLE", "MIDLANE", "SUPPORT", "CARRY"];

  let workerP = null;
  function loadLib() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    return new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = CFG.lib; s.async = true;
      s.onload = () => res(root.Tesseract); s.onerror = () => rej(new Error("Couldn't load the scanner (offline?)"));
      document.head.appendChild(s);
    });
  }
  function getWorker() {
    return workerP ||= loadLib().then(T => T.createWorker("eng", 1, {
      workerPath: CFG.workerPath, corePath: CFG.corePath, langPath: CFG.langPath, gzip: true,
    })).catch(e => { workerP = null; throw e; });
  }

  // ---------- image helpers ----------
  async function toCanvas(src) {
    const img = await createImageBitmap(src);
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    // auto-levels: stretch the 2nd..99.5th percentile brightness to full range so dim
    // or washed-out photos threshold like clean ones
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data, hist = new Uint32Array(256);
    for (let i = 0; i < p.length; i += 16) hist[Math.max(p[i], p[i + 1], p[i + 2])]++;
    const total = hist.reduce((a, b) => a + b, 0); let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc < total * 0.02) lo = v; if (acc < total * 0.995) hi = v; }
    if (hi - lo > 20 && (lo > 8 || hi < 245)) {
      const k = 255 / (hi - lo);
      for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) p[i + j] = Math.max(0, Math.min(255, (p[i + j] - lo) * k));
      g.putImageData(d, 0, 0);
    }
    img.close();
    return c;
  }
  /** crop+scale, then binarise: dark text on white. mode: lum | max | min */
  function prep(src, { x = 0, y = 0, w = src.width, h = src.height, scale = 1, mode = "lum", thr = 175 }) {
    const c = document.createElement("canvas"); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const g = c.getContext("2d"); g.imageSmoothingQuality = "high";
    g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], gg = p[i + 1], b = p[i + 2];
      let v = mode === "max" ? Math.max(r, gg, b) : mode === "min" ? Math.min(r, gg, b) : mode === "green" ? gg : 0.299 * r + 0.587 * gg + 0.114 * b;
      if (mode !== "min" && mode !== "gray") v = Math.min(255, Math.max(0, (v - 128) * 1.7 + 128)); // contrast boost
      const o = mode === "gray" ? 255 - v : v > thr ? 0 : 255; p[i] = p[i + 1] = p[i + 2] = o; p[i + 3] = 255;
    }
    g.putImageData(d, 0, 0); return c;
  }

  async function words(canvas, params) {
    const w = await getWorker();
    await w.setParameters(Object.assign({ tessedit_pageseg_mode: "3", tessedit_char_whitelist: "" }, params || {}));
    const { data } = await w.recognize(canvas, {}, { blocks: true });
    const out = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) {
      const ws = l.words.map(x => ({ t: x.text, c: x.confidence, x0: x.bbox.x0, x1: x.bbox.x1, y0: x.bbox.y0, y1: x.bbox.y1 }));
      if (ws.length) out.push(ws);
    }
    return out; // array of lines, each an array of words
  }

  // ---------- fuzzy matching ----------
  const letters = s => String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);
  const confidence = ws => ws.length ? Math.min(...ws.map(w => Number.isFinite(w.c) ? Math.max(0,Math.min(100,w.c))/100 : 0)) : 0;
  const evidence = (value,source,metrics,resolved=true,extra={}) => ({value,source,metrics,resolved,...extra});
  const strength = h => h ? Math.min(h.s||0,h.c||0) : 0;
  const hitEvidence = (h,value=h?.slug,source="ocr") => evidence(value,source,{ocr:h?.c||0,match:h?.s||0},!!h&&!h.ambiguous);
  function bestMatch(token, dict, minLen) {
    let best = null, second = -1;
    for (const d of dict) {
      if (token.length < Math.min(minLen, d.key.length)) continue;
      const need = d.key.length <= 4 ? 1 : d.key.length <= 6 ? 0.8 : 0.75;
      const s = sim(token, d.key);
      if(s>=need) {
        if(!best||s>best.s) { if(best)second=Math.max(second,best.s);best={...d,s}; }
        else second=Math.max(second,s);
      }
    }
    return best ? {...best,ambiguous:best.s-second<.05} : null;
  }

  /** Find hero names in OCR lines: try windows of 1-3 consecutive words. */
  function findHeroes(lines, heroDict, scale) {
    const hits = [];
    for (const ws of lines) {
      for (let i = 0; i < ws.length; i++) for (let n = 1; n <= 3 && i + n <= ws.length; n++) {
        const seg = ws.slice(i, i + n).filter(w=>letters(w.t)), tok = letters(seg.map(w => w.t).join(""));
        if (tok.length < 3) continue;
        const m = bestMatch(tok, heroDict, 3);
        if (!m) continue;
        hits.push({ slug: m.slug, s: m.s, c:confidence(seg), ambiguous:m.ambiguous, len: tok.length,
          x0:seg[0].x0/scale,x1:seg[seg.length-1].x1/scale,
          x: (seg[0].x0 + seg[seg.length - 1].x1) / 2 / scale, y: (Math.min(...seg.map(w => w.y0)) + Math.max(...seg.map(w => w.y1))) / 2 / scale,
          h: (Math.max(...seg.map(w => w.y1)) - Math.min(...seg.map(w => w.y0))) / scale });
      }
    }
    return hits;
  }

  function findTokens(lines, dict, scale, offX = 0, offY = 0) {
    const hits = [];
    for (const ws of lines) for (const w of ws) {
      const tok = letters(w.t); if (tok.length < 3) continue;
      const m = bestMatch(tok, dict, 3);
      if (m) hits.push({ ...m, c:confidence([w]), x: offX + (w.x0 + w.x1) / 2 / scale, y: offY + (w.y0 + w.y1) / 2 / scale });
    }
    return hits;
  }

  // Once the player has marked the display corners, read each card's text band.
  // This avoids skin names, surrounding room lighting and unrelated UI text.
  async function alignedLoading(src,heroes,squad,onProgress) {
    const W=src.width,H=src.height,dict=heroes.map(h=>({slug:h.slug,key:letters(h.name)})),tags=squad.map(p=>({slug:p.key,key:letters(p.label)}));
    const teams={top:{},bottom:{}},votes={top:0,bottom:0},tagReads=[];let found=0;
    for(const [row,y] of [["top",.275],["bottom",.775]])for(let i=0;i<5;i++){
      onProgress("Reading individual hero cards…",.1+.8*found/10);
      const crop={x:W*(.315+.135*i),y:H*y,w:W*.13,h:H*.065,scale:4};
      let best=null;
      for(const mode of ["gray","green","max"]){
        const ls=await words(prep(src,{...crop,mode,thr:140}),{tessedit_pageseg_mode:"6"});
        const hits=findHeroes(ls,dict,4).sort((a,b)=>strength(b)-strength(a)||b.y-a.y);
        if(hits.length&&(!best||strength(hits[0])>strength(best)))best=hits[0];
        if(strength(best)>=.9&&!best.ambiguous)break;
      }
      const slot={readConfidence:{hero:hitEvidence(best)}};
      if(best&&best.s>=.8){slot.hero=best.slug;found++;}
      teams[row][ROLES[i]]=slot;
      const ls=await words(prep(src,{x:crop.x,y:H*(row==="top"?.34:.845),w:crop.w,h:H*.045,scale:4,mode:"gray"}),{tessedit_pageseg_mode:"6"});
      const hits=findTokens(ls,tags,4).sort((a,b)=>strength(b)-strength(a));
      if(hits.length){
        const hit=hits[0];slot.who=hit.slug;slot.readConfidence.who=hitEvidence(hit,hit.slug,"gamertag");
        votes[row]++;tagReads.push({...hit,row});
      }
    }
    const strong=tagReads.filter(t=>t.s===1&&t.c>=.9&&!t.ambiguous),tagRows=new Set(strong.map(t=>t.row));
    const oursRow=tagRows.size===1?strong[0].row:(votes.top>votes.bottom?"top":"bottom");
    const ours=teams[oursRow],theirs=teams[oursRow==="top"?"bottom":"top"],issues=[];
    for(const team of [ours,theirs]){
      const seen=new Set();
      for(const role of ROLES){const slot=team[role],h=slot?.hero;
        if(h&&seen.has(h)){slot.hero="";found--;}else if(h)seen.add(h);
        if(team===theirs){delete slot.who;delete slot.readConfidence.who;}
      }
    }
    // Rectification establishes display corners; lane labels establish the role order.
    const ls=await words(prep(src,{x:0,y:H*.36,w:W,h:H*.26,scale:2,mode:"min"}),{tessedit_pageseg_mode:"11"});
    const labels=findTokens(ls,ROLES.map(r=>({slug:r,key:r})),2).sort((a,b)=>strength(b)-strength(a));
    const selected=ROLES.map((role,i)=>labels.find(l=>l.slug===role&&Math.abs(l.x-W*(.38+.135*i))<W*.07));
    const layout=evidence("role-order","lane-labels",{
      ocr:Math.min(...selected.map(l=>l?.c||0)),match:Math.min(...selected.map(l=>l?.s||0))
    },selected.every(l=>l&&!l.ambiguous));
    const ownTeam=evidence(oursRow,"gamertag",{
      ocr:strong.length?Math.min(...strong.map(t=>t.c)):0,match:strong.length?1:0
    },tagRows.size===1);
    if(!ownTeam.resolved)issues.push("Couldn't identify your team unambiguously. Confirm which team is yours.");
    if(!layout.resolved)issues.push("Confirm the lane order.");
    if(found<10)issues.push(`${10-found} hero slots need confirmation.`);
    return {ours,theirs,issues,found,oursRow,readConfidence:{layout,ownTeam},method:"straightened card crops"};
  }

  // ---------- main ----------
  async function scan(file, heroes, squad, onProgress = () => {}) {
    const src = await toCanvas(file);
    if(file._screenAligned) return alignedLoading(src,heroes,squad,onProgress);
    const W = src.width, H = src.height;
    const scale = Math.max(1, 4000 / W);
    const heroDict = heroes.map(h => ({ slug: h.slug, key: letters(h.name) })).filter(d => d.key.length >= 3);
    const issues = [];

    onProgress("Reading hero names…", 0.15);
    const passA = await words(prep(src, { scale, mode: "lum", thr: 175 }));
    onProgress("Reading coloured names…", 0.45);
    const passB = await words(prep(src, { scale, mode: "max", thr: 175 }));
    let hits = [...findHeroes(passA, heroDict, scale), ...findHeroes(passB, heroDict, scale)];
    let passC = [];
    if (new Set(hits.filter(h=>strength(h)>=.9&&!h.ambiguous).map(h=>h.slug)).size < 10) {   // third pass only if something is still missing
      onProgress("Taking a closer look…", 0.6);
      passC = await words(prep(src, { scale, mode: "lum", thr: 175 }), { tessedit_pageseg_mode: "11" }); // sparse text: copes with glare/odd layouts
      hits.push(...findHeroes(passC, heroDict, scale));
      if (new Set(hits.filter(h=>strength(h)>=.9&&!h.ambiguous).map(h=>h.slug)).size < 10) {
        onProgress("One more pass…", 0.68);
        const passD = await words(prep(src, { scale, mode: "max", thr: 140 }), { tessedit_pageseg_mode: "11" });
        hits.push(...findHeroes(passD, heroDict, scale));
        passC = passC.concat(passD);
      }
    }

    if (new Set(hits.filter(h=>strength(h)>=.9&&!h.ambiguous).map(h=>h.slug)).size < 10) {
      onProgress("Reading dim text…", 0.7);
      const passE = await words(prep(src, {scale, mode:"gray"}), {tessedit_pageseg_mode:"11"});
      const passF = await words(prep(src, {scale, mode:"green",thr:130}), {tessedit_pageseg_mode:"11"});
      hits.push(...findHeroes(passE,heroDict,scale),...findHeroes(passF,heroDict,scale));
      passC=passC.concat(passE,passF);
    }
    // keep the best hit per place on screen
    hits.sort((a, b) => strength(b)-strength(a) || b.len - a.len);
    const cand = [];
    for (const h of hits) if (!cand.some(c => Math.abs(c.x - h.x) < W * 0.05 && Math.abs(c.y - h.y) < H * 0.05)) cand.push(h);
    if (cand.length < 4) return { ours: {}, theirs: {}, issues: ["Couldn't find hero names. Try a straighter, closer photo of the loading screen."], found: cand.length };

    // two rows by the biggest vertical gap
    const ys = cand.map(c => c.y).sort((a, b) => a - b);
    let gi = 0, gap = 0; for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > gap) { gap = ys[i] - ys[i - 1]; gi = i; }
    const splitY = (ys[gi - 1] + ys[gi]) / 2;
    const rowOf = c => (c.y < splitY ? "top" : "bottom");
    const topY = median(cand.filter(c => rowOf(c) === "top").map(c => c.y));
    const botY = median(cand.filter(c => rowOf(c) === "bottom").map(c => c.y));

    // lane labels sit between the rows, just under the top cards
    onProgress("Reading lane labels…", 0.75);
    const band = { x: 0, y: Math.round(topY + (botY - topY) * 0.08), w: W, h: Math.round((botY - topY) * 0.42) };
    const roleDict = ROLES.map(r => ({ slug: r, key: r }));
    const labelLines = await words(prep(src, { ...band, scale: 1.5, mode: "min", thr: 215 }), { tessedit_pageseg_mode: "11", tessedit_char_whitelist: "ACDEFGIJLMNOPRSUYK " });
    const labels = [];
    for (const l of findTokens(labelLines, roleDict, 1.5, band.x, band.y).sort((a, b) => strength(b)-strength(a))) if (!labels.some(x => x.slug === l.slug)) labels.push(l);

    // column x positions: from labels if possible, else from the heroes themselves
    let colX = null, order = null;
    if (labels.length >= 2) {
      const byX = labels.slice().sort((a, b) => a.x - b.x);
      const asc = ROLES.indexOf(byX[byX.length - 1].slug) > ROLES.indexOf(byX[0].slug); // OFF..CAR left->right?
      order = asc ? ROLES.slice() : ROLES.slice().reverse();
      // fit x = a + b*index through the labels we found
      const pts = labels.map(l => [order.indexOf(l.slug), l.x]);
      const n = pts.length, sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
      const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
      const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), a = (sy - b * sx) / n;
      colX = order.map((_, i) => a + b * i);
    } else {
      issues.push("Couldn't read the lane labels — check each lane below.");
      const xs = cand.map(c => c.x).sort((a, b) => a - b);
      const lo = xs[0], hi = xs[xs.length - 1];
      colX = [0, 1, 2, 3, 4].map(i => lo + (hi - lo) * i / 4);
      order = ROLES.slice(); // guess; flagged above
    }
    const colOf = x => { let bi = 0; colX.forEach((cx, i) => { if (Math.abs(cx - x) < Math.abs(colX[bi] - x)) bi = i; }); return bi; };

    // assign: one hero per (row, column); prefer the lower line on the card (hero name sits under the skin name)
    const grid = { top: {}, bottom: {} };
    for (const c of cand) {
      const r = rowOf(c), i = colOf(c.x), cur = grid[r][i];
      if (!cur || strength(c)>strength(cur)+.05 || (Math.abs(strength(c)-strength(cur))<=.05 && c.y>cur.y)) grid[r][i]=c;
    }

    // which row is ours: look for squad gamertags under each row
    const squadDict = squad.map(p => ({ slug: p.key, key: letters(p.label) }));
    const tagHits = [...findTokens(passA, squadDict, scale), ...findTokens(passB, squadDict, scale), ...findTokens(passC, squadDict, scale)];
    const strongTags=tagHits.filter(t=>t.s===1&&t.c>=.9&&!t.ambiguous),tagRows=new Set(strongTags.map(rowOf));
    let oursRow=tagRows.size===1?rowOf(strongTags[0]):null; const who={},whoRead={};
    for (const t of tagHits.sort((a,b)=>strength(b)-strength(a))) {
      const r = t.y < splitY ? "top" : "bottom";
      oursRow ||= r;
      if (r === oursRow && !who[t.slug]) {who[t.slug]=order[colOf(t.x)];whoRead[t.slug]=hitEvidence(t,t.slug,"gamertag");}
    }
    if (!oursRow) { oursRow = "bottom"; issues.push("Couldn't spot your gamertags — assumed your team is the bottom row."); }
    const theirRow = oursRow === "top" ? "bottom" : "top";

    const ours = {}, theirs = {};
    order.forEach((role, i) => {
      if (grid[oursRow][i]) ours[role] = {hero:grid[oursRow][i].slug,readConfidence:{hero:hitEvidence(grid[oursRow][i])}};
      if (grid[theirRow][i]) theirs[role] = {hero:grid[theirRow][i].slug,readConfidence:{hero:hitEvidence(grid[theirRow][i])}};
    });
    for(const [key,role] of Object.entries(who)){const slot=ours[role]||={readConfidence:{}};slot.who=key;slot.readConfidence.who=whoRead[key];}
    for (const team of [ours, theirs]) {
      const seen = new Map();
      for (const role of ROLES) if (team[role]?.hero) {
        const hero = team[role].hero;
        if (seen.has(hero)) { team[role].hero = ""; issues.push(`Duplicate ${hero} read: check ${role.toLowerCase()}.`); }
        else seen.set(hero,role);
      }
    }
    const missing = 10 - Object.keys(ours).filter(r => ours[r].hero).length - Object.keys(theirs).filter(r => theirs[r].hero).length;
    if (missing > 0) issues.push(`${missing} hero${missing > 1 ? "es" : ""} not read — pick ${missing > 1 ? "them" : "it"} below.`);
    onProgress("Done", 1);
    const step=Math.abs(colX[1]-colX[0])||1;
    const residual=labels.length?Math.max(...labels.map(l=>Math.abs(l.x-colX[order.indexOf(l.slug)])))/step:1;
    const sortedLabels=labels.slice().sort((a,b)=>a.x-b.x);
    const layout=evidence("role-order","lane-labels",{
      ocr:labels.length?Math.min(...labels.map(l=>l.c)):0,
      match:labels.length?Math.max(0,Math.min(1-residual,...labels.map(l=>l.s))):0
    },labels.length===5&&order.every((r,i)=>sortedLabels[i].slug===r)&&labels.every(l=>!l.ambiguous)&&residual<=.1);
    const ownTeam=evidence(oursRow,"gamertag",{
      ocr:strongTags.length?Math.min(...strongTags.map(t=>t.c)):0,match:strongTags.length?1:0
    },tagRows.size===1&&rowOf(strongTags[0])===oursRow);
    if(!ownTeam.resolved&&!issues.some(s=>s.includes("gamertag")))issues.push("Confirm which team is yours.");
    return {ours,theirs,issues,found:cand.length,labels:labels.map(l=>l.slug),oursRow,readConfidence:{layout,ownTeam}};
  }

  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

  root.LoadingScan = { scan, _lev: lev };
  // shared with the in-match scoreboard scanner
  root.ScanKit = {toCanvas,prep,words,lev,getWorker,findHeroes,findTokens,evidence,hitEvidence,strength,confidence};
})(typeof window !== "undefined" ? window : globalThis);
