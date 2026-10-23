# Facing 4-Bet: published action evidence

The local library adds the 28 **8-max Cash, 100 BB, Facing 4-Bet** charts on
pages 18–22 of PokerCoaching's *The Ultimate Cash Game Preflop Guide · 2026*.
These are graphical action observations, not numerical solver frequencies.

Source: [official PDF](https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf).
The publisher also describes its free resources on the
[official preflop page](https://pokercoaching.com/preflop-charts/).

- Source PDF SHA-256: `2927bdf938a52d95aa53716e5bf61705216da8685d17572775c6f11a0ecd7df9`.
- Local source: `data/private/research/pokercoaching-ultimate-cash.pdf`.
- Local output: `data/private/research/derived-4bet-actions.json`.
- Reproduction script: `scripts/transcribe-reference-4bet.py`.
- Output SHA-256: `f7d22460d1e7522c0def86180b965933cd5c3380bb94952467d2b6c79e45b0b9`.
- Every output chart explicitly describes all 169 hand classes.
- The private source and output remain ignored by Git. A redistribution license
  for the PDF or this transcription has not been established.

The 4,732 hand records contain **985 visible action sets**, **3,692 not-shown**
cells and **55 ambiguous** cells. These are evidence counts, not hand ranges
or combination-weighted action frequencies.

## What can be read

The PDF contains 28 embedded 1080 × 693 JPEG2000 images for these charts.
The text layer contains chart titles, not per-hand frequencies. The colored
areas are raster pixels, not vector rectangles carrying numerical widths.
The publisher does not specify a frequency rounding step for these images.

Each chart shows an **Allin 100bb**, **Call**, and **Fold** legend. The output
therefore declares three separate actions: `allin` (raise to 100 BB), `call`,
and `fold`. It preserves visible hand action sets only:

| Hand evidence | Meaning |
| --- | --- |
| `actions-only` with one action | One action color was reliably visible in the published image. This does **not** establish an exact solver frequency of 100%. |
| `actions-only` with multiple actions | Multiple action colors were reliably visible. Their relative percentages are not inferred. |
| `missing`, reason `not-shown` | The chart cell is black. It is not automatically Fold and does not prove zero historical reach. |
| `missing`, reason `ambiguous` | A color component is too narrow or the sampling bands disagree; inspect the original PDF. |

All hand `reach` values are `null`. There is no `frequencies` field on a
graphical hand and no node range aggregate. The prior open, 3-bet, 4-bet,
ante and rake conditions remain explicitly `null`; the query does not claim
an exact match to a custom action history.

## Source page map

`Hero` is the player who previously 3-bet and now faces the original raiser's
4-bet. Position labels retain the source's spelling.

| PDF page | Reviewed matchups |
| --- | --- |
| 18 | UTG+1, LJ, HJ, CO, BTN, SB versus UTG |
| 19 | BB versus UTG; LJ, HJ, CO, BTN, SB versus UTG+1 |
| 20 | BB versus UTG+1; HJ, CO, BTN, SB, BB versus LJ |
| 21 | CO, BTN, SB, BB versus HJ; BTN, SB versus CO |
| 22 | BB versus CO; SB and BB versus BTN; BB versus SB |

## Extraction and verification

The script verifies the source hash **before** parsing, then validates the
page count, section headings, expected position titles, image dimensions,
chart count, and 28 unique matchups. The 13 × 13 image grid begins below its
82-pixel legend and has 47-pixel rows.

For every hand, the reader checks two rows above the text and two below it,
including near-edge pixels. A color column must agree across both bands and
at least three of the four observations. A stable component must span at
least three adjacent pixels to be retained. A detected smaller component,
substantial unexplained black area, or excessive inconsistency marks the
whole hand ambiguous. These pixel thresholds reject ambiguous evidence;
they never become frequency estimates or a presumed rounding rule.

All five source pages were visually inspected, and the extracted ambiguous
cells were reviewed in a contact sheet. Important cases include page 18's
UTG+1 versus UTG: AA visibly mixes Allin/Call; TT and 99 mix Call/Fold;
AQs is black; A5s has a very narrow additional color and remains ambiguous.
The accompanying private audit records the original cell box and the
observed color runs for traceability. It is not a strategy dataset.

Two additional color-reading checks used HSV color regions and different
scan rows directly on the source images. Both agreed on all 985 retained
action sets. A separate reviewer also checked the page 18 UTG+1-versus-UTG
and page 22 BB-versus-SB examples, including narrow mixed bars and black
cells. An actual corrupted-source test verified that a wrong PDF hash is
rejected before parsing and leaves an existing output untouched.

Run with Python containing `pypdf` and Pillow with JPEG2000 support:

```powershell
python scripts/transcribe-reference-4bet.py
```

The script prints the output SHA-256 and counts. Its reviewed output hash
guard prevents an unexpected transcription from replacing the local file.
The application separately verifies that same output hash before serving it.

## Remaining coverage gaps

This artifact provides 8-max Facing 4-Bet **action evidence**, not original
per-hand numerical frequencies. It does not create 7-max charts, substitute
another seat count, or derive higher-precision values from pixels.

A current public-source check found that FreeBetRange advertises Cash 100 BB
solutions including 7-max, with cash solutions credited to 2CardConfidence.
Its official announcement describes adding the library to an account after
registration; it does not provide an anonymous downloadable 7-max package.
No account was created and no access restriction was bypassed. See the
[official library announcement](https://blog.freebetrange.com/article/the-gto-library-is-live).
