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
  const GOLD = /(\d{1,2})[,.](\d{3})/;
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
  function classify(img, T, allowed = "0123456789") {
    let best = ["?", -2]; for (const ch of allowed) { const s = score(img, T[ch]); if (s > best[1]) best = [ch, s]; }
    return best;
  }
  /** read one number; a too-wide blob is tried as two touching digits (e.g. "11") */
  function readDigits(bl, T) {
    let s = "";
    for (const b of bl) {
      const [ch, sc] = classify(b.img, T);
      if (b.w > 0.75 * b.h && sc < 0.75) { s += "11"; continue; }
      s += ch;
    }
    return s;
  }
  function group3(bl, u) {
    if (bl.length < 3) return null;
    const gaps = [...Array(bl.length - 1).keys()].map(i => i + 1).sort((a, b) => (bl[b].x - bl[b - 1].x) - (bl[a].x - bl[a - 1].x)).slice(0, 2);
    if (Math.min(...gaps.map(i => bl[i].x - bl[i - 1].x)) < 0.12 * u) return null;
    const [a, b] = gaps.sort((p, q) => p - q);
    return [bl.slice(0, a), bl.slice(a, b), bl.slice(b)];
  }

  /* ---------- OCR helpers (shared Tesseract worker from scan.js) ---------- */
  async function ocrBox(src, f, box, params, up = 2, thr = 175, mode = "max") {
    const K = root.ScanKit;
    const c = K.prep(src, { x: box[0] / (2 * f), y: box[1] / (2 * f), w: (box[2] - box[0]) / (2 * f), h: (box[3] - box[1]) / (2 * f), scale: 2 * f * up, mode, thr });
    const lines = await K.words(c, params);
    return lines.map(l => l.map(w => w.t).join(" ")).join(" ").trim();
  }
  async function anchors(src, f) {
    const K = root.ScanKit, out = [];
    for (const thr of [175, 140]) {
      const c = K.prep(src, { scale: f, mode: "max", thr });
      for (const line of await K.words(c, { tessedit_pageseg_mode: "11" }))
        for (const w of line) {
          if (!GOLD.test(w.t) || w.t.length > 9) continue;
          const x = (w.x0 + w.x1), y = (w.y0 + w.y1);       // page coords (2x)
          if (!out.some(o => Math.abs(o.x - x) < 40 && Math.abs(o.y - y) < 40)) out.push({ t: w.t, x, y });
        }
      const W = c.width * 2, L = out.filter(o => o.x < W / 2).length;
      if (L >= 2 && out.length - L >= 2) break;            // good enough, skip the second pass
    }
    return out;
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

  /* ---------- main ---------- */
  async function scan(file, opts = {}) {
    const { heroes = [], known = {}, onProgress = () => {} } = opts;
    if (file._originalSource && !opts._singlePass) {
      onProgress("Comparing original and straightened reads…", .02);
      const original = await scan(file._originalSource, {...opts,_singlePass:true});
      const corrected = await scan(file, {...opts,_singlePass:true});
      let disagreements=0;
      for (const side of ["ours","theirs"]) for (let i=0;i<5;i++) {
        const raw=original[side]?.[i]||{}, row=corrected[side]?.[i]; if(!row)continue;
        if(!row.hero)row.hero=raw.hero||null;
        row.alternatives={};
        for(const key of ["lvl","k","d","a","gold"]) {
          if(raw[key]!=null && row[key]!=null && raw[key]!==row[key]) { row.alternatives[key]=[raw[key],row[key]]; disagreements++; }
          // Keep the established original-photo digit path; corrected crops fill blanks.
          if(raw[key]!=null)row[key]=raw[key];
        }
      }
      corrected.issues = disagreements ? [`${disagreements} number reads disagree between views. Check the highlighted fields.`] : corrected.issues;
      corrected.method="original digits with straightened hero/crop fallback";
      return corrected;
    }
    const K = root.ScanKit, T = await templates();
    onProgress("Reading the scoreboard…", 0.05);
    const src = await K.toCanvas(file), f = BASE_W / src.width;
    const W = 2 * BASE_W, H = 2 * src.height * f, issues = [];
    const aligned = !!file._screenAligned;
    const golds = aligned ? [] : (await anchors(src, f)).filter(g => g.y > H * 0.15);
    onProgress("Finding rows…", 0.35);
    const sides = {};
    for (const [side, sel] of [["L", g => g.x < W / 2], ["R", g => g.x >= W / 2]]) {
      let gs = golds.filter(sel);
      if (gs.length) { const mx = median(gs.map(g => g.x)); gs = gs.filter(g => Math.abs(g.x - mx) < W * 0.04); }
      sides[side] = gs.sort((a, b) => a.y - b.y);
    }
    if (!aligned && !sides.L.length && !sides.R.length) return { ours: [], theirs: [], issues: ["Couldn't find the scoreboard. Take the photo straight on with the whole board in frame."] };
    const u = aligned ? H * .135 : fitDy(Object.values(sides).filter(s => s.length >= 2).map(s => s.map(g => g.y)), H) || H * 0.11;
    const tops = aligned ? { L:{y0:H*.32,x0:W*.417,dx:0,span:4,off:0},R:{y0:H*.32,x0:W*.58,dx:0,span:4,off:0} } : {};
    for (const [side, gs] of Object.entries(sides)) {
      if (!gs.length) continue;
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
    const heroDict = heroes.map(h => ({ slug: h.slug, key: h.name.toUpperCase().replace(/[^A-Z]/g, "") }));
    const result = { L: [], R: [] };
    for (const side of ["L", "R"]) {
      const t = tops[side] || (() => { const o = tops[side === "L" ? "R" : "L"]; return { y0: o.y0 - o.off * u, x0: side === "L" ? W - o.x0 : W - o.x0, dx: -o.dx, span: 0, off: 0 }; })();
      for (let i = 0; i < 5; i++) {
        let gy = t.y0 + (i - t.off) * u, gx = t.x0 + (i - t.off) * t.dx; const role = ROLES[i];
        const row = { role, hero: (known[side] || [])[i] || null, lvl: null, k: null, d: null, a: null, gold: null };
        // K / D / A
        const kb = blobs(grab(src, f, [gx - 0.42 * u, gy - 0.6 * u, gx + 0.42 * u, gy - 0.38 * u], "max"), 0.35, 0.95);
        const g3 = group3(kb, u);
        if (g3) {
          const n = g3.map(g => parseInt(readDigits(g, T), 10)); [row.k, row.d, row.a] = n.map(x => isNaN(x) || x > 60 ? null : x);
          // re-centre the row on the D column: more precise than the OCR'd gold box
          const mid = g3[1], cx = mid.reduce((s, b) => s + b.x, 0) / mid.length, cy = kb.reduce((s, b) => s + b.y, 0) / kb.length;
          if (Math.abs(cx - gx) < 0.3 * u) gx = cx;
          if (Math.abs(cy + 0.49 * u - gy) < 0.15 * u) gy = cy + 0.49 * u;
        }
        // level, inside the circle by the name
        const lc = side === "L" ? [gx - 3.59 * u, gy - 0.5 * u] : [gx + 1.18 * u, gy - 0.53 * u];
        const win = grab(src, f, [lc[0] - 0.19 * u, lc[1] - 0.17 * u, lc[0] + 0.19 * u, lc[1] + 0.17 * u], "min");
        const cand = blobs(win, 0.06 * u / win.h, 0.17 * u / win.h, 90).filter(b => b.w < 0.12 * u);
        if (opts.debug) row._lv = cand.map(b => `${((b.x - lc[0]) / u).toFixed(2)},${((b.y - lc[1]) / u).toFixed(2)} h${(b.h / u).toFixed(2)} w${(b.w / u).toFixed(2)}`);
        if (cand.length) {
          const first = cand.reduce((a, b) => Math.abs(b.x - lc[0]) < Math.abs(a.x - lc[0]) ? b : a);
          let grp = cand.filter(b => Math.abs(b.x - first.x) < 0.13 * u && Math.abs(b.h - first.h) < 0.35 * first.h);
          grp = grp.sort((a, b) => Math.abs(a.x - first.x) - Math.abs(b.x - first.x)).slice(0, 2).sort((a, b) => a.x - b.x);
          const lv = grp.length === 2 ? parseInt("1" + classify(grp[1].img, T, "012345678")[0], 10) : parseInt(classify(grp[0].img, T, "123456789")[0], 10);
          if (lv >= 1 && lv <= 18) row.lvl = lv;
        }
        // gold
        const near = sides[side].find(g => Math.abs(g.y - gy) < 0.3 * u);
        let m = near && GOLD.exec(near.t);
        if (!m) m = GOLD.exec(await ocrBox(src, f, [gx - 0.45 * u, gy - 0.11 * u, gx + 0.45 * u, gy + 0.11 * u], { tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789,g" }));
        if (!m && aligned) m = GOLD.exec(await ocrBox(src,f,[gx-.5*u,gy-.14*u,gx+.5*u,gy+.14*u],{tessedit_pageseg_mode:"7",tessedit_char_whitelist:"0123456789,g"},3,140,"gray"));
        if (m) row.gold = parseInt(m[1] + m[2], 10);
        // hero name, only if the lineup isn't known
        if (!row.hero && heroDict.length) {
          const hb = side === "L" ? [gx - 3.45 * u, gy - 0.56 * u, gx - 1.5 * u, gy - 0.31 * u] : [gx + 1.38 * u, gy - 0.56 * u, gx + 3.5 * u, gy - 0.31 * u];
          const read = async (box, psm, thr) => (await ocrBox(src, f, box, { tessedit_pageseg_mode: psm, tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ.& " }, 2, thr)).toUpperCase().replace(/[^A-Z]/g, "");
          const match = txt => {
            let best = null;
            for (const h of heroDict) {
              const L = h.key.length, lim = L <= 3 ? 0 : L <= 5 ? 1 : 2;
              for (let n = Math.max(1, L - 1); n <= L + 1; n++) for (let i = 0; i + n <= txt.length; i++) {
                const d = K.lev(txt.slice(i, i + n), h.key);
                if (d <= lim && (!best || d < best[0] || (d === best[0] && L > best[2]))) best = [d, h.slug, L];
              }
            }
            return best;
          };
          let txt = await read(hb, "7", 175), best = match(txt);
          if (!best) { txt = await read([hb[0], gy - 0.62 * u, hb[2], gy - 0.26 * u], "6", 175); best = match(txt); }
          if (!best) { txt = await read(hb, "7", 140); best = match(txt); }
          if (!best) {
            txt = (await ocrBox(src,f,hb,{tessedit_pageseg_mode:"7",tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZ.& "},3,140,"gray")).toUpperCase().replace(/[^A-Z]/g, "");
            best = match(txt);
          }
          if (opts.debug) row._hero = txt;
          if (best) row.hero = best[1];
        }
        result[side].push(row);
        onProgress("Reading numbers…", 0.6 + 0.4 * (result.L.length + result.R.length) / 10);
      }
    }
    const missing = [...result.L, ...result.R].filter(r => r.k == null || r.gold == null).length;
    if (missing) issues.push(`${missing} row${missing === 1 ? "" : "s"} only partly read — check the numbers.`);
    onProgress("Done", 1);
    return { ours: result.L, theirs: result.R, issues, rowHeight: u };
  }

  root.ScoreboardScan = { scan };
})(typeof window !== "undefined" ? window : globalThis);
