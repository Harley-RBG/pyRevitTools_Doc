// Dev helper: dump a single file block out of bundle.md
// usage: node scripts/dev-extract.mjs "<substring of rel path>" [maxLines]
import fs from "node:fs";

const needle = process.argv[2] || "";
const maxLines = Number(process.argv[3] || 0);
const text = fs.readFileSync("bundle.md", "utf8");
const re = /^## FILE_START: (.+)\r?\n([\s\S]*?)^## FILE_END: \1\r?$/gm;

let hits = 0;
for (const m of text.matchAll(re)) {
  if (!m[1].toLowerCase().includes(needle.toLowerCase())) continue;
  hits += 1;
  process.stdout.write(`\n===== ${m[1]} =====\n`);
  let body = m[2];
  if (maxLines > 0) body = body.split(/\r?\n/).slice(0, maxLines).join("\n");
  process.stdout.write(body + "\n");
}
if (!hits) process.stdout.write(`No file matched: ${needle}\n`);
