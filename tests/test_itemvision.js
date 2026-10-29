const assert=require("node:assert/strict"),V=require("../docs/itemvision.js");
function icon(a,b){const data=new Uint8ClampedArray(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const c=((x>>2)+(y>>2))%2?a:b;data.set([...c,255],(y*32+x)*4);}return{width:32,height:32,data};}
const red=icon([230,40,40],[30,5,5]),blue=icon([40,40,230],[5,5,30]),refs={patch:"1.17.2",templates:[{name:"Red",descriptor:V.descriptor(red)},{name:"Blue",descriptor:V.descriptor(blue)}]};
assert.equal(V.match(red,refs).name,"Red");assert.equal(V.match(red,refs).confirmed,false);assert.equal(V.match(red,refs).confidence,1);
assert.equal(V.match(red,{templates:[]}).reason,"no_templates");assert.equal(V.match(red,{templates:[{name:"a",descriptor:V.descriptor(red)},{name:"b",descriptor:V.descriptor(red)}]}).reason,"ambiguous");
assert.equal(V.match(icon([5,5,5],[5,5,5]),refs).reason,"low_detail");assert.equal(V.match(red,refs,{patch:"1.18.0"}).reason,"template_patch_mismatch");assert.equal(V.match(red,refs,{allowedNames:["other"]}).reason,"no_valid_templates");assert.equal(V.match(null,refs).reason,"invalid_crop");assert.equal(V.match(red,{templates:[{name:"bad",descriptor:[NaN]}]}).reason,"no_valid_templates");assert.equal(V.match(red,[{name:"blue",descriptor:V.descriptor(blue)}]).name,null);
const packed=Buffer.from(V.descriptor(red).values.map(x=>Math.round(x*255))).toString("base64");assert.equal(V.match(red,{templates:[{name:"packed",descriptor:{values:packed}}]}).name,"packed");
console.log("ok: item icon suggestions, packed templates, ambiguity, low detail and patch mismatch");
