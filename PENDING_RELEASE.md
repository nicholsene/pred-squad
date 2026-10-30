# Starting builds and specific tactical updates

Publication authorized by the user. This bundle follows PR14 and preserves the
current catalogue, private scanner collection and existing reviewed plans.

## Starting builds

The Recommended build area previously displayed only a saved reviewed plan. It now
proposes six compatible current equipment targets for the selected hero and lane,
with names, individual prices, total full-build cost and a playstyle explanation.

Styles include Recommended, Aggressive damage, Attack speed, Critical strike,
Anti-tank, Lifesteal / sustain, Mana regen / sustain, and Durable (Tank / durability
for tanks). Unsupported styles are omitted; heroes without mana do not get a mana
style. Suggestions use current catalogue fit heuristics, not a verified optimal
build, measured DPS or a claimed win-rate benefit. No paid API is used.

Use this build explicitly saves intended targets. Previewing another style does
not overwrite a saved plan, and intended targets never fill owned inventory.
Current-data review gates remain in place. Small-phone previews scroll while
Start game remains reachable.

## Tactical updates

Advice now gives the observed reason, three next-trip/push steps, a stop condition
and team direction. Optional support/avoid-solo-fight calls require a measured
reason. Carry and Support share the duo lane; Jungle is not a lane.

Accepted scans retain one compact preceding same-match numeric board. Invalid,
mismatched, decreasing or missing comparisons cannot invent recent kills/deaths.
A kill count increasing never establishes an enemy respawn window or a numbers
advantage. Enemy positions, health, waves and standing towers must still be checked.

Equivalent scans and small changes retain the decision rather than triggering
another spoken update. Manual Read update still repeats on request. Re-evaluating
a single death does not count it twice. Conservative recovery stays conservative
when a later read loses fields rather than demonstrating improvement.

Current confirmed objective observations can redirect setup. Elapsed countdowns
require map verification; objective setup suppresses a competing support rotation.
Old timers without match/time provenance do not direct pushes.

## Validation and limits

Pure tests cover every supported catalogue hero/lane/style combination, legal
non-conflicting targets, mana/sustain bonuses, costs, patch gates and ownership
separation. Tactical tests cover comparable history, corrections, missing data,
idempotence, stable decisions, optional lane calls and objective provenance.
Chrome/WebKit checks cover previews, explicit adoption, reloads, phone layouts,
unchanged-scan speech suppression, valid death updates, freshness and efficient ticks.
The full Match browser flow and existing build/counterbuild/optimizer checks pass.

The unvalidated level-reading experiment remains private and disabled. This release
does not claim an OCR accuracy improvement. Private photos, labels and credentials
are excluded. Source fingerprints and the shell cache are refreshed for publication;
the unsigned patch-review policy is preserved.
