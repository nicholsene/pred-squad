const assert=require('node:assert/strict'),M=require('../docs/mechanics.js');
const r=M.item({effects:[{id:'e',name:'Ward',text:'<Effect>15%</> <img onerror="alert(1)"> damage {Damage}',condition:'<Condition>After hit:</>',cooldown:null},{name:'',text:'telemetry'}]});
assert.equal(r.effects.length,1);assert.equal(r.effects[0].text,'15% damage [live value]');assert.equal(r.effects[0].cooldown,null);assert.equal(r.numericalModel,'unsupported');assert.equal(r.stacking,'unknown');assert(!r.effects[0].text.includes('<'));
assert.equal(M.item({}).status,'unavailable');assert.equal(M.hero({abilities:[{name:'Test',cost:[],cooldown:null}]}).abilities[0].cooldown,null);
console.log('ok: inert source mechanics, unknown stacking, no invented formulas or cooldowns');
