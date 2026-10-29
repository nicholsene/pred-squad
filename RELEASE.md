# Match planning release

Implemented:
- Durable Picks-to-Match handoff, explicit identity selection, editable pre-match plan, ready/live/finished stages.
- Role and hero draft locks, excluded heroes, familiar-pick filter and distinct allied suggestions.
- Role-specific matchup evidence without counting the same game twice; recommendation scores are not calibrated win probabilities.
- Live rear-camera capture with loading-card, scoreboard-row and minimap alignment overlays; frames stay on-device and camera tracks stop on capture/cancel/background.
- Review/correct/cancel loading-screen and scoreboard scans; version-checked atomic apply and guarded undo.
- Manual objective observations and editable countdowns; assisted minimap timer OCR with crop selection and screenshot match time.
- Shared-room batch updates, server-side counter increments, operation deduplication, version conflicts, retry and persisted outbox.
- Recent/patch filters, descriptive personal progress and manual completed-match linkage for coaching.
- Refresh schedule at :00 and :30 UTC each hour, refresh after application code merges, independent dataset retention and refresh heartbeat.
- Offline shell updates and regression CI including browser handoff checks.

The additive database/room_batch.sql function has been applied to the existing pred-squad project and tested with a rolled-back temporary room. It uses SECURITY INVOKER and the existing patch_room API. Existing public-read and room-code editing policies are unchanged; rooms must not contain private information. Identity selection is a display preference, not authentication.

## Verification

pip install -r requirements.txt
python tests/test_fetch.py
node tests/test_engine.js
node tests/test_session.js
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
node tests/test_browser.cjs

Set CHROME_PATH to use an existing Chrome binary for browser tests.

## Deliberate follow-up work

- Automatic minimap/icon detection requires a labeled screenshot set across resolutions, orientations and patches. The current scanner reads a player-selected numeric countdown and requires confirmation.
- Patch-verified objective respawn rules: Taken now records a defeat without inventing a timer; enter or scan the visible countdown.
- Private rooms with authenticated membership, host permissions and abuse protection. Existing rooms are publicly readable.
- Item outcome adjustment by hero/role/patch/duration and current-inventory/gold-aware purchases. Existing item analysis remains descriptive.
- Verified composition attributes, custom date ranges, saved coaching notes and gold-curve visualizations.
- Chronological calibration and evaluation of recommendation scores; recommendation percentages are not advertised as match win probabilities.
- Production multi-device reconnect soak testing and a separate held-out photo set.

GitHub Actions schedules can be delayed. The UI reports actual check time rather than claiming an exact wall-clock refresh.

## User-photo OCR benchmark

Measured on ten user-provided display photos (four loading screens and six scoreboards). Originals remain local and are not committed. Labels and an optional benchmark runner are included in tests/ocr-examples.json and tests/benchmark_ocr.cjs.

The assisted workflow requires selecting four display corners; it is not automatic screen detection. Compared with the original full-photo reader:

| Field | Before | Assisted workflow |
| --- | --- | --- |
| Hero positions | 61/100 | 92/100 |
| Levels | 50/60 | 51/60 |
| K/D/A fields | 147/180 | 153/180 |
| Gold | 36/60 | 37/60 |

Unresolved hero positions are left blank. Original-photo numeric reads are retained, corrected crops fill unread fields, and disagreements are highlighted for review. This set was used during implementation; these are development-set results, not held-out accuracy claims. Minimap photos were not included.

To reproduce locally: set OCR_PHOTOS to the private image folder, OCR_RECTIFY=1, then run node tests/benchmark_ocr.cjs. The label file includes manually marked display corners to reproduce the four-tap preparation step. Raw benchmark results and corrected crops are saved only under ignored .test-artifacts/.

## HUD references and screen-on verification

Camera guides include full gameplay HUD, minimap-only, loading screen and scoreboard modes. Full-HUD map/clock boxes are approximate because HUD scale and platform can vary. The user confirms the timer crop after capture.

Omeda's V1.11.2 minimap examples show numeric jungle counters, including seconds-only and `2m+` labels: https://www.predecessorgame.com/en-US/news/patch-notes/v1-11-2-patch-notes . The timer reader accepts exact seconds and m:ss; approximate labels never become an exact respawn time. Reference images remain outside the repository.

Screen-on reports an active lock only after the browser grants it; leaving Match or backgrounding suspends it, returning reacquires when requested, and a failed request offers Retry. Unsupported browsers have a clear unavailable state. Browser tests simulate acquisition, tab departure, reacquisition and manual off. Actual device OS power-saving policies can still release a browser wake lock.

The full-HUD minimap guide was checked against the official Steam gameplay screenshot (map at the upper right, below the team strip): https://store.steampowered.com/app/961200/Predecessor/ . Position remains approximate to accommodate HUD scaling.
