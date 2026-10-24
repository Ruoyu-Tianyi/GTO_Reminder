# PokerCoaching 8-max image transcription

Reviewed on 2026-10-02 against *The Ultimate Cash Game Preflop Guide 2026*,
[publisher PDF](https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf).
The expected SHA-256 is
`2927bdf938a52d95aa53716e5bf61705216da8685d17572775c6f11a0ecd7df9`.

## Coverage

| Cash 100 BB, 8 players | Charts |
| --- | ---: |
| Raise first in | 7 |
| Facing open | 28 |
| Facing 3-bet | 28 |
| Facing 4-bet | 28 |
| Facing 5-bet all-in | 27 |
| BB facing SB limp | 1 |
| **Total** | **119** |

The source has no UTG versus UTG+1 5-bet all-in chart. It also does not provide
multiway, squeeze, cold-4-bet, or limp-isolation response strategies for this
catalog. Its 200 BB pages are outside this 100 BB transcription.

## What the numbers mean

These are measurements of a publisher's colored image bars, **not exported
solver frequencies or a newly solved strategy**. The embedded images are
1080 by 693 pixels. A hand cell has an approximately 80-pixel usable bar,
with a horizontal pitch of 83 1/3 pixels and a vertical pitch of 47 pixels.
Dividing the entire width by 13 would include adjacent cells near the right
edge; the script uses the measured cell geometry instead.

Measurements are rounded to whole percentage points and carry an approximate
uncertainty of 2 percentage points. Frequencies smaller than one pixel can be
invisible. The publisher does not disclose original rounding, convergence,
rake, ante, or a complete solver configuration in these charts.

Every chart explicitly represents all 169 canonical hands. Colored cells
carry `available` frequencies. Black cells carry `not-charted`; they do not
mean Fold. The extractor can emit `unreadable` on failed verification rather
than assign an invented strategy. No reached-range average is computed for
response-to-3/4/5-bet charts, because hand reach weights are unavailable.

All-in 100 BB and a smaller raise remain separate actions. Source "Call" in
the unopened SB chart means completing/limping. Source "Call" in BB versus SB
Limp means checking for free; the output retains a note explaining the source
wording and uses a `check` action.

## Verification

- The extractor checks the exact PDF hash before reading the document.
- Every page's extracted heading count must equal its embedded chart count.
- All relevant headings and action legends were visually reviewed. Whole-page
  thumbnails can make BB resemble SB. Enlarged title crops confirm that page
  17 CO versus BB, page 24 UTG+1 versus BB, and page 26 CO versus BB agree with
  their text layers. The earlier reported conflicts were thumbnail misreadings;
  the three indexes are restored. Page 26 HJ versus BB is also confirmed.
- Every cell is measured at two separate horizontal bands, avoiding hand text.
  Inconsistent bands produce `unreadable`, never a guessed frequency.
- The 36 full-range charts (RFI, Facing Open, and BB versus SB Limp) are checked
  against 72 independently transcribed printed Raise/Call/Check totals. The
  allowed discrepancy is 0.35 percentage points. Those totals never modify
  per-hand measurements or force them to fit.
- Every output row is rounded with a largest-remainder rule, so its declared
  action frequencies sum to exactly 100 percentage points.

The local report records counts, independent checks, unreadable hands, source
hash, and output hash. Reference-index and action-history tests verify all
indexed matchups, including the restored source charts and the genuinely
unpublished UTG versus UTG+1 5-bet scenario.

## Reproduce locally

Install Python packages `pypdf`, `Pillow`, and `numpy`, restore the source PDF
into `data/private/research/pokercoaching-ultimate-cash.pdf`, then run:

```text
python scripts/transcribe-pokercoaching.py
```

Outputs:

- `data/private/research/derived-pokercoaching-ranges.json`
- `data/private/research/pokercoaching-transcription-report.json`

The original PDF, image crops, report, and frequency data stay in the ignored
private-data directory. The publisher's availability of a free download is
not a redistribution license. The repository contains the reproducible
extractor and source metadata, not the published charts themselves.
