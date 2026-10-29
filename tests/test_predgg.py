"""Token service retries are bounded and never retry invalid credentials."""
import os
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent / "scripts"))
from predgg import PredGG, PredGGError
class Response:
    text = "upstream unavailable"
    def __init__(self,status): self.status_code=status
    def json(self): return {"access_token":"fake-token","expires_in":3600}
class Session:
    def __init__(self,statuses): self.headers={}; self.statuses=iter(statuses); self.calls=0
    def post(self,*args,**kwargs): self.calls+=1; return Response(next(self.statuses))
with patch.dict(os.environ,{"PREDGG_CLIENT_ID":"fake-id","PREDGG_CLIENT_SECRET":"fake-secret","PREDGG_REFRESH_TOKEN":"","PREDGG_ACCESS_TOKEN":""}), patch("predgg.time.sleep"):
    s=Session([500,502,200]);api=PredGG(session=s);api._refresh_token();assert s.calls==3 and api.token=="fake-token"
    s=Session([500,500,500,500]);api=PredGG(session=s)
    try: api._refresh_token();raise AssertionError("expected bounded failure")
    except PredGGError: assert s.calls==4
    s=Session([401]);api=PredGG(session=s)
    try: api._refresh_token();raise AssertionError("expected invalid-credential failure")
    except PredGGError: assert s.calls==1
print("ok: transient token errors retry, retry limit, and invalid-credential rejection")
