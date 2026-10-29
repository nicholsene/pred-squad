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
    }
    return out;
  }
  async function scan(file, crop) {
    const K = root.ScanKit, src = await K.toCanvas(file);
    const x = Math.max(0, Math.min(1, crop.x)), y = Math.max(0, Math.min(1, crop.y));
    const w = Math.min(1-x, crop.w), h = Math.min(1-y, crop.h);
    if (!(w > 0 && h > 0)) throw new Error("Drag a box around one objective countdown.");
    const image = K.prep(src, { x: x*src.width, y:y*src.height, w:w*src.width, h:h*src.height, scale: Math.min(8, 800/(w*src.width)), mode:"max", thr:150 });
    return candidates(await K.words(image, { tessedit_pageseg_mode:"6", tessedit_char_whitelist:"0123456789:. " }));
  }
  root.MinimapScan = { scan, candidates };
  if (typeof module !== "undefined") module.exports = root.MinimapScan;
})(typeof window !== "undefined" ? window : globalThis);
