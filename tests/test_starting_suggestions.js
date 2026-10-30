const assert=require('node:assert/strict'),B=require('../docs/buildplans.js'),fs=require('node:fs');
const catalog=JSON.parse(fs.readFileSync('docs/data/items.json')).items,heroes=JSON.parse(fs.readFileSync('docs/data/heroes.json')).heroes,patchReview={status:'initial-baseline'};
const input={catalog,heroes,hero:'skylar',role:'CARRY',patchReview};
const styles=B.stylesFor(input);assert(styles.some(s=>s.id==='sustain'));assert(styles.some(s=>s.id==='mana'));assert(styles.some(s=>s.id==='crit'));
const get=(hero,role,style)=>B.suggest({...input,hero,role,style});
for(const h of heroes)for(const role of h.roles)for(const st of B.stylesFor({...input,hero:h.slug,role})){
 const r=get(h.slug,role,st.id);assert.equal(r.status,'ready',h.slug+'/'+role+'/'+st.id);assert.equal(r.items.length,6);assert.equal(new Set(r.items).size,6);assert.equal(r.countsAsOwned,false);
 const plan=B.createBaseline({who:'me',hero:h.slug,role,style:st.id,patch:'test',sessionId:'one',items:r.items,nextItem:r.items[0],confirmed:true,source:'suggestion',catalog,heroes});assert.equal(plan.source,'suggestion');assert.equal(plan.style,st.id);
 assert.equal(r.cost,r.items.reduce((n,name)=>n+catalog.find(i=>i.name===name).cost,0));
}
assert(!B.stylesFor({...input,hero:'khaimera',role:'JUNGLE'}).some(s=>s.id==='mana'),'heroes without mana do not get a mana style');
const sustain=get('skylar','CARRY','sustain');assert(sustain.stats.LIFESTEAL>0);assert(!sustain.stats.MAGICAL_POWER);
const mana=get('skylar','CARRY','mana');assert(mana.stats.BASE_MANA_REGENERATION>0||mana.stats.MANA>0);assert(!mana.stats.MAGICAL_POWER);
assert(get('skylar','CARRY','crit').stats.CRITICAL_CHANCE>0);assert.equal(get('kwang','JUNGLE','balanced').damage,'magical');
assert(!B.stylesFor({...input,hero:'gideon',role:'MIDLANE'}).some(s=>s.id==='crit'));
assert.equal(B.suggest({...input,patchReview:{status:'source-incomplete'}}).status,'review-required');assert.equal(B.suggest({...input,hero:'missing'}).status,'needs-context');
const blocked=catalog.map(i=>({...i,blocks:catalog.map(x=>x.name)}));assert.equal(B.suggest({...input,catalog:blocked}).status,'insufficient-items');
console.log('ok: every supported hero/lane/style yields six legal targets; sustain, mana, damage fit, costs, patch gates and ownership separation');
