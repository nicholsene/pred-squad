/* Live rear-camera framing. Frames stay on device; media tracks stop on capture/cancel/background. */
(function(root){
 "use strict";
 async function open(initial,onCapture,onError=()=>{}) {
   if(!navigator.mediaDevices?.getUserMedia){onError("Camera access needs HTTPS and a supported browser. You can still upload a photo.");return;}
   const dialog=document.createElement("dialog");dialog.className="camera-dialog";dialog.setAttribute("aria-label","Camera scan guide");
   dialog.innerHTML='<h3>Line up your screen</h3><label>Scan type<select id="camera-mode"><option value="loading">Loading screen</option><option value="scoreboard">Scoreboard</option><option value="minimap">Minimap timer</option><option value="hud">In-game HUD</option></select></label><p id="camera-tip"></p><div class="camera-stage"><video autoplay muted playsinline></video><div class="camera-guide" aria-hidden="true"></div></div><p class="note">Keep all four display corners in the frame. Hold the phone square to the screen, avoid glare, and wait for the text to focus. Results are reviewed before use.</p><p id="camera-status" role="status">Opening rear camera…</p><button class="chip cta" id="camera-capture" disabled>Capture framed area</button><button class="chip" id="camera-cancel">Cancel</button>';
   document.body.append(dialog);dialog.showModal();
   const video=dialog.querySelector("video"),guide=dialog.querySelector(".camera-guide"),mode=dialog.querySelector("select"),status=dialog.querySelector("#camera-status");
   mode.value=initial||"loading";let stream=null,closed=false,frame=null;
   const close=()=>{if(closed)return;closed=true;stream?.getTracks().forEach(t=>t.stop());video.srcObject=null;document.removeEventListener("visibilitychange",background);root.removeEventListener("resize",layout);dialog.close();dialog.remove();};
   const background=()=>{if(document.visibilityState!=="visible")close();};
   const layout=()=>{
     if(!video.videoWidth)return;
     const b=video.getBoundingClientRect(),scale=Math.min(b.width/video.videoWidth,b.height/video.videoHeight),cw=video.videoWidth*scale,ch=video.videoHeight*scale,ox=(b.width-cw)/2,oy=(b.height-ch)/2;
     const aspect=mode.value==="minimap"?1:16/9,w=Math.min(cw*.92,ch*.86*aspect),h=w/aspect,x=ox+(cw-w)/2,y=oy+(ch-h)/2;
     Object.assign(guide.style,{left:x+"px",top:y+"px",width:w+"px",height:h+"px"});
     frame={x:(x-ox)/scale,y:(y-oy)/scale,w:w/scale,h:h/scale};
     const kind=mode.value;
     guide.innerHTML=kind==="loading"?Array.from({length:5},(_,i)=>`<i class="camera-card" style="left:${31.5+i*13.5}%;top:5%;width:12%;height:33%"></i><i class="camera-card" style="left:${31.5+i*13.5}%;top:55%;width:12%;height:35%"></i>`).join(""):kind==="scoreboard"?Array.from({length:5},(_,i)=>`<i class="camera-row" style="top:${20+i*13.5}%;left:8%;width:37%;height:12%"></i><i class="camera-row" style="top:${20+i*13.5}%;left:55%;width:37%;height:12%"></i>`).join(""):kind==="hud"?'<i class="camera-hud-map"></i><i class="camera-hud-clock"></i>':'<i class="camera-map-diamond"></i><i class="camera-map-timer left"></i><i class="camera-map-timer right"></i>';
     dialog.querySelector("#camera-tip").textContent=kind==="loading"?"Fit the display inside the outer frame. Align the ten hero cards with the faint boxes.":kind==="scoreboard"?"Fit the display inside the outer frame. Align both teams with the five faint row guides.":kind==="hud"?"Fit the full gameplay display in the outer frame. The faint map and clock boxes are approximate; after capture, select the visible timer.":"Align the minimap diamond with the faint outline. After capture, select one visible objective countdown.";
   };
   mode.onchange=layout;dialog.querySelector("#camera-cancel").onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
   document.addEventListener("visibilitychange",background);root.addEventListener("resize",layout);
   dialog.querySelector("#camera-capture").onclick=()=>{
     if(!frame||!video.videoWidth)return;
     const raw=document.createElement("canvas");raw.width=video.videoWidth;raw.height=video.videoHeight;raw.getContext("2d").drawImage(video,0,0);
     const cropped=document.createElement("canvas");cropped.width=Math.round(frame.w);cropped.height=Math.round(frame.h);cropped.getContext("2d").drawImage(raw,frame.x,frame.y,frame.w,frame.h,0,0,cropped.width,cropped.height);
     const kind=mode.value;cropped._screenAligned=kind!=="minimap";cropped._originalSource=raw;
     close();onCapture(kind,cropped);
   };
   try{
     stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}});
     if(closed){stream.getTracks().forEach(t=>t.stop());return;}
     video.srcObject=stream;await video.play();if(closed)return;
     layout();status.textContent="Camera ready. Line up the guide, then capture.";dialog.querySelector("#camera-capture").disabled=false;
   }catch(e){if(!closed){close();onError(e.name==="NotAllowedError"?"Camera permission was denied. Allow camera access in your browser, or upload a photo.":"Couldn't open the camera. You can still upload a photo.");}}
 }
 root.CameraScan={open};
})(typeof window!=="undefined"?window:globalThis);
