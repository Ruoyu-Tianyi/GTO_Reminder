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

The example numbers are format examples, not poker recommendations. `source.kind` is `demo` or `imported`; `imported` describes origin, not external verification. Source URL and license text remain user-supplied metadata. The app cannot verify the legal scope or solver quality of an uploaded file.

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
