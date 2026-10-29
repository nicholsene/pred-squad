# Squad Planner (Predecessor)

A private tool for stealinNICKELS, DiMu and inFamoUs. It pulls your matches from
the [pred.gg](https://pred.gg) API every 30 minutes and shows:

1. **Who's playing:** pick any one, two or all three.
2. **Record together:** W–L for that exact group, and every lineup you've played (who was in which lane, on which heroes).
3. **Player stats:** for this group or all games, including your three targets (≤4 deaths, ≥4 wards, objective damage > 0), tower damage and unspent gold.
4. **Suggested lanes and heroes:** role assignments ranked by estimated win chance, with the top 3 heroes per player.
5. **Game plan:** pick each player's lane and hero, and optionally the enemy laner. You get the level-up order (PS5 buttons), abilities, this patch's core builds, best and worst lane matchups, and a swap suggestion if the matchup is bad.

Every recommendation is conditioned on **who is together, which lane, and which hero**.

## How the estimates work

Win chances blend three layers, each pulled toward the next when its sample is small:

| Layer | Pulled toward | Weight reaches 50% after |
|---|---|---|
| This player, this hero, this lane, **with this exact group** | the layer below | 8 games |
| This player, this hero, this lane, other games | the patch meta | 10 games |
| Patch meta win rate (pred.gg, ranked) | 50% | 200 games |

An enemy laner shifts the estimate by that matchup's meta win rate and by your own record against that hero. These are estimates, not predictions. With a few dozen games together they stay close to 50%. That's by design.

## Live match (Match tab)

- **Scan loading screen**: take a photo of the loading screen. It is read on the phone (Tesseract OCR, nothing uploaded) and fills in all ten heroes and lanes. Tap who's who if a gamertag wasn't read.
- **Keep screen on**: uses the Screen Wake Lock API so the phone doesn't dim or lock while the page is open (iOS 16.4+, Android Chrome). It turns on automatically when you join a room.
- **Live room**: *Start live match* gives a 5-letter code and a share link. Everyone who opens it sees the same lineup, clock and tracker; any player can change heroes, mark an enemy as fed, or log their deaths, wards and objective damage, and the strategy updates for everyone. Rooms are stored in a free Supabase project (`rooms` table, `patch_room` RPC, realtime) and are cleared after 3 days.
- **Strategy**: per-lane favored/even/tough estimates, the biggest threats (fed first), jungle and push calls, objective timers, and each player's rules (behind-mode at 3 deaths, ward pace, objective reminder).

## Setup

### 1. pred.gg API access (one time)
pred.gg's public API serves heroes and patches without an account. **Match history and stats need an OAuth token** from a pred.gg developer application:

1. Sign in to pred.gg.
2. Create an application on your account, then copy its **client ID** and **client secret**.
3. In this GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `PREDGG_CLIENT_ID`
   - `PREDGG_CLIENT_SECRET`

Never commit the secret to the repo.

### 2. Repo and hosting
- Keep the repo **private**. pred.gg's terms allow personal use and prohibit republishing their material.
- GitHub Pages on a free plan makes the site public, even from a private repo. Options:
  - **Open it locally:** clone the repo, then run `python -m http.server -d docs` and open http://localhost:8000.
  - **GitHub Pages** (Settings → Pages → branch `main`, folder `/docs`). The page is marked `noindex`, but anyone with the link can see it. Only do this if pred.gg is OK with it (ask in their Discord).

### 3. Updates
`.github/workflows/update.yml` runs every 30 minutes, pulls new matches and commits `docs/data/*.json` when something changed. Patch meta refreshes once a day. Run it by hand under **Actions → Update squad data → Run workflow** (tick *meta* to refresh meta too).

## Players
Edit `config/squad.json`. Each player needs their pred.gg ID, the UUID in their pred.gg profile URL. stealinNICKELS shows on pred.gg as `user-d4980932` because PS5 names are hidden; claiming the account on pred.gg may show the real name.

## Development
```
python tests/test_fetch.py   # offline fetcher test with fake API data
node tests/test_engine.js    # engine tests
python scripts/fetch.py      # live fetch (needs the secrets as env vars)
```

## Known gaps
- **Tested Oct 29, 2026:** app key (`client_credentials`, Basic auth at `https://pred.gg/api/oauth2/token`) can read match history and per-hero win rates.
- **Lane matchups and core builds are blocked ("Forbidden") for outside apps,** even with a user-approved token. Matchup advice therefore uses your own squad games against that hero. If pred.gg opens access, the fetcher picks it up automatically.
- Game modes pulled: RANKED and STANDARD (Quick Match). Edit `gameModes` in `config/squad.json` to change.
- Lane opponent = enemy in the same role. Carry and support also count each other's duo partner.
- Button labels assume the default PS5 layout (R2 basic, L1 primary, L2 secondary, R1 alternate, L1+R1 ultimate).
