#!/usr/bin/env python3
"""Compare real OCR with independently image-reviewed PRIVATE labels, then append reviews."""
import argparse,json
from pathlib import Path
from scan_corpus import ROOT,PRIVATE,call
FIELDS=['lvl','k','d','a','cs']
ROLES=['OFFLANE','JUNGLE','MIDLANE','SUPPORT','CARRY']
def publish(manifest,benchmark):
    truth=json.loads(Path(manifest).read_text());reads={r['path']:r for r in json.loads(Path(benchmark).read_text())['results']}
    tally={'photos':0,'correct':0,'incorrect':0,'unreadable':0,'unobserved':0};failures=[]
    for photo in truth['photos']:
        read=reads[photo['path']]
        # List is paginated; find the row in the already downloaded local metadata instead.
        record=json.loads((PRIVATE/'review'/(photo['captureId']+'.json')).read_text())
        observations={k:read[k] for k in ['ocr','detected','parsed','quality','error','ms'] if k in read}
        call({'action':'observe','id':photo['captureId'],'revision':1,'observations':observations},device=True)
        parsed=read.get('parsed') or {};labels=[]
        def add(field,value,observed=None,region=None):
            verdict='unreadable' if value is None else 'unobserved' if observed is None or observed=='unknown' else 'correct' if observed==value else 'incorrect'
            labels.append(dict(field=field,correct=value,observed=observed,verdict=verdict,region=region or [0,0,1,1]))
            tally[verdict]+=1
            if verdict=='incorrect':failures.append(dict(capture=photo['captureId'],field=field,expected=value,observed=observed,autoApplied=(read.get('quality') or {}).get('auto',False)))
        def rows(side):
            r=parsed.get(side) or []
            return [r.get(k,{}) for k in ROLES] if isinstance(r,dict) else r
        expected=photo['screenType'];normalized='scoreboard' if 'scoreboard' in expected else 'hud' if expected in ['hud','hud-minimap','minimap'] else expected
        detected=(read.get('detected') or {}).get('kind')
        observed='shop' if detected=='build' else 'hud' if detected=='minimap' else detected
        add('screenType',normalized,observed)
        if expected=='postmatch-scoreboard':add('screenVariant','postmatch',None)
        add('clockSeconds',photo.get('clockSeconds'),parsed.get('clock'))
        region=[0,0,1,1]
        if 'ownRowRegion' in photo:
            x,y,w,h=photo['ownRowRegion'];region=[x,y,min(1,x+w),min(1,y+h)]
        own=rows('ours');idx=photo.get('ownRow')
        row=own[idx] if isinstance(idx,int) and idx<len(own) else {}
        if 'ownHero' in photo:add('ownHero',photo['ownHero'],row.get('hero'),region)
        for f,value in zip(FIELDS,photo.get('ownStats',[])):add('ours.'+str(idx)+'.'+f,value,row.get(f),region)
        roster=truth.get('rosters',{}).get(photo.get('roster'))
        if roster:
            for side in ['ours','theirs']:
                actual=rows(side)
                for i,hero in enumerate(roster[side]):add(side+'.'+str(i)+'.hero',hero,actual[i].get('hero') if i<len(actual) else None)
        if photo.get('rowFields'):
            for side in ['ours','theirs']:
                actual=rows(side)
                for i,values in enumerate(photo[side]):
                    for f,value in zip(photo['rowFields'],values):add(side+'.'+str(i)+'.'+f,value,actual[i].get(f) if i<len(actual) else None)
        for name in ['selectedItem','selectedItemOwned','selectedItemFullCost','selectedItemRemainingCost','currentGold','ownedEquipment','visibleBuildHeading','teamKills','ownTotalGold','crestText','crestProgress']:
            if name in photo:add(name,photo[name])
        review={'action':'review','id':photo['captureId'],'image_sha256':record['content_sha256'],'observation_revision':1,'status':'partial','labels':labels,'assessment':{'verification':'manual-image-inspection','reviewer':'codex-visual','scope':'Listed fields only; other fields remain unreviewed.','imageFullyInspected':True,'notes':photo.get('notes',photo.get('issues',[])),'matchGroup':photo.get('roster'),'regionPrecision':'Whole image or approximate player row; not digit-level boxes.'}}
        call(review)
        tally['photos']+=1;print(json.dumps(tally),flush=True)
    report={'counts':tally,'incorrect':failures,'scope':'Reviewed listed fields only. Abstentions counted separately. Same-game frames are not independent accuracy samples.'}
    (PRIVATE/'seed-evaluation.json').write_text(json.dumps(report,indent=2))
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('manifest');ap.add_argument('benchmark');a=ap.parse_args();publish(a.manifest,a.benchmark)

