# Consolidated release — publication authorized

The user lifted the publication hold with “Let’s publish.” This combined release
includes the validated local changes below. Private corpus files and the failed level
reader experiment are excluded.

Local bundle prepared so far:

- Upload queue enumerates record keys and reads one photo at a time. It no longer
  bulk-loads all image payloads for every upload/observation lookup. Counts use a
  streaming cursor without retaining an array of queued images. No schema migration.
- A new scan hold prevents another observation request from starting after an older
  photo upload completes. Existing requests may finish; queued work resumes afterward.
- Routine Match ticks update clocks/status without serializing the full strategy
  result. State edits still render immediately, and optimizer-result changes,
  identity/session changes and freshness transitions trigger full refreshes.
- Freshness is captured consistently with the rendered cache key, including a scan
  expiring during rendering, so stale advice cannot remain cached at that boundary.
- Replacing planning history with a same-sized array, growing it, or replacing the
  hero catalogue invalidates optimizer results without serializing whole histories.

Validation passed locally:

- Archive queue in Chromium and WebKit: bulk image reads forbidden, eight-photo
  backlog drain, original dimensions, offline reload, retries, raced revisions,
  pause and new-scan priority.
- Match advice in Chromium and WebKit: 100 unchanged ticks perform zero full-result
  serializations; changed results, expiration during rendering, countdown expiry,
  focused input, new-session clearing and stale speech retain correct behavior.
- Full scan-flow regression.
- Browser flow and optimizer cache/invalidation regressions.

Changed sources: docs/scan-archive.js, docs/match-focus.js, docs/match.js,
docs/optimizer-ui.js.
Changed tests: tests/test_scan_archive.cjs, tests/test_match_advice.cjs,
tests/test_optimizer_cache.js.

Private accuracy review: fourteen new captures from one new match were directly visually
reviewed and partial labels appended in the private corpus. Listed fields: 290
matched, zero incorrect accepted, 227 unobserved. Numeric subset: 191/350 recovered,
159 missing. Related frames are correlated; this is one held-out match, not a general
accuracy estimate. No OCR thresholds were tuned on it. Missed clock/digits and item
slots are retained for future work. Private image/label files stay out of this release.

No whole-phone memory/FPS improvement has been measured. State commits must keep
calling the full render path; optimizer results are replaced when recomputed.
Refresh fingerprints and increment the service-worker shell version only when
preparing the final combined release; preserve the unsigned strategy-review policy.

Match strategy and result changes (unpublished):
- End match now asks Win / Loss / Cancel; outcome history is append-only in existing
  shared-session events, survives reload and can be corrected without changing finish time.
- Main strategy shows priority, personal lane and team actions even when item evidence
  is incomplete. Expired/changed lineups use safe generic advice. Finished matches show
  the self-reported result rather than live calls.
- Lane bars use bounded, non-renormalized weights: level 35, CS 15, earned gold 20,
  kills 15, deaths 10, assists 5; support 35/5/15/10/20/15. Spendable gold is excluded.
  These are transparent heuristics, not calibrated fight/win probabilities.
- Strategy scrolls with fixed gameplay actions. Chrome and WebKit pass lifecycle,
  speech, stale gates, unchanged-tick performance, and portrait/landscape layout checks.
- Pure weighted strategy and manual lifecycle tests passed. New level-circle reader
  experiment remains private and disabled pending held-out validation.

Forced photo audit completed: 19 additional captures reviewed and private labels saved.
All 92 currently downloaded captures now have current partial reviews; unlisted fields
remain unreviewed. Last-match numeric subset: 514 correct, 434 missing, 2 incorrect
out of 950 fields in 19 correlated scoreboard frames. Both incorrect values occurred
in a not-applied scan. Missed leading digits and unknown classification are confirmed
defects. Shop ownership and slot state extraction remain unsupported in these observations.
Private level-isolation prototype failed calibration (one wrong value); not enabled.
