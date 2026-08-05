import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const bundlePath = path.join(repoRoot, "bundle.md");
const htmlPath = path.join(repoRoot, "index.html");
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

    const functionText = yamlInfo.tooltip || contextInfo.entryPoints || "See tool context and source files for behavior details.";
    const purposeText = contextInfo.purpose || "Purpose not documented in tool-context.md.";

    const notes = dedupe([
      contextInfo.constraints,
      contextInfo.notes,
      `Files in bundle: ${relatedFiles.length}`,
    ]);

    const inputs = parseTooltipInputs(yamlInfo.tooltip);

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
  const dataJson = JSON.stringify(data, null, 2);

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
    <div class="bg-grid" aria-hidden="true"></div>

    <header class="site-header">
      <p class="kicker">pyRevit extension reference</p>
      <h1>Tool Catalog + File Tree Overview</h1>
      <p class="lede">
        Generated from <strong>bundle.md</strong>. Update your extension, regenerate the bundle,
        then run the catalog generator to refresh this page.
      </p>

      <div class="stats" id="summary-stats"></div>
      <div class="diagnostics" id="coverage-summary"></div>

      <div class="controls">
        <div class="tabs" id="tab-buttons"></div>
        <label class="search-wrap">
          <span>Search tools</span>
          <input id="search-input" type="search" placeholder="Title, panel, stack, path..." />
        </label>
      </div>
    </header>

    <main class="layout">
      <section class="tree card-block">
        <div class="block-header">
          <h2>Extension Tree</h2>
          <p>Tabs, panels, and stacks inferred from pushbutton paths in bundle data.</p>
        </div>
        <div id="tree-root" class="tree-root"></div>
      </section>

      <section class="catalog card-block">
        <div class="block-header">
          <h2>Tool Catalog</h2>
          <p>Tool cards grouped by panel inside the selected tab.</p>
        </div>
        <div id="catalog-root" class="catalog-root"></div>
      </section>
    </main>

    <footer class="site-footer">
      <p>Generated: ${generatedAt}</p>
      <p>Total files in bundle: ${allFileCount}</p>
    </footer>

    <script>
      const DATA = ${dataJson};

      const state = {
        activeTab: DATA.tree[0] ? DATA.tree[0].name : "",
        query: "",
      };

      const summaryStats = document.getElementById("summary-stats");
      const coverageSummary = document.getElementById("coverage-summary");
      const tabButtons = document.getElementById("tab-buttons");
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
        tabButtons.innerHTML = DATA.tree
          .map(function (tab) {
            const activeClass = tab.name === state.activeTab ? "is-active" : "";
            return '<button class="tab-btn ' + activeClass + '" data-tab="' + tab.name + '">' + tab.name + '</button>';
          })
          .join("");

        Array.from(tabButtons.querySelectorAll("button")).forEach(function (button) {
          button.addEventListener("click", function () {
            state.activeTab = button.getAttribute("data-tab") || state.activeTab;
            render();
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

                const notesHtml =
                  tool.notes.length > 0
                    ? '<ul>' + tool.notes.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>'
                    : '<p class="muted">No constraints or working notes were detected.</p>';

                return '<article class="tool-card">' +
                  '<header><p class="stack-pill">' + tool.stack + '</p><h4>' + tool.title + '</h4><code>' + tool.location + '</code></header>' +
                  '<p class="function">' + tool.function + '</p>' +
                  '<details open><summary>Purpose</summary><p>' + tool.purpose + '</p></details>' +
                  '<details><summary>Inputs</summary>' + inputsHtml + '</details>' +
                  '<details><summary>Notes</summary>' + notesHtml + '</details>' +
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

  const summary = [
    `Generated ${path.basename(htmlPath)} from ${path.basename(bundlePath)}`,
    `Tools: ${payload.tools.length}`,
    `Tabs: ${payload.tree.length}`,
    `Files in bundle: ${payload.meta.totalFiles}`,
    `Diagnostics: ${path.relative(repoRoot, diagnosticsPath)}`,
  ].join(" | ");

  process.stdout.write(`${summary}\n`);
}

main();
