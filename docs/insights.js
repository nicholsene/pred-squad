/* Descriptive coaching against a player's own same-role history. No causal claims. */
(function(root) {
  "use strict";
  function rows(matches, member) {
    return matches.filter(m => ["DAWN","DUSK"].includes(m.winner)).flatMap(m => {
      const p=m.players.find(p=>p.squad===member);
      return p ? [{m,p,win:p.team===m.winner}] : [];
    }).sort((a,b)=>String(b.m.start).localeCompare(String(a.m.start)));
  }
  const avg = (rs, f) => rs.length ? rs.reduce((a,r)=>a+(f(r)||0),0)/rs.length : null;
  function progress(matches, member, targets={}) {
    const all=rows(matches,member), recent=all.slice(0,10), prev=all.slice(10,20);
    const minutes=recent.reduce((s,r)=>s+(r.m.duration||0)/60,0);
    const d=avg(recent,r=>r.p.d), wards=avg(recent,r=>r.p.wards);
    const focus=!recent.length ? "No matches in this period." : d>(targets.maxDeaths??4) ? "Next focus: reduce avoidable deaths; regroup when behind." : wards<(targets.minWards??4) ? "Next focus: place a ward on each safe trip out of base." : recent.some(r=>!(r.p.obj>0)) ? "Next focus: join a safe objective after pushing your wave." : "Targets look steady. Keep converting safe advantages into towers.";
    return {games:recent.length, wr:avg(recent,r=>+r.win), previousGames:prev.length, previousWr:avg(prev,r=>+r.win), deaths10:minutes?recent.reduce((s,r)=>s+(r.p.d||0),0)*10/minutes:null, wards10:minutes?recent.reduce((s,r)=>s+(r.p.wards||0),0)*10/minutes:null, focus};
  }
  function review(match, member, matches) {
    const p=match.players.find(p=>p.squad===member); if(!p)return null;
    const peers=rows(matches,member).filter(r=>r.m.id!==match.id && r.p.role===p.role && r.m.mode===match.mode && String(r.m.patch).split('.').slice(0,2).join('.')===String(match.patch).split('.').slice(0,2).join('.')).slice(0,20);
    const mins=Math.max(1,(match.duration||0)/60), baseline=avg(peers,r=>(r.p.d||0)/Math.max(1,(r.m.duration||0)/60));
    const curve=p.goldCurve||[], finalGold=curve.length?curve[curve.length-1]:null;
    return {role:p.role,win:p.team===match.winner,games:peers.length,deaths:p.d,wards:p.wards,objectives:p.obj,towers:p.towers,finalGold,
      focus:peers.length<5?"Limited same-role history: use this match as a baseline.":p.d/mins>baseline*1.2?"Deaths per minute exceeded your recent same-role baseline. Review unsafe solo fights.":!(p.obj>0)?"No objective damage recorded. Look for a safe rotation after pushing your wave.":"Keep turning safe fights into objective and tower pressure.",
      baselineDeaths10:baseline==null?null:baseline*10};
  }
  root.SquadInsights={progress,review};
  if(typeof module!=="undefined")module.exports=root.SquadInsights;
})(typeof window!=="undefined"?window:globalThis);
