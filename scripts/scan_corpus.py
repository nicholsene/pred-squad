#!/usr/bin/env python3
"""Private corpus review tools. Credentials and photo exports never belong in Git."""
import argparse, hashlib, json, mimetypes, os, sys, urllib.request, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PRIVATE=ROOT/'.scan-private'
def credentials():
    return json.loads((PRIVATE/'credentials.json').read_text())
def call(body=None,photo=None,metadata=None,capture=None,device=False):
    c=credentials()
    headers={'Authorization':'Bearer '+c['public_key'],'apikey':c['public_key'],'x-scan-key':c['device_key'] if photo or device else c['reviewer_key'],'x-scan-device' if photo or device else 'x-scan-reviewer':c['device_id'] if photo or device else c['reviewer_id']}
    if photo:
        boundary='scan'+uuid.uuid4().hex
        parts=[]
        for name,value in [('id',capture),('metadata',json.dumps(metadata))]:
            parts.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n'+value+'\r\n').encode())
        mime=mimetypes.guess_type(photo.name)[0] or 'image/jpeg'
        parts.extend([('--'+boundary+'\r\nContent-Disposition: form-data; name="photo"; filename="capture"\r\nContent-Type: '+mime+'\r\n\r\n').encode(),photo.read_bytes(),('\r\n--'+boundary+'--\r\n').encode()])
        data=b''.join(parts);headers['Content-Type']='multipart/form-data; boundary='+boundary
    else:
        data=json.dumps(body).encode();headers['Content-Type']='application/json'
    req=urllib.request.Request(c['endpoint'],data=data,headers=headers)
    with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)
def fetch(all_rows=False):
    d={'captures':[]};offset=0
    while True:
        page=call({'action':'list','all':all_rows,'offset':offset});d['captures'].extend(page['captures'])
        if page.get('nextOffset') is None:break
        offset=page['nextOffset']
    out=PRIVATE/'review';out.mkdir(parents=True,exist_ok=True)
    for row in d['captures']:
        suffix=mimetypes.guess_extension(row['mime']) or '.img'
        p=out/(row['id']+suffix)
        if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest()!=row['content_sha256']:
            with urllib.request.urlopen(row['image_url'],timeout=90) as r:p.write_bytes(r.read())
        assert hashlib.sha256(p.read_bytes()).hexdigest()==row['content_sha256'],'Image hash mismatch'
        row.pop('image_url',None);row['local_image']=str(p)
        (out/(row['id']+'.json')).write_text(json.dumps(row,indent=2))
    print(json.dumps({'downloaded':len(d['captures']),'directory':str(out)}))
def seed(directory):
    index=PRIVATE/'import-index.json'
    seen=json.loads(index.read_text()) if index.exists() else {}
    paths=sorted(Path(directory).rglob('*.jpg'))
    for p in paths:
        # Preserve every photo/attempt, including similar photos from the same game.
        name=str(p);b=p.read_bytes();sha=hashlib.sha256(b).hexdigest()
        if name in seen:continue
        capture=str(uuid.uuid4())
        result=call(photo=p,capture=capture,metadata={'source':'user-supplied-import','original_name':p.name,'import_group':p.parent.name,'captureTimeKnown':False})
        seen[name]={'id':capture,'sha256':result['sha256']}
        index.write_text(json.dumps(seen,indent=2))
        print(json.dumps({'imported':len(seen),'total':len(paths),'id':capture}))
def review(path):
    data=json.loads(Path(path).read_text())
    result=call({'action':'review',**data})
    print(json.dumps(result))
def report():
    rows=[]
    out=PRIVATE/'review'
    for p in out.glob('*.json'):
        r=json.loads(p.read_text())
        if 'reviews' in r:rows.append(r)
    current=lambda r:[v for v in r['reviews'] if v['image_sha256']==r['content_sha256'] and v['observation_revision']==r['revision']][:1]
    labels=[l for r in rows for rev in current(r) for l in rev['labels']]
    counts={k:sum(l['verdict']==k for l in labels) for k in ['correct','incorrect','unreadable','unobserved']}
    print(json.dumps({'captures_exported':len(rows),'reviewed':sum(bool(current(r)) for r in rows),'labels':counts,'warning':'Coverage and correctness on reviewed fields, not general OCR accuracy.'},indent=2))
def main():
    ap=argparse.ArgumentParser();s=ap.add_subparsers(dest='command',required=True)
    f=s.add_parser('fetch');f.add_argument('--all',action='store_true')
    q=s.add_parser('seed');q.add_argument('directory')
    q=s.add_parser('review');q.add_argument('labels')
    s.add_parser('report')
    a=ap.parse_args()
    if a.command=='fetch':fetch(a.all)
    elif a.command=='seed':seed(a.directory)
    elif a.command=='review':review(a.labels)
    else:report()
if __name__=='__main__':main()

