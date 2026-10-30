/* Upload observations default to ten seconds before selection; camera frames retain capture time. */
(function(root){'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function stamp(file,now=Date.now()){if(!finite(file?._capturedAt)){file._capturedAt=now-10000;file._captureSource='assumed-upload';}return file;}
function copy(from,to,now=Date.now()){stamp(from,now);to._capturedAt=from._capturedAt;to._captureSource=from._captureSource;to._scanTicket=from._scanTicket;return to;}
function gameTime(file,startedAt,now=Date.now()){stamp(file,now);return finite(startedAt)?Math.max(0,Math.floor((file._capturedAt-startedAt)/1000)):null;}
const api={stamp,copy,gameTime};root.PhotoTime=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
