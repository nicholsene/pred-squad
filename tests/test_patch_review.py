import sys
from pathlib import Path
from copy import deepcopy
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'scripts'))
from patch_review import build_review,snapshot
h={'patch':'1.17.2','heroes':[{'slug':'hero','skills':['PRIMARY','SECONDARY'],'abilities':[{'key':'PRIMARY','cooldown':[10,9]}]}]}
i={'patch':'1.17.2','items':[{'name':'Item','stats':{'HEALTH':100},'buildsFrom':['Part']}]}
p={'sourceComplete':True,'counterLogicFingerprint':'logic-v1'}
base=snapshot(h,i,'logic-v1')
assert build_review(None,h,i,p)['status']=='initial-baseline'
assert build_review(base,h,i,p)['status']=='initial-baseline'
approved={**p,'reviewedFingerprint':base['fingerprint']}
assert build_review(base,h,i,approved)['status']=='reviewed'
new=deepcopy(i);new['items'][0]['stats']['HEALTH']=150
assert build_review(base,h,new,approved)['status']=='review-required'
new['patch']='1.18'
assert build_review(base,h,new,p)['status']=='source-incomplete'
assert build_review(base,h,i,{**approved,'sourceComplete':False})['reviewRequired']
assert build_review(base,h,i,{**approved,'counterLogicFingerprint':'v2'})['counterLogicChanged']
h['updatedAt']='irrelevant'
assert snapshot(h,i,'logic-v1')['fingerprint']==base['fingerprint']
h['heroes'][0]['skills'].reverse()
assert build_review(base,h,i,approved)['changes']['heroes'][0]['fields']==['skills']
assert build_review(base,h,i,{**p,'officialNotesUrl':'https://evil.example/notes'})['status']=='source-incomplete'
print('ok: patch deltas, skills, stats, logic, source completeness, baseline and explicit review gates')
