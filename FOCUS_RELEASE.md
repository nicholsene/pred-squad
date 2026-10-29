# Focus and shared build planning

## Behavior

Records, Stats, Plan and Match remain available in the four-section dock. The interface supports light/dark appearance, reduced motion and opaque surfaces. Readable content cards hold the analysis; navigation uses restrained glass effects.

In Plan, assign squad heroes and roles, then review six intended equipment targets for each player. A local screenshot reader proposes visible item names; ambiguous text requires manual correction. Review the targets and order before saving. An optional next purchase guides plan comparison. Photos are not saved or sent to the room.

After a reviewed live scoreboard, Match explains the leading observed threats across the lobby. Each eligible counter need offers up to three ranked options with canonical item artwork, cost, role/build fit, components, tradeoff and comparison to the player's current plan. Fewer are shown when fewer legal options qualify.

Selecting a pivot shares an intention with the squad. It does not add an owned item or satisfy purchased utility coverage. A newer scan or changed player, hero, role, patch or match requires the intent to be reviewed again. Confirmed inventory is the only ownership evidence.

## Boundaries

Recommendations use catalogue signals and observed evidence rather than a full combat simulation. Level/item pressure is an estimate, not measured damage received. Gold earned is not a shop budget. Starting-plan OCR depends on visible text and always needs review; icon-only plans use manual names. Real build-plan screenshots are still needed to benchmark accuracy.

Existing guided camera modes, minimap/objective review, screen-on control, editable pre-match handoff, match history and shared rooms remain available. Browser wake-lock behavior still depends on device/browser permission and foreground visibility.

## Shared-room change

database/room_batch.sql permits atomic buildPlans and pivotIntents paths through the existing room patch wrapper. No photos are included. The public-role transaction test saved sanitized plans/intents and rolled back. The existing code-based room access model is unchanged.

## Verification

Pure-module tests cover context invalidation, canonical/legal targets, serialization, three alternatives, reservations versus ownership, parser uncertainty and cancellation. Browser tests cover starting-plan review, photo correction, pivot/team flow, narrow layouts, dark/opaque/reduced-motion mode, image fallback and the existing match lifecycle. The patch baseline remains explicitly unreviewed until a human patch review; deployment refresh independently verifies source completeness.

The next-release investigation and initial squad data audit are documented in NEXT_RELEASE.md and research/playstyle-audit.json.
