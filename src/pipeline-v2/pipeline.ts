/**
 * Pipeline V2 - Main orchestrator
 *
 * Simplified extraction pipeline with metrics at each stage.
 */

import { MetricsCollector } from './metrics.js';
import { PatternDetector, loadPatterns, TableInfo, DetectionResult } from './pattern-detector.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// =============================================================================
// TYPES
// =============================================================================

export interface PipelineConfig {
  customer: string;
  customersDir: string;
  skipStages?: string[];
  verbose?: boolean;
}

export interface PipelineResult {
  success: boolean;
  source: string;
  metrics: ReturnType<MetricsCollector['getMetrics']>;
  stages: {
    extract?: ExtractResult;
    structure?: StructureResult;
    qa?: QAResult;
    classify?: ClassifyResult;
    validate?: ValidateResult;
  };
  errors: string[];
}

interface ExtractResult {
  documentType: string;
  sheets: SheetData[];
  textBlocks: TextBlock[];
}

interface SheetData {
  name: string;
  rows: RowData[];
}

interface RowData {
  row: number;
  cells: Record<string, CellData>;
  rowType: string;
}

interface CellData {
  ref: string;
  value: string;
  filled: boolean;
  role: string;
  format?: {
    isMerged?: boolean;
    mergeRange?: string;
  };
}

interface TextBlock {
  content: string;
  position: number;
}

interface StructureResult {
  language: string;
  tables: DetectedTable[];
  unmatchedTables: number;
}

interface DetectedTable {
  id: string;
  pattern: string | null;
  patternConfidence: number;
  headers: string[];
  columnCount: number;
  rowCount: number;
  startRow: number;
}

interface QAResult {
  items: ExtractedItem[];
  skippedRows: number;
}

interface ExtractedItem {
  id: string;
  type: string;
  label: string;
  value: string | null;
  comment?: string;
  confidence: number;
  tableId: string;
  rowIndex: number;
  cellRefs: { label: string; value: string };
}

interface ClassifyResult {
  items: ClassifiedItem[];
  entities: DetectedEntity[];
}

interface ClassifiedItem extends ExtractedItem {
  topic: string;
  destination: string;
  level: string;
  entityRole?: string;
}

interface DetectedEntity {
  id: string;
  name: string;
  role: string;
}

interface ValidateResult {
  qualityScore: number;
  issues: ValidationIssue[];
  needsReview: boolean;
}

interface ValidationIssue {
  itemId: string;
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// =============================================================================
// PIPELINE
// =============================================================================

export class Pipeline {
  private config: PipelineConfig;
  private patternDetector: PatternDetector | null = null;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  /**
   * Initialize the pipeline (load patterns, etc.)
   */
  async init(): Promise<void> {
    this.patternDetector = await loadPatterns();
    if (this.config.verbose) {
      console.log(`Loaded ${this.patternDetector.getPatterns().length} patterns`);
    }
  }

  /**
   * Process a document through all stages
   */
  async process(sourceFile: string): Promise<PipelineResult> {
    const metrics = new MetricsCollector(
      sourceFile,
      this.config.customer,
      this.detectDocumentType(sourceFile)
    );

    const result: PipelineResult = {
      success: true,
      source: sourceFile,
      metrics: metrics.getMetrics(),
      stages: {},
      errors: [],
    };

    try {
      // Stage 1: Extract
      if (!this.shouldSkip('extract')) {
        metrics.startStage('extract');
        const extractResult = await this.runExtract(sourceFile);
        result.stages.extract = extractResult;
        metrics.completeStage('extract', {
          success: true,
          counts: {
            sheets: extractResult.sheets.length,
            totalRows: extractResult.sheets.reduce((sum, s) => sum + s.rows.length, 0),
            textBlocks: extractResult.textBlocks.length,
          },
        });
      }

      // Stage 2: Structure
      if (!this.shouldSkip('structure') && result.stages.extract) {
        metrics.startStage('structure');
        const structureResult = await this.runStructure(result.stages.extract);
        result.stages.structure = structureResult;
        metrics.completeStage('structure', {
          success: true,
          counts: {
            tables: structureResult.tables.length,
            matchedTables: structureResult.tables.filter(t => t.pattern).length,
            unmatchedTables: structureResult.unmatchedTables,
          },
          rates: {
            patternMatchRate: structureResult.tables.length > 0
              ? Math.round((structureResult.tables.filter(t => t.pattern).length / structureResult.tables.length) * 100)
              : 0,
          },
        });

        // Track patterns for summary
        const patterns = structureResult.tables
          .filter(t => t.pattern)
          .map(t => t.pattern as string);
        metrics.setSummary({ patterns: [...new Set(patterns)] });
      }

      // Stage 3: Q&A Identification
      if (!this.shouldSkip('qa') && result.stages.extract && result.stages.structure) {
        metrics.startStage('qa');
        const qaResult = await this.runQA(result.stages.extract, result.stages.structure);
        result.stages.qa = qaResult;
        metrics.completeStage('qa', {
          success: true,
          counts: {
            itemsExtracted: qaResult.items.length,
            skippedRows: qaResult.skippedRows,
            withValues: qaResult.items.filter(i => i.value).length,
          },
          rates: {
            valueFillRate: qaResult.items.length > 0
              ? Math.round((qaResult.items.filter(i => i.value).length / qaResult.items.length) * 100)
              : 0,
          },
        });
        metrics.setSummary({ itemsExtracted: qaResult.items.length });
      }

      // Stage 4: Classify
      if (!this.shouldSkip('classify') && result.stages.qa) {
        metrics.startStage('classify');
        const classifyResult = await this.runClassify(result.stages.qa);
        result.stages.classify = classifyResult;
        metrics.completeStage('classify', {
          success: true,
          counts: {
            entitiesDetected: classifyResult.entities.length,
            toLibrary: classifyResult.items.filter(i => i.destination === 'answer_library').length,
            toCompany: classifyResult.items.filter(i => i.destination === 'company').length,
            excluded: classifyResult.items.filter(i => i.destination === 'exclude').length,
          },
        });
      }

      // Stage 5: Validate
      if (!this.shouldSkip('validate') && result.stages.classify) {
        metrics.startStage('validate');
        const validateResult = await this.runValidate(result.stages.classify);
        result.stages.validate = validateResult;
        metrics.completeStage('validate', {
          success: true,
          counts: {
            issues: validateResult.issues.length,
            errors: validateResult.issues.filter(i => i.severity === 'error').length,
            warnings: validateResult.issues.filter(i => i.severity === 'warning').length,
          },
          rates: {
            qualityScore: validateResult.qualityScore,
          },
          flags: validateResult.needsReview ? ['needs_review'] : [],
        });
        metrics.setSummary({
          qualityScore: validateResult.qualityScore,
          issueCount: validateResult.issues.length,
          needsReview: validateResult.needsReview,
        });
      }

    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    // Save metrics
    result.metrics = metrics.getMetrics();
    await metrics.save(this.config.customersDir);

    return result;
  }

  // =============================================================================
  // STAGE IMPLEMENTATIONS
  // =============================================================================

  private async runExtract(sourceFile: string): Promise<ExtractResult> {
    // For now, read from existing structure file
    const structurePath = this.getStructurePath(sourceFile);

    if (!existsSync(structurePath)) {
      throw new Error(`Structure file not found: ${structurePath}`);
    }

    const content = await readFile(structurePath, 'utf-8');
    const structure = JSON.parse(content);

    return {
      documentType: structure.source?.documentType || 'unknown',
      sheets: structure.sheets || [],
      textBlocks: [], // TODO: extract text blocks
    };
  }

  private async runStructure(extract: ExtractResult): Promise<StructureResult> {
    if (!this.patternDetector) {
      throw new Error('Pattern detector not initialized');
    }

    const tables: DetectedTable[] = [];
    let language = 'unknown';

    for (const sheet of extract.sheets) {
      // Find header rows and create table info
      const headerRows = sheet.rows.filter(r => r.rowType === 'header');

      for (const headerRow of headerRows) {
        const cells = Object.values(headerRow.cells);
        const filledCells = cells.filter(c => c.filled && c.value?.trim());

        if (filledCells.length < 2) continue;

        const tableInfo: TableInfo = {
          id: `${sheet.name}_row${headerRow.row}`,
          headers: filledCells.map(c => c.value?.trim() || ''),
          columnCount: filledCells.length,
          hasMergedCells: cells.some(c => c.format?.isMerged),
          rowCount: this.countDataRows(sheet.rows, headerRow.row),
        };

        const detection = this.patternDetector.detect(tableInfo);

        if (detection.language !== 'unknown') {
          language = detection.language;
        }

        tables.push({
          id: tableInfo.id,
          pattern: detection.match?.patternId || null,
          patternConfidence: detection.match?.confidence || 0,
          headers: tableInfo.headers,
          columnCount: tableInfo.columnCount,
          rowCount: tableInfo.rowCount,
          startRow: headerRow.row,
        });
      }
    }

    return {
      language,
      tables,
      unmatchedTables: tables.filter(t => !t.pattern).length,
    };
  }

  private async runQA(extract: ExtractResult, structure: StructureResult): Promise<QAResult> {
    const items: ExtractedItem[] = [];
    let skippedRows = 0;
    let itemId = 0;

    for (const table of structure.tables) {
      if (!table.pattern) {
        skippedRows += table.rowCount;
        continue;
      }

      const pattern = this.patternDetector?.getPattern(table.pattern);
      if (!pattern) continue;

      // Find the sheet and extract items based on pattern
      const sheet = extract.sheets.find(s => table.id.startsWith(s.name));
      if (!sheet) continue;

      // Get data rows after header
      const dataRows = sheet.rows.filter(
        r => r.rowType === 'data' && r.row > table.startRow && r.row <= table.startRow + table.rowCount
      );

      for (const row of dataRows) {
        const cells = Object.values(row.cells);
        const filledCells = cells.filter(c => c.filled);

        if (filledCells.length === 0) {
          skippedRows++;
          continue;
        }

        // Simple extraction based on pattern type
        const item = this.extractItem(
          `item_${++itemId}`,
          table,
          pattern,
          row,
          cells
        );

        if (item) {
          items.push(item);
        }
      }
    }

    return { items, skippedRows };
  }

  private extractItem(
    id: string,
    table: DetectedTable,
    pattern: ReturnType<PatternDetector['getPattern']>,
    row: RowData,
    cells: CellData[]
  ): ExtractedItem | null {
    if (!pattern) return null;

    const cellValues = cells.map(c => c.value?.trim() || '');
    const firstCell = cells[0];
    const secondCell = cells[1];

    // Determine type and extract based on pattern
    let type = 'field';
    let label = firstCell?.value?.trim() || '';
    let value: string | null = secondCell?.value?.trim() || null;
    let comment: string | undefined;

    if (pattern.id.startsWith('STANDARD_YESNO')) {
      type = 'yesno';
      // Look for checked column (Yes/No/X)
      const yesNoKeywords = ['yes', 'no', 'ja', 'nein', 'oui', 'non', 'x', '☒', '✓'];
      for (let i = 1; i < cells.length - 1; i++) {
        const val = cells[i]?.value?.trim().toLowerCase();
        if (val && yesNoKeywords.includes(val)) {
          // Check if this column header indicates the answer
          if (table.headers[i]?.toLowerCase().includes('yes') ||
              table.headers[i]?.toLowerCase().includes('ja') ||
              table.headers[i]?.toLowerCase().includes('oui')) {
            value = 'Yes';
          } else if (table.headers[i]?.toLowerCase().includes('no') ||
                     table.headers[i]?.toLowerCase().includes('nein') ||
                     table.headers[i]?.toLowerCase().includes('non')) {
            value = 'No';
          }
        }
      }
      // Last column is usually comments
      comment = cells[cells.length - 1]?.value?.trim() || undefined;
    } else if (pattern.id === 'SIMPLE_KEYVALUE' || pattern.id === 'FREE_FORM_QA') {
      type = cellValues[1]?.length > 100 ? 'text' : 'field';
    }

    // Skip if no meaningful label
    if (!label || label.length < 2) return null;

    return {
      id,
      type,
      label,
      value,
      comment,
      confidence: table.patternConfidence,
      tableId: table.id,
      rowIndex: row.row,
      cellRefs: {
        label: firstCell?.ref || '',
        value: secondCell?.ref || '',
      },
    };
  }

  private async runClassify(qa: QAResult): Promise<ClassifyResult> {
    const items: ClassifiedItem[] = [];
    const entities: DetectedEntity[] = [];
    const seenEntities = new Map<string, string>();

    for (const item of qa.items) {
      // Simple classification based on keywords
      const labelLower = item.label.toLowerCase();

      let topic = 'general';
      let destination = 'answer_library';
      let level = 'standard';
      let entityRole: string | undefined;

      // Topic detection
      if (labelLower.includes('allergen')) topic = 'allergens';
      else if (labelLower.includes('certif')) topic = 'certifications';
      else if (labelLower.includes('quality')) topic = 'quality';
      else if (labelLower.includes('haccp')) topic = 'food_safety';
      else if (labelLower.includes('audit')) topic = 'audits';
      else if (labelLower.includes('contact') || labelLower.includes('email') || labelLower.includes('phone')) topic = 'contact';

      // Destination detection
      if (labelLower.includes('company') || labelLower.includes('supplier') || labelLower.includes('address')) {
        destination = 'company';
      }
      if (labelLower.includes('product') || labelLower.includes('ingredient')) {
        destination = 'product';
      }
      if (!item.value || item.value === 'N/A' || item.value === '-') {
        destination = 'exclude';
      }

      // Level detection
      if (item.type === 'text' || (item.value && item.value.length > 200)) {
        level = 'narrative';
      }

      // Entity role detection
      if (labelLower.includes('supplier')) entityRole = 'supplier';
      else if (labelLower.includes('manufacturer')) entityRole = 'manufacturer';
      else if (labelLower.includes('customer')) entityRole = 'customer';

      // Track entities
      if (entityRole && item.value && destination === 'company') {
        const entityKey = `${item.value}_${entityRole}`;
        if (!seenEntities.has(entityKey)) {
          const entityId = `entity_${entities.length + 1}`;
          seenEntities.set(entityKey, entityId);
          entities.push({
            id: entityId,
            name: item.value,
            role: entityRole,
          });
        }
      }

      items.push({
        ...item,
        topic,
        destination,
        level,
        entityRole,
      });
    }

    return { items, entities };
  }

  private async runValidate(classify: ClassifyResult): Promise<ValidateResult> {
    const issues: ValidationIssue[] = [];
    let qualityScore = 100;

    for (const item of classify.items) {
      // Check for missing values
      if (!item.value && item.destination !== 'exclude') {
        issues.push({
          itemId: item.id,
          type: 'MISSING_VALUE',
          severity: 'warning',
          message: `Item "${item.label.slice(0, 50)}" has no value`,
        });
        qualityScore -= 1;
      }

      // Check for low confidence
      if (item.confidence < 0.5) {
        issues.push({
          itemId: item.id,
          type: 'LOW_CONFIDENCE',
          severity: 'warning',
          message: `Low pattern confidence (${item.confidence}) for "${item.label.slice(0, 50)}"`,
        });
        qualityScore -= 2;
      }

      // Check for suspiciously short labels
      if (item.label.length < 5 && item.destination !== 'exclude') {
        issues.push({
          itemId: item.id,
          type: 'SHORT_LABEL',
          severity: 'info',
          message: `Very short label: "${item.label}"`,
        });
      }
    }

    // Ensure score is in valid range
    qualityScore = Math.max(0, Math.min(100, qualityScore));

    const needsReview = issues.some(i => i.severity === 'error') || qualityScore < 70;

    return {
      qualityScore,
      issues,
      needsReview,
    };
  }

  // =============================================================================
  // HELPERS
  // =============================================================================

  private shouldSkip(stage: string): boolean {
    return this.config.skipStages?.includes(stage) || false;
  }

  private detectDocumentType(file: string): string {
    const lower = file.toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'word';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
    return 'unknown';
  }

  private getStructurePath(sourceFile: string): string {
    // Convert source file to structure path
    const baseName = sourceFile
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9]/g, '_');

    return join(
      this.config.customersDir,
      this.config.customer,
      'structure',
      `${baseName}.json`
    );
  }

  private countDataRows(rows: RowData[], headerRow: number): number {
    let count = 0;
    for (const row of rows) {
      if (row.row > headerRow && row.rowType === 'data') {
        count++;
      } else if (row.row > headerRow && row.rowType === 'header') {
        break; // Next table starts
      }
    }
    return count;
  }
}
