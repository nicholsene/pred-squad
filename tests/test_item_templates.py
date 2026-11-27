"""A missing item icon (pred.gg not yet hosting a new item's art) must not stop the data run:
the item keeps its previous template or is listed as missing, and the set is retried next run."""
import io, sys
from pathlib import Path
import requests
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_item_templates as B

png = io.BytesIO(); Image.new("RGBA", (16, 16), (200, 40, 40, 255)).save(png, "PNG")
class Resp:
    def __init__(self, ok): self.ok, self.content, self.status_code = ok, png.getvalue(), 200 if ok else 404
    def raise_for_status(self):
        if not self.ok: raise requests.HTTPError("404 Client Error: Not Found")
B.requests.get = lambda url, timeout=20: Resp("dead" not in url)
item = lambda n, icon: {"name": n, "slot": "PASSIVE", "smallIcon": icon, "cost": 3000}
cat = {"patch": "p2", "items": [item("Old", "aa"), item("Kept", "bb"), item("New", "dead1")]}
prev = {"templates": [{"name": "Kept", "descriptor": {"values": "x", "grid": 8}, "source": "old"}, {"name": "New", "descriptor": {"values": "y", "grid": 8}}]}
cat["items"][1]["smallIcon"] = "dead2"                      # Kept's icon now 404s but it had a template
r = B.build(cat, prev)
names = [t["name"] for t in r["templates"]]
assert names == ["Old", "Kept", "New"], names                  # Kept and New fall back to previous templates
assert [m["name"] for m in r["missing"]] == ["Kept", "New"]
assert r["sourceFingerprint"] is None                         # incomplete set is retried next run
r2 = B.build({"patch": "p2", "items": [item("Brand", "dead3")] + cat["items"][:1]}, None)
assert [t["name"] for t in r2["templates"]] == ["Old"] and r2["missing"][0]["name"] == "Brand"
try:
    B.build({"patch": "p2", "items": [item("Brand", "dead3")]}, None); raise SystemExit("expected failure when nothing downloads")
except ValueError: pass
print("ok: missing icons are skipped or keep their old template; incomplete sets retry; total failure still reported")
