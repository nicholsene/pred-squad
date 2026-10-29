/* Four-corner perspective correction for photos of a display. No uploads or fixed photo coordinates. */
(function(root){
 "use strict";
 function mapping(points){
   if(points.length!==4||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error("Select all four screen corners.");
   const dest=[[0,0],[1,0],[1,1],[0,1]],a=[];
   dest.forEach(([u,v],i)=>{const{x,y}=points[i];a.push([u,v,1,0,0,0,-x*u,-x*v,x]);a.push([0,0,0,u,v,1,-y*u,-y*v,y]);});
   for(let c=0;c<8;c++){
     let pivot=c;for(let i=c+1;i<8;i++)if(Math.abs(a[i][c])>Math.abs(a[pivot][c]))pivot=i;
     if(Math.abs(a[pivot][c])<1e-9)throw new Error("Corners overlap. Select top left, top right, bottom right, bottom left.");
     [a[c],a[pivot]]=[a[pivot],a[c]];const d=a[c][c];for(let j=c;j<9;j++)a[c][j]/=d;
     for(let i=0;i<8;i++)if(i!==c){const k=a[i][c];for(let j=c;j<9;j++)a[i][j]-=k*a[c][j];}
   }
   return a.map(row=>row[8]);
 }
 function rectify(source,points){
   const c=document.createElement("canvas");c.width=source.width;c.height=source.height;const g=c.getContext("2d");g.drawImage(source,0,0);
   const p=points.map(p=>({x:p.x*c.width,y:p.y*c.height}));
   const cross=(a,b,d)=>(b.x-a.x)*(d.y-b.y)-(b.y-a.y)*(d.x-b.x);
   if(p.some((v,i)=>cross(v,p[(i+1)%4],p[(i+2)%4])<=0))throw new Error("Select screen corners clockwise, starting at top left.");
   const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
   let width=Math.round((dist(p[0],p[1])+dist(p[3],p[2]))/2),height=Math.round((dist(p[0],p[3])+dist(p[1],p[2]))/2);
   if(width<100||height<60)throw new Error("Select the whole display, inside its bezel.");
   const scale=Math.min(1,1600/width,1200/height);width=Math.round(width*scale);height=Math.round(height*scale);
   const h=mapping(p),src=g.getImageData(0,0,c.width,c.height).data;
   const out=document.createElement("canvas");out.width=width;out.height=height;const og=out.getContext("2d"),data=og.createImageData(width,height);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
     const u=x/Math.max(1,width-1),v=y/Math.max(1,height-1),d=h[6]*u+h[7]*v+1;
     const sx=Math.max(0,Math.min(c.width-1,(h[0]*u+h[1]*v+h[2])/d)),sy=Math.max(0,Math.min(c.height-1,(h[3]*u+h[4]*v+h[5])/d));
     const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(c.width-1,x0+1),y1=Math.min(c.height-1,y0+1),fx=sx-x0,fy=sy-y0,di=(y*width+x)*4;
     for(let ch=0;ch<3;ch++)data.data[di+ch]=(1-fy)*((1-fx)*src[(y0*c.width+x0)*4+ch]+fx*src[(y0*c.width+x1)*4+ch])+fy*((1-fx)*src[(y1*c.width+x0)*4+ch]+fx*src[(y1*c.width+x1)*4+ch]);
     data.data[di+3]=255;
   }
   og.putImageData(data,0,0);out._screenAligned=true;out._capturedAt=source._capturedAt;return out;
 }
 root.PhotoPrep={mapping,rectify};if(typeof module!=="undefined")module.exports=root.PhotoPrep;
})(typeof window!=="undefined"?window:globalThis);
