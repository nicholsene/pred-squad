"""Research catalogue: what high-ranked players build, by hero, lane and enemy laner.

Runs inside fetch.py once a day when config/squad.json has "research": {"enabled": true}
(Eric, 2026-11-01: repo stays public; the link just isn't shared). Re-collects from scratch each
run (about 200 queries), so no raw cache is committed. Stores no player names or ids: each kept
build is hero, lane, finished-item order, result, enemy laner and enemy team heroes, rank points,
estimated item minutes, gold lead over the enemy laner at 10/15 min, K/D/A, objective damage and game length.

  docs/data/research.json  aggregates the app reads
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = 2   # bump when the aggregate gains fields; fetch.py rebuilds at once instead of waiting a day
DEFAULTS = {"topPlayers": 200, "gamesPerPlayer": 25, "minPoints": 1200, "keepDays": 30}

LEADERBOARD_Q = """
query($r: ID!, $limit: Int, $offset: Int) {
  leaderboardPaginated(ratingId: $r, ratingType: CURRENT, limit: $limit, offset: $offset) {
    results { points player { id } }
  }
}"""

HISTORY_Q = """
query($id: ID!, $limit: Int) {
  player(by: {id: $id}) {
    matchesPaginated(limit: $limit, filter: {gameModes: [RANKED]}) {
      results { match {
        id startTime duration gameMode winningTeam version { name }
        matchPlayers { role team hero { slug } inventoryItemData { name } goldEarnedAtInterval rating { points }
                       kills deaths assists totalDamageDealtToObjectives }
      } }
    }
  }
}"""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_final(item: dict | None) -> bool:
    return bool(item) and item.get("slot") == "PASSIVE" and not item.get("hidden") and (item.get("cost") or 0) >= 1800


def builds_from_match(m: dict, catalog: dict, min_points: float) -> list[dict]:
    """Kept builds from one match: players at or above min_points, with their enemy laner."""
    out = []
    mps = m.get("matchPlayers") or []
    for p in mps:
        pts = (p.get("rating") or {}).get("points")
        hero = (p.get("hero") or {}).get("slug")
        if pts is None or pts < min_points or not hero or not p.get("role"):
            continue
        items = [it["name"] for it in (p.get("inventoryItemData") or []) if it and it.get("name")]
        finals = [n for n in items if is_final(catalog.get(n))]
        if not finals:
            continue
        curve, cum, mins = p.get("goldEarnedAtInterval") or [], 0, []
        for n in finals:
            cum += catalog[n]["cost"]
            mins.append(next((t for t, g in enumerate(curve) if g >= cum), None))
        foe = next((q for q in mps if q.get("team") != p.get("team") and q.get("role") == p.get("role")), None)
        ecurve = (foe or {}).get("goldEarnedAtInterval") or []
        lead = lambda t: curve[t] - ecurve[t] if len(curve) > t and len(ecurve) > t else None
        out.append({"hero": hero, "role": p["role"], "items": finals, "mins": mins, "rp": round(pts),
                    "win": int(p.get("team") == m.get("winningTeam")), "enemy": ((foe or {}).get("hero") or {}).get("slug"),
                    "foes": sorted((q.get("hero") or {}).get("slug") for q in mps if q.get("team") != p.get("team") and (q.get("hero") or {}).get("slug")),
                    "g10": lead(10), "g15": lead(15), "dur": round((m.get("duration") or 0) / 60),
                    "k": p.get("kills"), "d": p.get("deaths"), "a": p.get("assists"), "obj": p.get("totalDamageDealtToObjectives")})
    return out


def collect(api, catalog: dict, cfg: dict | None = None) -> dict:
    cfg = {**DEFAULTS, **(cfg or {})}
    cache = {"matches": {}}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=cfg["keepDays"])).strftime("%Y-%m-%dT%H:%M:%SZ")
    ratings = api.public_query("{ ratings { id startTime } }")["ratings"]
    rating = max(ratings, key=lambda r: r.get("startTime") or "")["id"]
    players, offset = [], 0
    while len(players) < cfg["topPlayers"]:
        page = api.query(LEADERBOARD_Q, {"r": rating, "limit": 50, "offset": offset})["leaderboardPaginated"]["results"]
        if not page:
            break
        players += [r["player"]["id"] for r in page if r.get("player")]
        offset += 50
    added = 0
    for pid in players[: cfg["topPlayers"]]:
        try:
            res = api.query(HISTORY_Q, {"id": pid, "limit": cfg["gamesPerPlayer"]})["player"]["matchesPaginated"]["results"]
        except Exception as e:  # one bad player history should not stop the run
            print(f"  research: skipped a player ({str(e)[:80]})")
            continue
        for r in res:
            m = r["match"]
            if m["id"] in cache["matches"] or (m.get("startTime") or "") < cutoff:
                continue
            cache["matches"][m["id"]] = {"start": m.get("startTime"), "patch": (m.get("version") or {}).get("name"),
                                         "builds": builds_from_match(m, catalog, cfg["minPoints"])}
            added += 1
    cache.update({"updatedAt": now_iso(), "sampledPlayers": min(len(players), cfg["topPlayers"]), "minPoints": cfg["minPoints"]})
    print(f"  research: {added} matches from {cache['sampledPlayers']} players")
    return cache


def damage_type(h: dict) -> str:
    """Same rule as docs/buildplans.js suggestionContext: marksmen physical, mages/enchanters magical, else ability icons."""
    classes = h.get("classes") or []
    if "SHARPSHOOTER" in classes:
        return "physical"
    if any(c in classes for c in ("MAGE", "ENCHANTER")):
        return "magical"
    desc = " ".join(a.get("menuDescription") or "" for a in h.get("abilities") or [] if a.get("key") not in ("BASIC", "PASSIVE"))
    return "magical" if desc.count("APIconBlue") > desc.count("ADIconOrange") else "physical"


def comp_profile(foes: list, dmg: dict) -> str:
    """Enemy team damage mix: PHYSICAL (4-5 physical), MAGICAL (4-5 magical) or MIXED."""
    p = sum(1 for f in foes if dmg.get(f) == "physical")
    return "PHYSICAL" if p >= 4 else "MAGICAL" if len(foes) - p >= 4 else "MIXED"


def aggregate(cache: dict, heroes: list[dict]) -> dict:
    """Per hero and lane: item counts and wins, buy position, item minutes, common 3-item openings,
    and the same split by enemy laner and enemy class. Counts always travel with the numbers."""
    cls = {h["slug"]: (h.get("classes") or ["OTHER"])[0] for h in heroes}
    dmg = {h["slug"]: damage_type(h) for h in heroes}
    out: dict = {}
    roles: dict = {}
    n_builds = 0

    def bucket():
        return {"games": 0, "wins": 0, "items": {}, "mins": [], "open": {}, "early": {},
                "g10": [0, 0], "ahead": [0, 0], "behind": [0, 0], "len": [[0, 0], [0, 0], [0, 0]], "kda": [0, 0, 0, 0]}

    def add(b, x):
        b["games"] += 1
        b["wins"] += x["win"]
        for k, n in enumerate(x["items"]):
            s = b["items"].setdefault(n, [0, 0, 0])   # games, wins, sum of buy positions
            s[0] += 1; s[1] += x["win"]; s[2] += k
        b["mins"].append(x["mins"])
        if len(x["items"]) >= 3:
            o = b["open"].setdefault(">".join(x["items"][:3]), [0, 0]); o[0] += 1; o[1] += x["win"]
            # Items in the first three slots (bought by ~20 min): less biased by "winners finish more items".
            for n in x["items"][:3]:
                e = b["early"].setdefault(n, [0, 0]); e[0] += 1; e[1] += x["win"]
        g = x.get("g10")
        if g is not None:
            b["g10"][0] += g; b["g10"][1] += 1
            side = b["ahead"] if g >= 500 else b["behind"] if g <= -500 else None
            if side is not None:
                side[0] += 1; side[1] += x["win"]
        d = x.get("dur") or 0
        if d:
            L = b["len"][0 if d < 25 else 1 if d < 35 else 2]; L[0] += 1; L[1] += x["win"]
        if x.get("k") is not None:
            b["kda"][0] += x["k"] or 0; b["kda"][1] += x["d"] or 0; b["kda"][2] += x["a"] or 0; b["kda"][3] += 1

    for m in cache.get("matches", {}).values():
        for x in m.get("builds", []):
            n_builds += 1
            hr = out.setdefault(x["hero"], {}).setdefault(x["role"], {**bucket(), "vs": {}, "vsClass": {}, "vsComp": {}})
            add(hr, x)
            add(roles.setdefault(x["role"], bucket()), x)
            if x.get("enemy"):
                add(hr["vs"].setdefault(x["enemy"], bucket()), x)
                add(hr["vsClass"].setdefault(cls.get(x["enemy"], "OTHER"), bucket()), x)
            if len(x.get("foes") or []) == 5:
                add(hr["vsComp"].setdefault(comp_profile(x["foes"], dmg), bucket()), x)

    def finish(b, top_items=40, top_open=5):
        med = []
        for k in range(6):
            v = sorted(t[k] for t in b["mins"] if len(t) > k and t[k] is not None)
            med.append(v[len(v) // 2] if len(v) >= 3 else None)
        items = dict(sorted(b["items"].items(), key=lambda kv: -kv[1][0])[:top_items])
        opens = [{"items": k.split(">"), "games": v[0], "wins": v[1]}
                 for k, v in sorted(b["open"].items(), key=lambda kv: -kv[1][0])[:top_open] if v[0] >= 2]
        early = dict(sorted(((k, v) for k, v in b["early"].items() if v[0] >= 3), key=lambda kv: -kv[1][0])[:top_items])
        n = b["kda"][3]
        return {"games": b["games"], "wins": b["wins"], "items": items, "minutes": med, "openings": opens, "early": early,
                "lane": {"lead10": round(b["g10"][0] / b["g10"][1]) if b["g10"][1] else None, "leadGames": b["g10"][1],
                         "ahead": b["ahead"], "behind": b["behind"]},
                "length": b["len"], "kda": [round(b["kda"][i] / n, 1) for i in range(3)] if n else None}

    heroes_out = {}
    for hero, by_role in out.items():
        for role, b in by_role.items():
            r = finish(b, 25)
            r["vs"] = {e: finish(v, 6, 2) for e, v in b["vs"].items() if v["games"] >= 2}   # one-off matchups are noise
            r["vsClass"] = {c: finish(v, 10, 3) for c, v in b["vsClass"].items()}
            r["vsComp"] = {c: finish(v, 12, 2) for c, v in b["vsComp"].items()}
            heroes_out.setdefault(hero, {})[role] = r
    patches = sorted({m.get("patch") for m in cache.get("matches", {}).values() if m.get("patch")})
    return {"schema": SCHEMA, "updatedAt": now_iso(), "source": "pred.gg ranked matches of top leaderboard players",
            "sampledPlayers": cache.get("sampledPlayers"), "minPoints": cache.get("minPoints"),
            "matchCount": len(cache.get("matches", {})), "builds": n_builds, "patches": patches,
            "roles": {k: finish(v, 60) for k, v in roles.items()}, "heroes": heroes_out}
