/* Conservative on-device canonical icon suggestions. Similarity is not probability. */
(function(root){"use strict";const GRID=8,clamp=x=>Math.max(0,Math.min(1,x));
 function descriptor(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<4||image.height<4||!image.data||image.data.length<image.width*image.height*4)return null;
  const values=[];let sum=0,sum2=0,count=0;const inset=.12;
  for(let gy=0;gy<GRID;gy++)for(let gx=0;gx<GRID;gx++){
   const x0=Math.floor(image.width*(inset+(1-2*inset)*gx/GRID)),x1=Math.max(x0+1,Math.ceil(image.width*(inset+(1-2*inset)*(gx+1)/GRID))),y0=Math.floor(image.height*(inset+(1-2*inset)*gy/GRID)),y1=Math.max(y0+1,Math.ceil(image.height*(inset+(1-2*inset)*(gy+1)/GRID)));
   let r=0,g=0,b=0,n=0;for(let y=y0;y<Math.min(image.height,y1);y++)for(let x=x0;x<Math.min(image.width,x1);x++){const i=(y*image.width+x)*4,a=image.data[i+3]/255;r+=image.data[i]*a/255;g+=image.data[i+1]*a/255;b+=image.data[i+2]*a/255;n++;}
   if(!n)return null;r/=n;g/=n;b/=n;values.push(r,g,b);const lum=.299*r+.587*g+.114*b;sum+=lum;sum2+=lum*lum;count++;
  }return{values,contrast:Math.sqrt(Math.max(0,sum2/count-(sum/count)**2)),meanLuma:sum/count,grid:GRID};
 }
 function vector(d){if(Array.isArray(d)||ArrayBuffer.isView(d))return d;if(typeof d?.values==="string"){try{return Float32Array.from(atob(d.values),c=>c.charCodeAt(0)/255);}catch{return null;}}return d?.values;}
 function distance(a,b){a=vector(a);b=vector(b);if(!a||!b||a.length!==GRID*GRID*3||b.length!==a.length||Array.from(b).some(x=>!Number.isFinite(x)||x<0||x>1))return Infinity;let total=0;for(let i=0;i<a.length;i++)total+=(a[i]-b[i])**2;return Math.sqrt(total/a.length);}
 function match(image,catalog,options={}){
  const templates=Array.isArray(catalog)?catalog:catalog?.templates||[],unknown=reason=>({name:null,confidence:0,alternatives:[],reason,confirmed:false}),d=descriptor(image);
  if(!d)return unknown("invalid_crop");if(!templates.length)return unknown("no_templates");if(d.contrast<(options.minContrast??.018))return unknown("low_detail");if(options.patch&&catalog?.patch&&options.patch!==catalog.patch)return unknown("template_patch_mismatch");
  const allowed=options.allowedNames?new Set(options.allowedNames):null,byName=new Map();
  for(const t of templates){if(!t||typeof t.name!=="string"||!t.name||allowed&&!allowed.has(t.name))continue;const variants=t.variants||[t.descriptor||t.values],score=Math.min(...variants.map(v=>distance(d,v)));if(Number.isFinite(score)&&(!byName.has(t.name)||score<byName.get(t.name)))byName.set(t.name,score);}
  const ranked=[...byName].map(([name,distance])=>({name,distance})).sort((a,b)=>a.distance-b.distance||a.name.localeCompare(b.name));if(!ranked.length)return unknown("no_valid_templates");
  const maxDistance=options.maxDistance??.14,minMargin=options.minMargin??.035,best=ranked[0],margin=ranked.length>1?ranked[1].distance-best.distance:Infinity,alternatives=ranked.slice(0,3).map(x=>({name:x.name,similarity:clamp(1-x.distance/maxDistance),distance:x.distance}));
  if(best.distance>maxDistance)return{...unknown("low_similarity"),alternatives};if(margin<minMargin)return{...unknown("ambiguous"),alternatives};return{name:best.name,confidence:clamp(1-best.distance/maxDistance),alternatives,reason:"visual_suggestion",confirmed:false,margin};
 }
 const api={descriptor,describe:descriptor,match,distance,GRID};root.ItemVision=api;if(typeof module!=="undefined")module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
