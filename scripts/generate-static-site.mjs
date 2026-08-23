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
  if (title.includes("propagate extents override")) {
    aliases.add("propogateextentsoverride");
    aliases.add("propagateextentsoverride");
  }
  if (title.includes("wpf ui template") || title.includes("wpf style template")) {
    aliases.add("wpftemplate");
    aliases.add("wpfstyletemplate");
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
  const simulator = buildSimulatorModel(tool);
  const simulatorJson = JSON.stringify(simulator);
  const staticDataset = toolDatasetsByToolId[tool.id] || toolDatasetsByToolId[tool.title] || {};
  const staticDatasetJson = JSON.stringify(staticDataset);
  const screenshotDataJson = JSON.stringify(tool.screenshots || []);

  const inputsHtml = tool.inputs.length
    ? `<ul>${tool.inputs.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p class=\"muted\">No explicit click or shift-click input hints were detected.</p>";

  const filesHtml = tool.files.length
    ? `<ul>${tool.files.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("")}</ul>`
    : "<p class=\"muted\">No file listing available.</p>";

  const workflowItems = Array.isArray(tool.workflowSteps) && tool.workflowSteps.length
    ? tool.workflowSteps
    : (simulator.workflow || []).map((item) => item.label);

  function describeWorkflowItem(item, index) {
    const raw = String(item || "").replace(/\s+/g, " ").trim();
    if (!raw) {
      return {
        title: `Step ${index + 1}`,
        detail: "Workflow detail unavailable.",
      };
    }

    const colonIndex = raw.indexOf(":");
    if (colonIndex > 0 && colonIndex <= 32) {
      return {
        title: raw.slice(0, colonIndex).trim(),
        detail: raw.slice(colonIndex + 1).trim(),
      };
    }

    if (/\breturn|result|updated|summary|output\b/i.test(raw)) {
      return { title: "Result", detail: raw };
    }
    if (/\bselect|selection|choose|pick|scope\b/i.test(raw)) {
      return { title: "Selection", detail: raw };
    }
    if (/\bview\b|\bvisible\b|\bprepare\b|\bclean\b/i.test(raw)) {
      return { title: "Preparation", detail: raw };
    }
    if (/\brun\b|\bupdate\b|\bapply\b|\badd\b|\bexecute\b/i.test(raw)) {
      return { title: "Run", detail: raw };
    }

    return {
      title: `Step ${index + 1}`,
      detail: raw,
    };
  }

  function renderWorkflowItems(items) {
    return items
      .map((item, index) => {
        const normalized = describeWorkflowItem(item, index);
        return `<li><strong>${escapeHtml(normalized.title)}</strong><span>${escapeHtml(normalized.detail)}</span></li>`;
      })
      .join("");
  }

  function buildWorkflowInlineSummary(items) {
    const parts = items.map((item, index) => describeWorkflowItem(item, index).detail).filter(Boolean);
    if (!parts.length) {
      return "";
    }

    const full = parts.join(" → ");
    if (full.length <= 280) {
      return full;
    }

    const compact = parts.slice(0, 3).join(" → ");
    return parts.length > 3 ? `${compact} → ...` : compact;
  }

  const workflowSummaryHtml = workflowItems.length
    ? `<ol class="workflow-list">${renderWorkflowItems(workflowItems)}</ol>`
    : "<p class=\"muted\">No start-to-finish workflow narrative was extracted for this tool yet.</p>";
  const workflowInlineSummary = buildWorkflowInlineSummary(workflowItems);

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

  const screenshotThumbsHtml = tool.screenshots && tool.screenshots.length > 1
    ? `<div class="sim-gallery-thumbs">${tool.screenshots
        .map(
          (shot, index) => `<button type="button" class="sim-gallery-thumb${index === 0 ? " is-active" : ""}" data-gallery-thumb="${index}">
              <img src="../${escapeHtml(shot.localPath)}" alt="${escapeHtml(shot.fileName)} thumbnail" loading="lazy" />
              <span>${escapeHtml(shot.fileName)}</span>
            </button>`
        )
        .join("")}</div>`
    : "";

  const screenshotHelpHtml = tool.screenshots && tool.screenshots.length
    ? `<div class="sim-gallery" data-sim-gallery>
        <div class="sim-gallery-stage">
          <div class="sim-gallery-toolbar">
            <span class="sim-chip">Screenshot <strong data-gallery-counter>1 / ${tool.screenshots.length}</strong></span>
            <div class="sim-gallery-actions">
              <button type="button" class="sim-gallery-action" data-gallery-zoom="out">-</button>
              <button type="button" class="sim-gallery-action" data-gallery-zoom="reset">Fit</button>
              <button type="button" class="sim-gallery-action" data-gallery-zoom="in">+</button>
              <button type="button" class="sim-gallery-action" data-gallery-open>Open full size</button>
            </div>
          </div>
          <div class="sim-gallery-viewport">
            <img data-gallery-image src="../${escapeHtml(tool.screenshots[0].localPath)}" alt="${escapeHtml(tool.title)} screenshot: ${escapeHtml(tool.screenshots[0].fileName)}" loading="lazy" />
          </div>
          <p class="sim-gallery-caption" data-gallery-caption>${escapeHtml(tool.screenshots[0].fileName)}</p>
        </div>
        ${screenshotThumbsHtml}
      </div>`
    : "<p class=\"muted\">No UI screenshots mapped for this tool yet. Simulator uses inferred controls from code/XAML.</p>";

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
          <p class="wiki-overview-lead"><strong>Purpose:</strong> ${escapeHtml(tool.purpose)}</p>
          ${workflowInlineSummary ? `<p class="wiki-overview-process"><strong>Process at a glance:</strong> ${escapeHtml(workflowInlineSummary)}</p>` : ""}
          <div class="wiki-meta-grid">
            <p><strong>Function:</strong> ${escapeHtml(tool.function)}</p>
            <p><strong>Toolbar tab:</strong> ${escapeHtml(tool.tab)}</p>
            <p><strong>Panel:</strong> ${escapeHtml(tool.panel)}</p>
            <p><strong>Simulator type:</strong> ${escapeHtml(simulator.uiKind)}</p>
          </div>
        </div>
      </section>

      <section class="card wiki-section" id="workflow">
        <div class="card-head">
          <span class="card-title">Workflow</span>
          <span class="card-hint">Compact start-to-finish path with supporting UI signals</span>
        </div>
        <div class="card-body wiki-body">
          <h4 class="subhead">Start-to-Finish Flow</h4>
          ${workflowSummaryHtml}

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
        const SCREENSHOTS = ${screenshotDataJson};
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

        function initializeScreenshotGallery() {
          const gallery = document.querySelector('[data-sim-gallery]');
          if (!gallery || !SCREENSHOTS.length) {
            return;
          }

          const image = gallery.querySelector('[data-gallery-image]');
          const caption = gallery.querySelector('[data-gallery-caption]');
          const counter = gallery.querySelector('[data-gallery-counter]');
          const thumbs = Array.from(gallery.querySelectorAll('[data-gallery-thumb]'));
          let activeIndex = 0;
          let zoom = 1;

          function applyZoom() {
            if (image) {
              image.style.transform = 'scale(' + zoom.toFixed(2) + ')';
            }
          }

          function setActive(index) {
            const nextIndex = Math.max(0, Math.min(SCREENSHOTS.length - 1, index));
            const next = SCREENSHOTS[nextIndex];
            if (!next || !image) {
              return;
            }

            activeIndex = nextIndex;
            image.src = '../' + next.localPath;
            image.alt = '${escapeHtml(tool.title)} screenshot: ' + next.fileName;
            if (caption) {
              caption.textContent = next.fileName;
            }
            if (counter) {
              counter.textContent = (nextIndex + 1) + ' / ' + SCREENSHOTS.length;
            }
            thumbs.forEach((thumb, thumbIndex) => thumb.classList.toggle('is-active', thumbIndex === nextIndex));
            zoom = 1;
            applyZoom();
          }

          Array.from(gallery.querySelectorAll('[data-gallery-zoom]')).forEach((button) => {
            button.addEventListener('click', function () {
              const action = button.getAttribute('data-gallery-zoom');
              if (action === 'in') {
                zoom = Math.min(2.5, zoom + 0.25);
              } else if (action === 'out') {
                zoom = Math.max(0.5, zoom - 0.25);
              } else {
                zoom = 1;
              }
              applyZoom();
            });
          });

          thumbs.forEach((thumb) => {
            thumb.addEventListener('click', function () {
              const nextIndex = Number(thumb.getAttribute('data-gallery-thumb') || '0');
              setActive(nextIndex);
            });
          });

          const openButton = gallery.querySelector('[data-gallery-open]');
          if (openButton && image) {
            openButton.addEventListener('click', function () {
              window.open(image.src, '_blank', 'noopener');
            });
            image.addEventListener('click', function () {
              window.open(image.src, '_blank', 'noopener');
            });
          }

          setActive(activeIndex);
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

        function renderAddCoordinatesSimulator() {
          simulatorRoot.innerHTML = '';
          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          const state = {
            scope: '',
            category: 'Structural Columns',
          };

          const shell = document.createElement('section');
          shell.className = 'sim-alert-shell';

          const chrome = document.createElement('div');
          chrome.className = 'sim-alert-chrome';
          chrome.innerHTML = '<span>Add Coordinates</span><span>pyRevit</span>';
          shell.appendChild(chrome);

          const body = document.createElement('div');
          body.className = 'sim-alert-body';
          body.innerHTML = '<p class="sim-alert-title">Choose your selection type</p><p class="sim-alert-copy">Select elements in the active view, or run a model-wide coordinate update by category.</p>';
          shell.appendChild(body);

          const commandList = document.createElement('div');
          commandList.className = 'sim-alert-command-list';
          body.appendChild(commandList);

          const stateCard = document.createElement('div');
          stateCard.className = 'sim-alert-state';
          body.appendChild(stateCard);

          function renderState() {
            stateCard.innerHTML = '';

            if (!state.scope) {
              const placeholder = document.createElement('p');
              placeholder.className = 'muted';
              placeholder.textContent = 'Pick a training path to reveal the remaining steps.';
              stateCard.appendChild(placeholder);
              return;
            }

            const summary = document.createElement('p');
            summary.className = 'sim-alert-summary';
            summary.textContent = state.scope === 'view'
              ? 'Active-view path selected. The real tool now waits for element picks in the current view.'
              : 'Model-wide path selected. Choose the category that should receive updated coordinate values.';
            stateCard.appendChild(summary);

            if (state.scope === 'model') {
              const selectWrap = document.createElement('label');
              selectWrap.className = 'sim-control';
              const label = document.createElement('span');
              label.className = 'sim-label';
              label.textContent = 'Category';
              selectWrap.appendChild(label);

              const select = document.createElement('select');
              select.className = 'sim-field';
              ['Structural Columns', 'Structural Foundations', 'Generic Models'].forEach((optionText) => {
                const option = document.createElement('option');
                option.value = optionText;
                option.textContent = optionText;
                if (optionText === state.category) {
                  option.selected = true;
                }
                select.appendChild(option);
              });
              select.addEventListener('change', function () {
                state.category = select.value;
              });
              selectWrap.appendChild(select);
              stateCard.appendChild(selectWrap);
            }

            const runButton = document.createElement('button');
            runButton.type = 'button';
            runButton.className = 'sim-action';
            runButton.textContent = 'Run Coordinate Update';
            runButton.addEventListener('click', function () {
              const targetLabel = state.scope === 'view' ? 'selected active-view elements' : state.category;
              simOutput.textContent = [
                'Simulation complete.',
                'Target scope: ' + targetLabel,
                'Coordinate parameters staged: RBG_Survey_SP_X / Y / Z',
                'Results: updated element list ready for review.',
                'No Revit model changes were made.',
              ].join('\\n');
            });
            stateCard.appendChild(runButton);
          }

          [
            {
              label: 'Select Elements in View',
              hint: 'Pick elements manually from the active 3D view before the update runs.',
              value: 'view',
            },
            {
              label: 'Select All Elements In Model',
              hint: 'Choose a category and run the shared-parameter update across the model.',
              value: 'model',
            },
          ].forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sim-alert-choice';
            button.innerHTML = '<strong>' + item.label + '</strong><span>' + item.hint + '</span>';
            button.addEventListener('click', function () {
              state.scope = item.value;
              Array.from(commandList.children).forEach((node) => node.classList.remove('is-active'));
              button.classList.add('is-active');
              simOutput.textContent = item.value === 'view'
                ? 'Ready to simulate active-view element picking.'
                : 'Ready to simulate category-driven model update.';
              renderState();
            });
            commandList.appendChild(button);
          });

          renderState();
          simulatorRoot.appendChild(shell);
        }

        function renderInferredXamlSimulator() {
          simulatorRoot.innerHTML = '';
          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          const controls = Array.isArray(SIMULATOR.controls) ? SIMULATOR.controls : [];
          const inputControls = controls.filter((control) => ['text', 'select', 'multiselect', 'checkbox', 'radio'].includes(control.kind));
          const buttonControls = controls.filter((control) => control.kind === 'button');
          const tableControls = controls.filter((control) => control.kind === 'table');
          const blockControls = controls.filter((control) => !['text', 'select', 'multiselect', 'checkbox', 'radio', 'button', 'table'].includes(control.kind));
          const workflowSteps = Array.isArray(SIMULATOR.workflow) ? SIMULATOR.workflow : [];

          const shell = document.createElement('section');
          shell.className = 'sim-xaml-shell';

          const header = document.createElement('div');
          header.className = 'sim-xaml-header';
          header.innerHTML = '<strong>Inferred WPF workspace</strong><span>Source: ' + (SIMULATOR.xamlFiles || []).join(', ') + '</span>';
          shell.appendChild(header);

          const body = document.createElement('div');
          body.className = 'sim-xaml-body';
          shell.appendChild(body);

          const left = document.createElement('div');
          left.className = 'sim-xaml-pane';
          body.appendChild(left);

          if (workflowSteps.length) {
            const workflowCard = document.createElement('div');
            workflowCard.className = 'sim-xaml-card';
            workflowCard.innerHTML = '<h5>Workflow stages</h5>';
            const list = document.createElement('ol');
            list.className = 'sim-xaml-list';
            workflowSteps.forEach((step) => {
              const item = document.createElement('li');
              item.textContent = step.label;
              list.appendChild(item);
            });
            workflowCard.appendChild(list);
            left.appendChild(workflowCard);
          }

          if (blockControls.length) {
            const blockCard = document.createElement('div');
            blockCard.className = 'sim-xaml-card';
            blockCard.innerHTML = '<h5>Detected layout regions</h5>';
            const wrap = document.createElement('div');
            wrap.className = 'sim-xaml-blocks';
            blockControls.slice(0, 12).forEach((control) => {
              const chip = document.createElement('span');
              chip.className = 'mockup-chip';
              chip.textContent = control.label || control.name || control.kind;
              wrap.appendChild(chip);
            });
            blockCard.appendChild(wrap);
            left.appendChild(blockCard);
          }

          if (SIMULATOR.prompts.length) {
            const promptCard = document.createElement('div');
            promptCard.className = 'sim-xaml-card';
            promptCard.innerHTML = '<h5>Prompts</h5>';
            const list = document.createElement('ul');
            list.className = 'sim-xaml-list';
            SIMULATOR.prompts.forEach((prompt) => {
              const item = document.createElement('li');
              item.textContent = prompt.type + ': ' + prompt.message;
              list.appendChild(item);
            });
            promptCard.appendChild(list);
            left.appendChild(promptCard);
          }

          const right = document.createElement('div');
          right.className = 'sim-xaml-pane';
          body.appendChild(right);

          if (inputControls.length) {
            const formCard = document.createElement('div');
            formCard.className = 'sim-xaml-card';
            formCard.innerHTML = '<h5>Controls</h5>';
            const form = document.createElement('div');
            form.className = 'sim-form';
            inputControls.slice(0, 12).forEach((control) => {
              form.appendChild(createInput(control));
            });
            formCard.appendChild(form);
            right.appendChild(formCard);
          }

          if (tableControls.length) {
            const tableCard = document.createElement('div');
            tableCard.className = 'sim-xaml-card';
            tableCard.innerHTML = '<h5>Table preview</h5>';
            tableControls.forEach((control) => {
              const datasetRows = Array.isArray(DATASET.sampleTableRows) && DATASET.sampleTableRows.length
                ? DATASET.sampleTableRows
                : [
                    ['Row 01', control.label || control.name || 'Pending'],
                    ['Row 02', 'Ready'],
                    ['Row 03', 'Review'],
                  ];
              const tableWrap = document.createElement('div');
              tableWrap.className = 'sim-table-wrap';
              const table = document.createElement('table');
              table.innerHTML = '<thead><tr><th>Item</th><th>State</th></tr></thead>';
              const tbody = document.createElement('tbody');
              datasetRows.slice(0, 6).forEach((row, index) => {
                const cells = Array.isArray(row) ? row : [row, ''];
                const tr = document.createElement('tr');
                if (index === 0) {
                  tr.className = 'is-active';
                }
                tr.innerHTML = '<td>' + String(cells[0] || '') + '</td><td>' + String(cells[1] || '') + '</td>';
                tbody.appendChild(tr);
              });
              table.appendChild(tbody);
              tableWrap.appendChild(table);
              tableCard.appendChild(tableWrap);
            });
            right.appendChild(tableCard);
          }

          if (buttonControls.length) {
            const actionRow = document.createElement('div');
            actionRow.className = 'sim-action-row';
            buttonControls.slice(0, 8).forEach((control) => {
              actionRow.appendChild(createButton(control));
            });
            right.appendChild(actionRow);
          }

          if (!inputControls.length && !tableControls.length && !buttonControls.length && !blockControls.length) {
            const fallback = document.createElement('p');
            fallback.className = 'muted';
            fallback.textContent = 'No structured XAML controls were inferred. Use the workflow and screenshot reference as the training guide.';
            right.appendChild(fallback);
          }

          simulatorRoot.appendChild(shell);
        }

        function renderSimulator() {
          if (!simulatorRoot) {
            return;
          }

          if (String(SIMULATOR.profile || '') === 'addcoordinates-dialog') {
            renderAddCoordinatesSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'section-updater-high-fidelity') {
            renderSectionUpdaterSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'packagecreator-high-fidelity') {
            renderPackageCreatorSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'paramcopier-high-fidelity') {
            renderParamCopierSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'sheetno-high-fidelity') {
            renderSheetNoSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'scheduleupdater-high-fidelity') {
            renderScheduleUpdaterSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'linkedviews-high-fidelity') {
            renderLinkedViewsSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'categorypicker-high-fidelity') {
            renderCategoryPickerSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'reorderviewports-high-fidelity') {
            renderReorderViewportsSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'copystate-high-fidelity') {
            renderCopyStateSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'propagateextentsoverride-high-fidelity') {
            renderPropagateExtentsOverrideSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'cloudrevisions-high-fidelity') {
            renderCloudRevisionsSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'elementsbylevel-high-fidelity') {
            renderElementsByLevelSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'dashboard-high-fidelity') {
            renderDashboardSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'transactionlogger-high-fidelity') {
            renderTransactionLoggerSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'planviewrange-high-fidelity') {
            renderPlanViewRangeSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'scopeboxviewcreation-high-fidelity') {
            renderScopeBoxViewCreationSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'viewfiltereditor-high-fidelity') {
            renderViewFilterEditorSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'wpftemplate-reference') {
            renderWpfTemplateSimulator();
            return;
          }
          if (String(SIMULATOR.profile || '') === 'xaml-inferred-layout') {
            renderInferredXamlSimulator();
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

        function renderPackageCreatorSimulator() {
          const dataset = DATASET.packageCreator || {};
          const officeOptions = Array.isArray(dataset.officeOptions) && dataset.officeOptions.length ? dataset.officeOptions : ['SYD', 'MEL', 'BNE'];
          const yearOptions = Array.isArray(dataset.yearOptions) && dataset.yearOptions.length ? dataset.yearOptions : ['2026', '2025', '2024'];
          const stageRows = Array.isArray(dataset.stageRows) && dataset.stageRows.length
            ? dataset.stageRows
            : [['Project Link', 'Pending'], ['Rules', 'Pending'], ['Checks', 'Pending'], ['Export', 'Pending'], ['Create', 'Pending']];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid">' +
              '<section class="hf-pane">' +
                '<h5>Project Setup</h5>' +
                '<label class="sim-control"><span class="sim-label">Project search</span><input id="pc-project-search" class="sim-field" type="text" placeholder="Search project..." /></label>' +
                '<label class="sim-control"><span class="sim-label">Office</span><select id="pc-office" class="sim-field">' + officeOptions.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Year folder</span><select id="pc-year-folder" class="sim-field">' + yearOptions.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Project docs root *</span><input id="pc-docs-root" class="sim-field" type="text" value="' + String(dataset.projectDocsRoot || '') + '" /></label>' +
                '<label class="sim-control"><span class="sim-label">Model key *</span><input id="pc-model-key" class="sim-field" type="text" value="' + String(dataset.modelKey || '') + '" /></label>' +
              '</section>' +
              '<section class="hf-pane">' +
                '<h5>Naming Inputs</h5>' +
                '<label class="sim-control"><span class="sim-label">Sheet number source parameter</span><input id="pc-sheet-number-param" class="sim-field" type="text" value="' + String(dataset.sheetNumberParam || '') + '" /></label>' +
                '<label class="sim-control"><span class="sim-label">Revision source parameter</span><input id="pc-revision-param" class="sim-field" type="text" value="' + String(dataset.revisionParam || '') + '" /></label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pc-refresh">Refresh</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pc-search">Search</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pc-apply-project">Apply Project</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pc-apply-rules">Apply Rules</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Stage Status</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Stage</th><th>Status</th></tr></thead><tbody>' + stageRows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pc-run-check">Run Check</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pc-stage-export">Stage 4: Export</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pc-stage-create">Stage 5: Create</button>' +
                  '<button type="button" class="sim-action" id="pc-run-full-flow">Run Full Flow</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          document.getElementById('pc-run-full-flow').addEventListener('click', function () {
            const docsRoot = String(document.getElementById('pc-docs-root').value || '').trim();
            const modelKey = String(document.getElementById('pc-model-key').value || '').trim();
            if (!docsRoot || !modelKey) {
              simOutput.textContent = 'Validation failed. Project docs root and model key are required.';
              return;
            }
            simOutput.textContent = 'PackageCreator full flow simulation complete.\\nChecks: OK\\nExport stage: simulated\\nCreate stage: simulated\\nNo Revit model changes were made.';
          });
          document.getElementById('pc-run-check').addEventListener('click', function () {
            simOutput.textContent = 'Validation checks complete (simulated).\\nIssues found: 0';
          });
        }

        function renderParamCopierSimulator() {
          const dataset = DATASET.paramCopier || {};
          const sourceCategories = Array.isArray(dataset.sourceCategories) && dataset.sourceCategories.length ? dataset.sourceCategories : ['Walls', 'Floors', 'Structural Framing'];
          const targetCategories = Array.isArray(dataset.targetCategories) && dataset.targetCategories.length ? dataset.targetCategories : sourceCategories;
          const sourceParams = Array.isArray(dataset.sourceParameters) && dataset.sourceParameters.length ? dataset.sourceParameters : ['Comments', 'Mark', 'Type Name'];
          const targetParams = Array.isArray(dataset.targetParameters) && dataset.targetParameters.length ? dataset.targetParameters : ['RBG_Comments', 'RBG_Mark', 'RBG_TypeName'];
          const copyModes = Array.isArray(dataset.copyModes) && dataset.copyModes.length ? dataset.copyModes : ['Overwrite target', 'Fill empty target only'];
          const rows = Array.isArray(dataset.previewRows) && dataset.previewRows.length ? dataset.previewRows : [['W-101', 'Beam A', 'Copied'], ['W-102', 'Beam B', 'Copied']];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Mapping Setup</h5>' +
                '<label class="sim-control"><span class="sim-label">Source category *</span><select id="pm-source-category" class="sim-field">' + sourceCategories.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Source parameter *</span><select id="pm-source-param" class="sim-field">' + sourceParams.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Target category *</span><select id="pm-target-category" class="sim-field">' + targetCategories.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Target parameter *</span><select id="pm-target-param" class="sim-field">' + targetParams.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Copy mode *</span><select id="pm-copy-mode" class="sim-field">' + copyModes.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label><input id="pm-only-selected" type="checkbox" /> Only selected elements</label>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Preview Mappings</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Element</th><th>Mapped Value</th><th>Status</th></tr></thead><tbody>' + rows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td><td>' + String(row[2] || 'Ready') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pm-preview">Preview</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pm-reset">Reset</button>' +
                  '<button type="button" class="sim-action" id="pm-copy">Copy Parameters</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          document.getElementById('pm-preview').addEventListener('click', function () {
            simOutput.textContent = 'Preview generated for ' + rows.length + ' rows (simulated).';
          });
          document.getElementById('pm-copy').addEventListener('click', function () {
            simOutput.textContent = 'ParamCopier simulation complete.\\nRows updated: ' + rows.length + '\\nNo Revit model changes were made.';
          });
          document.getElementById('pm-reset').addEventListener('click', function () {
            simOutput.textContent = 'Mapping controls reset (simulated).';
          });
        }

        function renderSheetNoSimulator() {
          const source = DATASET.selectOptions || {};
          const scopes = source.cmbscope || ['Active View', 'Current Sheet Set', 'Selected Sheets'];
          const sheetSets = source.cmbsheetset || ['A-Documentation', 'S-Structural'];
          const params = source.cmbsheetnoparam || ['Sheet Number'];
          const rows = Array.isArray(DATASET.sampleTableRows) && DATASET.sampleTableRows.length
            ? DATASET.sampleTableRows
            : [['S101 | Level 01', 'Ready'], ['S201 | Level 02', 'Review']];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Selection and Formatting</h5>' +
                '<label class="sim-control"><span class="sim-label">Scope *</span><select id="sn-scope" class="sim-field">' + scopes.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Sheet set</span><select id="sn-sheetset" class="sim-field">' + sheetSets.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Sheet number parameter *</span><select id="sn-param" class="sim-field">' + params.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Prefix</span><input id="sn-prefix" class="sim-field" type="text" placeholder="e.g. GA-" /></label>' +
                '<label class="sim-control"><span class="sim-label">Suffix</span><input id="sn-suffix" class="sim-field" type="text" placeholder="e.g. -IFC" /></label>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Preview</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Sheet</th><th>Status</th></tr></thead><tbody>' + rows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || 'Ready') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="sn-preview">Preview Changes</button>' +
                  '<button type="button" class="sim-action" id="sn-apply">Apply Sheet Numbers</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          document.getElementById('sn-preview').addEventListener('click', function () {
            simOutput.textContent = 'Sheet numbering preview generated for ' + rows.length + ' rows (simulated).';
          });
          document.getElementById('sn-apply').addEventListener('click', function () {
            simOutput.textContent = 'SheetNo simulation complete.\\nUpdated rows: ' + rows.length + '\\nNo Revit model changes were made.';
          });
        }

        function renderScheduleUpdaterSimulator() {
          const dataset = DATASET.scheduleUpdater || {};
          const schedules = Array.isArray(dataset.schedules) && dataset.schedules.length ? dataset.schedules : ['S-Concrete Reinforcement', 'S-Steel Framing'];
          const existing = Array.isArray(dataset.existingFields) && dataset.existingFields.length ? dataset.existingFields : ['Mark', 'Type', 'Comments'];
          const available = Array.isArray(dataset.availableFields) && dataset.availableFields.length ? dataset.availableFields : ['RBG_Stage', 'RBG_Discipline', 'RBG_Approval'];
          const rows = Array.isArray(dataset.previewRows) && dataset.previewRows.length ? dataset.previewRows : [['RBG_Stage', 'Add'], ['RBG_Discipline', 'Add']];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Schedule + Field Selection</h5>' +
                '<label class="sim-control"><span class="sim-label">Schedule *</span><select id="su-schedule" class="sim-field">' + schedules.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Field search</span><input id="su-field-search" class="sim-field" type="text" placeholder="Filter available fields..." /></label>' +
                '<label class="sim-control"><span class="sim-label">Existing fields</span><select id="su-existing-fields" class="sim-field" multiple>' + existing.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Available fields</span><select id="su-available-fields" class="sim-field" multiple>' + available.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="su-refresh">Refresh</button>' +
                  '<button type="button" class="sim-action" id="su-add-fields">Add Selected Fields</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="su-remove-fields">Remove Selected Fields</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Field Updates Preview</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Field</th><th>Action</th></tr></thead><tbody>' + rows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || 'Add') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action" id="su-apply">Apply Updates</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          document.getElementById('su-refresh').addEventListener('click', function () {
            simOutput.textContent = 'Schedules refreshed (simulated).';
          });
          document.getElementById('su-add-fields').addEventListener('click', function () {
            simOutput.textContent = 'Selected fields staged for add (simulated).';
          });
          document.getElementById('su-remove-fields').addEventListener('click', function () {
            simOutput.textContent = 'Selected fields staged for removal (simulated).';
          });
          document.getElementById('su-apply').addEventListener('click', function () {
            simOutput.textContent = 'Schedule Updater simulation complete.\\nUpdated fields: ' + rows.length + '\\nNo Revit model changes were made.';
          });
        }

        function renderLinkedViewsSimulator() {
          const dataset = DATASET.linkedViews || {};
          const links = Array.isArray(dataset.linkInstances) && dataset.linkInstances.length ? dataset.linkInstances : ['ARC-Model.rvt', 'STR-Reference.rvt'];
          const sourceViews = Array.isArray(dataset.sourceViews) && dataset.sourceViews.length ? dataset.sourceViews : ['L01 - Structural Plan', 'L02 - Structural Plan'];
          const targetViews = Array.isArray(dataset.targetViews) && dataset.targetViews.length ? dataset.targetViews : ['Host L01 Plan', 'Host L02 Plan'];
          const modes = Array.isArray(dataset.modes) && dataset.modes.length ? dataset.modes : ['Overlay', 'By shared coordinates'];
          const rows = Array.isArray(dataset.previewRows) && dataset.previewRows.length ? dataset.previewRows : [['L01 - Structural Plan', 'Host L01 Plan', 'Ready']];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Linked View Mapping</h5>' +
                '<label class="sim-control"><span class="sim-label">Revit link instance *</span><select id="lv-link-instance" class="sim-field">' + links.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Linked source view *</span><select id="lv-source-view" class="sim-field">' + sourceViews.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Host target view *</span><select id="lv-target-view" class="sim-field">' + targetViews.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Placement mode *</span><select id="lv-mode" class="sim-field">' + modes.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label><input id="lv-align-crop" type="checkbox" checked /> Align crop to linked view extents</label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="lv-load">Load Linked Views</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="lv-preview-btn">Preview Placement</button>' +
                  '<button type="button" class="sim-action" id="lv-create">Create / Update</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Placement Preview</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Linked View</th><th>Host View</th><th>Status</th></tr></thead><tbody>' + rows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td><td>' + String(row[2] || 'Ready') + '</td></tr>').join('') + '</tbody></table></div>' +
              '</section>' +
            '</div>';

          document.getElementById('lv-load').addEventListener('click', function () {
            simOutput.textContent = 'Linked views loaded from selected link (simulated).';
          });
          document.getElementById('lv-preview-btn').addEventListener('click', function () {
            simOutput.textContent = 'Placement preview generated (simulated).';
          });
          document.getElementById('lv-create').addEventListener('click', function () {
            simOutput.textContent = 'LinkedViews simulation complete.\\nMapped rows: ' + rows.length + '\\nNo Revit model changes were made.';
          });
        }

        function renderCategoryPickerSimulator() {
          const dataset = DATASET.categoryPicker || {};
          const discipline = Array.isArray(dataset.disciplineFilters) && dataset.disciplineFilters.length ? dataset.disciplineFilters : ['All', 'Architecture', 'Structure', 'MEP'];
          const categories = Array.isArray(dataset.categories) && dataset.categories.length ? dataset.categories : ['Walls', 'Floors', 'Doors', 'Structural Framing', 'Columns'];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Category Selection</h5>' +
                '<label class="sim-control"><span class="sim-label">Search categories</span><input id="cp-search" class="sim-field" type="text" placeholder="Type to filter..." /></label>' +
                '<label class="sim-control"><span class="sim-label">Discipline filter</span><select id="cp-discipline" class="sim-field">' + discipline.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Categories *</span><select id="cp-categories" class="sim-field" multiple>' + categories.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="cp-select-all">Select All</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="cp-clear">Clear</button>' +
                  '<button type="button" class="sim-action" id="cp-apply">Select Elements</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Selection Summary</h5>' +
                '<p class="muted">Selected category count: <strong id="cp-count">0</strong></p>' +
                '<p class="muted">Use multi-select to stage category picks before applying.</p>' +
              '</section>' +
            '</div>';

          const list = document.getElementById('cp-categories');
          const countNode = document.getElementById('cp-count');
          function updateCount() {
            countNode.textContent = String(Array.from(list.selectedOptions).length);
          }
          list.addEventListener('change', updateCount);
          updateCount();

          document.getElementById('cp-select-all').addEventListener('click', function () {
            Array.from(list.options).forEach((option) => { option.selected = true; });
            updateCount();
            simOutput.textContent = 'All categories selected (simulated).';
          });
          document.getElementById('cp-clear').addEventListener('click', function () {
            Array.from(list.options).forEach((option) => { option.selected = false; });
            updateCount();
            simOutput.textContent = 'Category selection cleared (simulated).';
          });
          document.getElementById('cp-apply').addEventListener('click', function () {
            const count = Array.from(list.selectedOptions).length;
            if (!count) {
              simOutput.textContent = 'Validation failed. Select at least one category.';
              return;
            }
            simOutput.textContent = 'CategoryPicker simulation complete.\\nCategories selected: ' + count + '\\nNo Revit model changes were made.';
          });
        }

        function renderReorderViewportsSimulator() {
          const dataset = DATASET.reorderViewports || {};
          const sheets = Array.isArray(dataset.sheets) && dataset.sheets.length ? dataset.sheets : ['S101 - Plan', 'S201 - Sections'];
          const rows = Array.isArray(dataset.viewportRows) && dataset.viewportRows.length ? dataset.viewportRows : [['01', 'General Notes'], ['02', 'Plan View'], ['03', 'Typical Section']];
          const workingRows = rows.map((row) => [String(row[0] || ''), String(row[1] || '')]);
          let activeIndex = workingRows.length ? 0 : -1;

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Sheet + Ordering</h5>' +
                '<label class="sim-control"><span class="sim-label">Sheet *</span><select id="rv-sheet" class="sim-field">' + sheets.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="rv-up">Move Up</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="rv-down">Move Down</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="rv-auto">Auto Sort</button>' +
                  '<button type="button" class="sim-action" id="rv-apply">Apply Viewport Order</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Viewport Order</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Order</th><th>Viewport</th></tr></thead><tbody id="rv-rows"></tbody></table></div>' +
              '</section>' +
            '</div>';

          const tbody = document.getElementById('rv-rows');
          function renderRows() {
            tbody.innerHTML = workingRows.map((row, index) => '<tr data-idx="' + index + '"' + (index === activeIndex ? ' class="is-active"' : '') + '><td>' + row[0] + '</td><td>' + row[1] + '</td></tr>').join('');
            Array.from(tbody.querySelectorAll('tr')).forEach((tr) => {
              tr.addEventListener('click', function () {
                activeIndex = Number(tr.getAttribute('data-idx'));
                renderRows();
              });
            });
          }

          function swapRows(a, b) {
            const tmp = workingRows[a];
            workingRows[a] = workingRows[b];
            workingRows[b] = tmp;
            activeIndex = b;
            renderRows();
          }

          document.getElementById('rv-up').addEventListener('click', function () {
            if (activeIndex <= 0) return;
            swapRows(activeIndex, activeIndex - 1);
            simOutput.textContent = 'Viewport moved up (simulated).';
          });
          document.getElementById('rv-down').addEventListener('click', function () {
            if (activeIndex < 0 || activeIndex >= workingRows.length - 1) return;
            swapRows(activeIndex, activeIndex + 1);
            simOutput.textContent = 'Viewport moved down (simulated).';
          });
          document.getElementById('rv-auto').addEventListener('click', function () {
            workingRows.sort((a, b) => a[1].localeCompare(b[1]));
            activeIndex = workingRows.length ? 0 : -1;
            renderRows();
            simOutput.textContent = 'Auto sort applied alphabetically (simulated).';
          });
          document.getElementById('rv-apply').addEventListener('click', function () {
            if (!workingRows.length) {
              simOutput.textContent = 'Validation failed. No viewport rows available.';
              return;
            }
            simOutput.textContent = 'Reorder Viewports simulation complete.\\nRows applied: ' + workingRows.length + '\\nNo Revit model changes were made.';
          });

          renderRows();
        }

        function renderCopyStateSimulator() {
          const dataset = DATASET.copyState || {};
          const actions = Array.isArray(dataset.actions) && dataset.actions.length
            ? dataset.actions
            : ['Filter Overrides', 'Scope Box', 'Annotations', 'Propagate Extents', 'Viewport Title', 'Revit Links', 'DWG Links'];
          const memoryRows = Array.isArray(dataset.memoryRows) && dataset.memoryRows.length
            ? dataset.memoryRows
            : [['Filter Overrides', 'Empty'], ['Scope Box', 'Empty'], ['Viewport Title', 'Empty'], ['Revit Links', 'Empty']];
          const stagedRows = Array.isArray(dataset.stagedRows) && dataset.stagedRows.length
            ? dataset.stagedRows
            : [['Active View', 'S101 - General Arrangement'], ['Selections', '0 actions selected']];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Action Picker</h5>' +
                '<label class="sim-control"><span class="sim-label">Search actions</span><input id="cs-search" class="sim-field" type="text" placeholder="Filter actions..." /></label>' +
                '<label class="sim-control"><span class="sim-label">Actions to copy *</span><select id="cs-actions" class="sim-field" multiple>' + actions.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="cs-select-all">Select All</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="cs-clear-all">Clear All</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Memory Slots</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Slot</th><th>Status</th></tr></thead><tbody>' + memoryRows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<h5 style="margin-top:1rem;">Current Selection Context</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>' + stagedRows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="cs-preview">Preview Memory Payload</button>' +
                  '<button type="button" class="sim-action" id="cs-copy">Copy to Memory</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          const actionList = document.getElementById('cs-actions');
          document.getElementById('cs-select-all').addEventListener('click', function () {
            Array.from(actionList.options).forEach((option) => { option.selected = true; });
            simOutput.textContent = 'All copy actions selected (simulated).';
          });
          document.getElementById('cs-clear-all').addEventListener('click', function () {
            Array.from(actionList.options).forEach((option) => { option.selected = false; });
            simOutput.textContent = 'Copy action selection cleared (simulated).';
          });
          document.getElementById('cs-preview').addEventListener('click', function () {
            const count = Array.from(actionList.selectedOptions).length;
            simOutput.textContent = 'CopyState preview generated.\\nActions staged: ' + count + '\\nMemory payload ready (simulated).';
          });
          document.getElementById('cs-copy').addEventListener('click', function () {
            const selected = Array.from(actionList.selectedOptions).map((item) => item.value).filter(Boolean);
            if (!selected.length) {
              simOutput.textContent = 'Validation failed. Select at least one action to copy.';
              return;
            }
            simOutput.textContent = 'CopyState simulation complete.\\nActions copied: ' + selected.join(', ') + '\\nNo Revit model changes were made.';
          });
        }

        function renderPropagateExtentsOverrideSimulator() {
          const dataset = DATASET.propagateExtentsOverride || {};
          const hostViews = Array.isArray(dataset.hostViews) && dataset.hostViews.length
            ? dataset.hostViews
            : ['L01 - Structural Plan', 'L02 - Structural Plan', 'L03 - Roof Plan'];
          const targetViews = Array.isArray(dataset.targetViews) && dataset.targetViews.length
            ? dataset.targetViews
            : ['L01 - General Arrangement', 'L02 - General Arrangement', 'L03 - General Arrangement'];
          const viewTypes = Array.isArray(dataset.viewTypes) && dataset.viewTypes.length
            ? dataset.viewTypes
            : ['FloorPlan', 'CeilingPlan', 'Section'];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Host View</h5>' +
                '<label class="sim-control"><span class="sim-label">Search host view</span><input id="pe-host-search" class="sim-field" type="text" placeholder="Filter host views..." /></label>' +
                '<label class="sim-control"><span class="sim-label">Host view type</span><select id="pe-host-type" class="sim-field">' + ['-- Show all --'].concat(viewTypes).map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Host view *</span><select id="pe-host-view" class="sim-field">' + hostViews.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pe-use-host">Use Selected Host View</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Target Views</h5>' +
                '<label class="sim-control"><span class="sim-label">Search target views</span><input id="pe-target-search" class="sim-field" type="text" placeholder="Filter target views..." /></label>' +
                '<label class="sim-control"><span class="sim-label">Target view type</span><select id="pe-target-type" class="sim-field">' + ['-- Show all --'].concat(viewTypes).map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Target views *</span><select id="pe-target-views" class="sim-field" multiple>' + targetViews.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pe-check-all">Check All</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pe-uncheck-all">Uncheck All</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pe-toggle-all">Toggle All</button>' +
                  '<button type="button" class="sim-action" id="pe-run">Propagate Grid + Level Extents</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          const targetList = document.getElementById('pe-target-views');
          document.getElementById('pe-use-host').addEventListener('click', function () {
            simOutput.textContent = 'Host view staged for propagation (simulated).';
          });
          document.getElementById('pe-check-all').addEventListener('click', function () {
            Array.from(targetList.options).forEach((option) => { option.selected = true; });
            simOutput.textContent = 'All target views checked (simulated).';
          });
          document.getElementById('pe-uncheck-all').addEventListener('click', function () {
            Array.from(targetList.options).forEach((option) => { option.selected = false; });
            simOutput.textContent = 'All target views unchecked (simulated).';
          });
          document.getElementById('pe-toggle-all').addEventListener('click', function () {
            Array.from(targetList.options).forEach((option) => { option.selected = !option.selected; });
            simOutput.textContent = 'Target view selection toggled (simulated).';
          });
          document.getElementById('pe-run').addEventListener('click', function () {
            const host = String(document.getElementById('pe-host-view').value || '').trim();
            const targetCount = Array.from(targetList.selectedOptions).length;
            if (!host || !targetCount) {
              simOutput.textContent = 'Validation failed. Select one host view and one or more target views.';
              return;
            }
            simOutput.textContent = 'Propagate Extents Override simulation complete.\\nHost: ' + host + '\\nTargets: ' + targetCount + '\\nGrid/level propagation and crop override simulated.\\nNo Revit model changes were made.';
          });
        }

        function renderCloudRevisionsSimulator() {
          const dataset = DATASET.cloudRevisions || {};
          const cloudOnly = Array.isArray(dataset.cloudOnlyRows) && dataset.cloudOnlyRows.length
            ? dataset.cloudOnlyRows
            : [['S101', 'General Notes', 'A', 'Tender', 'DIRECT']];
          const both = Array.isArray(dataset.bothRows) && dataset.bothRows.length
            ? dataset.bothRows
            : [['S201', 'Level 02 Framing', 'B', 'For Construction', 'VIA VIEW']];
          const manualOnly = Array.isArray(dataset.manualOnlyRows) && dataset.manualOnlyRows.length
            ? dataset.manualOnlyRows
            : [['A301', 'Elevations', 'C', 'Issued for Coordination', 'MANUAL']];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          function renderRows(rows) {
            return rows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td><td>' + String(row[2] || '') + '</td><td>' + String(row[3] || '') + '</td><td>' + String(row[4] || '') + '</td></tr>').join('');
          }

          simulatorRoot.innerHTML =
            '<div class="hf-grid">' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Revision Cloud Classifier</h5>' +
                '<label class="sim-control"><span class="sim-label">Sheet filter</span><input id="cr-sheet-filter" class="sim-field" type="text" placeholder="e.g. S101" /></label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="cr-refresh">Refresh Revisions</button>' +
                  '<button type="button" class="sim-action" id="cr-report">Generate Classification Report</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane">' +
                '<h5>List 1: Cloud Only</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Sheet</th><th>Name</th><th>Rev</th><th>Description</th><th>Mode</th></tr></thead><tbody>' + renderRows(cloudOnly) + '</tbody></table></div>' +
              '</section>' +
              '<section class="hf-pane">' +
                '<h5>List 2: Cloud + Manual</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Sheet</th><th>Name</th><th>Rev</th><th>Description</th><th>Mode</th></tr></thead><tbody>' + renderRows(both) + '</tbody></table></div>' +
              '</section>' +
              '<section class="hf-pane">' +
                '<h5>List 3: Manual Only</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Sheet</th><th>Name</th><th>Rev</th><th>Description</th><th>Mode</th></tr></thead><tbody>' + renderRows(manualOnly) + '</tbody></table></div>' +
              '</section>' +
            '</div>';

          document.getElementById('cr-refresh').addEventListener('click', function () {
            simOutput.textContent = 'Revision clouds and sheet revision ids reloaded (simulated).';
          });
          document.getElementById('cr-report').addEventListener('click', function () {
            const total = cloudOnly.length + both.length + manualOnly.length;
            simOutput.textContent = 'Cloud Revisions report generated (simulated).\\nCloud only: ' + cloudOnly.length + '\\nCloud + manual: ' + both.length + '\\nManual only: ' + manualOnly.length + '\\nTotal classified pairs: ' + total + '\\nNo Revit model changes were made.';
          });
        }

        function renderElementsByLevelSimulator() {
          const dataset = DATASET.elementsByLevel || {};
          const levels = Array.isArray(dataset.levels) && dataset.levels.length ? dataset.levels : ['Level 01', 'Level 02', 'Roof'];
          const categories = Array.isArray(dataset.categories) && dataset.categories.length
            ? dataset.categories
            : ['Structural Framing', 'Structural Columns', 'Walls', 'Floors', 'Rooms'];
          const rows = Array.isArray(dataset.elementRows) && dataset.elementRows.length
            ? dataset.elementRows
            : [['W310x97', '734921'], ['300UC52', '734922'], ['Concrete Slab 200', '734923']];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Level Selection + Filters</h5>' +
                '<label class="sim-control"><span class="sim-label">Level *</span><select id="ebl-level" class="sim-field">' + levels.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Category search</span><input id="ebl-search" class="sim-field" type="text" placeholder="Filter categories..." /></label>' +
                '<label class="sim-control"><span class="sim-label">Categories *</span><select id="ebl-categories" class="sim-field" multiple>' + categories.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label><input id="ebl-include-view-specific" type="checkbox" /> Include view-specific elements</label>' +
                '<label><input id="ebl-include-annotation" type="checkbox" /> Include annotation categories</label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="ebl-select-all">Select All Elements</button>' +
                  '<button type="button" class="sim-action" id="ebl-list">List Elements by Level</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Element Report Preview</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Type Name</th><th>Element Id</th></tr></thead><tbody>' + rows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<p class="muted">Report output is the primary interaction surface for this tool.</p>' +
              '</section>' +
            '</div>';

          const categoryList = document.getElementById('ebl-categories');
          document.getElementById('ebl-select-all').addEventListener('click', function () {
            Array.from(categoryList.options).forEach((option) => { option.selected = true; });
            simOutput.textContent = 'All categories selected for level listing (simulated).';
          });
          document.getElementById('ebl-list').addEventListener('click', function () {
            const selectedCategories = Array.from(categoryList.selectedOptions).length;
            if (!selectedCategories) {
              simOutput.textContent = 'Validation failed. Select at least one category.';
              return;
            }
            simOutput.textContent = 'Elements by Level simulation complete.\\nCategories scanned: ' + selectedCategories + '\\nRows listed: ' + rows.length + '\\nNo Revit model changes were made.';
          });
        }

        function renderDashboardSimulator() {
          const dataset = DATASET.dashboard || {};
          const cards = Array.isArray(dataset.cards) && dataset.cards.length ? dataset.cards.slice() : [
            { title: 'Package Creator', group: 'Data', status: 'Ready', source: 'RBG Tools_Data', summary: 'Create staged issue packages with validation and export steps.', favorite: true, recent: true },
            { title: 'View Filter Editor', group: 'Views', status: 'Ready', source: 'RBG Tools_Views', summary: 'Inspect and stage per-view filter override changes before applying.', favorite: false, recent: true },
          ];
          const groups = Array.isArray(dataset.groupOptions) && dataset.groupOptions.length ? dataset.groupOptions : ['All Tools'].concat(cards.map((card) => String(card.group || 'General')));
          let activeGroup = String(groups[0] || 'All Tools');
          let activeFilter = 'all';
          let searchText = '';
          let selectedIndex = 0;

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="dash-layout">' +
              '<section class="hf-pane">' +
                '<h5>Filter + Search</h5>' +
                '<div class="dash-filter-row">' +
                  '<button type="button" class="sim-action sim-action-secondary dash-filter" data-filter="all">All</button>' +
                  '<button type="button" class="sim-action sim-action-secondary dash-filter" data-filter="favorites">Starred</button>' +
                  '<button type="button" class="sim-action sim-action-secondary dash-filter" data-filter="recent">Recent</button>' +
                '</div>' +
                '<label class="sim-control"><span class="sim-label">Search</span><input id="dash-search" class="sim-field" type="search" placeholder="Filter tools..." /></label>' +
                '<div id="dash-groups" class="dash-groups"></div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Tool Cards</h5>' +
                '<div id="dash-summary" class="muted"></div>' +
                '<div id="dash-cards" class="dash-card-list"></div>' +
              '</section>' +
              '<section class="hf-pane">' +
                '<h5>Selected Tool</h5>' +
                '<div id="dash-detail" class="dash-detail"></div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="dash-toggle-favorite">Toggle Favorite</button>' +
                  '<button type="button" class="sim-action" id="dash-launch">Quick Launch</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          function getVisibleCards() {
            return cards.filter((card) => {
              if (activeGroup !== 'All Tools' && String(card.group || '') !== activeGroup) {
                return false;
              }
              if (activeFilter === 'favorites' && !card.favorite) {
                return false;
              }
              if (activeFilter === 'recent' && !card.recent) {
                return false;
              }
              if (searchText && !JSON.stringify(card).toLowerCase().includes(searchText.toLowerCase())) {
                return false;
              }
              return true;
            });
          }

          function ensureSelection(visibleCards) {
            if (!visibleCards.length) {
              selectedIndex = -1;
              return;
            }
            if (selectedIndex < 0 || selectedIndex >= visibleCards.length) {
              selectedIndex = 0;
            }
          }

          function renderGroups() {
            const groupWrap = document.getElementById('dash-groups');
            groupWrap.innerHTML = groups.map((group) => {
              const label = String(group);
              const active = label === activeGroup ? ' is-active' : '';
              return '<button type="button" class="dash-group-btn' + active + '" data-group="' + label + '">' + label + '</button>';
            }).join('');
            Array.from(groupWrap.querySelectorAll('[data-group]')).forEach((button) => {
              button.addEventListener('click', function () {
                activeGroup = button.getAttribute('data-group') || 'All Tools';
                selectedIndex = 0;
                renderDashboard();
              });
            });
          }

          function renderDashboard() {
            const visibleCards = getVisibleCards();
            ensureSelection(visibleCards);
            const summary = document.getElementById('dash-summary');
            const cardsWrap = document.getElementById('dash-cards');
            const detailWrap = document.getElementById('dash-detail');
            const selected = selectedIndex >= 0 ? visibleCards[selectedIndex] : null;

            summary.textContent = visibleCards.length + ' tool cards shown for ' + activeGroup + '.';
            cardsWrap.innerHTML = visibleCards.length
              ? visibleCards.map((card, index) => {
                  const active = index === selectedIndex ? ' is-active' : '';
                  const glyph = card.favorite ? '★' : '•';
                  return '<button type="button" class="dash-card' + active + '" data-card-index="' + index + '">' +
                    '<span class="dash-card-title">' + String(card.title || '') + '</span>' +
                    '<span class="dash-card-meta">' + glyph + ' ' + String(card.group || 'General') + ' · ' + String(card.status || 'Ready') + '</span>' +
                    '<span class="dash-card-copy">' + String(card.summary || '') + '</span>' +
                  '</button>';
                }).join('')
              : '<p class="muted">No dashboard cards match the current filters.</p>';

            detailWrap.innerHTML = selected
              ? '<strong>' + String(selected.title || '') + '</strong>' +
                '<span class="dash-detail-meta">' + String(selected.source || '') + ' · ' + String(selected.status || 'Ready') + '</span>' +
                '<p>' + String(selected.summary || '') + '</p>'
              : '<p class="muted">Select a tool card to inspect its dashboard summary.</p>';

            Array.from(cardsWrap.querySelectorAll('[data-card-index]')).forEach((button) => {
              button.addEventListener('click', function () {
                selectedIndex = Number(button.getAttribute('data-card-index') || 0);
                renderDashboard();
                if (visibleCards[selectedIndex]) {
                  simOutput.textContent = 'Selected dashboard card: ' + visibleCards[selectedIndex].title;
                }
              });
            });
          }

          renderGroups();
          renderDashboard();

          Array.from(simulatorRoot.querySelectorAll('.dash-filter')).forEach((button) => {
            button.addEventListener('click', function () {
              activeFilter = button.getAttribute('data-filter') || 'all';
              Array.from(simulatorRoot.querySelectorAll('.dash-filter')).forEach((node) => node.classList.remove('is-active'));
              button.classList.add('is-active');
              selectedIndex = 0;
              renderDashboard();
            });
          });
          const allFilterButton = simulatorRoot.querySelector('.dash-filter[data-filter="all"]');
          if (allFilterButton) {
            allFilterButton.classList.add('is-active');
          }

          document.getElementById('dash-search').addEventListener('input', function (event) {
            searchText = event.target.value || '';
            selectedIndex = 0;
            renderDashboard();
          });

          document.getElementById('dash-toggle-favorite').addEventListener('click', function () {
            const visibleCards = getVisibleCards();
            const selected = selectedIndex >= 0 ? visibleCards[selectedIndex] : null;
            if (!selected) {
              simOutput.textContent = 'Select a dashboard card before toggling favorites.';
              return;
            }
            selected.favorite = !selected.favorite;
            renderDashboard();
            simOutput.textContent = 'Favorite state updated for ' + selected.title + ' (simulated).';
          });

          document.getElementById('dash-launch').addEventListener('click', function () {
            const visibleCards = getVisibleCards();
            const selected = selectedIndex >= 0 ? visibleCards[selectedIndex] : null;
            if (!selected) {
              simOutput.textContent = 'Select a dashboard card before launching.';
              return;
            }
            simOutput.textContent = 'Dashboard quick launch simulated for ' + selected.title + '.\\nNo pyRevit or Revit process was started.';
          });
        }

        function renderTransactionLoggerSimulator() {
          const dataset = DATASET.transactionLogger || {};
          const categories = Array.isArray(dataset.categories) && dataset.categories.length
            ? dataset.categories
            : ['Structural Framing', 'Floors', 'Walls'];
          const snapshotModes = Array.isArray(dataset.snapshotModes) && dataset.snapshotModes.length
            ? dataset.snapshotModes
            : ['Off - fast, no before/after diff', 'Lazy - capture element state (enables diff)'];
          const sessionRows = Array.isArray(dataset.sessionRows) && dataset.sessionRows.length
            ? dataset.sessionRows
            : [['Startup logger active', 'Yes'], ['Current mode', 'Full model + annotations']];
          const outputPath = String(dataset.outputPath || 'C:/Temp/RBG/transaction-log-demo.csv');

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid hf-grid-two">' +
              '<section class="hf-pane">' +
                '<h5>Capture Mode</h5>' +
                '<label><input type="radio" name="tl-mode" id="tl-mode-full" checked /> Full model + annotations</label>' +
                '<label><input type="radio" name="tl-mode" id="tl-mode-targeted" /> Targeted categories</label>' +
                '<label class="sim-control"><span class="sim-label">Categories</span><select id="tl-categories" class="sim-field" multiple disabled>' + categories.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Snapshot mode</span><select id="tl-snapshot" class="sim-field">' + snapshotModes.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Output path</span><input id="tl-output" class="sim-field" type="text" value="' + outputPath + '" /></label>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Logger Session Preview</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>' + sessionRows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="tl-cancel">Cancel</button>' +
                  '<button type="button" class="sim-action" id="tl-start">Start Logging</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          const targeted = document.getElementById('tl-mode-targeted');
          const full = document.getElementById('tl-mode-full');
          const categorySelect = document.getElementById('tl-categories');
          function syncMode() {
            categorySelect.disabled = !targeted.checked;
          }
          targeted.addEventListener('change', syncMode);
          full.addEventListener('change', syncMode);
          syncMode();

          document.getElementById('tl-start').addEventListener('click', function () {
            const selectedCategories = Array.from(categorySelect.selectedOptions).map((option) => option.value);
            if (targeted.checked && !selectedCategories.length) {
              simOutput.textContent = 'Validation failed. Choose at least one category for targeted logging.';
              return;
            }
            simOutput.textContent = 'Transaction Logger simulation started.\\nMode: ' + (targeted.checked ? 'Targeted categories' : 'Full model + annotations') + '\\nSnapshot: ' + document.getElementById('tl-snapshot').value + '\\nOutput: ' + document.getElementById('tl-output').value + '\\nNo live logger was started.';
          });
          document.getElementById('tl-cancel').addEventListener('click', function () {
            simOutput.textContent = 'Transaction Logger setup dismissed (simulated).';
          });
        }

        function renderPlanViewRangeSimulator() {
          const dataset = DATASET.planViewRange || {};
          const planOptions = Array.isArray(dataset.planOptions) && dataset.planOptions.length
            ? dataset.planOptions
            : ['S-1001 Level 00 Framing Plan', 'S-1002 Level 01 Framing Plan'];
          const targetViews = Array.isArray(dataset.targetViews) && dataset.targetViews.length
            ? dataset.targetViews
            : ['S-2001 Level 00 Host Plan', 'S-2002 Level 01 Host Plan'];
          const rows = Array.isArray(dataset.comparisonRows) && dataset.comparisonRows.length
            ? dataset.comparisonRows
            : [['Top', 'Level 02', '2400', 'Level 02', '2400'], ['Cut', 'Level 01', '1200', 'Level 01', '1500']];

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="hf-grid">' +
              '<section class="hf-pane">' +
                '<h5>Compare Plans</h5>' +
                '<label class="sim-control"><span class="sim-label">Plan A *</span><select id="pvr-plan-a" class="sim-field">' + planOptions.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Plan B *</span><select id="pvr-plan-b" class="sim-field">' + planOptions.map((item, index) => '<option' + (index === 1 ? ' selected' : '') + '>' + item + '</option>').join('') + '</select></label>' +
                '<label><input id="pvr-template-aware" type="checkbox" checked /> Respect view template control flags</label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pvr-compare">Compare</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="pvr-swap">Swap A/B</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>View Range Comparison</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Plane</th><th>A Level</th><th>A Offset</th><th>B Level</th><th>B Offset</th></tr></thead><tbody>' + rows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td><td>' + String(row[2] || '') + '</td><td>' + String(row[3] || '') + '</td><td>' + String(row[4] || '') + '</td></tr>').join('') + '</tbody></table></div>' +
              '</section>' +
              '<section class="hf-pane">' +
                '<h5>Copy Targets</h5>' +
                '<label class="sim-control"><span class="sim-label">Targets *</span><select id="pvr-targets" class="sim-field" multiple>' + targetViews.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action" id="pvr-copy">Copy View Range</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          document.getElementById('pvr-compare').addEventListener('click', function () {
            simOutput.textContent = 'Plan View Range comparison refreshed for ' + document.getElementById('pvr-plan-a').value + ' vs ' + document.getElementById('pvr-plan-b').value + ' (simulated).';
          });
          document.getElementById('pvr-swap').addEventListener('click', function () {
            const a = document.getElementById('pvr-plan-a');
            const b = document.getElementById('pvr-plan-b');
            const temp = a.value;
            a.value = b.value;
            b.value = temp;
            simOutput.textContent = 'Plan A and Plan B swapped (simulated).';
          });
          document.getElementById('pvr-copy').addEventListener('click', function () {
            const selectedTargets = Array.from(document.getElementById('pvr-targets').selectedOptions);
            if (!selectedTargets.length) {
              simOutput.textContent = 'Validation failed. Select at least one target view.';
              return;
            }
            simOutput.textContent = 'Plan View Range copy simulated.\\nSource: ' + document.getElementById('pvr-plan-a').value + '\\nTargets: ' + selectedTargets.length + '\\nNo Revit model changes were made.';
          });
        }

        function renderScopeBoxViewCreationSimulator() {
          const dataset = DATASET.scopeBoxViewCreation || {};
          const sourceModes = Array.isArray(dataset.sourceModes) && dataset.sourceModes.length ? dataset.sourceModes : ['Creator workflow', 'Selector workflow'];
          const planViews = Array.isArray(dataset.planViews) && dataset.planViews.length ? dataset.planViews : ['GA-SS LEVEL 1E', 'GA-SS LEVEL 2E'];
          const scopeBoxes = Array.isArray(dataset.scopeBoxes) && dataset.scopeBoxes.length ? dataset.scopeBoxes : ['SB-A Core', 'SB-B East Wing'];
          const titleBlocks = Array.isArray(dataset.titleBlocks) && dataset.titleBlocks.length ? dataset.titleBlocks : ['A1 - Structural', 'A3 - Detail'];
          const stage1Rows = Array.isArray(dataset.stage1Rows) && dataset.stage1Rows.length ? dataset.stage1Rows : [['SB-A Core', 'Level 01', 'S-CORE L01 PLAN', 'S-CORE L01 SECTION', 'Ready']];
          const sheetRows = Array.isArray(dataset.sheetRows) && dataset.sheetRows.length ? dataset.sheetRows : [['S401', 'A1 - Structural', '2 views', 'Ready']];
          const warningRows = Array.isArray(dataset.warningRows) && dataset.warningRows.length ? dataset.warningRows : [['SB-B East Wing', 'Section name conflict detected.']];
          let activeStage = 0;

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="scope-layout">' +
              '<section class="hf-pane scope-stage-pane">' +
                '<h5>Workflow Stages</h5>' +
                '<div id="svc-stage-tabs" class="scope-stage-tabs"></div>' +
                '<label class="sim-control"><span class="sim-label">Source mode *</span><select id="svc-mode" class="sim-field">' + sourceModes.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Plan view *</span><select id="svc-plan" class="sim-field">' + planViews.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Scope box *</span><select id="svc-scope" class="sim-field">' + scopeBoxes.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '<label class="sim-control"><span class="sim-label">Titleblock</span><select id="svc-titleblock" class="sim-field">' + titleBlocks.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Stage 1 View Name Editor</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Source</th><th>Level</th><th>Plan Name</th><th>Section Name</th><th>Status</th></tr></thead><tbody>' + stage1Rows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td><td>' + String(row[2] || '') + '</td><td>' + String(row[3] || '') + '</td><td>' + String(row[4] || '') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="svc-load">Load Scope Boxes</button>' +
                  '<button type="button" class="sim-action sim-action-secondary" id="svc-stage-names">Apply View Names</button>' +
                  '<button type="button" class="sim-action" id="svc-create">Create + Layout Views</button>' +
                '</div>' +
              '</section>' +
              '<section class="hf-pane">' +
                '<h5>Sheet Layout + Warnings</h5>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>Sheet</th><th>Titleblock</th><th>Views</th><th>Status</th></tr></thead><tbody>' + sheetRows.map((row) => '<tr><td>' + String(row[0] || '') + '</td><td>' + String(row[1] || '') + '</td><td>' + String(row[2] || '') + '</td><td>' + String(row[3] || '') + '</td></tr>').join('') + '</tbody></table></div>' +
                '<div class="scope-warning-list">' + warningRows.map((row) => '<div class="scope-warning-item"><strong>' + String(row[0] || '') + '</strong><span>' + String(row[1] || '') + '</span></div>').join('') + '</div>' +
              '</section>' +
            '</div>';

          function renderStages() {
            const stages = ['1. View Set', '2. Name Editor', '3. Sheet Layout'];
            const wrap = document.getElementById('svc-stage-tabs');
            wrap.innerHTML = stages.map((label, index) => {
              const active = index === activeStage ? ' is-active' : '';
              return '<button type="button" class="scope-stage-tab' + active + '" data-stage="' + index + '">' + label + '</button>';
            }).join('');
            Array.from(wrap.querySelectorAll('[data-stage]')).forEach((button) => {
              button.addEventListener('click', function () {
                activeStage = Number(button.getAttribute('data-stage') || 0);
                renderStages();
                simOutput.textContent = 'Scope Box View Creation stage changed to ' + button.textContent + ' (simulated).';
              });
            });
          }

          renderStages();

          document.getElementById('svc-load').addEventListener('click', function () {
            activeStage = 0;
            renderStages();
            simOutput.textContent = 'Scope boxes loaded for ' + document.getElementById('svc-plan').value + ' (simulated).';
          });
          document.getElementById('svc-stage-names').addEventListener('click', function () {
            activeStage = 1;
            renderStages();
            simOutput.textContent = 'Stage 1 naming simulated for ' + stage1Rows.length + ' rows.';
          });
          document.getElementById('svc-create').addEventListener('click', function () {
            activeStage = 2;
            renderStages();
            simOutput.textContent = 'Scope Box View Creation simulation complete.\\nViews staged: ' + stage1Rows.length + '\\nSheets reviewed: ' + sheetRows.length + '\\nWarnings: ' + warningRows.length + '\\nNo Revit model changes were made.';
          });
        }

        function renderViewFilterEditorSimulator() {
          const dataset = DATASET.viewFilterEditor || {};
          const showModes = Array.isArray(dataset.showModes) && dataset.showModes.length ? dataset.showModes : ['All filters', 'Only modified'];
          const patterns = Array.isArray(dataset.patternOptions) && dataset.patternOptions.length ? dataset.patternOptions : ['<None>', 'Solid Fill'];
          const templateRows = Array.isArray(dataset.templateRows) && dataset.templateRows.length ? dataset.templateRows.map((row) => Object.assign({}, row)) : [];
          const viewRows = Array.isArray(dataset.viewRows) && dataset.viewRows.length ? dataset.viewRows.map((row) => Object.assign({}, row)) : [];
          let activeTab = 'templates';
          let selectedIndex = 0;
          const dirtyIds = new Set();

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="vfe-layout">' +
              '<section class="hf-pane vfe-main">' +
                '<div class="vfe-toolbar">' +
                  '<label class="sim-control"><span class="sim-label">Search</span><input id="vfe-search" class="sim-field" type="search" placeholder="Search view or filter..." /></label>' +
                  '<label class="sim-control"><span class="sim-label">Show</span><select id="vfe-show" class="sim-field">' + showModes.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
                '</div>' +
                '<div class="scope-stage-tabs">' +
                  '<button type="button" class="scope-stage-tab is-active" data-vfe-tab="templates">View Templates</button>' +
                  '<button type="button" class="scope-stage-tab" data-vfe-tab="views">Views</button>' +
                '</div>' +
                '<div class="sim-table-wrap"><table><thead><tr><th>View</th><th>Filter</th><th>Visible</th><th>Transparency</th><th>Status</th></tr></thead><tbody id="vfe-body"></tbody></table></div>' +
              '</section>' +
              '<section class="hf-pane">' +
                '<h5>Detail Editor</h5>' +
                '<div id="vfe-detail"></div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="vfe-stage">Stage Changes</button>' +
                  '<button type="button" class="sim-action" id="vfe-apply">Apply to Revit</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          function activeRows() {
            return activeTab === 'templates' ? templateRows : viewRows;
          }

          function selectedRow() {
            const rows = activeRows();
            if (!rows.length) {
              return null;
            }
            if (selectedIndex < 0 || selectedIndex >= rows.length) {
              selectedIndex = 0;
            }
            return rows[selectedIndex];
          }

          function renderDetail() {
            const row = selectedRow();
            const detail = document.getElementById('vfe-detail');
            if (!row) {
              detail.innerHTML = '<p class="muted">Select one or more rows to edit.</p>';
              return;
            }
            detail.innerHTML =
              '<div class="vfe-detail-head"><strong>' + String(row.view || '') + '</strong><span>' + String(row.filter || '') + '</span></div>' +
              '<label><input id="vfe-enabled" type="checkbox"' + (row.enabled ? ' checked' : '') + ' /> Enabled</label>' +
              '<label><input id="vfe-visible" type="checkbox"' + (row.visible ? ' checked' : '') + ' /> Visible</label>' +
              '<label><input id="vfe-halftone" type="checkbox"' + (row.halftone ? ' checked' : '') + ' /> Halftone</label>' +
              '<label class="sim-control"><span class="sim-label">Transparency</span><input id="vfe-transparency" class="sim-field" type="number" min="0" max="100" value="' + Number(row.transparency || 0) + '" /></label>' +
              '<label class="sim-control"><span class="sim-label">Projection pattern</span><select id="vfe-pattern" class="sim-field">' + patterns.map((item) => '<option>' + item + '</option>').join('') + '</select></label>' +
              '<p class="muted">Only staged rows are committed by the simulator.</p>';
          }

          function renderTable() {
            const query = String(document.getElementById('vfe-search').value || '').toLowerCase();
            const show = document.getElementById('vfe-show').value || 'All filters';
            const rows = activeRows().filter((row) => {
              if (query && !(String(row.view || '').toLowerCase().includes(query) || String(row.filter || '').toLowerCase().includes(query))) {
                return false;
              }
              if (show === 'Only modified' && row.status !== 'Dirty' && !dirtyIds.has(row.id)) {
                return false;
              }
              if (show === 'Only hidden' && row.visible !== false) {
                return false;
              }
              return true;
            });
            const body = document.getElementById('vfe-body');
            body.innerHTML = rows.length
              ? rows.map((row, index) => {
                  const active = selectedRow() && row.id === selectedRow().id ? ' class="is-active"' : '';
                  const status = dirtyIds.has(row.id) ? 'Staged' : row.status;
                  return '<tr' + active + ' data-row-id="' + row.id + '" data-row-index="' + index + '"><td>' + String(row.view || '') + '</td><td>' + String(row.filter || '') + '</td><td>' + (row.visible ? 'Yes' : 'No') + '</td><td>' + String(row.transparency || 0) + '%</td><td>' + String(status || 'Clean') + '</td></tr>';
                }).join('')
              : '<tr><td colspan="5">No filter rows match the current search and mode.</td></tr>';

            Array.from(body.querySelectorAll('[data-row-id]')).forEach((rowNode) => {
              rowNode.addEventListener('click', function () {
                const rowsNow = activeRows().filter((row) => {
                  if (query && !(String(row.view || '').toLowerCase().includes(query) || String(row.filter || '').toLowerCase().includes(query))) {
                    return false;
                  }
                  if (show === 'Only modified' && row.status !== 'Dirty' && !dirtyIds.has(row.id)) {
                    return false;
                  }
                  if (show === 'Only hidden' && row.visible !== false) {
                    return false;
                  }
                  return true;
                });
                const clickedId = rowNode.getAttribute('data-row-id');
                const actualIndex = activeRows().findIndex((row) => row.id === clickedId);
                if (actualIndex >= 0) {
                  selectedIndex = actualIndex;
                } else if (rowsNow.length) {
                  selectedIndex = 0;
                }
                renderTable();
                renderDetail();
                if (clickedId) {
                  simOutput.textContent = 'Selected filter row ' + clickedId + ' (simulated).';
                }
              });
            });
          }

          function syncTabButtons() {
            Array.from(simulatorRoot.querySelectorAll('[data-vfe-tab]')).forEach((button) => {
              const active = button.getAttribute('data-vfe-tab') === activeTab;
              button.classList.toggle('is-active', active);
            });
          }

          syncTabButtons();
          renderTable();
          renderDetail();

          Array.from(simulatorRoot.querySelectorAll('[data-vfe-tab]')).forEach((button) => {
            button.addEventListener('click', function () {
              activeTab = button.getAttribute('data-vfe-tab') || 'templates';
              selectedIndex = 0;
              syncTabButtons();
              renderTable();
              renderDetail();
              simOutput.textContent = 'Switched View Filter Editor to ' + button.textContent + ' (simulated).';
            });
          });
          document.getElementById('vfe-search').addEventListener('input', function () {
            renderTable();
          });
          document.getElementById('vfe-show').addEventListener('change', function () {
            renderTable();
          });
          document.getElementById('vfe-stage').addEventListener('click', function () {
            const row = selectedRow();
            if (!row) {
              simOutput.textContent = 'Select a filter row before staging changes.';
              return;
            }
            row.enabled = document.getElementById('vfe-enabled').checked;
            row.visible = document.getElementById('vfe-visible').checked;
            row.halftone = document.getElementById('vfe-halftone').checked;
            row.transparency = Number(document.getElementById('vfe-transparency').value || 0);
            row.status = 'Dirty';
            dirtyIds.add(row.id);
            renderTable();
            renderDetail();
            simOutput.textContent = 'Changes staged for ' + row.view + ' / ' + row.filter + '.';
          });
          document.getElementById('vfe-apply').addEventListener('click', function () {
            if (!dirtyIds.size) {
              simOutput.textContent = 'No staged changes found. Use Stage Changes first.';
              return;
            }
            simOutput.textContent = 'View Filter Editor simulation complete.\\nDirty rows applied: ' + dirtyIds.size + '\\nWrites go through apply_filter_overrides(doc, payload) in the real tool.\\nNo Revit model changes were made.';
          });
        }

        function renderWpfTemplateSimulator() {
          const dataset = DATASET.wpfTemplate || {};
          const steps = Array.isArray(dataset.steps) && dataset.steps.length ? dataset.steps : ['Shell', 'Controls', 'Patterns'];
          const cards = Array.isArray(dataset.componentCards) && dataset.componentCards.length ? dataset.componentCards : [['Cards + grids', 'Primary content layout with consistent spacing and surface hierarchy.']];
          const checklist = Array.isArray(dataset.checklist) && dataset.checklist.length ? dataset.checklist : ['Use shared palette resources instead of inline colours.'];
          let activeStep = 1;

          setText('sim-control-count', SIMULATOR.controls.length);
          setText('sim-event-count', SIMULATOR.events.length);
          setText('sim-prompt-count', SIMULATOR.prompts.length);

          simulatorRoot.innerHTML =
            '<div class="template-layout">' +
              '<section class="hf-pane">' +
                '<h5>Reference Progression</h5>' +
                '<div id="wpf-step-tabs" class="scope-stage-tabs"></div>' +
                '<p class="muted">This tool is a reference surface, so the simulator focuses on approved patterns rather than model edits.</p>' +
              '</section>' +
              '<section class="hf-pane hf-pane-wide">' +
                '<h5>Approved Component Patterns</h5>' +
                '<div class="template-card-grid">' + cards.map((card) => '<article class="template-card"><strong>' + String(card[0] || '') + '</strong><p>' + String(card[1] || '') + '</p></article>').join('') + '</div>' +
              '</section>' +
              '<section class="hf-pane">' +
                '<h5>Checklist</h5>' +
                '<div class="scope-warning-list">' + checklist.map((item) => '<div class="scope-warning-item"><strong>OK</strong><span>' + String(item) + '</span></div>').join('') + '</div>' +
                '<div class="sim-action-row hf-actions">' +
                  '<button type="button" class="sim-action sim-action-secondary" id="wpf-copy-shell">Copy Starter Skeleton</button>' +
                  '<button type="button" class="sim-action" id="wpf-mark-reviewed">Mark Reviewed</button>' +
                '</div>' +
              '</section>' +
            '</div>';

          function renderSteps() {
            const wrap = document.getElementById('wpf-step-tabs');
            wrap.innerHTML = steps.map((step, index) => {
              const active = index === activeStep ? ' is-active' : '';
              return '<button type="button" class="scope-stage-tab' + active + '" data-step="' + index + '">' + String(step) + '</button>';
            }).join('');
            Array.from(wrap.querySelectorAll('[data-step]')).forEach((button) => {
              button.addEventListener('click', function () {
                activeStep = Number(button.getAttribute('data-step') || 0);
                renderSteps();
                simOutput.textContent = 'WPF template reference focused on ' + button.textContent + ' patterns.';
              });
            });
          }

          renderSteps();
          document.getElementById('wpf-copy-shell').addEventListener('click', function () {
            simOutput.textContent = 'Starter shell copy simulated.\\nUse the WPF UI Template as the canonical reference for new tools.';
          });
          document.getElementById('wpf-mark-reviewed').addEventListener('click', function () {
            simOutput.textContent = 'Reference review complete.\\nChecklist items covered: ' + checklist.length + '.';
          });
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

        initializeScreenshotGallery();
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
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?:\\n##\\s+|$)`, "i");
  const match = mdText.match(regex);
  if (!match) {
    return [];
  }

  return normalizeWrappedListItems(match[1]);
}

function parseContextDoc(contextText) {
  const titleMatch = contextText.match(/^#\s+(.+)$/m);
  return {
    title: titleMatch ? titleMatch[1].trim() : "",
    purpose: parseMarkdownSection(contextText, "Purpose"),
    workflow: parseMarkdownListSection(contextText, "Workflow"),
    constraints: parseMarkdownSection(contextText, "Critical Constraints"),
    notes: parseMarkdownSection(contextText, "Working Notes"),
    entryPoints: parseMarkdownSection(contextText, "Entry Points"),
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

function extractPythonDocInfo(pyFiles) {
  const howToSteps = [];
  const todoItems = [];
  let description = "";

  for (const file of pyFiles || []) {
    const docText = extractAssignedDocstring(file.content);
    if (!docText) {
      continue;
    }

    const descriptionBlock = parseScriptDocSection(docText, "Description");
    if (!description && descriptionBlock) {
      description = normalizeWrappedListItems(descriptionBlock).join(" ");
    }

    normalizeWrappedListItems(parseScriptDocSection(docText, "How-to")).forEach((item) => howToSteps.push(item));
    normalizeWrappedListItems(parseScriptDocSection(docText, "To-Do")).forEach((item) => todoItems.push(item));
  }

  return {
    description,
    howToSteps: dedupe(howToSteps),
    todoItems: dedupe(todoItems),
  };
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
    ...(tool.workflowSteps || []),
    ...(tool.uiMockup.workflowStages || []),
    ...(tool.uiMockup.keyWorkflowMethods || []),
    ...(tool.inputs || []),
    tool.function || "",
    tool.purpose || "",
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

function isAddCoordinatesTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("AddCoordinates.pushbutton") || /add\s*coordinates/i.test(title);
}

function isSectionUpdaterTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("SectionUpdater.pushbutton") || /section\s*move/i.test(title);
}

function isPackageCreatorTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("PackageCreator.pushbutton") || /packagecreator/i.test(title);
}

function isParamCopierTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("ParamCopier.pushbutton") || /param\s*copier|paramcopier/i.test(title);
}

function isSheetNoTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("SheetNo.pushbutton") || /^sheetno$/i.test(title);
}

function isScheduleUpdaterTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("ScheduleUpdater.pushbutton") || /schedule\s*updater/i.test(title);
}

function isLinkedViewsTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("LinkedViews.pushbutton") || /linkedviews/i.test(title);
}

function isCategoryPickerTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("CategoryPicker.pushbutton") || /categorypicker/i.test(title);
}

function isReorderViewportsTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("Reorder Viewports.pushbutton") || /reorder\s*viewports/i.test(title);
}

function isCopyStateTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("Copy State.pushbutton") || /copy\s*state/i.test(title);
}

function isPropagateExtentsOverrideTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("Propagate Extents Override.pushbutton") || /propagate\s*extents\s*override/i.test(title);
}

function isCloudRevisionsTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("CloudRevisions.pushbutton") || /cloud\s*revisions/i.test(title);
}

function isElementsByLevelTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("SelectbyLevel.pushbutton") || /elements\s*by\s*level/i.test(title);
}

function isDashboardTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("Dashboard.pushbutton") || /tool\s*dashboard/i.test(title);
}

function isTransactionLoggerTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("Transaction Logger.pushbutton") || /transaction\s*logger/i.test(title);
}

function isPlanViewRangeTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("PlanViewRange.pushbutton") || /plan\s*view\s*range/i.test(title);
}

function isScopeBoxViewCreationTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("ScopeBoxViewCreation.pushbutton") || /scope\s*box\s*view\s*creation/i.test(title);
}

function isViewFilterEditorTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("ViewFilterEditor.pushbutton") || /view\s*filter\s*editor/i.test(title);
}

function isWpfTemplateTool(tool) {
  const id = String((tool && tool.id) || "");
  const title = String((tool && tool.title) || "");
  return id.includes("WPFStyleTemplate.pushbutton") || /wpf\s*(ui\s*)?template/i.test(title);
}

function buildAddCoordinatesSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "addcoordinates-dialog",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "coord-selection-view", name: "Select Elements in View", kind: "button", label: "Select Elements in View", required: true },
      { id: "coord-selection-model", name: "Select All Elements In Model", kind: "button", label: "Select All Elements In Model", required: true },
      { id: "coord-category", name: "CategoryList", kind: "select", label: "Category", required: false },
      { id: "coord-run", name: "RunCoordinateUpdate", kind: "button", label: "Run Coordinate Update", required: true },
      { id: "coord-results", name: "UpdatedElements", kind: "table", label: "Updated elements", required: false },
    ],
    events: [
      { controlId: "coord-selection-view", event: "click", handler: "select_view_scope" },
      { controlId: "coord-selection-model", event: "click", handler: "select_model_scope" },
      { controlId: "coord-run", event: "click", handler: "run_coordinate_update" },
    ],
    prompts: [
      { type: "alert", message: "Choose your selection type." },
      { type: "SelectFromList", message: "Choose a category for model-wide update." },
    ],
    workflow: [
      { step: 1, label: "Prepare a clean 3D view with the target elements visible" },
      { step: 2, label: "Choose either active-view selection or a model-wide category run" },
      { step: 3, label: "Update project and survey shared coordinate parameters" },
      { step: 4, label: "Review the selectable list of updated elements" },
    ],
    dynamicSources: ["categories", "parameters"],
    scenarios: [
      {
        id: "addcoordinates-training",
        title: "Add Coordinates Training Run",
        steps: [
          "Choose the selection scope",
          "Pick view elements or a model category",
          "Run the coordinate update",
          "Review updated element results",
        ],
        expectedOutput: [
          "Coordinate parameters staged for the chosen elements",
          "Updated element list displayed",
          "No Revit model changes were made",
        ],
      },
    ],
    fidelityFlags: ["dialog-guided-layout", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
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

function buildPackageCreatorSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "packagecreator-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "pc-project-search", name: "ProjectSearch", kind: "text", label: "Project search", required: false },
      { id: "pc-office", name: "Office", kind: "select", label: "Office", required: true },
      { id: "pc-year-folder", name: "YearFolder", kind: "select", label: "Year folder", required: true },
      { id: "pc-docs-root", name: "ProjectDocsRoot", kind: "text", label: "Project docs root", required: true },
      { id: "pc-model-key", name: "ModelKey", kind: "text", label: "Model key", required: true },
      { id: "pc-sheet-number-param", name: "SheetNumberSource", kind: "text", label: "Sheet number source parameter", required: false },
      { id: "pc-revision-param", name: "RevisionSource", kind: "text", label: "Revision source parameter", required: false },
      { id: "pc-status-table", name: "StatusTable", kind: "table", label: "Stage status", required: false },
      { id: "pc-refresh", name: "Refresh", kind: "button", label: "Refresh", required: false },
      { id: "pc-search", name: "Search", kind: "button", label: "Search", required: false },
      { id: "pc-apply-project", name: "ApplyProject", kind: "button", label: "Apply Project", required: false },
      { id: "pc-apply-rules", name: "ApplyRules", kind: "button", label: "Apply Rules", required: false },
      { id: "pc-run-check", name: "RunCheck", kind: "button", label: "Run Check", required: false },
      { id: "pc-run-full-flow", name: "RunFullFlow", kind: "button", label: "Run Full Flow", required: true },
      { id: "pc-stage-export", name: "StageExport", kind: "button", label: "Stage 4: Export", required: false },
      { id: "pc-stage-create", name: "StageCreate", kind: "button", label: "Stage 5: Create", required: false },
    ],
    events: [
      { controlId: "pc-refresh", event: "click", handler: "refresh" },
      { controlId: "pc-search", event: "click", handler: "search_projects" },
      { controlId: "pc-apply-project", event: "click", handler: "apply_project" },
      { controlId: "pc-apply-rules", event: "click", handler: "apply_rules" },
      { controlId: "pc-run-check", event: "click", handler: "run_check" },
      { controlId: "pc-run-full-flow", event: "click", handler: "run_full_flow" },
      { controlId: "pc-stage-export", event: "click", handler: "run_stage_export" },
      { controlId: "pc-stage-create", event: "click", handler: "run_stage_create" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Project settings must be complete before full flow run." },
      { type: "alert", message: "Simulation complete. No live package creation was performed." },
    ],
    workflow: [
      { step: 1, label: "Refresh and locate project context" },
      { step: 2, label: "Apply project details and naming rules" },
      { step: 3, label: "Run package checks and review status table" },
      { step: 4, label: "Run export and create stages" },
      { step: 5, label: "Run full flow and validate outcomes" },
    ],
    dynamicSources: ["sheets", "parameters"],
    scenarios: [
      {
        id: "packagecreator-training",
        title: "PackageCreator Training Run",
        steps: ["Configure project metadata", "Apply rules", "Run checks", "Run full flow simulation"],
        expectedOutput: ["Checks complete", "Stage status updated", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildParamCopierSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "paramcopier-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "pm-source-category", name: "SourceCategory", kind: "select", label: "Source category", required: true },
      { id: "pm-source-param", name: "SourceParameter", kind: "select", label: "Source parameter", required: true },
      { id: "pm-target-category", name: "TargetCategory", kind: "select", label: "Target category", required: true },
      { id: "pm-target-param", name: "TargetParameter", kind: "select", label: "Target parameter", required: true },
      { id: "pm-copy-mode", name: "CopyMode", kind: "select", label: "Copy mode", required: true },
      { id: "pm-only-selected", name: "OnlySelected", kind: "checkbox", label: "Only selected elements", required: false },
      { id: "pm-preview-table", name: "PreviewTable", kind: "table", label: "Preview mappings", required: false },
      { id: "pm-preview", name: "Preview", kind: "button", label: "Preview", required: false },
      { id: "pm-copy", name: "RunCopy", kind: "button", label: "Copy Parameters", required: true },
      { id: "pm-reset", name: "Reset", kind: "button", label: "Reset", required: false },
    ],
    events: [
      { controlId: "pm-preview", event: "click", handler: "preview_mappings" },
      { controlId: "pm-copy", event: "click", handler: "run_copy" },
      { controlId: "pm-reset", event: "click", handler: "reset_form" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Select source and target parameter mappings first." },
      { type: "alert", message: "Copy simulated. No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Select source category and parameter" },
      { step: 2, label: "Select target category and parameter" },
      { step: 3, label: "Preview mapping values" },
      { step: 4, label: "Run copy simulation and inspect output" },
    ],
    dynamicSources: ["categories", "parameters"],
    scenarios: [
      {
        id: "paramcopier-training",
        title: "ParamCopier Training Run",
        steps: ["Select source/target pairs", "Preview values", "Run copy"],
        expectedOutput: ["Rows evaluated", "Mappings complete", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildSheetNoSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "sheetno-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "sn-scope", name: "Scope", kind: "select", label: "Scope", required: true },
      { id: "sn-sheetset", name: "SheetSet", kind: "select", label: "Sheet set", required: false },
      { id: "sn-param", name: "SheetNumberParam", kind: "select", label: "Sheet number parameter", required: true },
      { id: "sn-prefix", name: "Prefix", kind: "text", label: "Prefix", required: false },
      { id: "sn-suffix", name: "Suffix", kind: "text", label: "Suffix", required: false },
      { id: "sn-table", name: "SheetPreview", kind: "table", label: "Sheet preview", required: false },
      { id: "sn-preview", name: "Preview", kind: "button", label: "Preview Changes", required: false },
      { id: "sn-apply", name: "Apply", kind: "button", label: "Apply Sheet Numbers", required: true },
    ],
    events: [
      { controlId: "sn-preview", event: "click", handler: "preview_sheet_numbers" },
      { controlId: "sn-apply", event: "click", handler: "apply_sheet_numbers" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Select scope and sheet number parameter." },
      { type: "alert", message: "Sheet numbers simulated. No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Pick scope and sheet set" },
      { step: 2, label: "Select target sheet parameter" },
      { step: 3, label: "Preview resulting values" },
      { step: 4, label: "Apply simulation and review summary" },
    ],
    dynamicSources: ["sheets", "parameters"],
    scenarios: [
      {
        id: "sheetno-training",
        title: "SheetNo Training Run",
        steps: ["Configure scope and parameter", "Preview table", "Apply simulation"],
        expectedOutput: ["Sheet rows evaluated", "Formatting rules applied", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildScheduleUpdaterSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "scheduleupdater-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "su-schedule", name: "ScheduleSelector", kind: "select", label: "Schedule", required: true },
      { id: "su-field-search", name: "FieldSearch", kind: "text", label: "Field search", required: false },
      { id: "su-existing-fields", name: "ExistingFields", kind: "multiselect", label: "Existing fields", required: false },
      { id: "su-available-fields", name: "AvailableFields", kind: "multiselect", label: "Available fields", required: false },
      { id: "su-preview", name: "Preview", kind: "table", label: "Field updates preview", required: false },
      { id: "su-refresh", name: "RefreshSchedules", kind: "button", label: "Refresh", required: false },
      { id: "su-add-fields", name: "AddFields", kind: "button", label: "Add Selected Fields", required: true },
      { id: "su-remove-fields", name: "RemoveFields", kind: "button", label: "Remove Selected Fields", required: false },
      { id: "su-apply", name: "ApplyScheduleFields", kind: "button", label: "Apply Updates", required: true },
    ],
    events: [
      { controlId: "su-refresh", event: "click", handler: "refresh_schedules" },
      { controlId: "su-add-fields", event: "click", handler: "add_fields" },
      { controlId: "su-remove-fields", event: "click", handler: "remove_fields" },
      { controlId: "su-apply", event: "click", handler: "apply_updates" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Select schedule and at least one field to add." },
      { type: "alert", message: "Schedule update simulated. No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Select schedule and review current fields" },
      { step: 2, label: "Search and stage additional schedulable fields" },
      { step: 3, label: "Preview resulting field layout" },
      { step: 4, label: "Apply updates and verify summary" },
    ],
    dynamicSources: ["sheets", "parameters"],
    scenarios: [
      {
        id: "scheduleupdater-training",
        title: "Schedule Updater Training Run",
        steps: ["Pick schedule", "Stage fields", "Preview", "Apply simulation"],
        expectedOutput: ["Field updates prepared", "Schedule check complete", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildLinkedViewsSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "linkedviews-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "lv-link-instance", name: "LinkInstance", kind: "select", label: "Revit link instance", required: true },
      { id: "lv-source-view", name: "SourceView", kind: "select", label: "Linked source view", required: true },
      { id: "lv-target-view", name: "TargetView", kind: "select", label: "Host target view", required: true },
      { id: "lv-mode", name: "PlacementMode", kind: "select", label: "Placement mode", required: true },
      { id: "lv-align-crop", name: "AlignCrop", kind: "checkbox", label: "Align crop to linked view extents", required: false },
      { id: "lv-preview", name: "Preview", kind: "table", label: "Linked view preview", required: false },
      { id: "lv-load", name: "LoadViews", kind: "button", label: "Load Linked Views", required: false },
      { id: "lv-preview-btn", name: "PreviewPlacement", kind: "button", label: "Preview Placement", required: false },
      { id: "lv-create", name: "CreateLinkedView", kind: "button", label: "Create / Update", required: true },
    ],
    events: [
      { controlId: "lv-load", event: "click", handler: "load_link_views" },
      { controlId: "lv-preview-btn", event: "click", handler: "preview_link_placement" },
      { controlId: "lv-create", event: "click", handler: "create_or_update_linked_view" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Select link, source view, and target view first." },
      { type: "alert", message: "Linked view simulation complete. No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Select link instance and load eligible linked views" },
      { step: 2, label: "Select source and host target views" },
      { step: 3, label: "Preview placement and alignment mode" },
      { step: 4, label: "Create/update linked view representation" },
    ],
    dynamicSources: ["plan views", "scope boxes"],
    scenarios: [
      {
        id: "linkedviews-training",
        title: "LinkedViews Training Run",
        steps: ["Load linked views", "Set mapping", "Preview placement", "Create/update simulation"],
        expectedOutput: ["Link mapping complete", "Placement preview generated", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildCategoryPickerSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "categorypicker-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "cp-search", name: "CategorySearch", kind: "text", label: "Search categories", required: false },
      { id: "cp-discipline", name: "DisciplineFilter", kind: "select", label: "Discipline filter", required: false },
      { id: "cp-categories", name: "CategoryList", kind: "multiselect", label: "Categories", required: true },
      { id: "cp-select-all", name: "SelectAll", kind: "button", label: "Select All", required: false },
      { id: "cp-clear", name: "ClearSelection", kind: "button", label: "Clear", required: false },
      { id: "cp-apply", name: "ApplySelection", kind: "button", label: "Select Elements", required: true },
    ],
    events: [
      { controlId: "cp-select-all", event: "click", handler: "select_all_categories" },
      { controlId: "cp-clear", event: "click", handler: "clear_category_selection" },
      { controlId: "cp-apply", event: "click", handler: "apply_category_selection" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Select at least one category." },
      { type: "alert", message: "Category selection simulated. No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Search and filter categories" },
      { step: 2, label: "Select one or more categories" },
      { step: 3, label: "Run selection simulation" },
    ],
    dynamicSources: ["categories"],
    scenarios: [
      {
        id: "categorypicker-training",
        title: "CategoryPicker Training Run",
        steps: ["Filter categories", "Select categories", "Apply simulation"],
        expectedOutput: ["Category set resolved", "Selection summary generated", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildReorderViewportsSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "reorderviewports-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "rv-sheet", name: "SheetSelector", kind: "select", label: "Sheet", required: true },
      { id: "rv-list", name: "ViewportList", kind: "table", label: "Viewport order", required: false },
      { id: "rv-up", name: "MoveUp", kind: "button", label: "Move Up", required: false },
      { id: "rv-down", name: "MoveDown", kind: "button", label: "Move Down", required: false },
      { id: "rv-auto", name: "AutoSort", kind: "button", label: "Auto Sort", required: false },
      { id: "rv-apply", name: "ApplyOrder", kind: "button", label: "Apply Viewport Order", required: true },
    ],
    events: [
      { controlId: "rv-up", event: "click", handler: "move_viewport_up" },
      { controlId: "rv-down", event: "click", handler: "move_viewport_down" },
      { controlId: "rv-auto", event: "click", handler: "auto_sort_viewports" },
      { controlId: "rv-apply", event: "click", handler: "apply_viewport_order" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Select a sheet and one or more viewport rows." },
      { type: "alert", message: "Viewport reorder simulated. No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Select sheet and load viewport list" },
      { step: 2, label: "Reorder rows manually or by auto-sort" },
      { step: 3, label: "Apply viewport order simulation" },
    ],
    dynamicSources: ["sheets"],
    scenarios: [
      {
        id: "reorderviewports-training",
        title: "Reorder Viewports Training Run",
        steps: ["Select sheet", "Reorder viewports", "Apply simulation"],
        expectedOutput: ["Viewport order recalculated", "Placement order applied", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildCopyStateSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "copystate-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "cs-search", name: "ActionSearch", kind: "text", label: "Search actions", required: false },
      { id: "cs-actions", name: "ActionList", kind: "multiselect", label: "Actions to copy", required: true },
      { id: "cs-select-all", name: "SelectAll", kind: "button", label: "Select All", required: false },
      { id: "cs-clear-all", name: "ClearAll", kind: "button", label: "Clear All", required: false },
      { id: "cs-memory", name: "MemorySlots", kind: "table", label: "Memory slots", required: false },
      { id: "cs-preview", name: "PreviewPayload", kind: "button", label: "Preview Memory Payload", required: false },
      { id: "cs-copy", name: "CopyToMemory", kind: "button", label: "Copy to Memory", required: true },
    ],
    events: [
      { controlId: "cs-select-all", event: "click", handler: "select_all_actions" },
      { controlId: "cs-clear-all", event: "click", handler: "clear_all_actions" },
      { controlId: "cs-preview", event: "click", handler: "preview_memory_payload" },
      { controlId: "cs-copy", event: "click", handler: "copy_state_to_memory" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Select at least one state action." },
      { type: "alert", message: "State copied to memory (simulated). No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Select one or more copy actions" },
      { step: 2, label: "Review memory slot payload" },
      { step: 3, label: "Run copy-to-memory simulation" },
    ],
    dynamicSources: ["views", "filters"],
    scenarios: [
      {
        id: "copystate-training",
        title: "Copy State Training Run",
        steps: ["Pick copy actions", "Preview payload", "Copy to memory"],
        expectedOutput: ["Action memory stored", "Slot status updated", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildPropagateExtentsOverrideSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "propagateextentsoverride-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "pe-host-search", name: "HostSearch", kind: "text", label: "Search host view", required: false },
      { id: "pe-host-type", name: "HostViewType", kind: "select", label: "Host view type", required: false },
      { id: "pe-host-view", name: "HostView", kind: "select", label: "Host view", required: true },
      { id: "pe-use-host", name: "UseHost", kind: "button", label: "Use Selected Host View", required: false },
      { id: "pe-target-search", name: "TargetSearch", kind: "text", label: "Search target views", required: false },
      { id: "pe-target-type", name: "TargetViewType", kind: "select", label: "Target view type", required: false },
      { id: "pe-target-views", name: "TargetViews", kind: "multiselect", label: "Target views", required: true },
      { id: "pe-check-all", name: "CheckAll", kind: "button", label: "Check All", required: false },
      { id: "pe-uncheck-all", name: "UncheckAll", kind: "button", label: "Uncheck All", required: false },
      { id: "pe-toggle-all", name: "ToggleAll", kind: "button", label: "Toggle All", required: false },
      { id: "pe-run", name: "RunPropagation", kind: "button", label: "Propagate Grid + Level Extents", required: true },
    ],
    events: [
      { controlId: "pe-use-host", event: "click", handler: "select_host_view" },
      { controlId: "pe-check-all", event: "click", handler: "check_all_targets" },
      { controlId: "pe-uncheck-all", event: "click", handler: "uncheck_all_targets" },
      { controlId: "pe-toggle-all", event: "click", handler: "toggle_targets" },
      { controlId: "pe-run", event: "click", handler: "propagate_grid_and_level_extents" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Select a host view and one or more target views." },
      { type: "alert", message: "Propagation simulated. No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Choose host view with search + view-type filters" },
      { step: 2, label: "Select target views and bulk-check selections" },
      { step: 3, label: "Run extent propagation simulation" },
    ],
    dynamicSources: ["plan views", "levels"],
    scenarios: [
      {
        id: "propagate-extents-training",
        title: "Propagate Extents Override Training Run",
        steps: ["Select host", "Select targets", "Run propagation"],
        expectedOutput: ["Target crop override simulated", "Grid/level extents propagated", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildCloudRevisionsSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "cloudrevisions-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "cr-sheet-filter", name: "SheetFilter", kind: "text", label: "Sheet filter", required: false },
      { id: "cr-cloud-only", name: "CloudOnlyList", kind: "table", label: "Cloud-only list", required: false },
      { id: "cr-both", name: "CloudAndManualList", kind: "table", label: "Cloud and manual list", required: false },
      { id: "cr-manual-only", name: "ManualOnlyList", kind: "table", label: "Manual-only list", required: false },
      { id: "cr-refresh", name: "RefreshRevisions", kind: "button", label: "Refresh Revisions", required: false },
      { id: "cr-report", name: "GenerateReport", kind: "button", label: "Generate Classification Report", required: true },
    ],
    events: [
      { controlId: "cr-refresh", event: "click", handler: "refresh_revision_sets" },
      { controlId: "cr-report", event: "click", handler: "generate_revision_report" },
    ],
    prompts: [
      { type: "alert", message: "Revision report generated (simulated)." },
    ],
    workflow: [
      { step: 1, label: "Collect revision clouds and sheet revision ids" },
      { step: 2, label: "Classify each sheet/revision pair into 3 lists" },
      { step: 3, label: "Generate and review report output" },
    ],
    dynamicSources: ["sheets"],
    scenarios: [
      {
        id: "cloudrevisions-training",
        title: "Cloud Revisions Training Run",
        steps: ["Refresh revision data", "Generate report", "Review list buckets"],
        expectedOutput: ["Cloud-only bucket listed", "Cloud+manual bucket listed", "Manual-only bucket listed"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "medium",
    },
  };
}

function buildElementsByLevelSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "elementsbylevel-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "ebl-level", name: "LevelSelector", kind: "select", label: "Level", required: true },
      { id: "ebl-search", name: "CategorySearch", kind: "text", label: "Category search", required: false },
      { id: "ebl-categories", name: "CategorySelection", kind: "multiselect", label: "Categories", required: true },
      { id: "ebl-include-view-specific", name: "IncludeViewSpecific", kind: "checkbox", label: "Include view-specific elements", required: false },
      { id: "ebl-include-annotation", name: "IncludeAnnotation", kind: "checkbox", label: "Include annotation categories", required: false },
      { id: "ebl-table", name: "ElementReportRows", kind: "table", label: "Element report rows", required: false },
      { id: "ebl-select-all", name: "SelectAllElements", kind: "button", label: "Select All Elements", required: false },
      { id: "ebl-list", name: "ListElements", kind: "button", label: "List Elements by Level", required: true },
    ],
    events: [
      { controlId: "ebl-select-all", event: "click", handler: "select_all_categories" },
      { controlId: "ebl-list", event: "click", handler: "list_elements_for_level" },
    ],
    prompts: [
      { type: "alert", message: "Validation failed. Select at least one category before listing elements." },
      { type: "alert", message: "Elements listed (simulated). No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Choose level and category filters" },
      { step: 2, label: "Apply optional include-view-specific/annotation toggles" },
      { step: 3, label: "Generate grouped element report" },
    ],
    dynamicSources: ["levels", "categories"],
    scenarios: [
      {
        id: "elements-by-level-training",
        title: "Elements by Level Training Run",
        steps: ["Choose level", "Select categories", "Run list report"],
        expectedOutput: ["Elements grouped by category", "Type names listed", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "screenshot-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildDashboardSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "dashboard-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "dash-filter-all", name: "AllFilterButton", kind: "button", label: "All", required: false },
      { id: "dash-filter-favorites", name: "FavoritesFilterButton", kind: "button", label: "Starred", required: false },
      { id: "dash-filter-recent", name: "RecentFilterButton", kind: "button", label: "Recent", required: false },
      { id: "dash-search", name: "SearchBox", kind: "text", label: "Search", required: false },
      { id: "dash-groups", name: "GroupTree", kind: "tree", label: "Groups", required: false },
      { id: "dash-cards", name: "CardGrid", kind: "table", label: "Tool cards", required: false },
      { id: "dash-toggle-favorite", name: "FavoriteButton", kind: "button", label: "Toggle Favorite", required: false },
      { id: "dash-launch", name: "QuickLaunch", kind: "button", label: "Quick Launch", required: true },
    ],
    events: [
      { controlId: "dash-filter-all", event: "click", handler: "show_all_click" },
      { controlId: "dash-filter-favorites", event: "click", handler: "show_favorites_click" },
      { controlId: "dash-filter-recent", event: "click", handler: "show_recent_click" },
      { controlId: "dash-search", event: "change", handler: "search_changed" },
      { controlId: "dash-launch", event: "click", handler: "launch_selected_tool" },
    ],
    prompts: [
      { type: "alert", message: "Select a dashboard card before launching or toggling favorites." },
    ],
    workflow: [
      { step: 1, label: "Filter by all, starred, recent, or group categories" },
      { step: 2, label: "Search the shared card catalog and review card summaries" },
      { step: 3, label: "Inspect the selected tool detail panel" },
      { step: 4, label: "Quick-launch the staged tool from the dashboard" },
    ],
    dynamicSources: [],
    scenarios: [
      {
        id: "dashboard-training",
        title: "Dashboard Training Run",
        steps: ["Filter catalog", "Select tool card", "Inspect detail panel", "Quick launch"],
        expectedOutput: ["Tool cards narrowed", "Selected tool summary shown", "No pyRevit process was started"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "xaml-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "medium",
    },
  };
}

function buildTransactionLoggerSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "transactionlogger-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "tl-mode", name: "CaptureMode", kind: "radio", label: "Capture mode", required: true },
      { id: "tl-categories", name: "CategoryList", kind: "multiselect", label: "Categories", required: false },
      { id: "tl-snapshot", name: "SnapshotMode", kind: "select", label: "Snapshot mode", required: true },
      { id: "tl-output", name: "OutputPath", kind: "text", label: "Output path", required: true },
      { id: "tl-session", name: "SessionPreview", kind: "table", label: "Session preview", required: false },
      { id: "tl-start", name: "StartLogging", kind: "button", label: "Start Logging", required: true },
      { id: "tl-cancel", name: "Cancel", kind: "button", label: "Cancel", required: false },
    ],
    events: [
      { controlId: "tl-mode", event: "change", handler: "capture_mode_changed" },
      { controlId: "tl-start", event: "click", handler: "start_logging" },
      { controlId: "tl-cancel", event: "click", handler: "cancel" },
    ],
    prompts: [
      { type: "alert", message: "Choose at least one category when targeted capture mode is enabled." },
      { type: "alert", message: "Logger setup simulated. No live CSV capture was started." },
    ],
    workflow: [
      { step: 1, label: "Choose full-model or targeted category capture" },
      { step: 2, label: "Set the snapshot mode and confirm the log output path" },
      { step: 3, label: "Start the simulated logger session and review readiness" },
    ],
    dynamicSources: ["categories"],
    scenarios: [
      {
        id: "transaction-logger-training",
        title: "Transaction Logger Training Run",
        steps: ["Pick capture mode", "Configure snapshot mode", "Start logging"],
        expectedOutput: ["Mode recorded", "Output path confirmed", "No live logger was started"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "xaml-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildPlanViewRangeSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "planviewrange-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "pvr-plan-a", name: "PlanA", kind: "select", label: "Plan A", required: true },
      { id: "pvr-plan-b", name: "PlanB", kind: "select", label: "Plan B", required: true },
      { id: "pvr-template-aware", name: "TemplateAware", kind: "checkbox", label: "Respect template control", required: false },
      { id: "pvr-comparison", name: "ComparisonTable", kind: "table", label: "Comparison rows", required: false },
      { id: "pvr-targets", name: "Targets", kind: "multiselect", label: "Targets", required: true },
      { id: "pvr-compare", name: "Compare", kind: "button", label: "Compare", required: false },
      { id: "pvr-swap", name: "SwapAB", kind: "button", label: "Swap A/B", required: false },
      { id: "pvr-copy", name: "CopyViewRange", kind: "button", label: "Copy View Range", required: true },
    ],
    events: [
      { controlId: "pvr-compare", event: "click", handler: "compare_view_ranges" },
      { controlId: "pvr-swap", event: "click", handler: "swap_plan_inputs" },
      { controlId: "pvr-copy", event: "click", handler: "copy_view_ranges" },
    ],
    prompts: [
      { type: "alert", message: "Select at least one target before running the copy simulation." },
    ],
    workflow: [
      { step: 1, label: "Choose the two plan views to compare" },
      { step: 2, label: "Review live view range differences across all planes" },
      { step: 3, label: "Stage one or more target views for copy" },
      { step: 4, label: "Run the copy simulation and inspect the summary" },
    ],
    dynamicSources: ["plan views"],
    scenarios: [
      {
        id: "plan-view-range-training",
        title: "Plan View Range Training Run",
        steps: ["Choose plans", "Compare rows", "Select targets", "Copy simulation"],
        expectedOutput: ["Differences highlighted", "Targets staged", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "xaml-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildScopeBoxViewCreationSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "scopeboxviewcreation-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "svc-mode", name: "SourceMode", kind: "select", label: "Source mode", required: true },
      { id: "svc-plan", name: "PlanView", kind: "select", label: "Plan view", required: true },
      { id: "svc-scope", name: "ScopeBox", kind: "select", label: "Scope box", required: true },
      { id: "svc-titleblock", name: "Titleblock", kind: "select", label: "Titleblock", required: false },
      { id: "svc-stage1", name: "Stage1ViewNames", kind: "table", label: "Stage 1 view names", required: false },
      { id: "svc-sheet-preview", name: "SheetPreview", kind: "table", label: "Sheet layout preview", required: false },
      { id: "svc-load", name: "LoadScopeBoxes", kind: "button", label: "Load Scope Boxes", required: false },
      { id: "svc-stage-names", name: "ApplyViewNames", kind: "button", label: "Apply View Names", required: true },
      { id: "svc-create", name: "CreateLayout", kind: "button", label: "Create + Layout Views", required: true },
    ],
    events: [
      { controlId: "svc-load", event: "click", handler: "load_scope_boxes" },
      { controlId: "svc-stage-names", event: "click", handler: "apply_view_names" },
      { controlId: "svc-create", event: "click", handler: "run_sheet_layout" },
    ],
    prompts: [
      { type: "alert", message: "Review warning rows before creating sheet layouts." },
      { type: "alert", message: "View creation and sheet layout simulated. No Revit model changes were made." },
    ],
    workflow: [
      { step: 1, label: "Choose creator or selector source mode" },
      { step: 2, label: "Load scope boxes and plan context for the selected stage" },
      { step: 3, label: "Edit generated plan/section names in Stage 1" },
      { step: 4, label: "Preview sheet layout rows and review warnings" },
      { step: 5, label: "Run the combined create-and-layout simulation" },
    ],
    dynamicSources: ["plan views", "scope boxes", "sheets"],
    scenarios: [
      {
        id: "scope-box-view-creation-training",
        title: "Scope Box View Creation Training Run",
        steps: ["Choose source mode", "Load scope boxes", "Stage view names", "Create layout simulation"],
        expectedOutput: ["View names prepared", "Sheet layout preview shown", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "xaml-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildViewFilterEditorSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "viewfiltereditor-high-fidelity",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "vfe-search", name: "SearchBox", kind: "text", label: "Search", required: false },
      { id: "vfe-show", name: "ViewFilterBox", kind: "select", label: "Show", required: false },
      { id: "vfe-rows", name: "FilterRows", kind: "table", label: "Filter rows", required: false },
      { id: "vfe-enabled", name: "Enabled", kind: "checkbox", label: "Enabled", required: false },
      { id: "vfe-visible", name: "Visible", kind: "checkbox", label: "Visible", required: false },
      { id: "vfe-halftone", name: "Halftone", kind: "checkbox", label: "Halftone", required: false },
      { id: "vfe-transparency", name: "Transparency", kind: "text", label: "Transparency", required: false },
      { id: "vfe-pattern", name: "Pattern", kind: "select", label: "Projection pattern", required: false },
      { id: "vfe-stage", name: "StageChanges", kind: "button", label: "Stage Changes", required: true },
      { id: "vfe-apply", name: "ApplyBtn", kind: "button", label: "Apply to Revit", required: true },
    ],
    events: [
      { controlId: "vfe-search", event: "change", handler: "search_changed" },
      { controlId: "vfe-stage", event: "click", handler: "stage_changes" },
      { controlId: "vfe-apply", event: "click", handler: "apply_filter_overrides" },
    ],
    prompts: [
      { type: "alert", message: "Select a row before staging filter override changes." },
      { type: "alert", message: "Only dirty rows are applied by the real tool. This run is simulated only." },
    ],
    workflow: [
      { step: 1, label: "Browse View Templates or Views and search for target filters" },
      { step: 2, label: "Select a row to load its per-view override editor" },
      { step: 3, label: "Stage changes for visibility, patterns, transparency, and halftone" },
      { step: 4, label: "Apply the dirty rows through the simulator summary" },
    ],
    dynamicSources: [],
    scenarios: [
      {
        id: "view-filter-editor-training",
        title: "View Filter Editor Training Run",
        steps: ["Search filters", "Select row", "Stage changes", "Apply simulation"],
        expectedOutput: ["Dirty rows tracked", "Apply summary shown", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "xaml-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "high",
    },
  };
}

function buildWpfTemplateSimulatorModel(tool, uiKind) {
  return {
    toolId: tool.id,
    profile: "wpftemplate-reference",
    uiKind,
    sourceType: tool.uiMockup.sourceType,
    xamlFiles: tool.uiMockup.fileNames || [],
    sourceKinds: tool.uiMockup.sourceKinds || [],
    controls: [
      { id: "wpf-steps", name: "WizardStepBar", kind: "tabs", label: "Reference steps", required: false },
      { id: "wpf-components", name: "ComponentCards", kind: "table", label: "Component cards", required: false },
      { id: "wpf-copy-shell", name: "CopyStarterShell", kind: "button", label: "Copy Starter Skeleton", required: false },
      { id: "wpf-mark-reviewed", name: "MarkReviewed", kind: "button", label: "Mark Reviewed", required: false },
    ],
    events: [
      { controlId: "wpf-copy-shell", event: "click", handler: "copy_starter_shell" },
      { controlId: "wpf-mark-reviewed", event: "click", handler: "mark_reviewed" },
    ],
    prompts: [
      { type: "alert", message: "Reference review only. This tool should not modify the Revit model." },
    ],
    workflow: [
      { step: 1, label: "Review the canonical shell, toolbar, and badge patterns" },
      { step: 2, label: "Inspect approved controls, cards, chips, and table treatments" },
      { step: 3, label: "Use the checklist to guide new WPF tool implementations" },
    ],
    dynamicSources: [],
    scenarios: [
      {
        id: "wpf-template-reference",
        title: "WPF Template Reference Run",
        steps: ["Review shell", "Inspect controls", "Confirm checklist"],
        expectedOutput: ["Approved patterns listed", "Checklist reviewed", "No Revit model changes were made"],
      },
    ],
    fidelityFlags: ["high-fidelity-template-applied", "xaml-guided-layout"],
    confidence: {
      controls: "high",
      workflow: "high",
      prompts: "medium",
    },
  };
}

function buildSimulatorModel(tool) {
  const uiKind = inferUiKind(tool);

  if (isAddCoordinatesTool(tool)) {
    return buildAddCoordinatesSimulatorModel(tool, uiKind);
  }
  if (isSectionUpdaterTool(tool)) {
    return buildSectionUpdaterSimulatorModel(tool, uiKind);
  }
  if (isPackageCreatorTool(tool)) {
    return buildPackageCreatorSimulatorModel(tool, uiKind);
  }
  if (isParamCopierTool(tool)) {
    return buildParamCopierSimulatorModel(tool, uiKind);
  }
  if (isSheetNoTool(tool)) {
    return buildSheetNoSimulatorModel(tool, uiKind);
  }
  if (isScheduleUpdaterTool(tool)) {
    return buildScheduleUpdaterSimulatorModel(tool, uiKind);
  }
  if (isLinkedViewsTool(tool)) {
    return buildLinkedViewsSimulatorModel(tool, uiKind);
  }
  if (isCategoryPickerTool(tool)) {
    return buildCategoryPickerSimulatorModel(tool, uiKind);
  }
  if (isReorderViewportsTool(tool)) {
    return buildReorderViewportsSimulatorModel(tool, uiKind);
  }
  if (isCopyStateTool(tool)) {
    return buildCopyStateSimulatorModel(tool, uiKind);
  }
  if (isPropagateExtentsOverrideTool(tool)) {
    return buildPropagateExtentsOverrideSimulatorModel(tool, uiKind);
  }
  if (isCloudRevisionsTool(tool)) {
    return buildCloudRevisionsSimulatorModel(tool, uiKind);
  }
  if (isElementsByLevelTool(tool)) {
    return buildElementsByLevelSimulatorModel(tool, uiKind);
  }
  if (isDashboardTool(tool)) {
    return buildDashboardSimulatorModel(tool, uiKind);
  }
  if (isTransactionLoggerTool(tool)) {
    return buildTransactionLoggerSimulatorModel(tool, uiKind);
  }
  if (isPlanViewRangeTool(tool)) {
    return buildPlanViewRangeSimulatorModel(tool, uiKind);
  }
  if (isScopeBoxViewCreationTool(tool)) {
    return buildScopeBoxViewCreationSimulatorModel(tool, uiKind);
  }
  if (isViewFilterEditorTool(tool)) {
    return buildViewFilterEditorSimulatorModel(tool, uiKind);
  }
  if (isWpfTemplateTool(tool)) {
    return buildWpfTemplateSimulatorModel(tool, uiKind);
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

  const workflowSource = Array.isArray(tool.workflowSteps) && tool.workflowSteps.length
    ? tool.workflowSteps
    : (tool.uiMockup.workflowStages || []);
  const workflow = workflowSource.map((stage, index) => ({
    step: index + 1,
    label: String(stage),
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
    profile: tool.uiMockup.sourceType === "xaml" ? "xaml-inferred-layout" : undefined,
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
        name: "pyRevit Course Library",
        status: "Active",
        url: "https://robert-bird-group.github.io/SJ-trAIning/index.html",
        screenshot: "docs/assets/web/pyrevit-tools-wiki.png",
        docUrl: "./tools/web-pyrevit-course-library.html",
        info: "GitHub Pages site for pyRevit training and course material.",
      },
      {
        name: "pyRevit Tools Wiki",
        status: "Active",
        url: "./index.html",
        screenshot: "docs/assets/web/pyrevit-tools-wiki.png",
        docUrl: "./tools/web-pyrevit-tools-wiki.html",
        info: "Current static documentation and simulator site for internal tools.",
      },
      {
        name: "Issue Package Dashboard",
        status: "Planned",
        url: "https://example.internal/issue-dashboard",
        screenshot: "docs/assets/web/issue-dashboard.png",
        docUrl: "./tools/web-issue-package-dashboard.html",
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
      workflow: [],
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

    const pythonDocInfo = extractPythonDocInfo(pyFiles);
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
    const purposeText = contextInfo.purpose || pythonDocInfo.description || "Purpose not documented in tool-context.md.";
    const workflowSteps = contextInfo.workflow.length ? contextInfo.workflow : pythonDocInfo.howToSteps;

    const notes = dedupe([
      contextInfo.constraints,
      contextInfo.notes,
      ...pythonDocInfo.todoItems,
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
      workflowSteps,
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

  const matchedScreenshotPaths = new Set(
    tools.flatMap((tool) => (tool.screenshots || []).map((shot) => shot.localPath))
  );
  const orphanScreenshots = screenshotFiles
    .filter((shot) => !matchedScreenshotPaths.has(shot.localPath))
    .map((shot) => ({
      fileName: shot.fileName,
      localPath: shot.localPath,
      tabFolder: shot.tabFolder,
      normalizedName: shot.normalizedName,
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  return {
    tools,
    tree: treeData,
    screenshotDiagnostics: {
      total: screenshotFiles.length,
      matched: matchedScreenshotPaths.size,
      orphanCount: orphanScreenshots.length,
      orphanScreenshots,
    },
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
    screenshots: payload.meta.screenshotDiagnostics || {
      total: 0,
      matched: 0,
      orphanCount: 0,
      orphanScreenshots: [],
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
      return `<tr><td>${escapeHtml(app.name || "")}</td><td>${escapeHtml(app.status || "")}</td><td>${releaseCell}</td><td>${repoCell}</td><td>${escapeHtml(app.screenshot || "")}</td><td>${escapeHtml(app.info || "")}</td><td>${docLinkCell(app.docUrl || app.wikiUrl)}</td></tr>`;
    })
    .join("");

  const webRows = (hub.webApps || [])
    .map((app) => `<tr><td>${escapeHtml(app.name || "")}</td><td>${escapeHtml(app.status || "")}</td><td><a href="${escapeHtml(app.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(app.url || "")}</a></td><td>${escapeHtml(app.screenshot || "")}</td><td>${escapeHtml(app.info || "")}</td><td>${docLinkCell(app.docUrl || app.wikiUrl)}</td></tr>`)
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
          <span class="card-hint">Track desktop helpers, plus user-added apps via wizard</span>
          <a class="space-home-link" href="#home">Back to Home</a>
        </div>
        <div class="card-body sim-table-wrap">
          <div class="hub-actions">
            <button type="button" class="hub-action-btn" id="add-windows-app-btn">Add Windows App</button>
            <button type="button" class="hub-action-btn hub-action-btn-secondary" id="clear-windows-custom-btn">Reset Custom Windows Apps</button>
          </div>
          <table>
            <thead><tr><th>App</th><th>Status</th><th>Release / executable</th><th>Repository</th><th>Screenshot</th><th>Information</th><th>Wiki</th></tr></thead>
            <tbody id="windows-apps-body">${windowsRows}</tbody>
          </table>
        </div>
      </section>

      <section class="card" id="web-apps-section" data-space="web">
        <div class="card-head">
          <span class="card-title">Web-based Apps Catalog</span>
          <span class="card-hint">Track web tools, plus user-added apps via wizard</span>
          <a class="space-home-link" href="#home">Back to Home</a>
        </div>
        <div class="card-body sim-table-wrap">
          <div class="hub-actions">
            <button type="button" class="hub-action-btn" id="add-web-app-btn">Add Web App</button>
          </div>
          <table>
            <thead><tr><th>App</th><th>Status</th><th>Hyperlink</th><th>Screenshot</th><th>Information</th><th>Wiki</th></tr></thead>
            <tbody id="web-apps-body">${webRows}</tbody>
          </table>
        </div>
      </section>

      <div class="wizard-backdrop" id="app-wizard-modal" hidden>
        <div class="wizard-dialog" role="dialog" aria-modal="true" aria-labelledby="app-wizard-title">
          <div class="wizard-head">
            <div class="wizard-head-copy">
              <p class="wizard-kicker">Catalog Editor</p>
              <h3 id="app-wizard-title">Add App</h3>
              <p class="wizard-intro">Add a Windows App or Web App using the same design language as the wiki catalog.</p>
            </div>
            <button type="button" class="wizard-close" id="app-wizard-close" aria-label="Close wizard">×</button>
          </div>
          <form id="app-wizard-form" class="wizard-form">
            <p class="wizard-step">Step 1 · App metadata</p>
            <label class="wizard-field">
              <span>App Type</span>
              <select id="wizard-app-type" required>
                <option value="windows">Windows App</option>
                <option value="web">Web App</option>
              </select>
            </label>
            <label class="wizard-field">
              <span>App Name</span>
              <input id="wizard-name" type="text" required maxlength="120" placeholder="e.g. Drawing QA Assistant" />
            </label>
            <label class="wizard-field">
              <span>Status</span>
              <select id="wizard-status" required>
                <option value="Active">Active</option>
                <option value="Planned">Planned</option>
                <option value="Draft">Draft</option>
                <option value="Archived">Archived</option>
              </select>
            </label>
            <label class="wizard-field wizard-span-full">
              <span>Screenshot Path (optional)</span>
              <input id="wizard-screenshot" type="text" maxlength="240" placeholder="docs/assets/windows/example.png" />
            </label>
            <label class="wizard-field wizard-span-full">
              <span>Information</span>
              <textarea id="wizard-info" required rows="3" maxlength="500" placeholder="Short summary of what this app does and who should use it."></textarea>
            </label>
            <div id="wizard-windows-fields" class="wizard-subgrid wizard-span-full">
              <label class="wizard-field">
                <span>Release / Executable URL or Path</span>
                <input id="wizard-release" type="text" maxlength="240" placeholder="https://... or C:/Apps/Tool/Tool.exe" />
              </label>
              <label class="wizard-field">
                <span>Repository URL</span>
                <input id="wizard-repo" type="url" maxlength="240" placeholder="https://github.com/org/repo" />
              </label>
            </div>
            <div id="wizard-web-fields" class="wizard-subgrid wizard-span-full">
              <label class="wizard-field wizard-span-full">
                <span>App URL</span>
                <input id="wizard-url" type="url" maxlength="240" placeholder="https://example.com/app" />
              </label>
            </div>
            <label class="wizard-field wizard-span-full">
              <span>Wiki URL (optional)</span>
              <input id="wizard-doc" type="text" maxlength="240" placeholder="./tools/custom-app-wiki.html" />
            </label>
            <label class="wizard-field wizard-span-full wizard-check">
              <span><input id="wizard-generate-template" type="checkbox" checked /> Generate wiki template (.html download)</span>
            </label>
            <p class="wizard-note wizard-span-full">Saved apps are stored in this browser only and appear immediately in the catalog tables.</p>
            <div class="wizard-actions wizard-span-full">
              <button type="button" class="wizard-btn wizard-btn-secondary" id="app-wizard-cancel">Cancel</button>
              <button type="submit" class="wizard-btn">Save App</button>
            </div>
          </form>
        </div>
      </div>

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
      const windowsAppsBody = document.getElementById("windows-apps-body");
      const webAppsBody = document.getElementById("web-apps-body");
      const addWindowsAppBtn = document.getElementById("add-windows-app-btn");
      const addWebAppBtn = document.getElementById("add-web-app-btn");
      const clearWindowsCustomBtn = document.getElementById("clear-windows-custom-btn");
      const appWizardModal = document.getElementById("app-wizard-modal");
      const appWizardClose = document.getElementById("app-wizard-close");
      const appWizardCancel = document.getElementById("app-wizard-cancel");
      const appWizardForm = document.getElementById("app-wizard-form");
      const wizardType = document.getElementById("wizard-app-type");
      const wizardWindowsFields = document.getElementById("wizard-windows-fields");
      const wizardWebFields = document.getElementById("wizard-web-fields");
      const wizardName = document.getElementById("wizard-name");
      const wizardStatus = document.getElementById("wizard-status");
      const wizardScreenshot = document.getElementById("wizard-screenshot");
      const wizardInfo = document.getElementById("wizard-info");
      const wizardRelease = document.getElementById("wizard-release");
      const wizardRepo = document.getElementById("wizard-repo");
      const wizardUrl = document.getElementById("wizard-url");
      const wizardDoc = document.getElementById("wizard-doc");
      const wizardGenerateTemplate = document.getElementById("wizard-generate-template");

      const CUSTOM_APPS_KEY = "comp-design-wiki.custom-apps.v1";
      const baseWindowsApps = DATA.hub && Array.isArray(DATA.hub.windowsApps) ? DATA.hub.windowsApps.slice() : [];
      const baseWebApps = DATA.hub && Array.isArray(DATA.hub.webApps) ? DATA.hub.webApps.slice() : [];
      const customApps = loadCustomApps();

      const spaceState = {
        current: "home",
      };

      const spaceBlocks = Array.from(document.querySelectorAll("[data-space]"));

      function textIncludes(haystack, needle) {
        return haystack.toLowerCase().includes(needle.toLowerCase());
      }

      function escapeHtmlText(value) {
        return String(value || "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function isHttpUrl(value) {
        const normalized = String(value || "").trim().toLowerCase();
        return normalized.startsWith("http://") || normalized.startsWith("https://");
      }

      function slugifyName(value) {
        return String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .replace(/-{2,}/g, "-")
          .slice(0, 80);
      }

      function buildWikiTemplateHtml(appType, appData) {
        const appTypeLabel = appType === "windows" ? "Windows App" : "Web App";
        const hrefLabel = appType === "windows" ? "Release / Executable" : "App URL";
        const hrefValue = appType === "windows" ? String(appData.releaseUrl || "").trim() : String(appData.url || "").trim();
        const lines = [
          '<!doctype html>',
          '<html lang="en">',
          '  <head>',
          '    <meta charset="UTF-8" />',
          '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
          '    <title>' + escapeHtmlText(appData.name) + ' | ' + appTypeLabel + ' Wiki</title>',
          '    <link rel="stylesheet" href="../styles.css" />',
          '  </head>',
          '  <body>',
          '    <div class="topbar">',
          '      <span class="topbar-title">Comp Design Wiki</span>',
          '      <span class="topbar-badge">' + appTypeLabel + ' Wiki</span>',
          '      <span class="topbar-tag">v1</span>',
          '    </div>',
          '',
          '    <div class="page">',
          '      <div class="part">',
          '        <span class="part-num">' + appTypeLabel + '</span>',
          '        <span class="part-title">' + escapeHtmlText(appData.name) + '</span>',
          '        <span class="part-rule"></span>',
          '      </div>',
          '',
          '      <div class="priority-card">',
          '        <strong>Status:</strong> ' + escapeHtmlText(appData.status || 'Active') + ' · <strong>Type:</strong> ' + appTypeLabel + ' ·',
          '        <strong>' + hrefLabel + ':</strong> ' + (hrefValue ? '<a href="' + escapeHtmlText(hrefValue) + '" target="_blank" rel="noopener noreferrer">' + escapeHtmlText(hrefValue) + '</a>' : 'TBD'),
          '      </div>',
          '',
          '      <div class="wiki-article-layout">',
          '        <main class="wiki-article-main">',
          '          <section class="card wiki-section" id="overview">',
          '            <div class="card-head"><span class="card-title">Overview</span></div>',
          '            <div class="card-body wiki-body">',
          '              <a class="back-link" href="../index.html#space-' + (appType === 'windows' ? 'windows' : 'web') + '">← Back to ' + (appType === 'windows' ? 'Windows Apps' : 'Web Apps') + '</a>',
          '              <p class="lede">' + escapeHtmlText(appData.info || 'Add app summary.') + '</p>',
          '            </div>',
          '          </section>',
          '          <section class="card wiki-section" id="workflow">',
          '            <div class="card-head"><span class="card-title">Workflow</span></div>',
          '            <div class="card-body wiki-body"><p>Describe how users run this app step-by-step.</p></div>',
          '          </section>',
          '          <section class="card wiki-section" id="functions">',
          '            <div class="card-head"><span class="card-title">Key Functions</span></div>',
          '            <div class="card-body wiki-body"><p>List the core features and behaviors.</p></div>',
          '          </section>',
          '          <section class="card wiki-section" id="notes">',
          '            <div class="card-head"><span class="card-title">Notes</span></div>',
          '            <div class="card-body wiki-body"><p>Add dependencies, known limitations, and support links.</p></div>',
          '          </section>',
          '        </main>',
          '',
          '        <aside class="wiki-rail" aria-label="Page progress">',
          '          <h3>On This Page</h3>',
          '          <nav class="wiki-toc">',
          '            <a class="wiki-toc-link" href="#overview">Overview</a>',
          '            <a class="wiki-toc-link" href="#workflow">Workflow</a>',
          '            <a class="wiki-toc-link" href="#functions">Key Functions</a>',
          '            <a class="wiki-toc-link" href="#notes">Notes</a>',
          '          </nav>',
          '        </aside>',
          '      </div>',
          '    </div>',
          '  </body>',
          '</html>',
          '',
        ];
        return lines.join("\\n");
      }

      function triggerTemplateDownload(fileName, content) {
        const blob = new Blob([content], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      function loadCustomApps() {
        const initial = { windows: [], web: [] };
        try {
          const raw = window.localStorage.getItem(CUSTOM_APPS_KEY);
          if (!raw) return initial;
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object") return initial;
          return {
            windows: Array.isArray(parsed.windows) ? parsed.windows : [],
            web: Array.isArray(parsed.web) ? parsed.web : [],
          };
        } catch (error) {
          console.warn("Unable to load custom apps from localStorage.", error);
          return initial;
        }
      }

      function persistCustomApps() {
        try {
          window.localStorage.setItem(CUSTOM_APPS_KEY, JSON.stringify(customApps));
        } catch (error) {
          console.warn("Unable to persist custom apps to localStorage.", error);
        }
      }

      function getWindowsApps() {
        return baseWindowsApps.concat(customApps.windows);
      }

      function getWebApps() {
        return baseWebApps.concat(customApps.web);
      }

      function linkCell(value) {
        const text = String(value || "").trim();
        if (!text) return "";
        if (isHttpUrl(text)) {
          return '<a href="' + escapeHtmlText(text) + '" target="_blank" rel="noopener noreferrer">' + escapeHtmlText(text) + "</a>";
        }
        return escapeHtmlText(text);
      }

      function docCell(value) {
        const text = String(value || "").trim();
        if (!text) {
          return '<span class="muted">—</span>';
        }
        return '<a href="' + escapeHtmlText(text) + '">View Wiki →</a>';
      }

      function renderWindowsAppsTable() {
        if (!windowsAppsBody) {
          return;
        }

        const rows = getWindowsApps()
          .map(function (app) {
            const release = String(app.releaseUrl || app.exePath || "").trim();
            const repo = String(app.repoUrl || "").trim();
            const wiki = String(app.docUrl || app.wikiUrl || "").trim();
            return "<tr>" +
              "<td>" + escapeHtmlText(app.name || "") + "</td>" +
              "<td>" + escapeHtmlText(app.status || "") + "</td>" +
              "<td>" + linkCell(release) + "</td>" +
              "<td>" + linkCell(repo) + "</td>" +
              "<td>" + escapeHtmlText(app.screenshot || "") + "</td>" +
              "<td>" + escapeHtmlText(app.info || "") + "</td>" +
              "<td>" + docCell(wiki) + "</td>" +
              "</tr>";
          })
          .join("");

        windowsAppsBody.innerHTML = rows;
      }

      function renderWebAppsTable() {
        if (!webAppsBody) {
          return;
        }

        const rows = getWebApps()
          .map(function (app) {
            const url = String(app.url || "").trim();
            const wiki = String(app.docUrl || app.wikiUrl || "").trim();
            const urlCell = url
              ? '<a href="' + escapeHtmlText(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtmlText(url) + "</a>"
              : '<span class="muted">—</span>';
            return "<tr>" +
              "<td>" + escapeHtmlText(app.name || "") + "</td>" +
              "<td>" + escapeHtmlText(app.status || "") + "</td>" +
              "<td>" + urlCell + "</td>" +
              "<td>" + escapeHtmlText(app.screenshot || "") + "</td>" +
              "<td>" + escapeHtmlText(app.info || "") + "</td>" +
              "<td>" + docCell(wiki) + "</td>" +
              "</tr>";
          })
          .join("");

        webAppsBody.innerHTML = rows;
      }

      function renderHubAppTables() {
        renderWindowsAppsTable();
        renderWebAppsTable();
      }

      function updateWizardTypeView() {
        const selectedType = String(wizardType.value || "windows").toLowerCase();
        wizardWindowsFields.hidden = selectedType !== "windows";
        wizardWebFields.hidden = selectedType !== "web";
        wizardRelease.required = selectedType === "windows";
        wizardRepo.required = false;
        wizardUrl.required = selectedType === "web";
      }

      function openWizard(type) {
        if (!appWizardModal) {
          return;
        }
        wizardType.value = type === "web" ? "web" : "windows";
        updateWizardTypeView();
        appWizardModal.hidden = false;
        wizardName.focus();
      }

      function closeWizard() {
        if (!appWizardModal) {
          return;
        }
        appWizardModal.hidden = true;
        appWizardForm.reset();
        wizardStatus.value = "Active";
        updateWizardTypeView();
      }

      function setupAppWizard() {
        if (!appWizardModal || !appWizardForm) {
          return;
        }

        updateWizardTypeView();
        wizardType.addEventListener("change", updateWizardTypeView);
        addWindowsAppBtn.addEventListener("click", function () { openWizard("windows"); });
        addWebAppBtn.addEventListener("click", function () { openWizard("web"); });
        appWizardClose.addEventListener("click", closeWizard);
        appWizardCancel.addEventListener("click", closeWizard);
        appWizardModal.addEventListener("click", function (event) {
          if (event.target === appWizardModal) {
            closeWizard();
          }
        });

        clearWindowsCustomBtn.addEventListener("click", function () {
          if (!customApps.windows.length || !window.confirm("Remove all custom Windows apps?")) {
            return;
          }
          customApps.windows = [];
          persistCustomApps();
          renderStats();
          renderHomeSpaces();
          renderHubAppTables();
        });

        appWizardForm.addEventListener("submit", function (event) {
          event.preventDefault();

          const selectedType = String(wizardType.value || "windows").toLowerCase();
          const appData = {
            name: String(wizardName.value || "").trim(),
            status: String(wizardStatus.value || "Active").trim(),
            screenshot: String(wizardScreenshot.value || "").trim(),
            info: String(wizardInfo.value || "").trim(),
            docUrl: String(wizardDoc.value || "").trim(),
          };

          if (!appData.name || !appData.info) {
            return;
          }

          if (selectedType === "windows") {
            appData.releaseUrl = String(wizardRelease.value || "").trim();
            appData.repoUrl = String(wizardRepo.value || "").trim();
            customApps.windows.push(appData);
          } else {
            appData.url = String(wizardUrl.value || "").trim();
            customApps.web.push(appData);
          }

          if (wizardGenerateTemplate && wizardGenerateTemplate.checked) {
            const slug = slugifyName(appData.name) || "custom-app";
            if (!appData.docUrl) {
              appData.docUrl = "./tools/" + selectedType + "-" + slug + ".html";
            }
            const fileName = (selectedType + "-" + slug + ".html").toLowerCase();
            const templateHtml = buildWikiTemplateHtml(selectedType, appData);
            triggerTemplateDownload(fileName, templateHtml);
          }

          persistCustomApps();
          renderStats();
          renderHomeSpaces();
          renderHubAppTables();
          closeWizard();
        });
      }

      function renderStats() {
        const panelCount = DATA.tree.reduce((sum, tab) => sum + tab.panels.length, 0);
        const stackCount = DATA.tree.reduce(
          (sum, tab) => sum + tab.panels.reduce((inner, panel) => inner + panel.stacks.length, 0),
          0
        );
        const windowsCount = getWindowsApps().length;
        const webCount = getWebApps().length;
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
        const windowsCount = getWindowsApps().length;
        const webCount = getWebApps().length;
        const tabNames = DATA.tree.map(function (tab) { return tab.name; }).slice(0, 3);
        const windowNames = getWindowsApps()
          .map(function (app) { return app.name; })
          .slice(0, 3);
        const webNames = getWebApps()
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
        window.scrollTo({ top: 0, behavior: "auto" });
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
        renderHubAppTables();
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

      setupAppWizard();
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
      screenshotDiagnostics: catalog.screenshotDiagnostics,
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
