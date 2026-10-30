# Gameplay performance review

Reviewed 2026-10-30. These findings come from source inspection and regression tests; they are not a phone CPU/FPS profile.

## Implemented locally: reuse measured history profiles

`docs/optimizer-ui.js` previously built every assigned player's historical profile before checking its existing render key. Repeated identical refreshes therefore traversed match history even when the optimizer returned without rendering anything.

Profiles now reuse a single cached result until lineup, session, effective historical cutoff, excluded match, history mode, patch, match count, match-array identity or catalogue identity changes. A replacement history array invalidates even when its length stays the same. Profile changes also invalidate optimizer results. Callers should replace history/catalogue arrays when replacing their contents, consistent with the current loaded-data model.

`tests/test_optimizer_cache.js` verifies that 100 unchanged refreshes avoid 500 redundant profile builds for a five-player lineup, and checks the invalidation paths. This measures avoided work, not a whole-app percentage speedup. Added the regression to CI.

## Additional local changes

Photo uploads now wait at least 1.5 seconds after the scan hold is released, giving the strategy update time to display. Available browser idle scheduling adds a bounded idle opportunity before upload starts. Subsequent metadata updates and retry scheduling cannot bypass the delay. The original photo is still saved locally immediately; failed uploads remain durable. Chrome and WebKit tests cover the delay, offline reload, retries, concurrent observation revisions and pause. Background browser suspension can delay network work until the browser resumes.

Unchanged tracking rows now retain their DOM nodes across clock ticks. A tracking or identity change rebuilds them normally. A browser regression verifies both behaviors. Focus rendering no longer performs the same text update twice in one call. Scan-flow and stale-advice regressions pass.

## Next opportunities, in priority order

Follow-up: stable clock/objective controls and a shared Match ticker are now implemented. Countdown text still advances, expired countdowns reach zero, and unfinished inputs survive ticks. Coincident strategy/counterbuild refreshes are deduplicated. Regression coverage checks control-node identity, countdown expiry and existing stale-advice/scan behavior. Remaining priorities below include historical context for these completed steps.

1. Reduce the remaining legacy-panel DOM replacement on the one-second Match timer. Clock controls and objective controls still rebuild; unchanged tracking rows are now cached. Keep controls stable and update text nodes. Hidden Details panels can defer visual updates until opened, while underlying state and timer calculations remain current. Test focus retention, opening Details and timer expiry before shipping.
2. Consolidate Match clock refreshes. `match.js` calls focus rendering each second; `match-focus.js` also owns a one-second text timer. The duplicate update within focus rendering is fixed; overlapping schedulers remain. Use one scheduler and lightweight text updates, with explicit invalidation for scan acceptance, optimizer results and stale boundaries. Preserve voice behavior and immediate stale-data gates.
3. Deduplicate coincident periodic strategy work. Wall-clock and match-clock modulo checks can each trigger counterbuild work on the same tick. Cache immutable planning inputs or use one scheduled refresh. Preserve three-minute scoreboard/inventory expiry and clock-adjustment behavior.
4. Profile main-thread planning on representative phones. History building and optimizer search are synchronous; OCR already uses workers. If traces show long tasks after the above reductions, move planning computation into a worker with session/version guards. Keep the most recent valid advice visible during computation.
5. Evaluate an idle release policy for OCR workers to reduce memory pressure between photos. Balance phone memory against repeated model initialization. Existing verified download caches should remain intact; never terminate an active scan or the private photo queue.

6. Avoid loading every queued photo's bytes merely to count records or locate observation metadata. The current outbox uses `getAll()` for these operations. A metadata index/store should be measured and migrated safely, especially for a large offline backlog.

Publishing requires refreshed source fingerprints and release checks. Private photos and credentials were not needed for this review. These are avoided-work and behavior checks; a representative phone CPU/FPS profile remains outstanding.
