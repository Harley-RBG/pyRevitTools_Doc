
# pyRevit Tool Catalog (Single HTML + CSS)

This workspace now builds a static documentation page from `bundle.md`.
The runtime output is:

- `index.html` (includes inline JavaScript + embedded tool data)
- `styles.css`

## How It Works

`scripts/update-bundle.mjs` rebuilds `bundle.md` directly from your extension source folder.
Default source path:

`P:\Production\Computational\RBG_pyRevit\Extension\RBG_SYD.extension`

`scripts/generate-static-site.mjs` parses `bundle.md` and extracts:

- Toolbar tree structure (tab, panel, stack)
- Tool records from `*.pushbutton` folders
- Titles/tooltips from `bundle.yaml` where available
- Purpose/constraints/notes from `tool-context.md` where available

It then rewrites `index.html` with updated catalog data and writes parser diagnostics to `generated/catalog-diagnostics.json`.

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

Or run both in one step:

```bash
npm run site:update
```

4. Open `index.html` directly, or run a local preview server:

```bash
npm run preview
```

5. Commit and push the updated files (`bundle.md`, `index.html`, diagnostics) to GitHub.
6. Your GitHub deploy flow publishes the updated webpage.

## Notes

- Tool adds/removes are automatic when new `*.pushbutton` paths appear/disappear in `bundle.md`.
- Tool metadata quality depends on `bundle.yaml` and `tool-context.md` completeness.
- Binary files in the bundle are counted in tree/file totals but not rendered as content.
- The page header includes metadata coverage stats and fallback counts for quick QA.
- Full diagnostics are written to `generated/catalog-diagnostics.json` on each run.
- Optional source override for bundle updates:

```bash
node scripts/update-bundle.mjs --source="P:\\Production\\Computational\\RBG_pyRevit\\Extension\\RBG_SYD.extension"
```
  