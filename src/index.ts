/**
 * Passionfruit for Excel - Claude-powered Excel analysis and modification
 *
 * @example
 * ```typescript
 * import { PassfruitExcel } from 'passionfruit-for-excel';
 *
 * const excel = new PassfruitExcel({ apiKey: process.env.ANTHROPIC_API_KEY });
 *
 * // Analyze a workbook
 * const result = await excel.analyze('./budget.xlsx', 'What is the total revenue?');
 * console.log(result.answer);
 *
 * // Interactive chat
 * await excel.loadWorkbook('./budget.xlsx');
 * const response = await excel.chat('Show me cells with formulas');
 *
 * // Modify a workbook
 * const mods = await excel.modify('./budget.xlsx', 'Update Q4 to show 15% growth');
 * await excel.applyModifications('./budget.xlsx', './budget-updated.xlsx', mods.modifications);
 * ```
 */

export { PassfruitExcel } from './claude-excel.js';
export { ExcelExtractor } from './excel-extractor.js';
export type {
  PassfruitConfig,
  WorkbookData,
  SheetData,
  CellData,
  CellStyle,
  ExcelModification,
  AnalysisResult,
  CellCitation,
  ChatMessage,
} from './types.js';
