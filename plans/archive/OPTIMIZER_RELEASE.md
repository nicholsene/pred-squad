# Solo and squad next-item optimizer

## Delivered

Match now compares coordinated next-item directions for the selected player or assigned squad. It considers all supported counter needs independently of the older greedy utility assignment, deduplicates items, preserves at least one candidate per need where bounds allow, and exactly enumerates the retained combinations. The default retains at most 12 choices per player including keep-plan, with a total bound of 4096 combinations. Up to three joint directions are available.

Four types of supported scenario redistribute confirmed priorities: balanced, highest observed lead, physical pressure and magical pressure. Scenarios exist only when the corresponding evidence exists. Their total observed threat priority remains constant. The objective combines 75% mean and 25% minimum scenario priority score. It is an explicit planning heuristic, not a damage simulator or win probability. Search exclusions and scenario sensitivity are shown.

Personal defenses are credited to each player. Shared utility availability is scored once at team level, separately from personal strongest-need aggregation. Equal scores prefer fewer new item directions. Actual allied equipment can provide available utility, including allies outside the named squad. Future pivots never become owned coverage. Actual target application, uptime, stacking and future combat remain unmodeled.

Current pivots may constrain the search. Unchecking that option explores alternatives; selecting an item updates the existing per-player intent. Full equipment inventories require an explicit replacement and are excluded from automatic next-item optimization. Incomplete, noncanonical, stale, mismatched or ambiguously assigned own inventories are excluded. Six visible slots may contain explicitly confirmed empty slots.

## Player evidence

Profiles separate player, hero, role, exact patch and mode. Only matches completed before the current match cutoff contribute. Current reviewed match IDs can be excluded. Historical item preferences use measured final inventories, legal current items and a small capped, sample-shrunk tie-break; they do not use outcomes or infer purchase order.

Measured farming, damage, deaths and vision rates are exposure-weighted. Personal and comparison sample counts, missing evidence, conservative role fallback, uncertainty and concrete experiments are shown. Mixed-role rates do not establish personality, positioning or death causes. Comparisons are not rank-adjusted.

Normalization now records source measurement availability, preserving genuine zero separately from absent values; friendly-jungle farming is retained. Older records are re-fetched with a bound of 50 metadata backfills per run. Unflagged legacy measurements remain unknown until fetched again. Public metadata queries bypass OAuth; match history still requires authorized access.

## Mechanics and patch safety

Public API introspection and actual queries verified item effects, conditions and cooldown strings; detailed hero descriptions, cost and cooldown arrays; and hero attribute values. Source text is retained and safely rendered as reference. Attribute indexing, passive stacking, proc ordering and complete combat formulas are not established. config/item-mechanics.json therefore has no approved numerical formulas.

Patch fingerprints now cover all new item/hero source fields, core optimizer/profile/mechanics code, UI context logic, normalization and patch-review logic. Captured source data remains an explicitly unreviewed initial baseline until formal patch signoff. Any source or logic change is flagged; no automatic prose interpretation approves numerical mechanics.

## Validation

Independent models reviewed legality, chronology, complementarity, identity and objective behavior. Exhaustive oracle fixtures compare 1/2/3-player results and named scenarios. Adversarial fixtures cover duplicate utility, per-player armor, name invariance, future history, full/unknown inventories, reciprocal exclusions, planned versus owned, budget handling, pruning, profiles and deterministic ties. Browser checks cover solo/squad mode, profile history, item artwork, scenario results, shared pivot selection and the existing match lifecycle.

## Next depth

This release optimizes the next item direction against current evidence. Full six-item sequence optimization, explicit sell/swap simulation, verified proc/stacking formulas, time-to-purchase modeling and prospective outcome evaluation remain separate future work. Keep the current limits visible rather than implying global optimality.

## Requested quick-start flow

The Match setup card is Recommended build. Five lane buttons select the player's lane while preserving player/hero pairs. Scan scoreboard & builds and Build manually are toggle modes. Mark ready is removed from the flow. Start game moves directly to live tracking and uses the current game time; a reviewed screenshot clock advances by its observed age. The live clock and objective controls then remain available. Legacy ready sessions still open correctly.

## Compact match and automatic photo intake

Core Match fits320×640,390×844 and844×390 with Reset, identity, Strategy/Timers/Squad, five lane meters, a single Scan action and explicit Read update. Detailed evidence and equipment review open targeted sheets. Own lane has a gold border; measured positive/negative gaps are green/red, unknown gaps neutral. The meter is a heuristic summary of known level, farm and genuine earned-gold differences, not a win probability.

One intake identifies loading, scoreboard, shop/build and HUD/minimap. Upload observations default to ten seconds before selection; camera captures retain their true time through correction. Per-field OCR/template evidence, geometry, exact squad identity and layout must all meet90 for automatic numeric application. This is read strength, not calibrated correctness probability. Equipment stays unconfirmed unless every slot is resolved; unknown blanks never imply empty slots. Shop recommendation names are reviewed planning candidates, not owned equipment; discounted shop prices do not replace catalogue costs.

Accepted photos switch to Strategy and can speak a concise update. Shared-room speech waits for the exact server-acknowledged state; rejected, superseded or pending observations are not announced as accepted. Clock/stage/identity/room changes invalidate in-flight reads. Older scoreboards cannot replace newer ones. A single selected exact90-strength minimap countdown may apply automatically; repeated timers, bare seconds and2m+ estimates require review.

The camera uses a horizontal16:9 guide for game screens with portrait rotation guidance and an upload fallback. Unread angled scoreboards offer four-corner correction. Private benchmarks identified shop, portrait minimap and spectator HUD; the reversed loading layout follows visible labels. Straightening the13:29 example recovered all ten heroes, while several numbers remained uncertain and correctly required review. The supplied photos are not committed or sent to a remote OCR service.

Browser checks cover no core scrolling at all three viewports, review paging, ten-second age, automatic numeric updates with unknown inventory, reset/clock changes during OCR, intended-build routing and server-ACK/conflict speech behavior.
