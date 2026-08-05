# SJ pyRevit Toolbar — Tool Function and Purpose

> This document focuses on the user-facing tools found in the **main SJ pyRevit tab** and the **RBG WIP tab**.  
> The **SJ pyRevit tab** is treated as the production toolbar for day-to-day Revit workflows, while the **RBG WIP tab** contains development, testing, diagnostic, or not-yet-production tools.

---

# Main SJ pyRevit Tab

## Data Panel - Add Coordinates

**Tool title:** `Add Coordinates`  
**Toolbar location:** `SJ pyRevit.tab > Data.panel > AddCoordinates.pushbutton`

### Function

Adds or updates shared coordinate parameters on selected model elements. The tool is designed to write coordinate information, including survey/project coordinate values, into designated shared parameters such as `RBG_Survey_SP_X`, `RBG_Survey_SP_Y`, and `RBG_Survey_SP_Z`.

### Purpose

The purpose of this tool is to automate spatial data population for coordination, QA, scheduling, export, or downstream checking workflows. Rather than manually reading and typing element coordinates, users can batch-populate coordinate parameters directly from the model.

### Typical Use

Use this when structural or coordination elements need their location written into parameters for reporting or verification. The reviewed bundle indicates the tool is aimed at elements such as:

- Structural Columns
- Structural Foundations
- Generic Models

### User Inputs

The tool supports different selection workflows:

- Select elements directly in the active view
- Process elements by model category
- Run against broader model-wide selections depending on the selected mode

### Output

The tool updates coordinate-related parameters on valid elements and provides feedback on what was updated, skipped, or could not be processed.

### Notes / Limitations

Elements generally need a usable point-based location or equivalent coordinate reference. Elements without the required shared parameters, unsupported location data, or invalid category selection may be skipped.
---

## Data Panel - MagpieGroup Data

**Tool title:** `MagpieGroup Data`  
**Toolbar location:** `SJ pyRevit.tab > Data.panel > MagpieGroup.pushbutton`

### Function

Copies a selected source parameter value into the `RBG_MagpieGroup` parameter as formatted text. The reviewed bundle notes the default or common source parameter as `RBG_ConcStrength`, although the script allows parameter selection/configuration.

### Purpose

The purpose of this tool is to standardise grouping or reporting data across model elements. It provides a quick batch method for pushing a chosen parameter value into a consistent target field used for grouping, filtering, tagging, scheduling, or model review.

### Typical Use

Use this when element metadata needs to be reformatted or copied into the `RBG_MagpieGroup` field for consistent model classification.

### User Inputs

The tool may prompt for:

- Source parameter selection
- Target element/category processing
- Reset/update behaviour depending on how the tool is launched or configured

### Output

The `RBG_MagpieGroup` parameter is updated on applicable elements. The tool reports updated elements and may skip elements where the target parameter is read-only, missing, or incompatible.

### Notes / Limitations

The tool is dependent on the expected project parameters existing in the model. It should be used carefully where parameter values drive schedules, filters, or downstream data workflows.

---

# Views Panel

## Views Panel - Crop Views Quick Off

**Tool title:** `Crop Views Quick Off`  
**Toolbar location:** `SJ pyRevit.tab > Views.panel > CropView.pushbutton`

### Function

Turns **Crop Region Visibility** off for either the active view or views on the active sheet.

### Purpose

This tool is intended for rapid documentation cleanup. It helps hide crop boundaries before issuing sheets or producing clean view layouts, without having to manually open each view and untick crop visibility.

### Typical Use

Use when preparing sheets or views where crop regions should not be visible on printed documentation.

### User Inputs

The tool operates from the active context and may process:

- The current active view
- All applicable views placed on the active sheet

### Output

Supported views have crop region visibility turned off.

### Notes / Limitations

This appears to be an **off-only** utility rather than a toggle. Unsupported view types are skipped.

---

## Views Panel - Grid Extents

**Tool title:** `Grids: Set 2D Extents`  
**Toolbar location:** `SJ pyRevit.tab > Views.panel > ShiftClick1.stack > GridExtents.pushbutton`

### Function

Sets visible grid lines in the active view to **2D view-specific extents**. The bundle also indicates shift-click style behaviour may be used for 2D/3D datum workflows depending on the stack configuration.

### Purpose

This tool is used to tidy grid presentation in documentation views. It reduces manual grid extent editing and helps standardise view-specific grid graphics.

### Typical Use

Use in plan, section, elevation, or other printable views where grid extents need to be adjusted for sheet presentation.

### User Inputs

The active view is used as the context. The tool processes visible grids in that view.

### Output

Visible grids are switched to view-specific datum extents where supported.

### Notes / Limitations

Problematic, hidden, or unsupported grids may be skipped. The tool is intended for view cleanup, so it should be used in the target documentation view.

---

## Views Panel - Level Head Switcher

**Tool title:** `Levels: Head Switcher`  
**Toolbar location:** `SJ pyRevit.tab > Views.panel > ShiftClick1.stack > LevelHeadSwitcher.pushbutton`

### Function

Controls the visibility of level bubbles/heads in section or elevation views. The tool can set visible levels to show only the left-side or right-side level head, depending on click or shift-click behaviour.

### Purpose

This tool improves level annotation clarity in sections and elevations. It avoids manually toggling level bubbles one-by-one and helps standardise documentation graphics.

### Typical Use

Use when section/elevation level heads need to be cleaned up so that only one side of the level marker is visible.

### User Inputs

The active section/elevation view is used. Click/shift-click behaviour is used to determine whether the left or right level head should remain visible.

### Output

Level heads are updated so only the intended side is displayed.

### Notes / Limitations

The tool is specifically suited to section/elevation views and may skip unsupported or non-printable view contexts.

---

## Views Panel - Level Extents

**Tool title:** `Levels: Set 2D Extents` / `Levels 2D / 3D`  
**Toolbar location:** `SJ pyRevit.tab > Views.panel > ShiftClick1.stack > LevelsExtents.pushbutton`

### Function

Sets visible levels in section or elevation views to either:

- **2D / view-specific extents**
- **3D / model extents**

The stack behaviour appears to support different outcomes depending on normal click or shift-click usage.

### Purpose

This tool is for batch control of level datum presentation. It helps quickly clean up documentation views or reset levels back to model extents where required.

### Typical Use

Use in sections/elevations when multiple levels need their extents changed consistently.

### User Inputs

The active section/elevation view is used as the processing context. The user action determines whether levels are pushed to 2D or 3D extents.

### Output

Visible levels are updated to the selected extent mode.

### Notes / Limitations

The tool includes logic to handle “stubborn” datum extents by toggling between extent states where necessary. Unsupported contexts or problematic levels may be skipped.

---

# Elements Panel

## Elements Panel - Disallow / Detach Elements

**Tool title:** `Disallow/Detach Elements`  
**Toolbar location:** `SJ pyRevit.tab > Elements.panel > DisallowDetach.pushbutton`

### Function

Batch-updates structural/model elements by:

- Setting beam and wall joins to **Disallow Join**
- Detaching columns where applicable

### Purpose

This tool supports structural modelling cleanup by reducing unwanted joins, attachments, or geometry behaviour that can cause documentation or coordination issues.

### Typical Use

Use when beams, walls, or columns need to be cleaned up so joins or attachments do not modify their geometry unexpectedly.

### User Inputs

The tool supports selection-based or model/category-based processing.

### Output

Applicable elements are updated, and skipped elements are reported.

### Notes / Limitations

The reviewed bundle notes that grouped elements are skipped or not supported. This is important because group membership can restrict direct modification of individual elements.

---

## Elements Panel - Quick Pin Categories

**Tool title:** `Quick Pin Categories`  
**Toolbar location:** `SJ pyRevit.tab > Elements.panel > QuickPin.pushbutton`

### Function

Pins, unpins, toggles, or reports pin status for elements across selected categories.

### Purpose

The tool provides fast model-wide pin management. It helps prevent accidental movement of key elements and supports review of which elements are already pinned, unpinned, skipped, grouped, or not editable.

### Typical Use

Use when preparing models for documentation, issue, coordination, or control workflows where important categories should be pinned.

### Supported Category Examples

The reviewed bundle identifies categories such as:

- Grids
- Levels
- Structural Framing
- Walls
- Columns
- Floors
- Site elements
- Generic Models
- Detail Components
- Lines
- Revit Links

### User Inputs

The user selects:

- Categories to process
- Action, such as pin, unpin, toggle, or summary-only depending on the script options

### Output

The tool produces grouped results showing what was pinned, unpinned, toggled, or skipped. The output includes linkified selections and grouped/paginated results for review.

### Notes / Limitations

The tool skips group members, non-editable elements, and elements that cannot be pinned.

---

## Elements Panel - RevClouds to Detail Groups

**Tool title:** `RevClouds to Detail Groups`  
**Toolbar location:** `SJ pyRevit.tab > Elements.panel > RevCloudDetailLine.pushbutton`

### Function

Converts revision cloud linework into equivalent detail groups. The original revision clouds are preserved.

### Purpose

This tool allows revision cloud geometry to be captured as detail group linework for documentation, tracking, or downstream management while retaining the original revision clouds.

### Typical Use

Use when revision clouds need to be represented as grouped detail linework, for example where the geometry needs to be reused, controlled, or documented differently.

### User Inputs

The user selects:

- Revision
- Scope, such as sheets only, views only, or all
- Optional line style depending on tool configuration

### Output

The tool creates detail groups from revision cloud linework and reports created, skipped, or fallback-processed items.

### Notes / Limitations

The tool handles ownership conditions and may skip elements owned by others. It also includes fallback handling where cloud curves cannot be directly read.

---

## Elements Panel - Select Elements by Level

**Tool title:** `Select Elements by Level`  
**Toolbar location:** `SJ pyRevit.tab > Elements.panel > SelectbyLevel.pushbutton`

### Function

Lists or selects elements associated with a chosen level, grouping results by category and type.

### Purpose

This tool helps with model auditing and coordination by quickly identifying what elements are associated with a particular level.

### Typical Use

Use when checking level-based modelling consistency, reviewing misplaced elements, or auditing what has been modelled on a specific level.

### User Inputs

The user selects a level from the project.

### Output

The tool produces a grouped report, typically by category and type, with linkified rows that allow users to select or zoom to listed elements.

### Notes / Limitations

The tool handles different level association methods, including parameter-based matching. Annotation or view-specific elements may be excluded depending on internal filtering rules.

---

# Project Panel

## Project Panel - Copy Text Types

**Tool title:** `Copy Text Types`  
**Toolbar location:** `SJ pyRevit.tab > Project.panel > Project1.stack > Copy Text Types.pushbutton`

### Function

Copies text note types from another Revit project into the current project. Existing text types are skipped.

### Purpose

The tool supports annotation standardisation by allowing text styles to be transferred from a source project, avoiding manual recreation of text types.

### Typical Use

Use during project setup or clean-up when a project is missing standard text note types.

### User Inputs

The user selects:

- Source project file
- Text note types to copy

### Output

Selected text note types are copied into the active project, with a summary of copied and skipped types.

### Notes / Limitations

Existing text types are skipped to avoid duplication or overwriting. The tool depends on compatible source project content.

---

## Project Panel - Project Family Sync

**Tool title:** `Project Family Sync`  
**Toolbar location:** `SJ pyRevit.tab > Project.panel > Project1.stack > Project Family Sync.pushbutton`

### Function

Provides a unified family loader / family sync workflow. It allows users to configure a folder path, scan `.rfa` families, categorise families as new, updated, or already loaded, and batch-load selected families into the project.

### Purpose

The purpose is to maintain consistency between a project and a controlled family library. It reduces the manual effort of checking whether families are already loaded or need updating.

### Typical Use

Use when a project needs to be updated from a standard family folder or when setting up a project with required families.

### User Inputs

The tool supports:

- Family folder selection
- Enable/disable state for checking
- Tree-based selection of families
- Selection of new/updated or already loaded families
- Batch loading selected items

### Output

Selected families are loaded or updated in the project. The tool stores configuration and tracks loaded family timestamps using project data storage.

### Notes / Limitations

The tool skips Revit backup `.rfa` files and compares file modification dates against previously loaded data. Loading families requires a transaction and can fail for incompatible or problematic family files.

---

## Project Panel - Project Parameter Sync

**Tool title:** `Project Parameter Sync`  
**Toolbar location:** `SJ pyRevit.tab > Project.panel > Project1.stack > Project Parameter Sync.pushbutton`

### Function

Compares project parameters between open Revit projects and supports parameter review, copying, and deletion workflows.

### Purpose

The purpose is to improve consistency of project parameters across related models or templates. It helps identify missing, matching, conflicting, or unique parameters between projects.

### Typical Use

Use when setting up, auditing, or aligning project parameters between two open projects.

### User Inputs

The tool requires:

- At least two projects open
- Selection of a comparison project
- Review of parameter differences
- Filter choices such as all/common/different
- Copy/delete decisions through the GUI

### Output

The tool displays parameter comparison results and allows selected parameters to be copied or deleted, subject to compatibility and parameter constraints.

### Notes / Limitations

The tool uses a GUI with colour-coded comparison states and conflict handling. Shared parameter limitations, category mismatches, binding differences, or parameter conflicts may require user review.

---

## Project Panel - Align Text

**Tool title:** `Align Text`  
**Toolbar location:** `SJ pyRevit.tab > Project.panel > Project2.stack > AlignText.pushbutton`

### Function

Aligns selected text notes to match the angle of a selected detail line in the active view.

### Purpose

This tool is for annotation cleanup. It helps quickly rotate text notes to visually align with an existing line or reference angle, reducing manual rotation work.

### Typical Use

Use in drafting/detailing views where text needs to match the orientation of linework.

### User Inputs

The user selects:

- A detail line to define the target angle
- Text notes to align

### Output

Selected text notes are recreated or rotated to match the angle of the chosen detail line.

### Notes / Limitations

The tool applies to text note elements in the active view. It should be used carefully where text formatting, leaders, or placement need to remain unchanged.

---

# RBG WIP Tab

> The WIP tab is for tools that are still in development, testing, diagnostic review, or awaiting production validation. These tools may be powerful, but they should generally be run on test models, detached models, or controlled local copies before use on live project work.

---

# WIP Testing Panel

## WIP Testing Panel - Floor Splitter

**Tool title:** `Floor Splitter` / `Split Floors by Lines`  
**Toolbar location:** `RBG WIP.tab > Testing.panel > FloorSplitter.pushbutton`

### Function

Splits one or multiple floor elements using selected model lines or detail lines as splitter geometry.

### Purpose

The tool automates floor partitioning based on user-drawn splitter lines. This can reduce manual work where floors need to be divided into regions for modelling, staging, documentation, or downstream quantities.

### Typical Use

Use when floor slabs need to be broken into smaller pieces based on drawn linework.

### User Inputs

The tool supports:

- Floor selection
- Splitter line selection
- Replace or keep original floor options
- Manual or automatic region selection
- Strict or approximate curve handling
- Minimum area filtering
- Review/report options

### Output

The tool creates new floor elements for valid split regions and can optionally remove the original floors. It also provides review output, warnings, and reports.

### Notes / Limitations

The tool may skip shape-edited floors, inaccessible sketches, very small split regions, or cases where dependencies could be affected. Because it changes model geometry, it should remain WIP until thoroughly validated.

---

## WIP Testing Panel - Batch Link View Setup

**Tool title:** `Batch Link View Setup` / `Linked Views`  
**Toolbar location:** `RBG WIP.tab > Testing.panel > LinkedViews.pushbutton`

### Function

Batch-assigns Revit link display settings so host views use selected or matched linked views through **By Linked View** overrides.

### Purpose

The tool streamlines setup of linked model visibility across multiple host views. This is useful where many views need consistent linked-view coordination settings.

### Typical Use

Use when setting up architectural/MEP/structural linked view coordination across multiple plan views.

### User Inputs

The tool includes options such as:

- Single-link or multi-link mode
- Host view selection
- Link instance selection
- Linked view selection
- Match rules, such as matching by level name or view name
- Filtering and sorting
- Preview before applying changes

### Output

Selected host views receive linked-view display overrides. The tool reports updated, skipped, and failed items.

### Notes / Limitations

The tool is focused on linked view override workflows and requires valid Revit link instances and suitable host/linked views. It should be tested carefully before standard project rollout.

---

## WIP Testing Panel - Transaction Logger

**Tool title:** `Transaction Logger`  
**Toolbar location:** `RBG WIP.tab > Testing.panel > Transaction Logger.pushbutton`

### Function

Starts or stops transaction logging for Revit changes. It can log broad model/annotation activity or target specific categories depending on selected mode.

### Purpose

This is a diagnostic and auditing tool. It is intended to help track model changes, understand what transactions are occurring, and support debugging or investigation of model modification workflows.

### Typical Use

Use during development, testing, QA, or troubleshooting when transaction activity needs to be captured.

### User Inputs

The tool supports:

- Full model and annotation logging mode
- Targeted category logging mode
- Category selection
- Snapshot options
- Output directory / logging activation state through environment variables

### Output

The tool activates logging and writes transaction data to an output location. The bundle also references JSON-style logs and a status window as part of the broader transaction logging system.

### Notes / Limitations

As a diagnostic tool, this may affect performance or produce a large amount of log data. It is best kept in WIP unless there is a defined support and maintenance workflow for production use.