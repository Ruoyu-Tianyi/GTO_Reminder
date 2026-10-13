# Preflop data format (schema version 1)

The bundled `DEMO_DATASET` is **synthetic interface demonstration data, not solver output**. Its frequencies are hand-authored fixtures. Neither the app nor its validator establishes GTO accuracy. Imported frequencies must come from a separately verified source that permits the intended use.

## File structure

Import one UTF-8 JSON file with this structure. The abbreviated frequencies below illustrate the format; an actual file must contain all 169 canonical hand classes in every node.

```json
{
  "schemaVersion": 1,
  "id": "provider-export-version",
  "name": "Descriptive source and solution name",
  "source": {
    "name": "Solver or data provider",
    "url": "https://example.com/source-and-assumptions",
    "license": "Exact license or personal-use permission and any limits",
    "retrievedAt": "2026-09-26",
    "kind": "imported"
  },
  "nodes": [
    {
      "id": "6max-100bb-btn-rfi",
      "spot": {
        "players": 6,
        "hero": "BTN",
        "villain": null,
        "stackBb": 100,
        "kind": "rfi",
        "openSizeBb": 2.5,
        "threeBetSizeBb": 10,
        "fourBetSizeBb": 22,
        "format": "cash",
        "anteBb": 0,
        "rake": "5% · 3 BB cap"
      },
      "frequencies": {
        "AA": { "raise": 1, "call": 0, "fold": 0 },
        "AKs": { "raise": 0.5, "call": 0, "fold": 0.5 }
      }
    }
  ]
}
```

The example numbers are format examples, not poker recommendations. `source.kind` is `demo`, `imported`, or `computed`; `imported` describes origin, not external verification. Source URL and license text remain user-supplied metadata. The app cannot verify the legal scope or solver quality of an uploaded file.

## Locally computed sources

The current verified inventory on 2026-10-13 contains **27,914 v2 history
decisions, 212 v1 quick nodes, and 64 files** across the baseline and three expanded
study packs. File validation confirms structure and action legality, not strategy
quality; the expanded packs remain unconverged.

For `source.kind: "computed"`, both v1 and v2 require `source.computation`:

```json
{
  "engine": "Engine and version",
  "model": "Explicit approximation model and configuration",
  "iterations": 54,
  "status": "approximate",
  "scope": "The actual included tree, sizes, exclusions, and quality limitations"
}
```

`engine`, `model`, and `scope` are nonempty strings. `iterations` is a nonnegative
safe integer; `status` is `approximate` or `unconverged`. This metadata identifies
a computation, not a claim that a full poker game has been solved. Source
validation does not establish convergence. Final diagnostics, including an
unmeasured final gap represented as `null`, belong in the corresponding local
solver audit; do not substitute a preceding checkpoint's gap.

Optional `computation.tree` declares fixed `openSizeBb`, `threeBetSizeBb`,
`fourBetSizeBb`, integer `maxRaises` from 1 to 5, and boolean `limp`.
The sizes are finite raise-to BB amounts excluding antes, at least 2 and
nondecreasing. Equal future sizes can be unused terminal all-in placeholders;
every action generated from a preset still passes legal replay. Optional
`limpRaiseBb` explicitly gives the first raise-to after an unopened limp; it is
not inferred from the opening size. Model presets reject unsupported limps,
raise counts and undeclared limp-raise sizes. Optional `modelGapBb` is a finite,
nonnegative final-snapshot **model** gap, or `null` when unmeasured. It is not
real-game exploitability. Quick/history snapshot matching includes these fields.

The verified baseline as of 2026-10-03 has four locally computed quick-lookup files with **126** v1
nodes: 6/7/8/9 players have 20/27/35/44 RFI and Facing Open nodes respectively.
They use Cash 100 BB, no ante, 5% rake capped at 2.5 BB, no flop no drop, 2.5 BB
opens and 10 BB 3-bets. The solved tree allows at most two raises and no limp.
It has no 4-bet or 5-bet continuation. Cold-call and squeeze decisions in that
restricted tree are kept in v2, not mislabeled as v1 heads-up responses.

The v1 export deliberately excludes Facing 3-bet/4-bet strategies from these
local solves because v1 cannot express their historical reach and unreachable
hands reliably. Use the [v2 history format](DATA_FORMAT_V2.md) and
[local solver audit](LOCAL_SOLVER.md) for the 27,270 full-history decisions.
All four table sizes reached the configured model target. The 9-player final
snapshot is at 54 iterations with a measured model best-response gap sum of
0.017725984946639545 BB/hand. This is an internal result of the restricted model,
not a real-game exploitability guarantee. A node count is not a convergence or
full-game coverage claim.

Two additional four-raise study packs export 360 v2 decisions and 42 v1 quick
nodes in four files. The 6-player pack allows limp and exports 200 history
decisions after 39 iterations; the 7-player pack has no limp and exports 160 after
40 iterations. Both retain `status: "unconverged"` and `modelGapBb: null`. Their
fixed raises are 2.5 / 10 / 30 / 100 BB. The `heads-up-lines` export includes
histories with at most two voluntary contributors and at most one unopened limp;
the broader modeled tree is solved, but its other branches are not exported.
Limp-capable RFI and later responses are viewed through v2 to preserve actions
and reach, rather than forced into v1.

When a selected local computed pack has no v1 node, Quick lookup queries its
linked v2 pack using the exact complete history. This displays the original v2
actions, reach, `missing`, and `unreachable` states; it does not flatten them into
v1 frequencies. The shared source fields, including model, iterations, quality
status, scope, and snapshot date, must match. Changed snapshots require a reload.
Only observed bet sizes filter this v2 view; future sizing controls do not remove
actions supplied by the model.

The v1 coverage report counts `computed` spots separately from `imported` spots.
Those source counts can overlap; `computedOnly` excludes any spot with an
imported source. Full-history v2 decisions remain a separate count, so Quick's
v2 lookup does not inflate v1 or imported coverage.

Published charts and the estimated 7-player seat projection use a separate
reference format. They are not imported into the exact-condition v1/v2 datasets;
see [source coverage](PUBLIC_CHARTS.md).

## Exact spot matching

All eleven `spot` fields participate in lookup. The app never rounds stacks, substitutes opponents, interpolates frequencies, or chooses the nearest solution. Unsupported spots show no strategy. Sizing fields are total bets in big blinds (a raise **to** that amount), not additional increments. All three sizing fields remain positive numeric identifiers in schema v1, even when a future action is unused. An unused future field may retain a default larger than the stack; it does not imply that the action is available.

`players` is the original table size, not the number of players who have continued. `stackBb` is a single equal/effective stack abstraction for this initial schema. It is unsuitable for importing a tree whose strategically relevant unequal stack distribution cannot be represented. `anteBb` is the per-player ante in BB; a big-blind-ante structure is not equivalent and is not supported. `rake` is an exact, human-readable identifier: write the percentage, cap, stakes, no-flop-no-drop rules, and other relevant assumptions consistently. Do not merge distinct rules under the same label.

`format: "mtt"` is reserved for **chip-EV** solutions whose other assumptions fit this schema. ICM, payout structures, bounties, unequal stacks, straddles, and multiway action histories require an extended schema and are not supported. A `cash`/`mtt` selector alone cannot encode those distinctions.

## Supported action lines

| `kind` | Prior action | Meaning of Raise | Meaning of Call |
| --- | --- | --- | --- |
| `rfi` | Everyone before Hero folded | Open to `openSizeBb` | Unavailable; limps require a different tree |
| `vs-open` | Villain opened, everyone else folded | 3-bet to `threeBetSizeBb` | Call Open |
| `vs-3bet` | Hero opened, Villain 3-bet, everyone else folded | 4-bet to `fourBetSizeBb` | Call 3-bet |
| `vs-4bet` | Villain opened, Hero 3-bet, Villain 4-bet | Aggregate 5-bet frequency; size is not represented | Call 4-bet |

Every omitted earlier or intervening player is assumed to have folded. No cold callers, squeezes, limped pots, multiple raise sizes within one node, or postflop decisions are represented. A 5-bet frequency is an aggregate action only: schema v1 does not specify its size or distinguish a non-all-in 5-bet from a shove. Extend the schema before using it for sizing recommendations.

Villain must appear before Hero in preflop action order for `vs-open` / `vs-4bet`, and after Hero for `vs-3bet`. For `rfi`, Villain is `null`; BB RFI is unavailable. In heads-up, **SB is also BTN / dealer** and acts first preflop.

| Players | Preflop action order |
| --- | --- |
| 2 | SB, BB |
| 3 | BTN, SB, BB |
| 4 | CO, BTN, SB, BB |
| 5 | HJ, CO, BTN, SB, BB |
| 6 | UTG, HJ, CO, BTN, SB, BB |
| 7 | UTG, LJ, HJ, CO, BTN, SB, BB |
| 8 | UTG, UTG+1, LJ, HJ, CO, BTN, SB, BB |
| 9 | UTG, UTG+1, UTG+2, LJ, HJ, CO, BTN, SB, BB |

## Hand classes and frequencies

The 13 ranks are `A K Q J T 9 8 7 6 5 4 3 2`. The range matrix has pairs on the diagonal, suited hands above it, and offsuit hands below it. JSON keys must be canonical: `AA`, `AKs`, `AKo`, etc.; reversed keys such as `KAs` are invalid. Every node must explicitly include all 169 hands, including pure folds. Missing entries are not silently interpreted as folds.

Each hand has exactly `raise`, `call`, and `fold`, as finite numbers in **[0, 1]**, summing to 1 within `0.000001`. Use `0.25` for 25%, not `25`. A class represents 6 pair combinations, 4 suited combinations, or 12 offsuit combinations; the entire grid represents 1,326 combinations. `rangeSummary` also returns fractions in **[0, 1]**, weighted by those counts; the UI multiplies by 100 to display percentages. These describe all starting-hand combinations, not a player's reach range at a later node.

The hand input accepts canonical classes in either rank order and case, or explicit cards such as `As Ks`, `K♥A♠`, and `AsAh`. `AK` is rejected as ambiguous; `AsAs` is rejected as an impossible duplicate card. Class-based data has no suit-specific distinctions or card-removal conditioning.

## Validation and scope

The validator checks required provenance, schema version, unique IDs and exact spots, table positions, action order, sizes, hand coverage, action keys, and frequency values/sums. Every size in the observed action history must exceed the previous bet, fit the stack, and meet the minimum raise unless it is all-in. Hero's next raise size receives the same checks when any hand has a positive Raise frequency. Unused future sizes only need to be finite and positive. For example, a 20 BB RFI node may retain a 22 BB future 4-bet placeholder; a node facing a 20 BB 3-bet shove may also retain it, but must have zero Raise frequency. RFI Call is invalid, and Raise facing an all-in is invalid. An open all-in between 1 and 2 BB is accepted as a short all-in; stacks at or below the 1 BB forced bet cannot create an open raise in this schema.

Validation does **not** verify solver convergence, exploitability, reach probabilities, game-tree completeness, source identity, licenses, or the accuracy of frequencies. Before labeling a future data pack as a solved strategy, record and independently verify its game rules, tree assumptions, export provenance, solver version, convergence criteria, redistribution permission, and full spot coverage. More complex trees should receive a new schema version rather than silently overloading these fields.
