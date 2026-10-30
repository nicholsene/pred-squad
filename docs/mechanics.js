/* Source descriptions are reference material, never executable combat formulas. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SquadMechanics=factory();})(typeof self!=='undefined'?self:this,function(){
'use strict';
const plain=value=>String(value??'').replace(/<[^>]*>/g,'').replace(/\{[^}]*\}/g,'[live value]').replace(/[ \t]+/g,' ').trim();
function item(it){return{status:Array.isArray(it?.effects)?'source-described':'unavailable',stacking:'unknown',numericalModel:'unsupported',source:'https://pred.gg/gql',effects:(Array.isArray(it?.effects)?it.effects:[]).filter(e=>e&&e.name).map(e=>({id:e.id,name:plain(e.name),text:plain(e.text),condition:plain(e.condition),cooldown:e.cooldown==null?null:plain(e.cooldown)}))};}
function hero(h){return{status:'source-described',numericalModel:'unsupported',attributes:Array.isArray(h?.attributes)?h.attributes:[],abilities:(h?.abilities||[]).map(a=>({key:a.key,name:plain(a.name),description:plain(a.gameDescription||a.menuDescription||a.desc),cost:Array.isArray(a.cost)?a.cost:null,cooldown:Array.isArray(a.cooldown)?a.cooldown:null}))};}
return{plain,item,hero};
});
