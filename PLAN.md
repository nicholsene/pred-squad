# Squad Planner — shared plan and status

**This is the single source of truth for plans, priorities, decisions and status.**
Both Codex and Claude (Cowork) read this before starting and update it after finishing.
Owner and decision-maker: Eric (stealinNICKELS). Players: stealinNICKELS, DiMu, inFamoUs.

## How we work (both agents)

1. `git pull --rebase origin main` before starting. Read **Priorities** and the newest **Status log** entries.
2. Claim a priority by putting your name in its *Owner* column and setting *Status* to `in progress` in the same commit as your first change. Don't start a priority someone else owns. Ask Eric if unclear.
3. Small, tested changes may go straight to `main`; larger ones use a branch (`codex/…` or `claude/…`) and a PR. Rebase, don't force-push `main`.
4. Run the tests listed in `.github/workflows/test.yml` that touch your change before pushing.
5. When you finish (or stop), add a **Status log** entry at the top: date, who, what changed, what's verified, what's left. Keep it to a few lines.
6. Record any decision Eric makes in **Decisions**, with the date.
7. Never commit private photos, labels, credentials or `.scan-private/`. No paid APIs or services without Eric's approval.

Working runbooks (not plans): [COUNTERBUILD.md](COUNTERBUILD.md) (patch review and counter-build rules), [SCANNER_CORPUS.md](SCANNER_CORPUS.md) (private photo collection and review), [README.md](README.md) (setup). Earlier release notes are in [plans/archive/](plans/archive/).

## Goal

Help the squad win more: a phone-first page that shows records and stats, suggests lanes, heroes and builds conditioned on **who is playing together, in which lane, on which hero**, and gives live in-match strategy from photos (loading screen, scoreboard, minimap) and a shared room.

## Decisions

| Date | Decision | By |
|---|---|---|
| 2026-11-01 | Keep private scan-photo upload switched on while the scanner is being trained. | Eric |
| 2026-11-01 | One shared plan file (this one) for Codex and Claude; release notes archived. | Eric |
| 2026-11-01 | New game patches show a warning on item advice instead of blocking it until a manual sign-off. (Nobody in the squad will run the approval script.) | Claude, per Eric's go-ahead |
| 2026-10-28 | pred.gg data only via its API with the squad's app credentials (GitHub secrets). Restricted endpoints (lane matchups, core builds) stay unused. | Eric |
| open | Repo is **public**; README says pred.gg's terms favour private. Eric to decide: make private (Pages then needs GitHub Pro or local use) or keep public and fix README. | Eric |

## Priorities

| # | Work | Owner | Status | Notes |
|---|---|---|---|---|
| 1 | **Lobby difficulty**: average opponent rank in Records and Stats; solo vs pairs vs trio; last-10 ranked games trend vs wins/losses | Claude | in progress | Rank points per player per match are fetched (`rp`, `rank`) and `docs/data/ranks.json` holds the ladder. Ranked games only — standard games carry no rank. |
| 2 | **Patch gate warns instead of blocks** | Claude | in progress | See Decisions. |
| 3 | **Item icon recognition** in scoreboard/build photos | Claude (next) | not started | Build on Codex's `itemvision.js` / `item-templates.json`. Test answers: the six end-of-match photos match recorded games exactly, so pred.gg final inventories label every slot. |
| 4 | Scanner training from the private corpus (daily review) | Codex | ongoing | Per SCANNER_CORPUS.md. 164 photos collected and reviewed as of 2026-11-01. |
| 5 | Personal profiles and squad build optimizer depth (from the former NEXT_RELEASE plan) | — | later | Keep chronological evaluation and no-leakage rules. Revisit when there are more games; ~126 matches is thin for per-hero models. |
| 6 | Data refresh frequency | — | open | GitHub throttles the 30-min schedule; real runs are ~every 6 h. Options: accept, or move the fetch to a Supabase scheduled function. |
| 7 | Code readability | — | open | Several files have 1,000–2,600-character lines (match.js, free-scan.js, planning.js, match-focus.js). Reformat when next touched. |

## What exists (short map)

- `scripts/fetch.py` (GitHub Actions `update.yml`) → `docs/data/*.json`: matches with all 10 players' stats, final items, gold curve and rank points; heroes; items; ranks; meta; patch review.
- `docs/engine.js` records/estimates; `itemlab.js` item value and counter matrix; `counterbuild.js`, `optimizer.js`, `buildplans.js`, `planning.js`, `profiles.js` build advice; `session.js`, `match.js`, `match-focus.js` Match; `free-ocr.js`, `free-scan.js`, `numeric-ocr.js`, `scoreboard.js`, `scan.js`, `photo-router.js` photo reading (PaddleOCR + digit templates, all on device); `scan-archive.js` private upload queue.
- Supabase project `hijfyfysjneqhqgbsypx`: `rooms` (+ `patch_room`, `room_batch`) for live rooms; `scan_*` tables, `scan-corpus` bucket and `scan-collector` edge function for the photo corpus.

## Known limits

- pred.gg gives final inventories only (no purchase order or times), no combat events or death causes.
- Ranked rank points exist only for ranked matches.
- Recommendation scores are blends of personal results and meta, not calibrated win probabilities.
- Known risk, accepted for now: the photo collector lets any device self-register, so the upload address could be abused up to the 800 MB cap. Add a shared squad key if that matters.

## Status log (newest first)

- **2026-11-01 · Claude** — Reviewed Codex's work (74 commits): all unit tests and the Chrome halves of the browser suites pass; live site loads ~0.5 MB on a phone. Created this PLAN.md, AGENTS.md and CLAUDE.md; archived release notes to `plans/archive/`. Starting priorities 1–2.
- **2026-10-30/31 · Codex** — Free on-device PaddleOCR reader, hands-free photo intake, private scan corpus, compact Match, starting builds and styles, tactical updates, solo/squad next-item optimizer, history windows. Details in `plans/archive/`.
- **2026-10-29 · Claude** — Scoreboard scanner (digit templates), game-state calls, item lab and counter matrix, ranked-only filter, rank-point fetching.
