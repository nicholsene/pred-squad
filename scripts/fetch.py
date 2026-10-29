"""Pull squad matches, hero data and current-patch meta from pred.gg.

Writes three files into docs/data/:
  heroes.json   public hero data (abilities, recommended skill order)
  matches.json  every match with at least one squad member (incremental)
  meta.json     current-patch hero/role win rates, lane matchups, core builds
  items.json    item catalogue: cost, stats, type
  ranks.json    ranked ladder (rank name -> points range)

Only squad members are identified in matches.json. Other players are kept
as hero/role/team/stats with no name or id.

Usage:  python scripts/fetch.py [--skip-meta] [--skip-matches]
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from predgg import PredGG, PredGGError  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
CONFIG = json.loads((ROOT / "config" / "squad.json").read_text())

HEROES_Q = """
{ heroes { id slug data { displayName roles classes recommendedSkills
    abilities { key displayName simplifiedDescription cooldown cost } } } }
"""

VERSIONS_Q = "{ versions { id name releaseDate } }"

# Ranked ladder: points range of every rank, per season split.
RATINGS_Q = "{ ratings { name group startTime endTime ranks { name ratingMin ratingMax tierIdx divisionIdx } } }"

# Item catalogue: price, stats and type for every item (public data).
ITEMS_Q = """
{ items { data { name displayName totalPrice price slotType rarity aggressionType class isHidden
    stats { stat value } icon smallIcon buildsFrom { name } blocks { name } blockedBy { name } } } }
"""

MP_FIELDS = """
  player { id } role team hero { slug }
  kills deaths assists level gold goldSpent wardsPlaced wardsDestroyed
  heroDamage heroDamageTaken totalDamageMitigated minionsKilled
  laneMinionsKilled neutralMinionsEnemyJungle neutralMinionsTeamJungle
  totalDamageDealtToObjectives totalDamageDealtToStructures
  inventoryItemData { name } goldEarnedAtInterval
  rating { points rank { name } }
"""

MATCHES_Q = """
query($id: ID!, $limit: Int, $offset: Int, $modes: [GameMode!]) {
  player(by: {id: $id}) {
    matchesPaginated(limit: $limit, offset: $offset, filter: {gameModes: $modes}) {
      totalCount
      results { match {
        id startTime duration gameMode winningTeam version { name }
        matchPlayers { %s }
      } }
    }
  }
}
""" % MP_FIELDS

MATCH_Q = """
query($id: ID!) { match(by: {id: $id}) {
  id startTime duration gameMode winningTeam version { name }
  matchPlayers { %s }
} }
""" % MP_FIELDS

# Win rates per hero/role are available to third-party apps.
META_GENERAL_Q = """
query($slug: String!, $f: HeroGeneralStatisticFilterInput) {
  hero(by: {slug: $slug}) { generalStatistic(filter: $f) { result { matchesPlayed matchesWon } } }
}
"""

# Lane matchups and core builds were "Forbidden" for third-party apps when this was
# written (Oct 2026), even with a user-authorised token. Tried once per run; if pred.gg
# ever grants access they start appearing automatically.
META_EXTRA_Q = """
query($slug: String!, $mf: HeroMatchupStatisticFilterInput, $bf: HeroCoreBuildFilterInput) {
  hero(by: {slug: $slug}) {
    matchupStatistic(filter: $mf, metric: WINRATE, isAlly: false, sameRole: true) {
      results { matchupHero { slug } matchesPlayed winrate }
    }
    coreBuild(filter: $bf, limit: 3) {
      results { core1Item { name data { displayName } } core2Item { name data { displayName } }
                core3Item { name data { displayName } } matchesPlayedBuildOrder matchesWonBuildOrder }
    }
  }
}
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(name: str, default):
    p = DATA / name
    return json.loads(p.read_text()) if p.exists() else default


def save(name: str, obj) -> bool:
    """Write obj, but leave the file untouched if only the updatedAt stamp would change
    (keeps the scheduled job from committing every run)."""
    DATA.mkdir(parents=True, exist_ok=True)
    p = DATA / name
    if p.exists() and isinstance(obj, dict):
        old = json.loads(p.read_text())
        strip = lambda d: {k: v for k, v in d.items() if k != "updatedAt"} if isinstance(d, dict) else d
        if name != "status.json" and strip(old) == strip(obj):
            return False
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(text)
    tmp.replace(p)
    return True


def pct(x):
    """pred.gg win rates may come as 0-1 or 0-100; normalise to 0-100."""
    if x is None:
        return None
    return round(x * 100, 2) if x <= 1 else round(x, 2)


# ---------------- heroes ----------------
def fetch_ranks(api: PredGG) -> dict:
    """The current split's rank ladder (name -> points range)."""
    rs = [r for r in api.query(RATINGS_Q)["ratings"] if r.get("ranks")]
    cur = max(rs, key=lambda r: r.get("startTime") or "")
    ranks = sorted(({"name": k["name"], "min": k["ratingMin"], "max": min(k["ratingMax"], 99999)} for k in cur["ranks"]), key=lambda k: k["min"])
    return {"season": cur["name"], "ranks": ranks}


def fetch_items(api: PredGG) -> list[dict]:
    out = []
    for it in api.query(ITEMS_Q)["items"]:
        d = it.get("data") or {}
        if not d.get("name"):
            continue   # hidden items are kept: upgraded crests and jungle items show up in inventories
        out.append({"name": d["name"], "label": d.get("displayName") or d["name"],
                    "cost": d.get("totalPrice") or d.get("price") or 0, "slot": d.get("slotType"),
                    "rarity": d.get("rarity"), "type": d.get("aggressionType"), "class": d.get("class"),
                    "hidden": bool(d.get("isHidden")),
                    "icon": d.get("icon"), "smallIcon": d.get("smallIcon"),
                    "buildsFrom": [x["name"] for x in d.get("buildsFrom", []) if x.get("name")],
                    "blocks": [x["name"] for x in d.get("blocks", []) if x.get("name")],
                    "blockedBy": [x["name"] for x in d.get("blockedBy", []) if x.get("name")],
                    "stats": {s["stat"]: s["value"] for s in (d.get("stats") or []) if s.get("stat")}})
    return sorted(out, key=lambda x: x["label"])


def fetch_heroes(api: PredGG) -> list[dict]:
    data = api.query(HEROES_Q)
    heroes = []
    for h in data["heroes"]:
        d = h.get("data") or {}
        if not h.get("slug"):
            continue
        heroes.append({
            "id": h["id"],
            "slug": h["slug"],
            "name": d.get("displayName") or h["slug"].title(),
            "roles": d.get("roles") or [],
            "classes": d.get("classes") or [],
            "skills": d.get("recommendedSkills") or [],
            "abilities": [
                {"key": a["key"], "name": a["displayName"], "desc": a.get("simplifiedDescription") or "",
                 "cooldown": a.get("cooldown")}
                for a in (d.get("abilities") or [])
            ],
        })
    heroes.sort(key=lambda h: h["name"] or "")
    return heroes


def current_patch(api: PredGG) -> tuple[str, list[str]]:
    """Latest version name and the ids of every version in the same major.minor line."""
    vs = api.query(VERSIONS_Q)["versions"]
    vs = [v for v in vs if v.get("releaseDate")]
    vs.sort(key=lambda v: v["releaseDate"])
    latest = vs[-1]["name"]
    line = ".".join(latest.split(".")[:2])
    ids = [v["id"] for v in vs if v["name"] == line or v["name"].startswith(line + ".")]
    return latest, ids


# ---------------- matches ----------------
def normalise_match(m: dict, squad_ids: dict[str, str]) -> dict:
    players = []
    for mp in m["matchPlayers"]:
        pid = (mp.get("player") or {}).get("id")
        players.append({
            "squad": squad_ids.get(pid),          # squad key or None
            "hero": (mp.get("hero") or {}).get("slug"),
            "role": mp.get("role"),
            "team": mp.get("team"),
            "k": mp.get("kills", 0), "d": mp.get("deaths", 0), "a": mp.get("assists", 0),
            "lvl": mp.get("level"),
            "gold": mp.get("gold", 0), "spent": mp.get("goldSpent", 0),
            "wards": mp.get("wardsPlaced", 0), "wardsKilled": mp.get("wardsDestroyed", 0),
            "heroDmg": mp.get("heroDamage", 0), "taken": mp.get("heroDamageTaken", 0),
            "mitigated": mp.get("totalDamageMitigated", 0),
            "cs": mp.get("minionsKilled", 0), "laneCs": mp.get("laneMinionsKilled", 0),
            "enemyJungle": mp.get("neutralMinionsEnemyJungle", 0),
            "obj": mp.get("totalDamageDealtToObjectives", 0),
            "towers": mp.get("totalDamageDealtToStructures", 0),
            "items": [i["name"] for i in (mp.get("inventoryItemData") or []) if i and i.get("name")],
            "goldCurve": mp.get("goldEarnedAtInterval") or [],
            # rank points going into the match (ranked games only; None otherwise)
            "rp": (mp.get("rating") or {}).get("points"),
            "rank": ((mp.get("rating") or {}).get("rank") or {}).get("name"),
        })
    return {
        "id": m["id"],
        "start": m.get("startTime"),
        "duration": m.get("duration"),
        "mode": m.get("gameMode"),
        "patch": (m.get("version") or {}).get("name"),
        "winner": m.get("winningTeam"),
        "players": players,
    }


def fetch_matches(api: PredGG, existing: dict) -> dict:
    squad_ids = {p["predId"]: p["key"] for p in CONFIG["players"]}
    by_id = {m["id"]: m for m in existing.get("matches", [])}
    page = 25
    for p in CONFIG["players"]:
        offset, new = 0, 0
        while offset < CONFIG.get("maxMatchesPerPlayer", 500):
            data = api.query(MATCHES_Q, {"id": p["predId"], "limit": page, "offset": offset,
                                         "modes": CONFIG["gameModes"]})
            res = (data["player"] or {}).get("matchesPaginated") or {}
            rows = res.get("results") or []
            if not rows:
                break
            fresh = 0
            for row in rows:
                m = row["match"]
                if m["id"] not in by_id:
                    fresh += 1
                by_id[m["id"]] = normalise_match(m, squad_ids)
            new += fresh
            offset += page
            if fresh == 0:          # whole page already known -> caught up
                break
        print(f"  {p['key']}: {new} new matches")
    # backfill matches stored before items/gold curves were collected
    old = [mid for mid, m in by_id.items() if m["players"] and not all(k in m["players"][0] for k in ("items", "rp"))]
    for mid in old[:CONFIG.get("backfillPerRun", 150)]:
        try:
            m = api.query(MATCH_Q, {"id": mid}).get("match")
            if m:
                by_id[mid] = normalise_match(m, squad_ids)
        except PredGGError as e:
            print(f"  backfill {mid}: {e}")
    if old:
        print(f"  backfilled {min(len(old), CONFIG.get('backfillPerRun', 150))} of {len(old)} older matches")
    matches = sorted(by_id.values(), key=lambda m: m["start"] or "", reverse=True)
    return {"updatedAt": now_iso(), "matches": matches}


# ---------------- meta ----------------
def fetch_meta(api: PredGG, heroes: list[dict], patch: str, version_ids: list[str]) -> dict:
    out = {"updatedAt": now_iso(), "patch": patch, "mode": "RANKED", "heroes": {},
           "matchupsAvailable": True}
    modes = ["RANKED"]
    failures = []
    for h in heroes:
        for role in h["roles"]:
            f = {"roles": [role], "versions": version_ids, "gameModes": modes}
            try:
                d = api.query(META_GENERAL_Q, {"slug": h["slug"], "f": f})["hero"]
            except PredGGError as e:
                failures.append(f"{h['slug']}/{role}: {e}")
                continue
            g = ((d.get("generalStatistic") or {}).get("result")) or {}
            games, wins = g.get("matchesPlayed") or 0, g.get("matchesWon") or 0
            matchups, builds = [], []
            if out["matchupsAvailable"]:
                try:
                    x = api.query(META_EXTRA_Q, {"slug": h["slug"], "mf": {**f, "matchupRoles": [role]}, "bf": f})["hero"]
                    matchups = [
                        {"hero": r["matchupHero"]["slug"], "games": r["matchesPlayed"], "wr": pct(r["winrate"])}
                        for r in ((x.get("matchupStatistic") or {}).get("results") or []) if r.get("matchupHero")
                    ]
                    for b in ((x.get("coreBuild") or {}).get("results") or []):
                        items = [((b.get(k) or {}).get("data") or {}).get("displayName") or (b.get(k) or {}).get("name")
                                 for k in ("core1Item", "core2Item", "core3Item")]
                        n, w = b.get("matchesPlayedBuildOrder") or 0, b.get("matchesWonBuildOrder") or 0
                        builds.append({"items": [i for i in items if i], "games": n,
                                       "wr": round(100 * w / n, 2) if n else None})
                except PredGGError as e:
                    if "Forbidden" in str(e):
                        out["matchupsAvailable"] = False
                        print("  matchups/builds not available to this app; skipping them")
                    else:
                        print(f"  meta extra {h['slug']}/{role}: {e}")
            out["heroes"].setdefault(h["slug"], {})[role] = {
                "games": games, "wins": wins,
                "wr": round(100 * wins / games, 2) if games else None,
                "matchups": matchups, "builds": builds,
            }
    if failures:
        raise PredGGError("Incomplete meta refresh; keeping last good meta: " + "; ".join(failures[:3]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-meta", action="store_true")
    ap.add_argument("--skip-matches", action="store_true")
    args = ap.parse_args()

    api = PredGG()
    succeeded = set()
    previous = load("status.json", {})
    status = {"updatedAt": now_iso(), "authenticated": api.has_credentials, "errors": [],
              "datasets": previous.get("datasets", {})}

    def refresh(name, callback):
        record = dict(status["datasets"].get(name, {}))
        record["lastChecked"] = now_iso()
        try:
            obj = callback()
            # Reject empty or malformed responses rather than replacing usable data.
            for key in ("heroes", "items", "matches", "ranks"):
                if key in obj and (not isinstance(obj[key], (list, dict)) or (key != "matches" and not obj[key])):
                    raise PredGGError(f"Invalid {key} dataset")
            changed = save(name, obj)
            record["lastSuccess"] = now_iso()
            if changed:
                record["lastChanged"] = now_iso()
            record.pop("error", None)
            succeeded.add(name)
            return obj
        except (PredGGError, ValueError, KeyError, TypeError) as e:
            record["error"] = str(e)
            status["errors"].append(f"{name}: {e}")
            print(f"  {name}: {e}")
            return load(name, {})
        finally:
            status["datasets"][name] = record

    refresh("squad.json", lambda: {"players": [{"key": p["key"], "label": p["label"]} for p in CONFIG["players"]], "targets": CONFIG["targets"]})
    hero_file = refresh("heroes.json", lambda: {"updatedAt": now_iso(), "patch": current_patch(api)[0], "heroes": fetch_heroes(api)})
    refresh("ranks.json", lambda: {"updatedAt": now_iso(), **fetch_ranks(api)})
    item_file = refresh("items.json", lambda: {"updatedAt": now_iso(), "patch": current_patch(api)[0], "items": fetch_items(api)})
    from build_item_templates import build as build_templates
    from patch_review import build_review
    import hashlib
    refresh("item-templates.json", lambda: build_templates(item_file, load("item-templates.json", None)))
    policy_path = ROOT / "config" / "patch-policy.json"
    baseline_path = ROOT / "config" / "patch-baseline.json"
    policy = json.loads(policy_path.read_text()) if policy_path.exists() else {}
    baseline = json.loads(baseline_path.read_text()) if baseline_path.exists() else None
    logic = hashlib.sha256((ROOT / "docs/counterbuild.js").read_bytes()).hexdigest()
    save("patch-review.json", build_review(baseline, hero_file, item_file, {**policy,
         "sourceComplete": {"heroes.json", "items.json"}.issubset(succeeded),
         "sourceErrors": [s for s in status["errors"] if s.startswith(("heroes.json:", "items.json:"))],
         "expectedPatch": hero_file.get("patch") if "heroes.json" in succeeded else None,
         "counterLogicFingerprint": logic}))
    if not api.has_credentials:
        status["errors"].append("No pred.gg credentials; retaining match history and meta.")
    else:
        if not args.skip_matches:
            refresh("matches.json", lambda: fetch_matches(api, load("matches.json", {})))
        if not args.skip_meta:
            def meta_data():
                patch, ids = current_patch(api)
                if hero_file.get("patch") != patch:
                    raise PredGGError("Hero catalogue is stale; keeping previous meta")
                return fetch_meta(api, hero_file.get("heroes", []), patch, ids)
            refresh("meta.json", meta_data)
    if not status["errors"]:
        status["lastSuccess"] = now_iso()
    elif previous.get("lastSuccess"):
        status["lastSuccess"] = previous["lastSuccess"]
    save("status.json", status)  # heartbeat: actual check time, even if match history is unchanged
    return 1 if status["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
