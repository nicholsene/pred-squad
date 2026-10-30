"""Deterministic patch delta review. Official notes are linked, never blindly interpreted."""
import hashlib,json
from urllib.parse import urlparse
HERO_FIELDS=("name","roles","classes","skills","abilities","attributes")
ITEM_FIELDS=("label","cost","slot","rarity","type","class","hidden","stats","buildsFrom","blocks","blockedBy","icon","smallIcon","effects")
SETS={"roles","classes","buildsFrom","blocks","blockedBy"}
def canonical(v):
    if isinstance(v,dict):return {k:canonical(x) for k,x in sorted(v.items())}
    if isinstance(v,list):return [canonical(x) for x in v]
    if isinstance(v,float) and v.is_integer():return int(v)
    return v
def digest(v):return hashlib.sha256(json.dumps(canonical(v),sort_keys=True,separators=(',',':')).encode()).hexdigest()
def catalogue(rows,key,fields):
    out={}
    for row in rows:
        ident=row.get(key)
        if not ident or ident in out:raise ValueError('Missing or duplicate catalogue key')
        e={}
        for field in fields:
            value=row.get(field)
            if field in SETS and isinstance(value,list):value=sorted(value)
            if field=='abilities' and isinstance(value,list):value=sorted(value,key=lambda x:x.get('key',''))
            e[field]=canonical(value)
        out[ident]=e
    return out
def logic_fingerprint(root):
    """All code/data that can change optimizer prescriptions participates in review."""
    from pathlib import Path
    names=("docs/counterbuild.js","docs/buildplans.js","docs/optimizer.js","docs/profiles.js","docs/mechanics.js","config/item-mechanics.json","docs/optimizer-ui.js","docs/session.js","docs/match.js","docs/scan.js","docs/scoreboard.js","docs/photo-router.js","docs/scan-quality.js","docs/photo-time.js","docs/minimap.js","docs/match-focus.js","scripts/fetch.py","scripts/patch_review.py")
    return digest({name:hashlib.sha256((Path(root)/name).read_bytes()).hexdigest() if (Path(root)/name).exists() else None for name in names})

def snapshot(h,i,logic):
    v={'schema':1,'origin':'initial-baseline','patches':{'heroes':h.get('patch'),'items':i.get('patch')},'heroes':catalogue(h.get('heroes',[]),'slug',HERO_FIELDS),'items':catalogue(i.get('items',[]),'name',ITEM_FIELDS),'counterLogicFingerprint':logic}
    v['fingerprint']=digest(v);return v
def differences(before,after):
    rows=[]
    for ident in sorted(set(before)|set(after)):
        old,new=before.get(ident),after.get(ident)
        if old==new:continue
        fields=sorted(k for k in set(old or {})|set(new or {}) if (old or {}).get(k)!=(new or {}).get(k))
        rows.append({'id':ident,'change':'added' if old is None else 'removed' if new is None else 'changed','fields':fields,'before':{k:(old or {}).get(k) for k in fields},'after':{k:(new or {}).get(k) for k in fields}})
    return rows
def build_review(baseline,h,i,policy):
    old=baseline or {};cur=snapshot(h,i,policy.get('counterLogicFingerprint'));errors=list(policy.get('sourceErrors',[]));hp,ip=cur['patches'].values()
    if policy.get('sourceComplete') is not True:errors.append('Latest hero/item source refresh is incomplete.')
    if not hp or hp!=ip:errors.append('Hero and item patches do not match.')
    expected=policy.get('expectedPatch')
    if expected and (hp!=expected or ip!=expected):errors.append('A retained catalogue differs from the detected patch.')
    if not cur['heroes'] or not cur['items']:errors.append('Required catalogue is empty.')
    if not cur['counterLogicFingerprint']:errors.append('Counter logic fingerprint missing.')
    url=policy.get('officialNotesUrl');parsed=urlparse(url or '');official=parsed.scheme=='https' and parsed.hostname in {'predecessorgame.com','www.predecessorgame.com'}
    if url and not official:errors.append('Patch-note URL must be official HTTPS.')
    approved=not errors and policy.get('reviewedFingerprint')==cur['fingerprint'];initial=old.get('origin')=='initial-baseline' and old.get('fingerprint')==cur['fingerprint']
    status='source-incomplete' if errors else 'reviewed' if approved else 'initial-baseline' if not old or initial else 'review-required'
    return {'schema':1,'status':status,'reviewRequired':not approved,'fingerprint':cur['fingerprint'],'baselineFingerprint':old.get('fingerprint'),'patches':cur['patches'],'patchChanged':old.get('patches')!=cur['patches'],'counterLogicChanged':old.get('counterLogicFingerprint')!=cur['counterLogicFingerprint'],'changes':{'heroes':differences(old.get('heroes',{}),cur['heroes']),'items':differences(old.get('items',{}),cur['items'])},'sourceProblems':errors,'officialNotesUrl':url if official else None,'notesInterpretation':'Not performed automatically.'}
if __name__=='__main__':
    import argparse
    from pathlib import Path
    root=Path(__file__).resolve().parent.parent
    ap=argparse.ArgumentParser();ap.add_argument('--approve',action='store_true');ap.add_argument('--reviewer');ap.add_argument('--notes-url');ap.add_argument('--confirm-reviewed',action='store_true');args=ap.parse_args()
    load=lambda p:json.loads((root/p).read_text()) if (root/p).exists() else {}
    h=load('docs/data/heroes.json');i=load('docs/data/items.json');logic=logic_fingerprint(root);base=load('config/patch-baseline.json');policy=load('config/patch-policy.json')
    cur=snapshot(h,i,logic)
    if args.approve:
        u=urlparse(args.notes_url or '')
        if not args.confirm_reviewed or not args.reviewer or u.scheme!='https' or u.hostname not in {'predecessorgame.com','www.predecessorgame.com'}:ap.error('Approval requires --reviewer, official --notes-url and --confirm-reviewed after reviewing the diff and running tests.')
        policy.update(reviewedFingerprint=cur['fingerprint'],reviewer=args.reviewer,officialNotesUrl=args.notes_url)
        (root/'config/patch-policy.json').write_text(json.dumps(policy,indent=2)+'\n')
        (root/'config/patch-baseline.json').write_text(json.dumps(cur,separators=(',',':')))
    report=build_review(base,h,i,{**policy,'sourceComplete':False,'counterLogicFingerprint':logic})
    print(json.dumps(report,indent=2))
