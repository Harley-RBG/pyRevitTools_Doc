import { useState } from "react";
import { Layers, Eye, Box, FolderOpen, FlaskConical, ChevronDown } from "lucide-react";

type Tool = {
  title: string;
  location: string;
  panel: string;
  function: string;
  purpose: string;
  typicalUse: string;
  inputs: string[];
  output: string;
  notes: string;
};

type Tab = "SJ pyRevit" | "RBG WIP";

const tools: Record<Tab, Tool[]> = {
  "SJ pyRevit": [
    {
      title: "Add Coordinates",
      panel: "Data",
      location: "SJ pyRevit.tab > Data.panel > AddCoordinates.pushbutton",
      function: "Adds or updates shared coordinate parameters on selected model elements, writing survey/project coordinate values into RBG_Survey_SP_X/Y/Z.",
      purpose: "Automates spatial data population for coordination, QA, scheduling, export, or downstream checking — replacing manual coordinate entry.",
      typicalUse: "When structural or coordination elements need their location written into parameters for reporting or verification.",
      inputs: [
        "Select elements directly in the active view",
        "Process elements by model category",
        "Run against broader model-wide selections",
      ],
      output: "Updates coordinate parameters on valid elements with feedback on updated, skipped, or unprocessable items.",
      notes: "Elements need a usable point-based location. Items without required shared parameters, unsupported location data, or invalid category will be skipped.",
    },
    {
      title: "MagpieGroup Data",
      panel: "Data",
      location: "SJ pyRevit.tab > Data.panel > MagpieGroup.pushbutton",
      function: "Copies a selected source parameter value into the RBG_MagpieGroup parameter as formatted text. Default source is RBG_ConcStrength.",
      purpose: "Standardises grouping or reporting data across model elements — batch-pushing a chosen value into a consistent target field used for filtering, tagging, or scheduling.",
      typicalUse: "When element metadata needs to be reformatted or copied into RBG_MagpieGroup for consistent model classification.",
      inputs: [
        "Source parameter selection",
        "Target element / category processing",
        "Reset or update behaviour depending on launch configuration",
      ],
      output: "RBG_MagpieGroup updated on applicable elements, with report of updates and skipped items.",
      notes: "Depends on expected project parameters existing in the model. Use carefully where parameter values drive schedules, filters, or downstream data workflows.",
    },
    {
      title: "Crop Views Quick Off",
      panel: "Views",
      location: "SJ pyRevit.tab > Views.panel > CropView.pushbutton",
      function: "Turns Crop Region Visibility off for either the active view or all views placed on the active sheet.",
      purpose: "Rapid documentation cleanup — hides crop boundaries before issuing sheets or producing clean view layouts without manually opening each view.",
      typicalUse: "When preparing sheets or views where crop regions should not appear on printed documentation.",
      inputs: [
        "Active view (auto context)",
        "All applicable views placed on the active sheet",
      ],
      output: "Supported views have crop region visibility turned off.",
      notes: "Off-only utility — not a toggle. Unsupported view types are skipped.",
    },
    {
      title: "Grids: Set 2D Extents",
      panel: "Views",
      location: "SJ pyRevit.tab > Views.panel > ShiftClick1.stack > GridExtents.pushbutton",
      function: "Sets visible grid lines in the active view to 2D view-specific extents.",
      purpose: "Tidies grid presentation in documentation views — reduces manual extent editing and standardises view-specific grid graphics.",
      typicalUse: "In plan, section, elevation, or printable views where grid extents need adjustment for sheet presentation.",
      inputs: ["Active view (auto context) — processes all visible grids in that view"],
      output: "Visible grids switched to view-specific datum extents where supported.",
      notes: "Problematic, hidden, or unsupported grids may be skipped. Use in the intended documentation view.",
    },
    {
      title: "Levels: Head Switcher",
      panel: "Views",
      location: "SJ pyRevit.tab > Views.panel > ShiftClick1.stack > LevelHeadSwitcher.pushbutton",
      function: "Controls level bubble visibility in section/elevation views — sets visible levels to show only the left-side or right-side head via click/shift-click.",
      purpose: "Improves level annotation clarity in sections and elevations — avoids manual bubble toggling and standardises documentation graphics.",
      typicalUse: "When section/elevation level heads need cleanup so only one side of the level marker is visible.",
      inputs: ["Active section/elevation view", "Click = one side, Shift-click = other side"],
      output: "Level heads updated so only the intended side is displayed.",
      notes: "Specifically for section/elevation views. May skip unsupported or non-printable view contexts.",
    },
    {
      title: "Levels: Set 2D Extents",
      panel: "Views",
      location: "SJ pyRevit.tab > Views.panel > ShiftClick1.stack > LevelsExtents.pushbutton",
      function: "Sets visible levels in section/elevation views to 2D view-specific extents (click) or 3D model extents (shift-click).",
      purpose: "Batch control of level datum presentation — quickly cleans up documentation views or resets levels to model extents.",
      typicalUse: "In sections/elevations when multiple levels need their extents changed consistently.",
      inputs: [
        "Active section/elevation view (auto context)",
        "Click = 2D extents, Shift-click = 3D extents",
      ],
      output: "Visible levels updated to the selected extent mode.",
      notes: "Includes logic for stubborn datum extents by toggling between states. Unsupported contexts or problematic levels may be skipped.",
    },
    {
      title: "Disallow / Detach Elements",
      panel: "Elements",
      location: "SJ pyRevit.tab > Elements.panel > DisallowDetach.pushbutton",
      function: "Batch-updates structural elements: sets beam and wall joins to Disallow Join, and detaches columns where applicable.",
      purpose: "Structural modelling cleanup — reduces unwanted joins, attachments, or geometry behaviour that can cause documentation or coordination issues.",
      typicalUse: "When beams, walls, or columns need cleanup so joins or attachments do not modify their geometry unexpectedly.",
      inputs: ["Selection-based or model/category-based processing"],
      output: "Applicable elements updated; skipped elements reported.",
      notes: "Grouped elements are skipped — group membership restricts direct modification of individual elements.",
    },
    {
      title: "Quick Pin Categories",
      panel: "Elements",
      location: "SJ pyRevit.tab > Elements.panel > QuickPin.pushbutton",
      function: "Pins, unpins, toggles, or reports pin status for elements across selected categories.",
      purpose: "Fast model-wide pin management — prevents accidental movement of key elements and supports review of pin state.",
      typicalUse: "When preparing models for documentation, issue, or coordination where important categories should be pinned.",
      inputs: [
        "Category selection (Grids, Levels, Structural Framing, Walls, Columns, Floors, Site, Generic Models, Detail Components, Lines, Revit Links)",
        "Action: pin, unpin, toggle, or summary-only",
      ],
      output: "Grouped results showing pinned, unpinned, toggled, or skipped — with linkified selections and paginated output.",
      notes: "Skips group members, non-editable elements, and elements that cannot be pinned.",
    },
    {
      title: "RevClouds to Detail Groups",
      panel: "Elements",
      location: "SJ pyRevit.tab > Elements.panel > RevCloudDetailLine.pushbutton",
      function: "Converts revision cloud linework into equivalent detail groups. Original revision clouds are preserved.",
      purpose: "Captures revision cloud geometry as detail group linework for documentation, tracking, or downstream management while retaining original clouds.",
      typicalUse: "When revision clouds need to be represented as grouped detail linework for reuse, control, or alternative documentation.",
      inputs: [
        "Revision selection",
        "Scope: sheets only, views only, or all",
        "Optional line style depending on configuration",
      ],
      output: "Detail groups created from revision cloud linework; report of created, skipped, or fallback-processed items.",
      notes: "Handles ownership conditions — may skip elements owned by others. Includes fallback handling where cloud curves cannot be directly read.",
    },
    {
      title: "Select Elements by Level",
      panel: "Elements",
      location: "SJ pyRevit.tab > Elements.panel > SelectbyLevel.pushbutton",
      function: "Lists or selects elements associated with a chosen level, grouped by category and type.",
      purpose: "Model auditing and coordination — quickly identifies what elements are associated with a particular level.",
      typicalUse: "Checking level-based modelling consistency, reviewing misplaced elements, or auditing what is modelled on a specific level.",
      inputs: ["Level selection from the project"],
      output: "Grouped report by category and type, with linkified rows for selecting or zooming to listed elements.",
      notes: "Handles different level association methods including parameter-based matching. Annotation or view-specific elements may be excluded.",
    },
    {
      title: "Copy Text Types",
      panel: "Project",
      location: "SJ pyRevit.tab > Project.panel > Project1.stack > CopyTextTypes.pushbutton",
      function: "Copies text note types from another Revit project into the current project. Existing text types are skipped.",
      purpose: "Annotation standardisation — transfers text styles from a source project, avoiding manual recreation of text types.",
      typicalUse: "During project setup or cleanup when a project is missing standard text note types.",
      inputs: ["Source project file", "Text note type selection"],
      output: "Selected text note types copied into the active project, with summary of copied and skipped types.",
      notes: "Existing text types are skipped to avoid overwriting. Depends on compatible source project content.",
    },
    {
      title: "Project Family Sync",
      panel: "Project",
      location: "SJ pyRevit.tab > Project.panel > Project1.stack > ProjectFamilySync.pushbutton",
      function: "Unified family loader/sync workflow — scans a configured .rfa folder, categorises families as new/updated/loaded, and batch-loads selected families.",
      purpose: "Maintains consistency between a project and a controlled family library — reduces manual checking of which families are loaded or need updating.",
      typicalUse: "When a project needs updating from a standard family folder, or when setting up a project with required families.",
      inputs: [
        "Family folder path",
        "Enable/disable checking state",
        "Tree-based family selection (new, updated, or already loaded)",
        "Batch load action",
      ],
      output: "Selected families loaded or updated in the project. Configuration stored; loaded timestamps tracked via project data storage.",
      notes: "Skips Revit backup .rfa files. Compares file modification dates against previously loaded data. Loading requires a transaction and may fail for incompatible families.",
    },
    {
      title: "Project Parameter Sync",
      panel: "Project",
      location: "SJ pyRevit.tab > Project.panel > Project1.stack > ProjectParameterSync.pushbutton",
      function: "Compares project parameters between open Revit projects and supports parameter review, copying, and deletion workflows.",
      purpose: "Improves consistency of project parameters across related models or templates — identifies missing, matching, conflicting, or unique parameters.",
      typicalUse: "Setting up, auditing, or aligning project parameters between two open projects.",
      inputs: [
        "At least two projects open",
        "Comparison project selection",
        "Filter: all / common / different",
        "Copy or delete decisions via GUI",
      ],
      output: "Parameter comparison results with colour-coded states. Allows selected parameters to be copied or deleted subject to compatibility constraints.",
      notes: "Shared parameter limitations, category mismatches, binding differences, or conflicts may require user review.",
    },
    {
      title: "Align Text",
      panel: "Project",
      location: "SJ pyRevit.tab > Project.panel > Project2.stack > AlignText.pushbutton",
      function: "Aligns selected text notes to match the angle of a selected detail line in the active view.",
      purpose: "Annotation cleanup — quickly rotates text notes to visually align with existing linework, reducing manual rotation work.",
      typicalUse: "In drafting/detailing views where text needs to match the orientation of linework.",
      inputs: ["A detail line to define the target angle", "Text notes to align"],
      output: "Selected text notes recreated or rotated to match the chosen detail line angle.",
      notes: "Applies to text note elements in the active view. Use carefully where text formatting, leaders, or placement must remain unchanged.",
    },
  ],
  "RBG WIP": [
    {
      title: "Floor Splitter",
      panel: "Testing",
      location: "RBG WIP.tab > Testing.panel > FloorSplitter.pushbutton",
      function: "Splits one or multiple floor elements using selected model lines or detail lines as splitter geometry.",
      purpose: "Automates floor partitioning based on user-drawn splitter lines — reduces manual work where floors need to be divided for modelling, staging, documentation, or quantities.",
      typicalUse: "When floor slabs need to be broken into smaller pieces based on drawn linework.",
      inputs: [
        "Floor selection",
        "Splitter line selection",
        "Replace or keep original floor",
        "Manual or automatic region selection",
        "Strict or approximate curve handling",
        "Minimum area filtering",
        "Review/report options",
      ],
      output: "New floor elements for valid split regions. Optionally removes original floors. Review output with warnings and reports.",
      notes: "May skip shape-edited floors, inaccessible sketches, very small regions, or cases where dependencies could be affected. Remains WIP until thoroughly validated.",
    },
    {
      title: "Batch Link View Setup",
      panel: "Testing",
      location: "RBG WIP.tab > Testing.panel > LinkedViews.pushbutton",
      function: "Batch-assigns Revit link display settings so host views use selected or matched linked views through By Linked View overrides.",
      purpose: "Streamlines setup of linked model visibility across multiple host views — useful where many views need consistent linked-view coordination settings.",
      typicalUse: "When setting up architectural/MEP/structural linked view coordination across multiple plan views.",
      inputs: [
        "Single-link or multi-link mode",
        "Host view selection",
        "Link instance selection",
        "Linked view selection",
        "Match rules: by level name or view name",
        "Filtering, sorting, and preview before applying",
      ],
      output: "Selected host views receive linked-view display overrides. Reports updated, skipped, and failed items.",
      notes: "Requires valid Revit link instances and suitable host/linked views. Test carefully before standard project rollout.",
    },
    {
      title: "Transaction Logger",
      panel: "Testing",
      location: "RBG WIP.tab > Testing.panel > TransactionLogger.pushbutton",
      function: "Starts or stops transaction logging for Revit changes — logs broad model/annotation activity or targets specific categories depending on selected mode.",
      purpose: "Diagnostic and auditing tool — tracks model changes, captures transaction activity, and supports debugging or investigation of model modification workflows.",
      typicalUse: "During development, testing, QA, or troubleshooting when transaction activity needs to be captured.",
      inputs: [
        "Full model and annotation logging mode",
        "Targeted category logging mode",
        "Category selection",
        "Snapshot options",
        "Output directory via environment variables",
      ],
      output: "Activates logging and writes transaction data (JSON-style logs) to a configured output location. Includes a status window.",
      notes: "May affect performance or produce large log volumes. Best kept in WIP unless there is a defined support and maintenance workflow.",
    },
  ],
};

const panelMeta: Record<string, { icon: React.ReactNode; color: string; dot: string }> = {
  Data:     { icon: <Layers size={14} />,      color: "text-blue-600",   dot: "bg-blue-500" },
  Views:    { icon: <Eye size={14} />,         color: "text-violet-600", dot: "bg-violet-500" },
  Elements: { icon: <Box size={14} />,         color: "text-teal-600",   dot: "bg-teal-500" },
  Project:  { icon: <FolderOpen size={14} />,  color: "text-amber-600",  dot: "bg-amber-500" },
  Testing:  { icon: <FlaskConical size={14} />, color: "text-orange-600", dot: "bg-orange-500" },
};

const sections = [
  { key: "purpose",    label: "Purpose" },
  { key: "typicalUse", label: "Typical Use" },
  { key: "inputs",     label: "Inputs" },
  { key: "output",     label: "Output" },
  { key: "notes",      label: "Notes" },
] as const;

type SectionKey = typeof sections[number]["key"];

function ToolCard({ tool, isWIP }: { tool: Tool; isWIP: boolean }) {
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);

  const toggle = (key: SectionKey) =>
    setOpenSection((prev) => (prev === key ? null : key));

  const accentClass = isWIP ? "text-accent border-accent bg-orange-50" : "text-primary border-primary bg-blue-50";

  return (
    <div className="bg-card border border-border rounded-sm">
      {/* Card header */}
      <div className="px-5 pt-5 pb-4">
        {/* Title */}
        <h3
          className="text-[15px] font-bold text-foreground leading-snug mb-2"
          style={{ fontFamily: "'Archivo Narrow', sans-serif", letterSpacing: "-0.01em" }}
        >
          {tool.title}
        </h3>

        {/* Function — always visible, full contrast */}
        <p
          className="text-[13px] text-foreground leading-relaxed"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
          {tool.function}
        </p>

        {/* Toolbar path */}
        <div className="mt-3">
          <code
            className="text-[10.5px] text-muted-foreground bg-muted px-2 py-1 rounded-sm block overflow-x-auto"
            style={{ fontFamily: "'Geist Mono', monospace" }}
          >
            {tool.location}
          </code>
        </div>
      </div>

      {/* Accordion sections */}
      <div className="border-t border-border divide-y divide-border">
        {sections.map(({ key, label }) => {
          const isOpen = openSection === key;
          return (
            <div key={key}>
              <button
                onClick={() => toggle(key)}
                className="w-full flex items-center justify-between px-5 py-3 text-left group hover:bg-muted/40 transition-colors"
              >
                <span
                  className={`text-[12px] font-semibold transition-colors ${isOpen ? (isWIP ? "text-accent" : "text-primary") : "text-muted-foreground group-hover:text-foreground"}`}
                  style={{ fontFamily: "'Archivo Narrow', sans-serif", letterSpacing: "0.04em", textTransform: "uppercase" }}
                >
                  {label}
                </span>
                <ChevronDown
                  size={13}
                  className={`flex-shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180 " + (isWIP ? "text-accent" : "text-primary") : "text-muted-foreground"}`}
                />
              </button>

              {isOpen && (
                <div className="px-5 pb-4 pt-1">
                  {key === "inputs" ? (
                    <ul className="space-y-1.5">
                      {tool.inputs.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2.5 text-[13px] text-foreground leading-relaxed"
                          style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                          <span className={`mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0 ${isWIP ? "bg-accent/60" : "bg-primary/40"}`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p
                      className="text-[13px] text-foreground leading-relaxed"
                      style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                      {tool[key] as string}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PanelGroup({
  panel,
  tools,
  isWIP,
}: {
  panel: string;
  tools: Tool[];
  isWIP: boolean;
}) {
  const meta = panelMeta[panel];

  return (
    <section>
      {/* Panel heading */}
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`${meta.color}`}>{meta.icon}</div>
        <h2
          className="text-[13px] font-bold text-foreground uppercase tracking-widest"
          style={{ fontFamily: "'Archivo Narrow', sans-serif" }}
        >
          {panel}
        </h2>
        <div className="flex-1 h-px bg-border ml-1" />
        <span
          className="text-[11px] text-muted-foreground tabular-nums"
          style={{ fontFamily: "'Geist Mono', monospace" }}
        >
          {tools.length} {tools.length === 1 ? "tool" : "tools"}
        </span>
      </div>

      {/* Tool cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {tools.map((tool) => (
          <ToolCard key={tool.title} tool={tool} isWIP={isWIP} />
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("SJ pyRevit");
  const isWIP = activeTab === "RBG WIP";

  const tabTools = tools[activeTab];
  const panels = Array.from(new Set(tabTools.map((t) => t.panel)));

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 border-b border-border" style={{ backdropFilter: "blur(6px)" }}>
        <div className="max-w-4xl mx-auto px-5">
          <div className="flex items-center justify-between py-4 gap-4">
            <div>
              <h1
                className="text-[17px] font-bold text-foreground leading-none"
                style={{ fontFamily: "'Archivo Narrow', sans-serif", letterSpacing: "-0.01em" }}
              >
                SJ pyRevit Toolbar
              </h1>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">
                Tool reference &mdash; {tools["SJ pyRevit"].length + tools["RBG WIP"].length} tools across{" "}
                {Object.keys(panelMeta).length} panels
              </p>
            </div>

            {/* Tab switcher */}
            <div className="flex items-center gap-1 bg-secondary p-0.5 rounded-sm">
              {(["SJ pyRevit", "RBG WIP"] as Tab[]).map((tab) => {
                const active = activeTab === tab;
                const wip = tab === "RBG WIP";
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 rounded-sm text-[12px] font-semibold transition-all ${
                      active
                        ? wip
                          ? "bg-accent text-white shadow-sm"
                          : "bg-primary text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    style={{ fontFamily: "'Archivo Narrow', sans-serif" }}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-6">
        {/* WIP notice */}
        {isWIP && (
          <div className="mb-6 rounded-sm border border-orange-200 bg-orange-50 px-4 py-3 text-[12.5px] text-orange-900 leading-relaxed">
            <span className="font-semibold" style={{ fontFamily: "'Archivo Narrow', sans-serif" }}>
              WIP Tab —
            </span>{" "}
            Tools in development, testing, or awaiting production validation. Run on test or detached models before use on live project work.
          </div>
        )}

        {/* Grouped panels */}
        <div className="space-y-8">
          {panels.map((panel) => (
            <PanelGroup
              key={panel}
              panel={panel}
              tools={tabTools.filter((t) => t.panel === panel)}
              isWIP={isWIP}
            />
          ))}
        </div>

        <footer className="mt-10 pb-6 text-[11px] text-muted-foreground text-center">
          SJ pyRevit Toolbar — Internal Reference
        </footer>
      </main>
    </div>
  );
}
