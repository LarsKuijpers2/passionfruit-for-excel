/**
 * Correction Tracker
 *
 * Logs every correction made during review as training data.
 * This data will be used to:
 * 1. Analyze error patterns
 * 2. Generate improvement rules
 * 3. Fine-tune extraction models
 */

import { appendFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

// Error types for categorization
export type ErrorType =
  | 'value_wrong'           // Extracted value is incorrect
  | 'label_wrong'           // Question/label text is incorrect
  | 'value_missing'         // Value should exist but wasn't extracted
  | 'item_should_not_exist' // Item was extracted but shouldn't be
  | 'destination_wrong'     // Wrong categorization (library vs company vs product)
  | 'topic_wrong'           // Wrong topic assignment
  | 'merge_needed'          // Items should be merged
  | 'split_needed'          // Item should be split
  | 'checkbox_not_converted' // Checkbox symbol not converted to Yes/No
  | 'parent_child_missed'   // Parent-child relationship not detected
  | 'other';

// Visual features that help identify patterns
export type VisualFeature =
  | 'checkbox'
  | 'dropdown'
  | 'table_cell'
  | 'free_text'
  | 'merged_cell'
  | 'strikethrough'
  | 'handwritten';

export interface CorrectionRecord {
  id: string;
  timestamp: string;

  // Source document context
  document: {
    type: 'pdf' | 'excel' | 'word' | 'html';
    path: string;
    customer: string;
    questionnaireName: string;
  };

  // Location in document
  location: {
    section?: string;
    cellRef?: string;
    pageNumber?: number;
    rowIndex?: number;
  };

  // What was extracted (original)
  original: {
    label: string;
    value: string | null;
    destination?: string;
    topic?: string;
  };

  // What it should be (corrected)
  corrected: {
    label?: string;
    value?: string | null;
    destination?: string;
    topic?: string;
    shouldExclude?: boolean;
  };

  // Categorization for learning
  errorType: ErrorType;
  reason?: string;  // Human explanation

  // Context for model training
  context: {
    surroundingLabels?: string[];  // Labels of nearby items
    sectionTitle?: string;
    visualFeatures?: VisualFeature[];
  };
}

export interface CorrectionStats {
  total: number;
  byErrorType: Record<ErrorType, number>;
  byDocumentType: Record<string, number>;
  byCustomer: Record<string, number>;
  recentCorrections: CorrectionRecord[];
}

const CORRECTIONS_DIR = './training-data';
const CORRECTIONS_FILE = 'corrections.jsonl';

export class CorrectionTracker {
  private filePath: string;

  constructor(baseDir: string = CORRECTIONS_DIR) {
    this.filePath = join(baseDir, CORRECTIONS_FILE);
  }

  /**
   * Log a correction
   */
  async logCorrection(correction: Omit<CorrectionRecord, 'id' | 'timestamp'>): Promise<string> {
    const record: CorrectionRecord = {
      ...correction,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
    };

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Append to JSONL file
    await appendFile(this.filePath, JSON.stringify(record) + '\n');

    console.log(`📝 Logged correction: ${record.errorType} in ${record.document.questionnaireName}`);

    return record.id;
  }

  /**
   * Log a value correction (most common)
   */
  async logValueCorrection(params: {
    questionnairePath: string;
    customer: string;
    itemId: string;
    section: string;
    cellRef?: string;
    originalLabel: string;
    originalValue: string | null;
    correctedValue: string;
    reason?: string;
  }): Promise<string> {
    const docType = this.detectDocType(params.questionnairePath);

    return this.logCorrection({
      document: {
        type: docType,
        path: params.questionnairePath,
        customer: params.customer,
        questionnaireName: params.questionnairePath.split('/').pop() || '',
      },
      location: {
        section: params.section,
        cellRef: params.cellRef,
      },
      original: {
        label: params.originalLabel,
        value: params.originalValue,
      },
      corrected: {
        value: params.correctedValue,
      },
      errorType: 'value_wrong',
      reason: params.reason,
      context: {
        sectionTitle: params.section,
      },
    });
  }

  /**
   * Log a destination change (categorization correction)
   */
  async logDestinationCorrection(params: {
    questionnairePath: string;
    customer: string;
    itemId: string;
    originalLabel: string;
    originalValue: string | null;
    originalDestination: string;
    correctedDestination: string;
    reason?: string;
  }): Promise<string> {
    const docType = this.detectDocType(params.questionnairePath);

    return this.logCorrection({
      document: {
        type: docType,
        path: params.questionnairePath,
        customer: params.customer,
        questionnaireName: params.questionnairePath.split('/').pop() || '',
      },
      location: {},
      original: {
        label: params.originalLabel,
        value: params.originalValue,
        destination: params.originalDestination,
      },
      corrected: {
        destination: params.correctedDestination,
      },
      errorType: 'destination_wrong',
      reason: params.reason,
      context: {},
    });
  }

  /**
   * Log an exclusion (item should not exist)
   */
  async logExclusion(params: {
    questionnairePath: string;
    customer: string;
    itemId: string;
    label: string;
    value: string | null;
    reason?: string;
  }): Promise<string> {
    const docType = this.detectDocType(params.questionnairePath);

    return this.logCorrection({
      document: {
        type: docType,
        path: params.questionnairePath,
        customer: params.customer,
        questionnaireName: params.questionnairePath.split('/').pop() || '',
      },
      location: {},
      original: {
        label: params.label,
        value: params.value,
      },
      corrected: {
        shouldExclude: true,
      },
      errorType: 'item_should_not_exist',
      reason: params.reason,
      context: {},
    });
  }

  /**
   * Get all corrections
   */
  async getAllCorrections(): Promise<CorrectionRecord[]> {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const content = await readFile(this.filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    return lines.map(line => JSON.parse(line) as CorrectionRecord);
  }

  /**
   * Get correction statistics
   */
  async getStats(): Promise<CorrectionStats> {
    const corrections = await this.getAllCorrections();

    const byErrorType: Record<string, number> = {};
    const byDocumentType: Record<string, number> = {};
    const byCustomer: Record<string, number> = {};

    for (const c of corrections) {
      byErrorType[c.errorType] = (byErrorType[c.errorType] || 0) + 1;
      byDocumentType[c.document.type] = (byDocumentType[c.document.type] || 0) + 1;
      byCustomer[c.document.customer] = (byCustomer[c.document.customer] || 0) + 1;
    }

    return {
      total: corrections.length,
      byErrorType: byErrorType as Record<ErrorType, number>,
      byDocumentType,
      byCustomer,
      recentCorrections: corrections.slice(-10).reverse(),
    };
  }

  /**
   * Export corrections for fine-tuning
   */
  async exportForTraining(): Promise<{
    trainingExamples: Array<{
      input: string;
      output: string;
      metadata: Record<string, unknown>;
    }>;
  }> {
    const corrections = await this.getAllCorrections();

    const trainingExamples = corrections.map(c => {
      // Format as input/output pairs for fine-tuning
      const input = JSON.stringify({
        label: c.original.label,
        value: c.original.value,
        context: c.context,
      });

      const output = JSON.stringify({
        label: c.corrected.label || c.original.label,
        value: c.corrected.value ?? c.original.value,
        destination: c.corrected.destination || c.original.destination,
        shouldExclude: c.corrected.shouldExclude || false,
      });

      return {
        input,
        output,
        metadata: {
          errorType: c.errorType,
          documentType: c.document.type,
          customer: c.document.customer,
        },
      };
    });

    return { trainingExamples };
  }

  private generateId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private detectDocType(path: string): 'pdf' | 'excel' | 'word' | 'html' {
    const lower = path.toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'word';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
    return 'pdf'; // default
  }
}

// Singleton instance
export const correctionTracker = new CorrectionTracker();
