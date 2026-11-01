const assert=require("node:assert/strict"),V=require("../docs/itemvision.js");
function icon(a,b){const data=new Uint8ClampedArray(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const c=((x>>2)+(y>>2))%2?a:b;data.set([...c,255],(y*32+x)*4);}return{width:32,height:32,data};}
const red=icon([230,40,40],[30,5,5]),blue=icon([40,40,230],[5,5,30]),refs={patch:"1.17.2",templates:[{name:"Red",descriptor:V.descriptor(red)},{name:"Blue",descriptor:V.descriptor(blue)}]};
assert.equal(V.match(red,refs).name,"Red");assert.equal(V.match(red,refs).confirmed,false);assert.equal(V.match(red,refs).confidence,1);
assert.equal(V.match(red,{templates:[]}).reason,"no_templates");assert.equal(V.match(red,{templates:[{name:"a",descriptor:V.descriptor(red)},{name:"b",descriptor:V.descriptor(red)}]}).reason,"ambiguous");
assert.equal(V.match(icon([5,5,5],[5,5,5]),refs).reason,"low_detail");assert.equal(V.match(red,refs,{patch:"1.18.0"}).reason,"template_patch_mismatch");assert.equal(V.match(red,refs,{allowedNames:["other"]}).reason,"no_valid_templates");assert.equal(V.match(null,refs).reason,"invalid_crop");assert.equal(V.match(red,{templates:[{name:"bad",descriptor:[NaN]}]}).reason,"no_valid_templates");assert.equal(V.match(red,[{name:"blue",descriptor:V.descriptor(blue)}]).name,null);
const packed=Buffer.from(V.descriptor(red).values.map(x=>Math.round(x*255))).toString("base64");assert.equal(V.match(red,{templates:[{name:"packed",descriptor:{values:packed}}]}).name,"packed");
console.log("ok: item icon suggestions, packed templates, ambiguity, low detail and patch mismatch");

// Row matcher: brightness/colour-cast changes and a misaligned row must still resolve to the right items.
{
  const V = require("../docs/itemvision.js");
  const G = V.GRID, icons = [];
  // eight synthetic "icons": distinct 8x8 colour patterns
  for (let t = 0; t < 8; t++) { const v = new Float32Array(G * G * 3); for (let k = 0; k < G * G; k++) { const x = k % G, y = Math.floor(k / G); v[k * 3] = .5 + .4 * Math.sin((x + t) * 0.9); v[k * 3 + 1] = .5 + .4 * Math.cos((y * (t + 1)) * 0.7); v[k * 3 + 2] = .5 + .4 * Math.sin((x * y + t * 3) * 0.5); } icons.push({ name: "item" + t, values: Array.from(v) }); }
  const u = 80, size = Math.round(.38 * u), step = Math.round(.45 * u), W = 6 * step + 2 * u, H = u;
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const want = ["item3", "item0", "item6", "item1", "item5", "item2"], shift = { x: 9, y: 6 };
  for (let i = 0; i < 6; i++) {
    const v = icons[+want[i].slice(4)].values, cx = u + i * step + shift.x, cy = H / 2 + shift.y, x0 = cx - size / 2, y0 = cy - size / 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size - .12) / .76, fy = (y / size - .12) / .76; if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) continue;
      const k = Math.floor(fy * G) * G + Math.floor(fx * G), o = ((Math.round(y0) + y) * W + Math.round(x0) + x) * 4;
      // photo of a TV: darker, warmer, lower contrast
      img.data[o] = 255 * (.15 + .6 * v[k * 3]); img.data[o + 1] = 255 * (.1 + .5 * v[k * 3 + 1]); img.data[o + 2] = 255 * (.05 + .45 * v[k * 3 + 2]); img.data[o + 3] = 255;
    }
  }
  const slots = Array.from({ length: 6 }, (_, i) => ({ x: u + i * step, y: H / 2 }));
  const res = V.matchRow(img, { templates: icons }, { slots, size, u });
  assert.deepEqual(res.slots.map(s => s.name), want, "every slot matched despite colour cast and offset");
  assert.ok(Math.abs(res.offset.dx * u - shift.x) <= 3 && Math.abs(res.offset.dy * u - shift.y) <= 3, "row alignment recovered");
  const blank = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(20) };
  assert.ok(V.matchRow(blank, { templates: icons }, { slots, size, u }).slots.every(s => s.name === null), "flat/empty slots are never named");
  console.log("ok: row matcher handles colour cast, offset and empty slots");
}
