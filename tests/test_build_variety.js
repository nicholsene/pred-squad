// Starting builds must depend on hero, lane and style, using the real catalogue and recorded matches.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),P=require('../docs/buildplans.js');
const d=f=>JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/data',f)));
const catalog=d('items.json').items,heroes=d('heroes.json').heroes,matches=d('matches.json').matches;
const roles=['OFFLANE','JUNGLE','MIDLANE','SUPPORT','CARRY'];
const build=(hero,role,style,m=matches)=>{const r=P.suggest({hero,role,style,catalog,heroes,matches:m});assert.equal(r.status,'ready',`${hero} ${role} ${style}: ${r.reason}`);assert.equal(new Set(r.items).size,6);return r;};
const overlap=(a,b)=>a.items.filter(x=>b.items.includes(x)).length;
for(const hero of ['skylar','gideon','muriel']){
 const all=[];for(const role of roles)for(const s of P.stylesFor({hero,role,catalog,heroes}))all.push(build(hero,role,s.id).items.join());
 assert(new Set(all).size>=all.length*.6,`${hero}: only ${new Set(all).size} distinct builds out of ${all.length}`);
 // Lane alone changes the recommended build somewhere.
 assert(new Set(roles.map(r=>build(hero,r,'balanced').items.join())).size>=3,`${hero}: lane does not change the build`);
 // Each style reports how many items it shares with Recommended, so the card can say when they match.
 for(const role of roles){const base=build(hero,role,'balanced');for(const s of P.stylesFor({hero,role,catalog,heroes}))if(s.id!=='balanced'){const r=build(hero,role,s.id);assert.equal(r.sharedWithRecommended,overlap(base,r));}}
}
// Most styles differ from Recommended by at least two items.
for(const hero of ['skylar','gideon','muriel']){let n=0,far=0;for(const role of roles)for(const s of P.stylesFor({hero,role,catalog,heroes}))if(s.id!=='balanced'){n++;if(build(hero,role,s.id).sharedWithRecommended<=4)far++;}assert(far>=n*.6,`${hero}: only ${far}/${n} styles differ`);}
// Two mid mages no longer get the same build.
assert.notEqual(build('gideon','MIDLANE','balanced').items.join(),build('muriel','MIDLANE','balanced').items.join());
// Without match history it still works and says so.
const bare=build('skylar','CARRY','balanced',[]);assert.equal(bare.evidence,null);assert.equal(bare.source,'catalogue-suggestion');
assert(build('skylar','CARRY','balanced').evidence.role>0);
console.log('ok: starting builds vary by hero, lane and style; match history used when present');
