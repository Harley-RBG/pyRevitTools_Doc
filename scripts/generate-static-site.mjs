import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const bundlePath = path.join(repoRoot, "bundle.md");
const htmlPath = path.join(repoRoot, "index.html");
const toolsPagesDir = path.join(repoRoot, "tools");
const diagnosticsDir = path.join(repoRoot, "generated");
const diagnosticsPath = path.join(diagnosticsDir, "catalog-diagnostics.json");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  writeText(filePath, JSON.stringify(value, null, 2));
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

function extractWpfMockup(xamlFiles) {
  if (!xamlFiles || xamlFiles.length === 0) {
    return {
      hasXaml: false,
      fileNames: [],
      controlCounts: [],
      namedElements: [],
      mockRows: [],
    };
  }

  const controlMap = new Map();
  const namedElements = [];
  for (const file of xamlFiles) {
    const text = file.content;
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

  return {
    hasXaml: true,
    fileNames: xamlFiles.map((f) => f.name),
    controlCounts,
    namedElements: namedElements.slice(0, 10),
    mockRows,
  };
}

function buildToolPageHtml(tool, generatedAt) {
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

      <section class="card">
        <div class="card-head">
          <span class="card-title">Tool Overview</span>
          <span class="card-hint">${escapeHtml(tool.tab)} / ${escapeHtml(tool.panel)} / ${escapeHtml(tool.stack)}</span>
        </div>
        <div class="card-body tool-page-summary">
          <a class="back-link" href="../index.html">← Back to catalog</a>
          <p><strong>Function:</strong> ${escapeHtml(tool.function)}</p>
          <p><strong>Purpose:</strong> ${escapeHtml(tool.purpose)}</p>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <span class="card-title">WPF UI Mockup</span>
          <span class="card-hint">Derived from XAML tags and named elements in bundle files</span>
        </div>
        <div class="card-body">
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

          <h4 class="subhead">Named Elements</h4>
          ${namedElementsHtml}
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <span class="card-title">Tool Functionality Details</span>
          <span class="card-hint">Inputs and bundle file coverage</span>
        </div>
        <div class="card-body tool-detail-grid">
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

      <footer class="site-footer">
        <p>Generated: ${generatedAt}</p>
        <p>Source: bundle.md</p>
      </footer>
    </div>
  </body>
</html>`;
}

function writeToolPages(tools, generatedAt) {
  clearGeneratedHtmlFiles(toolsPagesDir);

  for (const tool of tools) {
    const html = buildToolPageHtml(tool, generatedAt);
    const outputPath = path.join(repoRoot, tool.pagePath);
    ensureDir(path.dirname(outputPath));
    writeText(outputPath, html);
  }
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

function buildCatalog(bundleData) {
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

  for (const dirPath of pushbuttonDirs) {
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

    const xamlFiles = relatedFiles
      .filter((name) => name.toLowerCase().endsWith(".xaml"))
      .map((name) => ({
        name,
        content: textFiles.get(`${dirPath}/${name}`) || "",
      }))
      .filter((item) => Boolean(item.content));

    const uiMockup = extractWpfMockup(xamlFiles);

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

function main() {
  if (!fs.existsSync(bundlePath)) {
    throw new Error("bundle.md not found in repository root.");
  }

  const bundleText = readText(bundlePath);
  const bundleData = parseBundle(bundleText);
  const catalog = buildCatalog(bundleData);

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

  ensureDir(diagnosticsDir);
  writeJson(diagnosticsPath, diagnostics);

  const html = buildHtml(payload, diagnostics, generatedAt, bundleData.allPaths.length);
  writeText(htmlPath, html);
  writeToolPages(payload.tools, generatedAt);

  const summary = [
    `Generated ${path.basename(htmlPath)} from ${path.basename(bundlePath)}`,
    `Tools: ${payload.tools.length}`,
    `Tool pages: ${payload.tools.length}`,
    `Tabs: ${payload.tree.length}`,
    `Files in bundle: ${payload.meta.totalFiles}`,
    `Diagnostics: ${path.relative(repoRoot, diagnosticsPath)}`,
  ].join(" | ");

  process.stdout.write(`${summary}\n`);
}

main();
