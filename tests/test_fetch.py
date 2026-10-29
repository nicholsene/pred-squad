"""Offline test of fetch.py: fakes pred.gg responses, checks paging, incremental
merge and normalisation. Writes only into a temp folder.  Run: python tests/test_fetch.py"""
import json
import random
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import fetch  # noqa: E402

SQUAD = {p["predId"]: p["key"] for p in fetch.CONFIG["players"]}
IDS = list(SQUAD)
HEROES = ["greystone", "sparrow", "khaimera", "crunch", "steel", "phase", "renna", "legion", "terra", "aurora"]
ROLES = ["OFFLANE", "JUNGLE", "MIDLANE", "SUPPORT", "CARRY"]


def fake_match(i):
    rnd = random.Random(i)
    squad_here = rnd.sample(IDS, rnd.randint(1, 3))
    roles = rnd.sample(ROLES, 5)
    mps = []
    for t, team in enumerate(["DAWN", "DUSK"]):
        for j, role in enumerate(ROLES):
            pid = squad_here[j] if team == "DAWN" and j < len(squad_here) else f"other-{i}-{t}-{j}"
            mps.append({"player": {"id": pid}, "role": roles[j] if team == "DAWN" else role, "team": team,
                        "hero": {"slug": rnd.choice(HEROES)}, "kills": rnd.randint(0, 10), "deaths": rnd.randint(0, 10),
                        "assists": 3, "level": 15, "gold": 12000, "goldSpent": 11000, "wardsPlaced": rnd.randint(0, 9),
                        "wardsDestroyed": 0, "heroDamage": 15000, "heroDamageTaken": 20000, "totalDamageMitigated": 9000,
                        "minionsKilled": 200, "laneMinionsKilled": 180, "neutralMinionsEnemyJungle": 0,
                        "neutralMinionsTeamJungle": 0, "totalDamageDealtToObjectives": rnd.choice([0, 5000]),
                        "totalDamageDealtToStructures": 3000})
    return {"id": f"m{i:04d}", "startTime": f"2026-10-{1 + i % 28:02d}T12:00:00Z", "duration": 1800,
            "gameMode": "RANKED", "winningTeam": rnd.choice(["DAWN", "DUSK"]), "version": {"name": "1.17.2"},
            "matchPlayers": mps}


ALL = [fake_match(i) for i in range(60)]


class FakeAPI:
    has_credentials = True
    calls = 0

    def query(self, q, v=None):
        self.calls += 1
        if "matchesPaginated" in q:
            mine = [m for m in ALL if any(mp["player"]["id"] == v["id"] for mp in m["matchPlayers"])]
            mine.sort(key=lambda m: m["startTime"], reverse=True)
            page = mine[v["offset"]: v["offset"] + v["limit"]]
            return {"player": {"matchesPaginated": {"totalCount": len(mine), "results": [{"match": m} for m in page]}}}
        raise AssertionError("unexpected query")


def main():
    with tempfile.TemporaryDirectory() as d:
        fetch.DATA = Path(d)
        api = FakeAPI()
        out = fetch.fetch_matches(api, {})
        n_first = len(out["matches"])
        expected = sum(1 for m in ALL if any(mp["player"]["id"] in SQUAD for mp in m["matchPlayers"]))
        assert n_first == expected, (n_first, expected)
        # every squad member is labelled; nobody else carries an id or name
        for m in out["matches"]:
            for p in m["players"]:
                assert p["squad"] in (None, *SQUAD.values())
                assert "player" not in p and "name" not in p
        # second run should stop after the first known page for each player
        calls_before = api.calls
        out2 = fetch.fetch_matches(api, out)
        assert len(out2["matches"]) == n_first
        assert api.calls - calls_before == len(IDS), api.calls - calls_before
        fetch.DATA = Path(d)
        fetch.save("matches.json", out2)
        json.loads((Path(d) / "matches.json").read_text())
        (ROOT / "tests" / "fixture_matches.json").write_text(json.dumps(out2))
    print(f"ok: {n_first} matches, incremental run made {len(IDS)} calls")


if __name__ == "__main__":
    main()
