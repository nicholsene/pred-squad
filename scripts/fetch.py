"""Pull squad matches, hero data and current-patch meta from pred.gg.

Writes three files into docs/data/:
  heroes.json   public hero data (abilities, recommended skill order)
  matches.json  every match with at least one squad member (incremental)
  meta.json     current-patch hero/role win rates, lane matchups, core builds

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

MP_FIELDS = """
  player { id } role team hero { slug }
  kills deaths assists level gold goldSpent wardsPlaced wardsDestroyed
  heroDamage heroDamageTaken totalDamageMitigated minionsKilled
  laneMinionsKilled neutralMinionsEnemyJungle neutralMinionsTeamJungle
  totalDamageDealtToObjectives totalDamageDealtToStructures
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

META_Q = """
query($slug: String!, $f: HeroGeneralStatisticFilterInput, $mf: HeroMatchupStatisticFilterInput,
      $bf: HeroCoreBuildFilterInput) {
  hero(by: {slug: $slug}) {
    generalStatistic(filter: $f) { result { matchesPlayed matchesWon } }
    matchupStatistic(filter: $mf, metric: WINRATE, isAlly: false, sameRole: true) {
      results { matchupHero { slug } matchesPlayed winrate }
    }
    coreBuild(filter: $bf, limit: 3) {
      results { core1Item { name } core2Item { name } core3Item { name }
                matchesPlayedBuildOrder matchesWonBuildOrder }
    }
  }
}
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(name: str, default):
    p = DATA / name
    return json.loads(p.read_text()) if p.exists() else default


def save(name: str, obj) -> None:
    """Write obj, but leave the file untouched if only the updatedAt stamp would change
    (keeps the scheduled job from committing every run)."""
    DATA.mkdir(parents=True, exist_ok=True)
    p = DATA / name
    if p.exists() and isinstance(obj, dict):
        old = json.loads(p.read_text())
        strip = lambda d: {k: v for k, v in d.items() if k != "updatedAt"} if isinstance(d, dict) else d
        if strip(old) == strip(obj):
            return
    p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))


def pct(x):
    """pred.gg win rates may come as 0-1 or 0-100; normalise to 0-100."""
    if x is None:
        return None
    return round(x * 100, 2) if x <= 1 else round(x, 2)


# ---------------- heroes ----------------
def fetch_heroes(api: PredGG) -> list[dict]:
    data = api.query(HEROES_Q)
    heroes = []
    for h in data["heroes"]:
        d = h.get("data") or {}
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
    heroes.sort(key=lambda h: h["name"])
    return heroes


def current_patch(api: PredGG) -> tuple[str, list[str]]:
    """Latest version name and the ids of every version in the same major.minor line."""
    vs = api.query(VERSIONS_Q)["versions"]
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
    matches = sorted(by_id.values(), key=lambda m: m["start"] or "", reverse=True)
    return {"updatedAt": now_iso(), "matches": matches}


# ---------------- meta ----------------
def fetch_meta(api: PredGG, heroes: list[dict], patch: str, version_ids: list[str]) -> dict:
    out = {"updatedAt": now_iso(), "patch": patch, "mode": "RANKED", "heroes": {}}
    modes = ["RANKED"]
    for h in heroes:
        for role in h["roles"]:
            f = {"roles": [role], "versions": version_ids, "gameModes": modes}
            mf = {**f, "matchupRoles": [role]}
            try:
                d = api.query(META_Q, {"slug": h["slug"], "f": f, "mf": mf, "bf": f})["hero"]
            except PredGGError as e:
                print(f"  meta {h['slug']}/{role}: {e}")
                continue
            g = ((d.get("generalStatistic") or {}).get("result")) or {}
            games, wins = g.get("matchesPlayed") or 0, g.get("matchesWon") or 0
            matchups = [
                {"hero": r["matchupHero"]["slug"], "games": r["matchesPlayed"], "wr": pct(r["winrate"])}
                for r in ((d.get("matchupStatistic") or {}).get("results") or [])
                if r.get("matchupHero")
            ]
            builds = []
            for b in ((d.get("coreBuild") or {}).get("results") or []):
                items = [(b.get(k) or {}).get("name") for k in ("core1Item", "core2Item", "core3Item")]
                n, w = b.get("matchesPlayedBuildOrder") or 0, b.get("matchesWonBuildOrder") or 0
                builds.append({"items": [i for i in items if i], "games": n,
                               "wr": round(100 * w / n, 2) if n else None})
            out["heroes"].setdefault(h["slug"], {})[role] = {
                "games": games, "wins": wins,
                "wr": round(100 * wins / games, 2) if games else None,
                "matchups": matchups, "builds": builds,
            }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-meta", action="store_true")
    ap.add_argument("--skip-matches", action="store_true")
    args = ap.parse_args()

    api = PredGG()
    status = {"updatedAt": now_iso(), "authenticated": api.has_credentials, "errors": []}
    # the site only needs labels and targets, not pred.gg ids
    save("squad.json", {"players": [{"key": p["key"], "label": p["label"]} for p in CONFIG["players"]],
                        "targets": CONFIG["targets"]})

    print("heroes…")
    heroes = fetch_heroes(api)
    patch, version_ids = current_patch(api)
    save("heroes.json", {"updatedAt": now_iso(), "patch": patch, "heroes": heroes})
    print(f"  {len(heroes)} heroes, patch {patch}")

    if not api.has_credentials:
        msg = "No pred.gg API credentials set; match history and meta need them."
        print("  " + msg)
        status["errors"].append(msg)
    else:
        if not args.skip_matches:
            print("matches…")
            try:
                save("matches.json", fetch_matches(api, load("matches.json", {})))
            except PredGGError as e:
                status["errors"].append(f"matches: {e}")
                print(f"  {e}")
        if not args.skip_meta:
            print("meta…")
            try:
                save("meta.json", fetch_meta(api, heroes, patch, version_ids))
            except PredGGError as e:
                status["errors"].append(f"meta: {e}")
                print(f"  {e}")

    save("status.json", status)
    return 1 if status["errors"] and api.has_credentials else 0


if __name__ == "__main__":
    sys.exit(main())
