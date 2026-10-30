# Scanner corpus and verification

The user has enabled private collection of every scan photo during scanner development.
Recognition runs locally; original camera frames and uploaded photo files are queued in
IndexedDB and sent to the private collector after active OCR finishes. Pause collection
under Match → Details → Scanner photo collection. Pausing preserves the existing queue.
Successful upload releases the local photo bytes. Failed uploads remain queued across
reloads; device-storage failures are visible and retryable while the page remains open.

## Private access

Supabase project: hijfyfysjneqhqgbsypx. Bucket: scan-corpus (private).
Tables: scan_devices, scan_captures, scan_reviewers, scan_labels.
Browser clients have no direct table or bucket read permissions. Per-device random
256-bit capabilities submit observations. A separate out-of-band reviewer capability
can retrieve signed image links and append image-linked reviews. Never ship reviewer
credentials or server keys in browser files, Git, logs, or chat.

Local credentials are provisioned in .scan-private/credentials.json (0600); the directory
is ignored by Git. The collector is database/scan-collector/index.js.
database/scan_corpus.sql and scan_capacity.sql record the additive setup.
Current capacity: 800 MiB of original photos / 10,000 captures; individual files ≤50 MiB.
Reaching capacity leaves new files on the device with a visible error; never silently
drop captures or enable paid storage automatically. Review storage use before extending.

## Review workflow

From the project root, using Python 3:

- scripts/scan_corpus.py fetch: retrieve every pending capture, with pagination and hash checks.
- scripts/scan_corpus.py fetch --all: refresh the complete private export.
- scripts/scan_corpus.py review PATH: append a review JSON file.
- scripts/scan_corpus.py report: count current hash/revision-matching reviewed fields.
- scripts/benchmark_scan_corpus.cjs MANIFEST OUTPUT: benchmark the real local reader.
- scripts/review_seed_corpus.py MANIFEST BENCHMARK: compare independently image-reviewed
  seed annotations with actual scanner observations and append the results.

Exports and all photo-specific annotations stay in .scan-private. Images may contain
player names and room background; do not copy them to public fixtures or PRs.
The initial 51 JPEGs have all been visually inspected, with only listed fields labeled.
Their annotations are .scan-private/verified-seed.json; baseline scanner output is
.scan-private/benchmark.json. Unlisted fields remain unreviewed, even when other fields
in that image are verified.

Review JSON:
{
  "id": "capture UUID",
  "image_sha256": "content_sha256 from fetched record",
  "observation_revision": 1,
  "status": "partial",
  "labels": [
    {"field":"ours.0.k","observed":3,"correct":4,"verdict":"incorrect",
     "region":[0.1,0.2,0.3,0.4]}
  ],
  "assessment": {
    "verification":"manual-image-inspection",
    "scope":"Listed fields only",
    "notes":["Explain ambiguity and unreviewed regions"]
  }
}
Regions are normalized [left, top, right, bottom] in ORIGINAL photo coordinates.
Every label needs a visible supporting region. Verdicts: correct, incorrect, unreadable,
unobserved (the scanner omitted a visibly readable value). Correct may be null when the
image cannot establish the answer. Keep whole-row regions labeled as approximate;
never claim they are precise digit boxes. Status verified applies only to the listed
review scope; use partial when any meaningful fields remain unreviewed.

## Quality rules

- Never promote OCR output to verified truth. Inspect the image independently.
- Keep observations, raw polygons, parser results, application outcome and labels separate.
- Uploaded-photo observation times are estimated, not verified match timestamps.
- Room application is optimistic until acknowledged; awaiting-room-ack is not acceptance.
- Preserve history. Stale reviews remain historical and do not count as current verification.
- A selected/recommended shop item, recipe checkmark or planned build is not owned equipment.
- CS is not gold. Postmatch shows additional totals; minimap countdowns are not game clocks.
- Postmatch pred.gg history can corroborate hero/final totals. It cannot validate an earlier
  snapshot's scores, unspent gold, or inventory without matching timeline evidence.
- Split evaluation by actual match, not upload directory, image or adjacent frame.
- Measure incorrect accepted values AND missed/unknown fields, latency and memory.
  Zero mistakes on the reviewed subset does not establish general accuracy.
- Retraining weights is a separate, measured step. Collecting labels alone is not retraining.
  Prefer validated screen geometry, crop improvements and targeted retries first.
- New engine/code integrations require license review, pinned assets, mobile tests and
  held-out comparison. Shared underlying models do not provide independent votes.

The daily 4 a.m. local review works through new photos, checkpoints unfinished batches,
and reports only actionable changes or completed review batches. Overnight Match work
has a separate temporary hourly follow-up through the agreed morning deadline.

