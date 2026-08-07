import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = process.cwd();
const bundlePath = path.join(repoRoot, "bundle.md");
const htmlPath = path.join(repoRoot, "index.html");
const toolsPagesDir = path.join(repoRoot, "tools");
const diagnosticsDir = path.join(repoRoot, "generated");
const diagnosticsPath = path.join(diagnosticsDir, "catalog-diagnostics.json");
const generateCachePath = path.join(diagnosticsDir, "generate-cache.json");
const toolPagesCachePath = path.join(diagnosticsDir, "tool-pages-cache.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const quick = args.includes("--index-only");
  const fullUi = args.includes("--full-ui");
  const skipIfUnchanged = !args.includes("--force");

  return {
    mode: quick ? "quick" : fullUi ? "full" : "fast",
    includeHeavyUi: fullUi,
    includeUiSignals: !quick,
    writeToolPages: !quick,
    skipIfUnchanged,
    progress: true,
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

function writeTextIfChanged(filePath, content) {
  if (fs.existsSync(filePath)) {
    const current = readText(filePath);
    if (current === content) {
      return false;
    }
  }

  writeText(filePath, content);
  return true;
}

function writeTextIfChangedWithTransform(filePath, content, transform) {
  const normalize = typeof transform === "function" ? transform : (value) => value;
  if (fs.existsSync(filePath)) {
    const current = readText(filePath);
    if (normalize(current) === normalize(content)) {
      return false;
    }
  }

  writeText(filePath, content);
  return true;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  writeText(filePath, JSON.stringify(value, null, 2));
}

function writeJsonIfChanged(filePath, value) {
  const json = JSON.stringify(value, null, 2);
  return writeTextIfChanged(filePath, json);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readText(filePath));
  } catch {
    return null;
  }
}

function sha1Text(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 120);
}

function clearGeneratedHtmlFiles(dirPath) {
  ensureDir(dirPath);
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      fs.unlinkSync(path.join(dirPath, entry.name));
    }
  }
}

function listHtmlFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
    .map((entry) => entry.name);
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function stripNamespace(value) {
  return String(value || "").split(":").pop();
}

function parseXmlAttributes(rawAttrs) {
  const attrs = {};
  const attrRegex = /([A-Za-z_][A-Za-z0-9_:\.-]*)\s*=\s*"([^"]*)"/g;
  for (const match of rawAttrs.matchAll(attrRegex)) {
    attrs[`@_${match[1]}`] = match[2];
  }
  return attrs;
}

function parseSimpleXmlTree(xmlText) {
  const cleaned = String(xmlText || "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const tokenRegex = /<([^>]+)>|([^<]+)/g;
  const root = { name: "__root__", children: [] };
  const stack = [root];

  for (const match of cleaned.matchAll(tokenRegex)) {
    const tagToken = match[1];
    const textToken = match[2];

    if (textToken) {
      const text = textToken.replace(/\s+/g, " ").trim();
      if (text) {
        const current = stack[stack.length - 1];
        current.text = current.text ? `${current.text} ${text}` : text;
      }
      continue;
    }

    const tagBody = tagToken.trim();
    if (!tagBody || tagBody.startsWith("!") || tagBody.startsWith("?")) {
      continue;
    }

    if (tagBody.startsWith("/")) {
      const closingName = tagBody.slice(1).trim();
      while (stack.length > 1) {
        const current = stack.pop();
        if (current.name === closingName) {
          break;
        }
      }
      continue;
    }

    const selfClosing = tagBody.endsWith("/");
    const normalizedBody = selfClosing ? tagBody.slice(0, -1).trim() : tagBody;
    const firstSpace = normalizedBody.search(/\s/);
    const tagName = firstSpace === -1 ? normalizedBody : normalizedBody.slice(0, firstSpace);
    const rawAttrs = firstSpace === -1 ? "" : normalizedBody.slice(firstSpace + 1);

    const node = {
      name: tagName,
      attrs: parseXmlAttributes(rawAttrs),
      children: [],
      text: "",
    };

    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      stack.push(node);
    }
  }

  return root.children[0] || null;
}

function extractInlineXamlSources(pyFiles) {
  const sources = [];

  for (const file of pyFiles || []) {
    const regex = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:r|u|ur|ru|R|U|UR|RU)?(["']{3})([\s\S]*?<Window[\s\S]*?<\/Window>)\2/g;
    for (const match of file.content.matchAll(regex)) {
      const variableName = match[1];
      const xamlText = match[3].trim();
      if (!xamlText.includes("<Window")) {
        continue;
      }

      sources.push({
        name: `${file.name}:${variableName}`,
        sourceKind: "inline-xaml",
        content: xamlText,
      });
    }
  }

  return sources;
}

function getXamlNodeLabel(nodeName, node) {
  const attrs = node && typeof node === "object" ? (node.attrs || {}) : {};
  const label = attrs["@_Header"]
    || attrs["@_Content"]
    || attrs["@_Text"]
    || attrs["@_Title"]
    || attrs["@_x:Name"]
    || attrs["@_Name"]
    || node.text;

  if (typeof label === "string") {
    return label.replace(/\s+/g, " ").trim();
  }

  return stripNamespace(nodeName);
}

function collectXamlChildren(node) {
  if (!node || typeof node !== "object") {
    return [];
  }

  return asArray(node.children).map((child) => ({ key: child.name, value: child }));
}

function simplifyXamlPreviewNode(nodeName, node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 10) {
    return null;
  }

  const keyName = stripNamespace(nodeName);
  const structuralWrappers = new Set([
    "Window.Resources",
    "Grid.RowDefinitions",
    "Grid.ColumnDefinitions",
    "ListBox.ItemContainerStyle",
    "ComboBox.Template",
    "Setter.Value",
    "ControlTemplate",
    "Style",
    "Style.Triggers",
    "Trigger",
    "DataTemplate",
    "Border.BorderBrush",
  ]);

  if (structuralWrappers.has(keyName) || keyName.endsWith(".Resources") || keyName.endsWith(".Triggers")) {
    return null;
  }

  const containerTags = new Set(["Window", "Grid", "StackPanel", "DockPanel", "WrapPanel", "ScrollViewer", "GroupBox", "TabControl", "TabItem", "Border"]);
  const leafTags = new Set(["TextBlock", "Label", "TextBox", "ComboBox", "CheckBox", "RadioButton", "ListBox", "DataGrid", "DataGridTextColumn", "DataGridTemplateColumn", "Button", "TreeView"]);

  const childNodes = collectXamlChildren(node)
    .map((child) => simplifyXamlPreviewNode(child.key, child.value, depth + 1))
    .filter(Boolean);

  if (!containerTags.has(keyName) && !leafTags.has(keyName)) {
    if (childNodes.length === 1) {
      return childNodes[0];
    }
    if (childNodes.length > 1) {
      return {
        type: "Fragment",
        label: "Fragment",
        children: childNodes,
      };
    }
    return null;
  }

  const label = getXamlNodeLabel(nodeName, node);
  const previewNode = {
    type: keyName,
    label,
    children: childNodes,
  };

  if (keyName === "Window") {
    previewNode.title = (node.attrs && node.attrs["@_Title"]) || label;
  }

  return previewNode;
}

function buildPreviewTreeFromXamlText(xamlText) {
  try {
    const parsed = parseSimpleXmlTree(xamlText);
    if (!parsed || stripNamespace(parsed.name) !== "Window") {
      return null;
    }

    return simplifyXamlPreviewNode(parsed.name, parsed);
  } catch {
    return null;
  }
}

function renderXamlPreviewNode(node) {
  if (!node) {
    return "";
  }

  if (node.type === "Fragment") {
    return node.children.map((child) => renderXamlPreviewNode(child)).join("");
  }

  const cssType = toSlug(node.type || "node");
  const label = escapeHtml(node.label || node.type || "Node");
  const title = node.title ? `<div class="ui-preview-window-title">${escapeHtml(node.title)}</div>` : "";
  const childrenHtml = (node.children || []).map((child) => renderXamlPreviewNode(child)).join("");
  const body = childrenHtml ? `<div class="ui-preview-children">${childrenHtml}</div>` : "";

  if (["TextBlock", "Label"].includes(node.type)) {
    return `<div class="ui-preview-node ui-preview-${cssType} ui-preview-text">${label}</div>`;
  }

  if (["TextBox", "ComboBox", "CheckBox", "RadioButton", "Button"].includes(node.type)) {
    return `<div class="ui-preview-node ui-preview-${cssType}"><span class="ui-preview-node-tag">${escapeHtml(node.type)}</span><span class="ui-preview-node-label">${label}</span></div>`;
  }

  if (["ListBox", "DataGrid", "TreeView", "DataGridTextColumn", "DataGridTemplateColumn"].includes(node.type)) {
    return `<section class="ui-preview-node ui-preview-${cssType}"><header><span class="ui-preview-node-tag">${escapeHtml(node.type)}</span><span class="ui-preview-node-label">${label}</span></header>${body || '<div class="ui-preview-placeholder">Interactive content</div>'}</section>`;
  }

  return `<section class="ui-preview-node ui-preview-${cssType}">${title}<header><span class="ui-preview-node-tag">${escapeHtml(node.type)}</span><span class="ui-preview-node-label">${label}</span></header>${body}</section>`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function extractGridLayoutFromXaml(xamlText) {
  const rawColumnCount = Math.max(1, (xamlText.match(/<ColumnDefinition\b/g) || []).length);
  const rawRowCount = Math.max(1, (xamlText.match(/<RowDefinition\b/g) || []).length);

  const tagRegex = /<([A-Z][A-Za-z0-9]+)\b([^>]*)>/g;
  const blocks = [];
  const relevantTags = new Set([
    "TabControl",
    "TabItem",
    "GroupBox",
    "Button",
    "TextBox",
    "ComboBox",
    "CheckBox",
    "RadioButton",
    "ListBox",
    "DataGrid",
    "DataGridTextColumn",
    "DataGridTemplateColumn",
    "TreeView",
    "StackPanel",
    "TextBlock",
    "Label",
  ]);
  let autoRowCursor = 0;

  const getAttr = (attrs, name) => {
    const regex = new RegExp(`${name}\\s*=\\s*"([^\"]+)"`, "i");
    const match = attrs.match(regex);
    return match ? match[1].trim() : "";
  };

  const pickLabel = (tag, attrs) => {
    const candidates = [
      getAttr(attrs, "Header"),
      getAttr(attrs, "Content"),
      getAttr(attrs, "Text"),
      getAttr(attrs, "x:Name"),
    ].filter(Boolean);

    if (candidates.length > 0) {
      return candidates[0].replace(/\s+/g, " ").trim();
    }

    return tag;
  };

  for (const match of xamlText.matchAll(tagRegex)) {
    if (blocks.length >= 24) {
      break;
    }

    const tag = match[1];
    const attrs = match[2] || "";
    if (["Window", "Grid", "Style", "Setter", "Trigger", "ResourceDictionary", "RowDefinition", "ColumnDefinition"].includes(tag)) {
      continue;
    }

    if (!relevantTags.has(tag)) {
      continue;
    }

    const rawRowAttr = getAttr(attrs, "Grid.Row");
    const rawColAttr = getAttr(attrs, "Grid.Column");
    const row = Number.parseInt(rawRowAttr || "0", 10);
    const col = Number.parseInt(rawColAttr || "0", 10);
    const rowSpan = Number.parseInt(getAttr(attrs, "Grid.RowSpan") || "1", 10);
    const colSpan = Number.parseInt(getAttr(attrs, "Grid.ColumnSpan") || "1", 10);

    const hasExplicitGridPos = rawRowAttr !== "" || rawColAttr !== "";
    const isInteractive = /Button|ComboBox|CheckBox|RadioButton|ListBox|DataGrid|TextBox|TreeView/.test(tag);
    const isMajorContainer = /TabItem|GroupBox/.test(tag);

    if (!hasExplicitGridPos && !isInteractive && !isMajorContainer) {
      continue;
    }

    const inferredRow = hasExplicitGridPos ? row : autoRowCursor;
    const inferredCol = hasExplicitGridPos ? col : 0;
    if (!hasExplicitGridPos && (isInteractive || isMajorContainer)) {
      autoRowCursor += 1;
    }

    const safeRow = clamp(Number.isFinite(inferredRow) ? inferredRow : 0, 0, Math.max(0, rawRowCount - 1));
    const safeCol = clamp(Number.isFinite(inferredCol) ? inferredCol : 0, 0, Math.max(0, rawColumnCount - 1));
    const safeRowSpan = clamp(Number.isFinite(rowSpan) ? rowSpan : 1, 1, rawRowCount);
    const safeColSpan = clamp(Number.isFinite(colSpan) ? colSpan : 1, 1, rawColumnCount);

    const label = pickLabel(tag, attrs);
    blocks.push({
      tag,
      label,
      row: safeRow,
      col: safeCol,
      rowSpan: safeRowSpan,
      colSpan: safeColSpan,
    });
  }

  const effectiveRows = blocks.length
    ? Math.max(...blocks.map((b) => b.row + b.rowSpan))
    : 1;
  const effectiveCols = blocks.length
    ? Math.max(...blocks.map((b) => b.col + b.colSpan))
    : 1;

  return {
    rowCount: clamp(effectiveRows, 1, 12),
    columnCount: clamp(effectiveCols, 1, 4),
    blocks,
  };
}

function extractWpfMockup(xamlFiles, options = {}) {
  const includeHeavyUi = Boolean(options.includeHeavyUi);
  if (!xamlFiles || xamlFiles.length === 0) {
    return {
      hasXaml: false,
      fileNames: [],
      sourceKinds: [],
      controlCounts: [],
      namedElements: [],
      mockRows: [],
      previewTree: null,
      xamlLayout: {
        hasLayout: false,
        tabs: [],
        panes: [],
        actionButtons: [],
      },
    };
  }

  const controlMap = new Map();
  const namedElements = [];
  const tabHeaders = [];
  const groupHeaders = [];
  const textLabels = [];
  const buttonLabels = [];
  const sourceKinds = new Set();
  let bestGridLayout = { rowCount: 1, columnCount: 1, blocks: [] };
  let previewTree = null;

  const pushUnique = (arr, value, max = 16) => {
    const cleaned = String(value || "").replace(/\s+/g, " ").trim();
    if (!cleaned || arr.includes(cleaned) || arr.length >= max) {
      return;
    }
    arr.push(cleaned);
  };

  for (const file of xamlFiles) {
    const text = file.content;
    if (file.sourceKind) {
      sourceKinds.add(file.sourceKind);
    }
    if (includeHeavyUi && !previewTree) {
      previewTree = buildPreviewTreeFromXamlText(text);
    }
    if (includeHeavyUi) {
      const gridLayout = extractGridLayoutFromXaml(text);
      if (gridLayout.blocks.length > bestGridLayout.blocks.length) {
        bestGridLayout = gridLayout;
      }
    }
    const controlMatches = text.matchAll(/<([A-Z][A-Za-z0-9]+)\b/g);
    for (const match of controlMatches) {
      const control = match[1];
      if (["Window", "ResourceDictionary", "Style", "Setter", "Trigger"].includes(control)) {
        continue;
      }
      controlMap.set(control, (controlMap.get(control) || 0) + 1);
    }

    const nameMatches = text.matchAll(/x:Name\s*=\s*"([^"]+)"/g);
    for (const match of nameMatches) {
      if (namedElements.length >= 12) {
        break;
      }
      namedElements.push(match[1]);
    }

    const tabMatches = text.matchAll(/<TabItem\b[^>]*\bHeader\s*=\s*"([^"]+)"/g);
    for (const match of tabMatches) {
      pushUnique(tabHeaders, match[1], 8);
    }

    const groupMatches = text.matchAll(/<GroupBox\b[^>]*\bHeader\s*=\s*"([^"]+)"/g);
    for (const match of groupMatches) {
      pushUnique(groupHeaders, match[1], 14);
    }

    const textBlockMatches = text.matchAll(/<TextBlock\b[^>]*\bText\s*=\s*"([^"]+)"/g);
    for (const match of textBlockMatches) {
      pushUnique(textLabels, match[1], 24);
    }

    const labelMatches = text.matchAll(/<(?:Label|TextBox)\b[^>]*(?:Content|Text)\s*=\s*"([^"]+)"/g);
    for (const match of labelMatches) {
      pushUnique(textLabels, match[1], 24);
    }

    const buttonMatches = text.matchAll(/<Button\b[^>]*\bContent\s*=\s*"([^"]+)"/g);
    for (const match of buttonMatches) {
      pushUnique(buttonLabels, match[1], 12);
    }
  }

  const controlCounts = Array.from(controlMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const mockRows = controlCounts.slice(0, 8).map((item) => {
    const kind = ["Button", "ComboBox", "TextBox", "CheckBox", "RadioButton", "ListBox", "DataGrid"].includes(item.name)
      ? item.name
      : "Block";
    return {
      label: item.name,
      kind,
      count: item.count,
    };
  });

  const paneNames = dedupe([
    ...groupHeaders,
    ...textLabels.filter((label) =>
      /(source|target|filter|settings|selection|applicable|assignment|results|preview|scope box|section|layout|view)/i.test(label)
    ),
  ]).slice(0, 8);

  const panes = paneNames.map((name) => ({
    title: name,
    hint: /filter|selection|source|target/i.test(name) ? "Input" : /result|preview|status/i.test(name) ? "Output" : "Stage",
  }));

  const xamlLayout = {
    hasLayout: tabHeaders.length > 0 || panes.length > 0 || buttonLabels.length > 0,
    tabs: tabHeaders.slice(0, 8),
    panes,
    actionButtons: buttonLabels.slice(0, 8),
    gridModel: {
      rowCount: clamp(bestGridLayout.rowCount, 1, 12),
      columnCount: clamp(bestGridLayout.columnCount, 1, 8),
      blocks: bestGridLayout.blocks.slice(0, 20),
    },
  };

  return {
    hasXaml: true,
    fileNames: xamlFiles.map((f) => f.name),
    sourceKinds: Array.from(sourceKinds),
    controlCounts,
    namedElements: namedElements.slice(0, 10),
    mockRows,
    previewTree,
    xamlLayout,
  };
}

function extractPythonUiSignals(pyFiles, options = {}) {
  const includeHeavyUi = Boolean(options.includeHeavyUi);
  if (!pyFiles || pyFiles.length === 0) {
    return {
      hasPythonUi: false,
      hasWpfWindowClass: false,
      xamlReferences: [],
      inlineXamlSources: [],
      formsCalls: [],
      controlCounts: [],
      workflowStages: [],
      eventHandlers: [],
      windowTitles: [],
    };
  }

  const formsCallSet = new Set();
  const xamlReferenceSet = new Set();
  const eventHandlers = [];
  const functionNames = [];
  const titleSet = new Set();
  const inlineXamlSources = includeHeavyUi ? extractInlineXamlSources(pyFiles) : [];
  let hasWpfWindowClass = false;

  const controlNames = [
    "Button",
    "ComboBox",
    "TextBox",
    "CheckBox",
    "RadioButton",
    "ListBox",
    "DataGrid",
    "DataGridTextColumn",
    "TextBlock",
    "TreeView",
    "TabControl",
    "StackPanel",
    "Grid",
    "RowDefinition",
    "ColumnDefinition",
    "Expander",
    "Border",
  ];
  const controlMap = new Map(controlNames.map((name) => [name, 0]));

  for (const file of pyFiles) {
    const text = file.content;

    if (/class\s+[A-Za-z_][A-Za-z0-9_]*\s*\(\s*forms\.WPFWindow\s*\)/.test(text)) {
      hasWpfWindowClass = true;
    }

    const titleMatches = text.matchAll(/__title__\s*=\s*["']([^"']+)["']/g);
    for (const match of titleMatches) {
      titleSet.add(match[1].replace(/\s+/g, " ").trim());
    }

    const xamlMatches = text.matchAll(/["']([^"'\n]+\.xaml)["']/gi);
    for (const match of xamlMatches) {
      xamlReferenceSet.add(match[1]);
    }

    const formsMatches = text.matchAll(/\bforms\.([A-Za-z_][A-Za-z0-9_]*)\b/g);
    for (const match of formsMatches) {
      formsCallSet.add(match[1]);
    }

    const defMatches = text.matchAll(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm);
    for (const match of defMatches) {
      const fn = match[1];
      functionNames.push(fn);
      if (fn.startsWith("_on_")) {
        eventHandlers.push(fn.replace(/^_on_/, ""));
      }
    }

    for (const control of controlNames) {
      const regex = new RegExp(`\\b${control}\\b`, "g");
      const hits = text.match(regex);
      if (hits && hits.length > 0) {
        controlMap.set(control, (controlMap.get(control) || 0) + hits.length);
      }
    }
  }

  const stageRules = [
    { terms: ["choose", "pick", "select"], label: "Selection stage" },
    { terms: ["load", "collect", "reload", "refresh"], label: "Load and preparation stage" },
    { terms: ["filter", "search", "scope"], label: "Filter and scope stage" },
    { terms: ["preview", "sample", "inspect"], label: "Preview and inspection stage" },
    { terms: ["copy", "apply", "execute", "run", "update", "swap"], label: "Execution stage" },
    { terms: ["result", "status", "report", "summary", "output"], label: "Results and status stage" },
  ];

  const workflowStages = [];
  const normalizedFns = functionNames.map((fn) => fn.toLowerCase());
  for (const rule of stageRules) {
    const hit = normalizedFns.some((fn) => rule.terms.some((term) => fn.includes(term)));
    if (hit) {
      workflowStages.push(rule.label);
    }
  }

  const keyWorkflowMethods = dedupe(
    functionNames.filter((fn) =>
      /(^main$|^run$|^execute|^build_|^_build_|^_load|^_refresh|^_filter|^_choose|^_pick|^_select|^_copy|^_on_)/i.test(fn)
    )
  ).slice(0, 14);

  const rankedControls = Array.from(controlMap.entries())
    .filter((entry) => entry[1] > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    hasPythonUi: hasWpfWindowClass || formsCallSet.size > 0 || rankedControls.length > 0,
    hasWpfWindowClass,
    xamlReferences: Array.from(xamlReferenceSet).sort((a, b) => a.localeCompare(b)),
    inlineXamlSources,
    formsCalls: Array.from(formsCallSet).sort((a, b) => a.localeCompare(b)),
    controlCounts: rankedControls,
    workflowStages,
    keyWorkflowMethods,
    eventHandlers: dedupe(eventHandlers).slice(0, 12),
    windowTitles: Array.from(titleSet).slice(0, 6),
  };
}

function mergeUiMockup(wpfMockup, pythonUi) {
  const mergedControlMap = new Map();
  for (const item of wpfMockup.controlCounts || []) {
    mergedControlMap.set(item.name, (mergedControlMap.get(item.name) || 0) + item.count);
  }
  for (const item of pythonUi.controlCounts || []) {
    mergedControlMap.set(item.name, (mergedControlMap.get(item.name) || 0) + item.count);
  }

  const controlCounts = Array.from(mergedControlMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const namedElements = dedupe([
    ...(wpfMockup.namedElements || []),
    ...(pythonUi.eventHandlers || []).map((name) => `on_${name}`),
  ]).slice(0, 14);

  const fileNames = dedupe([...(wpfMockup.fileNames || []), ...(pythonUi.xamlReferences || [])]);

  const mockRows = controlCounts.slice(0, 8).map((item) => {
    const kind = ["Button", "ComboBox", "TextBox", "CheckBox", "RadioButton", "ListBox", "DataGrid"].includes(item.name)
      ? item.name
      : "Block";
    return {
      label: item.name,
      kind,
      count: item.count,
    };
  });

  return {
    sourceType: wpfMockup.hasXaml ? "xaml" : pythonUi.hasPythonUi ? "python" : "none",
    hasXaml: wpfMockup.hasXaml,
    hasPythonUi: pythonUi.hasPythonUi,
    hasWpfWindowClass: pythonUi.hasWpfWindowClass,
    previewTree: wpfMockup.previewTree || null,
    sourceKinds: wpfMockup.sourceKinds || [],
    xamlLayout: wpfMockup.xamlLayout || { hasLayout: false, tabs: [], panes: [], actionButtons: [] },
    fileNames,
    controlCounts,
    namedElements,
    mockRows,
    formsCalls: pythonUi.formsCalls || [],
    workflowStages: pythonUi.workflowStages || [],
    keyWorkflowMethods: pythonUi.keyWorkflowMethods || [],
    windowTitles: pythonUi.windowTitles || [],
  };
}

function buildToolPageHtml(tool, generatedAt, relatedTools = []) {
  const inputsHtml = tool.inputs.length
    ? `<ul>${tool.inputs.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p class=\"muted\">No explicit click or shift-click input hints were detected.</p>";

  const filesHtml = tool.files.length
    ? `<ul>${tool.files.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("")}</ul>`
    : "<p class=\"muted\">No file listing available.</p>";

  const xamlFilesHtml = tool.uiMockup.fileNames.length
    ? `<ul>${tool.uiMockup.fileNames.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join("")}</ul>`
    : "<p class=\"muted\">No XAML file found for this tool in bundle data.</p>";

  const controlsHtml = tool.uiMockup.controlCounts.length
    ? `<div class=\"mockup-chip-row\">${tool.uiMockup.controlCounts.slice(0, 12).map((item) => `<span class=\"mockup-chip\">${escapeHtml(item.name)} <strong>${item.count}</strong></span>`).join("")}</div>`
    : "<p class=\"muted\">No control tags detected.</p>";

  const mockRowsHtml = tool.uiMockup.mockRows.length
    ? tool.uiMockup.mockRows.map((row) => `<div class=\"mock-row mock-${escapeHtml(row.kind.toLowerCase())}\"><span>${escapeHtml(row.label)}</span><span>${row.count}</span></div>`).join("")
    : `<div class=\"mock-row mock-block\"><span>No WPF layout detected</span><span>0</span></div>`;

  const namedElementsHtml = tool.uiMockup.namedElements.length
    ? `<ul>${tool.uiMockup.namedElements.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join("")}</ul>`
    : "<p class=\"muted\">No x:Name elements detected.</p>";

  const parserMode = tool.uiMockup.sourceType === "xaml"
    ? "XAML + Python signals"
    : tool.uiMockup.sourceType === "python"
      ? "Python UI inference (WPF/forms)"
      : "No UI artifacts detected";

  const workflowStagesHtml = tool.uiMockup.workflowStages.length
    ? `<ul>${tool.uiMockup.workflowStages.map((stage) => `<li>${escapeHtml(stage)}</li>`).join("")}</ul>`
    : "<p class=\"muted\">No explicit staged workflow was inferred from script methods.</p>";

  const workflowMethodsHtml = tool.uiMockup.keyWorkflowMethods && tool.uiMockup.keyWorkflowMethods.length
    ? `<ul>${tool.uiMockup.keyWorkflowMethods.map((item) => `<li><code>${escapeHtml(item)}()</code></li>`).join("")}</ul>`
    : "<p class=\"muted\">No key workflow methods detected.</p>";

  const formsCallsHtml = tool.uiMockup.formsCalls.length
    ? `<div class=\"mockup-chip-row\">${tool.uiMockup.formsCalls.map((item) => `<span class=\"mockup-chip\">forms.${escapeHtml(item)}</span>`).join("")}</div>`
    : "<p class=\"muted\">No pyRevit forms calls detected.</p>";

  const windowTitlesHtml = tool.uiMockup.windowTitles.length
    ? `<ul>${tool.uiMockup.windowTitles.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p class=\"muted\">No explicit __title__ strings detected in script files.</p>";

  const previewTreeHtml = tool.uiMockup.previewTree
    ? `<div class="ui-preview-canvas">${renderXamlPreviewNode(tool.uiMockup.previewTree)}</div>`
    : "<p class=\"muted\">No parsed XAML preview is available for this tool yet.</p>";

  const previewSourceHtml = tool.uiMockup.sourceKinds.length
    ? `<div class="mockup-chip-row">${tool.uiMockup.sourceKinds.map((kind) => `<span class="mockup-chip">${escapeHtml(kind)}</span>`).join("")}</div>`
    : "<p class=\"muted\">Preview source not detected.</p>";

  const xamlTabsHtml = tool.uiMockup.xamlLayout && tool.uiMockup.xamlLayout.tabs.length
    ? `<div class=\"xaml-tab-row\">${tool.uiMockup.xamlLayout.tabs.map((tab, index) => `<span class=\"xaml-tab ${index === 0 ? "is-active" : ""}\">${escapeHtml(tab)}</span>`).join("")}</div>`
    : "<p class=\"muted\">No tab headers detected in XAML.</p>";

  const xamlPanesHtml = tool.uiMockup.xamlLayout && tool.uiMockup.xamlLayout.panes.length
    ? `<div class=\"xaml-pane-grid\">${tool.uiMockup.xamlLayout.panes.map((pane) => `<article class=\"xaml-pane\"><h5>${escapeHtml(pane.title)}</h5><p>${escapeHtml(pane.hint)}</p></article>`).join("")}</div>`
    : "<p class=\"muted\">No pane/group headers detected in XAML.</p>";

  const xamlActionsHtml = tool.uiMockup.xamlLayout && tool.uiMockup.xamlLayout.actionButtons.length
    ? `<div class=\"xaml-action-row\">${tool.uiMockup.xamlLayout.actionButtons.map((action) => `<span class=\"xaml-action\">${escapeHtml(action)}</span>`).join("")}</div>`
    : "<p class=\"muted\">No command button labels detected in XAML.</p>";

  const xamlGridModel = tool.uiMockup.xamlLayout && tool.uiMockup.xamlLayout.gridModel
    ? tool.uiMockup.xamlLayout.gridModel
    : { rowCount: 1, columnCount: 1, blocks: [] };

  const xamlGridBlocksHtml = xamlGridModel.blocks.length
    ? xamlGridModel.blocks.map((block) => {
      const maxRows = clamp(Number(xamlGridModel.rowCount) || 1, 1, 12);
      const maxCols = clamp(Number(xamlGridModel.columnCount) || 1, 1, 4);
      const startRow = clamp((Number(block.row) || 0) + 1, 1, maxRows);
      const startCol = clamp((Number(block.col) || 0) + 1, 1, maxCols);
      const endRow = clamp(startRow + clamp(Number(block.rowSpan) || 1, 1, maxRows), startRow + 1, maxRows + 1);
      const endCol = clamp(startCol + clamp(Number(block.colSpan) || 1, 1, maxCols), startCol + 1, maxCols + 1);
      const blockClass = /button/i.test(block.tag)
        ? "is-button"
        : /tab/i.test(block.tag)
          ? "is-tab"
          : /groupbox|datagrid|listbox/i.test(block.tag)
            ? "is-panel"
            : "";

      return `<article class=\"xaml-grid-item ${blockClass}\" style=\"grid-row:${startRow}/${endRow};grid-column:${startCol}/${endCol};\"><h6>${escapeHtml(block.tag)}</h6><p>${escapeHtml(block.label)}</p></article>`;
    }).join("")
    : "<p class=\"muted\">No positioned grid controls were inferred from XAML.</p>";

  const xamlGridHtml = xamlGridModel.blocks.length
    ? `<div class=\"xaml-grid-model\" style=\"--xaml-cols:${xamlGridModel.columnCount};--xaml-rows:${xamlGridModel.rowCount};\">${xamlGridBlocksHtml}</div>`
    : xamlGridBlocksHtml;

  const hasXamlWireframe = Boolean(tool.uiMockup.xamlLayout && tool.uiMockup.xamlLayout.hasLayout);

  const relatedToolsHtml = relatedTools.length
    ? `<div class="related-tool-grid">${relatedTools.map((item) => `<article class="related-tool-card"><h5><a href="../${escapeHtml(item.pagePath)}">${escapeHtml(item.title)}</a></h5><p>${escapeHtml(item.panel)} / ${escapeHtml(item.stack)}</p></article>`).join("")}</div>`
    : "<p class=\"muted\">No nearby tools were inferred for this panel yet.</p>";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(tool.title)} | pyRevit Tool</title>
    <link rel="stylesheet" href="../styles.css" />
  </head>
  <body>
    <div class="topbar">
      <span class="topbar-title">SJ-B+C pyRevit Catalog</span>
      <span class="topbar-badge">Tool Detail</span>
      <span class="topbar-sub">Generated from bundle metadata + WPF structure</span>
      <span class="topbar-tag">v1</span>
    </div>

    <div class="page">
      <div class="part">
        <span class="part-num">Tool</span>
        <span class="part-title">${escapeHtml(tool.title)}</span>
        <span class="part-rule"></span>
      </div>

      <div class="priority-card">
        <strong>Toolbar path:</strong> ${escapeHtml(tool.location)}
      </div>

      <div class="wiki-article-layout">
        <main class="wiki-article-main">
      <section class="card wiki-section" id="overview">
        <div class="card-head">
          <span class="card-title">Overview</span>
          <span class="card-hint">${escapeHtml(tool.tab)} / ${escapeHtml(tool.panel)} / ${escapeHtml(tool.stack)}</span>
        </div>
        <div class="card-body tool-page-summary wiki-body">
          <a class="back-link" href="../index.html">← Back to catalog</a>
          <div class="wiki-meta-grid">
            <p><strong>Function:</strong> ${escapeHtml(tool.function)}</p>
            <p><strong>Purpose:</strong> ${escapeHtml(tool.purpose)}</p>
            <p><strong>Toolbar tab:</strong> ${escapeHtml(tool.tab)}</p>
            <p><strong>Panel:</strong> ${escapeHtml(tool.panel)}</p>
          </div>
        </div>
      </section>

      <section class="card wiki-section" id="workflow">
        <div class="card-head">
          <span class="card-title">Workflow</span>
          <span class="card-hint">Detected operational flow from scripts</span>
        </div>
        <div class="card-body wiki-body">
          <h4 class="subhead">Workflow Stages</h4>
          ${workflowStagesHtml}

          <h4 class="subhead">Key Workflow Methods</h4>
          ${workflowMethodsHtml}

          <h4 class="subhead">Detected Forms Calls</h4>
          ${formsCallsHtml}

          <h4 class="subhead">Window Titles</h4>
          ${windowTitlesHtml}
        </div>
      </section>

      <section class="card wiki-section" id="ui-preview">
        <div class="card-head">
          <span class="card-title">UI Preview</span>
          <span class="card-hint">Parser mode: ${escapeHtml(parserMode)}</span>
        </div>
        <div class="card-body wiki-body">
          <h4 class="subhead">Rendered Preview</h4>
          ${previewTreeHtml}

          <h4 class="subhead">Preview Sources</h4>
          ${previewSourceHtml}

          ${hasXamlWireframe ? `
          <div class="xaml-wireframe">
            <h4 class="subhead">XAML Wireframe</h4>
            ${xamlTabsHtml}
            ${xamlPanesHtml}
            ${xamlActionsHtml}
            <h4 class="subhead">Grid Layout Approximation</h4>
            ${xamlGridHtml}
          </div>` : ""}

          <div class="mock-window">
            <div class="mock-window-bar">
              <span>${escapeHtml(tool.title)}</span>
              <span>${escapeHtml(tool.stack)}</span>
            </div>
            <div class="mock-window-body">
              ${mockRowsHtml}
            </div>
          </div>

          <h4 class="subhead">Detected Controls</h4>
          ${controlsHtml}

          <h4 class="subhead">XAML Files</h4>
          ${xamlFilesHtml}

          <h4 class="subhead">Window Titles</h4>
          ${windowTitlesHtml}

          <h4 class="subhead">Named Elements</h4>
          ${namedElementsHtml}
        </div>
      </section>

      <section class="card wiki-section" id="implementation">
        <div class="card-head">
          <span class="card-title">Implementation</span>
          <span class="card-hint">Inputs and bundle file coverage</span>
        </div>
        <div class="card-body tool-detail-grid wiki-body">
          <div>
            <h4 class="subhead">Inputs</h4>
            ${inputsHtml}
          </div>
          <div>
            <h4 class="subhead">Files (${tool.fileCount})</h4>
            ${filesHtml}
          </div>
        </div>
      </section>

      <section class="card wiki-section" id="related-tools">
        <div class="card-head">
          <span class="card-title">Related Tools</span>
          <span class="card-hint">Nearby panel and stack affinity</span>
        </div>
        <div class="card-body wiki-body">
          ${relatedToolsHtml}
        </div>
      </section>

      <section class="card wiki-section" id="provenance">
        <div class="card-head">
          <span class="card-title">Provenance</span>
          <span class="card-hint">Build and source traceability</span>
        </div>
        <div class="card-body wiki-body">
          <p><strong>Generated:</strong> ${generatedAt}</p>
          <p><strong>Source:</strong> bundle.md</p>
          <p><strong>Page:</strong> ${escapeHtml(tool.pagePath)}</p>
        </div>
      </section>
        </main>

        <aside class="wiki-rail" aria-label="Page progress">
          <h3>On This Page</h3>
          <nav class="wiki-toc" aria-label="Tool article sections">
            <a class="wiki-toc-link" href="#overview">Overview</a>
            <a class="wiki-toc-link" href="#workflow">Workflow</a>
            <a class="wiki-toc-link" href="#ui-preview">UI Preview</a>
            <a class="wiki-toc-link" href="#implementation">Implementation</a>
            <a class="wiki-toc-link" href="#related-tools">Related Tools</a>
            <a class="wiki-toc-link" href="#provenance">Provenance</a>
          </nav>
        </aside>
      </div>
    </div>

    <script>
      (function () {
        const links = Array.from(document.querySelectorAll('.wiki-toc-link'));
        const sections = links
          .map((link) => document.querySelector(link.getAttribute('href')))
          .filter(Boolean);

        if (!links.length || !sections.length || !('IntersectionObserver' in window)) {
          return;
        }

        const sectionToLink = new Map(
          links.map((link) => [link.getAttribute('href').slice(1), link])
        );

        function setActive(id) {
          for (const link of links) {
            link.classList.toggle('is-active', link.getAttribute('href') === '#' + id);
          }
        }

        const observer = new IntersectionObserver(
          (entries) => {
            const visible = entries
              .filter((entry) => entry.isIntersecting)
              .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

            if (!visible.length) {
              return;
            }

            const id = visible[0].target.id;
            if (sectionToLink.has(id)) {
              setActive(id);
            }
          },
          {
            root: null,
            rootMargin: '-20% 0px -60% 0px',
            threshold: [0.1, 0.4, 0.7],
          }
        );

        sections.forEach((section) => observer.observe(section));
        setActive(sections[0].id);
      })();
    </script>
  </body>
</html>`;
}

function writeToolPages(tools, generatedAt, options = {}) {
  ensureDir(toolsPagesDir);

  const mode = options.mode || "fast";
  const cache = readJsonIfExists(toolPagesCachePath) || {};
  const previous = (cache.byMode && cache.byMode[mode] && cache.byMode[mode].pages) || {};
  const nextPages = {};
  const expected = new Set();

  let written = 0;
  let skipped = 0;
  let deleted = 0;

  for (const tool of tools) {
    const pagePath = tool.pagePath.replace(/\\/g, "/");
    expected.add(pagePath);

    const relatedTools = tools
      .filter((candidate) => candidate.id !== tool.id)
      .map((candidate) => {
        const samePanel = candidate.panel === tool.panel;
        const sameStack = candidate.stack === tool.stack;
        const sameTab = candidate.tab === tool.tab;
        const score = (sameStack ? 3 : 0) + (samePanel ? 2 : 0) + (sameTab ? 1 : 0);
        return { candidate, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title))
      .slice(0, 6)
      .map((entry) => ({
        title: entry.candidate.title,
        pagePath: entry.candidate.pagePath,
        panel: entry.candidate.panel,
        stack: entry.candidate.stack,
      }));

    const html = buildToolPageHtml(tool, generatedAt, relatedTools);
    const stableHtml = html.replace(`Generated: ${generatedAt}`, "Generated: __GENERATED_AT__");
    const pageHash = sha1Text(stableHtml);
    nextPages[pagePath] = { hash: pageHash };

    const outputPath = path.join(repoRoot, pagePath);
    const prevHash = previous[pagePath] ? previous[pagePath].hash : null;
    if (prevHash === pageHash && fs.existsSync(outputPath)) {
      skipped += 1;
      continue;
    }

    ensureDir(path.dirname(outputPath));
    writeText(outputPath, html);
    written += 1;
  }

  for (const fileName of listHtmlFiles(toolsPagesDir)) {
    const rel = `tools/${fileName}`;
    if (expected.has(rel)) {
      continue;
    }
    fs.unlinkSync(path.join(toolsPagesDir, fileName));
    deleted += 1;
  }

  const nextCache = {
    byMode: {
      ...((cache && cache.byMode) || {}),
      [mode]: {
        generatedAt,
        pages: nextPages,
      },
    },
  };
  writeJson(toolPagesCachePath, nextCache);

  return {
    written,
    skipped,
    deleted,
    total: tools.length,
  };
}

function parseBundle(bundleText) {
  const lines = bundleText.split(/\r?\n/);
  const allPaths = [];
  const textFiles = new Map();

  let i = 0;
  while (i < lines.length) {
    const startMatch = lines[i].match(/^## FILE_START: (.+)$/);
    if (!startMatch) {
      i += 1;
      continue;
    }

    const relPath = startMatch[1].trim();
    allPaths.push(relPath);

    i += 1;

    let isText = false;
    while (i < lines.length && !lines[i].startsWith("## FILE_END:")) {
      if (lines[i] === "## TYPE: text") {
        isText = true;
      }

      if (isText && lines[i].startsWith("```")) {
        i += 1;
        const contentLines = [];
        while (i < lines.length && lines[i] !== "```") {
          contentLines.push(lines[i]);
          i += 1;
        }
        textFiles.set(relPath, contentLines.join("\n"));
      }

      i += 1;
    }

    i += 1;
  }

  return { allPaths, textFiles };
}

function cleanInlineValue(value) {
  return value
    .trim()
    .replace(/^['"]/, "")
    .replace(/['"]$/, "")
    .replace(/\\n/g, "\n");
}

function parseBundleYaml(yamlText) {
  const result = { title: "", tooltip: "" };
  const lines = yamlText.split(/\r?\n/);

  for (const line of lines) {
    const titleMatch = line.match(/^title:\s*(.+)$/i);
    if (titleMatch) {
      result.title = cleanInlineValue(titleMatch[1]);
      continue;
    }

    const tooltipMatch = line.match(/^tooltip:\s*(.+)$/i);
    if (tooltipMatch) {
      result.tooltip = cleanInlineValue(tooltipMatch[1]);
    }
  }

  return result;
}

function parseMarkdownSection(mdText, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?:\\n##\\s+|$)`, "i");
  const match = mdText.match(regex);
  if (!match) {
    return "";
  }

  return match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function parseContextDoc(contextText) {
  const titleMatch = contextText.match(/^#\s+(.+)$/m);
  return {
    title: titleMatch ? titleMatch[1].trim() : "",
    purpose: parseMarkdownSection(contextText, "Purpose"),
    constraints: parseMarkdownSection(contextText, "Critical Constraints"),
    notes: parseMarkdownSection(contextText, "Working Notes"),
    entryPoints: parseMarkdownSection(contextText, "Entry Points"),
  };
}

function toDisplayName(segment, suffixPattern) {
  const value = segment
    .replace(new RegExp(suffixPattern), "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value;
}

function pathToLocation(dirPath) {
  return dirPath.split("/").join(" > ");
}

function parseTooltipInputs(tooltip) {
  if (!tooltip) {
    return [];
  }

  return tooltip
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function classifyTab(panelName) {
  return panelName.toLowerCase() === "wip" ? "RBG WIP" : "SJ pyRevit";
}

function buildCatalog(bundleData, options = {}) {
  const includeHeavyUi = Boolean(options.includeHeavyUi);
  const includeUiSignals = options.includeUiSignals !== false;
  const showProgress = options.progress !== false;
  const { allPaths, textFiles } = bundleData;
  const pushbuttonDirs = new Set();

  for (const relPath of allPaths) {
    const marker = ".pushbutton/";
    const idx = relPath.indexOf(marker);
    if (idx === -1) {
      continue;
    }

    const dirPath = relPath.slice(0, idx + ".pushbutton".length);
    pushbuttonDirs.add(dirPath);
  }

  const tools = [];
  const tree = new Map();
  const dirList = Array.from(pushbuttonDirs).sort((a, b) => a.localeCompare(b));
  const totalDirs = dirList.length;
  let processedDirs = 0;

  for (const dirPath of dirList) {
    const segments = dirPath.split("/");
    if (segments.length < 2) {
      continue;
    }

    const panelSegment = segments.find((seg) => seg.endsWith(".panel")) || "Unknown.panel";
    const panelName = toDisplayName(panelSegment, "\\.panel$");
    const tab = classifyTab(panelName);

    const stackSegments = segments.filter((seg) => seg.endsWith(".stack") || seg.endsWith(".pulldown"));
    const stackName = stackSegments.length > 0 ? toDisplayName(stackSegments[stackSegments.length - 1], "\\.(stack|pulldown)$") : "Direct";

    const pushbuttonSegment = segments.find((seg) => seg.endsWith(".pushbutton")) || "Unknown.pushbutton";
    const toolSlug = toDisplayName(pushbuttonSegment, "\\.pushbutton$");

    const yamlPath = `${dirPath}/bundle.yaml`;
    const contextPath = `${dirPath}/tool-context.md`;

    const yamlInfo = textFiles.has(yamlPath) ? parseBundleYaml(textFiles.get(yamlPath)) : { title: "", tooltip: "" };
    const contextInfo = textFiles.has(contextPath) ? parseContextDoc(textFiles.get(contextPath)) : {
      title: "",
      purpose: "",
      constraints: "",
      notes: "",
      entryPoints: "",
    };

    const hasYaml = textFiles.has(yamlPath);
    const hasContext = textFiles.has(contextPath);

    const relatedFiles = allPaths
      .filter((p) => p.startsWith(`${dirPath}/`))
      .map((p) => p.slice(dirPath.length + 1));

    let uiMockup;
    if (includeUiSignals) {
      const xamlFiles = relatedFiles
        .filter((name) => name.toLowerCase().endsWith(".xaml"))
        .map((name) => ({
          name,
          sourceKind: "external-xaml",
          content: textFiles.get(`${dirPath}/${name}`) || "",
        }))
        .filter((item) => Boolean(item.content));

      const pyFiles = relatedFiles
        .filter((name) => name.toLowerCase().endsWith(".py"))
        .map((name) => ({
          name,
          content: textFiles.get(`${dirPath}/${name}`) || "",
        }))
        .filter((item) => Boolean(item.content));

      const pythonUi = extractPythonUiSignals(pyFiles, { includeHeavyUi });
      const xamlSources = [...xamlFiles, ...(pythonUi.inlineXamlSources || [])];
      const wpfMockup = extractWpfMockup(xamlSources, { includeHeavyUi });
      uiMockup = mergeUiMockup(wpfMockup, pythonUi);
    } else {
      uiMockup = {
        sourceType: "none",
        hasXaml: false,
        hasPythonUi: false,
        hasWpfWindowClass: false,
        previewTree: null,
        sourceKinds: [],
        xamlLayout: { hasLayout: false, tabs: [], panes: [], actionButtons: [], gridModel: { rowCount: 1, columnCount: 1, blocks: [] } },
        fileNames: [],
        controlCounts: [],
        namedElements: [],
        mockRows: [],
        formsCalls: [],
        workflowStages: [],
        keyWorkflowMethods: [],
        windowTitles: [],
      };
    }

    const functionText = yamlInfo.tooltip || contextInfo.entryPoints || "See tool context and source files for behavior details.";
    const purposeText = contextInfo.purpose || "Purpose not documented in tool-context.md.";

    const notes = dedupe([
      contextInfo.constraints,
      contextInfo.notes,
      `Files in bundle: ${relatedFiles.length}`,
    ]);

    const inputs = parseTooltipInputs(yamlInfo.tooltip);

    const pageSlug = toSlug(`${tab}-${panelName}-${toolSlug}`) || toSlug(toolSlug) || "tool";

    const tool = {
      id: dirPath,
      tab,
      panel: panelName,
      stack: stackName,
      title: yamlInfo.title || contextInfo.title || toolSlug,
      location: pathToLocation(dirPath),
      function: functionText,
      purpose: purposeText,
      inputs,
      notes,
      fileCount: relatedFiles.length,
      files: relatedFiles,
      pagePath: `tools/${pageSlug}.html`,
      uiMockup,
      sources: {
        hasYaml,
        hasContext,
        title: yamlInfo.title ? "bundle.yaml" : contextInfo.title ? "tool-context.md" : "path-fallback",
        function: yamlInfo.tooltip ? "bundle.yaml" : contextInfo.entryPoints ? "tool-context.md" : "fallback",
        purpose: contextInfo.purpose ? "tool-context.md" : "fallback",
      },
    };

    tools.push(tool);

    if (!tree.has(tab)) {
      tree.set(tab, new Map());
    }

    const panelMap = tree.get(tab);
    if (!panelMap.has(panelName)) {
      panelMap.set(panelName, new Map());
    }

    const stackMap = panelMap.get(panelName);
    if (!stackMap.has(stackName)) {
      stackMap.set(stackName, []);
    }

    stackMap.get(stackName).push(tool.title);

    processedDirs += 1;
    if (showProgress && (processedDirs % 10 === 0 || processedDirs === totalDirs)) {
      process.stdout.write(`Catalog progress: ${processedDirs}/${totalDirs} tools\n`);
    }
  }

  tools.sort((a, b) => {
    if (a.tab !== b.tab) return a.tab.localeCompare(b.tab);
    if (a.panel !== b.panel) return a.panel.localeCompare(b.panel);
    return a.title.localeCompare(b.title);
  });

  const treeData = [];
  for (const [tab, panelMap] of tree.entries()) {
    const panels = [];
    for (const [panelName, stackMap] of panelMap.entries()) {
      const stacks = [];
      for (const [stackName, toolTitles] of stackMap.entries()) {
        stacks.push({
          name: stackName,
          toolCount: toolTitles.length,
          tools: toolTitles.sort((a, b) => a.localeCompare(b)),
        });
      }

      stacks.sort((a, b) => a.name.localeCompare(b.name));
      panels.push({
        name: panelName,
        toolCount: stacks.reduce((sum, stack) => sum + stack.toolCount, 0),
        stacks,
      });
    }

    panels.sort((a, b) => a.name.localeCompare(b.name));
    treeData.push({
      name: tab,
      toolCount: panels.reduce((sum, panel) => sum + panel.toolCount, 0),
      panels,
    });
  }

  treeData.sort((a, b) => a.name.localeCompare(b.name));

  return {
    tools,
    tree: treeData,
  };
}

function countTabsFromPaths(paths) {
  const tabs = new Set(
    paths
      .filter((p) => p.endsWith(".tab") || p.includes(".tab/"))
      .map((p) => p.split("/")[0])
  );
  return tabs.size;
}

function buildDiagnostics(payload) {
  const tools = payload.tools;
  const missingYaml = tools.filter((tool) => !tool.sources.hasYaml).length;
  const missingContext = tools.filter((tool) => !tool.sources.hasContext).length;
  const titlePathFallback = tools.filter((tool) => tool.sources.title === "path-fallback").length;
  const functionFallback = tools.filter((tool) => tool.sources.function === "fallback").length;
  const purposeFallback = tools.filter((tool) => tool.sources.purpose === "fallback").length;

  const dupMap = new Map();
  for (const tool of tools) {
    const key = `${tool.tab}::${tool.panel}::${tool.title}`;
    if (!dupMap.has(key)) {
      dupMap.set(key, 0);
    }
    dupMap.set(key, dupMap.get(key) + 1);
  }

  const duplicateTitles = Array.from(dupMap.entries())
    .filter((entry) => entry[1] > 1)
    .map((entry) => ({ key: entry[0], count: entry[1] }));

  return {
    generatedAt: payload.meta.generatedAt,
    totals: {
      tools: tools.length,
      tabs: payload.tree.length,
      filesInBundle: payload.meta.totalFiles,
    },
    metadataCoverage: {
      withBundleYaml: tools.length - missingYaml,
      withToolContext: tools.length - missingContext,
      titleFromPathFallback: titlePathFallback,
      functionFallback,
      purposeFallback,
    },
    duplicateTitles,
  };
}

function buildHtml(data, diagnostics, generatedAt, allFileCount) {
  const dataJson = JSON.stringify(data);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>pyRevit Tool Catalog</title>
    <meta
      name="description"
      content="Generated pyRevit tool catalog and extension tree overview from bundle.md"
    />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="topbar">
      <span class="topbar-title">SJ-B+C pyRevit Catalog</span>
      <span class="topbar-badge">Business Standard</span>
      <span class="topbar-sub">Generated from extension bundle metadata</span>
      <span class="topbar-tag">v1</span>
    </div>

    <div class="page">

      <div class="part" id="summary-section">
        <span class="part-num">Part I</span>
        <span class="part-title">Catalog Summary</span>
        <span class="part-rule"></span>
      </div>

      <div class="priority-card">
        <strong>Priority rule.</strong> Bundle metadata is authoritative. Keep
        <code>bundle.yaml</code> and <code>tool-context.md</code> maintained for each pushbutton.
        Current coverage: <strong>${diagnostics.metadataCoverage.withToolContext}/${diagnostics.totals.tools}</strong>
        with tool-context docs, <strong>${diagnostics.metadataCoverage.withBundleYaml}/${diagnostics.totals.tools}</strong>
        with bundle metadata.
      </div>

      <section class="card site-header">
        <div class="card-head">
          <span class="card-title">Tool Catalog + File Tree Overview</span>
          <span class="card-hint">Search, tab filter, and metadata confidence</span>
        </div>
        <div class="card-body">
          <p class="kicker">pyRevit extension reference</p>
          <p class="lede">
            Generated from <strong>bundle.md</strong>. Update your extension, regenerate the bundle,
            then run the catalog generator to refresh this page.
          </p>

          <div class="stats" id="summary-stats"></div>
          <div class="diagnostics" id="coverage-summary"></div>

          <div class="controls">
            <div class="tab-panel-filters">
              <div class="tabs" id="tab-buttons"></div>
              <div class="panel-buttons" id="panel-buttons"></div>
            </div>
            <label class="search-wrap">
              <span>Search tools</span>
              <input id="search-input" type="search" placeholder="Title, panel, stack, path..." />
            </label>
          </div>
        </div>
      </section>

      <div class="part" id="tree-section">
        <span class="part-num">Part II</span>
        <span class="part-title">Extension Structure</span>
        <span class="part-rule"></span>
      </div>

      <main class="layout">
        <section class="tree card card-block">
          <div class="card-head">
            <span class="card-title">Extension Tree</span>
            <span class="card-hint">Tabs, panels, and stacks inferred from pushbutton paths</span>
          </div>
          <div class="card-body tree-root" id="tree-root"></div>
        </section>

        <section class="catalog card card-block" id="catalog-section">
          <div class="card-head">
            <span class="card-title">Tool Catalog</span>
            <span class="card-hint">Cards grouped by panel inside selected tab</span>
          </div>
          <div class="card-body catalog-root" id="catalog-root"></div>
        </section>
      </main>

      <footer class="site-footer">
        <p>Generated: ${generatedAt}</p>
        <p>Total files in bundle: ${allFileCount}</p>
      </footer>
    </div>

    <script>
      const DATA = ${dataJson};

      const state = {
        activeTab: DATA.tree[0] ? DATA.tree[0].name : "",
        activePanel: "",
        query: "",
      };

      const summaryStats = document.getElementById("summary-stats");
      const coverageSummary = document.getElementById("coverage-summary");
      const tabButtons = document.getElementById("tab-buttons");
      const panelButtons = document.getElementById("panel-buttons");
      const treeRoot = document.getElementById("tree-root");
      const catalogRoot = document.getElementById("catalog-root");
      const searchInput = document.getElementById("search-input");

      function textIncludes(haystack, needle) {
        return haystack.toLowerCase().includes(needle.toLowerCase());
      }

      function renderStats() {
        const panelCount = DATA.tree.reduce((sum, tab) => sum + tab.panels.length, 0);
        const stackCount = DATA.tree.reduce(
          (sum, tab) => sum + tab.panels.reduce((inner, panel) => inner + panel.stacks.length, 0),
          0
        );

        const stats = [
          ["Tools", DATA.tools.length],
          ["Tabs", DATA.tree.length],
          ["Panels", panelCount],
          ["Stacks", stackCount],
        ];

        summaryStats.innerHTML = stats
          .map(function (pair) {
            return '<div class="stat"><span>' + pair[0] + '</span><strong>' + pair[1] + '</strong></div>';
          })
          .join("");

        const coverage = DATA.meta.coverage;
        const duplicateCount = DATA.meta.duplicateTitles;
        coverageSummary.innerHTML =
          '<p><strong>Metadata coverage</strong>: ' +
          coverage.withBundleYaml + '/' + DATA.tools.length + ' tools with bundle.yaml, ' +
          coverage.withToolContext + '/' + DATA.tools.length + ' with tool-context.md.</p>' +
          '<p><strong>Fallbacks</strong>: title=' + coverage.titleFromPathFallback +
          ', function=' + coverage.functionFallback + ', purpose=' + coverage.purposeFallback +
          '. Duplicate title keys=' + duplicateCount + '.</p>';
      }

      function renderTabs() {
        const activeTabNode = DATA.tree.find(function (tab) { return tab.name === state.activeTab; });
        const activePanels = activeTabNode ? activeTabNode.panels.map(function (panel) { return panel.name; }) : [];

        if (!state.activePanel || !activePanels.includes(state.activePanel)) {
          state.activePanel = activePanels[0] || "";
        }

        tabButtons.innerHTML = DATA.tree
          .map(function (tab) {
            const activeClass = tab.name === state.activeTab ? "is-active" : "";
            return '<button class="tab-btn ' + activeClass + '" data-tab="' + tab.name + '">' + tab.name + '</button>';
          })
          .join("");

        panelButtons.innerHTML = activePanels
          .map(function (panel) {
            const activeClass = panel === state.activePanel ? "is-active" : "";
            return '<button class="panel-btn ' + activeClass + '" data-panel="' + panel + '">' + panel + '</button>';
          })
          .join("");

        Array.from(tabButtons.querySelectorAll("button")).forEach(function (button) {
          button.addEventListener("click", function () {
            state.activeTab = button.getAttribute("data-tab") || state.activeTab;
            const selectedTab = DATA.tree.find(function (tab) { return tab.name === state.activeTab; });
            const panels = selectedTab ? selectedTab.panels : [];
            state.activePanel = panels[0] ? panels[0].name : "";
            render();
          });
        });

        Array.from(panelButtons.querySelectorAll("button")).forEach(function (button) {
          button.addEventListener("click", function () {
            state.activePanel = button.getAttribute("data-panel") || state.activePanel;
            renderCatalog();
            renderTabs();
          });
        });
      }

      function renderTree() {
        treeRoot.innerHTML = DATA.tree
          .map(function (tab) {
            const panelHtml = tab.panels
              .map(function (panel) {
                const stacks = panel.stacks
                  .map(function (stack) {
                    return '<li><span>' + stack.name + '</span><strong>' + stack.toolCount + '</strong></li>';
                  })
                  .join("");

                return '<article class="tree-panel"><header><h4>' + panel.name + '</h4><span>' + panel.toolCount + ' tools</span></header><ul>' + stacks + '</ul></article>';
              })
              .join("");

            return '<section class="tree-tab"><h3>' + tab.name + ' <span>' + tab.toolCount + ' tools</span></h3><div class="tree-panels">' + panelHtml + '</div></section>';
          })
          .join("");
      }

      function filterTools() {
        return DATA.tools.filter(function (tool) {
          if (tool.tab !== state.activeTab) {
            return false;
          }

          if (state.activePanel && tool.panel !== state.activePanel) {
            return false;
          }

          if (!state.query.trim()) {
            return true;
          }

          const target = [
            tool.title,
            tool.panel,
            tool.stack,
            tool.location,
            tool.function,
            tool.purpose,
            tool.notes.join(" "),
          ].join(" ");

          return textIncludes(target, state.query);
        });
      }

      function renderCatalog() {
        const filtered = filterTools();

        if (filtered.length === 0) {
          catalogRoot.innerHTML = '<div class="empty-state"><h3>No tools match this filter.</h3><p>Try a different search term or switch tabs.</p></div>';
          return;
        }

        const groupedByPanel = new Map();
        for (const tool of filtered) {
          if (!groupedByPanel.has(tool.panel)) {
            groupedByPanel.set(tool.panel, []);
          }
          groupedByPanel.get(tool.panel).push(tool);
        }

        const sections = Array.from(groupedByPanel.entries())
          .sort(function (a, b) { return a[0].localeCompare(b[0]); })
          .map(function (entry) {
            const panel = entry[0];
            const tools = entry[1];
            const cards = tools
              .sort(function (a, b) { return a.title.localeCompare(b.title); })
              .map(function (tool) {
                const inputsHtml =
                  tool.inputs.length > 0
                    ? '<ul>' + tool.inputs.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>'
                    : '<p class="muted">No explicit click/shift input hints were detected.</p>';

                return '<article class="tool-card">' +
                  '<header><p class="stack-pill">' + tool.stack + '</p><h4><a class="tool-link" href="./' + tool.pagePath + '">' + tool.title + '</a></h4><code>' + tool.location + '</code></header>' +
                  '<p class="function">' + tool.function + '</p>' +
                  '<details open><summary>Purpose</summary><p>' + tool.purpose + '</p></details>' +
                  '<details><summary>Inputs</summary>' + inputsHtml + '</details>' +
                  '<details><summary>Files (' + tool.fileCount + ')</summary><p class="files">' + tool.files.join(', ') + '</p></details>' +
                '</article>';
              })
              .join("");

            return '<section class="panel-section"><header><h3>' + panel + '</h3><span>' + tools.length + ' tools</span></header><div class="tool-grid">' + cards + '</div></section>';
          })
          .join("");

        catalogRoot.innerHTML = sections;
      }

      function render() {
        renderStats();
        renderTabs();
        renderTree();
        renderCatalog();
      }

      searchInput.addEventListener("input", function (event) {
        state.query = event.target.value || "";
        renderCatalog();
      });

      render();
    </script>
  </body>
</html>`;
}

function hasToolPages() {
  if (!fs.existsSync(toolsPagesDir)) {
    return false;
  }
  return fs.readdirSync(toolsPagesDir).some((name) => name.toLowerCase().endsWith(".html"));
}

function main() {
  const options = parseArgs();
  if (!fs.existsSync(bundlePath)) {
    throw new Error("bundle.md not found in repository root.");
  }

  const bundleText = readText(bundlePath);
  const bundleSha1 = sha1Text(bundleText);
  const cache = readJsonIfExists(generateCachePath);
  const modeCache = cache && cache.byMode ? cache.byMode[options.mode] : cache;

  if (
    options.skipIfUnchanged &&
    modeCache &&
    modeCache.bundleSha1 === bundleSha1 &&
    modeCache.mode === options.mode &&
    fs.existsSync(htmlPath) &&
    fs.existsSync(diagnosticsPath) &&
    (options.writeToolPages ? hasToolPages() : true)
  ) {
    process.stdout.write(`Skipped generate: bundle unchanged (${options.mode} mode cache hit). Use --force to rebuild.\n`);
    return;
  }

  const bundleData = parseBundle(bundleText);
  const catalog = buildCatalog(bundleData, options);

  const generatedAt = new Date().toISOString();
  const tabCountFromPaths = countTabsFromPaths(bundleData.allPaths);

  const payload = {
    meta: {
      generatedAt,
      source: "bundle.md",
      totalFiles: bundleData.allPaths.length,
      inferredTabFolders: tabCountFromPaths,
      coverage: {},
      duplicateTitles: 0,
    },
    tree: catalog.tree,
    tools: catalog.tools,
  };

  const diagnostics = buildDiagnostics(payload);
  payload.meta.coverage = diagnostics.metadataCoverage;
  payload.meta.duplicateTitles = diagnostics.duplicateTitles.length;

  const normalizeGeneratedAt = (value) =>
    String(value).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "__GENERATED_AT__");

  ensureDir(diagnosticsDir);
  const diagnosticsText = JSON.stringify(diagnostics, null, 2);
  const diagnosticsWritten = writeTextIfChangedWithTransform(diagnosticsPath, diagnosticsText, normalizeGeneratedAt);

  const html = buildHtml(payload, diagnostics, generatedAt, bundleData.allPaths.length);
  const indexWritten = writeTextIfChangedWithTransform(htmlPath, html, normalizeGeneratedAt);
  let pageStats = null;
  if (options.writeToolPages) {
    pageStats = writeToolPages(payload.tools, generatedAt, options);
  }
  const nextCache = {
    byMode: {
      ...((cache && cache.byMode) || {}),
      [options.mode]: {
        generatedAt,
        mode: options.mode,
        bundleSha1,
        tools: payload.tools.length,
        filesInBundle: payload.meta.totalFiles,
      },
    },
  };
  writeJson(generateCachePath, nextCache);

  const summary = [
    `Generated ${path.basename(htmlPath)} from ${path.basename(bundlePath)}`,
    `Mode: ${options.mode}`,
    `Tools: ${payload.tools.length}`,
    options.writeToolPages
      ? `Tool pages: ${pageStats.written} written, ${pageStats.skipped} skipped, ${pageStats.deleted} deleted`
      : "Tool pages: skipped",
    `Index: ${indexWritten ? "written" : "skipped"}`,
    `Diagnostics file: ${diagnosticsWritten ? "written" : "skipped"}`,
    `Tabs: ${payload.tree.length}`,
    `Files in bundle: ${payload.meta.totalFiles}`,
    `Diagnostics: ${path.relative(repoRoot, diagnosticsPath)}`,
  ].join(" | ");

  process.stdout.write(`${summary}\n`);
}

main();
