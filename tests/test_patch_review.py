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

# Sourced passive/ability/attribute changes participate in patch review.
clean_base=snapshot(h,i,"logic-v1")
for field,value in [("effects",[{"id":"e","name":"Passive","text":"new","condition":"On hit"}])]:
    changed=deepcopy(i);changed["items"][0][field]=value
    assert build_review(clean_base,h,changed,p)["status"]=="review-required"
changed=deepcopy(h);changed["heroes"][0]["attributes"]=[{"stat":"HEALTH","values":[500,600]}]
assert build_review(clean_base,changed,i,p)["status"]=="review-required"
changed=deepcopy(h);changed["heroes"][0]["abilities"][0]["cost"]=[10,20]
assert build_review(clean_base,changed,i,p)["status"]=="review-required"
from patch_review import logic_fingerprint
import tempfile
with tempfile.TemporaryDirectory() as folder:
    root=Path(folder);(root/"docs").mkdir();(root/"docs/counterbuild.js").write_text("v1")
    first=logic_fingerprint(root);(root/"docs/optimizer.js").write_text("v1")
    assert logic_fingerprint(root)!=first
    first=logic_fingerprint(root);(root/"docs/profiles.js").write_text("v1")
    assert logic_fingerprint(root)!=first
print("ok: passive source, hero attributes and optimizer/profile code changes invalidate review")
