// Item-slot benchmark for the main scan path (PaddleOCR rows -> ItemVision.readBoard).
// Photos stay private: point ITEM_PHOTOS at a folder of <id>.jpg files and ITEM_TRUTH at a JSON file:
//   { "<id>": { "rows": { "L": [{ "items": ["ItemName", ...] }, x5], "R": [ ...x5 ] } } }
// (rows in lane order, L = your team; items = that player's final passive items from pred.gg when the photo is an
// end-of-match screen). Serve docs/ on PORT (default 8790) first: python3 -m http.server -d docs 8790
// Usage: ITEM_PHOTOS=dir ITEM_TRUTH=truth.json node scripts/benchmark_items.cjs
const fs = require('node:fs'), path = require('node:path'), pw = require('playwright');
(async () => {
  const dir = process.env.ITEM_PHOTOS, truth = JSON.parse(fs.readFileSync(process.env.ITEM_TRUTH, 'utf8')), port = process.env.PORT || 8790;
  const b = await pw.chromium.launch({ headless: true }), p = await (await b.newContext({ serviceWorkers: 'block' })).newPage();
  await p.goto(`http://localhost:${port}/index.html`); await p.waitForFunction(() => window.__app && window.FreeOCR && window.__app.itemTemplates, null, { timeout: 60000 });
  const t = { slots: 0, named: 0, correct: 0, top3: 0, truthItems: 0, found: 0 };
  for (const id of Object.keys(truth)) {
    const b64 = fs.readFileSync(path.join(dir, id + '.jpg')).toString('base64');
    const r = await p.evaluate(async (b64) => {
      const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], 'x.jpg', { type: 'image/jpeg' }), A = window.__app;
      const ocr = await window.FreeOCR.read(file, {}), prep = window.FreeScan.prepareBoard(ocr, { heroes: A.heroes, squad: A.squad.players });
      const inv = await window.ItemVision.readBoard(file, prep.geometry, { catalog: A.itemTemplates, allowedNames: A.items.filter(i => i.slot === 'PASSIVE').map(i => i.name), imageWidth: ocr.image.width });
      const pick = rows => (rows || []).map(x => x ? x.itemCandidates.map(c => ({ n: c.name, alt: (c.alternatives || []).map(a => a.name) })) : null);
      return { L: pick(inv && inv.ours), R: pick(inv && inv.theirs) };
    }, b64);
    for (const side of ['L', 'R']) (truth[id].rows[side] || []).forEach((tr, i) => {
      if (!tr || !tr.items) return; const set = new Set(tr.items), found = new Set(), row = r[side] && r[side][i]; t.truthItems += set.size;
      if (!row) { t.slots += 6; return; }
      for (const c of row) { t.slots++; if (c.n) { t.named++; if (set.has(c.n)) { t.correct++; found.add(c.n); } } if (c.alt.some(a => set.has(a))) t.top3++; }
      t.found += found.size;
    });
  }
  console.log(`named ${t.named}/${t.slots} slots, ${t.correct} correct (${Math.round(100 * t.correct / Math.max(1, t.named))}%); true items found ${t.found}/${t.truthItems}; top-3 has a true item ${t.top3}/${t.slots}`);
  await b.close();
})();
