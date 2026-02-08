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
      height: calc(100vh - 56px);
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
    #panel-library .item.standard { border-left: 3px solid #22c55e; }
    #panel-library .item.narrative { border-left: 3px solid #3b82f6; }

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

    /* Hide buttons on reviewed items, but show note */
    .item.reviewed .item-actions { display: none !important; }
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
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${this.escapeHtml(structure.source.filename)}</h1>
      <div class="meta">Indexed: ${indexed.indexed} | Language: ${indexed.language.toUpperCase()} | ${indexed.stats.total} items</div>
    </div>
    <div class="toggles">
      <button class="toggle active" data-panel="original" title="Toggle Original (1)">Original</button>
      <button class="toggle active" data-panel="indexed" title="Toggle Indexed (2)">Indexed</button>
      <button class="toggle" data-panel="library" title="Toggle Library (3)">Library</button>
      <div class="toggle-divider"></div>
      <button class="toggle" id="review-toggle" title="Toggle review mode (R)">Review</button>
      <button class="toggle" id="sync-toggle" title="Sync panels (S)">
        <span class="sync-icon">⟷</span> Sync
      </button>
      <button class="toggle" id="export-toggle" title="Export all feedback files">💾 Save</button>
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
        <span class="count">${indexed.sections.length} sections, ${indexed.stats.total} items</span>
      </div>
      <div class="panel-content">
        ${indexedHtml}
      </div>
    </div>

    <!-- Library View -->
    <div class="panel" id="panel-library">
      <div class="panel-header">
        <span>Harvested Library</span>
        <span class="count">${library ? library.total + ' items' : 'Not harvested'}</span>
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
      <div class="shortcut"><span>Show this help</span><kbd>?</kbd></div>
      <div class="shortcut"><span>Clear selection</span><kbd>Esc</kbd></div>
    </div>
  </div>

  <script>
    // State
    let syncMode = false;
    let reviewMode = false;
    let currentItemIndex = -1;
    const indexedItems = Array.from(document.querySelectorAll('#panel-indexed .item'));
    const libraryItems = Array.from(document.querySelectorAll('#panel-library .item'));
    const allItems = [...indexedItems, ...libraryItems];

    // Storage key for this file
    const STORAGE_KEY = 'review_${structure.source.filename.replace(/[^a-zA-Z0-9]/g, '_')}';

    // Load persisted state on page load
    function loadPersistedState() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return;

        const data = JSON.parse(saved);
        window.feedbackLog = data.feedbackLog || [];

        // Restore item states
        data.feedbackLog.forEach(feedback => {
          const item = findItemByKey(feedback.cells, feedback.label, feedback.panel);
          if (item) {
            item.classList.add('reviewed', feedback.action);
            if (feedback.note) {
              const noteDisplay = item.querySelector('.item-note-display');
              if (noteDisplay) {
                noteDisplay.textContent = feedback.note;
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
          }
        });

        // Update all section statuses
        document.querySelectorAll('.section, .library-topic').forEach(section => {
          const firstItem = section.querySelector('.item');
          if (firstItem) updateSectionStatus(firstItem);
        });

        updateFeedbackCount();
        console.log('Restored', data.feedbackLog.length, 'feedback items');
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

    // Save state to localStorage
    function saveState() {
      try {
        const data = {
          savedAt: new Date().toISOString(),
          source: '${structure.source.filename}',
          feedbackLog: window.feedbackLog || []
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.error('Failed to save state:', e);
      }
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
          cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
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
      item.scrollIntoView({ behavior: 'smooth', block: 'center' });

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
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
          item.classList.remove('wrong', 'show-note');
          item.classList.add('reviewed', 'correct');
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
          item.classList.remove('correct', 'show-note');
          item.classList.add('reviewed', 'wrong');
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
    function logFeedback(item, action, note = '') {
      const feedback = {
        action,
        label: item.querySelector('.item-label')?.textContent,
        value: item.querySelector('.item-value')?.textContent,
        cells: item.dataset.cells,
        topic: item.dataset.topic,
        section: item.dataset.section,
        panel: item.closest('.panel')?.id?.replace('panel-', ''),
        note: note || undefined,
        timestamp: new Date().toISOString()
      };
      console.log('Feedback:', feedback);

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
      window.feedbackLog.push(feedback);
      updateFeedbackCount();
      updateSectionStatus(item);
      saveState();
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
      editActions.querySelector('.save').addEventListener('click', () => {
        const newLabel = item.querySelector('.edit-label').value;
        const newValue = item.querySelector('.edit-value').value;

        labelEl.textContent = newLabel;
        valueEl.textContent = newValue || '(empty)';
        valueEl.classList.toggle('empty', !newValue);

        item.classList.remove('editing');
        item.classList.add('reviewed', 'edited');
        editActions.remove();

        // Log as edited
        const feedback = {
          action: 'edited',
          label: originalLabel,
          value: originalValue,
          editedLabel: newLabel !== originalLabel ? newLabel : undefined,
          editedValue: newValue !== originalValue ? newValue : undefined,
          cells: item.dataset.cells,
          section: item.dataset.section,
          topic: item.dataset.topic,
          panel: item.closest('.panel')?.id?.replace('panel-', ''),
          timestamp: new Date().toISOString()
        };
        window.feedbackLog = window.feedbackLog || [];
        window.feedbackLog.push(feedback);
        updateFeedbackCount();
        updateSectionStatus(item);
        saveState();
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

    // Update feedback count in export button
    function updateFeedbackCount() {
      const count = window.feedbackLog?.length || 0;
      const exportBtn = document.getElementById('export-toggle');
      exportBtn.textContent = count > 0 ? 'Export (' + count + ')' : 'Export';
      if (count > 0) exportBtn.classList.add('has-feedback');
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

    // Export feedback - generates multiple structured files
    document.getElementById('export-toggle').addEventListener('click', exportAll);

    function exportAll() {
      if (!window.feedbackLog || window.feedbackLog.length === 0) {
        showToast('No feedback to export');
        return;
      }

      const timestamp = new Date().toISOString();
      const dateStr = timestamp.split('T')[0];
      const sourceFile = '${structure.source.filename}';
      const safeName = sourceFile.replace(/[^a-zA-Z0-9]/g, '_');

      // Group feedback
      const accepted = window.feedbackLog.filter(f => f.action === 'correct');
      const rejected = window.feedbackLog.filter(f => f.action === 'wrong');
      const edited = window.feedbackLog.filter(f => f.action === 'edited');

      // Single comprehensive review file per questionnaire
      const review = {
        meta: {
          source: sourceFile,
          reviewedAt: timestamp,
          version: '1.0'
        },
        summary: {
          total: window.feedbackLog.length,
          accepted: accepted.length,
          rejected: rejected.length,
          edited: edited.length
        },
        index: {
          accepted: accepted.filter(f => f.panel === 'indexed').map(f => ({
            label: f.label,
            value: f.value,
            cells: f.cells,
            section: f.section,
            reviewedAt: f.timestamp
          })),
          rejected: rejected.filter(f => f.panel === 'indexed').map(f => ({
            label: f.label,
            value: f.value,
            cells: f.cells,
            section: f.section,
            reason: f.note || null,
            reviewedAt: f.timestamp
          })),
          edited: edited.filter(f => f.panel === 'indexed').map(f => ({
            original: { label: f.label, value: f.value },
            corrected: {
              label: f.editedLabel || f.label,
              value: f.editedValue || f.value
            },
            cells: f.cells,
            section: f.section,
            reviewedAt: f.timestamp
          }))
        },
        library: {
          accepted: accepted.filter(f => f.panel === 'library').map(f => ({
            label: f.label,
            value: f.value,
            topic: f.topic,
            cells: f.cells,
            reviewedAt: f.timestamp
          })),
          rejected: rejected.filter(f => f.panel === 'library').map(f => ({
            label: f.label,
            value: f.value,
            topic: f.topic,
            cells: f.cells,
            reason: f.note || null,
            reviewedAt: f.timestamp
          })),
          edited: edited.filter(f => f.panel === 'library').map(f => ({
            original: { label: f.label, value: f.value },
            corrected: {
              label: f.editedLabel || f.label,
              value: f.editedValue || f.value
            },
            topic: f.topic,
            cells: f.cells,
            reviewedAt: f.timestamp
          }))
        }
      };

      // Download single review file
      downloadJSON(review, safeName + '_review_' + dateStr + '.json');
      showToast('Saved review for ' + sourceFile);
    }

    function downloadJSON(data, filename) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    // Clear all feedback
    document.getElementById('clear-toggle').addEventListener('click', () => {
      if (!window.feedbackLog || window.feedbackLog.length === 0) {
        showToast('Nothing to clear');
        return;
      }

      if (confirm('Clear all ' + window.feedbackLog.length + ' feedback items? This cannot be undone.')) {
        window.feedbackLog = [];
        localStorage.removeItem(STORAGE_KEY);

        // Reset all item states
        document.querySelectorAll('.item').forEach(item => {
          item.classList.remove('reviewed', 'correct', 'wrong', 'edited', 'has-note');
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

    // Auto-save reminder on page unload
    window.addEventListener('beforeunload', (e) => {
      if (window.feedbackLog && window.feedbackLog.length > 0) {
        e.preventDefault();
        e.returnValue = 'You have unsaved feedback. Export before leaving?';
      }
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

      // Close help/clear selection with Escape
      if (key === 'escape') {
        if (helpModal.classList.contains('visible')) {
          toggleHelp();
        } else {
          clearHighlights();
          currentItemIndex = -1;
        }
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
          indexedItems[currentItemIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
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
          indexedItems[currentItemIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        <div class="item" data-index="${idx}" data-cells="${cells}" data-label="${this.escapeHtml(item.label)}" data-section="${this.escapeHtml(section.title)}">
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
}
