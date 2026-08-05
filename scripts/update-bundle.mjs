import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = process.cwd();
const DEFAULT_SOURCE = String.raw`P:\Production\Computational\RBG_pyRevit\Extension\RBG_SYD.extension`;
const DEFAULT_OUT = path.join(repoRoot, "bundle.md");

const EXCLUDE_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "build",
  "dist",
  ".idea",
  ".vscode",
  ".vs",
  "node_modules",
  "third_party",
  "screenshots",
  "bundles",
  ".cache",
  "out",
  "logs",
  "tmp",
]);

const EXCLUDE_FILES = new Set(["bundle.md"]);
const EXCLUDE_EXTS = new Set([".log", ".csv", ".tsv", ".lock", ".map", ".sqlite"]);

const BINARY_EXT_HINTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".pdf",
  ".zip",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".pyd",
  ".so",
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const values = {
    source: DEFAULT_SOURCE,
    out: DEFAULT_OUT,
  };

  for (const arg of args) {
    if (arg.startsWith("--source=")) {
      values.source = arg.slice("--source=".length);
      continue;
    }
    if (arg.startsWith("--out=")) {
      values.out = arg.slice("--out=".length);
    }
  }

  return values;
}

function toPosix(relPath) {
  return relPath.split(path.sep).join("/");
}

function sha1Buffer(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function sha1File(filePath) {
  return sha1Buffer(fs.readFileSync(filePath));
}

function looksBinary(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXT_HINTS.has(ext)) {
    return true;
  }

  const buffer = fs.readFileSync(filePath);
  const probe = buffer.subarray(0, 4096);
  return probe.includes(0);
}

function safeReadText(filePath) {
  const buffer = fs.readFileSync(filePath);

  for (const encoding of ["utf8", "latin1"]) {
    try {
      return buffer.toString(encoding);
    } catch {
      // Try next
    }
  }

  return buffer.toString("utf8");
}

function langFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".py": "python",
    ".json": "json",
    ".js": "javascript",
    ".mjs": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".html": "html",
    ".css": "css",
    ".md": "markdown",
    ".yaml": "yaml",
    ".yml": "yaml",
  };

  return map[ext] || "";
}

function analyzePython(text) {
  const imports = new Set();
  const functions = [];
  const classes = [];

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const importMatch = line.match(/^\s*import\s+([^#]+)/);
    if (importMatch) {
      const names = importMatch[1].split(",").map((v) => v.trim().split(" ")[0]);
      for (const name of names) {
        if (name) imports.add(name);
      }
      continue;
    }

    const fromImportMatch = line.match(/^\s*from\s+([\w\.]+)\s+import\s+/);
    if (fromImportMatch) {
      imports.add(fromImportMatch[1]);
      continue;
    }

    const fnMatch = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (fnMatch) {
      functions.push(fnMatch[1]);
      continue;
    }

    const classMatch = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:(]/);
    if (classMatch) {
      classes.push(classMatch[1]);
    }
  }

  return {
    imports: Array.from(imports).sort(),
    functions,
    classes,
  };
}

function collectFiles(rootDir) {
  const results = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = toPosix(path.relative(rootDir, absPath));

      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }

        if (relPath.split("/").some((part) => EXCLUDE_DIRS.has(part))) {
          continue;
        }

        walk(absPath);
        continue;
      }

      if (EXCLUDE_FILES.has(entry.name)) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (EXCLUDE_EXTS.has(ext)) {
        continue;
      }

      results.push(absPath);
    }
  }

  walk(rootDir);

  results.sort((a, b) => {
    const relA = toPosix(path.relative(rootDir, a)).toLowerCase();
    const relB = toPosix(path.relative(rootDir, b)).toLowerCase();
    return relA.localeCompare(relB);
  });

  return results;
}

function buildBundle({ sourceDir, outFile }) {
  const files = collectFiles(sourceDir);
  const now = new Date().toISOString();

  const lines = [];
  lines.push("# AI BUNDLE");
  lines.push(`Generated: ${now}`);
  lines.push(`Root: ${sourceDir}`);
  lines.push(`Total Files: ${files.length}`);
  lines.push("");

  const pyFiles = files.filter((f) => path.extname(f).toLowerCase() === ".py");
  const entryPoints = pyFiles
    .map((f) => toPosix(path.relative(sourceDir, f)))
    .filter((rel) => ["main.py", "app.py", "run.py", "__main__.py"].includes(path.basename(rel)));

  lines.push(`## ENTRY_POINTS: ${JSON.stringify(entryPoints)}`);
  lines.push("");

  let totalBytes = 0;

  for (const filePath of files) {
    const rel = toPosix(path.relative(sourceDir, filePath));
    const stat = fs.statSync(filePath);
    totalBytes += stat.size;
    const sha = sha1File(filePath);

    lines.push(`## FILE_START: ${rel}`);
    lines.push(`## META: sha1=${sha} size=${stat.size}`);

    if (looksBinary(filePath)) {
      lines.push("## TYPE: binary");
      lines.push("(binary not inlined)");
      lines.push(`## FILE_END: ${rel}`);
      lines.push("");
      continue;
    }

    const text = safeReadText(filePath);
    lines.push("## TYPE: text");

    if (path.extname(filePath).toLowerCase() === ".py") {
      const analysis = analyzePython(text);
      lines.push(`## IMPORTS: ${JSON.stringify(analysis.imports)}`);
      lines.push(`## FUNCTIONS: ${JSON.stringify(analysis.functions)}`);
      lines.push(`## CLASSES: ${JSON.stringify(analysis.classes)}`);
    }

    lines.push("```" + langFor(filePath));
    lines.push(text);
    lines.push("```");
    lines.push(`## FILE_END: ${rel}`);
    lines.push("");
  }

  lines.push("## BUNDLE_INTEGRITY");
  lines.push(`FILES: ${files.length}`);
  lines.push(`TOTAL_BYTES: ${totalBytes}`);
  lines.push("STATUS: COMPLETE");
  lines.push("TRUNCATION: NONE");
  lines.push("## END_BUNDLE");

  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf8");

  return {
    fileCount: files.length,
    totalBytes,
    outFile,
    sourceDir,
  };
}

function main() {
  const { source, out } = parseArgs();
  const sourceDir = path.resolve(source);
  const outFile = path.resolve(out);

  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  const result = buildBundle({ sourceDir, outFile });
  process.stdout.write(
    `Updated bundle: ${path.basename(result.outFile)} | Source: ${result.sourceDir} | Files: ${result.fileCount} | Bytes: ${result.totalBytes}\n`
  );
}

main();
