
# pyRevit Tool Catalog (Single HTML + CSS)

This workspace now builds a static documentation page from `bundle.md`.
The runtime output is:

- `index.html` (includes inline JavaScript + embedded tool data)
- `styles.css`

## How It Works

`scripts/generate-static-site.mjs` parses `bundle.md` and extracts:

- Toolbar tree structure (tab, panel, stack)
- Tool records from `*.pushbutton` folders
- Titles/tooltips from `bundle.yaml` where available
- Purpose/constraints/notes from `tool-context.md` where available

It then rewrites `index.html` with updated catalog data and writes parser diagnostics to `generated/catalog-diagnostics.json`.

## Update Workflow

1. Refresh `bundle.md` from your pyRevit extension snapshot.
2. Run:

```bash
npm run generate
```

3. Open `index.html` directly, or run a local preview server:

```bash
npm run preview
```

## Notes

- Tool adds/removes are automatic when new `*.pushbutton` paths appear/disappear in `bundle.md`.
- Tool metadata quality depends on `bundle.yaml` and `tool-context.md` completeness.
- Binary files in the bundle are counted in tree/file totals but not rendered as content.
- The page header includes metadata coverage stats and fallback counts for quick QA.
- Full diagnostics are written to `generated/catalog-diagnostics.json` on each run.
  