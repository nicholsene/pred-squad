/* Viewfinder follows the displayed video; captures preserve every source pixel. */
(function(root){'use strict';
async function open(initial,onCapture,onError=()=>{}){
 if(!navigator.mediaDevices?.getUserMedia)return onError('Camera access needs HTTPS and a supported browser. You can still upload a photo.');
 const dialog=document.createElement('dialog');dialog.className='camera-dialog';dialog.setAttribute('aria-label','Landscape camera scan');
 dialog.innerHTML='<div class="camera-top"><button class="chip" id="camera-upload">Upload</button><button class="chip" id="camera-cancel">Close</button></div><input type="hidden" id="camera-mode"><div class="camera-stage"><video autoplay muted playsinline></video><div class="camera-guide" aria-hidden="true"></div><div class="camera-rotate">Rotate your phone sideways</div></div><div class="camera-bottom"><p id="camera-tip">Line up the full screen</p><button class="chip cta" id="camera-capture" disabled>Capture</button></div><p id="camera-status" role="status">Opening rear camera…</p>';
 document.body.append(dialog);dialog.showModal();
 const video=dialog.querySelector('video'),stage=dialog.querySelector('.camera-stage'),guide=dialog.querySelector('.camera-guide'),mode=dialog.querySelector('#camera-mode'),status=dialog.querySelector('#camera-status'),capture=dialog.querySelector('#camera-capture');
 mode.value=initial||'auto';let stream=null,closed=false,frame=null,observer=null;
 const background=()=>{if(document.visibilityState!=='visible')close();};
 const close=()=>{if(closed)return;closed=true;observer?.disconnect();document.removeEventListener('visibilitychange',background);root.removeEventListener('resize',layout);root.visualViewport?.removeEventListener('resize',layout);video.removeEventListener('resize',layout);video.removeEventListener('loadedmetadata',layout);stream?.getTracks().forEach(t=>t.stop());video.srcObject=null;dialog.close();dialog.remove();};
 const layout=()=>{
  if(closed)return;const landscape=root.innerWidth>=root.innerHeight||mode.value==='minimap';dialog.classList.toggle('camera-needs-rotation',!landscape);
  const b=video.getBoundingClientRect(),s=stage.getBoundingClientRect();frame=null;capture.disabled=true;
  if(!video.videoWidth||!video.videoHeight||!b.width||!b.height||!s.width||!s.height)return;
  const scale=Math.min(b.width/video.videoWidth,b.height/video.videoHeight),cw=video.videoWidth*scale,ch=video.videoHeight*scale,ox=(b.width-cw)/2,oy=(b.height-ch)/2,aspect=mode.value==='minimap'?1:16/9,w=Math.min(cw*.98,ch*.96*aspect),h=w/aspect,x=ox+(cw-w)/2,y=oy+(ch-h)/2;
  Object.assign(guide.style,{left:(b.left-s.left+x)+'px',top:(b.top-s.top+y)+'px',width:w+'px',height:h+'px'});
  frame={x:(x-ox)/scale,y:(y-oy)/scale,w:w/scale,h:h/scale};
  capture.disabled=!landscape||video.readyState<2;const kind=mode.value;
  guide.replaceChildren();
  dialog.querySelector('#camera-tip').textContent='Line up the full screen';
  status.textContent=landscape?'Camera ready. Hold steady and capture.':'Rotate sideways for a horizontal game-screen photo.';
 };
 dialog.querySelector('#camera-upload').onclick=()=>{close();onCapture('upload',null);};mode.onchange=layout;dialog.querySelector('#camera-cancel').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
 document.addEventListener('visibilitychange',background);root.addEventListener('resize',layout);root.visualViewport?.addEventListener('resize',layout);video.addEventListener('resize',layout);video.addEventListener('loadedmetadata',layout);
 if(root.ResizeObserver){observer=new root.ResizeObserver(layout);observer.observe(stage);observer.observe(video);}
 capture.onclick=()=>{
  layout();if(capture.disabled||!frame)return;
  const raw=document.createElement('canvas');raw.width=video.videoWidth;raw.height=video.videoHeight;raw.getContext('2d').drawImage(video,0,0);
  raw._capturedAt=Date.now();raw._captureSource='camera';raw._screenAligned=false;
  // The overlay is guidance, not a verified display boundary. Preserve the full
  // camera frame so rotation or loose alignment cannot discard scoreboard rows.
  const kind=mode.value;close();onCapture(kind,raw);
 };
 try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},aspectRatio:{ideal:16/9}}});if(closed){stream.getTracks().forEach(t=>t.stop());return;}video.srcObject=stream;await video.play();layout();}catch(e){if(!closed){close();onError(e.name==='NotAllowedError'?'Camera permission was denied. Allow access or upload a photo.':'Could not open the camera. Upload a photo instead.');}}
}
root.CameraScan={open};
})(window);
