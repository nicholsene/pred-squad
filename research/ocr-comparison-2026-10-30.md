# Screen-photo OCR comparison — 2026-10-30

The deployed reader uses Paddle for screen/hero/player structure and a selective Tesseract number pass. All recognition runs on the device, using pinned local assets. OpenCV was used for private offline experiments; the equivalent shipped crop, grayscale, Otsu and resize operations use Canvas, without downloading OpenCV.js.

## Evidence and limits

The private corpus contains 51 distinct supplied JPEGs: 13 live scoreboards, six post-match scoreboards, nine loading screens, ten shops and 13 HUD/minimap views. Photographs and raw results are excluded from this repository. Visual reviews cover explicitly listed fields, not every visible field. Many photos depict the same game and are correlated.

The fixed numeric comparison covers 185 independently transcribed fields in 37 rows from the 19 scoreboard photos. It includes many zeros. It is a development corpus, not an independent held-out estimate of production accuracy.

| Real browser pipeline | Correct numeric fields | Wrong accepted numeric fields | Unknown fields | Correct fields in auto-applied photos |
| --- | ---: | ---: | ---: | ---: |
| Previous Paddle pipeline, Chromium | 49 | 0 | 136 | 45 |
| Improved glyph crops, Paddle, Chromium | 55 | 0 | 130 | 51 |
| Improved crops + numeric Tesseract, Chromium | 83 | 0 | 102 | 79 |
| Improved crops + numeric Tesseract, WebKit | 80 | 0 | 105 | 76 |

Median measured local processing time on these 19 photos was 2,672 ms for the previous Chromium pipeline, 3,182 ms for the combined Chromium pipeline and 3,123 ms for WebKit. These are Mac browser measurements, not a phone latency guarantee. The added number-reader download is approximately 4.43 MB, cached after hash verification.

An additional visual audit inspected 239 high-score Tesseract source patches. Their visible numerals matched the proposed readings. This audit uses the same corpus and does not establish general accuracy or fully validate every row assignment. Low-score errors still occur and remain unconfirmed. Engine scores are not calibrated probabilities.

## What changed

The nominal K/D/A boxes sometimes clipped the numeral baseline while including the header, potion or panel border. A bounded search now finds compact white glyph groups with matching baselines, height and three-column spacing. Multiple plausible triplets cause abstention. The crop inspection isolated complete numerals in 33 of the 37 reviewed rows, rejecting four ambiguous rows.

Only these isolated number patches receive grayscale, 4× linear enlargement, Otsu thresholding and inversion to dark text on a light background, plus an eight-pixel border. The unmodified photo remains available for the main reader and item recognition. Testing covered grayscale/Otsu/adaptive thresholding at 2× and 4×, with Tesseract PSM 7, 8 and 10: 18 configurations and 3,330 field reads. Aggressive preprocessing sometimes erased strokes or introduced incorrect readings.

The shipped numeric reader uses PSM 7 and a digit whitelist with language dictionaries disabled. PSM 10 denotes one character and is inappropriate as a blanket setting for multi-digit numbers. A whitelist constrains output characters; it does not eliminate neural inference. These choices follow the [Tesseract quality guide](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html), then are checked against the private photos.

The numeric pass preserves actual recognized source polygons. Strong contradictory readings stay disputed and are excluded from automatic values. A failed or unavailable numeric reader leaves the Paddle result available. Hero repairs retain their measured geometry across subsequent numeric passes.

Photos larger than the overview can feed original pixels into the second-pass crops. Geometry and evidence stay in overview coordinates, with independent X/Y ratios for original sampling. Sources above 16 MP or 6,000 pixels on a side are not retained for detail, to bound memory. Camera frames are copied before the first asynchronous step; cancellation, replacement, fallback decoding and late bitmap completion release owned resources.

## Other engines and screenshot projects

Reviewed [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), [Tesseract](https://github.com/tesseract-ocr/tesseract), [Tesseract.js](https://github.com/naptha/tesseract.js), [EasyOCR](https://github.com/JaidedAI/EasyOCR) and [RapidOCR](https://github.com/RapidAI/RapidOCR). GitHub popularity guided discovery, not selection. All three independent readers were run privately against the 51-photo corpus. With the current structural parser, full-photo Tesseract did not pass the automatic gates; EasyOCR produced some useful text but also three incorrect reviewed numeric candidates, all held from application. Paddle plus Tesseract on correctly located, individual number crops performed better than swapping the whole engine.

[Umi-OCR](https://github.com/hiroi-sora/Umi-OCR), [Text Grab](https://github.com/TheJoeFin/Text-Grab) and [NormCap](https://github.com/dynobo/normcap) contribute useful screenshot workflows, region templates and masking patterns. They largely wrap existing OCR engines. No GPL application code was copied into this application. RapidOCR uses related Paddle models and does not supply an independent character-reading vote by itself. EasyOCR's official ONNX exporter covers its detector; a complete WebKit recognizer deployment needs additional work and validation.

## Alignment and remaining work

An offline OpenCV quadrilateral experiment proposed display boundaries for 30/51 photos after rejecting clipped anchors. On those same 30 images, blanket 1600×900 rectification reduced correct reviewed numeric fields from 45 to 35, so it was not promoted. Candidate availability is not corner accuracy. Center lane icons alone are collinear and cannot determine full perspective; combine them with verified, non-collinear panel/top/display anchors and preserve inverse mappings. See [OpenCV homography](https://docs.opencv.org/4.x/d1/de0/tutorial_py_feature_homography.html) and [template matching](https://docs.opencv.org/4.x/d4/dc6/tutorial_py_template_matching.html).

Automatic owned inventory remains incomplete. Private item probes show that measured slot corners and brightness/color-invariant icon features help, but those candidates are not ownership evidence. A selected shop recommendation or build title must never establish who owns an item. Empty slots, components, ambiguous frames and uncertain identity remain unknown. This gate must pass independent slot/identity validation before equipment can drive automatic counterbuild advice.

Six post-match photos were also matched to stored post-match data: the reviewed own-player level, K/D/A and CS agreed. Displayed clock/gold differed from API final values; those sources represent different observation times/semantics and must not overwrite the photo's visible values.

## Reproduction

Use the private workflow in [SCANNER_CORPUS.md](../SCANNER_CORPUS.md). Run `scripts/benchmark_scan_corpus.cjs MANIFEST OUTPUT`; use `SCAN_BROWSER=webkit` for the second browser. Output must stay private. `scripts/vendor_numeric_ocr.py NODE_MODULES` reproduces the pinned numeric assets and rejects language bytes that differ from the benchmarked model. Browser tests exercise real local models, verified cache recovery, source polygons, ambiguous crops and cancellation without external OCR requests.
