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
import type { QuestionnaireStructure, SheetData, CellData, DocumentType } from './excel-structure.js';
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
    // Build "Save as" panel from indexed data grouped by destination
    const saveAsHtml = this.buildSaveAsView(indexed);

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
    .panel-search {
      padding: 8px 16px;
      background: transparent;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-search input {
      flex: 1;
      padding: 6px 0;
      background: transparent !important;
      background-color: transparent !important;
      border: none;
      border-bottom: 1px solid rgba(255,255,255,0.15);
      border-radius: 0;
      color: var(--foreground);
      font-size: 12px;
      -webkit-appearance: none;
      appearance: none;
    }
    .panel-search input:focus {
      outline: none;
      border-bottom-color: rgba(255,255,255,0.3);
      box-shadow: none;
      background: transparent !important;
    }
    .panel-search input::placeholder {
      color: rgba(255,255,255,0.4);
    }
    .panel-search input:-webkit-autofill,
    .panel-search input:-webkit-autofill:hover,
    .panel-search input:-webkit-autofill:focus {
      -webkit-box-shadow: 0 0 0 1000px #1a1a1a inset !important;
      -webkit-text-fill-color: var(--foreground) !important;
      background-color: transparent !important;
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

    /* Document view (Word/PDF) */
    .document-view {
      padding: 16px;
      font-size: 13px;
      line-height: 1.6;
    }
    .document-view > div {
      padding: 8px 12px;
      border-radius: var(--radius);
      margin-bottom: 4px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .document-view > div:hover {
      background: var(--secondary);
    }
    .document-view > div.highlighted {
      background: rgba(59, 130, 246, 0.2);
      outline: 1px solid var(--primary);
    }
    .doc-section {
      margin-top: 16px;
      margin-bottom: 8px;
      border-left: 3px solid var(--primary);
      background: var(--card);
    }
    .doc-section h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--foreground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .doc-qa {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 12px;
      align-items: baseline;
      background: var(--card);
      border-left: 2px solid transparent;
    }
    .doc-qa:hover {
      border-left-color: var(--primary);
    }
    .doc-label {
      color: var(--muted-foreground);
    }
    .doc-label::after {
      content: ':';
    }
    .doc-value {
      color: var(--foreground);
      font-weight: 500;
      background: rgba(34, 197, 94, 0.1);
      padding: 2px 8px;
      border-radius: 4px;
    }
    .doc-value.empty {
      color: var(--muted-foreground);
      background: transparent;
      font-style: italic;
      font-weight: normal;
    }
    .doc-ref {
      font-family: monospace;
      font-size: 10px;
      color: var(--muted-foreground);
      opacity: 0.6;
    }
    .doc-para {
      color: var(--muted-foreground);
    }
    .doc-table-header {
      display: flex;
      gap: 16px;
      background: var(--secondary);
      font-weight: 600;
    }
    .doc-th {
      flex: 1;
      min-width: 100px;
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
      overflow-wrap: break-word;
      word-break: break-word;
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
    .item.reviewed.excluded { border-left-color: #6b7280; background: #1f2937; opacity: 0.4; }

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
    .group-btn.collapse-toggle {
      font-size: 10px;
      padding: 4px 8px;
      transition: transform 0.15s ease;
    }
    .group-btn.collapse-toggle.collapsed {
      transform: rotate(-90deg);
    }

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
      <button class="toggle active" data-panel="indexed" title="Toggle Extraction (2)">Extraction</button>
      <button class="toggle active" data-panel="library" title="Toggle Save as (3)">Save as</button>
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
            ${this.buildSheetView(sheet, structure.source.documentType)}
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Indexed View -->
    <div class="panel visible" id="panel-indexed">
      <div class="panel-header">
        <span>Extraction</span>
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

    <!-- Save As View (grouped by destination) -->
    <div class="panel visible" id="panel-library">
      <div class="panel-header">
        <span>Save as</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="count" id="save-as-count"></span>
          <button class="group-btn accept-all" id="accept-all-library" title="Accept all items">✓ Accept All</button>
          <button class="group-btn reject-all" id="reject-all-library" title="Reject all items">✗ Reject All</button>
        </div>
      </div>
      <div class="panel-content">
        ${saveAsHtml}
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

    // Render questionnaire list grouped by customer
    function renderQuestionnaires(questionnaires) {
      if (!questionnaires || questionnaires.length === 0) {
        questionnaireList.innerHTML = '<div class="sidebar-empty">No questionnaires found</div>';
        return;
      }

      // Group by customer
      const grouped = {};
      questionnaires.forEach(q => {
        const group = q.customer || 'Uncategorized';
        if (!grouped[group]) grouped[group] = [];
        grouped[group].push(q);
      });

      // Format date for display
      function formatDate(isoDate) {
        if (!isoDate) return '';
        const date = new Date(isoDate);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      // Render grouped list
      let html = '';
      Object.keys(grouped).sort().forEach(customer => {
        const items = grouped[customer];
        html += \`<div class="sidebar-section">
          <div class="sidebar-section-title">\${customer} (\${items.length})</div>\`;

        items.forEach(q => {
          const isActive = currentQuestionnaire.includes(q.name.replace(/_/g, '-')) ||
                          currentQuestionnaire.includes(q.name) ||
                          q.name.includes(currentQuestionnaire.replace(/[^a-zA-Z0-9]/g, '_'));
          const badgeClass = q.lastExported ? 'has-feedback' : (q.feedbackCount > 0 ? '' : '');
          const badgeText = q.lastExported ? '✓ ' + formatDate(q.lastExported) : (q.feedbackCount > 0 ? q.feedbackCount + ' reviewed' : 'Not started');

          html += \`
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
                <div class="sidebar-item-name" title="\${q.displayName}">\${q.displayName}</div>
                \${q.hasReview ? '' : '<div class="sidebar-item-meta">No review generated</div>'}
              </span>
              <span class="sidebar-item-badge \${badgeClass}">\${badgeText}</span>
            </a>
          \`;
        });

        html += '</div>';
      });

      questionnaireList.innerHTML = html;
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
                // Restore action state (skip destination_changed as it's just a change marker)
                if (feedback.action && feedback.action !== 'destination_changed') {
                  item.classList.add('reviewed', feedback.action);
                }
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
                // Restore destination (move item to correct section in library panel)
                if (feedback.destination && panel === 'library') {
                  item.dataset.destination = feedback.destination;
                  const targetSection = document.querySelector(\`#panel-library .section[data-destination="\${feedback.destination}"]\`);
                  if (targetSection) {
                    const itemsContainer = targetSection.querySelector('.section-items');
                    if (itemsContainer && item.parentElement !== itemsContainer) {
                      itemsContainer.appendChild(item);
                    }
                  }
                }
                window.feedbackLog.push({ ...feedback, panel });
              }
            });

            // Update section item counts after restoring destinations
            document.querySelectorAll('#panel-library .section').forEach(section => {
              const count = section.querySelectorAll('.item').length;
              const metaSpan = section.querySelector('.section-meta span');
              if (metaSpan) metaSpan.textContent = \`\${count} items\`;
              section.style.display = count > 0 ? '' : 'none';
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
                if (feedback.action && feedback.action !== 'destination_changed') {
                  item.classList.add('reviewed', feedback.action);
                }
                // Restore destination (move item to correct section in library panel)
                if (feedback.destination && feedback.panel === 'library') {
                  item.dataset.destination = feedback.destination;
                  const targetSection = document.querySelector(\`#panel-library .section[data-destination="\${feedback.destination}"]\`);
                  if (targetSection) {
                    const itemsContainer = targetSection.querySelector('.section-items');
                    if (itemsContainer && item.parentElement !== itemsContainer) {
                      itemsContainer.appendChild(item);
                    }
                  }
                }
              }
            });

            // Update section item counts after restoring destinations
            document.querySelectorAll('#panel-library .section').forEach(section => {
              const count = section.querySelectorAll('.item').length;
              const metaSpan = section.querySelector('.section-meta span');
              if (metaSpan) metaSpan.textContent = \`\${count} items\`;
              section.style.display = count > 0 ? '' : 'none';
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
            body: JSON.stringify({ panel, item: feedbackItem, questionnaire: currentQuestionnaire })
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

    // Utility: highlight cells in original panel (Excel or Document view)
    function highlightCells(cellRefs, className = 'highlighted') {
      if (!cellRefs) return;
      const refs = cellRefs.split(',');

      // Try Excel cells first
      refs.forEach(ref => {
        const cell = document.querySelector('td[data-cell="' + ref + '"]');
        if (cell) {
          cell.classList.add(className);
          cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
      });

      // Also try document view elements (check if any ref is in the element's data-cell list)
      document.querySelectorAll('.document-view > div[data-cell]').forEach(elem => {
        const elemRefs = (elem.dataset.cell || '').split(',');
        if (refs.some(ref => elemRefs.includes(ref))) {
          elem.classList.add(className);
          elem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

    // Cell tooltip and click (Excel)
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

    // Document view click handlers (Word/PDF)
    document.querySelectorAll('.document-view > div[data-cell]').forEach(elem => {
      elem.addEventListener('click', () => {
        // Clear previous highlights
        document.querySelectorAll('.document-view > div.highlighted').forEach(e => e.classList.remove('highlighted'));
        elem.classList.add('highlighted');

        if (syncMode) {
          // Get all cell refs from this element
          const cellRefs = (elem.dataset.cell || '').split(',');
          clearHighlights();
          elem.classList.add('highlighted');

          // Find matching indexed items
          allItems.forEach(item => {
            const itemCells = (item.dataset.cells || '').split(',');
            const hasMatch = cellRefs.some(ref => itemCells.includes(ref));
            if (hasMatch) {
              item.classList.add('highlighted');
              item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          });
        }
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
        const extractionRulesCount = (rulesResult.rules?.extractionRules?.exclude?.length || 0) +
                                     (rulesResult.rules?.extractionRules?.corrections?.length || 0);
        const tagRulesCount = rulesResult.rules?.tagRules?.learned_patterns?.length || 0;

        showToast('Saved ' + entityCount + ' entity, ' + libraryCount + ' library, ' + extractionRulesCount + ' extraction rules, ' + tagRulesCount + ' tag rules');
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
   * Build sheet view - routes to table or document view based on type
   */
  private buildSheetView(sheet: SheetData, documentType?: DocumentType): string {
    if (documentType === 'word' || documentType === 'pdf') {
      return this.buildDocumentView(sheet);
    }
    return this.buildSheetTable(sheet);
  }

  /**
   * Build markdown-style document view for Word/PDF
   */
  private buildDocumentView(sheet: SheetData): string {
    const lines: string[] = [];

    for (const row of sheet.rows) {
      const cells = Object.values(row.cells).filter(c => c.filled);
      if (cells.length === 0) continue;

      // Get all cell refs for this row (for clicking/highlighting)
      const cellRefs = cells.map(c => c.ref).join(',');

      if (row.rowType === 'section' || cells[0]?.role === 'section') {
        // Section header
        const text = cells[0]?.value || '';
        lines.push(`<div class="doc-section" data-cell="${cellRefs}" data-row="${row.row}">`);
        lines.push(`  <h3>${this.escapeHtml(text)}</h3>`);
        lines.push(`</div>`);
      } else if (cells.length >= 2 && (cells[0]?.role === 'label' || cells[1]?.role === 'value')) {
        // Q&A pair (label + value)
        const label = cells[0]?.value || '';
        const value = cells[1]?.value || '';
        const valueClass = value ? '' : ' empty';
        lines.push(`<div class="doc-qa" data-cell="${cellRefs}" data-row="${row.row}">`);
        lines.push(`  <span class="doc-label">${this.escapeHtml(label)}</span>`);
        lines.push(`  <span class="doc-value${valueClass}">${value ? this.escapeHtml(value) : '(empty)'}</span>`);
        lines.push(`  <span class="doc-ref">${cells[0]?.ref || ''}${cells[1] ? ' → ' + cells[1].ref : ''}</span>`);
        lines.push(`</div>`);
      } else if (row.rowType === 'header') {
        // Table header row
        lines.push(`<div class="doc-table-header" data-cell="${cellRefs}" data-row="${row.row}">`);
        for (const cell of cells) {
          lines.push(`  <span class="doc-th">${this.escapeHtml(cell.value)}</span>`);
        }
        lines.push(`</div>`);
      } else {
        // Regular paragraph/text
        const text = cells.map(c => c.value).join(' ');
        const role = cells[0]?.role || 'text';
        lines.push(`<div class="doc-para doc-${role}" data-cell="${cellRefs}" data-row="${row.row}">`);
        lines.push(`  ${this.escapeHtml(text)}`);
        lines.push(`</div>`);
      }
    }

    return `<div class="document-view">${lines.join('\n')}</div>`;
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
        // Destination badge colors (darker for better contrast)
        const destColors: Record<string, string> = {
          company: '#1e40af',      // dark blue
          answer_library: '#166534', // dark green
          product: '#9a3412',       // dark orange
          exclude: '#374151'        // dark gray
        };
        const destLabels: Record<string, string> = {
          company: 'COMPANY',
          answer_library: 'LIBRARY',
          product: 'PRODUCT',
          exclude: 'EXCLUDE'
        };
        const dest = (item as any).destination || '';
        const needsReview = (item as any).needs_review;
        const destBadge = dest ? `<span class="dest-badge" style="background: ${destColors[dest] || '#374151'}; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 600; letter-spacing: 0.5px; margin-left: 6px;">${destLabels[dest] || dest.toUpperCase()}</span>` : '';
        const needsReviewBadge = needsReview ? `<span class="needs-review-badge" style="background: #92400e; color: #fef3c7; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 600; letter-spacing: 0.5px; margin-left: 6px;">REVIEW</span>` : '';

        return `
        <div class="item${needsReview ? ' needs-review' : ''}" data-id="${item.id || ''}" data-index="${idx}" data-cells="${cells}" data-label="${this.escapeHtml(item.label)}" data-section="${this.escapeHtml(section.title)}" data-topic="${section.topic}" data-destination="${dest}">
          <div class="item-header">
            <span class="item-label">${this.escapeHtml(item.label)}${destBadge}${needsReviewBadge}</span>
            <span class="item-meta">${item.lCell || ''}${item.vCell && item.vCell !== item.lCell ? ':' + item.vCell : ''}</span>
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
   * Build "Save as" view - items grouped by destination
   */
  private buildSaveAsView(indexed: IndexedQuestionnaire): string {
    // Collect all items with destinations
    const byDestination: Record<string, Array<{ item: any; section: string }>> = {
      company: [],
      answer_library: [],
      product: [],
      exclude: []
    };

    for (const section of indexed.sections) {
      for (const item of section.items) {
        const dest = (item as any).destination;
        if (dest && byDestination[dest]) {
          byDestination[dest].push({ item, section: section.title });
        }
      }
    }

    // Destination labels and colors (darker for better visibility)
    const destInfo: Record<string, { label: string; color: string; description: string }> = {
      company: { label: 'Company Database', color: '#1e40af', description: 'Company-level data (contacts, certifications, etc.)' },
      answer_library: { label: 'Answer Library', color: '#166534', description: 'Reusable Q&A for auto-fill' },
      product: { label: 'Product Database', color: '#9a3412', description: 'Product-specific data' },
      exclude: { label: 'Excluded', color: '#374151', description: 'Not saved (signatures, etc.)' }
    };

    // Build sections for each destination
    const sectionsHtml = Object.entries(byDestination)
      .filter(([_, items]) => items.length > 0)
      .map(([dest, items]) => {
        const info = destInfo[dest];
        const itemsHtml = items.map(({ item, section }) => {
          const cells = [item.lCell, item.vCell].filter(Boolean).join(',');
          return `
          <div class="item" data-cells="${cells}" data-label="${this.escapeHtml(item.label)}" data-topic="${item.topic || ''}" data-destination="${dest}">
            <div class="item-header">
              <span class="item-label">${this.escapeHtml(item.label)}</span>
              <span class="item-meta">${item.lCell || ''}${item.vCell && item.vCell !== item.lCell ? ':' + item.vCell : ''}</span>
            </div>
            <div class="item-value${item.value ? '' : ' empty'}">${item.value ? this.escapeHtml(item.value) : '(empty)'}</div>
            <div class="item-ref">Section: ${this.escapeHtml(section)} | Topic: ${item.topic || 'other'}</div>
            <div class="item-note-display"></div>
            <div class="item-actions review-only">
              <button class="action-btn correct" title="Accept">✓</button>
              <button class="action-btn wrong" title="Reject">✗</button>
              <button class="action-btn edit" title="Edit">✎</button>
            </div>
            <div class="wrong-note-container">
              <input type="text" class="wrong-note-input" placeholder="Optional: Why reject this?">
              <div class="wrong-note-actions">
                <button class="wrong-note-btn save">Reject</button>
                <button class="wrong-note-btn cancel">Cancel</button>
              </div>
            </div>
          </div>
        `}).join('');

        return `
        <div class="section" data-destination="${dest}" style="border-left: 3px solid ${info.color};">
          <div class="section-header">
            <div class="section-header-left">
              <span class="section-title" style="color: ${info.color};">${info.label}</span>
              <span class="section-meta">${info.description}</span>
            </div>
            <div class="section-header-right">
              <span class="section-status">${items.length} items</span>
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

    const totalItems = Object.values(byDestination).reduce((sum, items) => sum + items.length, 0);

    if (totalItems === 0) {
      return '<p class="empty">No items with destinations yet. Run the TAG step first.</p>';
    }

    return `
      <div class="legend">
        <div class="legend-item"><span class="legend-color" style="background: #1e40af;"></span>Company</div>
        <div class="legend-item"><span class="legend-color" style="background: #166534;"></span>Answer Library</div>
        <div class="legend-item"><span class="legend-color" style="background: #9a3412;"></span>Product</div>
        <div class="legend-item"><span class="legend-color" style="background: #374151;"></span>Excluded</div>
      </div>
      ${sectionsHtml}
    `;
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

    /* Top tab bar (Warp-style) */
    .top-tab-bar {
      display: flex;
      align-items: center;
      background: #1a1a1c;
      border-bottom: 1px solid var(--border);
      padding: 0 8px;
      height: 40px;
      gap: 2px;
      overflow-x: auto;
    }
    .top-tab-bar::-webkit-scrollbar { height: 0; }
    .top-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: transparent;
      border: none;
      border-radius: 6px 6px 0 0;
      color: var(--muted-foreground);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      max-width: 200px;
      transition: all 0.15s ease;
    }
    .top-tab:hover { background: rgba(255,255,255,0.05); color: var(--foreground); }
    .top-tab.active { background: var(--background); color: var(--foreground); }
    .top-tab .tab-icon { font-size: 14px; opacity: 0.7; }
    .top-tab .tab-name { overflow: hidden; text-overflow: ellipsis; }
    .top-tab .tab-close {
      opacity: 0;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 14px;
      line-height: 1;
    }
    .top-tab:hover .tab-close { opacity: 0.5; }
    .top-tab .tab-close:hover { opacity: 1; background: rgba(255,255,255,0.1); }
    .top-tab-add {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: transparent;
      border: none;
      border-radius: 4px;
      color: var(--muted-foreground);
      font-size: 18px;
      cursor: pointer;
      margin-left: 4px;
    }
    .top-tab-add:hover { background: rgba(255,255,255,0.08); color: var(--foreground); }
    .top-tab .tab-check { color: #22c55e; margin-left: 4px; }
    .top-tab-right {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      padding-right: 8px;
    }
    .top-tab-right .toggle {
      padding: 4px 10px;
      font-size: 11px;
    }
    .sidebar-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: transparent;
      border: none;
      border-radius: 4px;
      color: var(--muted-foreground);
      cursor: pointer;
      margin-right: 8px;
    }
    .sidebar-toggle:hover { background: rgba(255,255,255,0.08); color: var(--foreground); }
    .top-tab-dropdown { position: relative; }
    .top-tab-dropdown-menu {
      position: absolute;
      top: 100%;
      left: 0;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      min-width: 250px;
      max-height: 400px;
      overflow-y: auto;
      z-index: 1000;
      display: none;
    }
    .top-tab-dropdown-menu.visible { display: block; }
    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      color: var(--foreground);
      cursor: pointer;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .dropdown-item:last-child { border-bottom: none; }
    .dropdown-item:hover { background: var(--muted); }
    .dropdown-item .item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dropdown-item .item-badge { font-size: 11px; color: var(--muted-foreground); }

    /* Header */
    .header {
      background: var(--card);
      padding: 8px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      height: 44px;
    }
    .header h1 {
      font-size: 13px;
      font-weight: 600;
      color: var(--foreground);
    }
    .header .meta {
      font-size: 11px;
      color: var(--muted-foreground);
      margin-top: 2px;
    }
    .app-title {
      display: none;
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

    /* Sidebar overlay */
    .sidebar-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 99;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s ease, visibility 0.2s ease;
    }
    .sidebar-overlay.visible { opacity: 1; visibility: visible; }

    /* Sidebar */
    .sidebar {
      position: fixed;
      left: 0;
      top: 40px;
      bottom: 40px;
      width: 300px;
      background: var(--card);
      border-right: 1px solid var(--border);
      flex-direction: column;
      z-index: 100;
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      display: flex;
    }
    .sidebar.open { transform: translateX(0); }
    .sidebar-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 500; font-size: 13px; }
    .sidebar-content { flex: 1; overflow-y: auto; }
    .sidebar-item {
      display: flex;
      align-items: center;
      padding: 10px 16px;
      cursor: pointer;
      transition: background 0.15s ease;
      border-bottom: 1px solid var(--border);
      text-decoration: none;
      color: inherit;
      gap: 8px;
    }
    .sidebar-item:hover { background: var(--muted); }
    .sidebar-item.active { background: var(--accent); border-left: 2px solid var(--foreground); }
    .sidebar-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .sidebar-item-badge { font-size: 11px; padding: 2px 6px; background: var(--muted); border-radius: 10px; color: var(--muted-foreground); }
    .sidebar-item-check { color: #22c55e; font-size: 14px; }
    .sidebar-section { margin-bottom: 8px; }
    .sidebar-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); padding: 8px 16px; background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); }

    /* Panel headers row */
    .panel-headers {
      display: flex;
      background: var(--card);
      border-bottom: 1px solid var(--border);
    }
    .panel-header-item {
      flex: 1;
      padding: 8px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 500;
      font-size: 13px;
      border-right: 1px solid var(--border);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .panel-header-item:hover { background: var(--muted); }
    .panel-header-item:last-child { border-right: none; }
    .panel-header-item.active {
      background: rgba(255, 255, 255, 0.05);
      border-bottom: 2px solid var(--foreground);
    }
    .panel-header-item.hidden {
      opacity: 0.5;
    }
    .panel-header-item .panel-toggle {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 8px;
      opacity: 0.5;
    }
    .panel-header-item.active .panel-toggle { opacity: 1; }

    /* Main layout: 40px tab bar + 36px sheet tabs + 40px panel headers + 40px stats bar */
    .main {
      display: flex;
      height: calc(100vh - 40px - 36px - 40px - 40px);
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
    .panel-search {
      padding: 8px 16px;
      background: transparent;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-search input {
      flex: 1;
      padding: 6px 0;
      background: transparent !important;
      background-color: transparent !important;
      border: none;
      border-bottom: 1px solid rgba(255,255,255,0.15);
      border-radius: 0;
      color: var(--foreground);
      font-size: 12px;
      -webkit-appearance: none;
      appearance: none;
    }
    .panel-search input:focus {
      outline: none;
      border-bottom-color: rgba(255,255,255,0.3);
      box-shadow: none;
      background: transparent !important;
    }
    .panel-search input::placeholder {
      color: rgba(255,255,255,0.4);
    }

    /* Sheet tabs (in header area) */
    .sheet-tabs {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 0 16px;
      background: var(--card);
      border-bottom: 1px solid var(--border);
      height: 36px;
      overflow-x: auto;
    }
    .sheet-tabs::-webkit-scrollbar { height: 0; }
    .sheet-tab {
      padding: 6px 14px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted-foreground);
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .sheet-tab:hover { color: var(--foreground); background: rgba(255,255,255,0.03); }
    .sheet-tab.active { color: var(--foreground); border-bottom-color: var(--foreground); background: transparent; }
    .sheet-tab-check { color: #22c55e; margin-left: 4px; font-size: 11px; }
    .sheet-content { display: none; }
    .sheet-content.active { display: block; }

    /* Open file button */
    .open-file-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--muted-foreground);
      font-size: 11px;
      cursor: pointer;
      margin-left: auto;
    }
    .open-file-btn:hover { background: var(--muted); color: var(--foreground); }

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
    .topic-badge {
      display: inline-block;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      margin-left: 6px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      background: var(--muted);
      color: var(--muted-foreground);
      vertical-align: middle;
    }
    .item.needs-review {
      border-color: #f59e0b !important;
      border-left-width: 3px;
    }
    .needs-review-filter {
      font-size: 10px;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid #f59e0b80;
      background: transparent;
      color: #fbbf24;
      cursor: pointer;
      margin-right: 8px;
    }
    .needs-review-filter:hover {
      background: #78350f40;
    }
    .needs-review-filter.active {
      background: #78350f80;
      border-color: #f59e0b;
    }
    .entity-badge {
      display: inline-block;
      font-size: 9px;
      padding: 1px 6px;
      border-radius: 3px;
      margin-left: 6px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: #fff;
      vertical-align: middle;
    }
    .entity-subsection {
      margin-bottom: 8px;
    }
    .entity-subsection-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      background: var(--background);
      font-size: 12px;
      margin-bottom: 4px;
    }
    .entity-subsection-title {
      font-weight: 500;
      color: var(--foreground);
    }
    .entity-subsection-count {
      font-size: 11px;
      color: var(--muted-foreground);
    }
    .entity-subsection-items {
      padding-left: 0;
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
      gap: 0;
      padding-left: 12px;
    }
    .section-items .item:last-child {
      border-bottom: none;
    }
    .section.collapsed .section-items { display: none; }
    .section.collapsed .collapse-arrow { transform: rotate(-90deg); }

    .item {
      padding: 8px 12px;
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--border);
      border-radius: 0;
      cursor: pointer;
      transition: background 0.1s ease;
    }
    .item:hover { background: var(--muted); }
    .item.selected {
      background: rgba(255, 255, 255, 0.05);
      border-left: 2px solid var(--muted-foreground);
      padding-left: 10px;
    }
    .item.selected:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .item.sync-highlight {
      outline: 2px solid #f59e0b;
      outline-offset: -2px;
      background: rgba(245, 158, 11, 0.15) !important;
      animation: pulse-highlight 1s ease-out;
    }
    @keyframes pulse-highlight {
      0% { outline-width: 4px; background: rgba(245, 158, 11, 0.3); }
      100% { outline-width: 2px; background: rgba(245, 158, 11, 0.15); }
    }
    .item.reviewed.correct, .item.reviewed.accepted {
      border-left: 3px solid #22c55e;
      padding-left: 9px;
      background: rgba(34, 197, 94, 0.05);
    }
    .item.reviewed.promoted {
      border-left: 3px solid #a855f7;
      padding-left: 9px;
      background: rgba(168, 85, 247, 0.05);
    }
    .item .dest-badge {
      flex-shrink: 0;
    }
    .item.reviewed.wrong, .item.reviewed.rejected {
      border-left: 3px solid #ef4444;
      padding-left: 9px;
      background: rgba(239, 68, 68, 0.05);
    }
    .item.no-value {
      opacity: 0.5;
    }
    .item.no-value .item-label,
    .item.no-value .item-value,
    .item.no-value .item-ref {
      color: var(--muted-foreground);
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
      overflow-wrap: break-word;
      word-break: break-word;
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
    .group-btn.collapse-toggle {
      font-size: 10px;
      padding: 4px 8px;
      transition: transform 0.15s ease;
    }
    .group-btn.collapse-toggle.collapsed {
      transform: rotate(-90deg);
    }

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

    /* Selection count badge */
    .selection-badge {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--foreground);
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      display: none;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 1000;
    }
    .selection-badge.visible {
      display: flex;
    }
    .selection-badge kbd {
      background: var(--muted);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
    }

    /* Command palette */
    .command-palette {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2000;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .command-palette.visible {
      display: flex;
    }
    .command-palette-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
    }
    .command-palette-modal {
      position: relative;
      z-index: 1;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      width: 400px;
      max-width: 90vw;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .command-palette-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    .command-palette-header .selected-count {
      font-weight: 500;
      color: var(--foreground);
    }
    .command-palette-header kbd {
      background: var(--muted);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      color: var(--muted-foreground);
    }
    .command-palette-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .property-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .property-row label {
      font-size: 11px;
      color: var(--muted-foreground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .property-row input,
    .property-row textarea,
    .property-row select {
      background: var(--muted);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 8px 12px;
      color: var(--foreground);
      font-size: 13px;
    }
    .property-row input:focus,
    .property-row textarea:focus,
    .property-row select:focus {
      outline: none;
      border-color: var(--muted-foreground);
    }
    .property-row textarea {
      min-height: 60px;
      resize: vertical;
    }
    .property-row.single-only {
      display: none;
    }
    .command-palette.single-select .property-row.single-only {
      display: flex;
    }
    .property-row.indexed-only,
    .property-row.library-only {
      display: none;
    }
    .command-palette.indexed-mode .property-row.indexed-only {
      display: flex;
    }
    .command-palette.library-mode .property-row.library-only {
      display: flex;
    }
    /* Show correct label based on mode */
    .indexed-label, .library-label { display: none; }
    .command-palette.indexed-mode .indexed-label { display: inline; }
    .command-palette.library-mode .library-label { display: inline; }
    .property-row.multi-only {
      display: none;
    }
    .command-palette.multi-select .property-row.multi-only {
      display: flex;
    }
    .property-row.indexed-only {
      display: none;
    }
    .command-palette.indexed-mode .property-row.indexed-only {
      display: flex;
    }
    .merge-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
    }
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 13px;
    }
    .checkbox-label input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }
    .merge-options select {
      padding: 6px 10px;
      background: var(--input);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--foreground);
      font-size: 13px;
    }
    .merge-options select:disabled {
      opacity: 0.5;
    }
    .command-palette-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--border);
    }
    .command-palette-footer button {
      padding: 8px 16px;
      border-radius: var(--radius);
      font-size: 13px;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--muted);
      color: var(--foreground);
    }
    .command-palette-footer button:hover {
      background: var(--border);
    }
    .command-palette-footer button.primary {
      background: var(--foreground);
      border-color: var(--foreground);
      color: var(--background);
    }
    .command-palette-footer button.primary:hover {
      background: var(--muted-foreground);
      border-color: var(--muted-foreground);
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
    <!-- Top tab bar (Warp-style) -->
    <div class="top-tab-bar" id="top-tab-bar">
      <button class="sidebar-toggle" id="sidebar-toggle" title="Open questionnaire list (B)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      <!-- Tabs populated by JS -->
      <button class="top-tab-add" id="add-tab-btn" title="Open questionnaire (+)">+</button>
      <div class="top-tab-right">
        <span id="connection-status" class="connection-status checking"></span>
        <button class="toggle" id="review-toggle" title="Toggle review mode (R)">Review</button>
        <button class="toggle" id="complete-toggle" title="Complete Review">Complete (<span id="feedback-count">0</span>)</button>
      </div>
    </div>

    <!-- Sidebar overlay -->
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <!-- Sidebar -->
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">Questionnaires</div>
      <div class="sidebar-content" id="sidebar-list"></div>
    </div>

    <!-- Hidden elements for compatibility -->
    <div style="display:none;">
      <span id="questionnaire-title"></span>
      <span id="questionnaire-meta"></span>
    </div>

    <!-- Sheet tabs (global - above all panels) -->
    <div id="sheet-tabs" class="sheet-tabs"></div>

    <!-- Panel headers row -->
    <div class="panel-headers">
      <div class="panel-header-item active" data-panel="original">
        <span class="panel-toggle">●</span>
        <span>Original Questionnaire</span>
        <span id="original-stats"></span>
      </div>
      <div class="panel-header-item active" data-panel="indexed">
        <span class="panel-toggle">●</span>
        <span>Extraction</span>
        <span id="indexed-stats"></span>
        <div class="group-btns review-only">
          <button class="group-btn collapse-toggle" id="toggle-collapse-indexed" title="Collapse/Expand all">▼</button>
          <button class="group-btn accept-all" id="accept-all-indexed">✓ Accept All</button>
          <button class="group-btn reject-all" id="reject-all-indexed">✗ Reject All</button>
        </div>
      </div>
      <div class="panel-header-item active" data-panel="library">
        <span class="panel-toggle">●</span>
        <span>Save as</span>
        <span id="library-stats"></span>
        <div class="group-btns review-only">
          <button class="group-btn collapse-toggle" id="toggle-collapse-library" title="Collapse/Expand all">▼</button>
          <button class="group-btn accept-all" id="accept-all-library">✓ Accept All</button>
          <button class="group-btn reject-all" id="reject-all-library">✗ Reject All</button>
        </div>
      </div>
    </div>

    <!-- Main content -->
    <div class="main">
      <div class="panel visible" id="panel-original">
        <div class="panel-content" id="original-content"></div>
      </div>

      <div class="panel visible" id="panel-indexed">
        <div class="panel-search">
          <button class="needs-review-filter" id="needs-review-filter" title="Show only items needing review" style="display:none">0 needs review</button>
          <input type="text" id="indexed-search" placeholder="Search label or value..." style="flex:1" />
        </div>
        <div class="panel-content" id="indexed-content"></div>
      </div>

      <div class="panel visible" id="panel-library">
        <div class="panel-search">
          <input type="text" id="library-search" placeholder="Search label or value..." />
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

  <!-- Selection badge -->
  <div class="selection-badge" id="selectionBadge">
    <span class="selection-count">0 items selected</span>
    <kbd>⌘K</kbd> to edit
  </div>

  <!-- Command palette -->
  <div class="command-palette" id="commandPalette">
    <div class="command-palette-backdrop"></div>
    <div class="command-palette-modal">
      <div class="command-palette-header">
        <span class="selected-count">0 items selected</span>
        <kbd>Esc</kbd>
      </div>
      <div class="command-palette-body">
        <div class="property-row single-only">
          <label>Label</label>
          <input type="text" id="bulkLabel" placeholder="Item label">
        </div>
        <div class="property-row single-only">
          <label>Value</label>
          <textarea id="bulkValue" placeholder="Item value"></textarea>
        </div>
        <div class="property-row indexed-only">
          <label>Section</label>
          <select id="bulkSection">
            <option value="">— Keep current —</option>
          </select>
        </div>
        <div class="property-row indexed-only">
          <label>Topic</label>
          <select id="bulkTopic">
            <option value="">— Keep current —</option>
          </select>
        </div>
        <div class="property-row">
          <label><span class="indexed-label">Destination</span><span class="library-label">Data Source</span></label>
          <select id="bulkDataSource">
            <option value="">— Keep current —</option>
            <option value="answer_library">Answer Library</option>
            <option value="entities">Entities (company-level)</option>
            <option value="products">Products (product-level)</option>
            <option value="exclude">Don't save</option>
          </select>
        </div>
        <div class="property-row entity-role-row" style="display: none;">
          <label>Entity Role</label>
          <select id="bulkEntityRole">
            <option value="">— Keep current —</option>
            <option value="supplier">Supplier (your customer)</option>
            <option value="client">Client (their customer)</option>
            <option value="manufacturer">Manufacturer</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="property-row indexed-only">
          <label>Extraction Quality</label>
          <select id="bulkExtractionQuality">
            <option value="">— No change —</option>
            <option value="correct">Correct extraction</option>
            <option value="wrong_location">Wrong location/cell</option>
            <option value="wrong_field">Wrong field extracted</option>
            <option value="missing_value">Value not captured</option>
            <option value="duplicate">Duplicate item</option>
          </select>
        </div>
        <div class="property-row extraction-note-row" style="display: none;">
          <label>Extraction Note</label>
          <input type="text" id="extractionNote" placeholder="Describe what's wrong with the extraction">
        </div>
        <div class="property-row">
          <label>Review Action</label>
          <select id="bulkAction">
            <option value="">— No action —</option>
            <option value="accept">Accept</option>
            <option value="reject">Reject</option>
            <option value="reset">Reset (clear review)</option>
          </select>
        </div>
        <div class="property-row reject-reason-row" style="display: none;">
          <label>Reject Reason</label>
          <input type="text" id="rejectReason" placeholder="Optional reason for rejection">
        </div>
        <div class="property-row multi-only">
          <label>Merge Values</label>
          <div class="merge-options">
            <label class="checkbox-label">
              <input type="checkbox" id="mergeValues">
              Combine values from selected items
            </label>
            <select id="mergeSeparator" disabled>
              <option value="\\n">New line</option>
              <option value=", ">Comma</option>
              <option value="; ">Semicolon</option>
              <option value=" | ">Pipe</option>
            </select>
          </div>
        </div>
      </div>
      <div class="command-palette-footer">
        <button class="cancel-btn" id="paletteCancel">Cancel</button>
        <button class="apply-btn primary" id="paletteApply">Apply Changes</button>
      </div>
    </div>
  </div>

  <script>
    // State
    let currentQuestionnaire = null;
    let questionnaireData = null;
    let feedbackLog = [];
    let serverConnected = false;
    const API_BASE = '';
    let openTabs = [];
    let allQuestionnaires = [];

    // Initialize
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
      // Check URL for questionnaire parameter
      const params = new URLSearchParams(window.location.search);
      const questionnaireId = params.get('q');

      // Check server connection
      await checkServerConnection();

      // Setup tab dropdown
      setupTabDropdown();

      // Load questionnaire list for dropdown
      try {
        const res = await fetch(API_BASE + '/api/questionnaires');
        const data = await res.json();
        allQuestionnaires = data.questionnaires || [];
        renderSidebar();
      } catch (err) {
        console.error('Failed to load questionnaires:', err);
      }

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

    // Tab bar management
    function renderTopTabs() {
      const tabBar = document.getElementById('top-tab-bar');
      const addBtn = document.getElementById('add-tab-btn');
      tabBar.querySelectorAll('.top-tab').forEach(t => t.remove());
      openTabs.forEach((tab, idx) => {
        const tabEl = document.createElement('button');
        tabEl.className = 'top-tab' + (tab.name === currentQuestionnaire ? ' active' : '');
        const checkHtml = tab.completed ? '<span class="tab-check">✓</span>' : '';
        tabEl.innerHTML = '<span class="tab-name">' + escapeHtml(tab.displayName) + '</span>' + checkHtml + '<span class="tab-close" title="Close tab">&times;</span>';
        tabEl.addEventListener('click', (e) => {
          if (e.target.classList.contains('tab-close')) { closeTab(idx); }
          else { switchToTab(tab.name); }
        });
        tabBar.insertBefore(tabEl, addBtn);
      });
    }

    function renderSidebar() {
      const sidebar = document.getElementById('sidebar-list');
      if (!sidebar) return;

      // Group by customer
      const grouped = {};
      allQuestionnaires.forEach(q => {
        const customer = q.customer || 'default';
        if (!grouped[customer]) grouped[customer] = [];
        grouped[customer].push(q);
      });

      // Sort customers (default last)
      const customers = Object.keys(grouped).sort((a, b) =>
        a === 'default' ? 1 : b === 'default' ? -1 : a.localeCompare(b)
      );

      let html = '';
      customers.forEach(customer => {
        html += '<div class="sidebar-section">' +
          '<div class="sidebar-section-title">' + escapeHtml(customer) + '</div>';

        grouped[customer].forEach(q => {
          const tab = openTabs.find(t => t.name === q.name);
          const isCompleted = tab?.completed || q.completed;
          html += '<div class="sidebar-item' + (currentQuestionnaire === q.name ? ' active' : '') + '" data-name="' + escapeHtml(q.name) + '">' +
            (isCompleted ? '<span class="sidebar-item-check">✓</span>' : '') +
            '<span class="sidebar-item-name">' + escapeHtml(q.displayName) + '</span>' +
            (q.feedbackCount ? '<span class="sidebar-item-badge">' + q.feedbackCount + '</span>' : '') +
            '</div>';
        });

        html += '</div>';
      });

      sidebar.innerHTML = html;
      sidebar.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
          const name = item.dataset.name;
          if (name) openTab(name);
          closeSidebar();
        });
      });
    }

    function openTab(name) {
      const q = allQuestionnaires.find(q => q.name === name);
      if (!q) return;
      if (!openTabs.some(t => t.name === name)) {
        openTabs.push({ name: q.name, displayName: q.displayName, completed: q.completed });
      }
      renderTopTabs();
      renderSidebar();
      loadQuestionnaire(name);
    }

    function markTabCompleted(name) {
      const tab = openTabs.find(t => t.name === name);
      if (tab) { tab.completed = true; }
      const q = allQuestionnaires.find(q => q.name === name);
      if (q) { q.completed = true; }
      renderTopTabs();
      renderSidebar();
    }

    // Sidebar toggle
    function openSidebar() {
      document.getElementById('sidebar')?.classList.add('open');
      document.getElementById('sidebar-overlay')?.classList.add('visible');
    }
    function closeSidebar() {
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sidebar-overlay')?.classList.remove('visible');
    }
    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      if (sidebar?.classList.contains('open')) { closeSidebar(); }
      else { openSidebar(); }
    }

    function closeTab(idx) {
      const tab = openTabs[idx];
      openTabs.splice(idx, 1);
      renderTopTabs();
      renderSidebar();
      if (tab.name === currentQuestionnaire) {
        if (openTabs.length > 0) {
          switchToTab(openTabs[Math.min(idx, openTabs.length - 1)].name);
        } else {
          currentQuestionnaire = null;
          history.pushState({}, '', window.location.pathname);
          showWelcome();
        }
      }
    }

    function switchToTab(name) {
      if (name === currentQuestionnaire) return;
      loadQuestionnaire(name);
    }

    function setupTabDropdown() {
      const addBtn = document.getElementById('add-tab-btn');
      const sidebarToggle = document.getElementById('sidebar-toggle');
      const sidebarOverlay = document.getElementById('sidebar-overlay');

      // Sidebar toggle
      sidebarToggle?.addEventListener('click', toggleSidebar);
      sidebarOverlay?.addEventListener('click', closeSidebar);

      // Add button opens sidebar
      addBtn?.addEventListener('click', openSidebar);
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
      allQuestionnaires = questionnaires || [];
      renderSidebar();

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
    }

    async function loadQuestionnaire(id) {
      document.getElementById('loading').style.display = 'flex';
      document.getElementById('welcome').style.display = 'none';
      document.getElementById('app').classList.remove('visible');

      try {
        const res = await fetch(API_BASE + '/api/questionnaire/' + encodeURIComponent(id), { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load questionnaire');

        questionnaireData = await res.json();
        currentQuestionnaire = id;

        // Update URL without reload
        history.pushState({}, '', '?q=' + encodeURIComponent(id));

        // Add to open tabs if not already there
        const q = allQuestionnaires.find(q => q.name === id);
        const displayName = q?.displayName || questionnaireData.structure?.source?.filename || id;
        if (!openTabs.some(t => t.name === id)) {
          openTabs.push({ name: id, displayName });
        }
        renderTopTabs();
        renderSidebar();

        // Load feedback FIRST if exists (before rendering)
        if (questionnaireData.feedback) {
          // Preserve panel info by adding _panel property
          feedbackLog = [
            ...(questionnaireData.feedback.index || []).map(fb => ({ ...fb, _panel: 'index' })),
            ...(questionnaireData.feedback.library || []).map(fb => ({ ...fb, _panel: 'library' }))
          ];
        }

        // Render the app (now autoAssignDestinations will see existing feedback)
        renderApp();

        document.getElementById('loading').style.display = 'none';
        document.getElementById('app').classList.add('visible');

        // Restore feedback state after rendering
        if (feedbackLog.length > 0) {
          updateFeedbackCount();
          restoreFeedbackState();
          syncExtractionBadges();
          // Render Save as panel from promoted items
          renderSaveAsPanel();
        }

        // Initial sync even without feedback (to show items that exist in Save as)
        setTimeout(() => syncExtractionBadges(), 100);

        // Update questionnaire list
        const questRes = await fetch(API_BASE + '/api/questionnaires', { cache: 'no-store' });
        const questData = await questRes.json();
        allQuestionnaires = questData.questionnaires || [];
        renderQuestionnaireList(questData.questionnaires);
        renderSidebar();

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

      // Render Save as panel from promoted items in feedbackLog
      // This will be empty initially until items are promoted from Extraction
      renderSaveAsPanel();

      // Update stats
      updateStats();

      // Setup event handlers
      setupEventHandlers();

      // Auto-assign destinations if no feedback exists
      autoAssignDestinations();
    }

    function renderOriginalPanel(structure) {
      const tabsContainer = document.getElementById('sheet-tabs');
      const contentContainer = document.getElementById('original-content');

      // Store sheet names for later use
      window.sheetNames = structure.sheets.map(s => s.name);

      // Render sheet tabs
      tabsContainer.innerHTML = structure.sheets.map((sheet, idx) => \`
        <button class="sheet-tab\${idx === 0 ? ' active' : ''}" data-sheet="\${idx}" data-sheet-name="\${escapeHtml(sheet.name)}">
          <span class="sheet-tab-name">\${escapeHtml(sheet.name)}</span>
          <span class="sheet-tab-check" style="display:none;">✓</span>
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
          contentContainer.querySelector(\`[data-sheet="\${tab.dataset.sheet}"]\`)?.classList.add('active');

          // Filter Extraction panel by sheet
          const sheetName = tab.dataset.sheetName;
          filterPanelsBySheet(sheetName);
        });
      });

      // Add "Open File" button
      const openFileBtn = document.createElement('button');
      openFileBtn.className = 'open-file-btn';
      openFileBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15,3 21,3 21,9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> Open File';
      openFileBtn.title = 'Open source file';
      openFileBtn.addEventListener('click', async () => {
        try {
          const res = await fetch(API_BASE + '/api/open-file/' + encodeURIComponent(currentQuestionnaire), { method: 'POST' });
          if (res.ok) showToast('Opening file...');
          else showToast('Failed to open file');
        } catch { showToast('Failed to open file'); }
      });
      tabsContainer.appendChild(openFileBtn);

      // Apply initial filter for first selected sheet
      const firstTab = tabsContainer.querySelector('.sheet-tab.active');
      if (firstTab) {
        const initialSheetName = firstTab.dataset.sheetName;
        filterPanelsBySheet(initialSheetName);
      }
    }

    // Update sheet tab checkmarks based on reviewed items
    function updateSheetTabCheckmarks() {
      const tabsContainer = document.getElementById('sheet-tabs');
      if (!tabsContainer || !window.sheetNames) return;

      window.sheetNames.forEach((sheetName, idx) => {
        const tab = tabsContainer.querySelector(\`[data-sheet="\${idx}"]\`);
        if (!tab) return;

        // Get all items for this sheet in Extraction panel
        // Use CSS.escape to handle special characters in sheet names (newlines, quotes, etc.)
        const escapedName = CSS.escape(sheetName);
        const sheetItems = document.querySelectorAll(\`#panel-indexed .item[data-sheet="\${escapedName}"]\`);
        if (sheetItems.length === 0) return;

        // Check if all items are reviewed
        const allReviewed = Array.from(sheetItems).every(item => item.classList.contains('reviewed'));
        const checkEl = tab.querySelector('.sheet-tab-check');
        if (checkEl) {
          checkEl.style.display = allReviewed ? 'inline' : 'none';
        }
      });
    }

    // Filter Indexed and Library sections by sheet name
    function filterPanelsBySheet(sheetName) {
      // Filter Indexed sections
      document.querySelectorAll('#panel-indexed .section').forEach(section => {
        const sectionSheet = section.dataset.sheet || '';
        // Show if: no filter (show all) OR exact sheet match
        if (!sheetName || sectionSheet === sheetName) {
          section.style.display = '';
        } else {
          section.style.display = 'none';
        }
      });

      // Save as panel always shows ALL items from ALL sheets combined
      // This allows spotting duplicates across sheets
      // Items are already filtered by questionnaire source in renderLibraryPanel

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

      // Library stats - always shows all items (not filtered by sheet)
      const totalLibraryItems = document.querySelectorAll('#panel-library .item').length;
      const libraryStatsEl = document.getElementById('library-stats');
      if (libraryStatsEl) {
        libraryStatsEl.textContent = \`\${totalLibraryItems} items (all sheets)\`;
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

          // Show topic badge for the item (use item's topic if available, otherwise section topic)
          const topic = item.topic || section.topic || 'general';
          const topicBadge = \`<span class="topic-badge">\${escapeHtml(topic)}</span>\`;

          // Destination badge (from TAG step)
          const dest = item.destination || null;
          const needsReview = item.needs_review || false;
          const destColors = {
            company: '#1e40af',
            answer_library: '#166534',
            product: '#9a3412',
            exclude: '#374151'
          };
          const destLabels = { company: 'COMPANY', answer_library: 'LIBRARY', product: 'PRODUCT', exclude: 'EXCLUDE' };
          const destBadge = dest ? \`<span class="dest-badge" style="background:\${destColors[dest] || '#374151'};color:#fff;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:600;letter-spacing:0.5px;margin-left:4px" title="\${item.tag_source || ''}">\${destLabels[dest] || dest.toUpperCase()}</span>\` : '';
          const reviewBadge = needsReview ? \`<span class="needs-review-badge" style="background:#78350f;color:#fcd34d;border:1px solid #f59e0b;padding:2px 6px;border-radius:4px;font-size:9px;margin-left:4px">needs review</span>\` : '';

          return \`
            <div class="item\${isEmpty ? ' no-value' : ''}\${needsReview ? ' needs-review' : ''}" data-id="\${item.id || ''}" data-index="\${idx}" data-cells="\${cells}" data-sheet="\${escapeHtml(sheetName)}" data-label="\${escapeHtml(item.label)}" data-section="\${escapeHtml(section.name || section.title)}" data-topic="\${item.topic || section.topic || ''}" data-level="\${item.level || 'standard'}" data-ai-destination="\${item.destination || ''}" data-needs-review="\${needsReview}">
              <div class="item-label">\${escapeHtml(item.label)}\${topicBadge}\${destBadge}\${reviewBadge}</div>
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

      // Count items needing review and setup filter
      const needsReviewItems = document.querySelectorAll('#panel-indexed .item[data-needs-review="true"]');
      const filterBtn = document.getElementById('needs-review-filter');
      if (needsReviewItems.length > 0) {
        filterBtn.style.display = 'inline-block';
        filterBtn.textContent = \`\${needsReviewItems.length} needs review\`;
        filterBtn.onclick = () => {
          filterBtn.classList.toggle('active');
          const showOnlyReview = filterBtn.classList.contains('active');
          document.querySelectorAll('#panel-indexed .item').forEach(item => {
            if (showOnlyReview && item.dataset.needsReview !== 'true') {
              item.style.display = 'none';
            } else {
              item.style.display = '';
            }
          });
          // Update section visibility
          document.querySelectorAll('#panel-indexed .section').forEach(section => {
            const visibleItems = section.querySelectorAll('.item:not([style*="display: none"])');
            section.style.display = visibleItems.length > 0 ? '' : 'none';
          });
        };
      } else {
        filterBtn.style.display = 'none';
      }
    }

    // Save as panel - shows items from Extraction that have destinations assigned
    // This is built dynamically from feedbackLog, not from answer-library
    function renderSaveAsPanel() {
      const container = document.getElementById('library-content');

      // Group promoted items by destination (exclude 'exclude' - those shouldn't show)
      const byDestination = {
        company: [],
        product: [],
        answer_library: []
      };

      // Get items with destinations from feedbackLog (excluding 'exclude')
      // Use destination field (or fall back to promotedTo for backwards compatibility)
      const itemsWithDest = feedbackLog.filter(fb => {
        const dest = fb.destination || fb.promotedTo;
        return fb.action === 'promoted' && dest && dest !== 'exclude';
      });

      // Deduplicate by ID (preferred) or cells+label, keeping the latest
      const deduped = new Map();
      for (const fb of itemsWithDest) {
        const key = fb.id || \`\${fb.cells}|\${fb.label}\`;
        const existing = deduped.get(key);
        if (!existing || new Date(fb.reviewedAt) > new Date(existing.reviewedAt)) {
          deduped.set(key, fb);
        }
      }

      // Group by destination
      let idx = 0;
      for (const fb of deduped.values()) {
        const dest = fb.destination || fb.promotedTo || 'answer_library';
        if (byDestination[dest]) {
          byDestination[dest].push({ ...fb, idx: idx++ });
        }
      }

      const totalItems = byDestination.company.length + byDestination.product.length + byDestination.answer_library.length;

      const destinationLabels = {
        company: 'Company (Entity)',
        product: 'Product',
        answer_library: 'Answer Library'
      };

      // Render a single item
      const renderItem = (item, dest) => {
        const sheetName = item.sheet || '';
        const cells = item.cells || '';
        const isEmpty = !item.value || item.value.trim() === '';
        const topic = item.topic || 'other';
        const topicBadge = \`<span class="topic-badge">\${topic}</span>\`;

        return \`
          <div class="item\${isEmpty ? ' no-value' : ''}" data-id="\${item.id || ''}" data-index="\${item.idx}" data-cells="\${cells}" data-sheet="\${escapeHtml(sheetName)}" data-label="\${escapeHtml(item.label || '')}" data-topic="\${topic}" data-destination="\${dest}">
            <div class="item-label">\${escapeHtml(item.label || '')}\${topicBadge}</div>
            <div class="item-value\${isEmpty ? ' empty' : ''}">\${isEmpty ? '(empty)' : escapeHtml(item.value || '')}</div>
            <div class="item-ref">\${sheetName ? sheetName + ': ' : ''}\${cells}</div>
          </div>
        \`;
      };

      // Render a section
      const renderSection = (dest, items) => {
        const itemsHtml = items.map(item => renderItem(item, dest)).join('');
        const isEmpty = items.length === 0;
        return \`
          <div class="section" data-destination="\${dest}" style="\${isEmpty ? 'display:none;' : ''}">
            <div class="section-header" style="cursor:pointer;">
              <span class="collapse-arrow" style="margin-right:8px;transition:transform 0.2s;">▼</span>
              <div class="section-title">\${destinationLabels[dest]}</div>
              <div class="section-meta">
                <span>\${items.length} items</span>
              </div>
            </div>
            <div class="section-items">\${itemsHtml}</div>
          </div>
        \`;
      };

      // Always render sections (even when empty) so promotion can add items to them
      const sectionsHtml = [
        renderSection('company', byDestination.company),
        renderSection('product', byDestination.product),
        renderSection('answer_library', byDestination.answer_library)
      ].join('');

      if (totalItems === 0) {
        container.innerHTML = '<div class="empty">No items with destinations yet. Assign destinations in Extraction panel.</div>' + sectionsHtml;
        document.getElementById('library-stats').textContent = '0 items';
      } else {
        container.innerHTML = sectionsHtml;
        document.getElementById('library-stats').textContent = \`\${totalItems} items\`;
      }
    }

    // Auto-assign destinations based on item level (only if no feedback exists)
    async function autoAssignDestinations() {
      // Skip if feedback already exists
      if (feedbackLog.length > 0) {
        console.log('Skipping auto-assign: feedback already exists');
        return;
      }

      const items = document.querySelectorAll('#panel-indexed .item');
      const destLabels = { answer_library: 'LIBRARY', company: 'COMPANY', product: 'PRODUCT', exclude: 'EXCLUDE' };
      const destBadgeColors = { answer_library: '#166534', company: '#1e40af', product: '#9a3412', exclude: '#374151' };

      let count = 0;
      let excludedCount = 0;
      for (const item of items) {
        // Use the AI-computed destination from indexing (stored in data-ai-destination)
        const aiDest = item.dataset.aiDestination || 'answer_library';
        if (aiDest === 'exclude') excludedCount++;

        // Mark item as promoted with AI destination
        item.classList.add('reviewed', 'correct', 'promoted');
        item.dataset.destination = aiDest;        // Current destination
        item.dataset.aiDestination = aiDest;      // Original AI destination (for revert)
        item.dataset.promotedTo = aiDest;         // Legacy compatibility

        // Add destination badge
        const destBadge = document.createElement('span');
        destBadge.className = 'dest-badge';
        destBadge.style.cssText = \`
          background: \${destBadgeColors[aiDest] || '#374151'};
          color: #fff;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-left: 8px;
        \`;
        destBadge.textContent = destLabels[aiDest] || aiDest.toUpperCase();

        const labelEl = item.querySelector('.item-label');
        if (labelEl && !labelEl.querySelector('.dest-badge')) {
          labelEl.appendChild(destBadge);
        }

        // Log feedback with original AI destination
        const reason = aiDest === 'exclude' ? 'AI: Excluded (empty)' : \`AI: \${destLabels[aiDest]}\`;
        await logFeedback(item, 'promoted', reason);
        count++;
      }

      // Refresh Save as panel
      renderSaveAsPanel();
      console.log(\`Auto-assigned \${count} items from AI (\${excludedCount} excluded)\`);
    }

    function setupEventHandlers() {
      // Panel toggles (from toggle buttons)
      document.querySelectorAll('.toggle[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
          btn.classList.toggle('active');
          const panelName = btn.dataset.panel;
          const panel = document.getElementById('panel-' + panelName);
          const headerItem = document.querySelector(\`.panel-header-item[data-panel="\${panelName}"]\`);
          const isVisible = btn.classList.contains('active');
          panel?.classList.toggle('visible', isVisible);
          headerItem?.classList.toggle('active', isVisible);
          headerItem?.classList.toggle('hidden', !isVisible);
        });
      });

      // Section header clicks to toggle collapse in Save as panel
      document.querySelectorAll('#panel-library .section-header').forEach(header => {
        header.style.cursor = 'pointer';
        header.addEventListener('click', (e) => {
          // Don't toggle if clicking on buttons inside
          if (e.target.closest('button')) return;
          const section = header.closest('.section');
          section?.classList.toggle('collapsed');
        });
      });

      // Panel header clicks to toggle panels
      document.querySelectorAll('.panel-header-item[data-panel]').forEach(header => {
        header.addEventListener('click', (e) => {
          // Don't toggle if clicking on buttons inside
          if (e.target.closest('.group-btn')) return;

          const panelName = header.dataset.panel;
          const panel = document.getElementById('panel-' + panelName);
          const isVisible = panel?.classList.contains('visible');

          // Toggle panel visibility
          panel?.classList.toggle('visible', !isVisible);
          header.classList.toggle('active', !isVisible);
          header.classList.toggle('hidden', isVisible);
        });
      });

      // Search functionality for Extraction and Save as panels
      function setupSearch(inputId, panelId) {
        const input = document.getElementById(inputId);
        if (!input) return;

        input.addEventListener('input', () => {
          const query = input.value.toLowerCase().trim();
          const panel = document.getElementById(panelId);
          if (!panel) return;

          panel.querySelectorAll('.section').forEach(section => {
            let visibleItems = 0;
            section.querySelectorAll('.item').forEach(item => {
              const label = (item.dataset.label || '').toLowerCase();
              const value = (item.querySelector('.item-value')?.textContent || '').toLowerCase();

              if (!query || label.includes(query) || value.includes(query)) {
                item.style.display = '';
                visibleItems++;
              } else {
                item.style.display = 'none';
              }
            });
            // Hide section if no visible items
            section.style.display = visibleItems > 0 ? '' : 'none';
          });

          // Update stats
          const statsId = panelId === 'panel-indexed' ? 'indexed-stats' : 'library-stats';
          const statsEl = document.getElementById(statsId);
          if (statsEl) {
            const visibleCount = panel.querySelectorAll('.item:not([style*="display: none"])').length;
            const totalCount = panel.querySelectorAll('.item').length;
            if (query) {
              statsEl.textContent = \`\${visibleCount} of \${totalCount} items (searching)\`;
            } else {
              statsEl.textContent = panelId === 'panel-library'
                ? \`\${totalCount} items (all sheets)\`
                : \`\${totalCount} items\`;
            }
          }
        });
      }

      setupSearch('indexed-search', 'panel-indexed');
      setupSearch('library-search', 'panel-library');

      // Review mode toggle
      document.getElementById('review-toggle')?.addEventListener('click', function() {
        this.classList.toggle('active');
        document.body.classList.toggle('review-mode', this.classList.contains('active'));
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

      // Multi-select state
      let selectedItems = new Set();
      let lastSelectedIndex = -1;
      const allItemElements = Array.from(document.querySelectorAll('.item'));

      function updateSelectionBadge() {
        const badge = document.getElementById('selectionBadge');
        const count = selectedItems.size;
        if (count > 0) {
          badge.querySelector('.selection-count').textContent = count + ' item' + (count === 1 ? '' : 's') + ' selected';
          badge.classList.add('visible');
        } else {
          badge.classList.remove('visible');
        }
      }

      function clearSelection() {
        selectedItems.forEach(item => item.classList.remove('selected'));
        selectedItems.clear();
        lastSelectedIndex = -1;
        updateSelectionBadge();
      }

      function selectItem(item, addToSelection = false) {
        if (!addToSelection) {
          clearSelection();
        }
        item.classList.add('selected');
        selectedItems.add(item);
        lastSelectedIndex = allItemElements.indexOf(item);
        updateSelectionBadge();
      }

      function toggleItemSelection(item) {
        if (selectedItems.has(item)) {
          item.classList.remove('selected');
          selectedItems.delete(item);
        } else {
          item.classList.add('selected');
          selectedItems.add(item);
          lastSelectedIndex = allItemElements.indexOf(item);
        }
        updateSelectionBadge();
      }

      function selectRange(fromIndex, toIndex) {
        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        for (let i = start; i <= end; i++) {
          const item = allItemElements[i];
          if (item) {
            item.classList.add('selected');
            selectedItems.add(item);
          }
        }
        updateSelectionBadge();
      }

      function selectAll() {
        allItemElements.forEach(item => {
          item.classList.add('selected');
          selectedItems.add(item);
        });
        updateSelectionBadge();
      }

      // Item click handlers with multi-select support
      document.querySelectorAll('.item').forEach((item, idx) => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.action-btn') || e.target.closest('.wrong-note-container')) return;

          if (e.shiftKey && lastSelectedIndex !== -1) {
            // Shift+click: select range
            selectRange(lastSelectedIndex, idx);
          } else if (e.metaKey || e.ctrlKey) {
            // Cmd/Ctrl+click: toggle selection
            toggleItemSelection(item);
          } else {
            // Normal click: select single
            selectItem(item);
            highlightCells(item.dataset.cells, item.dataset.sheet);

            // Cross-panel navigation
            const isIndexedItem = item.closest('#panel-indexed') !== null;
            const isLibraryItem = item.closest('#panel-library') !== null;

            if (isIndexedItem) {
              // Extraction item clicked → scroll to matching Save as item
              scrollToSaveAsItem(item.dataset.cells);
            } else if (isLibraryItem) {
              // Save as item clicked → scroll to matching Extraction item
              scrollToExtractionItem(item.dataset.cells, item.dataset.sheet);
            }
          }
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
          const isLibraryItem = item.closest('#panel-library') !== null;

          if (btn.classList.contains('correct')) {
            item.classList.remove('wrong', 'rejected', 'show-note');
            item.classList.add('reviewed', 'correct', 'accepted');
            showToast('Accepted');
            logFeedback(item, 'correct');
            // Sync badges when library item is accepted
            if (isLibraryItem) syncExtractionBadges();
          } else if (btn.classList.contains('wrong')) {
            // Immediately reject and save (note is optional)
            item.classList.remove('correct', 'accepted', 'show-note');
            item.classList.add('reviewed', 'wrong', 'rejected');
            showToast('Rejected');
            logFeedback(item, 'wrong');
            // Sync badges when library item is rejected
            if (isLibraryItem) syncExtractionBadges();
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

      // Panel-level Accept/Reject All (only for current sheet)
      function getVisibleItems(panelId) {
        // Only get items from visible sections (not filtered out by sheet)
        const items = [];
        document.querySelectorAll(\`#\${panelId} .section\`).forEach(section => {
          if (section.style.display !== 'none') {
            section.querySelectorAll('.item').forEach(item => items.push(item));
          }
        });
        return items;
      }

      document.getElementById('accept-all-indexed')?.addEventListener('click', () => {
        const items = getVisibleItems('panel-indexed');
        items.forEach(item => {
          item.classList.remove('wrong', 'rejected', 'show-note');
          item.classList.add('reviewed', 'correct', 'accepted');
          logFeedback(item, 'correct');
        });
        showToast(items.length + ' items accepted');
      });

      document.getElementById('reject-all-indexed')?.addEventListener('click', () => {
        const items = getVisibleItems('panel-indexed');
        items.forEach(item => {
          item.classList.remove('correct', 'accepted');
          item.classList.add('reviewed', 'wrong', 'rejected');
          logFeedback(item, 'wrong');
        });
        showToast(items.length + ' items rejected');
      });

      document.getElementById('accept-all-library')?.addEventListener('click', () => {
        const items = getVisibleItems('panel-library');
        items.forEach(item => {
          item.classList.remove('wrong', 'rejected', 'show-note');
          item.classList.add('reviewed', 'correct', 'accepted');
          logFeedback(item, 'correct');
        });
        showToast(items.length + ' items accepted');
        syncExtractionBadges();
      });

      document.getElementById('reject-all-library')?.addEventListener('click', () => {
        const items = getVisibleItems('panel-library');
        items.forEach(item => {
          item.classList.remove('correct', 'accepted');
          item.classList.add('reviewed', 'wrong', 'rejected');
          logFeedback(item, 'wrong');
        });
        showToast(items.length + ' items rejected');
      });

      // Topic-level Accept/Reject All in library (for data-topic buttons)
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

      // Destination-level Accept/Reject All in library (for data-destination buttons)
      document.querySelectorAll('#panel-library .group-btn[data-destination]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const dest = btn.dataset.destination;
          // Get all items in this destination section
          const section = btn.closest('.section');
          const items = section ? Array.from(section.querySelectorAll('.item')) : [];

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

      // Section-level Accept/Reject All in indexed panel (for sections filtered by sheet)
      document.querySelectorAll('#panel-indexed .section .group-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const section = btn.closest('.section');
          if (!section || section.style.display === 'none') return;

          const items = Array.from(section.querySelectorAll('.item'));

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

      // Collapse/Expand all toggle for panels
      document.getElementById('toggle-collapse-indexed')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const isCollapsed = btn.classList.toggle('collapsed');
        btn.textContent = isCollapsed ? '▶' : '▼';
        document.querySelectorAll('#panel-indexed .section').forEach(section => {
          section.classList.toggle('collapsed', isCollapsed);
        });
      });

      document.getElementById('toggle-collapse-library')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const isCollapsed = btn.classList.toggle('collapsed');
        btn.textContent = isCollapsed ? '▶' : '▼';
        document.querySelectorAll('#panel-library .section').forEach(section => {
          section.classList.toggle('collapsed', isCollapsed);
        });
      });

      // Command palette logic
      const commandPalette = document.getElementById('commandPalette');
      const paletteBackdrop = commandPalette?.querySelector('.command-palette-backdrop');

      function showCommandPalette() {
        if (selectedItems.size === 0) {
          showToast('Select items first');
          return;
        }

        const count = selectedItems.size;
        commandPalette.querySelector('.selected-count').textContent = count + ' item' + (count === 1 ? '' : 's') + ' selected';

        // Detect which panel the items are from
        const firstItem = Array.from(selectedItems)[0];
        const isLibraryItem = firstItem.closest('#panel-library') !== null;

        // Set mode classes
        commandPalette.classList.remove('indexed-mode', 'library-mode');
        if (isLibraryItem) {
          commandPalette.classList.add('library-mode');
        } else {
          commandPalette.classList.add('indexed-mode');
        }

        if (count === 1) {
          commandPalette.classList.add('single-select');
          commandPalette.classList.remove('multi-select');
          document.getElementById('bulkLabel').value = firstItem.dataset.label || '';
          document.getElementById('bulkValue').value = firstItem.querySelector('.item-value')?.textContent || '';
        } else {
          commandPalette.classList.remove('single-select');
          commandPalette.classList.add('multi-select');
          document.getElementById('bulkLabel').value = '';
          document.getElementById('bulkValue').value = '';
          // Reset merge options
          document.getElementById('mergeValues').checked = false;
          document.getElementById('mergeSeparator').disabled = true;
        }

        // Indexed mode: populate sections and topics
        if (!isLibraryItem) {
          const sectionSelect = document.getElementById('bulkSection');
          sectionSelect.innerHTML = '<option value="">— Keep current —</option>';
          const sections = new Set();
          document.querySelectorAll('#panel-indexed .section').forEach(sec => {
            const topic = sec.dataset.topic;
            if (topic) sections.add(topic);
          });
          sections.forEach(s => {
            sectionSelect.innerHTML += \`<option value="\${s}">\${s}</option>\`;
          });

          const topicSelect = document.getElementById('bulkTopic');
          topicSelect.innerHTML = '<option value="">— Keep current —</option>';
          const topics = new Set();
          document.querySelectorAll('#panel-indexed .item[data-topic]').forEach(item => {
            const t = item.dataset.topic;
            if (t) topics.add(t);
          });
          Array.from(topics).sort().forEach(t => {
            topicSelect.innerHTML += \`<option value="\${t}">\${t}</option>\`;
          });
        }

        // Library mode: reset data source
        if (isLibraryItem) {
          document.getElementById('bulkDataSource').value = '';
        }

        document.getElementById('bulkAction').value = '';
        document.getElementById('rejectReason').value = '';
        document.querySelector('.reject-reason-row').style.display = 'none';

        commandPalette.classList.add('visible');

        // Focus appropriate field
        if (isLibraryItem) {
          document.getElementById('bulkDataSource').focus();
        } else {
          document.getElementById('bulkTopic').focus();
        }
      }

      function hideCommandPalette() {
        commandPalette?.classList.remove('visible');
      }

      async function applyCommandPaletteChanges() {
        const topic = document.getElementById('bulkTopic')?.value;
        const dataSource = document.getElementById('bulkDataSource')?.value;
        console.log('applyCommandPaletteChanges - dataSource:', dataSource, 'topic:', topic);
        const entityRole = document.getElementById('bulkEntityRole')?.value;
        const action = document.getElementById('bulkAction').value;
        const newLabel = document.getElementById('bulkLabel').value;
        const newValue = document.getElementById('bulkValue').value;
        const rejectReason = document.getElementById('rejectReason')?.value || '';
        const mergeValues = document.getElementById('mergeValues')?.checked;
        const mergeSeparator = document.getElementById('mergeSeparator')?.value || '\\n';
        const extractionQuality = document.getElementById('bulkExtractionQuality')?.value;

        const items = Array.from(selectedItems);
        const isLibraryMode = commandPalette.classList.contains('library-mode');
        const firstItemPanel = items[0]?.closest('#panel-library') ? 'library' : items[0]?.closest('#panel-indexed') ? 'indexed' : 'unknown';
        console.log('items:', items.length, 'isLibraryMode:', isLibraryMode, 'firstItemPanel:', firstItemPanel);
        let changes = 0;

        // Handle merge values
        if (mergeValues && items.length > 1) {
          const values = items.map(item => {
            const valueEl = item.querySelector('.item-value');
            return valueEl?.textContent?.trim() || '';
          }).filter(v => v && v !== '(empty)');

          const mergedValue = values.join(mergeSeparator.replace(/\\\\n/g, '\\n'));

          // Update first item with merged value
          const firstItem = items[0];
          const firstValueEl = firstItem.querySelector('.item-value');
          if (firstValueEl) {
            firstValueEl.textContent = mergedValue;
            changes++;
          }

          // Mark other items as rejected (they've been merged into first)
          for (let i = 1; i < items.length; i++) {
            items[i].classList.add('reviewed', 'wrong', 'rejected');
            await logFeedback(items[i], 'wrong', 'Merged into another item');
          }

          // Accept the first item
          firstItem.classList.add('reviewed', 'correct', 'accepted');
          await logFeedback(firstItem, 'correct');

          hideCommandPalette();
          showToast(\`Merged \${values.length} values into 1 item\`);
          clearSelection();
          return;
        }

        for (const item of items) {
          // Indexed mode: update topic
          if (!isLibraryMode && topic) {
            item.dataset.topic = topic;
            // Update topic badge if present
            const badge = item.querySelector('.topic-badge');
            if (badge) badge.textContent = topic;
            changes++;
          }

          // Indexed mode: mark extraction quality
          if (!isLibraryMode && extractionQuality) {
            const qualityLabels = {
              correct: 'Correct extraction',
              wrong_location: 'Wrong location/cell',
              wrong_field: 'Wrong field extracted',
              missing_value: 'Value not captured',
              duplicate: 'Duplicate item'
            };
            const qualityColors = {
              correct: '#22c55e',
              wrong_location: '#f59e0b',
              wrong_field: '#ef4444',
              missing_value: '#8b5cf6',
              duplicate: '#6b7280'
            };

            item.dataset.extractionQuality = extractionQuality;
            item.classList.add('reviewed');

            if (extractionQuality === 'correct') {
              item.classList.add('correct');
            } else {
              item.classList.add('wrong', 'extraction-issue');
            }

            // Add or update extraction quality badge
            const existingQualityBadge = item.querySelector('.quality-badge');
            if (existingQualityBadge) existingQualityBadge.remove();

            const qualityBadge = document.createElement('span');
            qualityBadge.className = 'quality-badge';
            qualityBadge.style.cssText = \`
              background: \${qualityColors[extractionQuality] || '#6b7280'};
              color: white;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 10px;
              font-weight: 500;
              margin-left: 8px;
            \`;
            qualityBadge.textContent = qualityLabels[extractionQuality] || extractionQuality;

            const labelEl = item.querySelector('.item-label');
            if (labelEl) {
              labelEl.appendChild(qualityBadge);
            }

            await logFeedback(item, extractionQuality === 'correct' ? 'correct' : 'extraction_issue', qualityLabels[extractionQuality]);
            changes++;
          }

          // Indexed mode: promote to Save as panel
          if (!isLibraryMode && dataSource) {
            const destMap = { answer_library: 'answer_library', entities: 'company', products: 'product', exclude: 'exclude' };
            const newDest = destMap[dataSource] || dataSource;
            const destLabels = { answer_library: 'LIBRARY', company: 'COMPANY', product: 'PRODUCT', exclude: 'EXCLUDE' };
            const entityLabels = { supplier: 'Supplier', client: 'Client', manufacturer: 'Manufacturer', other: 'Other' };
            const entityColors = { supplier: '#3b82f6', client: '#22c55e', manufacturer: '#f59e0b', other: '#6b7280' };

            // Handle exclude: mark as excluded but don't add to library panel
            if (newDest === 'exclude') {
              item.classList.add('reviewed', 'excluded');
              item.classList.remove('promoted', 'correct', 'accepted');
              item.dataset.destination = 'exclude';
              item.dataset.promotedTo = 'exclude';

              // If item was already in Save as panel, remove it from there
              const itemId = item.dataset.id;
              const itemCells = item.dataset.cells;
              const itemLabel = item.dataset.label;
              let libraryItem = null;
              if (itemId) {
                libraryItem = document.querySelector(\`#panel-library .item[data-id="\${itemId}"]\`);
              }
              if (!libraryItem && itemCells) {
                libraryItem = document.querySelector(\`#panel-library .item[data-cells="\${itemCells}"][data-label="\${itemLabel}"]\`);
              }
              if (libraryItem) {
                libraryItem.remove();
                // Update section counts
                document.querySelectorAll('#panel-library .section').forEach(section => {
                  const count = section.querySelectorAll('.item').length;
                  const metaSpan = section.querySelector('.section-meta span');
                  if (metaSpan) metaSpan.textContent = \`\${count} items\`;
                  section.style.display = count > 0 ? '' : 'none';
                });
                const totalItems = document.querySelectorAll('#panel-library .item').length;
                document.getElementById('library-stats').textContent = \`\${totalItems} items (all sheets)\`;
              }

              // Add or update excluded badge
              const existingDestBadge = item.querySelector('.dest-badge');
              if (existingDestBadge) existingDestBadge.remove();

              const destBadge = document.createElement('span');
              destBadge.className = 'dest-badge';
              destBadge.style.cssText = \`
                background: #374151;
                color: #fff;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 9px;
                font-weight: 600;
                letter-spacing: 0.5px;
                margin-left: 8px;
              \`;
              destBadge.textContent = 'EXCLUDE';

              const labelEl = item.querySelector('.item-label');
              if (labelEl) {
                labelEl.appendChild(destBadge);
              }

              // Hide needs review badge when destination is assigned
              const needsReviewBadge = item.querySelector('.needs-review-badge');
              if (needsReviewBadge) needsReviewBadge.style.display = 'none';
              item.classList.remove('needs-review');

              await logFeedback(item, 'excluded', 'Marked as exclude (don\\'t save)');

              // Persist exclude destination to indexed file (itemId already declared above)
              if (itemId && serverConnected) {
                try {
                  await fetch(API_BASE + '/api/update-destination', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      questionnaireId: currentQuestionnaire,
                      itemId: itemId,
                      destination: 'exclude'
                    })
                  });
                } catch (e) {
                  console.error('Failed to persist exclude destination:', e);
                }
              }

              changes++;
              continue;  // Skip to next item, don't try to add to library
            }

            // Find the target section in library panel
            const targetSection = document.querySelector(\`#panel-library .section[data-destination="\${newDest}"]\`);
            if (targetSection) {
              // Create a new item for the library panel
              const label = item.dataset.label || item.querySelector('.item-label')?.textContent || '';
              const value = item.querySelector('.item-value')?.textContent || '';
              const cells = item.dataset.cells || '';
              const sheetName = item.dataset.sheet || '';
              const itemTopic = topic || item.dataset.topic || 'other';
              const role = entityRole || 'other';

              // Build topic badge
              const topicBadge = \`<span class="topic-badge">\${itemTopic}</span>\`;
              // Build entity badge for company destination
              const entityBadge = newDest === 'company'
                ? \`<span class="entity-badge" style="background:\${entityColors[role]}">\${entityLabels[role]}</span>\`
                : '';

              const newItem = document.createElement('div');
              newItem.className = 'item';
              if (item.dataset.id) newItem.dataset.id = item.dataset.id;  // Preserve unique ID
              newItem.dataset.cells = cells;
              newItem.dataset.sheet = sheetName;
              newItem.dataset.label = label;
              newItem.dataset.topic = itemTopic;
              newItem.dataset.destination = newDest;
              if (newDest === 'company') {
                newItem.dataset.entityRole = role;
              }
              newItem.innerHTML = \`
                <div class="item-label">\${escapeHtml(label)}\${entityBadge}\${topicBadge}</div>
                <div class="item-value">\${escapeHtml(value)}</div>
                <div class="item-ref">\${sheetName ? sheetName + ': ' : ''}\${cells}</div>
                <div class="item-actions">
                  <button class="btn-icon correct" title="Accept (A)">✓</button>
                  <button class="btn-icon wrong" title="Reject (X)">✕</button>
                </div>
              \`;

              // Attach event handlers
              newItem.addEventListener('click', (e) => {
                if (e.target.closest('.btn-icon')) return;
                toggleItemSelection(newItem);
              });
              newItem.querySelector('.btn-icon.correct')?.addEventListener('click', (e) => {
                e.stopPropagation();
                markItem(newItem, 'correct');
              });
              newItem.querySelector('.btn-icon.wrong')?.addEventListener('click', (e) => {
                e.stopPropagation();
                markItem(newItem, 'wrong');
              });

              // Add to correct container
              if (newDest === 'company' && entityRole) {
                const entitySubsection = targetSection.querySelector(\`.entity-subsection[data-entity-role="\${entityRole}"] .entity-subsection-items\`);
                if (entitySubsection) {
                  entitySubsection.appendChild(newItem);
                }
              } else if (newDest === 'company') {
                // Default to 'other' subsection
                const entitySubsection = targetSection.querySelector('.entity-subsection[data-entity-role="other"] .entity-subsection-items');
                if (entitySubsection) {
                  entitySubsection.appendChild(newItem);
                }
              } else {
                const itemsContainer = targetSection.querySelector('.section-items');
                if (itemsContainer) {
                  itemsContainer.appendChild(newItem);
                }
              }

              // Mark original item as promoted and add destination badge
              item.classList.add('reviewed', 'correct', 'promoted');
              item.classList.remove('needs-review');
              item.dataset.destination = newDest;  // Use destination as primary field
              item.dataset.promotedTo = newDest;   // Keep for backwards compatibility

              // Hide needs review badge when destination is assigned
              const needsReviewBadge = item.querySelector('.needs-review-badge');
              if (needsReviewBadge) needsReviewBadge.style.display = 'none';

              // Add destination badge to show where it was promoted
              const destBadgeLabels = { answer_library: 'LIBRARY', company: 'COMPANY', product: 'PRODUCT', exclude: 'EXCLUDE' };
              const destBadgeColors = { answer_library: '#166534', company: '#1e40af', product: '#9a3412', exclude: '#374151' };
              const existingDestBadge = item.querySelector('.dest-badge');
              if (existingDestBadge) existingDestBadge.remove();

              const destBadge = document.createElement('span');
              destBadge.className = 'dest-badge';
              destBadge.style.cssText = \`
                background: \${destBadgeColors[newDest] || '#374151'};
                color: #fff;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 9px;
                font-weight: 600;
                letter-spacing: 0.5px;
                margin-left: 8px;
              \`;
              destBadge.textContent = destBadgeLabels[newDest] || newDest.toUpperCase()

              // Add entity role to badge if applicable
              if (newDest === 'company' && entityRole) {
                destBadge.textContent += ' (' + entityLabels[entityRole] + ')';
              }

              const labelEl = item.querySelector('.item-label');
              if (labelEl) {
                labelEl.appendChild(destBadge);
              }

              // Update section counts
              document.querySelectorAll('#panel-library .section').forEach(section => {
                const count = section.querySelectorAll('.item').length;
                const metaSpan = section.querySelector('.section-meta span');
                if (metaSpan) metaSpan.textContent = \`\${count} items\`;
                section.style.display = count > 0 ? '' : 'none';

                // Update entity subsection counts
                section.querySelectorAll('.entity-subsection').forEach(subsection => {
                  const subCount = subsection.querySelectorAll('.item').length;
                  const countEl = subsection.querySelector('.entity-subsection-count');
                  if (countEl) countEl.textContent = \`\${subCount} items\`;
                  subsection.style.display = subCount > 0 ? '' : 'none';
                });
              });

              // Log feedback for the promotion
              await logFeedback(item, 'promoted', \`Promoted to \${destLabels[newDest]}\${entityRole ? ' (' + entityLabels[entityRole] + ')' : ''}\`);
              changes++;
            }
          }

          // Library mode: update data source and move to correct section
          if (isLibraryMode && dataSource) {
            console.log('Library mode - changing destination to:', dataSource);
            // Map dropdown values to destination keys
            const destMap = { answer_library: 'answer_library', entities: 'company', products: 'product', exclude: 'exclude' };
            const newDest = destMap[dataSource] || dataSource;
            console.log('newDest:', newDest, 'item.dataset.id:', item.dataset.id);
            item.dataset.destination = newDest;

            // Handle exclude: remove from Save as panel
            if (newDest === 'exclude') {
              // Remove from DOM
              item.remove();

              // Also update the original item in Extraction panel - remove promoted badge
              const itemId = item.dataset.id;
              const itemCells = item.dataset.cells;
              const itemLabel = item.dataset.label;
              let originalItem = null;
              if (itemId) {
                originalItem = document.querySelector(\`#panel-indexed .item[data-id="\${itemId}"]\`);
              }
              if (!originalItem && itemCells) {
                originalItem = document.querySelector(\`#panel-indexed .item[data-cells="\${itemCells}"][data-label="\${itemLabel}"]\`);
              }
              if (originalItem) {
                originalItem.classList.remove('promoted', 'needs-review');
                originalItem.classList.add('reviewed', 'excluded');
                originalItem.dataset.promotedTo = 'exclude';
                originalItem.dataset.destination = 'exclude';
                // Hide needs review badge
                const needsReviewBadge = originalItem.querySelector('.needs-review-badge');
                if (needsReviewBadge) needsReviewBadge.style.display = 'none';
                // Update badge to show excluded
                const existingBadge = originalItem.querySelector('.dest-badge');
                if (existingBadge) {
                  existingBadge.style.background = '#374151';
                  existingBadge.textContent = 'EXCLUDE';
                } else {
                  // Add excluded badge if not present
                  const destBadge = document.createElement('span');
                  destBadge.className = 'dest-badge';
                  destBadge.style.cssText = \`
                    background: #374151;
                    color: #fff;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 9px;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                    margin-left: 8px;
                  \`;
                  destBadge.textContent = 'EXCLUDE';
                  const labelEl = originalItem.querySelector('.item-label');
                  if (labelEl) labelEl.appendChild(destBadge);
                }
                // Log feedback for the original indexed item so it persists correctly
                await logFeedback(originalItem, 'excluded', 'Excluded from export');
              } else {
                // Fallback: log feedback for the removed item
                await logFeedback(item, 'excluded', 'Excluded from export');
              }

              // Persist exclude destination to indexed file
              if (itemId && serverConnected) {
                try {
                  await fetch(API_BASE + '/api/update-destination', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      questionnaireId: currentQuestionnaire,
                      itemId: itemId,
                      destination: 'exclude'
                    })
                  });
                } catch (e) {
                  console.error('Failed to persist exclude destination:', e);
                }
              }

              // Update section counts
              document.querySelectorAll('#panel-library .section').forEach(section => {
                const count = section.querySelectorAll('.item').length;
                const metaSpan = section.querySelector('.section-meta span');
                if (metaSpan) metaSpan.textContent = \`\${count} items\`;
                section.style.display = count > 0 ? '' : 'none';
              });

              // Update total count in header
              const totalItems = document.querySelectorAll('#panel-library .item').length;
              document.getElementById('library-stats').textContent = \`\${totalItems} items (all sheets)\`;

              changes++;
              continue; // Skip rest of library mode handling
            }

            // Find the target section and move the item
            const targetSection = document.querySelector(\`#panel-library .section[data-destination="\${newDest}"]\`);
            if (targetSection) {
              // For company destination, move to entity subsection if entity role is set
              if (newDest === 'company' && entityRole) {
                item.dataset.entityRole = entityRole;
                // Update entity badge
                const entityBadge = item.querySelector('.entity-badge');
                const entityLabels = { supplier: 'Supplier', client: 'Client', manufacturer: 'Manufacturer', other: 'Other' };
                const entityColors = { supplier: '#3b82f6', client: '#22c55e', manufacturer: '#f59e0b', other: '#6b7280' };
                if (entityBadge) {
                  entityBadge.textContent = entityLabels[entityRole];
                  entityBadge.style.background = entityColors[entityRole];
                } else {
                  // Add entity badge if not present
                  const labelEl = item.querySelector('.item-label');
                  if (labelEl) {
                    const badge = document.createElement('span');
                    badge.className = 'entity-badge';
                    badge.style.background = entityColors[entityRole];
                    badge.textContent = entityLabels[entityRole];
                    const topicBadge = labelEl.querySelector('.topic-badge');
                    if (topicBadge) {
                      labelEl.insertBefore(badge, topicBadge);
                    } else {
                      labelEl.appendChild(badge);
                    }
                  }
                }
                // Move to correct entity subsection
                const entitySubsection = targetSection.querySelector(\`.entity-subsection[data-entity-role="\${entityRole}"] .entity-subsection-items\`);
                if (entitySubsection && item.parentElement !== entitySubsection) {
                  entitySubsection.appendChild(item);
                }
              } else {
                const itemsContainer = targetSection.querySelector('.section-items');
                if (itemsContainer && item.parentElement !== itemsContainer) {
                  itemsContainer.appendChild(item);
                }
              }
            }

            // Also update the original item in Extraction panel
            const itemId = item.dataset.id;
            const itemCells = item.dataset.cells;
            const itemLabel = item.dataset.label;
            console.log('Destination change - itemId:', itemId, 'newDest:', newDest, 'serverConnected:', serverConnected);
            let originalItem = null;
            if (itemId) {
              originalItem = document.querySelector(\`#panel-indexed .item[data-id="\${itemId}"]\`);
            }
            if (!originalItem && itemCells) {
              originalItem = document.querySelector(\`#panel-indexed .item[data-cells="\${itemCells}"][data-label="\${itemLabel}"]\`);
            }
            if (originalItem) {
              originalItem.dataset.destination = newDest;
              originalItem.dataset.promotedTo = newDest;
              // Update badge in Extraction panel
              const destBadgeLabels = { answer_library: 'LIBRARY', company: 'COMPANY', product: 'PRODUCT', exclude: 'EXCLUDE' };
              const destBadgeColors = { answer_library: '#166534', company: '#1e40af', product: '#9a3412', exclude: '#374151' };
              const existingBadge = originalItem.querySelector('.dest-badge');
              if (existingBadge) {
                existingBadge.style.background = destBadgeColors[newDest] || '#374151';
                existingBadge.textContent = destBadgeLabels[newDest] || newDest.toUpperCase();
              }
            }

            // Update section item counts
            document.querySelectorAll('#panel-library .section').forEach(section => {
              const count = section.querySelectorAll('.item').length;
              const metaSpan = section.querySelector('.section-meta span');
              if (metaSpan) metaSpan.textContent = \`\${count} items\`;
              // Hide empty sections
              section.style.display = count > 0 ? '' : 'none';
            });

            // Update entity subsection counts
            document.querySelectorAll('#panel-library .entity-subsection').forEach(subsection => {
              const count = subsection.querySelectorAll('.item').length;
              const countEl = subsection.querySelector('.entity-subsection-count');
              if (countEl) countEl.textContent = \`\${count} items\`;
            });

            // Save destination change (include entity role)
            await logFeedback(item, 'destination_changed', \`Moved to \${newDest}\${entityRole ? ' (' + entityRole + ')' : ''}\`);

            // Persist destination change to indexed YAML (itemId already declared above)
            if (itemId && serverConnected) {
              try {
                await fetch(API_BASE + '/api/update-destination', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    questionnaireId: currentQuestionnaire,
                    itemId: itemId,
                    destination: newDest
                  })
                });
              } catch (e) {
                console.error('Failed to persist destination:', e);
              }
            }

            changes++;
          }

          // Library mode: update entity role only (if data source not changed)
          if (isLibraryMode && entityRole && !dataSource && item.dataset.destination === 'company') {
            item.dataset.entityRole = entityRole;
            // Update entity badge
            const entityBadge = item.querySelector('.entity-badge');
            const entityLabels = { supplier: 'Supplier', client: 'Client', manufacturer: 'Manufacturer', other: 'Other' };
            const entityColors = { supplier: '#3b82f6', client: '#22c55e', manufacturer: '#f59e0b', other: '#6b7280' };
            if (entityBadge) {
              entityBadge.textContent = entityLabels[entityRole];
              entityBadge.style.background = entityColors[entityRole];
            }
            // Move to correct entity subsection
            const companySection = document.querySelector('#panel-library .section[data-destination="company"]');
            if (companySection) {
              const entitySubsection = companySection.querySelector(\`.entity-subsection[data-entity-role="\${entityRole}"] .entity-subsection-items\`);
              if (entitySubsection && item.parentElement !== entitySubsection) {
                entitySubsection.appendChild(item);
              }
              // Update entity subsection counts
              companySection.querySelectorAll('.entity-subsection').forEach(subsection => {
                const count = subsection.querySelectorAll('.item').length;
                const countEl = subsection.querySelector('.entity-subsection-count');
                if (countEl) countEl.textContent = \`\${count} items\`;
              });
            }
            await logFeedback(item, 'entity_role_changed', \`Changed to \${entityRole}\`);
            changes++;
          }

          if (selectedItems.size === 1) {
            if (newLabel && newLabel !== item.dataset.label) {
              item.dataset.label = newLabel;
              const labelEl = item.querySelector('.item-label');
              if (labelEl) {
                const existingBadge = labelEl.querySelector('.topic-badge');
                labelEl.textContent = newLabel;
                if (existingBadge) labelEl.appendChild(existingBadge);
              }
              changes++;
            }
            if (newValue) {
              const valueEl = item.querySelector('.item-value');
              if (valueEl && valueEl.textContent !== newValue) {
                valueEl.textContent = newValue;
                changes++;
              }
            }
          }

          if (action) {
            item.classList.remove('reviewed', 'correct', 'wrong', 'accepted', 'rejected', 'show-note');
            if (action === 'accept') {
              item.classList.add('reviewed', 'correct', 'accepted');
              await logFeedback(item, 'correct');
            } else if (action === 'reject') {
              item.classList.add('reviewed', 'wrong', 'rejected');
              await logFeedback(item, 'wrong', rejectReason);
            }
            changes++;
          }
        }

        hideCommandPalette();
        if (changes > 0) {
          showToast(\`Updated \${items.length} item(s)\`);
        }
        clearSelection();
      }

      paletteBackdrop?.addEventListener('click', hideCommandPalette);
      document.getElementById('paletteCancel')?.addEventListener('click', hideCommandPalette);
      document.getElementById('paletteApply')?.addEventListener('click', applyCommandPaletteChanges);

      // Merge checkbox enables/disables separator
      document.getElementById('mergeValues')?.addEventListener('change', (e) => {
        document.getElementById('mergeSeparator').disabled = !e.target.checked;
      });

      // Show/hide reject reason based on action
      document.getElementById('bulkAction')?.addEventListener('change', (e) => {
        const rejectRow = document.querySelector('.reject-reason-row');
        if (rejectRow) {
          rejectRow.style.display = e.target.value === 'reject' ? '' : 'none';
        }
      });

      // Show/hide entity role based on data source
      document.getElementById('bulkDataSource')?.addEventListener('change', (e) => {
        const entityRoleRow = document.querySelector('.entity-role-row');
        if (entityRoleRow) {
          entityRoleRow.style.display = e.target.value === 'entities' ? '' : 'none';
        }
      });

      // Keyboard shortcuts for selection and command palette
      document.addEventListener('keydown', (e) => {
        if (commandPalette?.classList.contains('visible')) {
          if (e.key === 'Escape') {
            hideCommandPalette();
            e.preventDefault();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            applyCommandPaletteChanges();
            e.preventDefault();
          }
          return;
        }

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key === 'Escape') {
          clearSelection();
          return;
        }

        if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
          e.preventDefault();
          selectAll();
          return;
        }

        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          showCommandPalette();
          return;
        }
      });
    }

    async function logFeedback(item, action, note = '') {
      const panel = item.closest('.panel')?.id?.replace('panel-', '') || 'indexed';
      const feedbackItem = {
        action: action === 'correct' ? 'accepted' : action === 'wrong' ? 'rejected' : action,
        id: item.dataset.id || undefined,  // Unique item ID for reliable matching
        label: item.dataset.label || item.querySelector('.item-label')?.textContent,
        value: item.querySelector('.item-value')?.textContent,
        cells: item.dataset.cells,
        sheet: item.dataset.sheet,  // Include sheet name
        section: item.dataset.section,
        topic: item.dataset.topic,
        aiDestination: item.dataset.aiDestination,  // Original AI-suggested destination
        destination: item.dataset.destination,       // Current destination (may be overridden)
        promotedTo: item.dataset.promotedTo || undefined,
        reason: note,
        reviewedAt: new Date().toISOString()
      };

      // Update local log - prefer ID matching, fall back to cells+label
      const existingIdx = feedbackLog.findIndex(f =>
        feedbackItem.id ? f.id === feedbackItem.id : (f.cells === feedbackItem.cells && f.label === feedbackItem.label)
      );
      if (existingIdx >= 0) {
        feedbackLog[existingIdx] = feedbackItem;
      } else {
        feedbackLog.push(feedbackItem);
      }
      updateFeedbackCount();
      updateSheetTabCheckmarks();

      // Re-render Save as panel when items are promoted
      if (feedbackItem.action === 'promoted') {
        renderSaveAsPanel();
      }

      // Save to server
      if (serverConnected) {
        try {
          await fetch(API_BASE + '/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ panel, item: feedbackItem, questionnaire: currentQuestionnaire })
          });
        } catch (err) {
          console.error('Failed to save feedback:', err);
        }
      }
    }

    function markItem(item, action) {
      const isLibraryItem = item.closest('#panel-library') !== null;
      if (action === 'correct') {
        item.classList.remove('wrong', 'rejected', 'show-note');
        item.classList.add('reviewed', 'correct', 'accepted');
        logFeedback(item, 'correct');
        if (isLibraryItem) syncExtractionBadges();
      } else if (action === 'wrong') {
        item.classList.remove('correct', 'accepted', 'show-note');
        item.classList.add('reviewed', 'wrong', 'rejected');
        logFeedback(item, 'wrong');

        // If rejecting from Save as panel, remove from panel and update Extraction
        if (isLibraryItem) {
          // Find and update source item in Extraction panel
          const itemId = item.dataset.id;
          const itemCells = item.dataset.cells;
          const itemLabel = item.dataset.label;
          let sourceItem = null;
          if (itemId) {
            sourceItem = document.querySelector(\`#panel-indexed .item[data-id="\${itemId}"]\`);
          }
          if (!sourceItem && itemCells) {
            sourceItem = document.querySelector(\`#panel-indexed .item[data-cells="\${itemCells}"][data-label="\${itemLabel}"]\`);
          }
          if (sourceItem) {
            // Update source item to show rejected
            sourceItem.classList.remove('promoted', 'correct', 'accepted');
            sourceItem.classList.add('reviewed', 'wrong', 'rejected');
            sourceItem.dataset.destination = '';
            sourceItem.dataset.promotedTo = '';
            // Update badge to show rejected
            const badge = sourceItem.querySelector('.dest-badge');
            if (badge) {
              badge.style.background = '#ef4444';
              badge.textContent = 'Rejected';
            }
          }

          // Remove from Save as panel
          item.remove();

          // Update counts
          document.querySelectorAll('#panel-library .section').forEach(section => {
            const count = section.querySelectorAll('.item').length;
            const metaSpan = section.querySelector('.section-meta span');
            if (metaSpan) metaSpan.textContent = \`\${count} items\`;
            section.style.display = count > 0 ? '' : 'none';
          });
          const totalItems = document.querySelectorAll('#panel-library .item').length;
          document.getElementById('library-stats').textContent = \`\${totalItems} items (all sheets)\`;

          syncExtractionBadges();
        }
      }
    }

    function updateFeedbackCount() {
      // Count only accepted items (these will be exported)
      const acceptedCount = feedbackLog.filter(f =>
        f.action === 'accepted' || f.action === 'edited' || f.action === 'destination_changed' || f.action === 'promoted'
      ).length;
      const totalCount = feedbackLog.length;

      // Show "X accepted / Y total"
      const countEl = document.getElementById('feedback-count');
      if (acceptedCount === totalCount) {
        countEl.textContent = acceptedCount;
      } else {
        countEl.textContent = \`\${acceptedCount}/\${totalCount}\`;
      }
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

        // Handle promoted items from indexed panel FIRST - create in library if needed
        // Note: _panel may be undefined for older feedback items, so we check for 'indexed' OR undefined
        // Promoted items always originate from the indexed panel
        if (fb.action === 'promoted' && (fb._panel === 'index' || fb._panel === 'indexed' || !fb._panel)) {
          // Get destination
          let promotedTo = fb.promotedTo;
          if (!promotedTo && fb.reason) {
            if (fb.reason.includes('Entities')) promotedTo = 'company';
            else if (fb.reason.includes('Products')) promotedTo = 'product';
            else if (fb.reason.includes('Answer Library')) promotedTo = 'answer_library';
            else if (fb.reason.includes('Excluded')) promotedTo = 'exclude';
          }
          promotedTo = promotedTo || 'answer_library';

          const entityMatch = fb.reason?.match(/\\((\\w+)\\)/);
          const entityRole = entityMatch?.[1] || fb.entityRole || 'other';

          // Create the item in the library panel if it doesn't exist
          // Prefer ID matching if available
          const escapedLabel = (fb.label || '').replace(/"/g, '\\\\"');
          const existingLibItem = fb.id
            ? document.querySelector(\`#panel-library .item[data-id="\${fb.id}"]\`)
            : document.querySelector(\`#panel-library .item[data-cells="\${fb.cells}"][data-label="\${escapedLabel}"]\`);

          if (!existingLibItem) {
            const targetSection = document.querySelector(\`#panel-library .section[data-destination="\${promotedTo}"]\`);
            if (targetSection) {
              const destBadgeLabels = { answer_library: 'LIBRARY', company: 'COMPANY', product: 'PRODUCT', exclude: 'EXCLUDE' };
              const destBadgeColors = { answer_library: '#166534', company: '#1e40af', product: '#9a3412', exclude: '#374151' };
              const entityLabels = { supplier: 'Supplier', client: 'Client', manufacturer: 'Manufacturer', other: 'Other' };
              const entityColors = { supplier: '#3b82f6', client: '#22c55e', manufacturer: '#f59e0b', other: '#6b7280' };

              const label = fb.label || '';
              const value = fb.value || '';
              const cells = fb.cells || '';
              const sheetName = fb.sheet || '';
              const itemTopic = fb.topic || 'other';

              // Build badges
              const topicBadge = \`<span class="topic-badge">\${itemTopic}</span>\`;
              const entityBadge = promotedTo === 'company'
                ? \`<span class="entity-badge" style="background:\${entityColors[entityRole]}">\${entityLabels[entityRole]}</span>\`
                : '';

              const newItem = document.createElement('div');
              newItem.className = 'item reviewed correct accepted';
              if (fb.id) newItem.dataset.id = fb.id;  // Preserve unique ID
              newItem.dataset.cells = cells;
              newItem.dataset.sheet = sheetName;
              newItem.dataset.label = label;
              newItem.dataset.topic = itemTopic;
              newItem.dataset.destination = promotedTo;
              if (promotedTo === 'company') {
                newItem.dataset.entityRole = entityRole;
              }
              newItem.innerHTML = \`
                <div class="item-label">\${label}\${entityBadge}\${topicBadge}</div>
                <div class="item-value">\${value}</div>
                <div class="item-ref">\${sheetName ? sheetName + ': ' : ''}\${cells}</div>
                <div class="item-actions review-only">
                  <button class="action-btn correct" title="Accept (C)">✓</button>
                  <button class="action-btn wrong" title="Reject (W)">✗</button>
                </div>
              \`;

              // Add to correct container
              if (promotedTo === 'company') {
                const entitySubsection = targetSection.querySelector(\`.entity-subsection[data-entity-role="\${entityRole}"] .entity-subsection-items\`);
                if (entitySubsection) {
                  entitySubsection.appendChild(newItem);
                  entitySubsection.closest('.entity-subsection').style.display = '';
                } else {
                  targetSection.querySelector('.section-items')?.appendChild(newItem);
                }
              } else {
                targetSection.querySelector('.section-items')?.appendChild(newItem);
              }

              // Show section if hidden
              targetSection.style.display = '';
            }
          }
        }

        // Use panel-specific selector to avoid applying feedback to wrong panel
        const panelSelector = fb._panel === 'library' ? '#panel-library' : '#panel-indexed';

        // Find items - prefer ID matching, fall back to cells+label for legacy feedback
        const allItems = document.querySelectorAll(\`\${panelSelector} .item\`);
        const items = Array.from(allItems).filter(item => {
          // Prefer ID-based matching if feedback has an ID
          if (fb.id && item.dataset.id) {
            return fb.id === item.dataset.id;
          }
          // Fall back to cells+label matching for legacy feedback
          const itemCells = item.dataset.cells || '';
          const fbCells = fb.cells || '';
          // Match if exact match OR if item cells end with feedback cells (handles sheet prefix)
          const cellsMatch = itemCells === fbCells || itemCells.endsWith(': ' + fbCells) || itemCells.endsWith(fbCells);
          // Also match by label for additional accuracy
          const labelMatch = !fb.label || !item.dataset.label || item.dataset.label === fb.label;
          return cellsMatch && labelMatch;
        });
        items.forEach(item => {

          if (fb.action === 'accepted') {
            item.classList.add('reviewed', 'correct', 'accepted');
          } else if (fb.action === 'rejected') {
            item.classList.add('reviewed', 'wrong', 'rejected');
          } else if (fb.action === 'excluded') {
            // Restore excluded state
            item.classList.add('reviewed', 'excluded');
            item.classList.remove('needs-review');
            item.dataset.destination = 'exclude';
            item.dataset.promotedTo = 'exclude';

            // Hide needs review badge
            const needsReviewBadge = item.querySelector('.needs-review-badge');
            if (needsReviewBadge) needsReviewBadge.style.display = 'none';

            // Add excluded badge if not present
            const existingDestBadge = item.querySelector('.dest-badge');
            if (!existingDestBadge) {
              const destBadge = document.createElement('span');
              destBadge.className = 'dest-badge';
              destBadge.style.cssText = \`
                background: #374151;
                color: #fff;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 9px;
                font-weight: 600;
                letter-spacing: 0.5px;
                margin-left: 8px;
              \`;
              destBadge.textContent = 'EXCLUDE';

              const labelEl = item.querySelector('.item-label');
              if (labelEl) {
                labelEl.appendChild(destBadge);
              }
            }
          } else if (fb.action === 'promoted' && (fb._panel === 'index' || fb._panel === 'indexed' || !fb._panel)) {
            // Restore promoted state with destination badge
            // Note: _panel may be 'index', 'indexed', or undefined for older feedback items
            item.classList.add('reviewed', 'correct', 'promoted');

            // Get destination from promotedTo field, or parse from reason as fallback
            let promotedTo = fb.promotedTo;
            if (!promotedTo && fb.reason) {
              if (fb.reason.includes('Entities')) promotedTo = 'company';
              else if (fb.reason.includes('Products')) promotedTo = 'product';
              else if (fb.reason.includes('Answer Library')) promotedTo = 'answer_library';
              else if (fb.reason.includes('Excluded')) promotedTo = 'exclude';
            }
            promotedTo = promotedTo || 'answer_library';

            const entityMatch = fb.reason?.match(/\\((\\w+)\\)/);
            const entityRole = entityMatch?.[1] || fb.entityRole || 'other';
            item.dataset.promotedTo = promotedTo;

            // Add destination badge to indexed item
            const destBadgeLabels = { answer_library: 'LIBRARY', company: 'COMPANY', product: 'PRODUCT', exclude: 'EXCLUDE' };
            const destBadgeColors = { answer_library: '#166534', company: '#1e40af', product: '#9a3412', exclude: '#374151' };
            const entityLabels = { supplier: 'Supplier', client: 'Client', manufacturer: 'Manufacturer', other: 'Other' };
            const entityColors = { supplier: '#3b82f6', client: '#22c55e', manufacturer: '#f59e0b', other: '#6b7280' };

            const existingDestBadge = item.querySelector('.dest-badge');
            if (!existingDestBadge) {
              const destBadge = document.createElement('span');
              destBadge.className = 'dest-badge';
              destBadge.style.cssText = \`
                background: \${destBadgeColors[promotedTo] || '#374151'};
                color: #fff;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 9px;
                font-weight: 600;
                letter-spacing: 0.5px;
                margin-left: 8px;
              \`;
              destBadge.textContent = destBadgeLabels[promotedTo] || promotedTo.toUpperCase()

              // Add entity role to badge if present in reason
              if (entityMatch && entityMatch[1]) {
                destBadge.textContent += ' (' + entityMatch[1] + ')';
              }

              const labelEl = item.querySelector('.item-label');
              if (labelEl) {
                labelEl.appendChild(destBadge);
              }
            }
            // Note: Item is already created in the library panel by the pre-check block above
            // (before the items.forEach loop), so we don't need to create it again here
          }

          // Handle destination changes (only for library items)
          if (fb.destination && fb._panel === 'library') {
            item.dataset.destination = fb.destination;
            const targetSection = document.querySelector(\`#panel-library .section[data-destination="\${fb.destination}"]\`);
            if (targetSection) {
              // For company destination with entity role, move to correct subsection
              if (fb.destination === 'company' && fb.entityRole) {
                item.dataset.entityRole = fb.entityRole;
                // Update entity badge
                const entityBadge = item.querySelector('.entity-badge');
                const entityLabels = { supplier: 'Supplier', client: 'Client', manufacturer: 'Manufacturer', other: 'Other' };
                const entityColors = { supplier: '#3b82f6', client: '#22c55e', manufacturer: '#f59e0b', other: '#6b7280' };
                if (entityBadge) {
                  entityBadge.textContent = entityLabels[fb.entityRole];
                  entityBadge.style.background = entityColors[fb.entityRole];
                } else {
                  // Add entity badge if not present
                  const labelEl = item.querySelector('.item-label');
                  if (labelEl) {
                    const badge = document.createElement('span');
                    badge.className = 'entity-badge';
                    badge.style.background = entityColors[fb.entityRole];
                    badge.textContent = entityLabels[fb.entityRole];
                    const topicBadge = labelEl.querySelector('.topic-badge');
                    if (topicBadge) {
                      labelEl.insertBefore(badge, topicBadge);
                    } else {
                      labelEl.appendChild(badge);
                    }
                  }
                }
                // Move to correct entity subsection
                const entitySubsection = targetSection.querySelector(\`.entity-subsection[data-entity-role="\${fb.entityRole}"] .entity-subsection-items\`);
                if (entitySubsection && item.parentElement !== entitySubsection) {
                  entitySubsection.appendChild(item);
                }
              } else {
                const itemsContainer = targetSection.querySelector('.section-items');
                if (itemsContainer && item.parentElement !== itemsContainer) {
                  itemsContainer.appendChild(item);
                }
              }
            }
          }

          // Handle entity role changes without destination change
          if (fb.entityRole && fb._panel === 'library' && item.dataset.destination === 'company') {
            item.dataset.entityRole = fb.entityRole;
            // Update entity badge
            const entityBadge = item.querySelector('.entity-badge');
            const entityLabels = { supplier: 'Supplier', client: 'Client', manufacturer: 'Manufacturer', other: 'Other' };
            const entityColors = { supplier: '#3b82f6', client: '#22c55e', manufacturer: '#f59e0b', other: '#6b7280' };
            if (entityBadge) {
              entityBadge.textContent = entityLabels[fb.entityRole];
              entityBadge.style.background = entityColors[fb.entityRole];
            }
            // Move to correct entity subsection
            const companySection = document.querySelector('#panel-library .section[data-destination="company"]');
            if (companySection) {
              const entitySubsection = companySection.querySelector(\`.entity-subsection[data-entity-role="\${fb.entityRole}"] .entity-subsection-items\`);
              if (entitySubsection && item.parentElement !== entitySubsection) {
                entitySubsection.appendChild(item);
              }
            }
          }
        });
      });

      // Update section item counts after restoring destinations
      document.querySelectorAll('#panel-library .section').forEach(section => {
        const count = section.querySelectorAll('.item').length;
        const metaSpan = section.querySelector('.section-meta span');
        if (metaSpan) metaSpan.textContent = \`\${count} items\`;
        section.style.display = count > 0 ? '' : 'none';

        // Update entity subsection counts for company section
        section.querySelectorAll('.entity-subsection').forEach(subsection => {
          const subCount = subsection.querySelectorAll('.item').length;
          const countEl = subsection.querySelector('.entity-subsection-count');
          if (countEl) countEl.textContent = \`\${subCount} items\`;
          subsection.style.display = subCount > 0 ? '' : 'none';
        });
      });
    }

    /**
     * Sync destination badges from Save as panel to Extraction panel
     * Shows which Extraction items are included in the final export
     */
    function syncExtractionBadges() {
      const destBadgeLabels = { answer_library: 'LIBRARY', company: 'COMPANY', product: 'PRODUCT', exclude: 'EXCLUDE' };
      const destBadgeColors = { answer_library: '#166534', company: '#1e40af', product: '#9a3412', exclude: '#374151' };
      const entityLabels = { supplier: 'Supplier', client: 'Client', manufacturer: 'Manufacturer', other: 'Other' };

      // Build a map of cells -> destination from Save as panel (accepted items only)
      const saveAsMap = new Map();
      document.querySelectorAll('#panel-library .item').forEach(item => {
        // Only include reviewed/accepted items, or all items if we want to show everything
        const cells = item.dataset.cells;
        const dest = item.dataset.destination;
        const entityRole = item.dataset.entityRole;
        const isAccepted = item.classList.contains('accepted') || item.classList.contains('correct');

        if (cells && dest) {
          // Store the destination info (prefer accepted items, but show all for visibility)
          if (!saveAsMap.has(cells) || isAccepted) {
            saveAsMap.set(cells, { dest, entityRole, accepted: isAccepted });
          }
        }
      });

      // Update Extraction panel items with destination badges
      document.querySelectorAll('#panel-indexed .item').forEach(item => {
        const cells = item.dataset.cells;
        const existingBadge = item.querySelector('.dest-badge');

        // Skip if already promoted (has its own badge)
        if (item.classList.contains('promoted')) return;

        const saveAsInfo = saveAsMap.get(cells);
        if (saveAsInfo) {
          const { dest, entityRole, accepted } = saveAsInfo;

          // Create or update badge
          if (!existingBadge) {
            const badge = document.createElement('span');
            badge.className = 'dest-badge';
            badge.style.cssText = \`
              background: \${destBadgeColors[dest] || '#374151'};
              color: #fff;
              padding: 2px 8px;
              border-radius: 4px;
              font-size: 9px;
              font-weight: 600;
              letter-spacing: 0.5px;
              margin-left: 8px;
              opacity: \${accepted ? 1 : 0.6};
            \`;
            let badgeText = destBadgeLabels[dest] || dest.toUpperCase();
            if (dest === 'company' && entityRole && entityRole !== 'other') {
              badgeText += ' (' + entityLabels[entityRole] + ')';
            }
            badge.textContent = badgeText;
            badge.title = accepted ? 'Accepted in Save as' : 'In Save as (pending review)';

            const labelEl = item.querySelector('.item-label');
            if (labelEl) {
              labelEl.appendChild(badge);
            }
          } else {
            // Update existing badge
            existingBadge.style.background = destBadgeColors[dest] || '#374151';
            existingBadge.style.opacity = accepted ? '1' : '0.6';
            let badgeText = destBadgeLabels[dest] || dest.toUpperCase();
            if (dest === 'company' && entityRole && entityRole !== 'other') {
              badgeText += ' (' + entityLabels[entityRole] + ')';
            }
            existingBadge.textContent = badgeText;
            existingBadge.title = accepted ? 'Accepted in Save as' : 'In Save as (pending review)';
          }
        } else if (existingBadge && !item.classList.contains('promoted')) {
          // Remove badge if no longer in Save as
          existingBadge.remove();
        }
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
        const exportRes = await fetch(API_BASE + '/api/export-approved', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionnaire: currentQuestionnaire })
        });
        if (!exportRes.ok) throw new Error('Export failed');
        const exportData = await exportRes.json();
        console.log('Export result:', exportData);

        const rulesRes = await fetch(API_BASE + '/api/apply-rules', { method: 'POST' });
        if (!rulesRes.ok) throw new Error('Rules failed');

        // Mark tab as completed
        markTabCompleted(currentQuestionnaire);

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
      if (sheetName && window.sheetNames) {
        // Use the stored sheet names array to find the correct index
        const idx = window.sheetNames.indexOf(sheetName);
        if (idx !== -1) {
          foundInSheet = idx;
        }
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
        const needsSwitch = tabs[foundInSheet] && !tabs[foundInSheet].classList.contains('active');
        if (needsSwitch) {
          tabs.forEach(t => t.classList.remove('active'));
          contents.forEach(c => c.classList.remove('active'));
          tabs[foundInSheet].classList.add('active');
          contents[foundInSheet].classList.add('active');

          // Update Extraction panel filter to match the new sheet
          const sheetName = window.sheetNames?.[foundInSheet] || '';
          filterPanelsBySheet(sheetName);
        }
        // Scroll first highlighted cell into view
        const firstHighlighted = contents[foundInSheet]?.querySelector('.highlighted');
        if (firstHighlighted) {
          firstHighlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    /**
     * Scroll to matching item in the Save as panel based on cells
     */
    function scrollToSaveAsItem(cellsStr) {
      if (!cellsStr) return;

      // Clear previous highlights in Save as
      document.querySelectorAll('#panel-library .item.sync-highlight').forEach(item => {
        item.classList.remove('sync-highlight');
      });

      // Find matching items in Save as panel
      const saveAsItems = document.querySelectorAll('#panel-library .item');
      let foundItem = null;

      saveAsItems.forEach(item => {
        if (item.dataset.cells === cellsStr) {
          foundItem = item;
        }
      });

      if (foundItem) {
        // Highlight and scroll to the item
        foundItem.classList.add('sync-highlight');
        foundItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Expand section if collapsed
        const section = foundItem.closest('.section');
        if (section?.classList.contains('collapsed')) {
          section.classList.remove('collapsed');
        }

        // Expand entity subsection if collapsed
        const subsection = foundItem.closest('.entity-subsection');
        if (subsection?.style.display === 'none') {
          subsection.style.display = '';
        }
      }
    }

    /**
     * Scroll to matching item in the Extraction panel based on cells
     */
    function scrollToExtractionItem(cellsStr, sheetName) {
      if (!cellsStr) return;

      // Clear previous highlights in Extraction
      document.querySelectorAll('#panel-indexed .item.sync-highlight').forEach(item => {
        item.classList.remove('sync-highlight');
      });

      // If different sheet, switch to it first
      if (sheetName && window.sheetNames) {
        const idx = window.sheetNames.indexOf(sheetName);
        if (idx !== -1) {
          const tabs = document.querySelectorAll('.sheet-tab');
          if (tabs[idx] && !tabs[idx].classList.contains('active')) {
            // Trigger sheet switch
            tabs[idx].click();
          }
        }
      }

      // Find matching items in Extraction panel
      const extractionItems = document.querySelectorAll('#panel-indexed .item');
      let foundItem = null;

      extractionItems.forEach(item => {
        if (item.dataset.cells === cellsStr) {
          foundItem = item;
        }
      });

      if (foundItem) {
        // Highlight and scroll to the item
        foundItem.classList.add('sync-highlight');
        foundItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Expand section if collapsed
        const section = foundItem.closest('.section');
        if (section?.classList.contains('collapsed')) {
          section.classList.remove('collapsed');
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

    // Basic keyboard shortcuts (panel toggles)
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch(e.key) {
        case '1': document.querySelector('[data-panel="original"]')?.click(); break;
        case '2': document.querySelector('[data-panel="indexed"]')?.click(); break;
        case '3': document.querySelector('[data-panel="library"]')?.click(); break;
        case 'r': case 'R': document.getElementById('review-toggle')?.click(); break;
        case 'b': case 'B': toggleSidebar(); break;
      }
    });
  </script>
</body>
</html>`;
  }
}
