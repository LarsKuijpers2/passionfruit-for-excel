/**
 * Web Review Generator
 *
 * Generates an interactive HTML review interface with three views:
 * 1. Original questionnaire (Excel preview)
 * 2. Indexed data (sections + items)
 * 3. Harvested data (items for library)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { QuestionnaireStructure, SheetData, CellData } from './excel-structure.js';
import type { IndexedQuestionnaire } from './questionnaire-indexer.js';
import type { AnswerLibrary } from './answer-harvester.js';

export class WebReviewGenerator {
  private outputDir: string;

  constructor(outputDir: string = './review') {
    this.outputDir = outputDir;
  }

  /**
   * Generate complete review interface
   */
  async generate(
    structurePath: string,
    indexedPath: string,
    libraryPath?: string
  ): Promise<string> {
    await mkdir(this.outputDir, { recursive: true });

    // Load data
    const structure: QuestionnaireStructure = JSON.parse(await readFile(structurePath, 'utf-8'));
    const indexed: IndexedQuestionnaire = parseYaml(await readFile(indexedPath, 'utf-8'));

    let library: AnswerLibrary | null = null;
    if (libraryPath) {
      try {
        library = parseYaml(await readFile(libraryPath, 'utf-8'));
      } catch {
        // Library not found, that's ok
      }
    }

    // Generate HTML
    const html = this.buildReviewHtml(structure, indexed, library);

    const safeName = structure.source.filename.replace(/[^a-zA-Z0-9]/g, '_');
    const outputPath = join(this.outputDir, `${safeName}_review.html`);

    await writeFile(outputPath, html, 'utf-8');

    return outputPath;
  }

  /**
   * Generate the single-page app shell (index.html)
   * This is the new architecture - one HTML file that loads data dynamically
   */
  async generateAppShell(): Promise<string> {
    await mkdir(this.outputDir, { recursive: true });

    const html = this.buildAppShellHtml();
    const outputPath = join(this.outputDir, 'index.html');

    await writeFile(outputPath, html, 'utf-8');

    return outputPath;
  }

  /**
   * Build the complete review HTML
   */
  private buildReviewHtml(
    structure: QuestionnaireStructure,
    indexed: IndexedQuestionnaire,
    library: AnswerLibrary | null
  ): string {
    const sheetsHtml = structure.sheets.map(sheet => this.buildSheetTable(sheet)).join('\n');
    const indexedHtml = this.buildIndexedView(indexed);
    const libraryHtml = library ? this.buildLibraryView(library) : '<p class="empty">Run harvest first to see library items</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review: ${this.escapeHtml(structure.source.filename)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --background: #09090b;
      --foreground: #fafafa;
      --card: #0a0a0c;
      --card-foreground: #fafafa;
      --muted: #27272a;
      --muted-foreground: #a1a1aa;
      --border: #27272a;
      --input: #27272a;
      --primary: #fafafa;
      --primary-foreground: #18181b;
      --secondary: #27272a;
      --secondary-foreground: #fafafa;
      --accent: #27272a;
      --accent-foreground: #fafafa;
      --destructive: #7f1d1d;
      --radius: 6px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--background);
      color: var(--foreground);
      height: 100vh;
      overflow: hidden;
      font-size: 14px;
      line-height: 1.5;
    }

    /* Header */
    .header {
      background: var(--card);
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .header h1 {
      font-size: 14px;
      font-weight: 600;
      color: var(--foreground);
    }
    .header .meta {
      font-size: 12px;
      color: var(--muted-foreground);
      margin-top: 2px;
    }

    /* View toggles */
    .toggles {
      display: flex;
      gap: 6px;
    }
    .toggle {
      padding: 6px 12px;
      background: var(--secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--muted-foreground);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .toggle:hover {
      background: var(--accent);
      color: var(--foreground);
    }
    .toggle.active {
      background: var(--foreground);
      color: var(--background);
      border-color: var(--foreground);
    }

    /* Main layout */
    .main {
      display: flex;
      height: calc(100vh - 56px - 40px); /* header + stats bar */
      overflow: hidden;
    }

    /* Panels */
    .panel {
      flex: 1;
      display: none;
      flex-direction: column;
      border-right: 1px solid var(--border);
      overflow: hidden;
      min-width: 0;
    }
    .panel.visible {
      display: flex;
    }
    .panel-header {
      background: var(--card);
      padding: 12px 16px;
      font-size: 13px;
      font-weight: 600;
      color: var(--foreground);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .panel-header .count {
      font-weight: 400;
      color: var(--muted-foreground);
      font-size: 12px;
    }
    .panel-content {
      flex: 1;
      overflow: auto;
      padding: 16px;
      background: var(--background);
    }

    /* Original view - Excel table */
    .excel-table {
      border-collapse: collapse;
      font-size: 11px;
      width: 100%;
      background: var(--card);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .excel-table th, .excel-table td {
      border: 1px solid var(--border);
      padding: 6px 8px;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .excel-table th {
      background: var(--muted);
      font-weight: 500;
      color: var(--muted-foreground);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .excel-table .row-num {
      background: var(--muted);
      color: var(--muted-foreground);
      text-align: center;
      width: 35px;
      position: sticky;
      left: 0;
      font-size: 10px;
    }
    .excel-table .empty { background: var(--background); }
    .excel-table .role-header { background: #1e293b; font-weight: 600; }
    .excel-table .role-section { background: #1e3a5f; font-weight: 600; }
    .excel-table .role-label { background: #18181b; color: var(--muted-foreground); }
    .excel-table .role-input { background: #1c1c22; }
    .excel-table .role-value { background: #14231c; }
    .excel-table td:hover {
      outline: 1px solid var(--muted-foreground);
      cursor: pointer;
    }

    /* Sheet tabs */
    .sheet-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
    }
    .sheet-tab {
      padding: 6px 12px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--muted-foreground);
      cursor: pointer;
      font-size: 12px;
      transition: all 0.15s ease;
    }
    .sheet-tab:hover {
      color: var(--foreground);
      background: var(--secondary);
    }
    .sheet-tab.active {
      background: var(--secondary);
      color: var(--foreground);
    }
    .sheet-content { display: none; }
    .sheet-content.active { display: block; }

    /* Indexed view */
    .section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 12px;
      overflow: hidden;
    }
    .section-header {
      background: var(--card);
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .section-header:hover { background: var(--muted); }
    .section-title {
      font-weight: 500;
      font-size: 13px;
    }
    .section-meta {
      font-size: 11px;
      color: var(--muted-foreground);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-meta .topic {
      background: var(--muted);
      color: var(--foreground);
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 500;
    }
    .section-items {
      padding: 8px;
      border-top: 1px solid var(--border);
    }
    .section.collapsed .section-items { display: none; }

    /* Items */
    .item {
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      margin-bottom: 8px;
    }

    /* Library items: colored borders show destination */
    #panel-library .item { border-left: 3px solid #4ade80; } /* default: library (green) */

    .item-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .item-label {
      font-size: 12px;
      color: var(--muted-foreground);
      flex: 1;
    }
    .item-meta {
      font-size: 10px;
      color: var(--muted-foreground);
      font-family: ui-monospace, monospace;
      white-space: nowrap;
    }

    /* Legend */
    .legend {
      display: flex;
      gap: 16px;
      padding: 8px 12px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 12px;
      font-size: 11px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--muted-foreground);
    }
    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 2px;
    }
    .legend-color.entity-db { background: #22c55e; }
    .legend-color.answer-library { background: #3b82f6; }
    .legend-color.product { background: #f59e0b; }

    .item-value {
      font-size: 13px;
      color: var(--foreground);
      background: var(--muted);
      padding: 8px 12px;
      border-radius: var(--radius);
    }
    .item-value.empty {
      color: var(--muted-foreground);
      font-style: italic;
    }
    .item-ref {
      font-size: 10px;
      color: var(--muted-foreground);
      margin-top: 8px;
      font-family: ui-monospace, monospace;
    }

    /* Review actions */
    .item-actions {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }
    .action-btn {
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      background: var(--background);
      color: var(--muted-foreground);
    }
    .action-btn:hover {
      background: var(--muted);
      color: var(--foreground);
    }
    .action-btn.correct:hover { background: #14532d; color: #4ade80; border-color: #166534; }
    .action-btn.wrong:hover { background: #7f1d1d; color: #fca5a5; border-color: #991b1b; }
    .action-btn.edit:hover { background: #422006; color: #fbbf24; border-color: #854d0e; }

    .item.reviewed { opacity: 0.6; }
    .item.reviewed.correct { border-left-color: #22c55e; background: #052e16; }
    .item.reviewed.wrong { border-left-color: #ef4444; background: #450a0a; }

    /* Wrong note input */
    .wrong-note-container {
      display: none;
      margin-top: 8px;
    }
    .item.show-note .wrong-note-container { display: block; }
    .wrong-note-input {
      width: 100%;
      padding: 6px 10px;
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--foreground);
      font-size: 12px;
      font-family: inherit;
    }
    .wrong-note-input:focus {
      outline: none;
      border-color: var(--muted-foreground);
    }
    .wrong-note-input::placeholder {
      color: var(--muted-foreground);
    }
    .wrong-note-actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .wrong-note-btn {
      padding: 4px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 11px;
      cursor: pointer;
      background: var(--secondary);
      color: var(--foreground);
    }
    .wrong-note-btn:hover { background: var(--muted); }
    .wrong-note-btn.save { background: #7f1d1d; border-color: #991b1b; }
    .wrong-note-btn.save:hover { background: #991b1b; }

    /* Library view */
    .library-topic {
      margin-bottom: 20px;
    }
    .library-topic-header {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted-foreground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .group-actions {
      display: flex;
      gap: 4px;
    }
    .group-btn {
      padding: 3px 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 10px;
      cursor: pointer;
      background: var(--background);
      color: var(--muted-foreground);
      transition: all 0.15s ease;
    }
    .group-btn:hover {
      background: var(--muted);
      color: var(--foreground);
    }
    .group-btn.accept-all:hover { background: #14532d; color: #4ade80; }
    .group-btn.reject-all:hover { background: #7f1d1d; color: #fca5a5; }

    /* Stats bar */
    .stats-bar {
      background: var(--card);
      padding: 10px 16px;
      font-size: 12px;
      color: var(--muted-foreground);
      display: flex;
      gap: 24px;
      border-top: 1px solid var(--border);
    }
    .stat { display: flex; gap: 6px; align-items: center; }
    .stat-label { color: var(--muted-foreground); }
    .stat-value { color: var(--foreground); font-weight: 500; }

    /* Empty state */
    .empty {
      color: var(--muted-foreground);
      padding: 40px 20px;
      text-align: center;
      font-size: 13px;
    }

    /* Tooltip */
    .tooltip {
      position: fixed;
      background: var(--card);
      border: 1px solid var(--border);
      padding: 8px 12px;
      border-radius: var(--radius);
      font-size: 12px;
      max-width: 300px;
      z-index: 1000;
      display: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .tooltip.visible { display: block; }

    /* Scrollbar styling */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: var(--background); }
    ::-webkit-scrollbar-thumb { background: var(--muted); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--muted-foreground); }

    /* Toggle divider */
    .toggle-divider {
      width: 1px;
      height: 20px;
      background: var(--border);
      margin: 0 4px;
    }

    /* Sync mode */
    .sync-icon { font-size: 14px; }
    #sync-toggle.active { background: #3b82f6; border-color: #3b82f6; }
    body.sync-mode .item:hover { cursor: pointer; }

    /* Export button */
    #export-toggle.has-feedback { background: #14532d; color: #4ade80; border-color: #166534; }

    /* Review mode */
    #review-toggle.active { background: #3b82f6; border-color: #3b82f6; }
    .review-only { display: none; }
    body.review-mode .review-only { display: flex; }

    /* Section header layout */
    .section-header-left { display: flex; flex-direction: column; gap: 2px; }
    .section-header-right { display: flex; align-items: center; gap: 12px; }
    .section-status {
      font-size: 11px;
      color: var(--muted-foreground);
      font-family: ui-monospace, monospace;
    }
    .section-status.all-reviewed { color: #4ade80; }
    .section-status.has-rejected { color: #fca5a5; }

    /* Persistent note display */
    .item-note-display {
      display: none;
      font-size: 11px;
      color: #fca5a5;
      background: rgba(127, 29, 29, 0.3);
      padding: 6px 10px;
      border-radius: var(--radius);
      margin-top: 8px;
    }
    .item-note-display::before {
      content: "Note: ";
      font-weight: 600;
    }
    .item.has-note .item-note-display { display: block; }

    /* Keep action buttons visible on reviewed items so user can change decision */
    .item.reviewed .item-actions { opacity: 0.6; }
    .item.reviewed:hover .item-actions { opacity: 1; }
    .item.reviewed.correct .action-btn.correct,
    .item.reviewed.accepted .action-btn.correct { background: #14532d; color: #4ade80; border-color: #166534; }
    .item.reviewed.wrong .action-btn.wrong,
    .item.reviewed.rejected .action-btn.wrong { background: #7f1d1d; color: #fca5a5; border-color: #991b1b; }
    .item.reviewed.edited { border-left: 3px solid #a855f7; }

    /* Edit mode */
    .item.editing .item-actions { display: none !important; }
    .edit-input {
      width: 100%;
      padding: 6px 10px;
      background: var(--background);
      border: 1px solid #3b82f6;
      border-radius: var(--radius);
      color: var(--foreground);
      font-size: inherit;
      font-family: inherit;
    }
    .edit-input:focus {
      outline: none;
      border-color: #60a5fa;
    }
    .edit-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .edit-btn {
      padding: 5px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 11px;
      cursor: pointer;
      background: var(--secondary);
      color: var(--foreground);
    }
    .edit-btn:hover { background: var(--muted); }
    .edit-btn.save { background: #1e3a8a; border-color: #3b82f6; }
    .edit-btn.save:hover { background: #3b82f6; }

    /* Selected/highlighted states */
    .item.selected {
      outline: 2px solid #3b82f6;
      outline-offset: -2px;
      background: rgba(59, 130, 246, 0.1);
    }
    .item.highlighted {
      outline: 2px solid #22c55e;
      outline-offset: -2px;
      background: rgba(34, 197, 94, 0.1);
    }
    .excel-table td.selected {
      outline: 2px solid #3b82f6 !important;
      background: rgba(59, 130, 246, 0.2) !important;
    }
    .excel-table td.highlighted {
      outline: 2px solid #22c55e !important;
      background: rgba(34, 197, 94, 0.2) !important;
    }

    /* Current item (keyboard nav) */
    .item.current {
      outline: 2px solid var(--foreground);
      outline-offset: -2px;
    }

    /* Help modal */
    .help-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      z-index: 1001;
      min-width: 320px;
      display: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .help-modal.visible { display: block; }
    .help-modal h3 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--foreground);
    }
    .help-modal .shortcut-group {
      margin-bottom: 16px;
    }
    .help-modal .shortcut-group-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted-foreground);
      margin-bottom: 8px;
    }
    .help-modal .shortcut {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 13px;
    }
    .help-modal kbd {
      background: var(--muted);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, monospace;
      font-size: 11px;
      min-width: 24px;
      text-align: center;
    }
    .help-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      display: none;
    }
    .help-overlay.visible { display: block; }

    /* Toast notification */
    .toast {
      position: fixed;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--card);
      border: 1px solid var(--border);
      padding: 8px 16px;
      border-radius: var(--radius);
      font-size: 12px;
      z-index: 1002;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .toast.visible { opacity: 1; }

    /* Connection status */
    .connection-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 8px;
    }
    .connection-status.connected { background: #22c55e; }
    .connection-status.disconnected { background: #ef4444; }
    .connection-status.checking { background: #f59e0b; }

    /* Sidebar Navigation */
    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      height: 100vh;
      width: 280px;
      background: var(--card);
      border-right: 1px solid var(--border);
      z-index: 100;
      display: flex;
      flex-direction: column;
      transform: translateX(-100%);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .sidebar-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--foreground);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sidebar-title svg {
      width: 16px;
      height: 16px;
      opacity: 0.7;
    }
    .sidebar-close {
      background: none;
      border: none;
      color: var(--muted-foreground);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .sidebar-close:hover {
      background: var(--muted);
      color: var(--foreground);
    }
    .sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .sidebar-section {
      margin-bottom: 16px;
    }
    .sidebar-section-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted-foreground);
      padding: 0 8px;
      margin-bottom: 8px;
    }
    .sidebar-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: var(--radius);
      color: var(--muted-foreground);
      text-decoration: none;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
      margin-bottom: 2px;
    }
    .sidebar-item:hover {
      background: var(--muted);
      color: var(--foreground);
    }
    .sidebar-item.active {
      background: var(--secondary);
      color: var(--foreground);
    }
    .sidebar-item.active::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 16px;
      background: var(--foreground);
      border-radius: 0 2px 2px 0;
    }
    .sidebar-item-icon {
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .sidebar-item-icon svg {
      width: 14px;
      height: 14px;
    }
    .sidebar-item-content {
      flex: 1;
      min-width: 0;
    }
    .sidebar-item-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sidebar-item-meta {
      font-size: 10px;
      color: var(--muted-foreground);
      margin-top: 2px;
    }
    .sidebar-item-badge {
      background: var(--muted);
      color: var(--muted-foreground);
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 9999px;
      flex-shrink: 0;
    }
    .sidebar-item-badge.has-feedback {
      background: #14532d;
      color: #4ade80;
    }
    .sidebar-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--muted-foreground);
    }
    .sidebar-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 99;
      opacity: 0;
      visibility: hidden;
      transition: all 0.25s;
    }
    .sidebar-overlay.visible {
      opacity: 1;
      visibility: visible;
    }

    /* Sidebar toggle button */
    .sidebar-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: var(--secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--muted-foreground);
      cursor: pointer;
      margin-right: 8px;
      transition: all 0.15s;
    }
    .sidebar-toggle:hover {
      background: var(--muted);
      color: var(--foreground);
    }
    .sidebar-toggle svg {
      width: 16px;
      height: 16px;
    }

    /* Loading state for questionnaires */
    .sidebar-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--muted-foreground);
      font-size: 12px;
    }
    .sidebar-loading::before {
      content: '';
      width: 14px;
      height: 14px;
      border: 2px solid var(--border);
      border-top-color: var(--foreground);
      border-radius: 50%;
      margin-right: 8px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Empty state */
    .sidebar-empty {
      padding: 20px;
      text-align: center;
      color: var(--muted-foreground);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <!-- Sidebar Navigation -->
  <div class="sidebar-overlay" id="sidebar-overlay"></div>
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        Questionnaires
      </div>
      <button class="sidebar-close" id="sidebar-close" title="Close sidebar">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="sidebar-content">
      <div class="sidebar-section">
        <div class="sidebar-section-title">Indexed</div>
        <div id="questionnaire-list">
          <div class="sidebar-loading">Loading questionnaires...</div>
        </div>
      </div>
    </div>
    <div class="sidebar-footer">
      Press <kbd>B</kbd> to toggle sidebar
    </div>
  </div>

  <div class="header">
    <div style="display: flex; align-items: center;">
      <button class="sidebar-toggle" id="sidebar-toggle" title="Open questionnaire list (B)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      <div>
        <h1>${this.escapeHtml(structure.source.filename)}</h1>
        <div class="meta">Indexed: ${indexed.indexed} | Language: ${indexed.language.toUpperCase()} | ${indexed.stats.total} items</div>
      </div>
    </div>
    <div class="toggles">
      <span id="connection-status" class="connection-status checking" title="Checking server connection..."></span>
      <button class="toggle active" data-panel="original" title="Toggle Original (1)">Original</button>
      <button class="toggle active" data-panel="indexed" title="Toggle Indexed (2)">Indexed</button>
      <button class="toggle" data-panel="library" title="Toggle Library (3)">Library</button>
      <div class="toggle-divider"></div>
      <button class="toggle" id="review-toggle" title="Toggle review mode (R)">Review</button>
      <button class="toggle" id="sync-toggle" title="Sync panels (S)">
        <span class="sync-icon">⟷</span> Sync
      </button>
      <button class="toggle" id="complete-toggle" title="Save approved data and apply learning rules">Complete Review</button>
      <button class="toggle" id="clear-toggle" title="Clear all feedback">Clear</button>
      <button class="toggle" id="help-toggle" title="Show shortcuts (?)">?</button>
    </div>
  </div>

  <div class="main">
    <!-- Original Excel View -->
    <div class="panel visible" id="panel-original">
      <div class="panel-header">
        <span>Original Questionnaire</span>
        <span class="count">${structure.sheets.length} sheets, ${structure.stats.filledCells} cells</span>
      </div>
      <div class="panel-content">
        <div class="sheet-tabs">
          ${structure.sheets.map((s, i) => `<button class="sheet-tab${i === 0 ? ' active' : ''}" data-sheet="${i}">${this.escapeHtml(s.name)}</button>`).join('')}
        </div>
        ${structure.sheets.map((sheet, i) => `
          <div class="sheet-content${i === 0 ? ' active' : ''}" data-sheet="${i}">
            ${this.buildSheetTable(sheet)}
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Indexed View -->
    <div class="panel visible" id="panel-indexed">
      <div class="panel-header">
        <span>Indexed Structure</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="count">${indexed.sections.length} sections, ${indexed.stats.total} items</span>
          <button class="group-btn accept-all" id="accept-all-indexed" title="Accept all indexed items">✓ Accept All</button>
          <button class="group-btn reject-all" id="reject-all-indexed" title="Reject all indexed items">✗ Reject All</button>
        </div>
      </div>
      <div class="panel-content">
        ${indexedHtml}
      </div>
    </div>

    <!-- Library View -->
    <div class="panel" id="panel-library">
      <div class="panel-header">
        <span>Harvested Library</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="count">${library ? library.total + ' items' : 'Not harvested'}</span>
          <button class="group-btn accept-all" id="accept-all-library" title="Accept all library items">✓ Accept All</button>
          <button class="group-btn reject-all" id="reject-all-library" title="Reject all library items">✗ Reject All</button>
        </div>
      </div>
      <div class="panel-content">
        ${libraryHtml}
      </div>
    </div>
  </div>

  <div class="stats-bar">
    <div class="stat">
      <span class="stat-label">Sections</span>
      <span class="stat-value">${indexed.sections.length}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Items</span>
      <span class="stat-value">${indexed.stats.total}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Answered</span>
      <span class="stat-value">${indexed.stats.answered}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Library</span>
      <span class="stat-value">${library ? library.total : 0}</span>
    </div>
  </div>

  <div class="tooltip" id="tooltip"></div>
  <div class="toast" id="toast"></div>

  <div class="help-overlay" id="help-overlay"></div>
  <div class="help-modal" id="help-modal">
    <h3>Keyboard Shortcuts</h3>
    <div class="shortcut-group">
      <div class="shortcut-group-title">Navigation</div>
      <div class="shortcut"><span>Next item</span><kbd>J</kbd></div>
      <div class="shortcut"><span>Previous item</span><kbd>K</kbd></div>
      <div class="shortcut"><span>Expand/collapse section</span><kbd>Enter</kbd></div>
    </div>
    <div class="shortcut-group">
      <div class="shortcut-group-title">Review Actions</div>
      <div class="shortcut"><span>Mark correct</span><kbd>C</kbd></div>
      <div class="shortcut"><span>Mark wrong</span><kbd>W</kbd></div>
      <div class="shortcut"><span>Edit item</span><kbd>E</kbd></div>
    </div>
    <div class="shortcut-group">
      <div class="shortcut-group-title">Panels & Modes</div>
      <div class="shortcut"><span>Toggle Original</span><kbd>1</kbd></div>
      <div class="shortcut"><span>Toggle Indexed</span><kbd>2</kbd></div>
      <div class="shortcut"><span>Toggle Library</span><kbd>3</kbd></div>
      <div class="shortcut"><span>Toggle Review mode</span><kbd>R</kbd></div>
      <div class="shortcut"><span>Toggle Sync mode</span><kbd>S</kbd></div>
    </div>
    <div class="shortcut-group">
      <div class="shortcut-group-title">Other</div>
      <div class="shortcut"><span>Toggle sidebar</span><kbd>B</kbd></div>
      <div class="shortcut"><span>Show this help</span><kbd>?</kbd></div>
      <div class="shortcut"><span>Clear selection</span><kbd>Esc</kbd></div>
    </div>
  </div>

  <script>
    // State
    let syncMode = false;
    let reviewMode = false;
    let sidebarOpen = false;
    let currentItemIndex = -1;
    const indexedItems = Array.from(document.querySelectorAll('#panel-indexed .item'));
    const libraryItems = Array.from(document.querySelectorAll('#panel-library .item'));
    const allItems = [...indexedItems, ...libraryItems];

    // Current questionnaire name (for highlighting in sidebar)
    const currentQuestionnaire = '${structure.source.filename.replace(/'/g, "\\'")}';

    // Server API base URL (same origin when served by review server)
    const API_BASE = window.location.port === '3456' ? '' : 'http://localhost:3456';
    let serverConnected = false;

    // Sidebar elements
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarClose = document.getElementById('sidebar-close');
    const questionnaireList = document.getElementById('questionnaire-list');

    // Toggle sidebar
    function toggleSidebar() {
      sidebarOpen = !sidebarOpen;
      sidebar.classList.toggle('open', sidebarOpen);
      sidebarOverlay.classList.toggle('visible', sidebarOpen);
      if (sidebarOpen) {
        loadQuestionnaires();
      }
    }

    // Close sidebar
    function closeSidebar() {
      sidebarOpen = false;
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('visible');
    }

    // Load questionnaires from API
    async function loadQuestionnaires() {
      if (!serverConnected) {
        questionnaireList.innerHTML = '<div class="sidebar-empty">Server not connected</div>';
        return;
      }

      try {
        const res = await fetch(API_BASE + '/api/questionnaires');
        if (!res.ok) throw new Error('Failed to fetch');

        const data = await res.json();
        renderQuestionnaires(data.questionnaires);
      } catch (e) {
        console.error('Failed to load questionnaires:', e);
        questionnaireList.innerHTML = '<div class="sidebar-empty">Failed to load questionnaires</div>';
      }
    }

    // Render questionnaire list
    function renderQuestionnaires(questionnaires) {
      if (!questionnaires || questionnaires.length === 0) {
        questionnaireList.innerHTML = '<div class="sidebar-empty">No questionnaires found</div>';
        return;
      }

      questionnaireList.innerHTML = questionnaires.map(q => {
        const isActive = currentQuestionnaire.includes(q.name.replace(/_/g, '-')) ||
                        currentQuestionnaire.includes(q.name) ||
                        q.name.includes(currentQuestionnaire.replace(/[^a-zA-Z0-9]/g, '_'));
        const badgeClass = q.feedbackCount > 0 ? 'has-feedback' : '';
        const badgeText = q.feedbackCount > 0 ? q.feedbackCount + ' reviewed' : 'Not started';

        return \`
          <a class="sidebar-item\${isActive ? ' active' : ''}"
             href="\${q.hasReview ? q.reviewUrl : '#'}"
             title="\${q.displayName}"
             \${!q.hasReview ? 'style="opacity: 0.5; pointer-events: none;"' : ''}>
            <span class="sidebar-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <line x1="10" y1="9" x2="8" y2="9"/>
              </svg>
            </span>
            <span class="sidebar-item-content">
              <div class="sidebar-item-name">\${q.displayName}</div>
              \${q.hasReview ? '' : '<div class="sidebar-item-meta">No review generated</div>'}
            </span>
            <span class="sidebar-item-badge \${badgeClass}">\${badgeText}</span>
          </a>
        \`;
      }).join('');
    }

    // Sidebar event listeners
    sidebarToggle.addEventListener('click', toggleSidebar);
    sidebarClose.addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // Check server connection
    async function checkServerConnection() {
      try {
        const res = await fetch(API_BASE + '/api/health');
        serverConnected = res.ok;
        updateConnectionStatus();
        return serverConnected;
      } catch {
        serverConnected = false;
        updateConnectionStatus();
        return false;
      }
    }

    // Update connection status indicator
    function updateConnectionStatus() {
      const indicator = document.getElementById('connection-status');
      if (indicator) {
        indicator.className = 'connection-status ' + (serverConnected ? 'connected' : 'disconnected');
        indicator.title = serverConnected ? 'Connected to server (auto-save enabled)' : 'Server not connected (using localStorage fallback)';
      }
    }

    // Load persisted state from server or localStorage
    async function loadPersistedState() {
      try {
        // Try server first
        if (await checkServerConnection()) {
          const res = await fetch(API_BASE + '/api/feedback');
          if (res.ok) {
            const data = await res.json();
            window.feedbackLog = [];

            // Restore from server data
            const allFeedback = [...(data.index || []), ...(data.library || [])];
            allFeedback.forEach(feedback => {
              const panel = data.library?.includes(feedback) ? 'library' : 'indexed';
              const item = findItemByKey(feedback.cells, feedback.label, panel);
              if (item) {
                item.classList.add('reviewed', feedback.action);
                if (feedback.reason) {
                  const noteDisplay = item.querySelector('.item-note-display');
                  if (noteDisplay) {
                    noteDisplay.textContent = feedback.reason;
                    item.classList.add('has-note');
                  }
                }
                if (feedback.editedLabel) {
                  const labelEl = item.querySelector('.item-label');
                  if (labelEl) labelEl.textContent = feedback.editedLabel;
                }
                if (feedback.editedValue) {
                  const valueEl = item.querySelector('.item-value');
                  if (valueEl) valueEl.textContent = feedback.editedValue;
                }
                window.feedbackLog.push({ ...feedback, panel });
              }
            });

            console.log('Loaded', allFeedback.length, 'feedback items from server');
          }
        } else {
          // Fallback to localStorage
          const saved = localStorage.getItem('review_fallback');
          if (saved) {
            const data = JSON.parse(saved);
            window.feedbackLog = data.feedbackLog || [];
            data.feedbackLog.forEach(feedback => {
              const item = findItemByKey(feedback.cells, feedback.label, feedback.panel);
              if (item) {
                item.classList.add('reviewed', feedback.action);
              }
            });
            console.log('Loaded', data.feedbackLog.length, 'feedback items from localStorage (offline mode)');
          }
        }

        // Update all section statuses
        document.querySelectorAll('.section, .library-topic').forEach(section => {
          const firstItem = section.querySelector('.item');
          if (firstItem) updateSectionStatus(firstItem);
        });

        updateFeedbackCount();
      } catch (e) {
        console.error('Failed to load persisted state:', e);
      }
    }

    // Find item by cells and label
    function findItemByKey(cells, label, panel) {
      const container = panel === 'library' ? '#panel-library' : '#panel-indexed';
      const items = document.querySelectorAll(container + ' .item');
      for (const item of items) {
        if (item.dataset.cells === cells && item.dataset.label === label) {
          return item;
        }
      }
      return null;
    }

    // Save feedback to server (or localStorage fallback)
    async function saveFeedback(panel, feedbackItem) {
      try {
        if (serverConnected) {
          const res = await fetch(API_BASE + '/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ panel, item: feedbackItem })
          });
          if (!res.ok) throw new Error('Server save failed');
          console.log('Saved to server:', feedbackItem.label);
        } else {
          // Fallback to localStorage
          window.feedbackLog = window.feedbackLog || [];
          window.feedbackLog.push({ ...feedbackItem, panel });
          localStorage.setItem('review_fallback', JSON.stringify({
            savedAt: new Date().toISOString(),
            feedbackLog: window.feedbackLog
          }));
          console.log('Saved to localStorage (offline):', feedbackItem.label);
        }
      } catch (e) {
        console.error('Failed to save feedback:', e);
        showToast('Failed to save - check server connection');
      }
    }

    // Legacy saveState function for compatibility
    function saveState() {
      // No-op - saving now happens per-item via saveFeedback()
    }

    // Utility: show toast
    function showToast(message) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 1500);
    }

    // Utility: clear all highlights
    function clearHighlights() {
      document.querySelectorAll('.selected, .highlighted, .current').forEach(el => {
        el.classList.remove('selected', 'highlighted', 'current');
      });
    }

    // Utility: highlight cells in original panel
    function highlightCells(cellRefs, className = 'highlighted') {
      if (!cellRefs) return;
      const cells = cellRefs.split(',');
      cells.forEach(ref => {
        const cell = document.querySelector('td[data-cell="' + ref + '"]');
        if (cell) {
          cell.classList.add(className);
          cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
      });
    }

    // Utility: find matching items by label
    function findMatchingItems(label, excludeItem) {
      const matches = [];
      allItems.forEach(item => {
        if (item !== excludeItem && item.dataset.label === label) {
          matches.push(item);
        }
      });
      return matches;
    }

    // Utility: find matching items by cells
    function findMatchingItemsByCells(cellRefs, excludeItem) {
      if (!cellRefs) return [];
      const matches = [];
      const cells = cellRefs.split(',');
      allItems.forEach(item => {
        if (item === excludeItem) return;
        const itemCells = (item.dataset.cells || '').split(',');
        if (cells.some(c => itemCells.includes(c))) {
          matches.push(item);
        }
      });
      return matches;
    }

    // Select an item and sync across panels
    function selectItem(item, source = 'click') {
      clearHighlights();
      if (!item) return;

      item.classList.add('selected');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      if (syncMode) {
        // Highlight cells in original
        const cells = item.dataset.cells;
        highlightCells(cells, 'highlighted');

        // Find matching items in other panels
        const matches = findMatchingItemsByCells(cells, item);
        matches.forEach(m => {
          m.classList.add('highlighted');
        });

        // Also try matching by label
        const labelMatches = findMatchingItems(item.dataset.label, item);
        labelMatches.forEach(m => {
          if (!m.classList.contains('highlighted')) {
            m.classList.add('highlighted');
          }
        });
      }
    }

    // Select cell in original and find matching items
    function selectCell(cell) {
      clearHighlights();
      if (!cell) return;

      cell.classList.add('selected');

      if (syncMode) {
        const cellRef = cell.dataset.cell;
        // Find items that reference this cell
        allItems.forEach(item => {
          const itemCells = (item.dataset.cells || '').split(',');
          if (itemCells.includes(cellRef)) {
            item.classList.add('highlighted');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
      }
    }

    // Panel toggles
    const panelToggles = document.querySelectorAll('.toggle[data-panel]');
    panelToggles.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        const panel = document.getElementById('panel-' + btn.dataset.panel);
        panel.classList.toggle('visible');
      });
    });

    // Review mode toggle
    const reviewToggle = document.getElementById('review-toggle');
    reviewToggle.addEventListener('click', () => {
      reviewMode = !reviewMode;
      reviewToggle.classList.toggle('active', reviewMode);
      document.body.classList.toggle('review-mode', reviewMode);
      showToast(reviewMode ? 'Review mode ON' : 'Review mode OFF');
    });

    // Sync mode toggle
    const syncToggle = document.getElementById('sync-toggle');
    syncToggle.addEventListener('click', () => {
      syncMode = !syncMode;
      syncToggle.classList.toggle('active', syncMode);
      document.body.classList.toggle('sync-mode', syncMode);
      showToast(syncMode ? 'Sync mode ON' : 'Sync mode OFF');
      if (!syncMode) clearHighlights();
    });

    // Help toggle
    const helpToggle = document.getElementById('help-toggle');
    const helpModal = document.getElementById('help-modal');
    const helpOverlay = document.getElementById('help-overlay');

    function toggleHelp() {
      helpModal.classList.toggle('visible');
      helpOverlay.classList.toggle('visible');
    }
    helpToggle.addEventListener('click', toggleHelp);
    helpOverlay.addEventListener('click', toggleHelp);

    // Sheet tabs
    document.querySelectorAll('.sheet-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sheet-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector('.sheet-content[data-sheet="' + tab.dataset.sheet + '"]').classList.add('active');
      });
    });

    // Section collapse
    document.querySelectorAll('.section-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.item')) return;
        header.parentElement.classList.toggle('collapsed');
      });
    });

    // Cell tooltip and click
    const tooltip = document.getElementById('tooltip');
    document.querySelectorAll('.excel-table td[data-cell]').forEach(cell => {
      cell.addEventListener('mouseenter', (e) => {
        const rect = cell.getBoundingClientRect();
        tooltip.innerHTML = '<strong>' + cell.dataset.cell + '</strong><br>' + (cell.title || '(empty)');
        tooltip.style.left = rect.right + 10 + 'px';
        tooltip.style.top = rect.top + 'px';
        tooltip.classList.add('visible');
      });
      cell.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
      });
      cell.addEventListener('click', () => {
        selectCell(cell);
      });
    });

    // Item click for sync
    allItems.forEach((item, idx) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn')) return;
        currentItemIndex = indexedItems.indexOf(item);
        if (currentItemIndex === -1) currentItemIndex = indexedItems.length + libraryItems.indexOf(item);
        selectItem(item, 'click');
      });
    });

    // Review actions
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.item');

        if (btn.classList.contains('correct')) {
          item.classList.remove('wrong', 'rejected', 'show-note');
          item.classList.add('reviewed', 'correct', 'accepted');
          showToast('Accepted');
          logFeedback(item, 'correct');
        } else if (btn.classList.contains('wrong')) {
          // Show note input
          item.classList.add('show-note');
          const input = item.querySelector('.wrong-note-input');
          if (input) input.focus();
        } else if (btn.classList.contains('edit')) {
          startEdit(item);
        }
      });
    });

    // Wrong note save/cancel
    document.querySelectorAll('.wrong-note-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.item');
        const input = item.querySelector('.wrong-note-input');

        if (btn.classList.contains('save')) {
          item.classList.remove('correct', 'accepted', 'show-note');
          item.classList.add('reviewed', 'wrong', 'rejected');
          const note = input?.value || '';
          showToast(note ? 'Marked as wrong with note' : 'Marked as wrong');
          logFeedback(item, 'wrong', note);
          if (input) input.value = '';
        } else {
          // Cancel
          item.classList.remove('show-note');
          if (input) input.value = '';
        }
      });
    });

    // Enter key in note input saves
    document.querySelectorAll('.wrong-note-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.closest('.item').querySelector('.wrong-note-btn.save')?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          input.closest('.item').querySelector('.wrong-note-btn.cancel')?.click();
        }
      });
    });

    // Log feedback
    async function logFeedback(item, action, note = '') {
      const panel = item.closest('.panel')?.id?.replace('panel-', '') || 'indexed';
      const feedbackItem = {
        action: action === 'correct' ? 'accepted' : action === 'wrong' ? 'rejected' : action,
        label: item.querySelector('.item-label')?.textContent,
        value: item.querySelector('.item-value')?.textContent,
        cells: item.dataset.cells,
        topic: item.dataset.topic,
        section: item.dataset.section,
        reason: note || undefined,
        reviewedAt: new Date().toISOString()
      };
      console.log('Feedback:', feedbackItem);

      // Show note persistently if provided
      if (note) {
        const noteDisplay = item.querySelector('.item-note-display');
        if (noteDisplay) {
          noteDisplay.textContent = note;
          item.classList.add('has-note');
        }
      }

      // Store in session for potential export
      window.feedbackLog = window.feedbackLog || [];
      window.feedbackLog.push({ ...feedbackItem, panel });
      updateFeedbackCount();
      updateSectionStatus(item);

      // Save to server (or localStorage fallback)
      await saveFeedback(panel, feedbackItem);
    }

    // Edit item (inline editing)
    function startEdit(item) {
      if (item.classList.contains('editing')) return;
      item.classList.add('editing');

      const labelEl = item.querySelector('.item-label');
      const valueEl = item.querySelector('.item-value');
      const originalLabel = labelEl.textContent;
      const originalValue = valueEl.textContent;

      // Replace with inputs
      labelEl.innerHTML = '<input type="text" class="edit-input edit-label" value="' + escapeAttr(originalLabel) + '" placeholder="Label">';
      valueEl.innerHTML = '<input type="text" class="edit-input edit-value" value="' + escapeAttr(originalValue) + '" placeholder="Value">';

      // Add save/cancel buttons
      const actionsEl = item.querySelector('.item-actions');
      const editActions = document.createElement('div');
      editActions.className = 'edit-actions';
      editActions.innerHTML = '<button class="edit-btn save">Save</button><button class="edit-btn cancel">Cancel</button>';
      actionsEl.parentNode.insertBefore(editActions, actionsEl.nextSibling);

      // Focus label input
      item.querySelector('.edit-label').focus();

      // Save handler
      editActions.querySelector('.save').addEventListener('click', async () => {
        const newLabel = item.querySelector('.edit-label').value;
        const newValue = item.querySelector('.edit-value').value;

        labelEl.textContent = newLabel;
        valueEl.textContent = newValue || '(empty)';
        valueEl.classList.toggle('empty', !newValue);

        item.classList.remove('editing');
        item.classList.add('reviewed', 'edited');
        editActions.remove();

        // Log as edited
        const panel = item.closest('.panel')?.id?.replace('panel-', '') || 'indexed';
        const feedbackItem = {
          action: 'edited',
          label: originalLabel,
          value: originalValue,
          editedLabel: newLabel !== originalLabel ? newLabel : undefined,
          editedValue: newValue !== originalValue ? newValue : undefined,
          cells: item.dataset.cells,
          section: item.dataset.section,
          topic: item.dataset.topic,
          reviewedAt: new Date().toISOString()
        };
        window.feedbackLog = window.feedbackLog || [];
        window.feedbackLog.push({ ...feedbackItem, panel });
        updateFeedbackCount();
        updateSectionStatus(item);
        await saveFeedback(panel, feedbackItem);
        showToast('Item edited');
      });

      // Cancel handler
      editActions.querySelector('.cancel').addEventListener('click', () => {
        labelEl.textContent = originalLabel;
        valueEl.textContent = originalValue;
        item.classList.remove('editing');
        editActions.remove();
      });

      // Enter to save, Escape to cancel
      item.querySelectorAll('.edit-input').forEach(input => {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') editActions.querySelector('.save').click();
          if (e.key === 'Escape') editActions.querySelector('.cancel').click();
        });
      });
    }

    function escapeAttr(str) {
      return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Update feedback count in complete button
    function updateFeedbackCount() {
      const count = window.feedbackLog?.length || 0;
      const completeBtn = document.getElementById('complete-toggle');
      completeBtn.textContent = count > 0 ? 'Complete Review (' + count + ')' : 'Complete Review';
      if (count > 0) completeBtn.classList.add('has-feedback');
      else completeBtn.classList.remove('has-feedback');
    }

    // Update section status (e.g., "5/10 ✓")
    function updateSectionStatus(item) {
      const section = item.closest('.section') || item.closest('.library-topic');
      if (!section) return;

      const allItems = section.querySelectorAll('.item');
      const reviewed = section.querySelectorAll('.item.reviewed');
      const rejected = section.querySelectorAll('.item.reviewed.wrong');

      const statusEl = section.querySelector('.section-status');
      if (statusEl) {
        const total = allItems.length;
        const reviewedCount = reviewed.length;
        statusEl.textContent = reviewedCount + '/' + total;

        statusEl.classList.remove('all-reviewed', 'has-rejected');
        if (reviewedCount === total) {
          statusEl.classList.add('all-reviewed');
          statusEl.textContent += ' ✓';
        }
        if (rejected.length > 0) {
          statusEl.classList.add('has-rejected');
        }
      }
    }

    // Group actions for sections and library topics
    document.querySelectorAll('.group-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const container = btn.closest('.section') || btn.closest('.library-topic');
        const items = container.querySelectorAll('.item:not(.reviewed)');
        const isAccept = btn.classList.contains('accept-all');

        items.forEach(item => {
          if (isAccept) {
            item.classList.remove('wrong');
            item.classList.add('reviewed', 'correct');
            logFeedback(item, 'correct');
          } else {
            // For reject all, just mark without notes
            item.classList.remove('correct');
            item.classList.add('reviewed', 'wrong');
            logFeedback(item, 'wrong');
          }
        });

        const action = isAccept ? 'accepted' : 'rejected';
        showToast(items.length + ' items ' + action);
      });
    });

    // Panel-level Accept/Reject All buttons
    document.getElementById('accept-all-indexed')?.addEventListener('click', () => {
      const items = document.querySelectorAll('#panel-indexed .item');
      items.forEach(item => {
        item.classList.remove('wrong', 'rejected', 'show-note');
        item.classList.add('reviewed', 'correct', 'accepted');
        logFeedback(item, 'correct');
      });
      showToast(items.length + ' indexed items accepted');
    });

    document.getElementById('reject-all-indexed')?.addEventListener('click', () => {
      const items = document.querySelectorAll('#panel-indexed .item');
      items.forEach(item => {
        item.classList.remove('correct', 'accepted');
        item.classList.add('reviewed', 'wrong', 'rejected');
        logFeedback(item, 'wrong');
      });
      showToast(items.length + ' indexed items rejected');
    });

    document.getElementById('accept-all-library')?.addEventListener('click', () => {
      const items = document.querySelectorAll('#panel-library .item');
      items.forEach(item => {
        item.classList.remove('wrong', 'rejected', 'show-note');
        item.classList.add('reviewed', 'correct', 'accepted');
        logFeedback(item, 'correct');
      });
      showToast(items.length + ' library items accepted');
    });

    document.getElementById('reject-all-library')?.addEventListener('click', () => {
      const items = document.querySelectorAll('#panel-library .item');
      items.forEach(item => {
        item.classList.remove('correct', 'accepted');
        item.classList.add('reviewed', 'wrong', 'rejected');
        logFeedback(item, 'wrong');
      });
      showToast(items.length + ' library items rejected');
    });

    // Complete Review - saves approved data AND applies learning rules
    document.getElementById('complete-toggle').addEventListener('click', completeReview);

    async function completeReview() {
      if (!window.feedbackLog || window.feedbackLog.length === 0) {
        showToast('No feedback to save');
        return;
      }

      if (!serverConnected) {
        showToast('Server not connected');
        return;
      }

      try {
        // 1. Save approved items to database files
        const exportRes = await fetch(API_BASE + '/api/export-approved', { method: 'POST' });
        if (!exportRes.ok) throw new Error('Failed to export approved');
        const exportResult = await exportRes.json();

        // 2. Apply learning rules from rejections/edits
        const rulesRes = await fetch(API_BASE + '/api/apply-rules', { method: 'POST' });
        if (!rulesRes.ok) throw new Error('Failed to apply rules');
        const rulesResult = await rulesRes.json();

        // Show summary
        const entityCount = exportResult.exported?.entityDb?.length || 0;
        const libraryCount = exportResult.exported?.answerLibrary?.length || 0;
        const rulesCount = (rulesResult.rules?.indexRules?.exclude?.length || 0) +
                          (rulesResult.rules?.indexRules?.corrections?.length || 0) +
                          (rulesResult.rules?.harvestRules?.exclude?.length || 0) +
                          (rulesResult.rules?.harvestRules?.corrections?.length || 0);

        showToast('Saved ' + entityCount + ' entity, ' + libraryCount + ' library, ' + rulesCount + ' rules');
        console.log('Review completed:', { exportResult, rulesResult });
      } catch (e) {
        console.error('Failed to complete review:', e);
        showToast('Failed to complete - check console');
      }
    }

    // Clear all feedback
    document.getElementById('clear-toggle').addEventListener('click', async () => {
      if (!window.feedbackLog || window.feedbackLog.length === 0) {
        showToast('Nothing to clear');
        return;
      }

      if (confirm('Clear all ' + window.feedbackLog.length + ' feedback items? This cannot be undone.')) {
        // Clear on server if connected
        if (serverConnected) {
          try {
            await fetch(API_BASE + '/api/feedback', { method: 'DELETE' });
          } catch (e) {
            console.error('Failed to clear on server:', e);
          }
        }

        // Clear local state
        window.feedbackLog = [];
        localStorage.removeItem('review_fallback');

        // Reset all item states
        document.querySelectorAll('.item').forEach(item => {
          item.classList.remove('reviewed', 'correct', 'wrong', 'accepted', 'rejected', 'edited', 'has-note');
          const noteDisplay = item.querySelector('.item-note-display');
          if (noteDisplay) noteDisplay.textContent = '';
        });

        // Reset section statuses
        document.querySelectorAll('.section-status').forEach(status => {
          const total = status.dataset.total;
          status.textContent = '0/' + total;
          status.classList.remove('all-reviewed', 'has-rejected');
        });

        updateFeedbackCount();
        showToast('Cleared all feedback');
      }
    });

    // Page unload - no warning needed since we auto-save
    window.addEventListener('beforeunload', () => {
      // Auto-save is enabled, no need to warn
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();

      // Help
      if (key === '?' || (e.shiftKey && key === '/')) {
        e.preventDefault();
        toggleHelp();
        return;
      }

      // Close help/sidebar/clear selection with Escape
      if (key === 'escape') {
        if (helpModal.classList.contains('visible')) {
          toggleHelp();
        } else if (sidebarOpen) {
          closeSidebar();
        } else {
          clearHighlights();
          currentItemIndex = -1;
        }
        return;
      }

      // Sidebar toggle
      if (key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Panel toggles
      if (key === '1') {
        e.preventDefault();
        document.querySelector('.toggle[data-panel="original"]').click();
        return;
      }
      if (key === '2') {
        e.preventDefault();
        document.querySelector('.toggle[data-panel="indexed"]').click();
        return;
      }
      if (key === '3') {
        e.preventDefault();
        document.querySelector('.toggle[data-panel="library"]').click();
        return;
      }

      // Review mode
      if (key === 'r') {
        e.preventDefault();
        reviewToggle.click();
        return;
      }

      // Sync mode
      if (key === 's') {
        e.preventDefault();
        syncToggle.click();
        return;
      }

      // Navigation (j/k)
      if (key === 'j') {
        e.preventDefault();
        currentItemIndex = Math.min(currentItemIndex + 1, indexedItems.length - 1);
        if (currentItemIndex >= 0) {
          clearHighlights();
          indexedItems[currentItemIndex].classList.add('current');
          indexedItems[currentItemIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          if (syncMode) selectItem(indexedItems[currentItemIndex], 'keyboard');
        }
        return;
      }
      if (key === 'k') {
        e.preventDefault();
        currentItemIndex = Math.max(currentItemIndex - 1, 0);
        if (currentItemIndex >= 0 && indexedItems[currentItemIndex]) {
          clearHighlights();
          indexedItems[currentItemIndex].classList.add('current');
          indexedItems[currentItemIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          if (syncMode) selectItem(indexedItems[currentItemIndex], 'keyboard');
        }
        return;
      }

      // Review actions (c/w/e) - only if item is selected
      if (currentItemIndex >= 0 && currentItemIndex < indexedItems.length) {
        const currentItem = indexedItems[currentItemIndex];
        if (key === 'c') {
          e.preventDefault();
          currentItem.querySelector('.action-btn.correct')?.click();
          return;
        }
        if (key === 'w') {
          e.preventDefault();
          currentItem.querySelector('.action-btn.wrong')?.click();
          return;
        }
        if (key === 'e') {
          e.preventDefault();
          currentItem.querySelector('.action-btn.edit')?.click();
          return;
        }
      }

      // Enter to expand/collapse section
      if (key === 'enter' && currentItemIndex >= 0) {
        e.preventDefault();
        const currentItem = indexedItems[currentItemIndex];
        const section = currentItem?.closest('.section');
        if (section) {
          section.classList.toggle('collapsed');
        }
        return;
      }
    });

    // Initialize: load persisted state and enable sync mode
    loadPersistedState();
    syncToggle.click();
  </script>
</body>
</html>`;
  }

  /**
   * Build Excel sheet table
   */
  private buildSheetTable(sheet: SheetData): string {
    // Find column range
    const allCols = new Set<string>();
    let maxRow = 0;

    for (const row of sheet.rows) {
      maxRow = Math.max(maxRow, row.row);
      for (const col of Object.keys(row.cells)) {
        allCols.add(col);
      }
    }

    const cols = Array.from(allCols).sort((a, b) => this.colToNum(a) - this.colToNum(b));
    const displayCols = cols.slice(0, 15); // Limit columns
    const maxDisplayRow = Math.min(maxRow, 100); // Limit rows

    // Build rows map
    const rowsMap = new Map<number, typeof sheet.rows[0]>();
    for (const row of sheet.rows) {
      rowsMap.set(row.row, row);
    }

    let tableRows = '';
    for (let r = 1; r <= maxDisplayRow; r++) {
      const row = rowsMap.get(r);
      let cells = `<td class="row-num">${r}</td>`;

      for (const col of displayCols) {
        const cell = row?.cells[col];
        if (cell && cell.filled) {
          const roleClass = cell.role ? `role-${cell.role}` : '';
          const value = this.escapeHtml(cell.value.substring(0, 80));
          cells += `<td class="${roleClass}" data-cell="${cell.ref}" title="${this.escapeHtml(cell.value)}">${value}</td>`;
        } else {
          cells += `<td class="empty"></td>`;
        }
      }

      tableRows += `<tr>${cells}</tr>`;
    }

    // Header
    let headerCells = '<th>#</th>';
    for (const col of displayCols) {
      headerCells += `<th>${col}</th>`;
    }

    return `<table class="excel-table">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
  }

  /**
   * Build indexed sections view
   * INDEX = just identify topics and locations, no storage decisions
   */
  private buildIndexedView(indexed: IndexedQuestionnaire): string {
    let itemIndex = 0;
    return indexed.sections.map(section => {
      const itemsHtml = section.items.map(item => {
        const idx = itemIndex++;
        const cells = [item.lCell, item.vCell].filter(Boolean).join(',');
        return `
        <div class="item" data-index="${idx}" data-cells="${cells}" data-label="${this.escapeHtml(item.label)}" data-section="${this.escapeHtml(section.title)}" data-topic="${section.topic}">
          <div class="item-header">
            <span class="item-label">${this.escapeHtml(item.label)}</span>
            <span class="item-meta">${item.lCell || ''}${item.vCell ? ' → ' + item.vCell : ''}</span>
          </div>
          <div class="item-value${item.value ? '' : ' empty'}">${item.value ? this.escapeHtml(item.value) : '(empty)'}</div>
          <div class="item-note-display"></div>
          <div class="item-actions review-only">
            <button class="action-btn correct" title="Accept (C)">✓</button>
            <button class="action-btn wrong" title="Reject (W)">✗</button>
            <button class="action-btn edit" title="Edit (E)">✎</button>
          </div>
          <div class="wrong-note-container">
            <input type="text" class="wrong-note-input" placeholder="Optional: Why is this wrong? (for extraction rules)">
            <div class="wrong-note-actions">
              <button class="wrong-note-btn save">Save as Wrong</button>
              <button class="wrong-note-btn cancel">Cancel</button>
            </div>
          </div>
        </div>
      `}).join('');

      return `
        <div class="section" data-section="${this.escapeHtml(section.title)}">
          <div class="section-header">
            <div class="section-header-left">
              <span class="section-title">${this.escapeHtml(section.title)}</span>
              <span class="section-meta">
                Rows ${section.rows}
                <span class="topic">${section.topic}</span>
              </span>
            </div>
            <div class="section-header-right">
              <span class="section-status" data-total="${section.items.length}">0/${section.items.length}</span>
              <div class="group-actions review-only">
                <button class="group-btn accept-all" title="Accept all">✓ All</button>
                <button class="group-btn reject-all" title="Reject all">✗ All</button>
              </div>
            </div>
          </div>
          <div class="section-items">${itemsHtml}</div>
        </div>
      `;
    }).join('');
  }

  /**
   * Build library view
   */
  private buildLibraryView(library: AnswerLibrary): string {
    // Legend at top
    const legend = `
      <div class="legend">
        <div class="legend-item"><span class="legend-color entity-db"></span>Entity DB</div>
        <div class="legend-item"><span class="legend-color answer-library"></span>Answer Library</div>
      </div>
    `;

    const topicsHtml = Object.entries(library.byTopic).map(([topic, items]) => `
      <div class="library-topic" data-topic="${topic}">
        <div class="library-topic-header">
          <span>${topic} (${items.length})</span>
          <div class="group-actions">
            <button class="group-btn accept-all" title="Accept all in ${topic}">✓ All</button>
            <button class="group-btn reject-all" title="Reject all in ${topic}">✗ All</button>
          </div>
        </div>
        ${items.map(item => {
          const cells = [item.source.lCell, item.source.vCell].filter(Boolean).join(',');
          return `
          <div class="item ${item.level}" data-cells="${cells}" data-label="${this.escapeHtml(item.label)}" data-topic="${topic}">
            <div class="item-header">
              <span class="item-label">${this.escapeHtml(item.label)}</span>
              <span class="item-meta">${item.source.lCell || ''}${item.source.vCell ? ' → ' + item.source.vCell : ''}</span>
            </div>
            <div class="item-value">${this.escapeHtml(item.value)}</div>
            <div class="item-note-display"></div>
            <div class="item-actions review-only">
              <button class="action-btn correct" title="Accept (C)">✓</button>
              <button class="action-btn wrong" title="Reject (W)">✗</button>
              <button class="action-btn edit" title="Edit (E)">✎</button>
            </div>
            <div class="wrong-note-container">
              <input type="text" class="wrong-note-input" placeholder="Optional: Why reject this?">
              <div class="wrong-note-actions">
                <button class="wrong-note-btn save">Reject</button>
                <button class="wrong-note-btn cancel">Cancel</button>
              </div>
            </div>
          </div>
        `}).join('')}
      </div>
    `).join('');

    return legend + topicsHtml;
  }

  private colToNum(col: string): number {
    let num = 0;
    for (let i = 0; i < col.length; i++) {
      num = num * 26 + (col.charCodeAt(i) - 64);
    }
    return num;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Build the single-page app shell HTML
   * Loads questionnaire data dynamically from API
   */
  private buildAppShellHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Passionfruit Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --background: #09090b;
      --foreground: #fafafa;
      --card: #0a0a0c;
      --card-foreground: #fafafa;
      --muted: #27272a;
      --muted-foreground: #a1a1aa;
      --border: #27272a;
      --input: #27272a;
      --primary: #fafafa;
      --primary-foreground: #18181b;
      --secondary: #27272a;
      --secondary-foreground: #fafafa;
      --accent: #27272a;
      --accent-foreground: #fafafa;
      --destructive: #7f1d1d;
      --radius: 6px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--background);
      color: var(--foreground);
      height: 100vh;
      overflow: hidden;
      font-size: 14px;
      line-height: 1.5;
    }

    /* Loading state */
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      gap: 16px;
    }
    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border);
      border-top-color: var(--foreground);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .loading-text {
      color: var(--muted-foreground);
    }

    /* Welcome screen (no questionnaire selected) */
    .welcome-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      gap: 24px;
      padding: 40px;
    }
    .welcome-title {
      font-size: 24px;
      font-weight: 600;
    }
    .welcome-subtitle {
      color: var(--muted-foreground);
      max-width: 400px;
      text-align: center;
    }
    .questionnaire-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 500px;
      width: 100%;
      max-height: 400px;
      overflow-y: auto;
    }
    .questionnaire-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      transition: all 0.15s ease;
      text-decoration: none;
      color: inherit;
    }
    .questionnaire-item:hover {
      background: var(--accent);
      border-color: var(--muted-foreground);
    }
    .questionnaire-name {
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .questionnaire-meta {
      font-size: 12px;
      color: var(--muted-foreground);
    }

    /* Header */
    .header {
      background: var(--card);
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .header h1 {
      font-size: 14px;
      font-weight: 600;
      color: var(--foreground);
    }
    .header .meta {
      font-size: 12px;
      color: var(--muted-foreground);
      margin-top: 2px;
    }
    .app-title {
      font-size: 12px;
      color: var(--muted-foreground);
      margin-bottom: 2px;
    }

    /* View toggles */
    .toggles {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .toggle {
      padding: 6px 12px;
      background: var(--secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--muted-foreground);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .toggle:hover {
      background: var(--accent);
      color: var(--foreground);
    }
    .toggle.active {
      background: var(--foreground);
      color: var(--background);
      border-color: var(--foreground);
    }
    .toggle-divider {
      width: 1px;
      height: 20px;
      background: var(--border);
      margin: 0 4px;
    }

    /* Connection status */
    .connection-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 8px;
    }
    .connection-status.connected { background: #22c55e; }
    .connection-status.disconnected { background: #ef4444; }
    .connection-status.checking { background: #f59e0b; animation: pulse 1s infinite; }
    @keyframes pulse { 50% { opacity: 0.5; } }

    /* Sidebar toggle */
    .sidebar-toggle {
      background: transparent;
      border: none;
      color: var(--muted-foreground);
      cursor: pointer;
      padding: 8px;
      margin-right: 12px;
      border-radius: var(--radius);
      transition: all 0.15s ease;
    }
    .sidebar-toggle:hover {
      background: var(--muted);
      color: var(--foreground);
    }
    .sidebar-toggle svg {
      width: 20px;
      height: 20px;
    }

    /* Main layout */
    .main {
      display: flex;
      height: calc(100vh - 56px - 40px);
      overflow: hidden;
    }

    /* Panels */
    .panel {
      flex: 1;
      display: none;
      flex-direction: column;
      border-right: 1px solid var(--border);
      overflow: hidden;
      min-width: 0;
    }
    .panel.visible { display: flex; }
    .panel:last-child { border-right: none; }
    .panel-header {
      padding: 12px 16px;
      background: var(--card);
      border-bottom: 1px solid var(--border);
      font-weight: 500;
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .panel-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    /* Sidebar */
    .sidebar {
      width: 280px;
      background: var(--card);
      border-right: 1px solid var(--border);
      display: none;
      flex-direction: column;
      flex-shrink: 0;
    }
    .sidebar.open { display: flex; }
    .sidebar-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      font-weight: 500;
      font-size: 13px;
    }
    .sidebar-content {
      flex: 1;
      overflow-y: auto;
    }
    .sidebar-item {
      display: flex;
      align-items: center;
      padding: 10px 16px;
      cursor: pointer;
      transition: background 0.15s ease;
      border-bottom: 1px solid var(--border);
      text-decoration: none;
      color: inherit;
    }
    .sidebar-item:hover { background: var(--muted); }
    .sidebar-item.active { background: var(--accent); border-left: 2px solid var(--foreground); }
    .sidebar-item-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .sidebar-item-badge {
      font-size: 11px;
      padding: 2px 6px;
      background: var(--muted);
      border-radius: 10px;
      color: var(--muted-foreground);
    }

    /* Excel table */
    .sheet-tabs {
      display: flex;
      gap: 4px;
      padding: 8px 16px;
      background: var(--card);
      border-bottom: 1px solid var(--border);
    }
    .sheet-tab {
      padding: 6px 12px;
      background: var(--secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .sheet-tab:hover { background: var(--accent); }
    .sheet-tab.active {
      background: var(--foreground);
      color: var(--background);
    }
    .sheet-content { display: none; }
    .sheet-content.active { display: block; }

    .excel-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .excel-table th, .excel-table td {
      border: 1px solid var(--border);
      padding: 6px 10px;
      text-align: left;
      white-space: nowrap;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .excel-table th {
      background: var(--muted);
      font-weight: 500;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .excel-table .row-header {
      background: var(--muted);
      color: var(--muted-foreground);
      font-weight: 500;
      text-align: center;
      width: 40px;
    }
    .excel-table tr:hover td:not(.row-header) {
      background: rgba(255,255,255,0.03);
    }
    .excel-table td.highlighted {
      background: rgba(59, 130, 246, 0.2) !important;
      outline: 2px solid #3b82f6;
    }
    /* Cell formatting */
    .excel-table td.cell-bold { font-weight: 600; }
    .excel-table td.cell-italic { font-style: italic; }
    .excel-table td.cell-header {
      background: rgba(59, 130, 246, 0.1);
      font-weight: 600;
    }
    .excel-table td.cell-label {
      color: var(--muted-foreground);
    }
    .excel-table td.cell-section {
      background: var(--muted);
      font-weight: 600;
      color: var(--foreground);
    }
    .excel-table tr.row-header-type td:not(.row-header) {
      background: rgba(59, 130, 246, 0.08);
    }
    .excel-table tr.row-section-type td:not(.row-header) {
      background: var(--muted);
    }
    .excel-table td.cell-merged-hidden { display: none; }

    /* Level badges */
    .level-badge {
      display: inline-block;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      margin-left: 6px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      opacity: 0.8;
      vertical-align: middle;
    }
    .level-badge.entity {
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
    }
    .level-badge.product {
      background: rgba(168, 85, 247, 0.2);
      color: #c084fc;
    }
    .level-badge.library {
      background: rgba(34, 197, 94, 0.2);
      color: #4ade80;
    }

    /* Cell selection for label/value pairing */
    .excel-table td.label-selected {
      background: rgba(251, 191, 36, 0.3) !important;
      outline: 2px solid #fbbf24;
    }
    .excel-table td.value-selected {
      background: rgba(34, 197, 94, 0.3) !important;
      outline: 2px solid #22c55e;
    }

    /* Items */
    .section {
      margin-bottom: 24px;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--muted);
      border-radius: var(--radius);
      margin-bottom: 8px;
      cursor: pointer;
    }
    .section-title {
      font-weight: 600;
      font-size: 13px;
    }
    .section-meta {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .section-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--background);
    }
    .section-items {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-left: 12px;
    }
    .section.collapsed .section-items { display: none; }

    .item {
      padding: 12px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .item:hover { border-color: var(--muted-foreground); }
    .item.selected {
      border-color: #3b82f6;
      box-shadow: 0 0 0 1px #3b82f6;
    }
    .item.reviewed.correct, .item.reviewed.accepted {
      border-left: 3px solid #22c55e;
      background: rgba(34, 197, 94, 0.05);
    }
    .item.reviewed.wrong, .item.reviewed.rejected {
      border-left: 3px solid #ef4444;
      background: rgba(239, 68, 68, 0.05);
    }

    .item-label {
      font-size: 12px;
      color: var(--muted-foreground);
      margin-bottom: 4px;
    }
    .item-value {
      font-size: 13px;
      color: var(--foreground);
      background: var(--muted);
      padding: 8px 12px;
      border-radius: var(--radius);
    }
    .item-value.empty {
      color: var(--muted-foreground);
      font-style: italic;
    }
    .item-ref {
      font-size: 10px;
      color: var(--muted-foreground);
      margin-top: 8px;
      font-family: ui-monospace, monospace;
    }

    /* Review actions */
    .item-actions {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }
    .review-only { display: none; }
    body.review-mode .review-only { display: flex; }

    .action-btn {
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      background: var(--background);
      color: var(--muted-foreground);
    }
    .action-btn:hover {
      background: var(--muted);
      color: var(--foreground);
    }
    .action-btn.correct:hover { background: #14532d; color: #4ade80; border-color: #166534; }
    .action-btn.wrong:hover { background: #7f1d1d; color: #fca5a5; border-color: #991b1b; }

    /* Keep action buttons visible on reviewed items */
    .item.reviewed .item-actions { opacity: 0.6; }
    .item.reviewed:hover .item-actions { opacity: 1; }
    .item.reviewed.correct .action-btn.correct,
    .item.reviewed.accepted .action-btn.correct { background: #14532d; color: #4ade80; border-color: #166534; }
    .item.reviewed.wrong .action-btn.wrong,
    .item.reviewed.rejected .action-btn.wrong { background: #7f1d1d; color: #fca5a5; border-color: #991b1b; }

    /* Wrong note input */
    .wrong-note-container {
      display: none;
      margin-top: 8px;
    }
    .item.show-note .wrong-note-container { display: block; }
    .wrong-note-input {
      width: 100%;
      padding: 6px 10px;
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--foreground);
      font-size: 12px;
    }
    .wrong-note-btns {
      display: flex;
      gap: 4px;
      margin-top: 4px;
    }
    .wrong-note-btn {
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 11px;
      cursor: pointer;
      background: var(--background);
      color: var(--muted-foreground);
    }
    .wrong-note-btn.save { background: #7f1d1d; color: #fca5a5; border-color: #991b1b; }

    /* Group buttons */
    .group-btns {
      display: flex;
      gap: 4px;
    }
    .group-btn {
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 11px;
      cursor: pointer;
      background: var(--background);
      color: var(--muted-foreground);
      transition: all 0.15s ease;
    }
    .group-btn:hover {
      background: var(--muted);
      color: var(--foreground);
    }
    .group-btn.accept-all:hover { background: #14532d; color: #4ade80; }
    .group-btn.reject-all:hover { background: #7f1d1d; color: #fca5a5; }

    /* Stats bar */
    .stats-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 20px;
      background: var(--card);
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--muted-foreground);
    }
    .stats-bar .stat {
      display: flex;
      gap: 16px;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--foreground);
      color: var(--background);
      padding: 10px 20px;
      border-radius: var(--radius);
      font-size: 13px;
      opacity: 0;
      transition: all 0.3s ease;
      z-index: 1000;
    }
    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }

    /* Empty state */
    .empty {
      color: var(--muted-foreground);
      text-align: center;
      padding: 40px;
      font-style: italic;
    }

    /* App container */
    .app-container {
      display: none;
      flex-direction: column;
      height: 100vh;
    }
    .app-container.visible {
      display: flex;
    }
  </style>
</head>
<body>
  <!-- Loading state -->
  <div class="loading-container" id="loading">
    <div class="loading-spinner"></div>
    <div class="loading-text">Loading...</div>
  </div>

  <!-- Welcome screen (no questionnaire selected) -->
  <div class="welcome-container" id="welcome" style="display: none;">
    <h1 class="welcome-title">Passionfruit Review</h1>
    <p class="welcome-subtitle">Select a questionnaire to review its indexed structure and harvested library items.</p>
    <div class="questionnaire-list" id="questionnaire-list"></div>
  </div>

  <!-- Main app -->
  <div class="app-container" id="app">
    <!-- Sidebar -->
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">Questionnaires</div>
      <div class="sidebar-content" id="sidebar-list"></div>
    </div>

    <!-- Header -->
    <div class="header">
      <div style="display: flex; align-items: center;">
        <button class="sidebar-toggle" id="sidebar-toggle" title="Open questionnaire list (B)">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <div>
          <div class="app-title">Passionfruit Review</div>
          <h1 id="questionnaire-title">Loading...</h1>
          <div class="meta" id="questionnaire-meta"></div>
        </div>
      </div>
      <div class="toggles">
        <span id="connection-status" class="connection-status checking"></span>
        <button class="toggle active" data-panel="original" title="Toggle Original (1)">Original</button>
        <button class="toggle active" data-panel="indexed" title="Toggle Indexed (2)">Indexed</button>
        <button class="toggle" data-panel="library" title="Toggle Library (3)">Library</button>
        <div class="toggle-divider"></div>
        <button class="toggle" id="review-toggle" title="Toggle review mode (R)">Review</button>
        <button class="toggle" id="complete-toggle" title="Complete Review">Complete Review (<span id="feedback-count">0</span>)</button>
        <button class="toggle" id="clear-toggle" title="Clear all feedback">Clear</button>
        <button class="toggle" title="Help (?)">?</button>
      </div>
    </div>

    <!-- Main content -->
    <div class="main">
      <div class="panel visible" id="panel-original">
        <div class="panel-header">
          <span>Original Questionnaire</span>
          <span id="original-stats"></span>
        </div>
        <div id="sheet-tabs" class="sheet-tabs"></div>
        <div class="panel-content" id="original-content"></div>
      </div>

      <div class="panel visible" id="panel-indexed">
        <div class="panel-header">
          <span>Indexed Structure</span>
          <span id="indexed-stats"></span>
          <div class="group-btns review-only">
            <button class="group-btn accept-all" id="accept-all-indexed">✓ Accept All</button>
            <button class="group-btn reject-all" id="reject-all-indexed">✗ Reject All</button>
          </div>
        </div>
        <div class="panel-content" id="indexed-content"></div>
      </div>

      <div class="panel" id="panel-library">
        <div class="panel-header">
          <span>Harvested Library</span>
          <span id="library-stats"></span>
          <div class="group-btns review-only">
            <button class="group-btn accept-all" id="accept-all-library">✓ Accept All</button>
            <button class="group-btn reject-all" id="reject-all-library">✗ Reject All</button>
          </div>
        </div>
        <div class="panel-content" id="library-content"></div>
      </div>
    </div>

    <!-- Stats bar -->
    <div class="stats-bar">
      <div class="stat" id="stats-left"></div>
      <div class="stat" id="stats-right"></div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <script>
    // State
    let currentQuestionnaire = null;
    let questionnaireData = null;
    let feedbackLog = [];
    let serverConnected = false;
    const API_BASE = '';

    // Initialize
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
      // Check URL for questionnaire parameter
      const params = new URLSearchParams(window.location.search);
      const questionnaireId = params.get('q');

      // Check server connection
      await checkServerConnection();

      if (questionnaireId) {
        await loadQuestionnaire(questionnaireId);
      } else {
        await showWelcome();
      }
    }

    async function checkServerConnection() {
      const status = document.getElementById('connection-status');
      try {
        const res = await fetch(API_BASE + '/api/health');
        if (res.ok) {
          serverConnected = true;
          status.className = 'connection-status connected';
          status.title = 'Connected to server';
        } else {
          throw new Error('Server error');
        }
      } catch {
        serverConnected = false;
        status.className = 'connection-status disconnected';
        status.title = 'Server disconnected';
      }
    }

    async function showWelcome() {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('welcome').style.display = 'flex';
      document.getElementById('app').classList.remove('visible');

      // Load questionnaire list
      try {
        const res = await fetch(API_BASE + '/api/questionnaires');
        const data = await res.json();
        renderQuestionnaireList(data.questionnaires);
      } catch (err) {
        console.error('Failed to load questionnaires:', err);
        document.getElementById('questionnaire-list').innerHTML =
          '<div class="empty">Failed to load questionnaires. Is the server running?</div>';
      }
    }

    function renderQuestionnaireList(questionnaires) {
      const container = document.getElementById('questionnaire-list');
      const sidebar = document.getElementById('sidebar-list');

      if (!questionnaires || questionnaires.length === 0) {
        container.innerHTML = '<div class="empty">No questionnaires found. Run the index command first.</div>';
        return;
      }

      const html = questionnaires.map(q => \`
        <a class="questionnaire-item" href="?q=\${encodeURIComponent(q.name)}">
          <div>
            <div class="questionnaire-name">\${escapeHtml(q.displayName)}</div>
            <div class="questionnaire-meta">\${q.feedbackCount || 0} items reviewed</div>
          </div>
        </a>
      \`).join('');

      container.innerHTML = html;

      // Also populate sidebar
      const sidebarHtml = questionnaires.map(q => \`
        <a class="sidebar-item\${currentQuestionnaire === q.name ? ' active' : ''}"
           href="?q=\${encodeURIComponent(q.name)}">
          <span class="sidebar-item-name">\${escapeHtml(q.displayName)}</span>
          \${q.feedbackCount ? \`<span class="sidebar-item-badge">\${q.feedbackCount}</span>\` : ''}
        </a>
      \`).join('');
      sidebar.innerHTML = sidebarHtml;
    }

    async function loadQuestionnaire(id) {
      document.getElementById('loading').style.display = 'flex';
      document.getElementById('welcome').style.display = 'none';
      document.getElementById('app').classList.remove('visible');

      try {
        const res = await fetch(API_BASE + '/api/questionnaire/' + encodeURIComponent(id));
        if (!res.ok) throw new Error('Failed to load questionnaire');

        questionnaireData = await res.json();
        currentQuestionnaire = id;

        // Update URL without reload
        history.pushState({}, '', '?q=' + encodeURIComponent(id));

        // Render the app
        renderApp();

        document.getElementById('loading').style.display = 'none';
        document.getElementById('app').classList.add('visible');

        // Load feedback if exists
        if (questionnaireData.feedback) {
          feedbackLog = [
            ...(questionnaireData.feedback.index || []),
            ...(questionnaireData.feedback.library || [])
          ];
          updateFeedbackCount();
          restoreFeedbackState();
        }

        // Update sidebar
        const questRes = await fetch(API_BASE + '/api/questionnaires');
        const questData = await questRes.json();
        renderQuestionnaireList(questData.questionnaires);

      } catch (err) {
        console.error('Failed to load questionnaire:', err);
        showToast('Failed to load questionnaire');
        await showWelcome();
      }
    }

    function renderApp() {
      if (!questionnaireData) return;

      const { structure, indexed, library } = questionnaireData;

      // Update header
      document.getElementById('questionnaire-title').textContent =
        structure?.source?.filename || indexed?.source || currentQuestionnaire;
      document.getElementById('questionnaire-meta').textContent =
        \`Indexed: \${indexed?.indexed || 'N/A'} | Language: \${(indexed?.language || 'N/A').toUpperCase()} | \${indexed?.stats?.total || 0} items\`;

      // Render panels
      if (structure) {
        renderOriginalPanel(structure);
      } else {
        document.getElementById('original-content').innerHTML =
          '<div class="empty">Structure data not found</div>';
      }

      if (indexed) {
        renderIndexedPanel(indexed);
      } else {
        document.getElementById('indexed-content').innerHTML =
          '<div class="empty">Indexed data not found. Run the index command first.</div>';
      }

      if (library) {
        renderLibraryPanel(library);
      } else {
        document.getElementById('library-content').innerHTML =
          '<div class="empty">Library data not found. Run the harvest command first.</div>';
      }

      // Update stats
      updateStats();

      // Setup event handlers
      setupEventHandlers();
    }

    function renderOriginalPanel(structure) {
      const tabsContainer = document.getElementById('sheet-tabs');
      const contentContainer = document.getElementById('original-content');

      // Render sheet tabs
      tabsContainer.innerHTML = structure.sheets.map((sheet, idx) => \`
        <button class="sheet-tab\${idx === 0 ? ' active' : ''}" data-sheet="\${idx}">
          \${escapeHtml(sheet.name)}
        </button>
      \`).join('');

      // Render sheet contents
      contentContainer.innerHTML = structure.sheets.map((sheet, idx) => \`
        <div class="sheet-content\${idx === 0 ? ' active' : ''}" data-sheet="\${idx}">
          \${renderSheetTable(sheet)}
        </div>
      \`).join('');

      // Calculate cell count from actual cell data
      const cellCount = structure.sheets.reduce((sum, s) => {
        if (!s.rows) return sum;
        return sum + s.rows.reduce((rowSum, row) => {
          return rowSum + (row.cells ? Object.keys(row.cells).length : 0);
        }, 0);
      }, 0);
      document.getElementById('original-stats').textContent =
        \`\${structure.sheets.length} sheets, \${cellCount} cells\`;

      // Sheet tab handlers
      tabsContainer.querySelectorAll('.sheet-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabsContainer.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
          contentContainer.querySelectorAll('.sheet-content').forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          contentContainer.querySelector(\`[data-sheet="\${tab.dataset.sheet}"]\`).classList.add('active');

          // Filter Indexed and Library panels by sheet
          const sheetName = tab.textContent.trim();
          filterPanelsBySheet(sheetName);
        });
      });

      // Add "All Sheets" button
      const allSheetsBtn = document.createElement('button');
      allSheetsBtn.className = 'sheet-tab';
      allSheetsBtn.textContent = 'All';
      allSheetsBtn.title = 'Show all sheets';
      allSheetsBtn.style.marginLeft = 'auto';
      allSheetsBtn.addEventListener('click', () => {
        filterPanelsBySheet(null); // Show all
        showToast('Showing all sheets');
      });
      tabsContainer.appendChild(allSheetsBtn);
    }

    // Filter Indexed and Library sections by sheet name
    function filterPanelsBySheet(sheetName) {
      // Filter Indexed sections
      document.querySelectorAll('#panel-indexed .section').forEach(section => {
        const sectionSheet = section.dataset.sheet || '';
        if (!sheetName || sectionSheet === sheetName || sectionSheet === '') {
          section.style.display = '';
        } else {
          section.style.display = 'none';
        }
      });

      // Filter Library items by sheet (library is organized by topic, not sheet)
      document.querySelectorAll('#panel-library .section').forEach(section => {
        let visibleItems = 0;
        section.querySelectorAll('.item').forEach(item => {
          const itemSheet = item.dataset.sheet || '';
          // When filtering by sheet, only show items that match that sheet exactly
          // Items without sheet info (empty string) are hidden when filtering
          if (!sheetName) {
            // No filter - show all
            item.style.display = '';
            visibleItems++;
          } else if (itemSheet === sheetName) {
            // Exact match - show
            item.style.display = '';
            visibleItems++;
          } else {
            // No match or no sheet info - hide
            item.style.display = 'none';
          }
        });
        // Hide section if no visible items
        section.style.display = visibleItems > 0 ? '' : 'none';
      });

      // Update stats to show filtered count
      updateFilteredStats(sheetName);
    }

    function updateFilteredStats(sheetName) {
      // Update Indexed stats
      const indexedSections = document.querySelectorAll('#panel-indexed .section:not([style*="display: none"])');
      let indexedItems = 0;
      indexedSections.forEach(s => {
        indexedItems += s.querySelectorAll('.item').length;
      });
      const indexedStatsEl = document.getElementById('indexed-stats');
      if (indexedStatsEl) {
        if (sheetName) {
          indexedStatsEl.textContent = \`\${indexedSections.length} sections, \${indexedItems} items (filtered)\`;
        } else {
          const allSections = document.querySelectorAll('#panel-indexed .section').length;
          const allItems = document.querySelectorAll('#panel-indexed .item').length;
          indexedStatsEl.textContent = \`\${allSections} sections, \${allItems} items\`;
        }
      }

      // Update Library stats
      const visibleLibraryItems = document.querySelectorAll('#panel-library .item:not([style*="display: none"])').length;
      const totalLibraryItems = document.querySelectorAll('#panel-library .item').length;
      const libraryStatsEl = document.getElementById('library-stats');
      if (libraryStatsEl) {
        if (sheetName) {
          libraryStatsEl.textContent = \`\${visibleLibraryItems} of \${totalLibraryItems} items (filtered)\`;
        } else {
          libraryStatsEl.textContent = \`\${totalLibraryItems} items\`;
        }
      }
    }

    function renderSheetTable(sheet) {
      if (!sheet.rows || sheet.rows.length === 0) {
        return '<div class="empty">Empty sheet</div>';
      }

      // Extract columns from cell data if not provided
      let columns = sheet.columns;
      if (!columns || columns.length === 0) {
        // Collect all unique column letters from all rows
        const colSet = new Set();
        sheet.rows.forEach(row => {
          if (row.cells) {
            Object.keys(row.cells).forEach(col => colSet.add(col));
          }
        });
        // Sort columns alphabetically (A, B, C, ... AA, AB, etc.)
        columns = Array.from(colSet).sort((a, b) => {
          if (a.length !== b.length) return a.length - b.length;
          return a.localeCompare(b);
        });
      }

      // Build merge map: track which cells are merged and their spans
      const mergeMap = {};
      sheet.rows.forEach(row => {
        if (row.cells) {
          Object.entries(row.cells).forEach(([col, cell]) => {
            if (cell?.format?.isMerged && cell.format.mergeRange) {
              const key = \`\${col}\${row.rowNumber || row.row}\`;
              mergeMap[key] = {
                isOrigin: cell.format.isMergeOrigin,
                range: cell.format.mergeRange
              };
            }
          });
        }
      });

      // Calculate colspan from merge range (e.g., "A3:C3" -> 3 columns)
      function getColspan(range, startCol) {
        if (!range) return 1;
        const match = range.match(/([A-Z]+)\\d+:([A-Z]+)\\d+/);
        if (!match) return 1;
        const startIdx = columns.indexOf(match[1]);
        const endIdx = columns.indexOf(match[2]);
        if (startIdx === -1 || endIdx === -1) return 1;
        return endIdx - startIdx + 1;
      }

      const headerHtml = '<tr><th class="row-header">#</th>' +
        columns.map(col => \`<th>\${col}</th>\`).join('') + '</tr>';

      const rowsHtml = sheet.rows.map(row => {
        const rowNum = row.rowNumber || row.row;
        const rowType = row.rowType || '';
        const rowClass = rowType === 'header' ? ' class="row-header-type"' :
                        rowType === 'section' ? ' class="row-section-type"' : '';

        const cellsHtml = columns.map(col => {
          const cell = row.cells?.[col];
          const value = cell?.value ?? '';
          const cellId = \`\${col}\${rowNum}\`;
          const mergeInfo = mergeMap[cellId];

          // Skip non-origin merged cells
          if (mergeInfo && !mergeInfo.isOrigin) {
            return ''; // Will be covered by colspan
          }

          // Build cell classes
          const classes = [];
          if (cell?.format?.bold) classes.push('cell-bold');
          if (cell?.format?.italic) classes.push('cell-italic');
          if (cell?.role === 'header') classes.push('cell-header');
          if (cell?.role === 'label') classes.push('cell-label');
          if (cell?.role === 'section' || rowType === 'section') classes.push('cell-section');

          const classStr = classes.length ? \` class="\${classes.join(' ')}"\` : '';
          const colspan = mergeInfo?.isOrigin ? getColspan(mergeInfo.range, col) : 1;
          const colspanStr = colspan > 1 ? \` colspan="\${colspan}"\` : '';

          // Style for font size (scale relative to base 12px)
          let styleStr = '';
          if (cell?.format?.fontSize && cell.format.fontSize !== 11) {
            const scale = cell.format.fontSize / 11;
            if (scale > 1.1) styleStr = \` style="font-size: \${Math.round(12 * scale)}px"\`;
          }

          return \`<td data-cell="\${cellId}"\${classStr}\${colspanStr}\${styleStr}>\${escapeHtml(String(value))}</td>\`;
        }).join('');

        return \`<tr\${rowClass}><td class="row-header">\${rowNum}</td>\${cellsHtml}</tr>\`;
      }).join('');

      return \`<table class="excel-table"><thead>\${headerHtml}</thead><tbody>\${rowsHtml}</tbody></table>\`;
    }

    function renderIndexedPanel(indexed) {
      const container = document.getElementById('indexed-content');

      if (!indexed.sections || indexed.sections.length === 0) {
        container.innerHTML = '<div class="empty">No sections indexed</div>';
        return;
      }

      let totalItems = 0;
      const sectionsHtml = indexed.sections.map((section, sIdx) => {
        const sheetName = section.sheet || '';
        const itemsHtml = section.items.map((item, iIdx) => {
          totalItems++;
          const idx = \`\${sIdx}-\${iIdx}\`;
          const cells = item.lCell && item.vCell ? \`\${item.lCell} → \${item.vCell}\` :
                       (item.labelCell && item.valueCell ? \`\${item.labelCell} → \${item.valueCell}\` : '');
          const value = item.value || '';
          const isEmpty = !value || value.trim() === '';

          // Determine destination badge based on topic (from rules.yaml)
          const topic = section.topic || '';
          const entityTopics = ['company', 'company_information', 'contact_persons', 'contacts', 'certifications', 'documents', 'signature', 'approval', 'crisis', 'financial'];
          const productTopics = ['product', 'identification', 'physical_properties', 'sensory', 'analytical', 'formula_composition', 'allergens', 'nutritional', 'regulatory_ids', 'microbiological', 'microbiology', 'contaminants', 'gmo', 'claims', 'rspo_palm', 'packaging', 'storage_transport', 'coding', 'origin_provenance'];
          let destination = 'library';
          if (productTopics.includes(topic) || item.level === 'product') {
            destination = 'product';
          } else if (entityTopics.includes(topic)) {
            destination = 'entity';
          }
          const levelBadge = destination === 'product' ? '<span class="level-badge product">product</span>' :
                            destination === 'entity' ? '<span class="level-badge entity">entity</span>' :
                            '<span class="level-badge library">library</span>';

          return \`
            <div class="item" data-index="\${idx}" data-cells="\${cells}" data-sheet="\${escapeHtml(sheetName)}" data-label="\${escapeHtml(item.label)}" data-section="\${escapeHtml(section.name || section.title)}" data-topic="\${section.topic || ''}">
              <div class="item-label">\${escapeHtml(item.label)}\${levelBadge}</div>
              <div class="item-value\${isEmpty ? ' empty' : ''}">\${isEmpty ? '(empty)' : escapeHtml(value)}</div>
              <div class="item-ref">\${sheetName ? sheetName + ': ' : ''}\${cells}</div>
              <div class="item-actions review-only">
                <button class="action-btn correct" title="Accept (C)">✓</button>
                <button class="action-btn wrong" title="Reject (W)">✗</button>
              </div>
              <div class="wrong-note-container">
                <input type="text" class="wrong-note-input" placeholder="Reason for rejection (optional)">
                <div class="wrong-note-btns">
                  <button class="wrong-note-btn save">Save</button>
                  <button class="wrong-note-btn cancel">Cancel</button>
                </div>
              </div>
            </div>
          \`;
        }).join('');

        return \`
          <div class="section" data-section="\${sIdx}" data-sheet="\${escapeHtml(sheetName)}">
            <div class="section-header">
              <div class="section-title">\${escapeHtml(section.name || section.title)}\${sheetName ? ' <span style="opacity:0.5;font-weight:normal">(' + escapeHtml(sheetName) + ')</span>' : ''}</div>
              <div class="section-meta">
                <span class="section-badge">\${section.topic || 'general'}</span>
                <span>\${section.items.length} items</span>
              </div>
            </div>
            <div class="section-items">\${itemsHtml}</div>
          </div>
        \`;
      }).join('');

      container.innerHTML = sectionsHtml;
      document.getElementById('indexed-stats').textContent =
        \`\${indexed.sections.length} sections, \${totalItems} items\`;
    }

    function renderLibraryPanel(library) {
      const container = document.getElementById('library-content');

      // Library data can be in two formats:
      // 1. library.items (array) - old format
      // 2. library.byTopic (object with topic keys) - new format
      let byTopic = {};

      if (library.byTopic && Object.keys(library.byTopic).length > 0) {
        // New format - byTopic is already grouped
        let idx = 0;
        Object.entries(library.byTopic).forEach(([topic, items]) => {
          byTopic[topic] = items.map(item => ({ ...item, idx: idx++ }));
        });
      } else if (library.items && library.items.length > 0) {
        // Old format - group by topic
        library.items.forEach((item, idx) => {
          const topic = item.topic || 'general';
          if (!byTopic[topic]) byTopic[topic] = [];
          byTopic[topic].push({ ...item, idx });
        });
      }

      if (Object.keys(byTopic).length === 0) {
        container.innerHTML = '<div class="empty">No library items harvested</div>';
        return;
      }

      const topicsHtml = Object.entries(byTopic).map(([topic, items]) => {
        // Collect unique sheets in this topic
        const sheetsInTopic = new Set();
        items.forEach(item => {
          const source = item.source || item.sources?.[0];
          if (source?.sheet) sheetsInTopic.add(source.sheet);
        });

        const itemsHtml = items.map(item => {
          // Handle both source formats: item.source (single) or item.sources (array)
          const source = item.source || item.sources?.[0];
          const sheetName = source?.sheet || '';
          const cells = source?.lCell && source?.vCell
            ? \`\${source.lCell} → \${source.vCell}\`
            : (source?.labelCell && source?.valueCell ? \`\${source.labelCell} → \${source.valueCell}\` : '');

          // Determine destination badge based on topic (from rules.yaml)
          const entityTopics = ['company', 'company_information', 'contact_persons', 'contacts', 'certifications', 'documents', 'signature', 'approval', 'crisis', 'financial'];
          const productTopics = ['product', 'identification', 'physical_properties', 'sensory', 'analytical', 'formula_composition', 'allergens', 'nutritional', 'regulatory_ids', 'microbiological', 'microbiology', 'contaminants', 'gmo', 'claims', 'rspo_palm', 'packaging', 'storage_transport', 'coding', 'origin_provenance'];
          let destination = 'library';
          if (productTopics.includes(topic) || item.level === 'product') {
            destination = 'product';
          } else if (entityTopics.includes(topic)) {
            destination = 'entity';
          }
          const levelBadge = destination === 'product' ? '<span class="level-badge product">product</span>' :
                            destination === 'entity' ? '<span class="level-badge entity">entity</span>' :
                            '<span class="level-badge library">library</span>';

          return \`
            <div class="item" data-index="\${item.idx}" data-cells="\${cells}" data-sheet="\${escapeHtml(sheetName)}" data-label="\${escapeHtml(item.label)}" data-topic="\${topic}">
              <div class="item-label">\${escapeHtml(item.label)}\${levelBadge}</div>
              <div class="item-value">\${escapeHtml(item.value || '')}</div>
              <div class="item-ref">\${sheetName ? sheetName + ': ' : ''}\${cells}</div>
              <div class="item-actions review-only">
                <button class="action-btn correct" title="Accept (C)">✓</button>
                <button class="action-btn wrong" title="Reject (W)">✗</button>
              </div>
              <div class="wrong-note-container">
                <input type="text" class="wrong-note-input" placeholder="Reason for rejection (optional)">
                <div class="wrong-note-btns">
                  <button class="wrong-note-btn save">Save</button>
                  <button class="wrong-note-btn cancel">Cancel</button>
                </div>
              </div>
            </div>
          \`;
        }).join('');

        const sheetsStr = sheetsInTopic.size > 0 ? Array.from(sheetsInTopic).join(', ') : '';

        return \`
          <div class="section" data-topic="\${topic}" data-sheets="\${escapeHtml(sheetsStr)}">
            <div class="section-header">
              <div class="section-title">\${topic.toUpperCase()}</div>
              <div class="section-meta">
                <span>\${items.length} items</span>
                <div class="group-btns review-only">
                  <button class="group-btn accept-all" data-topic="\${topic}">✓ All</button>
                  <button class="group-btn reject-all" data-topic="\${topic}">✗ All</button>
                </div>
              </div>
            </div>
            <div class="section-items">\${itemsHtml}</div>
          </div>
        \`;
      }).join('');

      container.innerHTML = topicsHtml;
      // Calculate total items from byTopic
      const totalItems = Object.values(byTopic).reduce((sum, items) => sum + items.length, 0);
      document.getElementById('library-stats').textContent = \`\${totalItems} items\`;
    }

    function setupEventHandlers() {
      // Panel toggles
      document.querySelectorAll('.toggle[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
          btn.classList.toggle('active');
          const panel = document.getElementById('panel-' + btn.dataset.panel);
          panel?.classList.toggle('visible', btn.classList.contains('active'));
        });
      });

      // Review mode toggle
      document.getElementById('review-toggle')?.addEventListener('click', function() {
        this.classList.toggle('active');
        document.body.classList.toggle('review-mode', this.classList.contains('active'));
      });

      // Sidebar toggle
      document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('open');
      });

      // Clear feedback
      document.getElementById('clear-toggle')?.addEventListener('click', async () => {
        if (!confirm('Clear all feedback for this questionnaire?')) return;
        try {
          await fetch(API_BASE + '/api/feedback', { method: 'DELETE' });
          feedbackLog = [];
          updateFeedbackCount();
          document.querySelectorAll('.item').forEach(item => {
            item.classList.remove('reviewed', 'correct', 'wrong', 'accepted', 'rejected', 'show-note');
          });
          showToast('Feedback cleared');
        } catch (err) {
          showToast('Failed to clear feedback');
        }
      });

      // Item click handlers
      document.querySelectorAll('.item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.action-btn') || e.target.closest('.wrong-note-container')) return;
          document.querySelectorAll('.item.selected').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          highlightCells(item.dataset.cells, item.dataset.sheet);
        });
      });

      // Cell selection state for label/value pairing
      let selectedCells = [];
      let selectionMode = null; // 'label' or 'value'

      // Cell click handlers - click Original cell to find related Indexed items
      // Shift+click to select label cell, Ctrl/Cmd+click to select value cell
      document.querySelectorAll('.excel-table td[data-cell]').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', (e) => {
          const cellId = cell.dataset.cell;
          if (!cellId) return;

          // Shift+click = select as label cell
          if (e.shiftKey) {
            document.querySelectorAll('.excel-table td.label-selected').forEach(td => {
              td.classList.remove('label-selected');
            });
            cell.classList.add('label-selected');
            selectedCells[0] = { id: cellId, value: cell.textContent.trim(), element: cell };
            showToast(\`Label cell: \${cellId} - now Ctrl+click value cell\`);
            updateCellSelectionUI();
            return;
          }

          // Ctrl/Cmd+click = select as value cell
          if (e.ctrlKey || e.metaKey) {
            document.querySelectorAll('.excel-table td.value-selected').forEach(td => {
              td.classList.remove('value-selected');
            });
            cell.classList.add('value-selected');
            selectedCells[1] = { id: cellId, value: cell.textContent.trim(), element: cell };
            showToast(\`Value cell: \${cellId}\`);
            updateCellSelectionUI();
            return;
          }

          // Normal click - find matching items (exact match)
          document.querySelectorAll('.excel-table td.highlighted').forEach(td => {
            td.classList.remove('highlighted');
          });
          cell.classList.add('highlighted');

          // Find items that reference this cell (exact match, not substring)
          const allItems = document.querySelectorAll('.item[data-cells]');
          const matchingItems = [];
          allItems.forEach(item => {
            const cells = item.dataset.cells || '';
            // Split by arrow and whitespace, check for exact match
            const cellRefs = cells.split(/[→,\\s]+/).map(c => c.trim());
            if (cellRefs.includes(cellId)) {
              matchingItems.push(item);
            }
          });

          document.querySelectorAll('.item.selected').forEach(i => i.classList.remove('selected'));

          if (matchingItems.length > 0) {
            matchingItems.forEach(item => item.classList.add('selected'));
            matchingItems[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            showToast(\`Found \${matchingItems.length} item(s) for \${cellId}\`);
          } else {
            showToast(\`No items reference cell \${cellId} (Shift+click to select as label)\`);
          }
        });
      });

      // Update cell selection UI
      function updateCellSelectionUI() {
        let existingUI = document.getElementById('cell-selection-ui');
        if (!existingUI) {
          existingUI = document.createElement('div');
          existingUI.id = 'cell-selection-ui';
          existingUI.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;z-index:1000;display:flex;gap:12px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
          document.body.appendChild(existingUI);
        }

        const labelCell = selectedCells[0];
        const valueCell = selectedCells[1];

        if (!labelCell && !valueCell) {
          existingUI.style.display = 'none';
          return;
        }

        existingUI.style.display = 'flex';
        existingUI.innerHTML = \`
          <div style="font-size:12px;">
            <div style="color:var(--muted-foreground);margin-bottom:4px;">Selected cells:</div>
            <div><strong>Label:</strong> \${labelCell ? labelCell.id + ' "' + labelCell.value.substring(0,30) + (labelCell.value.length > 30 ? '...' : '') + '"' : '<em>Shift+click to select</em>'}</div>
            <div><strong>Value:</strong> \${valueCell ? valueCell.id + ' "' + valueCell.value.substring(0,30) + (valueCell.value.length > 30 ? '...' : '') + '"' : '<em>Ctrl+click to select</em>'}</div>
          </div>
          <div style="display:flex;gap:8px;">
            \${labelCell && valueCell ? '<button id="create-item-btn" style="padding:6px 12px;background:#22c55e;color:#000;border:none;border-radius:var(--radius);cursor:pointer;font-weight:500;">Create Item</button>' : ''}
            <button id="clear-selection-btn" style="padding:6px 12px;background:var(--muted);color:var(--foreground);border:none;border-radius:var(--radius);cursor:pointer;">Clear</button>
          </div>
        \`;

        document.getElementById('clear-selection-btn')?.addEventListener('click', () => {
          clearCellSelection();
        });

        document.getElementById('create-item-btn')?.addEventListener('click', () => {
          createItemFromSelection();
        });
      }

      function clearCellSelection() {
        document.querySelectorAll('.excel-table td.label-selected, .excel-table td.value-selected').forEach(td => {
          td.classList.remove('label-selected', 'value-selected');
        });
        selectedCells = [];
        updateCellSelectionUI();
      }

      async function createItemFromSelection() {
        const labelCell = selectedCells[0];
        const valueCell = selectedCells[1];
        if (!labelCell || !valueCell) return;

        // Get current active sheet name
        const activeTab = document.querySelector('.sheet-tab.active');
        const sheetName = activeTab ? activeTab.textContent.trim() : '';

        const newItem = {
          label: labelCell.value,
          value: valueCell.value,
          lCell: labelCell.id,
          vCell: valueCell.id,
          sheet: sheetName,
          source: 'manual'
        };

        // Save to server
        if (serverConnected) {
          try {
            await fetch(API_BASE + '/api/feedback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                panel: 'manual',
                item: {
                  action: 'created',
                  ...newItem,
                  reviewedAt: new Date().toISOString()
                }
              })
            });

            // Add item to Indexed panel
            addManualItemToPanel(newItem);
            showToast(\`Created item: \${labelCell.value.substring(0,30)}...\`);
            clearCellSelection();
          } catch (err) {
            showToast('Failed to create item');
          }
        } else {
          showToast('Server not connected');
        }
      }

      // Add manual item to Indexed panel
      function addManualItemToPanel(item) {
        const container = document.getElementById('indexed-content');
        if (!container) return;

        // Find or create "Manual Items" section
        let manualSection = container.querySelector('.section[data-section="manual"]');
        if (!manualSection) {
          manualSection = document.createElement('div');
          manualSection.className = 'section';
          manualSection.dataset.section = 'manual';
          manualSection.innerHTML = \`
            <div class="section-header">
              <div class="section-title">Manual Items <span style="opacity:0.5;font-weight:normal">(\${item.sheet || 'Unknown'})</span></div>
              <div class="section-meta">
                <span class="section-badge" style="background:#22c55e;color:#000;">manual</span>
                <span class="manual-count">0 items</span>
              </div>
            </div>
            <div class="section-items"></div>
          \`;
          // Insert at top
          container.insertBefore(manualSection, container.firstChild);

          // Add collapse handler
          manualSection.querySelector('.section-header').addEventListener('click', () => {
            manualSection.classList.toggle('collapsed');
          });
        }

        const sectionItems = manualSection.querySelector('.section-items');
        const cells = \`\${item.lCell} → \${item.vCell}\`;
        const idx = 'manual-' + Date.now();

        const itemEl = document.createElement('div');
        itemEl.className = 'item reviewed correct accepted';
        itemEl.dataset.index = idx;
        itemEl.dataset.cells = cells;
        itemEl.dataset.sheet = item.sheet || '';
        itemEl.dataset.label = item.label;
        itemEl.innerHTML = \`
          <div class="item-label">\${escapeHtml(item.label)}</div>
          <div class="item-value">\${escapeHtml(item.value)}</div>
          <div class="item-ref">\${item.sheet ? item.sheet + ': ' : ''}\${cells}</div>
          <div class="item-actions review-only">
            <button class="action-btn correct" title="Accept (C)">✓</button>
            <button class="action-btn wrong" title="Reject (W)">✗</button>
          </div>
        \`;

        // Add click handler
        itemEl.addEventListener('click', (e) => {
          if (e.target.closest('.action-btn')) return;
          document.querySelectorAll('.item.selected').forEach(i => i.classList.remove('selected'));
          itemEl.classList.add('selected');
          highlightCells(cells, item.sheet);
        });

        sectionItems.appendChild(itemEl);

        // Update count
        const count = sectionItems.querySelectorAll('.item').length;
        manualSection.querySelector('.manual-count').textContent = count + ' items';

        // Update stats
        const statsEl = document.getElementById('indexed-stats');
        if (statsEl) {
          const match = statsEl.textContent.match(/(\\d+) sections, (\\d+) items/);
          if (match) {
            statsEl.textContent = \`\${match[1]} sections, \${parseInt(match[2]) + 1} items\`;
          }
        }
      }

      // Action buttons
      document.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const item = btn.closest('.item');

          if (btn.classList.contains('correct')) {
            item.classList.remove('wrong', 'rejected', 'show-note');
            item.classList.add('reviewed', 'correct', 'accepted');
            showToast('Accepted');
            logFeedback(item, 'correct');
          } else if (btn.classList.contains('wrong')) {
            item.classList.add('show-note');
            item.querySelector('.wrong-note-input')?.focus();
          }
        });
      });

      // Wrong note save/cancel
      document.querySelectorAll('.wrong-note-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const item = btn.closest('.item');
          const input = item.querySelector('.wrong-note-input');

          if (btn.classList.contains('save')) {
            item.classList.remove('correct', 'accepted', 'show-note');
            item.classList.add('reviewed', 'wrong', 'rejected');
            const note = input?.value || '';
            showToast(note ? 'Rejected with note' : 'Rejected');
            logFeedback(item, 'wrong', note);
            if (input) input.value = '';
          } else {
            item.classList.remove('show-note');
            if (input) input.value = '';
          }
        });
      });

      // Panel-level Accept/Reject All
      document.getElementById('accept-all-indexed')?.addEventListener('click', () => {
        const items = document.querySelectorAll('#panel-indexed .item');
        items.forEach(item => {
          item.classList.remove('wrong', 'rejected', 'show-note');
          item.classList.add('reviewed', 'correct', 'accepted');
          logFeedback(item, 'correct');
        });
        showToast(items.length + ' indexed items accepted');
      });

      document.getElementById('reject-all-indexed')?.addEventListener('click', () => {
        const items = document.querySelectorAll('#panel-indexed .item');
        items.forEach(item => {
          item.classList.remove('correct', 'accepted');
          item.classList.add('reviewed', 'wrong', 'rejected');
          logFeedback(item, 'wrong');
        });
        showToast(items.length + ' indexed items rejected');
      });

      document.getElementById('accept-all-library')?.addEventListener('click', () => {
        const items = document.querySelectorAll('#panel-library .item');
        items.forEach(item => {
          item.classList.remove('wrong', 'rejected', 'show-note');
          item.classList.add('reviewed', 'correct', 'accepted');
          logFeedback(item, 'correct');
        });
        showToast(items.length + ' library items accepted');
      });

      document.getElementById('reject-all-library')?.addEventListener('click', () => {
        const items = document.querySelectorAll('#panel-library .item');
        items.forEach(item => {
          item.classList.remove('correct', 'accepted');
          item.classList.add('reviewed', 'wrong', 'rejected');
          logFeedback(item, 'wrong');
        });
        showToast(items.length + ' library items rejected');
      });

      // Topic-level Accept/Reject All in library
      document.querySelectorAll('#panel-library .group-btn[data-topic]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const topic = btn.dataset.topic;
          const items = document.querySelectorAll(\`#panel-library .item[data-topic="\${topic}"]\`);

          if (btn.classList.contains('accept-all')) {
            items.forEach(item => {
              item.classList.remove('wrong', 'rejected', 'show-note');
              item.classList.add('reviewed', 'correct', 'accepted');
              logFeedback(item, 'correct');
            });
            showToast(items.length + ' items accepted');
          } else {
            items.forEach(item => {
              item.classList.remove('correct', 'accepted');
              item.classList.add('reviewed', 'wrong', 'rejected');
              logFeedback(item, 'wrong');
            });
            showToast(items.length + ' items rejected');
          }
        });
      });

      // Complete Review
      document.getElementById('complete-toggle')?.addEventListener('click', completeReview);

      // Section collapse
      document.querySelectorAll('.section-header').forEach(header => {
        header.addEventListener('click', () => {
          header.closest('.section')?.classList.toggle('collapsed');
        });
      });
    }

    async function logFeedback(item, action, note = '') {
      const panel = item.closest('.panel')?.id?.replace('panel-', '') || 'indexed';
      const feedbackItem = {
        action: action === 'correct' ? 'accepted' : action === 'wrong' ? 'rejected' : action,
        label: item.dataset.label || item.querySelector('.item-label')?.textContent,
        value: item.querySelector('.item-value')?.textContent,
        cells: item.dataset.cells,
        section: item.dataset.section,
        topic: item.dataset.topic,
        reason: note,
        reviewedAt: new Date().toISOString()
      };

      // Update local log
      const existingIdx = feedbackLog.findIndex(f =>
        f.cells === feedbackItem.cells && f.label === feedbackItem.label
      );
      if (existingIdx >= 0) {
        feedbackLog[existingIdx] = feedbackItem;
      } else {
        feedbackLog.push(feedbackItem);
      }
      updateFeedbackCount();

      // Save to server
      if (serverConnected) {
        try {
          await fetch(API_BASE + '/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ panel, item: feedbackItem })
          });
        } catch (err) {
          console.error('Failed to save feedback:', err);
        }
      }
    }

    function updateFeedbackCount() {
      document.getElementById('feedback-count').textContent = feedbackLog.length;
    }

    function restoreFeedbackState() {
      feedbackLog.forEach(fb => {
        // Handle manually created items
        if (fb.action === 'created' && fb.source === 'manual') {
          addManualItemToPanel({
            label: fb.label,
            value: fb.value,
            lCell: fb.lCell,
            vCell: fb.vCell,
            sheet: fb.sheet || ''
          });
          return;
        }

        // Handle accepted/rejected items
        const items = document.querySelectorAll(\`.item[data-cells="\${fb.cells}"]\`);
        items.forEach(item => {
          if (fb.action === 'accepted') {
            item.classList.add('reviewed', 'correct', 'accepted');
          } else if (fb.action === 'rejected') {
            item.classList.add('reviewed', 'wrong', 'rejected');
          }
        });
      });
    }

    async function completeReview() {
      if (!feedbackLog || feedbackLog.length === 0) {
        showToast('No feedback to save');
        return;
      }

      if (!serverConnected) {
        showToast('Server not connected');
        return;
      }

      try {
        const exportRes = await fetch(API_BASE + '/api/export-approved', { method: 'POST' });
        if (!exportRes.ok) throw new Error('Export failed');

        const rulesRes = await fetch(API_BASE + '/api/apply-rules', { method: 'POST' });
        if (!rulesRes.ok) throw new Error('Rules failed');

        showToast('Review complete! Data exported and rules applied.');
      } catch (err) {
        showToast('Failed to complete review: ' + err.message);
      }
    }

    function highlightCells(cellsStr, sheetName = null) {
      document.querySelectorAll('.excel-table td.highlighted').forEach(td => {
        td.classList.remove('highlighted');
      });

      if (!cellsStr) return;

      const cells = cellsStr.split(/[→,\\s]+/).map(c => c.trim()).filter(Boolean);
      let foundInSheet = null;

      // If sheetName provided, try to find and switch to that sheet first
      if (sheetName) {
        const tabs = document.querySelectorAll('.sheet-tab');
        tabs.forEach((tab, idx) => {
          if (tab.textContent.trim() === sheetName) {
            foundInSheet = idx;
          }
        });
      }

      // Find cells in all sheets
      const allSheets = document.querySelectorAll('.sheet-content');
      cells.forEach(cell => {
        allSheets.forEach((sheet, idx) => {
          const td = sheet.querySelector(\`[data-cell="\${cell}"]\`);
          if (td) {
            td.classList.add('highlighted');
            if (foundInSheet === null) foundInSheet = idx;
          }
        });
      });

      // Switch to the sheet containing the cells
      if (foundInSheet !== null) {
        const tabs = document.querySelectorAll('.sheet-tab');
        const contents = document.querySelectorAll('.sheet-content');
        if (tabs[foundInSheet] && !tabs[foundInSheet].classList.contains('active')) {
          tabs.forEach(t => t.classList.remove('active'));
          contents.forEach(c => c.classList.remove('active'));
          tabs[foundInSheet].classList.add('active');
          contents[foundInSheet].classList.add('active');
        }
        // Scroll first highlighted cell into view
        const firstHighlighted = contents[foundInSheet]?.querySelector('.highlighted');
        if (firstHighlighted) {
          firstHighlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    function updateStats() {
      const indexed = questionnaireData?.indexed;
      const library = questionnaireData?.library;

      // Calculate library count from either format
      let libraryCount = 0;
      if (library?.total) {
        libraryCount = library.total;
      } else if (library?.byTopic) {
        libraryCount = Object.values(library.byTopic).reduce((sum, items) => sum + items.length, 0);
      } else if (library?.items) {
        libraryCount = library.items.length;
      }

      document.getElementById('stats-left').innerHTML = \`
        <span>Sections: \${indexed?.sections?.length || 0}</span>
        <span>Items: \${indexed?.stats?.total || 0}</span>
        <span>Answered: \${indexed?.stats?.answered || 0}</span>
        <span>Library: \${libraryCount}</span>
      \`;
    }

    function showToast(message) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function escapeHtml(text) {
      if (!text) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch(e.key) {
        case '1': document.querySelector('[data-panel="original"]')?.click(); break;
        case '2': document.querySelector('[data-panel="indexed"]')?.click(); break;
        case '3': document.querySelector('[data-panel="library"]')?.click(); break;
        case 'r': case 'R': document.getElementById('review-toggle')?.click(); break;
        case 'b': case 'B': document.getElementById('sidebar-toggle')?.click(); break;
      }
    });
  </script>
</body>
</html>`;
  }
}
