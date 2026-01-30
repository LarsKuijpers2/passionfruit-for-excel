/**
 * Passionfruit for Excel - Claude-powered Excel analysis and modification
 *
 * @example
 * ```typescript
 * import { PassfruitExcel } from 'passionfruit-for-excel';
 *
 * const excel = new PassfruitExcel();
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
 *
 * // Web search (requires Anthropic API key)
 * const excelWithSearch = new PassfruitExcel({
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY,
 *   webSearch: { enabled: true }
 * });
 * const searchResult = await excelWithSearch.webSearch('ACME Corp website');
 * console.log(searchResult.answer);
 * ```
 */

export { PassfruitExcel } from './claude-excel.js';
export { ExcelExtractor } from './excel-extractor.js';
export { QuestionAnswerDetector } from './question-answer-detector.js';
export { buildWebSearchTool, extractSearchInfo, formatSearchResults } from './web-search.js';
export type {
  // Core types
  PassfruitConfig,
  WorkbookData,
  SheetData,
  CellData,
  CellStyle,
  ExcelModification,
  AnalysisResult,
  CellCitation,
  ChatMessage,
  // Enhanced extraction types
  EnhancedWorkbookData,
  EnhancedSheetData,
  EnhancedCellData,
  DataValidation,
  BorderInfo,
  MergeInfo,
  // Q&A detection types
  DetectedQAPair,
  DetectedSection,
  QuestionnaireStructure,
  AnswerType,
  ConfirmationResult,
  // Web search types
  WebSearchConfig,
  WebSearchResult,
  WebSearchCitation,
  WebSearchInfo,
  UserLocation,
} from './types.js';
