# Next release: personalized solo and squad strategy

## Current release scope

The Focus interface retains Records, Stats, Plan and Match. Per-player reviewed starting plans, three explained pivot alternatives, item artwork and shared squad intent are implemented. Advice uses confirmed inventory evidence, freshness checks and the patch-review gate. The deeper optimization and coaching below belong to a later release.

## Starting evidence

The initial audit covers 111 unique matches and 223 overlapping squad appearances. See research/playstyle-audit.json for provenance and limitations.

| Player | Appearances | Ranked / Standard | Initial hero and role buckets |
|---|---:|---:|---|
| stealinNICKELS | 67 | 27 / 40 | Greystone jungle 20; Greystone offlane 14; Sparrow carry 10 |
| DiMu | 78 | 35 / 43 | Legion carry 9; Phase support 9; Lt. Belica midlane 6; Renna midlane 6; Steel support 6 |
| inFamoUs | 78 | 37 / 41 | Steel support 11; Sparrow carry 11; Khaimera jungle 9 |

Profiles must remain specific to player, hero and role. Display sample counts and uncertainty. Broader role baselines are provisional when samples are small. Mixed roles, modes and durations prevent fair player rankings from these totals. These data cannot establish aggressive/passive playstyles or explain deaths.

## Data and profile workstream

Preserve missing measurements as unknown, retain friendly-jungle farming and ability costs currently discarded, and verify gold-curve interval semantics before publishing early-game metrics. Build contextual farming, economy, damage, vision and objective profiles, separating mode, patch, duration and comparable rank where available.

## Solo build workstream

Evaluate all five enemies, observed leads and confirmed items. Rank legal directions while preserving hero scaling, role needs, recipes, exclusions, inventory capacity and the player's current plan. Explain each target, expected benefit and tradeoff. Keep item-based pressure estimates distinct from measured damage. Never claim global optimality without a defined, validated objective.

## Squad optimization workstream

Search combinations of individual directions for complementary coverage. Include confirmed items on all five allies, assign controllable recommendations to participating squad members, and apply verified stacking rules. Explain who supplies each effect and what each player sacrifices. Start with bounded deterministic search and validate small fixtures against independent exhaustive search. Planned assignments remain separate from purchased coverage.

## Coaching and evaluation workstream

Compare measured performance against contextual personal baselines. Present tendencies with uncertainty and suggest specific experiments for future matches. Do not infer positioning, rotation quality, ability accuracy or death causes from final totals.

## Data and patch gaps

Current retained data contains final inventories and match totals, without verified purchase times/order, combat events, damage-type breakdown, positioning, ability accuracy, healing/shield output or death causes. Earned gold minus spent gold is not a live shop budget. Additional endpoint access must be demonstrated before becoming a dependency; do not depend on restricted lane-matchup/core-build endpoints.

Maintain a sourced, patch-reviewed registry for passives, stacking, recipes and hero scaling. Catalogue stats alone cannot support a complete combat simulation. Continue the existing patch-review gate.

## Evaluation and release gates

- Split chronologically by unique match; keep all participants and screenshots from a match in the same split.
- Prevent final inventory/outcome leakage into earlier recommendations.
- Test unseen hero-role buckets and patch changes separately.
- Compare against the current rules and simple role baselines.
- Measure legality, abstention, uncertainty, stability, OCR correction burden and usefulness.
- Reserve win-rate improvement claims for prospective evaluation.
- Verify each selection changes only the intended player's plan and preserves reviewed evidence.
