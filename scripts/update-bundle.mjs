import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = process.cwd();
const DEFAULT_SOURCE = String.raw`P:\Production\Computational\RBG_pyRevit\Extension\RBG_SYD.extension`;
const DEFAULT_OUT = path.join(repoRoot, "bundle.md");
const CACHE_PATH = path.join(repoRoot, "generated", "bundle-cache.json");

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

function looksBinary(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXT_HINTS.has(ext)) {
    return true;
  }

  const probe = buffer.subarray(0, 4096);
  return probe.includes(0);
}

function safeReadText(buffer) {

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

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseExistingBundle(bundlePath) {
  if (!fs.existsSync(bundlePath)) {
    return new Map();
  }

  const text = fs.readFileSync(bundlePath, "utf8");
  const blockRegex = /^## FILE_START: (.+)\r?\n([\s\S]*?)^## FILE_END: \1\r?\n?/gm;
  const blocks = new Map();

  for (const match of text.matchAll(blockRegex)) {
    const relPath = match[1];
    const fullBlock = `## FILE_START: ${relPath}\n${match[2]}## FILE_END: ${relPath}\n`;
    blocks.set(relPath, fullBlock);
  }

  return blocks;
}

function renderFileBlock({ rel, filePath, buffer, fileSize }) {
  const lines = [];
  const sha = sha1Buffer(buffer);

  lines.push(`## FILE_START: ${rel}`);
  lines.push(`## META: sha1=${sha} size=${fileSize}`);

  const isBinary = looksBinary(filePath, buffer);
  if (isBinary) {
    lines.push("## TYPE: binary");
    lines.push("(binary not inlined)");
    lines.push(`## FILE_END: ${rel}`);
    lines.push("");
    return {
      block: lines.join("\n"),
      cacheEntry: {
        size: fileSize,
        mtimeMs: null,
        sha1: sha,
        binary: true,
      },
    };
  }

  const text = safeReadText(buffer);
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

  return {
    block: lines.join("\n"),
    cacheEntry: {
      size: fileSize,
      mtimeMs: null,
      sha1: sha,
      binary: false,
    },
  };
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
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      process.stdout.write(`Skipping unreadable directory: ${currentDir} (${error.message})\n`);
      return;
    }

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = toPosix(path.relative(rootDir, absPath));

      if (entry.isSymbolicLink()) {
        continue;
      }

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

      let stat;
      try {
        stat = fs.statSync(absPath);
      } catch (error) {
        process.stdout.write(`Skipping unreadable file: ${absPath} (${error.message})\n`);
        continue;
      }

      results.push({
        absPath,
        relPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  walk(rootDir);

  results.sort((a, b) => {
    return a.relPath.toLowerCase().localeCompare(b.relPath.toLowerCase());
  });

  return results;
}

function buildBundle({ sourceDir, outFile }) {
  process.stdout.write(`Scanning source: ${sourceDir}\n`);
  const files = collectFiles(sourceDir);
  const previousBlocks = parseExistingBundle(outFile);
  const existingCache = readJsonIfExists(CACHE_PATH) || {};
  const now = new Date().toISOString();

  const lines = [];
  lines.push("# AI BUNDLE");
  lines.push(`Generated: ${now}`);
  lines.push(`Root: ${sourceDir}`);
  lines.push(`Total Files: ${files.length}`);
  lines.push("");

  const pyFiles = files.filter((f) => path.extname(f.absPath).toLowerCase() === ".py");
  const entryPoints = pyFiles
    .map((f) => f.relPath)
    .filter((rel) => ["main.py", "app.py", "run.py", "__main__.py"].includes(path.basename(rel)));

  lines.push(`## ENTRY_POINTS: ${JSON.stringify(entryPoints)}`);
  lines.push("");

  let totalBytes = 0;
  let processedCount = 0;
  let reusedCount = 0;
  let rebuiltCount = 0;
  const nextCache = {};
  process.stdout.write(
    `Scanning complete. Building bundle from ${files.length} files...\n`
  );

  function maybeLogProgress() {
    const reachedBoundary = processedCount > 0 && processedCount % 25 === 0;
    const isDone = processedCount === files.length;
    if (isDone || reachedBoundary) {
      process.stdout.write(`Progress: ${processedCount}/${files.length} files\n`);
    }
  }

  for (const file of files) {
    totalBytes += file.size;

    const cached = existingCache[file.relPath];
    const cachedBlock = previousBlocks.get(file.relPath);
    const canReuse =
      Boolean(cachedBlock) &&
      cached &&
      cached.size === file.size &&
      cached.mtimeMs === file.mtimeMs;

    if (canReuse) {
      lines.push(cachedBlock.trimEnd());
      lines.push("");
      nextCache[file.relPath] = cached;
      reusedCount += 1;
      processedCount += 1;
      maybeLogProgress();
      continue;
    }

    const buffer = fs.readFileSync(file.absPath);
    const rendered = renderFileBlock({
      rel: file.relPath,
      filePath: file.absPath,
      buffer,
      fileSize: file.size,
    });

    lines.push(rendered.block.trimEnd());
    lines.push("");
    nextCache[file.relPath] = {
      ...rendered.cacheEntry,
      size: file.size,
      mtimeMs: file.mtimeMs,
    };
    rebuiltCount += 1;
    processedCount += 1;
    maybeLogProgress();
  }

  lines.push("## BUNDLE_INTEGRITY");
  lines.push(`FILES: ${files.length}`);
  lines.push(`TOTAL_BYTES: ${totalBytes}`);
  lines.push("STATUS: COMPLETE");
  lines.push("TRUNCATION: NONE");
  lines.push("## END_BUNDLE");

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
  fs.writeFileSync(CACHE_PATH, JSON.stringify(nextCache, null, 2) + "\n", "utf8");

  return {
    fileCount: files.length,
    totalBytes,
    outFile,
    sourceDir,
    reusedCount,
    rebuiltCount,
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
    `Updated bundle: ${path.basename(result.outFile)} | Source: ${result.sourceDir} | Files: ${result.fileCount} | Reused: ${result.reusedCount} | Rebuilt: ${result.rebuiltCount} | Bytes: ${result.totalBytes}\n`
  );
}

main();
