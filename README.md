
# pyRevit Tool Catalog (Single HTML + CSS)

This workspace now builds a static documentation page from `bundle.md`.
The runtime output is:

- `index.html` (includes inline JavaScript + embedded tool data)
- `styles.css`
- `tools/*.html` (tool detail pages)
- `tools/revit-tools-created-by.html` (author index from `__author__` tags)

Purpose and alignment tracker:

- `WORKING_HUB_TRACKER.md`
- `working-hub.json` (editable data source for Working Hub + Windows/Web app catalog placeholders)
- `tool-datasets.json` (per-tool static simulator datasets and control options)

## How It Works

`scripts/update-bundle.mjs` rebuilds `bundle.md` directly from your extension source folder.
Default source path:

`P:\Production\Computational\RBG_pyRevit\Extension\RBG_SYD.extension`

It also syncs tool UI screenshots from:

`P:\Production\Computational\RBG_pyRevit\Extension\Tool Screenshots`

Synced files are copied into `generated/tool-screenshots/` and indexed in `generated/tool-screenshots-manifest.json` for simulator mapping.

The updater keeps a local cache at `generated/bundle-cache.json` and reuses unchanged file blocks from the previous bundle when file size and modified time match. On repeated runs, only changed files are re-read and rebuilt.

`scripts/generate-static-site.mjs` parses `bundle.md` and extracts:

- Toolbar tree structure (tab, panel, stack)
- Tool records from `*.pushbutton` folders
- Titles/tooltips from `bundle.yaml` where available
- Purpose/constraints/notes from `tool-context.md` where available

It then rewrites `index.html` with updated catalog data and writes parser diagnostics to `generated/catalog-diagnostics.json`.
When tool pages are enabled, it performs hash-based incremental updates so unchanged `tools/*.html` files are skipped.
The generator also skips rewriting `index.html` and diagnostics when only generated timestamp values changed.

The generator now also writes:

- `generated/tool-catalog.json`
- `generated/ui-manifest.json`
- `generated/training-data.json`
- `generated/ui-diagnostics.json`
- `generated/tool-screenshots-manifest.json`

Simulator input data source:

- `tool-datasets.json` (optional, per-tool static datasets keyed by tool id)

Tool page cache location:

- `generated/tool-pages-cache.json`

## Update Workflow

1. Update files in your `.extension` folder.
2. Rebuild `bundle.md` from the extension source:

```bash
npm run bundle:update
```

3. Regenerate the webpage from `bundle.md`:

```bash
npm run generate
```

`generate` now runs in a lightweight mode and skips the rebuild entirely when `bundle.md` is unchanged.

For iterative UI/content work on the homepage only:

```bash
npm run generate:dev
```

For the fastest refresh (index + diagnostics only, no tool page rebuild):

```bash
npm run generate:quick
```

Or run both in one step:

```bash
npm run site:update
```

Note: when the source is on a network drive (for example `P:`), `bundle:update` can take a while.
The script now prints scan and progress checkpoints (`Progress: x/total files`) so you can see it is actively working.
`site:update` runs two separate steps by design: first `bundle:update`, then `generate`. It should not rescan unchanged source file contents on every run anymore.

Optional generation modes:

```bash
npm run generate:full   # heavier full UI preview parsing
npm run generate:force  # force rebuild even when bundle.md is unchanged
npm run site:update:quick  # bundle update + quick generate
```

`generate:force` still rebuilds index/diagnostics, but tool pages now use content comparison and skip unchanged files.

4. Open `index.html` directly, or run a local preview server:

```bash
npm run preview
```

5. Commit and push the updated files (`bundle.md`, `index.html`, diagnostics) to GitHub.
6. Your GitHub deploy flow publishes the updated webpage.

## Local Node Setup (No Admin / No Global npm)

This workspace supports local Node tooling from:

- `C:\node`
- `C:\nvm`

### PowerShell session setup

Run this once per new PowerShell terminal session:

```powershell
. .\scripts\use-local-node.ps1
```

Then run normal npm commands:

```powershell
npm run site:update
```

### One-click CMD workflow

If PowerShell execution policy blocks npm scripts, use:

```bat
site-update.cmd
```

This file prepends `C:\node` and `C:\nvm` to `PATH` and runs `npm run site:update` via `npm.cmd`.

## Notes

- Tool adds/removes are automatic when new `*.pushbutton` paths appear/disappear in `bundle.md`.
- Tool metadata quality depends on `bundle.yaml` and `tool-context.md` completeness.
- Binary files in the bundle are counted in tree/file totals but not rendered as content.
- The page header includes metadata coverage stats and fallback counts for quick QA.
- Full diagnostics are written to `generated/catalog-diagnostics.json` on each run.
- `.nojekyll` is included at repo root so GitHub Pages serves this as a static site without Jekyll processing.
- Incremental tool page write stats are shown in generate output (`written`, `skipped`, `deleted`).
- Revit tool author index is generated at `tools/revit-tools-created-by.html` using `__author__` and `__authors__` tags from pushbutton Python files.
- Optional source override for bundle updates:

```bash
node scripts/update-bundle.mjs --source="P:\\Production\\Computational\\RBG_pyRevit\\Extension\\RBG_SYD.extension"
```

## Wiki Refactor Roadmap

Phase 1: Information Architecture (in progress)

- Keep landing page as the catalog + navigation shell.
- Treat each tool page as a mini wiki article with consistent sections (overview, workflow, simulator, notes).
- Prioritize panel-first browsing and tool-level deep links.
- Implemented: section anchor navigation on generated tool pages for faster in-page scanning.
- Implemented: sticky right-side page progress rail with active section highlighting.
- Implemented: simulator-first tool pages with training-only interactive controls and output.
- Implemented: Working Hub and non-Revit app catalog placeholders on homepage.
- Implemented: Created By page for Revit tools based on author tags.

Phase 2: Simulator Fidelity Tiers

- Tier 1: Real screenshots (best, when available in source docs).
- Tier 2: Structured XAML renderer with layout groups and tool-specific components.
- Tier 3: Python/forms inference with scenario rules.
- Tier 4: Technical fallback (control tags, names, source files).

Current pilot status:

- Section Move (`SectionUpdater.pushbutton`) now uses a dedicated high-fidelity simulator layout with staged targets, plan/extents controls, and a crop extents batch table.
- This pilot is training-only and does not execute live Revit transactions.
- The renderer currently hard-targets the Section Move tool while other tools continue to use the generic simulator pipeline.
- Fidelity indicators for this tool are emitted in `generated/ui-diagnostics.json` (`high-fidelity-template-applied`, `xaml-layout-mapped`).

Phase 3: Telemetry Snapshot Ingestion

- Generate static telemetry snapshots during build (no runtime network calls).
- Surface usage totals and trend summaries on landing and tool pages.
- Keep GitHub Pages output static-only and cache-friendly.

Phase 4: Publishing and Validation

- Validate parser coverage changes with `generated/catalog-diagnostics.json`.
- Run quick mode during iteration; run full mode before publish.
- Use incremental write stats to monitor churn and generation cost over time.
  