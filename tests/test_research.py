"""Research catalogue: builds kept only above the rank cut-off, no names/ids, enemy laner and buy order kept,
"""
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import research

cat = {n: {"name": n, "slot": "PASSIVE", "cost": 3000, "hidden": False} for n in ("A", "B", "C", "D")}
cat["Part"] = {"name": "Part", "slot": "PASSIVE", "cost": 900}
def mp(hero, role, team, items, pts, curve=(0, 3000, 6000, 9000, 12000)):
    return {"role": role, "team": team, "hero": {"slug": hero}, "inventoryItemData": [{"name": n} for n in items],
            "goldEarnedAtInterval": list(curve), "rating": {"points": pts}, "player": {"id": "secret-id", "name": "SecretName"}}
match = {"winningTeam": "DAWN", "matchPlayers": [mp("skylar", "CARRY", "DAWN", ["A", "B", "Part", "C"], 1300),
                                                  mp("murdock", "CARRY", "DUSK", ["B", "A"], 1250),
                                                  mp("grux", "OFFLANE", "DUSK", ["C"], 900)]}
b = research.builds_from_match(match, cat, 1200)
assert [x["hero"] for x in b] == ["skylar", "murdock"], b          # below the cut-off is dropped
sky = b[0]
assert sky["items"] == ["A", "B", "C"] and sky["mins"] == [1, 2, 3] and sky["win"] == 1 and sky["enemy"] == "murdock"
assert "secret" not in json.dumps(b).lower()                        # no names or ids are kept
agg = research.aggregate({"matches": {"m1": {"builds": b}, "m2": {"builds": [dict(sky, win=0)]}}, "sampledPlayers": 2, "minPoints": 1200},
                         [{"slug": "murdock", "classes": ["SHARPSHOOTER"]}])
s = agg["heroes"]["skylar"]["CARRY"]
assert s["games"] == 2 and s["wins"] == 1 and s["items"]["A"] == [2, 1, 0] and s["items"]["C"][2] == 4
assert s["openings"][0] == {"items": ["A", "B", "C"], "games": 2, "wins": 1}
assert s["vs"]["murdock"]["games"] == 2 and s["vsClass"]["SHARPSHOOTER"]["games"] == 2
print("ok: research cut-off, anonymity, buy order, minutes, enemy laner and aggregation")
