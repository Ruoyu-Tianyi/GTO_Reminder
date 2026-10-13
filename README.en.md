# Ruoyu Strategy Lab

[中文](README.md) · **English**

A preflop study workspace for **6–9 player, 100 BB cash games**. Explore starting-hand ranges, complete action histories, and conditional calculations while keeping sources, model limits, and uncertainty visible.

[Open the app](https://gto-reminder.vercel.app) · [GitHub](https://github.com/Ruoyu-Tianyi/GTO_Reminder) · [Deployment & domain](docs/DEPLOYMENT.md) · [Acceptance scope](docs/ACCEPTANCE.md) · [Data sources](docs/DATA_SOURCES.md) · [Roadmap](docs/ROADMAP.md)

The Vercel production site is live, and automatic deployment from GitHub `main` has been verified. The custom domain `https://gto.tianyizhou.cn` is connected to the project and awaits Alibaba Cloud DNS configuration; use “Open the app” above until it resolves. The repository and package names remain `GTO_Reminder` / `gto-reminder`.

## Features

- **Reference ranges:** inspect transcribed published charts and seat projections in a 13 × 13 starting-hand matrix, with action frequencies and source details.
- **Complete action histories:** build queries in action order and inspect independent models, bet sizes, reach weights, and calculation quality.
- **Quick lookup:** match player count, positions, stack depth, previous action, and sizing exactly; import your own strategy JSON.
- **Data coverage:** inspect standard cases, available sources, and unknown hands; open a decision or export the catalogue and gaps.
- **Study bookmarks:** save queries, hands, action histories, and source identity; import and export across devices with missing-source detection.
- **Local analysis:** simulate showdown equity for one hand or all 169 hand classes, and calculate conditional calling EV in eligible heads-up all-in situations.

The interface supports Chinese / English, a dark study theme, and mobile layouts. Positions and actions use familiar poker terminology.

## Coverage and accuracy

The static library's publication scope is shown below, based on the **local dataset audited on October 13, 2026**. Compressed snapshots are published with the app, preserving each source's precision, model conditions, and quality labels.

| Dataset | Count and interpretation |
| --- | --- |
| Standard scenario categories | **434 / 434**; 67 / 92 / 121 / 154 for 6 / 7 / 8 / 9 players |
| Reference scenarios | **325**: 234 published-chart transcriptions and 91 seat projections from 8 to 7 players |
| Independent computational models | **11**, including approximate models and research models marked as unconverged |
| Complete-history decisions | **29,425** v2 decisions |
| Quick nodes | **312** v1 nodes; these overlap with the action trees and must not be added to that total |

The catalogue covers RFI, responses to Open / 3-Bet / 4-Bet / 5-Bet, and two blind-limp scenarios. Each category has at least one source without unknown hand rows. Sources with different sizing, rake, histories, or models remain separate. See the [acceptance scope](docs/ACCEPTANCE.md) for the full definition.

**This is a strategy research tool. Its current datasets are not a complete, exact NLHE GTO solution.**

- Reference transcriptions preserve the original chart precision and unknown hands. Measured 8-player frequency bars have approximately ±2 percentage points of uncertainty; 7-player seat projections were not solved again.
- The added restricted models allow at most three voluntary contributors and one unopened limp, using fixed 2.5 / 10 / 30 / 100 BB sizes and approximate continuation values. Meeting an internal error target applies only to that restricted model. Earlier unconverged results keep their labels.
- Missing, unreachable, and actual Fold are distinct states. Queries never substitute player count, stacks, rake, or sizes, or interpolate unknown strategies.
- Equity and conditional EV depend on the assumed opponent range and rake. Sampling intervals describe sampling error only; they do not produce GTO action frequencies.
- Arbitrary stack depths, continuous sizing, complete multiplayer trees, postflop play, and ICM are outside the completed scope.

## Run locally

Use Node.js 20.19+ or 22.12+. Dependency versions are pinned by `package-lock.json`.

```bash
git clone https://github.com/Ruoyu-Tianyi/GTO_Reminder.git
cd GTO_Reminder
npm ci
npm run dev
```

Open the address printed in the terminal, normally `http://127.0.0.1:5173/`. The development server listens on localhost only.

On Windows, you can also run the launcher from the repository directory. It locates an installed Node.js runtime:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Add `-Port 5180` to use another port. Keep the terminal open and press `Ctrl+C` to stop.

```bash
npm test          # Data validation and poker logic tests
npm run build    # TypeScript checks and production build
npm run preview  # Preview dist/ locally
```

## Public strategy library and local data

The app uses a **fully static deployment** with no sign-in, backend database, or Supabase requirement. Selected application data is exported to `public/strategy-library/`: reference transcriptions, computational models, and explicitly allowlisted original PDFs. Compressed strategy shards load on demand. Gzip strategy data totals approximately **19.3 MiB**, plus **52.3 MiB** for three PDFs: **71.6 MiB** overall. PDFs load only when opened; the initial page does not download the entire library.

`data/private/` remains ignored by Git. The publication process exports only designated application files; runtime logs, solver checkpoints, audits, migration ZIPs, and other working files are excluded. The public snapshot includes the 434 categories, 325 reference scenarios, 11 models, and 29,425 history decisions listed above.

- **On the website:** the browser loads built-in ranges from the static library. Open the same site on another computer or phone to query them, without restoring local working data on every device.
- **During local development:** the local data API takes priority; production builds read the static snapshot. After changing local source data, run `npm run export:library`, then commit, build, and publish the generated static directory with the code to update the website.
- Download a template from data management, import authorized JSON, and select the matching scenario. Use v1 for quick nodes and v2 for complete histories; see the [v1 format](docs/DATA_FORMAT.md) and [v2 format](docs/DATA_FORMAT_V2.md).
- Manually imported strategies stay in the current page's memory and must be imported again after a refresh. The app does not upload those ranges to a server.
- Language preferences and study bookmarks are stored in the current browser. Bookmarks contain neither strategy frequencies nor PDFs; export and import them when changing devices.
- Demo frequencies are interface examples. Structural validation does not verify provider identity, licensing, solver convergence, or strategy quality.

## Work across devices

**Open the same website to study the built-in strategies on any device.** Move bookmarks through the interface, and sync development code and public data snapshots with Git. Personal bookmarks and manually imported strategies do not sync automatically through the cloud.

Before working on another device, update code and dependencies:

```bash
git pull --ff-only
npm ci
```

If another development machine also needs to repeat transcription, run solvers, or update a data snapshot, you can separately migrate the full local working dataset. Use the Python standard-library tool after calculations and data writes finish, then copy the generated file to that device:

```bash
python scripts/pack-local-data.py
python scripts/pack-local-data.py --verify "path/to/bundle.zip"
python scripts/pack-local-data.py --restore "path/to/bundle.zip" --dry-run
python scripts/pack-local-data.py --restore "path/to/bundle.zip"
```

The tool validates the manifest, SHA-256 hashes, and sizes. It skips identical files, refuses conflicting overwrites, and records the restore operation. Pack on the source device; verify and restore on the destination. See [data migration](docs/DATA_MIGRATION.md) for supported files, rollback, and interrupted restores.

To rebuild source data without a bundle, follow the [public-chart notes](docs/PUBLIC_CHARTS.md) and run the script below to restore reference originals and rebuild their transcriptions. It requires Python, `pypdf`, `Pillow`, and `numpy`. Generate approximate model data separately using the [local solver guide](docs/LOCAL_SOLVER.md). These steps are unnecessary for ordinary website queries.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/restore-reference-data.ps1
```

## Documentation and stack

The detailed guides below are currently in Chinese; code examples and schema identifiers are shared across both languages.

| Guide | Contents |
| --- | --- |
| [Vercel deployment and domain](docs/DEPLOYMENT.md) | Project settings, Alibaba Cloud DNS, HTTPS, and automatic deployment checks |
| [Acceptance scope](docs/ACCEPTANCE.md) · [Verification](docs/VERIFICATION.md) | Scenario definitions, completion boundaries, and validation evidence |
| [Study tools](docs/STUDY_TOOLS.md) | Bookmark recovery, range assumptions, and conditional EV |
| [Local solver](docs/LOCAL_SOLVER.md) · [Data migration](docs/DATA_MIGRATION.md) | Reproduction, resumed computation, migration, and rollback |
| [Format v1](docs/DATA_FORMAT.md) · [Format v2](docs/DATA_FORMAT_V2.md) | Strategy imports and model constraints |
| [Public charts](docs/PUBLIC_CHARTS.md) · [8-player transcription](docs/POKERCOACHING_TRANSCRIPTION.md) | Originals, page indexes, transcription precision, and gaps |
| [Data sources](docs/DATA_SOURCES.md) · [Roadmap](docs/ROADMAP.md) | Source integration and further research |

React 19 · TypeScript · Vite · Vitest · Native CSS. Vercel hosts the app and static strategy snapshots. Queries and interactive calculations run in the browser; local scripts restore source data, run independent solvers, and export snapshots. See the [deployment guide](docs/DEPLOYMENT.md#日常发布与数据更新) for the data update workflow.
