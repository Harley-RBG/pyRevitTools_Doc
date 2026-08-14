import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = process.cwd();
const bundlePath = path.join(repoRoot, "bundle.md");
const htmlPath = path.join(repoRoot, "index.html");
const toolsPagesDir = path.join(repoRoot, "tools");
const authorsPagePath = "tools/revit-tools-created-by.html";
const diagnosticsDir = path.join(repoRoot, "generated");
const diagnosticsPath = path.join(diagnosticsDir, "catalog-diagnostics.json");
const generateCachePath = path.join(diagnosticsDir, "generate-cache.json");
const toolPagesCachePath = path.join(diagnosticsDir, "tool-pages-cache.json");
const workingHubPath = path.join(repoRoot, "working-hub.json");
const toolDatasetsPath = path.join(repoRoot, "tool-datasets.json");
const toolCatalogPath = path.join(diagnosticsDir, "tool-catalog.json");
const uiManifestPath = path.join(diagnosticsDir, "ui-manifest.json");
const uiDiagnosticsPath = path.join(diagnosticsDir, "ui-diagnostics.json");
const trainingDataPath = path.join(diagnosticsDir, "training-data.json");
const screenshotManifestPath = path.join(diagnosticsDir, "tool-screenshots-manifest.json");

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

function normalizeLooseName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/\d+[a-z]?$/i, "");
}

function loadScreenshotManifest() {
  const parsed = readJsonIfExists(screenshotManifestPath);
  if (!parsed || !Array.isArray(parsed.files)) {
    return [];
  }
  return parsed.files
    .filter((item) => item && item.localPath && item.fileName)
    .map((item) => ({
      tabFolder: String(item.tabFolder || ""),
      fileName: String(item.fileName || ""),
      localPath: String(item.localPath || ""),
      normalizedName: normalizeLooseName(item.normalizedName || item.fileName || ""),
    }));
}

function buildToolScreenshotAliases(tool, toolSlug) {
  const normalizeAlias = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9]+/g, "");

  const aliases = new Set([
    normalizeAlias(tool.title),
    normalizeAlias(toolSlug),
    normalizeAlias((tool.id || "").split("/").slice(-1)[0]),
  ]);

  const title = String(tool.title || "").toLowerCase();
  if (title.includes("section move")) {
    aliases.add("sectiondetailupdater");
    aliases.add("sectionupdater");
  }
  if (title.includes("scope box view creation")) {
    aliases.add("viewcreatorselector");
  }
  if (title.includes("slab splitter")) {
    aliases.add("floorsplitter");
  }
  if (title.includes("packagecreator")) {
    aliases.add("packagecreator");
  }
  if (title.includes("schedule updater")) {
    aliases.add("scheduleupdater");
  }
  if (title.includes("paramcopier")) {
    aliases.add("paramcopier");
  }

  return Array.from(aliases).filter(Boolean);
}

function resolveToolScreenshots(tool, toolSlug, screenshotFiles) {
  if (!Array.isArray(screenshotFiles) || !screenshotFiles.length) {
    return [];
  }

  const aliases = buildToolScreenshotAliases(tool, toolSlug);
  const matches = [];

  for (const shot of screenshotFiles) {
    const sn = normalizeLooseName(shot.normalizedName || shot.fileName);
    let score = 0;
    for (const alias of aliases) {
      if (!alias) continue;
      if (sn === alias) {
        score = Math.max(score, 4);
      } else if (sn.startsWith(alias) || alias.startsWith(sn)) {
        score = Math.max(score, 3);
      } else if (alias.length >= 4 && (sn.includes(alias) || alias.includes(sn))) {
        score = Math.max(score, 2);
      }
    }

    if (score > 0) {
      matches.push({
        score,
        fileName: shot.fileName,
        localPath: shot.localPath,
        tabFolder: shot.tabFolder,
      });
    }
  }

  return matches
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.fileName.localeCompare(b.fileName);
    })
    .slice(0, 8)
    .map((item) => ({
      fileName: item.fileName,
      localPath: item.localPath,
      tabFolder: item.tabFolder,
    }));
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

function buildToolPageHtml(tool, generatedAt, toolDatasetsByToolId = {}) {
  const inputsHtml = tool.inputs.length
    ? `<ul>${tool.inputs.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p class=\"muted\">No explicit click or shift-click input hints were detected.</p>";

  const filesHtml = tool.files.length
    ? `<ul>${tool.files.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("")}</ul>`
    : "<p class=\"muted\">No file listing available.</p>";

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

  const notesHtml = tool.notes.length
    ? `<ul>${tool.notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p class=\"muted\">No notes were extracted for this tool.</p>";

  const screenshotHelpHtml = tool.screenshots && tool.screenshots.length
    ? `<div class="sim-shot-grid">${tool.screenshots
      .map((shot) => `<figure class="sim-shot"><img src="../${escapeHtml(shot.localPath)}" alt="${escapeHtml(tool.title)} screenshot: ${escapeHtml(shot.fileName)}" loading="lazy" /><figcaption>${escapeHtml(shot.fileName)}</figcaption></figure>`)
      .join("")}</div>`
    : "<p class=\"muted\">No UI screenshots mapped for this tool yet. Simulator uses inferred controls from code/XAML.</p>";

  const simulator = buildSimulatorModel(tool);
  const simulatorJson = JSON.stringify(simulator);
  const staticDataset = toolDatasetsByToolId[tool.id] || toolDatasetsByToolId[tool.title] || {};
  const staticDatasetJson = JSON.stringify(staticDataset);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(tool.title)} | Comp Design Wiki</title>
    <link rel="stylesheet" href="../styles.css" />
  </head>
  <body>
    <div class="topbar">
      <span class="topbar-title">Comp Design Wiki</span>
      <span class="topbar-badge">Tool Detail</span>
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

      <section class="card wiki-section" id="simulator">
        <div class="card-head">
          <span class="card-title">Simulator</span>
          <span class="card-hint">Interactive training mode (${escapeHtml(simulator.uiKind)})</span>
        </div>
        <div class="card-body wiki-body">
          <p class="simulator-intro">This simulator is for training only and does not execute live pyRevit/Revit logic.</p>
          <h4 class="subhead">Screenshot Reference</h4>
          ${screenshotHelpHtml}
          <div class="simulator-shell">
            <div class="simulator-toolbar">
              <span class="sim-chip">Controls: <strong id="sim-control-count">0</strong></span>
              <span class="sim-chip">Events: <strong id="sim-event-count">0</strong></span>
              <span class="sim-chip">Prompts: <strong id="sim-prompt-count">0</strong></span>
            </div>
            <div class="sim-tabs" role="tablist" aria-label="Simulator tabs">
              <button type="button" class="sim-tab is-active" aria-selected="true">Parameters</button>
              <button type="button" class="sim-tab" aria-selected="false">Results</button>
            </div>
            <div id="simulator-root" class="simulator-root" aria-live="polite"></div>
            <div class="simulator-output">
              <h4 class="subhead">Simulated Output</h4>
              <pre id="sim-output">Ready.</pre>
            </div>
          </div>
        </div>
      </section>

      <section class="card wiki-section" id="notes">
        <div class="card-head">
          <span class="card-title">Notes</span>
          <span class="card-hint">Inputs, files, and extracted notes</span>
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
          <div>
            <h4 class="subhead">Notes</h4>
            ${notesHtml}
          </div>
        </div>
      </section>
        </main>

        <aside class="wiki-rail" aria-label="Page progress">
          <h3>On This Page</h3>
          <nav class="wiki-toc" aria-label="Tool article sections">
            <a class="wiki-toc-link" href="#overview">Overview</a>
            <a class="wiki-toc-link" href="#workflow">Workflow</a>
            <a class="wiki-toc-link" href="#simulator">Simulator</a>
            <a class="wiki-toc-link" href="#notes">Notes</a>
          </nav>
        </aside>
      </div>
    </div>

    <script>
      (function () {
        const SIMULATOR = ${simulatorJson};
        const DATASET = ${staticDatasetJson};
        const links = Array.from(document.querySelectorAll('.wiki-toc-link'));
        const sections = links
          .map((link) => document.querySelector(link.getAttribute('href')))
          .filter(Boolean);
        const simulatorRoot = document.getElementById('simulator-root');
        const simOutput = document.getElementById('sim-output');

        function setText(id, value) {
          const node = document.getElementById(id);
          if (node) {
            node.textContent = String(value);
          }
        }

        function getControlOptions(control) {
          const source = DATASET.selectOptions || {};
          const options = source[control.id] || source[control.name] || source[control.label] || [];
          if (!Array.isArray(options) || !options.length) {
            return null;
          }
          return options.map((item) => String(item));
        }

        function createInput(control) {
          const wrap = document.createElement('label');
          wrap.className = 'sim-control';

          const title = document.createElement('span');
          title.className = 'sim-label';
          title.textContent = control.label + (control.required ? ' *' : '');
          wrap.appendChild(title);

          let field;
          if (control.kind === 'text') {
            field = document.createElement('input');
            field.type = 'text';
            field.placeholder = 'Enter ' + control.label;
          } else if (control.kind === 'select') {
            field = document.createElement('select');
            const selectOptions = getControlOptions(control) || ['Option A', 'Option B', 'Option C'];
            ['Select...'].concat(selectOptions).forEach((optionText, index) => {
              const option = document.createElement('option');
              option.value = index === 0 ? '' : optionText;
              option.textContent = optionText;
              field.appendChild(option);
            });
          } else if (control.kind === 'multiselect') {
            field = document.createElement('select');
            field.multiple = true;
            const multiOptions = getControlOptions(control) || ['Sample 1', 'Sample 2', 'Sample 3'];
            multiOptions.forEach((optionText) => {
              const option = document.createElement('option');
              option.value = optionText;
              option.textContent = optionText;
              field.appendChild(option);
            });
          } else if (control.kind === 'checkbox') {
            field = document.createElement('input');
            field.type = 'checkbox';
          } else if (control.kind === 'radio') {
            field = document.createElement('input');
            field.type = 'radio';
          } else {
            field = document.createElement('input');
            field.type = 'text';
          }

          field.dataset.controlId = control.id;
          field.dataset.required = control.required ? 'true' : 'false';
          field.className = 'sim-field';
          wrap.appendChild(field);
          return wrap;
        }

        function createButton(control) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'sim-action';
          button.textContent = control.label || 'Run';
          button.dataset.controlId = control.id;
          button.addEventListener('click', function () {
            const requiredFields = Array.from(simulatorRoot.querySelectorAll('[data-required="true"]'));
            const missing = requiredFields.filter((field) => {
              if (field.type === 'checkbox' || field.type === 'radio') {
                return !field.checked;
              }
              if (field.multiple) {
                return !Array.from(field.selectedOptions).length;
              }
              return !String(field.value || '').trim();
            });

            if (missing.length) {
              simOutput.textContent = 'Validation failed. Complete required inputs before running.';
              return;
            }

            simOutput.textContent = [
              'Simulation complete.',
              'Action: ' + button.textContent,
              'Controls evaluated: ' + SIMULATOR.controls.length,
              'Events mapped: ' + SIMULATOR.events.length,
              'No Revit model changes were made.',
            ].join('\\n');
          });
          return button;
        }

        function renderSimulator() {
          if (!simulatorRoot) {
            return;
          }

          if (String(SIMULATOR.toolId || '').includes('SectionUpdater.pushbutton')) {
            renderSectionUpdaterSimulator();
            return;
          }

          simulatorRoot.innerHTML = '';
          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          if (!SIMULATOR.controls.length) {
            const fallback = document.createElement('p');
            fallback.className = 'muted';
            fallback.textContent = 'No structured controls were detected. Use workflow and prompts as the training guide.';
            simulatorRoot.appendChild(fallback);
            return;
          }

          const form = document.createElement('div');
          form.className = 'sim-form';
          const actionRow = document.createElement('div');
          actionRow.className = 'sim-action-row';

          SIMULATOR.controls.forEach((control) => {
            if (control.kind === 'button') {
              actionRow.appendChild(createButton(control));
              return;
            }
            if (control.kind === 'table') {
              const datasetRows = Array.isArray(DATASET.sampleTableRows) ? DATASET.sampleTableRows : [];
              const tableRows = datasetRows.length
                ? datasetRows.map((row) => {
                  const cells = Array.isArray(row) ? row : [row];
                  const left = String(cells[0] || '');
                  const right = String(cells[1] || 'Ready');
                  return '<tr><td>' + left + '</td><td>' + right + '</td></tr>';
                }).join('')
                : '<tr><td>Sample Row A</td><td>Ready</td></tr><tr><td>Sample Row B</td><td>Queued</td></tr>';
              const tableWrap = document.createElement('div');
              tableWrap.className = 'sim-table-wrap sim-span-full';
              tableWrap.innerHTML = '<table><thead><tr><th>' + control.label + '</th><th>Status</th></tr></thead><tbody>' + tableRows + '</tbody></table>';
              form.appendChild(tableWrap);
              return;
            }
            form.appendChild(createInput(control));
          });

          if (!SIMULATOR.controls.some((control) => control.kind === 'button')) {
            actionRow.appendChild(createButton({ id: 'sim-run', label: 'Run Simulation', kind: 'button' }));
          }

          if (actionRow.children.length) {
            form.appendChild(actionRow);
          }

          simulatorRoot.appendChild(form);
        }

        function renderSectionUpdaterSimulator() {
          setText('sim-control-count', 22);
          setText('sim-event-count', 9);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          const secup = DATASET.sectionUpdater || {};
          const activeView = String(secup.activeView || 'BRACING TRUSS A/B - DETAILS');
          const defaultFilter = String(secup.defaultFilter || 'truss');

          const sampleSections = Array.isArray(secup.sampleSections) && secup.sampleSections.length
            ? secup.sampleSections.map((item) => String(item))
            : [
              'TRUSS B - SECTION (L0-1)',
              'TRUSS B - SECTION (L2-3)',
              'TRUSS B - SECTION (L3-4)',
              'TRUSS B - SECTION (L4-5)',
              'TRUSS B - SECTION (L5-6)',
              'TRUSS B - SECTION (L6-7)',
              'TRUSS C - SECTION (L0-1)',
              'TRUSS C - SECTION (L1-2)',
              'TRUSS C - SECTION (L2-3)',
            ];

          const rows = Array.isArray(secup.rows) && secup.rows.length
            ? secup.rows
            : [
              ['TRUSS B - SECTION (L2-3)', 'SSL LEVEL 1W', '3575.0', 'FFL LEVEL 3E', '-200.0', 'SSL LEVEL 1W', '3575.0', 'FFL LEVEL 3E'],
              ['TRUSS B - SECTION (L3-4)', 'SSL LEVEL 3W', '290.0', 'FFL LEVEL 4E', '-200.0', 'SSL LEVEL 3W', '290.0', 'FFL LEVEL 4E'],
              ['TRUSS B - SECTION (L4-5)', 'SSL LEVEL 4W', '180.0', 'SSL LEVEL 6W', '-2040.0', 'SSL LEVEL 4W', '180.0', 'SSL LEVEL 6W'],
              ['TRUSS B - SECTION (L5-6)', 'SSL LEVEL 5W', '1845.0', 'SSL LEVEL 7W', '-300.0', 'SSL LEVEL 5W', '1845.0', 'SSL LEVEL 7W'],
              ['TRUSS B - SECTION (L6-7)', 'SSL LEVEL 6W', '2310.0', 'SSL LEVEL 8AW', '-1115.0', 'SSL LEVEL 6W', '2310.0', 'SSL LEVEL 8AW'],
            ];

          const planViews = Array.isArray(secup.planViews) && secup.planViews.length ? secup.planViews : ['GA-SS LEVEL 1E', 'GA-SS LEVEL 2E'];
          const scopeBoxes = Array.isArray(secup.scopeBoxes) && secup.scopeBoxes.length ? secup.scopeBoxes : ['TRUSS B - GA E11/EA-EB', 'TRUSS C - GA E12/EA-EB'];
          const scopeSides = Array.isArray(secup.scopeSides) && secup.scopeSides.length ? secup.scopeSides : ['Top', 'Bottom', 'Left', 'Right'];
          const lowerLevels = Array.isArray(secup.lowerLevelOptions) && secup.lowerLevelOptions.length ? secup.lowerLevelOptions : ['DATUM'];
          const upperLevels = Array.isArray(secup.upperLevelOptions) && secup.upperLevelOptions.length ? secup.upperLevelOptions : ['NEW ROOF'];
          const lowerOffset = String(secup.defaultLowerOffset || '0.0');
          const upperOffset = String(secup.defaultUpperOffset || '0.0');

          function optionList(values) {
            return values.map((value) => '<option>' + String(value) + '</option>').join('');
          }

          simulatorRoot.innerHTML =
            '<div class="secup-layout">' +
              '<section class="secup-pane">' +
                '<h5>Targets</h5>' +
                '<p class="muted">Active view: ' + activeView + '</p>' +
                '<label class="sim-control"><span class="sim-label">Name filter</span><input id="secup-filter" class="sim-field" type="text" value="' + defaultFilter + '" /></label>' +
                '<label class="sim-control"><span class="sim-label">Sort</span><select id="secup-sort" class="sim-field"><option>Name A-Z</option><option>Name Z-A</option></select></label>' +
                '<div class="secup-toggle-row">' +
                  '<label><input id="secup-visible-only" type="checkbox" /> Visible in selected plan only</label>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="secup-refresh">Refresh</button>' +
                '</div>' +
                '<div class="secup-list-wrap"><select id="secup-sections" multiple class="sim-field secup-list"></select></div>' +
                '<div class="sim-action-row secup-actions-inline">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="secup-select-all">Select All</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="secup-clear-selection">Select None</button>' +
                '</div>' +
                '<div class="sim-action-row secup-actions-inline">' +
                  '<button type="button" class="sim-action" id="secup-add">Add to Selection</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="secup-clear-added">Clear Added</button>' +
                '</div>' +
                '<p><strong>Affected sections: </strong><span id="secup-affected-count">0</span></p>' +
              '</section>' +
              '<section class="secup-pane">' +
                '<h5>Plan + extent stages</h5>' +
                '<label class="sim-control"><span class="sim-label">Plan view for plan/scope stages</span><select class="sim-field">' + optionList(planViews) + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Scope box visible in selected plan</span><select class="sim-field">' + optionList(scopeBoxes) + '</select></label>' +
                '<div class="secup-toggle-col">' +
                  '<label><input type="checkbox" /> Move / rotate in plan</label>' +
                  '<label><input type="checkbox" /> Flip 180 after move</label>' +
                  '<label><input type="checkbox" /> Match horizontal extents to scope box side</label>' +
                  '<label><input type="checkbox" /> Assign scope box last</label>' +
                '</div>' +
                '<label class="sim-control"><span class="sim-label">Scope box side</span><select class="sim-field">' + optionList(scopeSides) + '</select></label>' +
                '<p><strong>Plan/extents stage ready:</strong> <span id="secup-stage-count">0</span> affected section(s).</p>' +
                '<button type="button" class="sim-action" id="secup-run-plan">Run Plan + Extents</button>' +
              '</section>' +
              '<section class="secup-pane secup-pane-wide">' +
                '<h5>Crop vertical extents from Levels</h5>' +
                '<div class="secup-toggle-col">' +
                  '<label><input type="radio" name="secup-crop-mode" checked /> Keep current vertical extents</label>' +
                  '<label><input type="radio" name="secup-crop-mode" /> Update vertical crop extents from Levels</label>' +
                '</div>' +
                '<div class="sim-action-row secup-actions-inline">' +
                  '<label class="sim-control"><span class="sim-label">Lower</span><select class="sim-field">' + optionList(lowerLevels) + '</select></label>' +
                  '<label class="sim-control"><span class="sim-label">Lower off mm</span><input class="sim-field" type="text" value="' + lowerOffset + '" /></label>' +
                  '<label class="sim-control"><span class="sim-label">Upper</span><select class="sim-field">' + optionList(upperLevels) + '</select></label>' +
                  '<label class="sim-control"><span class="sim-label">Upper off mm</span><input class="sim-field" type="text" value="' + upperOffset + '" /></label>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="secup-batch">Apply Batch To Selected</button>' +
                '</div>' +
                '<div class="sim-table-wrap secup-table-wrap">' +
                  '<table><thead><tr><th>View</th><th>Current lower</th><th>Cur off mm</th><th>Current upper</th><th>Cur off mm</th><th>Target lower</th><th>New off mm</th><th>Target upper</th></tr></thead><tbody id="secup-rows"></tbody></table>' +
                '</div>' +
                '<div class="sim-action-row">' +
                  '<button type="button" class="sim-action" id="secup-run-vertical">Run Vertical Crop Update</button>' +
                  '<button type="button" class="sim-action" id="secup-run-all">Run</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          const sectionList = document.getElementById('secup-sections');
          const filterInput = document.getElementById('secup-filter');
          const affectedCount = document.getElementById('secup-affected-count');
          const stageCount = document.getElementById('secup-stage-count');
          const rowsRoot = document.getElementById('secup-rows');
          const selected = new Set();

          function renderSections() {
            const q = String(filterInput.value || '').toLowerCase();
            const visible = sampleSections.filter((name) => name.toLowerCase().includes(q));
            sectionList.innerHTML = visible.map((name) => '<option value="' + name + '">' + name + '</option>').join('');
          }

          function renderRows() {
            rowsRoot.innerHTML = rows.map((row) => '<tr>' + row.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>').join('');
          }

          function refreshCounters() {
            const count = selected.size;
            affectedCount.textContent = String(count);
            stageCount.textContent = String(count);
          }

          document.getElementById('secup-refresh').addEventListener('click', function () {
            renderSections();
            simOutput.textContent = 'Refreshed visible section list.';
          });

          filterInput.addEventListener('input', renderSections);

          document.getElementById('secup-select-all').addEventListener('click', function () {
            Array.from(sectionList.options).forEach((opt) => {
              opt.selected = true;
            });
          });

          document.getElementById('secup-clear-selection').addEventListener('click', function () {
            Array.from(sectionList.options).forEach((opt) => {
              opt.selected = false;
            });
          });

          document.getElementById('secup-add').addEventListener('click', function () {
            Array.from(sectionList.selectedOptions).forEach((opt) => selected.add(opt.value));
            refreshCounters();
            simOutput.textContent = 'Added sections to staged selection: ' + selected.size;
          });

          document.getElementById('secup-clear-added').addEventListener('click', function () {
            selected.clear();
            refreshCounters();
            simOutput.textContent = 'Cleared staged section selection.';
          });

          document.getElementById('secup-run-plan').addEventListener('click', function () {
            if (!selected.size) {
              simOutput.textContent = 'Validation failed. Add at least one section before running Plan + Extents.';
              return;
            }
            simOutput.textContent = 'Plan + Extents complete. Sections processed: ' + selected.size + '\\nMove/rotate: simulated\\nScope alignment: simulated';
          });

          document.getElementById('secup-run-vertical').addEventListener('click', function () {
            if (!selected.size) {
              simOutput.textContent = 'Validation failed. Add at least one section before running Vertical Crop Update.';
              return;
            }
            simOutput.textContent = 'Vertical Crop Update complete. Updated rows: ' + selected.size + '\\nLower/upper constraints applied from simulator controls.';
          });

          document.getElementById('secup-batch').addEventListener('click', function () {
            simOutput.textContent = 'Batch target values applied to current staged rows (simulated).';
          });

          document.getElementById('secup-run-all').addEventListener('click', function () {
            if (!selected.size) {
              simOutput.textContent = 'Validation failed. Stage selections before full run.';
              return;
            }
            simOutput.textContent = 'Full run complete.\\nSelected: ' + selected.size + '\\nPlan/Extents: OK\\nVertical Crop: OK\\nIssues: 0';
          });

          renderSections();
          renderRows();
          refreshCounters();
        }

        renderSimulator();

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
  const toolDatasetsByToolId = options.toolDatasetsByToolId || {};
  const cache = readJsonIfExists(toolPagesCachePath) || {};
  const previous = (cache.byMode && cache.byMode[mode] && cache.byMode[mode].pages) || {};
  // Pages this generator has written in any mode. Used for stale cleanup so that
  // switching modes does not orphan pages a different mode produced.
  const generatedEver = new Set(
    Object.values((cache && cache.byMode) || {}).flatMap((entry) => Object.keys((entry && entry.pages) || {}))
  );
  const nextPages = {};
  const expected = new Set();

  let written = 0;
  let skipped = 0;
  let deleted = 0;

  for (const tool of tools) {
    const pagePath = tool.pagePath.replace(/\\/g, "/");
    expected.add(pagePath);

    const html = buildToolPageHtml(tool, generatedAt, toolDatasetsByToolId);
    const pageHash = sha1Text(html);
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

  const authorsHtml = buildAuthorsPageHtml(tools, generatedAt);
  const authorsPageKey = authorsPagePath.replace(/\\/g, "/");
  expected.add(authorsPageKey);
  const stableAuthorsHtml = authorsHtml.replace(`Generated: ${generatedAt}`, "Generated: __GENERATED_AT__");
  const authorsHash = sha1Text(stableAuthorsHtml);
  nextPages[authorsPageKey] = { hash: authorsHash };
  const authorsOutputPath = path.join(repoRoot, authorsPagePath);
  const prevAuthorsHash = previous[authorsPageKey] ? previous[authorsPageKey].hash : null;
  if (prevAuthorsHash === authorsHash && fs.existsSync(authorsOutputPath)) {
    skipped += 1;
  } else {
    ensureDir(path.dirname(authorsOutputPath));
    writeText(authorsOutputPath, authorsHtml);
    written += 1;
  }

  // Only remove pages this generator wrote on a previous run. Hand-authored pages in
  // tools/ (for example the Windows app wiki pages) were never in the cache, so they
  // are left alone instead of being treated as stale output.
  for (const fileName of listHtmlFiles(toolsPagesDir)) {
    const rel = `tools/${fileName}`;
    if (expected.has(rel) || !generatedEver.has(rel)) {
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

function slugifyId(value) {
  return toSlug(value) || "item";
}

function toSimulatorControlKind(value) {
  const key = String(value || "").toLowerCase();
  if (key.includes("textbox") || key === "textbox") return "text";
  if (key.includes("combobox") || key === "combobox") return "select";
  if (key.includes("listbox") || key === "listbox") return "multiselect";
  if (key.includes("datagrid") || key === "datagrid") return "table";
  if (key.includes("checkbox") || key === "checkbox") return "checkbox";
  if (key.includes("radiobutton") || key === "radio") return "radio";
  if (key.includes("button") || key === "button") return "button";
  if (key.includes("treeview") || key === "tree") return "tree";
  if (key.includes("tab") || key === "tabitem" || key === "tabcontrol") return "tabs";
  return "block";
}

function inferUiKind(tool) {
  const hasXaml = Boolean(tool.uiMockup && tool.uiMockup.hasXaml);
  const hasPyForms = Boolean(tool.uiMockup && tool.uiMockup.hasPythonUi);
  if (hasXaml && hasPyForms) return "mixed";
  if (hasXaml) return "wpf";
  if (hasPyForms) return "pyrevit-form";
  return "none";
}

function inferDynamicSources(tool) {
  const text = [
    ...(tool.uiMockup.workflowStages || []),
    ...(tool.uiMockup.keyWorkflowMethods || []),
    ...(tool.inputs || []),
    tool.function || "",
  ].join("\n").toLowerCase();

  const patterns = [
    "plan views",
    "levels",
    "scope boxes",
    "detail views",
    "sheets",
    "titleblocks",
    "families",
    "categories",
    "parameters",
  ];

  return patterns.filter((name) => text.includes(name));
}

function isSectionUpdaterTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("SectionUpdater.pushbutton") || /section\s*move/i.test(title);
}

function buildSectionUpdaterSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "section-updater-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "secup-filter", name: "SectionNameFilter", kind: "text", label: "Name filter", required: false },
      { id: "secup-sort", name: "SectionSort", kind: "select", label: "Sort", required: false },
      { id: "secup-visible-only", name: "VisibleInPlanOnly", kind: "checkbox", label: "Visible in selected plan only", required: false },
      { id: "secup-sections", name: "SectionSelection", kind: "multiselect", label: "Sections", required: true },
      { id: "secup-refresh", name: "RefreshSelection", kind: "button", label: "Refresh", required: false },
      { id: "secup-select-all", name: "SelectAll", kind: "button", label: "Select All", required: false },
      { id: "secup-clear-selection", name: "SelectNone", kind: "button", label: "Select None", required: false },
      { id: "secup-add", name: "AddToSelection", kind: "button", label: "Add to Selection", required: true },
      { id: "secup-clear-added", name: "ClearAdded", kind: "button", label: "Clear Added", required: false },
      { id: "secup-plan-view", name: "PlanViewSelector", kind: "select", label: "Plan view", required: true },
      { id: "secup-scope-box", name: "ScopeBoxSelector", kind: "select", label: "Scope box", required: true },
      { id: "secup-scope-side", name: "ScopeSide", kind: "select", label: "Scope box side", required: true },
      { id: "secup-run-plan", name: "RunPlanExtents", kind: "button", label: "Run Plan + Extents", required: true },
      { id: "secup-crop-mode", name: "VerticalCropMode", kind: "radio", label: "Vertical crop mode", required: false },
      { id: "secup-lower-level", name: "LowerLevel", kind: "select", label: "Lower level", required: false },
      { id: "secup-lower-offset", name: "LowerOffset", kind: "text", label: "Lower offset mm", required: false },
      { id: "secup-upper-level", name: "UpperLevel", kind: "select", label: "Upper level", required: false },
      { id: "secup-upper-offset", name: "UpperOffset", kind: "text", label: "Upper offset mm", required: false },
      { id: "secup-batch", name: "ApplyBatch", kind: "button", label: "Apply Batch To Selected", required: false },
      { id: "secup-rows", name: "SectionBatchRows", kind: "table", label: "Section rows", required: false },
      { id: "secup-run-vertical", name: "RunVerticalCrop", kind: "button", label: "Run Vertical Crop Update", required: false },
      { id: "secup-run-all", name: "RunAll", kind: "button", label: "Run", required: true },
    ],
    events: [
      { controlId: "secup-refresh", event: "click", handler: "refresh_sections" },
      { controlId: "secup-select-all", event: "click", handler: "select_all_sections" },
      { controlId: "secup-clear-selection", event: "click", handler: "select_none_sections" },
      { controlId: "secup-add", event: "click", handler: "add_staged_sections" },
      { controlId: "secup-clear-added", event: "click", handler: "clear_staged_sections" },
      { controlId: "secup-run-plan", event: "click", handler: "run_plan_extents" },
      { controlId: "secup-batch", event: "click", handler: "apply_batch_values" },
      { controlId: "secup-run-vertical", event: "click", handler: "run_vertical_crop" },
      { controlId: "secup-run-all", event: "click", handler: "run_full_update" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Stage at least one section before run." },
      { type: "alert", message: "Operation summary generated. No Revit changes were made." },
    ],
    workflow: [
      { step: 1, label: "Filter and stage section/detail targets" },
      { step: 2, label: "Configure plan move and scope alignment" },
      { step: 3, label: "Configure vertical crop levels and offsets" },
      { step: 4, label: "Run plan/extents stage or full update" },
      { step: 5, label: "Review summary output and adjust before rerun" },
    ],
    dynamicSources: ["plan views", "scope boxes", "levels", "detail views"],
    scenarios: [
      {
        id: "section-updater-training",
        title: "Section Updater Training Run",
        steps: [
          "Select relevant section/detail views",
          "Set plan and scope options",
          "Set lower/upper crop extents",
          "Run simulation and inspect log",
        ],
        expectedOutput: [
          "Selected targets processed in two stages",
          "Plan move and extents simulated",
          "Vertical crop extents simulated",
          "No Revit model changes were made",
        ],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "xaml-layout-mapped"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildSimulatorModel(tool) {
  const uiKind = inferUiKind(tool);

  if (isSectionUpdaterTool(tool)) {
    return buildSectionUpdaterSimulatorModel(tool, uiKind);
  }

  const controls = [];
  const events = [];

  const namedElements = tool.uiMockup.namedElements || [];
  namedElements.forEach((name) => {
    const normalized = slugifyId(name);
    const controlKind = /btn|button|run|apply|ok/i.test(name)
      ? "button"
      : /cmb|combo/i.test(name)
        ? "select"
        : /txt|text/i.test(name)
          ? "text"
          : /chk|check/i.test(name)
            ? "checkbox"
            : "block";

    controls.push({
      id: normalized,
      name,
      kind: controlKind,
      label: name,
      required: /run|execute|apply|view|scope/i.test(name),
    });

    if (/click|run|apply|ok|execute/i.test(name)) {
      events.push({
        controlId: normalized,
        event: "click",
        handler: name,
      });
    }
  });

  (tool.uiMockup.controlCounts || []).forEach((item) => {
    const kind = toSimulatorControlKind(item.name);
    const id = slugifyId(`${item.name}-${controls.length}`);
    const exists = controls.some((control) => control.kind === kind && control.label === item.name);
    if (!exists && ["text", "select", "multiselect", "table", "checkbox", "radio", "button", "tabs", "tree"].includes(kind)) {
      controls.push({
        id,
        name: item.name,
        kind,
        label: item.name,
        required: ["text", "select", "multiselect"].includes(kind),
      });
    }
  });

  const actionButtons = tool.uiMockup.xamlLayout && tool.uiMockup.xamlLayout.actionButtons
    ? tool.uiMockup.xamlLayout.actionButtons
    : [];

  actionButtons.slice(0, 8).forEach((label) => {
    const id = slugifyId(`action-${label}`);
    if (!controls.some((control) => control.id === id)) {
      controls.push({
        id,
        name: label,
        kind: "button",
        label,
        required: false,
      });
    }
    if (!events.some((event) => event.controlId === id)) {
      events.push({
        controlId: id,
        event: "click",
        handler: `on_${slugifyId(label)}`,
      });
    }
  });

  const prompts = (tool.uiMockup.formsCalls || []).map((call) => ({
    type: call,
    message: `Simulated ${call} interaction`,
  }));

  const workflow = (tool.uiMockup.workflowStages || []).map((stage, index) => ({
    step: index + 1,
    label: stage,
  }));

  const scenarios = [
    {
      id: "default-training",
      title: "Default Training Run",
      steps: workflow.length ? workflow.map((item) => item.label) : ["Review inputs", "Run simulation"],
      expectedOutput: [
        "Simulation complete",
        "Validation checks passed",
        "No Revit model changes were made",
      ],
    },
  ];

  return {
    toolId: tool.id,
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls,
    events,
    prompts,
    workflow,
    dynamicSources: inferDynamicSources(tool),
    scenarios,
    confidence: {
      controls: controls.length > 0 ? "medium" : "low",
      workflow: workflow.length > 0 ? "high" : "low",
      prompts: prompts.length > 0 ? "medium" : "low",
    },
  };
}

function buildToolCatalogData(payload) {
  return {
    generatedAt: payload.meta.generatedAt,
    source: payload.meta.source,
    tools: payload.tools.map((tool) => ({
      id: tool.id,
      title: tool.title,
      tab: tool.tab,
      panel: tool.panel,
      stack: tool.stack,
      location: tool.location,
      function: tool.function,
      purpose: tool.purpose,
      inputs: tool.inputs,
      notes: tool.notes,
      authors: tool.authors && tool.authors.length ? tool.authors : ["Unknown"],
      fileCount: tool.fileCount,
      pagePath: tool.pagePath,
      screenshotCount: tool.screenshots ? tool.screenshots.length : 0,
      screenshotPaths: (tool.screenshots || []).map((shot) => shot.localPath),
      uiKind: inferUiKind(tool),
    })),
  };
}

function buildUiManifest(payload) {
  return {
    generatedAt: payload.meta.generatedAt,
    source: payload.meta.source,
    tools: payload.tools.map((tool) => ({
      id: tool.id,
      title: tool.title,
      pagePath: tool.pagePath,
      screenshots: tool.screenshots || [],
      simulator: buildSimulatorModel(tool),
    })),
  };
}

function buildTrainingData(payload, uiManifest) {
  const shared = {
    levels: ["Level 00", "Level 01", "Level 02"],
    planViews: ["S-1001 Level 00 Framing Plan", "S-1002 Level 01 Framing Plan"],
    scopeBoxes: ["SB-A-Core", "SB-B-East Wing", "SB-C-Tower"],
    detailViews: ["DT-001 Typical Beam", "DT-002 Column Base", "DT-003 Slab Edge"],
    sheets: ["S100", "S101", "S200"],
    parameters: ["Mark", "Type Name", "Comments"],
  };

  const byTool = {};
  uiManifest.tools.forEach((entry) => {
    const sourceNames = entry.simulator.dynamicSources || [];
    byTool[entry.id] = {
      requiredSources: sourceNames,
      mock: {
        levels: sourceNames.includes("levels") ? shared.levels : [],
        planViews: sourceNames.includes("plan views") ? shared.planViews : [],
        scopeBoxes: sourceNames.includes("scope boxes") ? shared.scopeBoxes : [],
        detailViews: sourceNames.includes("detail views") ? shared.detailViews : [],
        sheets: sourceNames.includes("sheets") ? shared.sheets : [],
        parameters: sourceNames.includes("parameters") ? shared.parameters : [],
      },
    };
  });

  return {
    generatedAt: payload.meta.generatedAt,
    shared,
    byTool,
  };
}

function buildUiDiagnostics(payload, uiManifest) {
  const supportedKinds = new Set(["text", "select", "multiselect", "table", "checkbox", "radio", "button", "tabs", "tree"]);
  const details = uiManifest.tools.map((entry) => {
    const unsupported = entry.simulator.controls
      .filter((control) => !supportedKinds.has(control.kind))
      .map((control) => control.kind);

    const genericControlNames = entry.simulator.controls
      .map((control) => String(control.name || ""))
      .filter((name) => /^(Button|ComboBox|ComboBoxItem|TextBox|CheckBox|RadioButton|ListBox|DataGrid)$/.test(name));

    const unresolved = {
      controls: dedupe(genericControlNames),
      events: entry.simulator.events.length === 0 ? ["no-events-inferred"] : [],
    };

    if ((entry.simulator.fidelityFlags || []).includes("high-fidelity-template-applied")) {
      unresolved.events = [];
    }

    return {
      toolId: entry.id,
      title: entry.title,
      uiKind: entry.simulator.uiKind,
      controlCount: entry.simulator.controls.length,
      eventCount: entry.simulator.events.length,
      promptCount: entry.simulator.prompts.length,
      screenshotCount: Array.isArray(entry.screenshots) ? entry.screenshots.length : 0,
      unsupportedKinds: dedupe(unsupported),
      requiresTrainingData: entry.simulator.dynamicSources.length > 0,
      fidelityFlags: entry.simulator.fidelityFlags || [],
      unresolved,
      confidence: entry.simulator.confidence,
    };
  });

  const toolsWithUi = details.filter((item) => item.uiKind !== "none").length;
  const toolsRequiringTrainingData = details.filter((item) => item.requiresTrainingData).length;

  return {
    generatedAt: payload.meta.generatedAt,
    summary: {
      totalTools: payload.tools.length,
      toolsWithUi,
      toolsRequiringTrainingData,
      toolsWithoutUiSignals: payload.tools.length - toolsWithUi,
    },
    details,
  };
}

function extractAuthorsFromPythonFiles(pyFiles) {
  const authors = [];

  for (const file of pyFiles) {
    const content = String(file.content || "");
    const lineMatches = content.matchAll(/^\s*__(?:author|authors)__\s*=\s*(.+)$/gim);
    for (const match of lineMatches) {
      const rhs = String(match[1] || "").trim();
      const quoted = Array.from(rhs.matchAll(/['"]([^'"]+)['"]/g)).map((m) => m[1].trim()).filter(Boolean);
      if (quoted.length) {
        authors.push(...quoted);
      } else {
        const cleaned = rhs.replace(/[\[\](){}]/g, "");
        cleaned
          .split(/[,;]+/)
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((item) => authors.push(item));
      }
    }
  }

  return dedupe(authors);
}

function defaultWorkingHubData() {
  return {
    workingHub: {
      title: "Internal tools wiki and training hub",
      summary:
        "A central, searchable place for training, documentation, and tool discovery across pyRevit, Python, Windows apps, and web helpers.",
      focusPoints: [
        "Tool catalogue: list each available tool and what problem it solves.",
        "Training mode: run through behavior with dummy data before using tools on live projects.",
        "Project safety: explain whether a tool edits views, sheets, parameters, files, or model data.",
        "Shared learning: capture fixes, preferred helper functions, and examples for new tools.",
        "Broader scope: include pyRevit tools, package utilities, verification tools, and desktop apps.",
      ],
      sections: [
        {
          section: "Tool overview",
          content: "Purpose, owner, status, Revit version, dependencies, data modified, risk level.",
        },
        {
          section: "How to use",
          content: "Plain-English workflow, screenshots, expected inputs/outputs, rollback guidance.",
        },
        {
          section: "Training sandbox",
          content: "Dummy data, example parameters, sample folders, and safe test scenarios.",
        },
        {
          section: "Developer notes",
          content: "Folder path, file structure, known limitations, error messages, planned improvements.",
        },
        {
          section: "Support links",
          content: "Internal setup guide, pyRevit docs, Revit API docs, VS Code setup notes, idea portal.",
        },
      ],
    },
    windowsApps: [
      {
        name: "Package Validator",
        status: "Planned",
        exePath: "C:/Apps/PackageValidator/PackageValidator.exe",
        screenshot: "docs/assets/windows/package-validator.png",
        info: "Validates package metadata and reports dependency or formatting issues.",
      },
      {
        name: "RTV Sync Utility",
        status: "Draft",
        exePath: "C:/Apps/RTVSync/RTVSync.exe",
        screenshot: "docs/assets/windows/rtv-sync.png",
        info: "Synchronizes model metadata with external records and provides summary logs.",
      },
    ],
    webApps: [
      {
        name: "pyRevit Tools Wiki",
        status: "Active",
        url: "./index.html",
        screenshot: "docs/assets/web/pyrevit-tools-wiki.png",
        info: "Current static documentation and simulator site for internal tools.",
      },
      {
        name: "Issue Package Dashboard",
        status: "Planned",
        url: "https://example.internal/issue-dashboard",
        screenshot: "docs/assets/web/issue-dashboard.png",
        info: "Web dashboard for package status, QA checks, and trend monitoring.",
      },
    ],
    toolIdeas: [
      {
        title: "Model Health Snapshot",
        category: "Revit Tools",
        status: "Idea",
        owner: "TBD",
        description: "One-click model health summary with parameter completeness and warning trends.",
      },
      {
        title: "View Naming Rules Assistant",
        category: "Windows Apps",
        status: "Idea",
        owner: "TBD",
        description: "Desktop helper to preview and validate naming patterns before in-model updates.",
      },
      {
        title: "Spec Link Explorer",
        category: "Web-based Apps",
        status: "Idea",
        owner: "TBD",
        description: "Web app to cross-reference project specs with Revit parameter standards.",
      },
    ],
  };
}

function loadWorkingHubData() {
  const defaults = defaultWorkingHubData();
  if (!fs.existsSync(workingHubPath)) {
    return defaults;
  }

  const parsed = readJsonIfExists(workingHubPath);
  if (!parsed || typeof parsed !== "object") {
    return defaults;
  }

  return {
    workingHub: parsed.workingHub || defaults.workingHub,
    windowsApps: Array.isArray(parsed.windowsApps) ? parsed.windowsApps : defaults.windowsApps,
    webApps: Array.isArray(parsed.webApps) ? parsed.webApps : defaults.webApps,
    toolIdeas: Array.isArray(parsed.toolIdeas) ? parsed.toolIdeas : defaults.toolIdeas,
  };
}

function defaultToolDatasets() {
  return {
    version: 1,
    tools: {
      "RBG_SYD_Tools.tab/RBG Tools_Views.panel/ViewStack2.stack/SectionUpdater.pushbutton": {
        sectionUpdater: {
          activeView: "BRACING TRUSS A/B - DETAILS",
          defaultFilter: "truss",
          sampleSections: [
            "TRUSS B - SECTION (L0-1)",
            "TRUSS B - SECTION (L2-3)",
            "TRUSS B - SECTION (L3-4)",
            "TRUSS B - SECTION (L4-5)",
            "TRUSS B - SECTION (L5-6)",
            "TRUSS B - SECTION (L6-7)",
            "TRUSS C - SECTION (L0-1)",
            "TRUSS C - SECTION (L1-2)",
            "TRUSS C - SECTION (L2-3)",
          ],
          planViews: ["GA-SS LEVEL 1E", "GA-SS LEVEL 2E"],
          scopeBoxes: ["TRUSS B - GA E11/EA-EB", "TRUSS C - GA E12/EA-EB"],
          scopeSides: ["Top", "Bottom", "Left", "Right"],
          lowerLevelOptions: ["DATUM", "SSL LEVEL 1W", "SSL LEVEL 3W"],
          upperLevelOptions: ["NEW ROOF", "FFL LEVEL 4E", "SSL LEVEL 8AW"],
          defaultLowerOffset: "0.0",
          defaultUpperOffset: "0.0",
          rows: [
            ["TRUSS B - SECTION (L2-3)", "SSL LEVEL 1W", "3575.0", "FFL LEVEL 3E", "-200.0", "SSL LEVEL 1W", "3575.0", "FFL LEVEL 3E"],
            ["TRUSS B - SECTION (L3-4)", "SSL LEVEL 3W", "290.0", "FFL LEVEL 4E", "-200.0", "SSL LEVEL 3W", "290.0", "FFL LEVEL 4E"],
            ["TRUSS B - SECTION (L4-5)", "SSL LEVEL 4W", "180.0", "SSL LEVEL 6W", "-2040.0", "SSL LEVEL 4W", "180.0", "SSL LEVEL 6W"],
            ["TRUSS B - SECTION (L5-6)", "SSL LEVEL 5W", "1845.0", "SSL LEVEL 7W", "-300.0", "SSL LEVEL 5W", "1845.0", "SSL LEVEL 7W"],
            ["TRUSS B - SECTION (L6-7)", "SSL LEVEL 6W", "2310.0", "SSL LEVEL 8AW", "-1115.0", "SSL LEVEL 6W", "2310.0", "SSL LEVEL 8AW"],
          ],
        },
      },
    },
  };
}

function loadToolDatasets() {
  const defaults = defaultToolDatasets();
  if (!fs.existsSync(toolDatasetsPath)) {
    return defaults;
  }

  const parsed = readJsonIfExists(toolDatasetsPath);
  if (!parsed || typeof parsed !== "object") {
    return defaults;
  }

  return {
    version: Number(parsed.version || defaults.version || 1),
    tools: parsed.tools && typeof parsed.tools === "object" ? parsed.tools : defaults.tools,
  };
}

function buildAuthorsPageHtml(tools, generatedAt) {
  const rows = tools.map((tool) => ({
    title: tool.title,
    panel: tool.panel,
    stack: tool.stack,
    pagePath: tool.pagePath,
    authors: tool.authors && tool.authors.length ? tool.authors : ["Unknown"],
  }));

  const flat = [];
  for (const row of rows) {
    row.authors.forEach((author) => {
      flat.push({
        author,
        title: row.title,
        panel: row.panel,
        stack: row.stack,
        pagePath: row.pagePath,
      });
    });
  }

  const dataJson = JSON.stringify(flat);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Created By | Comp Design Wiki</title>
    <link rel="stylesheet" href="../styles.css" />
  </head>
  <body>
    <div class="topbar">
      <span class="topbar-title">Comp Design Wiki</span>
      <span class="topbar-badge">Revit Tools</span>
      <span class="topbar-tag">v1</span>
    </div>

    <div class="page">
      <div class="part">
        <span class="part-num">Authors</span>
        <span class="part-title">Created By</span>
        <span class="part-rule"></span>
      </div>

      <section class="card">
        <div class="card-head">
          <span class="card-title">Revit Tool Authors</span>
          <span class="card-hint">Filter and sort by author and tool title</span>
        </div>
        <div class="card-body">
          <a class="back-link" href="../index.html">← Back to catalog</a>
          <div class="controls" style="margin-top:10px;">
            <label class="search-wrap">
              <span>Search author or tool</span>
              <input id="author-search" type="search" placeholder="Type author, tool, panel..." />
            </label>
            <label class="search-wrap">
              <span>Sort</span>
              <select id="author-sort" class="sim-field">
                <option value="author">Author (A-Z)</option>
                <option value="tool">Tool (A-Z)</option>
                <option value="panel">Panel (A-Z)</option>
              </select>
            </label>
          </div>
          <div class="sim-table-wrap" style="margin-top:10px;">
            <table>
              <thead>
                <tr>
                  <th>Author</th>
                  <th>Tool</th>
                  <th>Panel</th>
                  <th>Stack</th>
                </tr>
              </thead>
              <tbody id="author-table-body"></tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <script>
      const DATA = ${dataJson};
      const searchInput = document.getElementById('author-search');
      const sortInput = document.getElementById('author-sort');
      const tableBody = document.getElementById('author-table-body');

      function includesText(value, query) {
        return String(value || '').toLowerCase().includes(query.toLowerCase());
      }

      function render() {
        const query = searchInput.value || '';
        const sortBy = sortInput.value || 'author';
        const filtered = DATA.filter((row) => {
          if (!query.trim()) {
            return true;
          }
          return includesText(row.author, query) || includesText(row.title, query) || includesText(row.panel, query) || includesText(row.stack, query);
        });

        filtered.sort((a, b) => {
          const av = String(a[sortBy] || '').toLowerCase();
          const bv = String(b[sortBy] || '').toLowerCase();
          if (av === bv) {
            return a.title.localeCompare(b.title);
          }
          return av.localeCompare(bv);
        });

        tableBody.innerHTML = filtered
          .map((row) => '<tr><td>' + row.author + '</td><td><a href="../' + row.pagePath + '">' + row.title + '</a></td><td>' + row.panel + '</td><td>' + row.stack + '</td></tr>')
          .join('');
      }

      searchInput.addEventListener('input', render);
      sortInput.addEventListener('change', render);
      render();
    </script>
  </body>
</html>`;
}

function classifyTab(panelName) {
  return panelName.toLowerCase() === "wip" ? "RBG WIP" : "SJ pyRevit";
}

function buildCatalog(bundleData, options = {}) {
  const includeHeavyUi = Boolean(options.includeHeavyUi);
  const includeUiSignals = options.includeUiSignals !== false;
  const showProgress = options.progress !== false;
  const screenshotFiles = Array.isArray(options.screenshotFiles) ? options.screenshotFiles : [];
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

    const pyFiles = relatedFiles
      .filter((name) => name.toLowerCase().endsWith(".py"))
      .map((name) => ({
        name,
        content: textFiles.get(`${dirPath}/${name}`) || "",
      }))
      .filter((item) => Boolean(item.content));

    const authors = extractAuthorsFromPythonFiles(pyFiles);

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
      authors,
      screenshots: resolveToolScreenshots({ id: dirPath, title: yamlInfo.title || contextInfo.title || toolSlug }, toolSlug, screenshotFiles),
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

function docLinkCell(docUrl) {
  const href = String(docUrl || "").trim();
  if (!href) {
    return "";
  }
  return `<a href="${escapeHtml(href)}">View Wiki →</a>`;
}

function buildHtml(data, diagnostics, generatedAt, allFileCount) {
  const dataJson = JSON.stringify(data);
  const hub = data.hub || defaultWorkingHubData();

  const workingFocusHtml = (hub.workingHub.focusPoints || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  const workingSectionsRows = (hub.workingHub.sections || [])
    .map((item) => `<tr><td>${escapeHtml(item.section || "")}</td><td>${escapeHtml(item.content || "")}</td></tr>`)
    .join("");

  const windowsHasDocs = (hub.windowsApps || []).some((app) => String(app.docUrl || "").trim());
  const webHasDocs = (hub.webApps || []).some((app) => String(app.docUrl || "").trim());

  const windowsRows = (hub.windowsApps || [])
    .map((app) => {
      const release = String(app.releaseUrl || app.exePath || "").trim();
      const repo = String(app.repoUrl || "").trim();
      const releaseCell = /^https?:\/\//i.test(release)
        ? `<a href="${escapeHtml(release)}" target="_blank" rel="noopener noreferrer">${escapeHtml(release)}</a>`
        : escapeHtml(release);
      const repoCell = /^https?:\/\//i.test(repo)
        ? `<a href="${escapeHtml(repo)}" target="_blank" rel="noopener noreferrer">${escapeHtml(repo)}</a>`
        : escapeHtml(repo);
      return `<tr><td>${escapeHtml(app.name || "")}</td><td>${escapeHtml(app.status || "")}</td><td>${releaseCell}</td><td>${repoCell}</td><td>${escapeHtml(app.screenshot || "")}</td><td>${escapeHtml(app.info || "")}</td>${windowsHasDocs ? `<td>${docLinkCell(app.docUrl)}</td>` : ""}</tr>`;
    })
    .join("");

  const webRows = (hub.webApps || [])
    .map((app) => `<tr><td>${escapeHtml(app.name || "")}</td><td>${escapeHtml(app.status || "")}</td><td><a href="${escapeHtml(app.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.url || "")}</a></td><td>${escapeHtml(app.screenshot || "")}</td><td>${escapeHtml(app.info || "")}</td>${webHasDocs ? `<td>${docLinkCell(app.docUrl)}</td>` : ""}</tr>`)
    .join("");

  const ideaRows = (hub.toolIdeas || [])
    .map((idea) => `<tr><td>${escapeHtml(idea.title || "")}</td><td>${escapeHtml(idea.category || "")}</td><td>${escapeHtml(idea.status || "")}</td><td>${escapeHtml(idea.owner || "")}</td><td>${escapeHtml(idea.description || "")}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Comp Design Wiki</title>
    <meta
      name="description"
      content="Comp Design Wiki: pyRevit extension tools, Windows apps, and web apps reference"
    />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="topbar">
      <span class="topbar-title">Comp Design Wiki</span>
      <span class="topbar-badge">Business Standard</span>
      <span class="topbar-tag">v1</span>
    </div>

    <div class="page">

      <div class="part" id="summary-section" data-space="extension">
        <span class="part-num">Part I</span>
        <span class="part-title">Catalog Summary</span>
        <span class="part-rule"></span>
      </div>

      <section class="card site-header" id="extension-overview" data-space="extension">
        <div class="card-head">
          <span class="card-title">Tool Catalog + Working Hub Overview</span>
          <span class="card-hint">Revit tools, desktop/web app inventory, and training focus areas</span>
          <a class="space-home-link" href="#home">Back to Home</a>
        </div>
        <div class="card-body">
          <p class="kicker">pyRevit extension reference</p>

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

      <section class="card" id="spaces-overview" data-space="home">
        <div class="card-body">
          <div class="home-spaces-grid" id="home-spaces-grid"></div>
        </div>
      </section>

      <div class="part" id="tree-section" data-space="extension">
        <span class="part-num">Part II</span>
        <span class="part-title">Revit Tools Catalog</span>
        <span class="part-rule"></span>
      </div>

      <main class="layout" id="extension-layout" data-space="extension">
        <section class="tree card card-block">
          <div class="card-head">
            <span class="card-title">Extension Tree</span>
            <span class="card-hint">Tabs, panels, and stacks inferred from pushbutton paths</span>
          </div>
          <div class="card-body tree-root" id="tree-root"></div>
        </section>

        <section class="catalog card card-block" id="catalog-section">
          <div class="card-head">
            <span class="card-title">Tool Catalog (Revit Tools)</span>
            <span class="card-hint">Cards grouped by panel inside selected tab. <a href="./${authorsPagePath}">Created by view</a></span>
          </div>
          <div class="card-body catalog-root" id="catalog-root"></div>
        </section>
      </main>

      <div class="part" id="windows-part" data-space="windows">
        <span class="part-num">Part III</span>
        <span class="part-title">Windows Apps</span>
        <span class="part-rule"></span>
      </div>

      <div class="part" id="web-part" data-space="web">
        <span class="part-num">Part IV</span>
        <span class="part-title">Web Apps</span>
        <span class="part-rule"></span>
      </div>

      <section class="card" data-space="hidden-unused" style="display:none;">
        <div class="card-head">
          <span class="card-title">${escapeHtml(hub.workingHub.title || "Internal tools wiki and training hub")}</span>
          <span class="card-hint">Editable in working-hub.json</span>
        </div>
        <div class="card-body">
          <p class="lede">${escapeHtml(hub.workingHub.summary || "")}</p>
          <ul>${workingFocusHtml}</ul>
          <div class="sim-table-wrap" style="margin-top:10px;">
            <table>
              <thead><tr><th>Wiki section</th><th>Recommended content</th></tr></thead>
              <tbody>${workingSectionsRows}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card" id="windows-apps-section" data-space="windows">
        <div class="card-head">
          <span class="card-title">Windows Apps Catalog</span>
          <span class="card-hint">Designed to track .exe paths, screenshots, and app information</span>
          <a class="space-home-link" href="#home">Back to Home</a>
        </div>
        <div class="card-body sim-table-wrap">
          <table>
            <thead><tr><th>App</th><th>Status</th><th>Release / executable</th><th>Repository</th><th>Screenshot</th><th>Information</th>${windowsHasDocs ? "<th>Wiki</th>" : ""}</tr></thead>
            <tbody>${windowsRows}</tbody>
          </table>
        </div>
      </section>

      <section class="card" id="web-apps-section" data-space="web">
        <div class="card-head">
          <span class="card-title">Web-based Apps Catalog</span>
          <span class="card-hint">Designed to track links, screenshots, and app information</span>
          <a class="space-home-link" href="#home">Back to Home</a>
        </div>
        <div class="card-body sim-table-wrap">
          <table>
            <thead><tr><th>App</th><th>Status</th><th>Hyperlink</th><th>Screenshot</th><th>Information</th>${webHasDocs ? "<th>Wiki</th>" : ""}</tr></thead>
            <tbody>${webRows}</tbody>
          </table>
        </div>
      </section>

      <section class="card" data-space="hidden-unused" style="display:none;">
        <div class="card-head">
          <span class="card-title">Tool Ideas Backlog</span>
          <span class="card-hint">Placeholder board for the Working Hub</span>
        </div>
        <div class="card-body sim-table-wrap">
          <table>
            <thead><tr><th>Idea</th><th>Category</th><th>Status</th><th>Owner</th><th>Description</th></tr></thead>
            <tbody>${ideaRows}</tbody>
          </table>
        </div>
      </section>

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
      const homeSpacesGrid = document.getElementById("home-spaces-grid");

      const spaceState = {
        current: "home",
      };

      const spaceBlocks = Array.from(document.querySelectorAll("[data-space]"));

      function textIncludes(haystack, needle) {
        return haystack.toLowerCase().includes(needle.toLowerCase());
      }

      function renderStats() {
        const panelCount = DATA.tree.reduce((sum, tab) => sum + tab.panels.length, 0);
        const stackCount = DATA.tree.reduce(
          (sum, tab) => sum + tab.panels.reduce((inner, panel) => inner + panel.stacks.length, 0),
          0
        );
        const windowsCount = DATA.hub && Array.isArray(DATA.hub.windowsApps) ? DATA.hub.windowsApps.length : 0;
        const webCount = DATA.hub && Array.isArray(DATA.hub.webApps) ? DATA.hub.webApps.length : 0;
        const ideasCount = DATA.hub && Array.isArray(DATA.hub.toolIdeas) ? DATA.hub.toolIdeas.length : 0;

        const stats = [
          ["Tools", DATA.tools.length],
          ["Tabs", DATA.tree.length],
          ["Panels", panelCount],
          ["Stacks", stackCount],
          ["Windows Apps", windowsCount],
          ["Web Apps", webCount],
          ["Hub Ideas", ideasCount],
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

      function getHomePanels() {
        const windowsCount = DATA.hub && Array.isArray(DATA.hub.windowsApps) ? DATA.hub.windowsApps.length : 0;
        const webCount = DATA.hub && Array.isArray(DATA.hub.webApps) ? DATA.hub.webApps.length : 0;
        const tabNames = DATA.tree.map(function (tab) { return tab.name; }).slice(0, 3);
        const windowNames = (DATA.hub && Array.isArray(DATA.hub.windowsApps) ? DATA.hub.windowsApps : [])
          .map(function (app) { return app.name; })
          .slice(0, 3);
        const webNames = (DATA.hub && Array.isArray(DATA.hub.webApps) ? DATA.hub.webApps : [])
          .map(function (app) { return app.name; })
          .slice(0, 3);

        return [
          {
            key: "extension",
            title: "pyRevit Extensions",
            summary: "Browse the parsed pyRevit extension tree and jump into tool-level training pages.",
            metrics: [
              ["Revit tools", DATA.tools.length],
              ["Tabs", DATA.tree.length],
              ["Panels", DATA.tree.reduce(function (sum, tab) { return sum + tab.panels.length; }, 0)],
              ["Stacks", DATA.tree.reduce(function (sum, tab) { return sum + tab.panels.reduce(function (inner, panel) { return inner + panel.stacks.length; }, 0); }, 0)],
            ],
            contents: [
              "Primary tabs: " + (tabNames.length ? tabNames.join(", ") : "None yet"),
              "Includes tool cards with purpose, inputs, and file provenance",
              "Contains extension tree and panel filters",
            ],
            href: "#space-extension",
            linkLabel: "Open pyRevit Extensions",
          },
          {
            key: "windows",
            title: "Windows Apps",
            summary: "Track internal desktop helpers, executable locations, and rollout status.",
            metrics: [
              ["Tracked apps", windowsCount],
            ],
            contents: [
              "Sample apps: " + (windowNames.length ? windowNames.join(", ") : "None listed"),
              "Release link, repository link, screenshot, and notes columns",
              "Designed for Windows utility inventory",
            ],
            href: "#space-windows",
            linkLabel: "Open Windows Apps",
          },
          {
            key: "web",
            title: "Web Apps",
            summary: "Track internal web tools, links, and references in one catalog section.",
            metrics: [
              ["Tracked apps", webCount],
            ],
            contents: [
              "Sample apps: " + (webNames.length ? webNames.join(", ") : "None listed"),
              "Status, URL, screenshot, and notes columns",
              "Designed for internal web tool links",
            ],
            href: "#space-web",
            linkLabel: "Open Web Apps",
          },
        ];
      }

      function parseSpaceFromHash() {
        const hash = String(window.location.hash || "").toLowerCase();
        if (hash === "#space-extension") return "extension";
        if (hash === "#space-windows") return "windows";
        if (hash === "#space-web") return "web";
        return "home";
      }

      function applySpaceView(space) {
        spaceState.current = space;
        spaceBlocks.forEach(function (block) {
          const target = block.getAttribute("data-space") || "";
          if (target === "hidden-unused") {
            block.hidden = true;
            return;
          }
          block.hidden = target !== space;
        });
        window.scrollTo({ top: 0, behavior: "instant" });
      }

      function renderHomeSpaces() {
        if (!homeSpacesGrid) {
          return;
        }

        const panels = getHomePanels();
        if (!panels.length) {
          homeSpacesGrid.innerHTML = '<div class="empty-state"><h3>No sections configured.</h3></div>';
          return;
        }

        homeSpacesGrid.innerHTML = panels
          .map(function (panel) {
            const metrics = panel.metrics
              .map(function (pair) {
                return '<p><span>' + pair[0] + '</span><strong>' + pair[1] + '</strong></p>';
              })
              .join("");
            const contents = panel.contents
              .map(function (line) {
                return '<li>' + line + '</li>';
              })
              .join("");

            return '<article class="home-panel">' +
              '<header>' +
                '<h3>' + panel.title + '</h3>' +
              '</header>' +
              '<p class="home-panel-summary">' + panel.summary + '</p>' +
              '<div class="home-panel-metrics">' + metrics + '</div>' +
              '<ul class="home-panel-list">' + contents + '</ul>' +
              '<a class="home-panel-link" href="' + panel.href + '">' + panel.linkLabel + '</a>' +
            '</article>';
          })
          .join("");
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
        renderHomeSpaces();
        renderTabs();
        renderTree();
        renderCatalog();
      }

      searchInput.addEventListener("input", function (event) {
        state.query = event.target.value || "";
        renderCatalog();
      });

      window.addEventListener("hashchange", function () {
        applySpaceView(parseSpaceFromHash());
      });

      render();
      applySpaceView(parseSpaceFromHash());
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
  const hubData = loadWorkingHubData();
  const screenshotFiles = loadScreenshotManifest();
  const toolDatasets = loadToolDatasets();
  const hubSha1 = sha1Text(JSON.stringify(hubData));
  const screenshotSha1 = sha1Text(JSON.stringify(screenshotFiles));
  const toolDatasetsSha1 = sha1Text(JSON.stringify(toolDatasets));
  const cache = readJsonIfExists(generateCachePath);
  const modeCache = cache && cache.byMode ? cache.byMode[options.mode] : cache;

  if (
    options.skipIfUnchanged &&
    modeCache &&
    modeCache.bundleSha1 === bundleSha1 &&
    modeCache.hubSha1 === hubSha1 &&
    modeCache.screenshotSha1 === screenshotSha1 &&
    modeCache.toolDatasetsSha1 === toolDatasetsSha1 &&
    modeCache.mode === options.mode &&
    fs.existsSync(htmlPath) &&
    fs.existsSync(diagnosticsPath) &&
    fs.existsSync(toolCatalogPath) &&
    fs.existsSync(uiManifestPath) &&
    fs.existsSync(uiDiagnosticsPath) &&
    fs.existsSync(trainingDataPath) &&
    (options.writeToolPages ? hasToolPages() : true)
  ) {
    process.stdout.write(`Skipped generate: bundle unchanged (${options.mode} mode cache hit). Use --force to rebuild.\n`);
    return;
  }

  const bundleData = parseBundle(bundleText);
  const catalog = buildCatalog(bundleData, {
    ...options,
    screenshotFiles,
  });

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
    hub: hubData,
  };

  const diagnostics = buildDiagnostics(payload);
  const toolCatalog = buildToolCatalogData(payload);
  const uiManifest = buildUiManifest(payload);
  const trainingData = buildTrainingData(payload, uiManifest);
  const uiDiagnostics = buildUiDiagnostics(payload, uiManifest);

  payload.meta.coverage = diagnostics.metadataCoverage;
  payload.meta.duplicateTitles = diagnostics.duplicateTitles.length;

  const normalizeGeneratedAt = (value) =>
    String(value).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "__GENERATED_AT__");

  ensureDir(diagnosticsDir);
  const diagnosticsText = JSON.stringify(diagnostics, null, 2);
  const diagnosticsWritten = writeTextIfChangedWithTransform(diagnosticsPath, diagnosticsText, normalizeGeneratedAt);
  const toolCatalogWritten = writeTextIfChangedWithTransform(toolCatalogPath, JSON.stringify(toolCatalog, null, 2), normalizeGeneratedAt);
  const uiManifestWritten = writeTextIfChangedWithTransform(uiManifestPath, JSON.stringify(uiManifest, null, 2), normalizeGeneratedAt);
  const trainingDataWritten = writeTextIfChangedWithTransform(trainingDataPath, JSON.stringify(trainingData, null, 2), normalizeGeneratedAt);
  const uiDiagnosticsWritten = writeTextIfChangedWithTransform(uiDiagnosticsPath, JSON.stringify(uiDiagnostics, null, 2), normalizeGeneratedAt);

  const html = buildHtml(payload, diagnostics, generatedAt, bundleData.allPaths.length);
  const indexWritten = writeTextIfChangedWithTransform(htmlPath, html, normalizeGeneratedAt);
  let pageStats = null;
  if (options.writeToolPages) {
    pageStats = writeToolPages(payload.tools, generatedAt, {
      ...options,
      toolDatasetsByToolId: toolDatasets.tools || {},
    });
  }
  const nextCache = {
    byMode: {
      ...((cache && cache.byMode) || {}),
      [options.mode]: {
        generatedAt,
        mode: options.mode,
        bundleSha1,
        hubSha1,
        screenshotSha1,
        toolDatasetsSha1,
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
    `Tool catalog: ${toolCatalogWritten ? "written" : "skipped"}`,
    `UI manifest: ${uiManifestWritten ? "written" : "skipped"}`,
    `Training data: ${trainingDataWritten ? "written" : "skipped"}`,
    `UI diagnostics: ${uiDiagnosticsWritten ? "written" : "skipped"}`,
    `Tabs: ${payload.tree.length}`,
    `Files in bundle: ${payload.meta.totalFiles}`,
    `Diagnostics: ${path.relative(repoRoot, diagnosticsPath)}`,
  ].join(" | ");

  process.stdout.write(`${summary}\n`);
}

main();
