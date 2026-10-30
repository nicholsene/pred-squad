# Evidence-led next-trip strategy

The official [How to play](https://www.predecessorgame.com/en-US/how-to-play)
explains the tower/core objective and the role of farm, experience and item purchases.
The conditional action sequences and thresholds below are application heuristics,
not official prescriptions or calibrated predictions.

Match advice now gives the measured reason, a personal next-trip route, three next-push
steps, an exit condition and team direction. Optional support/avoid calls are shown
only for measured needs. Carry and Support share the duo lane; Jungle is not a lane.
No route, opponent position, wave, health, death timer or tower state is invented.

A compact preceding scoreboard is retained inside the accepted board, without images,
item payloads or recursive history. Comparisons require the same session and lineup,
increasing observation times within five minutes, nondecreasing cumulative counters,
and values read in both observations. A new death means a death between observations;
a kill does not prove a particular opponent is still dead or establish a numbers edge.

Decision keys exclude scan IDs, timestamps, raw CS counts and small stat changes.
Level/farm postures and team pressure use conservative thresholds and hysteresis.
Repeated reads of one death cannot create a repeat-death warning. Conservative recovery
can persist through unread counters/levels without turning old measurements into new
facts. A manual Read update still repeats on request; automatic scan announcements
only speak when the decision or supported item direction changes.

Objective calls require a confirmed, same-session observation with an observation time,
a usable match clock and a current preparation/check phase. A countdown expiring means
expected availability to verify, not confirmed availability. An objective setup
suppresses a competing support rotation. Unsafe-solo-fight cautions may remain.
Old timers without provenance stay visible in timer details but do not direct pushes.

Tests cover valid and rejected histories, counter corrections/missing reads, death/kill
changes, repeated snapshot idempotence, stable decisions, optional lane calls, timer
provenance and competing calls. Browser regressions verify unchanged scans stay quiet,
new deaths update once, and unchanged clock ticks avoid full optimizer serialization.
