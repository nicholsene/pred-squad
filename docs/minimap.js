/* Assisted minimap timer OCR. Player selects the timer crop and confirms its objective.
   An absent icon never becomes an invented kill time. Images remain on this device. */
(function(root) {
  "use strict";
  function candidates(lines) {
    const out = [];
    for (const line of lines) {
      const text = line.map(w => w.t).join(" ");
      for (const m of text.matchAll(/\b(\d{1,2})\s*[:.]\s*([0-5]\d)\b/g)) {
        const seconds = +m[1] * 60 + +m[2];
        if (seconds <= 1200 && !out.some(x => x.seconds === seconds)) out.push({ seconds, text: `${m[1]}:${m[2]}`, confidence: Math.min(...line.map(w => w.c || 0)) });
      }
      const t=text.trim().replace(/\s+/g,"");
      if (/^\d{1,3}$/.test(t) && +t <= 1200) out.push({seconds:+t,text:`${Math.floor(+t/60)}:${String(+t%60).padStart(2,"0")}`,confidence:Math.min(...line.map(w=>w.c||0))});
      const approximate=t.match(/^(\d{1,2})m\+$/i);
      if(approximate)out.push({seconds:null,minSeconds:+approximate[1]*60,text:t,estimated:true,confidence:Math.min(...line.map(w=>w.c||0))});
    }
    return out;
  }
  async function scan(file, crop) {
    const K = root.ScanKit, src = await K.toCanvas(file);
    const x = Math.max(0, Math.min(1, crop.x)), y = Math.max(0, Math.min(1, crop.y));
    const w = Math.min(1-x, crop.w), h = Math.min(1-y, crop.h);
    if (!(w > 0 && h > 0)) throw new Error("Drag a box around one objective countdown.");
    const image = K.prep(src, { x: x*src.width, y:y*src.height, w:w*src.width, h:h*src.height, scale: Math.min(8, 800/(w*src.width)), mode:"max", thr:150 });
    return candidates(await K.words(image, { tessedit_pageseg_mode:"6", tessedit_char_whitelist:"0123456789:.mM+ " }));
  }
  root.MinimapScan = { scan, candidates };
  if (typeof module !== "undefined") module.exports = root.MinimapScan;
})(typeof window !== "undefined" ? window : globalThis);
