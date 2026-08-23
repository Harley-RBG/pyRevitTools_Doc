import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const bundlePath = path.join(repoRoot, "bundle.md");
const toolCatalogPath = path.join(repoRoot, "generated", "tool-catalog.json");
const uiManifestPath = path.join(repoRoot, "generated", "ui-manifest.json");

function parseArgs(argv) {
  const args = {
    apply: false,
    extensionRoot: "P:\\Production\\Computational\\RBG_pyRevit\\Extension\\RBG_SYD.extension",
    backupDir: "",
  };

  argv.forEach((arg) => {
    if (arg === "--apply") {
      args.apply = true;
      return;
    }
    if (arg.startsWith("--extension-root=")) {
      args.extensionRoot = arg.slice("--extension-root=".length);
      return;
    }
    if (arg.startsWith("--backup-dir=")) {
      args.backupDir = arg.slice("--backup-dir=".length);
    }
  });

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toDisplayName(segment, suffixPattern) {
  return String(segment || "")
    .replace(new RegExp(suffixPattern), "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanInlineValue(value) {
  return String(value || "").replace(/^["']|["']$/g, "").trim();
}

function parseBundleYaml(yamlText) {
  const result = { title: "", tooltip: "" };
  String(yamlText || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const titleMatch = line.match(/^title:\s*(.+)$/i);
      if (titleMatch) {
        result.title = cleanInlineValue(titleMatch[1]);
        return;
      }

      const tooltipMatch = line.match(/^tooltip:\s*(.+)$/i);
      if (tooltipMatch) {
        result.tooltip = cleanInlineValue(tooltipMatch[1]);
      }
    });
  return result;
}

function parseMarkdownSection(mdText, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?:\\n##\\s+|$)`, "i");
  const match = String(mdText || "").match(regex);
  if (!match) {
    return "";
  }

  return match[1].trim();
}

function normalizeWrappedListItems(blockText) {
  const items = [];
  let current = "";

  for (const rawLine of String(blockText || "").split(/\r?\n/)) {
    if (/^\s*[_-]{5,}\s*$/.test(rawLine)) {
      continue;
    }

    if (!rawLine.trim()) {
      if (current) {
        items.push(current.trim());
        current = "";
      }
      continue;
    }

    const isBullet = /^\s*(?:[-*]|\d+[.)])\s+/.test(rawLine);
    const cleaned = rawLine.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim();
    if (!cleaned) {
      continue;
    }

    if (!current || isBullet) {
      if (current) {
        items.push(current.trim());
      }
      current = cleaned;
      continue;
    }

    current += ` ${cleaned}`;
  }

  if (current) {
    items.push(current.trim());
  }

  return items;
}

function parseMarkdownListSection(mdText, heading) {
  return normalizeWrappedListItems(parseMarkdownSection(mdText, heading));
}

function parseContextDoc(contextText) {
  const titleMatch = String(contextText || "").match(/^#\s+(.+)$/m);
  return {
    title: titleMatch ? titleMatch[1].trim() : "",
    purpose: normalizeWrappedListItems(parseMarkdownSection(contextText, "Purpose")).join(" "),
    workflow: parseMarkdownListSection(contextText, "Workflow"),
    constraints: normalizeWrappedListItems(parseMarkdownSection(contextText, "Critical Constraints")),
    notes: normalizeWrappedListItems(parseMarkdownSection(contextText, "Working Notes")),
    entryPoints: parseMarkdownListSection(contextText, "Entry Points"),
  };
}

function extractAssignedDocstring(text) {
  const match = String(text || "").match(/__doc__\s*=\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/m);
  return match ? (match[1] || match[2] || "").trim() : "";
}

function parseScriptDocSection(docText, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}:\\s*\\n?([\\s\\S]*?)(?=\\n\\s*[A-Za-z][A-Za-z\\- ]*:\\s*|$)`, "i");
  const match = String(docText || "").match(regex);
  if (!match) {
    return "";
  }

  return match[1]
    .replace(/^\s*[_-]{5,}\s*$/gm, "")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildBundleMap(bundleText) {
  const allPaths = [];
  const textFiles = new Map();
  const re = /^## FILE_START: (.+)\r?\n([\s\S]*?)^## FILE_END: \1\r?$/gm;

  for (const match of bundleText.matchAll(re)) {
    const relPath = match[1];
    const body = match[2];
    allPaths.push(relPath);

    const typeMatch = body.match(/^## TYPE: (.+)$/m);
    if (!typeMatch || typeMatch[1].trim() !== "text") {
      continue;
    }

    const fencedMatch = body.match(/```[^\n]*\r?\n([\s\S]*?)\r?\n```/);
    if (fencedMatch) {
      textFiles.set(relPath, fencedMatch[1]);
    }
  }

  return { allPaths, textFiles };
}

function injectOrReplaceWorkflowSection(markdown, workflowBlock) {
  const sectionPattern = /\n## Workflow\s*\n[\s\S]*?(?=\n##\s+|$)/i;
  if (sectionPattern.test(markdown)) {
    return markdown.replace(sectionPattern, `\n## Workflow\n${workflowBlock}\n`);
  }

  const purposePattern = /(\n## Purpose\s*\n[\s\S]*?)(?=\n##\s+|$)/i;
  if (purposePattern.test(markdown)) {
    return markdown.replace(purposePattern, (matchText) => `${matchText}\n\n## Workflow\n${workflowBlock}`);
  }

  const lines = [markdown.trimEnd(), "", "## Workflow", workflowBlock];
  return `${lines.join("\n")}\n`;
}

function formatWorkflowBlock(steps) {
  return steps.map((step) => `- ${step}`).join("\n");
}

function formatMarkdownListSection(heading, items) {
  if (!items.length) {
    return "";
  }
  return `## ${heading}\n${items.map((item) => `- ${item}`).join("\n")}\n`;
}

function inferFallbackWorkflow(title, purpose) {
  const lower = `${title}\n${purpose}`.toLowerCase();

  if (/view filter|filter editor|filters tab|override/.test(lower)) {
    return [
      "Review the target views or templates whose filter overrides need to be inspected.",
      `Run ${title} to browse, adjust, and stage the required filter override changes.`,
      "Apply the staged edits and verify the resulting visibility and graphics overrides are correct.",
    ];
  }

  if (/\bnext\b|\bprev\b|memory/.test(lower)) {
    return [
      "Review the saved memory state or selection context that this action will affect.",
      `Run ${title} to move, save, clear, or purge the stored memory state.`,
      "Confirm the active selection or stored memory data reflects the expected state change.",
    ];
  }

  if (/copy|paste|propagate/.test(lower)) {
    return [
      "Choose the source state and the target views, links, or elements that should receive it.",
      `Run ${title} to transfer the stored settings or overrides to the chosen targets.`,
      "Review the propagated result and rerun if any targets still need adjustment.",
    ];
  }

  if (/reorder|viewport|sheet/.test(lower)) {
    return [
      "Review the current sheet or viewport order before making changes.",
      `Run ${title} with the target sheet items you want to reorder.`,
      "Confirm the final sheet layout matches the intended presentation order.",
    ];
  }

  if (/\bunhide\b/.test(lower)) {
    return [
      "Open the view where hidden elements need to be restored.",
      `Run ${title} on the current view or chosen scope.`,
      "Confirm the previously hidden elements are visible again and the view is correct.",
    ];
  }

  if (/grid|level|crop|view range|extents|filter|view/.test(lower)) {
    return [
      "Prepare the target view and confirm the grids, levels, or view settings you want to adjust.",
      `Run ${title} with the required scope or option settings.`,
      "Review the updated view result and rerun if the displayed extents or filters need refinement.",
    ];
  }

  if (/template|reference/.test(lower)) {
    return [
      "Review the reference UI pattern or component set that the template exposes.",
      `Open or run ${title} to inspect the available controls and layout patterns.`,
      "Use the reference output to guide the downstream tool or UI design work.",
    ];
  }

  if (/select|selection|category/.test(lower)) {
    return [
      "Prepare the active view or model scope for the selection task.",
      `Run ${title} and choose the target categories, elements, or scope.`,
      "Review the resulting selection set and confirm it matches the intended criteria.",
    ];
  }

  return [
    purpose ? `Review the tool purpose and prerequisites: ${purpose}` : `Review the prerequisites for ${title}.`,
    `Run ${title} using the required model scope, options, or inputs.`,
    "Review the outcome and confirm the tool completed the intended workflow.",
  ];
}

function buildNewContextMarkdown(info) {
  const sections = [
    `# ${info.title}`,
    "",
    "## Purpose",
    info.purpose || "Purpose not documented yet.",
    "",
    "## Workflow",
    formatWorkflowBlock(info.workflowSteps),
    "",
    formatMarkdownListSection("Entry Points", info.entryPoints).trimEnd(),
    info.constraints.length ? "" : null,
    formatMarkdownListSection("Critical Constraints", info.constraints).trimEnd(),
    info.notes.length ? "" : null,
    formatMarkdownListSection("Working Notes", info.notes).trimEnd(),
  ].filter((part) => part !== null && part !== "");

  return `${sections.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleText = fs.readFileSync(bundlePath, "utf8");
  const bundle = buildBundleMap(bundleText);
  const toolCatalog = readJson(toolCatalogPath);
  const uiManifest = readJson(uiManifestPath);

  const manifestById = new Map(uiManifest.tools.map((tool) => [tool.id, tool]));
  const catalogById = new Map(toolCatalog.tools.map((tool) => [tool.id, tool]));

  const pushbuttonDirs = unique(
    bundle.allPaths
      .map((relPath) => {
        const idx = relPath.indexOf(".pushbutton/");
        return idx >= 0 ? relPath.slice(0, idx + ".pushbutton".length) : "";
      })
      .filter(Boolean)
  ).sort((a, b) => a.localeCompare(b));

  const backupRoot = args.backupDir ? path.resolve(args.backupDir) : "";
  const summary = {
    totalTools: 0,
    existingContexts: 0,
    createdContexts: 0,
    updatedContexts: 0,
    skippedTools: [],
  };

  if (args.apply && backupRoot) {
    ensureDir(backupRoot);
  }

  pushbuttonDirs.forEach((dirPath) => {
    const relWindowsPath = dirPath.replace(/\//g, "\\");
    const targetDir = path.join(args.extensionRoot, relWindowsPath);
    const targetPath = path.join(targetDir, "tool-context.md");
    const relatedFiles = bundle.allPaths
      .filter((filePath) => filePath.startsWith(`${dirPath}/`))
      .map((filePath) => filePath.slice(dirPath.length + 1));
    const pyFiles = relatedFiles
      .filter((name) => name.toLowerCase().endsWith(".py"))
      .map((name) => bundle.textFiles.get(`${dirPath}/${name}`) || "")
      .filter(Boolean);
    const yamlInfo = bundle.textFiles.has(`${dirPath}/bundle.yaml`)
      ? parseBundleYaml(bundle.textFiles.get(`${dirPath}/bundle.yaml`))
      : { title: "", tooltip: "" };
    const bundleContext = bundle.textFiles.has(`${dirPath}/tool-context.md`)
      ? parseContextDoc(bundle.textFiles.get(`${dirPath}/tool-context.md`))
      : { title: "", purpose: "", workflow: [], constraints: [], notes: [], entryPoints: [] };
    const catalogEntry = catalogById.get(dirPath) || null;
    const manifestEntry = manifestById.get(dirPath) || null;
    const docDescriptions = [];
    const docHowToSteps = [];
    const docTodoItems = [];

    pyFiles.forEach((text) => {
      const docText = extractAssignedDocstring(text);
      if (!docText) {
        return;
      }

      const desc = normalizeWrappedListItems(parseScriptDocSection(docText, "Description")).join(" ");
      if (desc) {
        docDescriptions.push(desc);
      }
      normalizeWrappedListItems(parseScriptDocSection(docText, "How-to")).forEach((item) => docHowToSteps.push(item));
      normalizeWrappedListItems(parseScriptDocSection(docText, "To-Do")).forEach((item) => docTodoItems.push(item));
    });

    const manifestWorkflowSteps = ((manifestEntry && manifestEntry.simulator && manifestEntry.simulator.workflow) || []).map((step) => step.label);

    const title =
      bundleContext.title ||
      (catalogEntry && catalogEntry.title) ||
      yamlInfo.title ||
      toDisplayName(dirPath.split("/").pop(), "\\.pushbutton$");
    const purpose =
      bundleContext.purpose ||
      docDescriptions[0] ||
      (catalogEntry && catalogEntry.purpose) ||
      yamlInfo.tooltip ||
      "Purpose not documented yet.";
    const resolvedWorkflowSteps = bundleContext.workflow.length
      ? unique(bundleContext.workflow)
      : docHowToSteps.length
        ? unique(docHowToSteps)
        : manifestWorkflowSteps.length
          ? unique(manifestWorkflowSteps)
          : inferFallbackWorkflow(title, purpose);
    const entryPoints = unique([
      ...bundleContext.entryPoints,
      ...relatedFiles.filter((name) => /\.(py|xaml)$/i.test(name)).map((name) => `\`${name}\``),
    ]);
    const constraints = unique(bundleContext.constraints);
    const notes = unique([
      ...bundleContext.notes,
      ...docTodoItems,
    ]);

    const exists = fs.existsSync(targetPath);
    const currentText = exists ? fs.readFileSync(targetPath, "utf8") : "";
    const nextText = exists
      ? injectOrReplaceWorkflowSection(currentText, formatWorkflowBlock(resolvedWorkflowSteps))
      : buildNewContextMarkdown({
          title,
          purpose,
          workflowSteps: resolvedWorkflowSteps,
          entryPoints,
          constraints,
          notes,
        });

    summary.totalTools += 1;
    if (exists) {
      summary.existingContexts += 1;
    }

    if (!args.apply) {
      if (exists) {
        summary.updatedContexts += 1;
      } else {
        summary.createdContexts += 1;
      }
      return;
    }

    ensureDir(targetDir);

    if (exists && backupRoot) {
      const backupPath = path.join(backupRoot, relWindowsPath, "tool-context.md");
      ensureDir(path.dirname(backupPath));
      fs.copyFileSync(targetPath, backupPath);
    }

    fs.writeFileSync(targetPath, nextText, "utf8");
    if (exists) {
      summary.updatedContexts += 1;
    } else {
      summary.createdContexts += 1;
    }
  });

  console.log(JSON.stringify(summary, null, 2));
}

main();
