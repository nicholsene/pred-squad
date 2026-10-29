# Photo-driven lobby counter-build advice

This change depends on the match-planning release in PR #1.

## Player flow

1. Set your team's heroes and player assignments, then start the match clock.
2. Photograph the full in-game scoreboard using the camera guide, or upload and straighten a photo.
3. Review both teams' heroes, level/KDA/gold fields and six equipment slots. Correct player assignments if someone swapped roles.
4. Confirm item names you can identify. Mark an inventory complete only when all six slots are visible; otherwise blanks remain unknown.
5. Enter the screenshot game time, or explicitly confirm that the photo was taken just now. Current camera captures carry their capture timestamp.
6. Apply the reviewed snapshot. The primary Match panel considers threats from all five enemies and recommends responses for each named squad member.

## Evidence and constraints

- Positive item observations require human confirmation. Unread and empty slots are distinct.
- The panel ranks lobby threats, shows cross-lane level disadvantages, and gives prioritized next-purchase options with reasons and target enemies.
- Existing allied counter coverage includes the two teammates outside the named squad.
- Current inventories matter: recommendations avoid owned items and account for full slots. Optional swaps require review rather than instructions to sell immediately.
- Scoreboard gold is total earned. Affordability is shown only if the player explicitly enters current spendable gold from the HUD.
- Exact upgrade costs cannot be inferred without verified recipe metadata. Full item cost is labelled as full cost.
- Old, future-dated, mismatched-hero and previous-match snapshots cannot silently become fresh evidence. Build observations expire; rescan to update the plan.
- Item properties are catalogue-level signals, not a complete combat simulator. Recommendations do not promise to erase a level or skill disadvantage.
- User photos and item crop previews remain on the device and are removed before shared-state persistence. Only reviewed IDs, stats and observation timestamps synchronize.

## Validation

Run the existing fetcher, engine and lifecycle checks plus:

    node tests/test_counterbuild.js
    node tests/test_itemvision.js
    node tests/test_browser.cjs

Targeted cases include an enemy outside the player's lane changing the response, allied anti-heal coverage, unknown versus confirmed-empty inventories, stale evidence, unknown heroes, full slots and total-earned versus current gold.

Automatic icon suggestions must be verified. The initial matcher uses conservative acceptance gates; there is no claim of held-out accuracy on in-game item photographs. Manual catalogue correction remains available.

## Patch review and recalculation

The scheduled refresh runs at minute 0 and 30; GitHub may queue scheduled jobs later. Merges affecting code trigger an additional refresh. A failed fetch retries once after five minutes; only a second failure leaves the workflow failed. Each successful hero/item refresh downloads the current catalogue, ability descriptions and recommended skill orders, rebuilds icon references if they changed, and compares them with a checked-in baseline. Changes to item stats, costs, recipes, exclusions, hero skills/abilities, patch identifiers, and the counter-build engine appear in `docs/data/patch-review.json`.

A new patch, changed catalogue, or changed counter rules pauses item prescriptions until reviewed. Incomplete or mismatched source data also pauses them. The first baseline is explicitly labelled **initial, review pending**, and never described as reviewed patch notes. Official notes are linked; prose and new mechanics are not automatically interpreted.

To review a patch:

1. Run a healthy refresh and read the before/after changes in `docs/data/patch-review.json` alongside the official notes. A notes link carried forward from the last review may need updating.
2. Check new passives, damage conversions, stacking restrictions and changed abilities. Update `docs/counterbuild.js` rules and recommendation tests where source categories do not express the new mechanics. Skill orders and ability text refresh from the catalogue; strategic rule changes require review.
3. Run `python tests/test_patch_review.py`, `node tests/test_counterbuild.js`, and the existing fetch/browser checks.
4. After completing that review, record the exact catalogue/rule fingerprint:

       python scripts/patch_review.py --approve --reviewer YOUR_NAME --notes-url OFFICIAL_HTTPS_URL --confirm-reviewed

5. Commit `config/patch-policy.json`, `config/patch-baseline.json`, the reviewed catalogue and any rule/test changes. The next successful scheduled refresh publishes the matching reviewed report. A later change invalidates that sign-off and rebuilds recommendations from the newly reviewed data.

The icon matcher rejected uncertain reads in the two initial example scoreboard photos (zero accepted item suggestions across 120 slots). Hero recognition found all 20 slots in that check. This is a development smoke check, not a held-out accuracy estimate. Cropped slot previews and manual catalogue entry are the supported fallback; broader item-photo recognition needs more labelled in-game examples before it can be relied on.

## Mobile UX

The selected player's purchase responses appear before expandable lobby evidence and other squad members. Photo review uses per-player cards, readable 16px inputs and separate unknown/empty confirmations. Periodic updates preserve expanded evidence and avoid replacing unchanged panels.
