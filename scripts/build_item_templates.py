"""Build compact canonical icon descriptors. No user images leave the device."""
from __future__ import annotations
import base64, concurrent.futures, hashlib, io, json, math
from datetime import datetime, timezone
from pathlib import Path
import requests
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent

def descriptor(image):
    image=image.convert("RGBA");w,h=image.size;pix=image.load();values=[]
    for gy in range(8):
        for gx in range(8):
            x0=math.floor(w*(.12+.76*gx/8));x1=max(x0+1,math.ceil(w*(.12+.76*(gx+1)/8)))
            y0=math.floor(h*(.12+.76*gy/8));y1=max(y0+1,math.ceil(h*(.12+.76*(gy+1)/8)))
            sums=[0.,0.,0.];n=0
            for y in range(y0,min(h,y1)):
                for x in range(x0,min(w,x1)):
                    r,g,b,a=pix[x,y]
                    for k,v in enumerate((r,g,b)):sums[k]+=v*a/(255*255)
                    n+=1
            values.extend(max(0,min(255,math.floor(s/n*255+.5))) for s in sums)
    return {"values":base64.b64encode(bytes(values)).decode(),"grid":8}

def build(catalog,existing=None,cache=None):
    entries=[i for i in catalog.get("items",[]) if i.get("slot")=="PASSIVE" and i.get("smallIcon") and i.get("cost",0)>0]
    fingerprint=hashlib.sha256(json.dumps(sorted((i["name"],i["smallIcon"]) for i in entries)).encode()).hexdigest()
    if existing and existing.get("patch")==catalog.get("patch") and existing.get("sourceFingerprint")==fingerprint:return existing
    cache=Path(cache) if cache else None
    if cache:cache.mkdir(parents=True,exist_ok=True)
    def one(item):
        icon=item["smallIcon"]
        if not all(c in "0123456789abcdef" for c in icon) or len(icon)>64:raise ValueError("Invalid canonical icon hash")
        url=f"https://pred.gg/assets/{icon}_128.webp"
        p=cache/(icon+".webp") if cache else None
        if p and p.exists():data=p.read_bytes()
        else:
            resp=requests.get(url,timeout=20);resp.raise_for_status();data=resp.content
            if len(data)>1000000:raise ValueError("Oversized icon asset")
            if p:p.write_bytes(data)
        image=Image.open(io.BytesIO(data));image.load()
        return {"name":item["name"],"descriptor":descriptor(image),"source":url}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:templates=list(pool.map(one,entries))
    return {"schema":1,"patch":catalog.get("patch"),"updatedAt":datetime.now(timezone.utc).isoformat(),"sourceFingerprint":fingerprint,"templates":templates}

if __name__=="__main__":
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument("--cache",default=str(ROOT/".test-artifacts/item-icons"));args=ap.parse_args()
    path=ROOT/"docs/data/item-templates.json";old=json.loads(path.read_text()) if path.exists() else None
    result=build(json.loads((ROOT/"docs/data/items.json").read_text()),old,args.cache)
    path.write_text(json.dumps(result,separators=(",",":")))
    print(f"{len(result['templates'])} canonical equipment references for patch {result['patch']}")
