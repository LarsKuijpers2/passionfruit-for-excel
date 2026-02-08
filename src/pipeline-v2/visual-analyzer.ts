/**
 * Visual Analyzer for Questionnaire Sheets
 *
 * Uses Claude to analyze sheet structure and identify:
 * - Section headers
 * - Question labels
 * - Input/answer fields
 * - Question-answer pairs with their locations
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { SheetData, CellData, RowData, MergedRange, CellRole } from './excel-structure.js';

// =============================================================================
// TYPES
// =============================================================================

/** Item types */
export type ItemType = 'field' | 'text' | 'yesno' | 'choice' | 'table' | 'signature' | 'date';

/** Levels for reusability */
export type ItemLevel = 'standard' | 'narrative' | 'product';

/** A detected item from the questionnaire */
export interface DetectedItem {
  /** Item type */
  type: ItemType;
  /** Label/question text */
  label: string;
  /** Value/answer (if filled) */
  value?: string;
  /** Label cell reference */
  lCell: string;
  /** Value cell reference (for field/text/yesno/choice/signature/date) */
  vCell?: string;
  /** Full range reference (for tables) */
  ref?: string;
  /** Detected section */
  section?: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Reusability level */
  level: ItemLevel;
  /** Detected language */
  lang?: string;
}

/** Sheet analysis result */
export interface SheetAnalysis {
  /** Sheet name */
  sheetName: string;
  /** Detected sections */
  sections: Array<{
    title: string;
    startRow: number;
    endRow: number;
    topic?: string;
  }>;
  /** Detected items */
  items: DetectedItem[];
  /** Layout type */
  layoutType: 'vertical' | 'horizontal' | 'matrix' | 'mixed';
  /** Analysis notes */
  notes?: string;
}

// =============================================================================
// VISUAL ANALYZER
// =============================================================================

export class VisualAnalyzer {
  private client: BedrockRuntimeClient;
  private modelId: string;

  constructor(region: string = 'eu-central-1') {
    this.client = new BedrockRuntimeClient({ region });
    this.modelId = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
  }

  /**
   * Analyze a sheet's structure using Claude
   */
  async analyzeSheet(sheet: SheetData): Promise<SheetAnalysis> {
    // Build a text representation of the sheet with formatting hints
    const sheetText = this.buildSheetRepresentation(sheet);

    const prompt = `Analyze this spreadsheet sheet and identify all data items (fields, tables, etc.).

## Sheet: ${sheet.name}
${sheet.topic ? `Detected Topic: ${sheet.topic}` : ''}

## Sheet Content (with formatting hints):
${sheetText}

## Legend:
- [H] = Header/bold cell
- [S] = Section header (merged/large)
- [L] = Label cell (gray background)
- [I] = Input field (colored background, likely for answers)
- [V] = Value (filled data)
- [M:range] = Merged cell spanning range

## Task:
Identify all data items in this sheet. Each item has a type:
- "field" = Simple label/value (Company name, Address, Phone)
- "text" = Longer text response to a question
- "yesno" = Yes/No or Ja/Nee choice
- "choice" = Dropdown or selection
- "table" = Tabular data that has no answers or is pure reference data. AVOID using this - prefer extracting individual items.
- "signature" = Signature field
- "date" = Date field

IMPORTANT EXTRACTION RULES:
1. CERTIFICATION CHECKLISTS: When you see numbered rows (3.1, 3.2, 3.3...) with certification names and yes/no values, extract EACH ROW as a separate "yesno" item, NOT as a table. Example: "RSPO-MB: ja-yes" should be extracted as a yesno item.

2. MULTI-COLUMN ANSWERS: When a row has the SAME question but multiple answer columns (e.g., "Contact Person 1" and "Contact Person 2"), extract MULTIPLE items - one per column. Add the column header to the label, e.g., "Phone (Contact Person 1)" and "Phone (Contact Person 2)".

3. PREFER INDIVIDUAL ITEMS: Only use "table" type for truly tabular reference data with no filled answers. If rows have yes/no answers or text values, extract them individually.

And a level for reusability:
- "standard" = Factual company data, can be auto-filled (name, address, cert numbers)
- "narrative" = Descriptive company info, needs review (policies, procedures)
- "product" = Product-specific, changes per product (ingredients, allergens)

Respond in this JSON format:
{
  "layoutType": "vertical|horizontal|matrix|mixed",
  "sections": [
    {"title": "Section Name", "startRow": 5, "endRow": 20, "topic": "company_info"}
  ],
  "items": [
    {
      "type": "field",
      "label": "Company Name",
      "value": "ACME Corp",
      "lCell": "B10",
      "vCell": "C10",
      "section": "General Information",
      "level": "standard",
      "lang": "en",
      "confidence": 0.95
    },
    {
      "type": "yesno",
      "label": "RSPO-MB (Palm certification)",
      "value": "ja-yes",
      "lCell": "B33",
      "vCell": "C33",
      "section": "Palm Certificates",
      "level": "standard",
      "lang": "de",
      "confidence": 0.95
    },
    {
      "type": "field",
      "label": "Phone (Contact Person 1)",
      "value": "+31 123 456",
      "lCell": "B43",
      "vCell": "C43",
      "section": "Crisis Management",
      "level": "standard",
      "lang": "en",
      "confidence": 0.9
    },
    {
      "type": "field",
      "label": "Phone (Contact Person 2)",
      "value": "+31 789 012",
      "lCell": "B43",
      "vCell": "D43",
      "section": "Crisis Management",
      "level": "standard",
      "lang": "en",
      "confidence": 0.9
    }
  ],
  "notes": "Any observations about the layout"
}

Important:
- Use "lCell" for label cell, "vCell" for value cell
- For tables, use "ref" with the full range (e.g., "A30:E45") instead of lCell/vCell
- Use "EMPTY" for value if the field has no answer filled in
- Detect language: "en", "de", "fr", "nl" or omit if unknown
- Confidence should be lower if the pairing is ambiguous
- CRITICAL: Extract certification checklists (rows with numbered items and yes/no) as individual "yesno" items, NOT as tables
- CRITICAL: For multi-column contact tables, create separate items for each column`;

    const response = await this.invokeModel(prompt);

    // Parse the JSON response
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          sheetName: sheet.name,
          sections: parsed.sections || [],
          items: parsed.items || [],
          layoutType: parsed.layoutType || 'mixed',
          notes: parsed.notes,
        };
      }
    } catch (e) {
      console.error('Failed to parse Claude response:', e);
    }

    // Return empty analysis on failure
    return {
      sheetName: sheet.name,
      sections: [],
      items: [],
      layoutType: 'mixed',
      notes: 'Failed to parse analysis',
    };
  }

  /**
   * Build a text representation of the sheet with formatting hints
   */
  private buildSheetRepresentation(sheet: SheetData): string {
    const lines: string[] = [];

    // Add merged ranges info
    if (sheet.mergedRanges && sheet.mergedRanges.length > 0) {
      lines.push('## Merged Ranges:');
      for (const range of sheet.mergedRanges.slice(0, 20)) {
        if (range.value) {
          lines.push(`  ${range.range}: "${range.value.substring(0, 50)}"`);
        }
      }
      lines.push('');
    }

    // Add rows with formatting hints
    lines.push('## Content:');

    for (const row of sheet.rows.slice(0, 100)) { // Limit to first 100 rows
      const cellTexts: string[] = [];

      for (const [col, cell] of Object.entries(row.cells)) {
        if (!cell.filled && !cell.format?.isMerged) continue;

        let prefix = '';
        switch (cell.role) {
          case 'header': prefix = '[H]'; break;
          case 'section': prefix = '[S]'; break;
          case 'label': prefix = '[L]'; break;
          case 'input': prefix = '[I]'; break;
          case 'value': prefix = '[V]'; break;
        }

        if (cell.format?.isMerged) {
          prefix += `[M:${cell.format.mergeRange}]`;
        }

        const value = cell.value.substring(0, 60).replace(/\n/g, ' ');
        if (value || cell.role === 'input') {
          cellTexts.push(`${cell.ref}${prefix}: ${value || '(empty input)'}`);
        }
      }

      if (cellTexts.length > 0) {
        lines.push(`Row ${row.row}: ${cellTexts.join(' | ')}`);
      }
    }

    if (sheet.rows.length > 100) {
      lines.push(`... (${sheet.rows.length - 100} more rows)`);
    }

    return lines.join('\n');
  }

  /**
   * Invoke Bedrock Claude model
   */
  private async invokeModel(prompt: string): Promise<string> {
    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 16384,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response = await this.client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    return responseBody.content[0].text;
  }

  /**
   * Analyze multiple sheets and combine results
   */
  async analyzeQuestionnaire(sheets: SheetData[]): Promise<SheetAnalysis[]> {
    const results: SheetAnalysis[] = [];

    for (const sheet of sheets) {
      console.log(`  Analyzing sheet: ${sheet.name}...`);
      try {
        const analysis = await this.analyzeSheet(sheet);
        results.push(analysis);
        console.log(`    Found ${analysis.items.length} items`);
      } catch (error) {
        console.error(`    Error analyzing ${sheet.name}:`, error);
        results.push({
          sheetName: sheet.name,
          sections: [],
          items: [],
          layoutType: 'mixed',
          notes: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    return results;
  }
}

// =============================================================================
// RULE-BASED ANALYZER (no API calls)
// =============================================================================

export class RuleBasedAnalyzer {
  /**
   * Analyze sheet structure using formatting rules only
   */
  analyzeSheet(sheet: SheetData): SheetAnalysis {
    const sections: SheetAnalysis['sections'] = [];
    const qaPairs: DetectedQAPair[] = [];

    let currentSection = '';
    let sectionStartRow = 0;

    for (const row of sheet.rows) {
      // Detect section headers (merged cells, bold, or large text)
      const sectionCell = this.detectSectionHeader(row);
      if (sectionCell) {
        if (currentSection && sectionStartRow > 0) {
          sections.push({
            title: currentSection,
            startRow: sectionStartRow,
            endRow: row.row - 1,
          });
        }
        currentSection = sectionCell.value;
        sectionStartRow = row.row;
        continue;
      }

      // Detect question-answer pairs
      const pair = this.detectQAPair(row, sheet.rows, currentSection);
      if (pair) {
        qaPairs.push(pair);
      }
    }

    // Close last section
    if (currentSection && sectionStartRow > 0) {
      sections.push({
        title: currentSection,
        startRow: sectionStartRow,
        endRow: sheet.rows.length > 0 ? sheet.rows[sheet.rows.length - 1].row : sectionStartRow,
      });
    }

    return {
      sheetName: sheet.name,
      sections,
      qaPairs,
      layoutType: this.detectLayoutType(sheet),
    };
  }

  /**
   * Detect section header in a row
   */
  private detectSectionHeader(row: RowData): CellData | null {
    for (const cell of Object.values(row.cells)) {
      // Section headers are usually: merged, bold, or the only content in a row
      if (cell.role === 'section' || cell.role === 'header') {
        if (cell.format?.isMerged && cell.format.isMergeOrigin) {
          return cell;
        }
        if (cell.format?.bold && cell.value.length > 5) {
          return cell;
        }
      }
    }
    return null;
  }

  /**
   * Detect question-answer pair in a row
   */
  private detectQAPair(row: RowData, allRows: RowData[], section: string): DetectedQAPair | null {
    const cells = Object.values(row.cells).filter(c => c.filled || c.role === 'input');

    if (cells.length < 2) return null;

    // Pattern 1: Label in column A/B, answer in column C+
    const labelCell = cells.find(c => c.role === 'label' || c.role === 'value');
    const inputCell = cells.find(c => c.role === 'input' || (c.role === 'value' && c !== labelCell));

    if (labelCell && inputCell && labelCell.ref !== inputCell.ref) {
      // Check if label looks like a question
      const labelText = labelCell.value.trim();
      if (labelText.length > 3 && !this.isNumericLabel(labelText)) {
        return {
          question: labelText,
          questionCell: labelCell.ref,
          answer: inputCell.value.trim() || undefined,
          answerCell: inputCell.ref,
          section,
          confidence: this.calculateConfidence(labelCell, inputCell),
          level: this.detectLevel(section, labelText),
        };
      }
    }

    // Pattern 2: Vertical layout - label above, answer below
    // (would need to look at previous row)

    return null;
  }

  /**
   * Check if label is just a number (row number, not a real label)
   */
  private isNumericLabel(text: string): boolean {
    return /^[\d.]+$/.test(text.trim());
  }

  /**
   * Calculate confidence score for a Q&A pair
   */
  private calculateConfidence(labelCell: CellData, inputCell: CellData): number {
    let confidence = 0.5;

    // Higher confidence if input has specific formatting
    if (inputCell.format?.bgColor) confidence += 0.2;
    if (inputCell.format?.hasBorder) confidence += 0.1;

    // Higher confidence if label looks like a question
    if (labelCell.value.includes('?') || labelCell.value.includes(':')) confidence += 0.1;

    // Higher confidence if cells are adjacent
    const labelCol = labelCell.ref.match(/[A-Z]+/)?.[0] || '';
    const inputCol = inputCell.ref.match(/[A-Z]+/)?.[0] || '';
    if (this.columnsAreAdjacent(labelCol, inputCol)) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Check if two columns are adjacent
   */
  private columnsAreAdjacent(col1: string, col2: string): boolean {
    const diff = Math.abs(this.letterToColumn(col1) - this.letterToColumn(col2));
    return diff <= 2;
  }

  /**
   * Convert column letter to number
   */
  private letterToColumn(letter: string): number {
    let col = 0;
    for (let i = 0; i < letter.length; i++) {
      col = col * 26 + (letter.charCodeAt(i) - 64);
    }
    return col;
  }

  /**
   * Detect if answer is entity or product level
   */
  private detectLevel(section: string, question: string): 'entity' | 'product' {
    const lower = (section + ' ' + question).toLowerCase();

    // Product-level indicators
    if (/allerg|ingredi|nutri|shelf|packag|batch|lot|expir|origin|recipe/i.test(lower)) {
      return 'product';
    }

    // Entity-level indicators (default for most)
    return 'entity';
  }

  /**
   * Detect layout type of sheet
   */
  private detectLayoutType(sheet: SheetData): SheetAnalysis['layoutType'] {
    // Analyze column usage patterns
    const colUsage: Record<string, number> = {};

    for (const row of sheet.rows.slice(0, 30)) {
      for (const [col, cell] of Object.entries(row.cells)) {
        if (cell.filled) {
          colUsage[col] = (colUsage[col] || 0) + 1;
        }
      }
    }

    const cols = Object.keys(colUsage);

    // If mostly 2-3 columns used, likely vertical Q&A layout
    if (cols.length <= 4) return 'vertical';

    // If many columns with similar usage, likely matrix
    const values = Object.values(colUsage);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length;

    if (variance < avg * 0.5) return 'matrix';

    return 'mixed';
  }
}
