"""Research catalogue: what high-ranked players build, by hero, lane and enemy laner.

Runs inside fetch.py once a day, and only while the GitHub repo is private (Eric, 2026-11-01:
"keep it private, only for my friends"). Stores no player names or ids: each kept build is
hero, lane, finished-item order, result, enemy laner, rank points and estimated item minutes.

  research/cache.json      kept builds from recent matches (incremental, trimmed by age)
  docs/data/research.json  aggregates the app reads
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "research" / "cache.json"
DEFAULTS = {"topPlayers": 200, "gamesPerPlayer": 20, "minPoints": 1200, "keepDays": 30}

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
        id startTime gameMode winningTeam version { name }
        matchPlayers { role team hero { slug } inventoryItemData { name } goldEarnedAtInterval rating { points } }
      } }
    }
  }
}"""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def repo_is_private() -> bool:
    """True only when GitHub confirms the repo is private. Anything uncertain counts as public."""
    import os
    import requests
    repo, token = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN")
    if not repo or not token:
        return os.environ.get("RESEARCH_FORCE") == "1"   # local runs only
    try:
        r = requests.get(f"https://api.github.com/repos/{repo}", headers={"Authorization": f"Bearer {token}"}, timeout=20)
        return r.ok and r.json().get("private") is True
    except Exception:
        return False


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
        enemy = next(((q.get("hero") or {}).get("slug") for q in mps
                      if q.get("team") != p.get("team") and q.get("role") == p.get("role")), None)
        out.append({"hero": hero, "role": p["role"], "items": finals, "mins": mins, "rp": round(pts),
                    "win": int(p.get("team") == m.get("winningTeam")), "enemy": enemy})
    return out


def collect(api, catalog: dict, cfg: dict | None = None) -> dict:
    cfg = {**DEFAULTS, **(cfg or {})}
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {"matches": {}}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=cfg["keepDays"])).strftime("%Y-%m-%dT%H:%M:%SZ")
    cache["matches"] = {k: v for k, v in cache["matches"].items() if v.get("start", "") >= cutoff}
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
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, separators=(",", ":")))
    print(f"  research: {added} new matches, {len(cache['matches'])} kept")
    return cache


def aggregate(cache: dict, heroes: list[dict]) -> dict:
    """Per hero and lane: item counts and wins, buy position, item minutes, common 3-item openings,
    and the same split by enemy laner and enemy class. Counts always travel with the numbers."""
    cls = {h["slug"]: (h.get("classes") or ["OTHER"])[0] for h in heroes}
    out: dict = {}
    roles: dict = {}
    n_builds = 0

    def bucket():
        return {"games": 0, "wins": 0, "items": {}, "mins": [], "open": {}}

    def add(b, x):
        b["games"] += 1
        b["wins"] += x["win"]
        for k, n in enumerate(x["items"]):
            s = b["items"].setdefault(n, [0, 0, 0])   # games, wins, sum of buy positions
            s[0] += 1; s[1] += x["win"]; s[2] += k
        b["mins"].append(x["mins"])
        if len(x["items"]) >= 3:
            o = b["open"].setdefault(">".join(x["items"][:3]), [0, 0]); o[0] += 1; o[1] += x["win"]

    for m in cache.get("matches", {}).values():
        for x in m.get("builds", []):
            n_builds += 1
            hr = out.setdefault(x["hero"], {}).setdefault(x["role"], {**bucket(), "vs": {}, "vsClass": {}})
            add(hr, x)
            add(roles.setdefault(x["role"], bucket()), x)
            if x.get("enemy"):
                add(hr["vs"].setdefault(x["enemy"], bucket()), x)
                add(hr["vsClass"].setdefault(cls.get(x["enemy"], "OTHER"), bucket()), x)

    def finish(b, top_items=40, top_open=5):
        med = []
        for k in range(6):
            v = sorted(t[k] for t in b["mins"] if len(t) > k and t[k] is not None)
            med.append(v[len(v) // 2] if len(v) >= 3 else None)
        items = dict(sorted(b["items"].items(), key=lambda kv: -kv[1][0])[:top_items])
        opens = [{"items": k.split(">"), "games": v[0], "wins": v[1]}
                 for k, v in sorted(b["open"].items(), key=lambda kv: -kv[1][0])[:top_open] if v[0] >= 2]
        return {"games": b["games"], "wins": b["wins"], "items": items, "minutes": med, "openings": opens}

    heroes_out = {}
    for hero, by_role in out.items():
        for role, b in by_role.items():
            r = finish(b, 25)
            r["vs"] = {e: finish(v, 6, 2) for e, v in b["vs"].items() if v["games"] >= 2}   # one-off matchups are noise
            r["vsClass"] = {c: finish(v, 10, 3) for c, v in b["vsClass"].items()}
            heroes_out.setdefault(hero, {})[role] = r
    patches = sorted({m.get("patch") for m in cache.get("matches", {}).values() if m.get("patch")})
    return {"updatedAt": now_iso(), "source": "pred.gg ranked matches of top leaderboard players",
            "sampledPlayers": cache.get("sampledPlayers"), "minPoints": cache.get("minPoints"),
            "matches": len(cache.get("matches", {})), "builds": n_builds, "patches": patches,
            "roles": {k: finish(v, 60) for k, v in roles.items()}, "heroes": heroes_out}
