
const assert=require('node:assert/strict'),R=require('../docs/photo-router.js');
const heroes=['Greystone','Neon','Shinbi','Phase','Skylar','Dekker','Serath','Argus','Zinx','Sparrow'].map(name=>({name,slug:name.toLowerCase()})),names=heroes.map(h=>h.name).join(' ');
const C=(s,c={})=>R.classify(s,{heroes,...c});
assert.equal(C('RECOMMENDED ALL ITEMS BUILDS INTO FINAL BUILD Skylar').kind,'build');
assert.equal(C('OFFENSIVE DEFENSIVE RECOMMENDED').kind,'build');
assert.equal(C('K D A\n'+names).kind,'scoreboard');
assert.equal(C('VICTORY\nGreystone Neon').kind,'scoreboard');
assert.equal(C('OFFLANE JUNGLE MIDLANE SUPPORT CARRY\n'+names).kind,'loading');
assert.equal(C('Greystone Greystone Greystone\nK D A').kind,'unknown');
assert.equal(C('OFFLANE JUNGLE MIDLANE\nNeon').kind,'unknown');
assert.equal(C('1:29 34 2m+',{visualMap:true}).kind,'minimap');
assert.equal(C('45 RETREAT BE RIGHT BACK',{visualMap:true}).kind,'minimap');
assert.equal(C('212 238 45').kind,'unknown');
assert.equal(C('1:29 2:00').kind,'unknown');
assert.equal(C('RECOMMENDED for our next meeting').kind,'unknown');
assert.equal(C('K D A\n'+names).heroMatches.length,10);
assert.equal(C('GREYST0NE').heroMatches[0].slug,'greystone');
assert.equal(C('212 238 45',{visualMap:true}).clockRead,undefined);

const boardNames=names.split(' ').map(t=>({t,c:95})),clock={t:'13:29',c:96,x0:590,x1:622,y0:120,y1:144},ctx={heroes,width:1280,height:720},board=[[{t:'K D A',c:95}],boardNames,[clock]];
assert.equal(R.classify(board,ctx).clockRead.seconds,809);
assert.equal(R.classify(board,ctx).clockRead.source,'scoreboard-clock');
assert.equal(R.classify([...board,[{...clock}]],ctx).clockRead.seconds,809);
assert.equal(R.classify([...board,[{...clock,t:'2:00',x0:700,x1:730}]],ctx).clockRead,undefined);
assert.equal(R.classify([board[0],board[1],[{...clock,c:89}]],ctx).clockRead,undefined);
assert.equal(R.classify([board[0],board[1],[{...clock,x0:1100,x1:1140}]],ctx).clockRead,undefined);
assert.equal(R.classify([[clock],[{t:'45'}]],{...ctx,visualMap:true}).clockRead,undefined);

(async()=>{let calls=0;const canvas={width:1280,height:720,getContext(){throw Error('no pixels');}},kit={toCanvas:async()=>canvas,prep:()=>canvas,words:async()=>{calls++;return calls===1?[[{t:'unreadable'}]]:[[{t:'FINAL BUILD'}]];}};assert.equal((await R.detect({}, {kit})).kind,'build');assert.equal(calls,2);assert.equal(canvas.width,0);assert.equal((await R.detect({}, {kit:{}})).kind,'unknown');console.log('photo router tests passed');})();
