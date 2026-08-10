# Working Hub Tracker

This document is the persistent reference for why this site exists and how to keep implementation aligned.

## Core Purpose

Build and maintain a single internal webpage that contains:

1. Tool Catalog
- Revit Tools (current parsed pushbutton system)
- Windows Apps
- Web-based Apps (including this site)

2. Working Hub
- Place to add tool ideas, training notes, known limitations, and implementation plans.

3. Training Simulator
- Interactive simulation for tool behavior using static extracted UI metadata and safe mock data.
- Never executes live Revit or pyRevit model logic.

## Working Hub Scope

- Tool catalogue: list each tool and what problem it solves.
- Training mode: walkthrough with dummy data before use on live projects.
- Project safety: explain what can be changed by each tool.
- Shared learning: capture common fixes and reusable helper patterns.
- Broader scope: include pyRevit tools, package utilities, validation tools, and desktop helpers.

## Recommended Wiki Sections

| Wiki section | Recommended content |
| --- | --- |
| Tool overview | Purpose, owner, status, Revit version, dependencies, data modified, risk level |
| How to use | Workflow, screenshots, expected inputs, expected outputs, rollback guidance |
| Training sandbox | Dummy data, sample parameters, sample folders, safe test scenarios |
| Developer notes | Folder path, file structure, known limitations, errors, planned improvements |
| Support links | Internal setup guide, pyRevit docs, Revit API docs, VS Code notes, idea portal |

## Data Files To Keep Updated

- working-hub.json
- generated/tool-catalog.json
- generated/ui-manifest.json
- generated/training-data.json
- generated/ui-diagnostics.json
- generated/catalog-diagnostics.json

## Current Simulator Reality

The current simulator is a useful baseline but not yet a high-fidelity UI mirror of complex WPF tools. The attached screenshots (for example Parameter Copier and View Creator/Selector) show a denser and more structured UI than current generic rendering.

High-fidelity pilot now implemented:

- Tool: Section Move (`SectionUpdater.pushbutton`).
- Dedicated simulator layout: targets panel, plan/extents panel, crop extents table panel, staged run actions, and output summary.
- Diagnostics include fidelity markers in `generated/ui-diagnostics.json` for this tool.
- Remaining tools still use generic inferred rendering until migrated.

## Simulator Alignment Steps

1. Add control-level layout groups from XAML container hierarchy (Grid/GroupBox/TabControl/DockPanel).
2. Build dedicated renderers for common tool patterns (dual-list transfer, staged wizard, settings pane).
3. Map event handlers to specific controls using x:Name + Click/SelectionChanged extraction.
4. Add per-tool simulation rules via optional ui.training.json files.
5. Add optional Revit snapshot exports for realistic data populations.
6. Implement light/dark WPF-like themes and spacing presets for visual parity.
7. Add per-tool screenshot comparison checks in diagnostics for fidelity tracking.

## Next Fidelity Targets

1. Parameter Copier: dual list-transfer + parameter mapping table behavior.
2. View Creator/Selector: multi-step scope and template assignment workflow.
3. SheetNo and related sheet tools: grid-first editing flow with validation states.

## Update Routine

1. Update extension files and run bundle/update generation.
2. Update working-hub.json with latest app/tool idea entries.
3. Review generated simulator diagnostics and fill missing metadata.
4. Update this tracker with decision changes and next milestones.
