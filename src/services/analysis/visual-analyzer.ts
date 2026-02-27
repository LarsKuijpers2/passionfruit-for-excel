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
import type { SheetData, CellData, RowData, MergedRange, CellRole, DocumentType } from '../extractors/excel.js';

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
  /** Topic this item is about */
  topic?: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Reusability level */
  level: ItemLevel;
  /** Detected language */
  lang?: string;
  /** Suggested destination (company, answer_library, product) */
  destination?: string;
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

/** Detected Q&A pair (legacy, maps to DetectedItem) */
interface DetectedQAPair {
  question: string;
  questionCell: string;
  answer?: string;
  answerCell: string;
  section: string;
  confidence: number;
  level: ItemLevel;
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
   * Analyze a large sheet in two passes: outline first, then sections
   * This handles documents with more rows than can fit in a single context
   */
  async analyzeSheetInPasses(sheet: SheetData, documentType: DocumentType = 'excel'): Promise<SheetAnalysis> {
    const rowLimit = documentType === 'pdf' ? 180 : 150;

    // If document fits in single pass, use regular analysis
    if (sheet.rows.length <= rowLimit) {
      return this.analyzeSheet(sheet, documentType);
    }

    console.log(`    Large document (${sheet.rows.length} rows), using two-pass analysis...`);

    // Pass 1: Build outline of all sections
    const outline = await this.buildOutline(sheet, documentType);
    console.log(`    Found ${outline.length} sections in outline`);

    // Pass 2: Process each section separately
    const allItems: DetectedItem[] = [];
    const allSections: SheetAnalysis['sections'] = [];

    for (const section of outline) {
      console.log(`    Processing section: ${section.title} (rows ${section.startRow}-${section.endRow})...`);

      // Extract rows for this section
      const sectionRows = sheet.rows.filter(r => r.row >= section.startRow && r.row <= section.endRow);

      if (sectionRows.length === 0) continue;

      // Create a mini-sheet with just this section's rows
      const sectionSheet: SheetData = {
        ...sheet,
        rows: sectionRows,
      };

      // Analyze this section
      const sectionAnalysis = await this.analyzeSection(sectionSheet, section, documentType);

      allSections.push({
        title: section.title,
        startRow: section.startRow,
        endRow: section.endRow,
        topic: section.topic,
      });

      allItems.push(...sectionAnalysis.items);
      console.log(`      Found ${sectionAnalysis.items.length} items`);
    }

    return {
      sheetName: sheet.name,
      sections: allSections,
      items: allItems,
      layoutType: 'mixed',
      notes: `Analyzed in ${outline.length} sections (two-pass mode)`,
    };
  }

  /**
   * Pass 1: Build outline of sections from the full document
   */
  private async buildOutline(sheet: SheetData, documentType: DocumentType): Promise<Array<{
    title: string;
    startRow: number;
    endRow: number;
    topic?: string;
  }>> {
    // Build compact outline representation (just section headers and row numbers)
    const lines: string[] = [];
    lines.push(`Document: ${sheet.name}`);
    lines.push(`Total rows: ${sheet.rows.length}`);
    lines.push('');
    lines.push('## Content summary (first cell of each row):');

    for (const row of sheet.rows) {
      // Get first non-empty cell
      const cells = Object.values(row.cells);
      const firstCell = cells.find(c => c.filled);

      if (firstCell) {
        const prefix = firstCell.role === 'section' ? '[SECTION]' :
                       firstCell.role === 'header' ? '[HEADER]' : '';
        const value = firstCell.value.substring(0, 80).replace(/\n/g, ' ');
        lines.push(`Row ${row.row}: ${prefix} ${value}`);
      }
    }

    const prompt = `Identify all major sections in this questionnaire document.

${lines.join('\n')}

## Task:
Look at the content and identify distinct sections/topics in the document.
Sections are typically marked by:
- Bold headers or section titles
- Numbered sections (1., 2., 3. or 1.1, 1.2)
- Topic changes (e.g., from "Company Info" to "Certifications")
- Clear visual breaks in the content

Return JSON with the sections found:
{
  "sections": [
    {"title": "Section Name", "startRow": 1, "endRow": 25, "topic": "company"},
    {"title": "Food Safety", "startRow": 26, "endRow": 50, "topic": "food_safety"}
  ]
}

Topics: company, contacts, certifications, allergens, food_safety, quality, quality_systems, sustainability, environment, packaging, logistics, origin, food_fraud, food_defense, nutrition, crisis, financial, animal_welfare, audits, product, ingredients, microbiology, documents, signature, approval, premises, hygiene, training, cleaning, pest_control, equipment, monitoring, waste, traceability, raw_materials, other

Important:
- Cover ALL rows from 1 to ${sheet.rows.length}
- No gaps between sections
- If a section is unclear, use "other" as topic`;

    const response = await this.invokeModel(prompt);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        let sections = parsed.sections || [];

        // CRITICAL: Fill gaps to ensure no content is lost
        sections = this.fillSectionGaps(sections, sheet.rows.length);
        return sections;
      }
    } catch (e) {
      console.error('Failed to parse outline:', e);
    }

    // Fallback: single section covering entire document
    return [{
      title: sheet.name,
      startRow: 1,
      endRow: sheet.rows.length,
      topic: 'other',
    }];
  }

  /**
   * Fill gaps between sections to ensure no content is lost
   */
  private fillSectionGaps(sections: any[], totalRows: number): any[] {
    if (sections.length === 0) {
      return [{
        title: "Complete Document",
        startRow: 1,
        endRow: totalRows,
        topic: 'other'
      }];
    }

    // Sort sections by startRow
    sections.sort((a, b) => a.startRow - b.startRow);

    const filledSections: any[] = [];
    let currentRow = 1;

    for (const section of sections) {
      // Fill gap before this section if needed
      if (currentRow < section.startRow) {
        filledSections.push({
          title: `Content (rows ${currentRow}-${section.startRow - 1})`,
          startRow: currentRow,
          endRow: section.startRow - 1,
          topic: 'other'
        });
      }

      // Add the original section
      filledSections.push(section);
      currentRow = Math.max(currentRow, section.endRow + 1);
    }

    // Fill gap after last section if needed
    if (currentRow <= totalRows) {
      filledSections.push({
        title: `Content (rows ${currentRow}-${totalRows})`,
        startRow: currentRow,
        endRow: totalRows,
        topic: 'other'
      });
    }

    console.log(`    Gap filling: ${sections.length} original → ${filledSections.length} complete sections`);
    return filledSections;
  }

  /**
   * Pass 2: Analyze a specific section in detail
   */
  private async analyzeSection(
    sectionSheet: SheetData,
    sectionInfo: { title: string; startRow: number; endRow: number; topic?: string },
    documentType: DocumentType
  ): Promise<SheetAnalysis> {
    const sheetText = this.buildSheetRepresentation(sectionSheet, documentType);

    const prompt = `Analyze this section of a questionnaire and extract all data items.

## Section: ${sectionInfo.title}
## Topic hint: ${sectionInfo.topic || 'unknown'}
## Row range: ${sectionInfo.startRow} to ${sectionInfo.endRow}

${sheetText}

## Legend:
- [H] = Header/bold cell
- [S] = Section header
- [L] = Label cell
- [I] = Input field
- [V] = Value

## Task:
Extract all data items from this section. Item types:
- "field" = Simple label/value pair
- "text" = Longer text response
- "yesno" = Yes/No choice
- "choice" = Selection/dropdown
- "signature" = Signature field
- "date" = Date field

Levels:
- "standard" = Factual, can be auto-filled
- "narrative" = Descriptive, needs review
- "product" = Product-specific

Return JSON:
{
  "items": [
    {
      "type": "yesno",
      "label": "Question text",
      "value": "Yes",
      "lCell": "A10",
      "vCell": "B10",
      "topic": "${sectionInfo.topic || 'other'}",
      "level": "standard",
      "lang": "en",
      "confidence": 0.9
    }
  ]
}

CRITICAL RULES FOR COMMENTS:
- When a row has a Yes/No answer AND a COMMENTS column with text, extract TWO items:
  1. The Yes/No item: "Is there an effective pest control program?" → "Yes"
  2. The Comments item: "Is there an effective pest control program? - Comments" → "A documented pest control system..."
- NEVER rephrase the label for comments. Keep the EXACT original question and append " - Comments"
- DO NOT create labels like "Effective pest control program details" or "Pest control records details"
- ALWAYS use the pattern: "[Original Question] - Comments"

CRITICAL RULES FOR CONDITIONAL FOLLOW-UP QUESTIONS:
- When you see "If yes", "If no", "If applicable", etc., make the label self-explanatory
- Find the parent question and incorporate its context into the label
- Use natural phrasing - "against" for preventive/protective measures, "for" when describing something
- Example:
  Parent: "Are there physical hazards?" → Yes
  Follow-up: "If yes; which preventive measures are in place?" → "Sieve control..."
  WRONG label: "If yes; which preventive measures are in place?"
  WRONG label: "Which preventive measures are in place?"
  CORRECT label: "Which preventive measures are in place against physical hazards?"
- Another example:
  Parent: "Is transportation outsourced?" → Yes
  Follow-up: "If yes; are there contracts in place?" → "Yes"
  CORRECT label: "Are there contracts in place for outsourced transportation?"
- The label should make sense WITHOUT needing to see the parent question
- Remove "If yes/no" prefixes and add context naturally

Important:
- Extract EVERY question/answer pair
- For PDF yes/no tables, "x" typically means "Yes"
- For strikethrough answers: if one option (YES/NO) has a line through it, the answer is the OTHER option
- Use the row numbers exactly as shown`;

    const response = await this.invokeModel(prompt);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          sheetName: sectionSheet.name,
          sections: [],
          items: (parsed.items || []).map((item: DetectedItem) => ({
            ...item,
            section: sectionInfo.title,
          })),
          layoutType: 'mixed',
        };
      }
    } catch (e) {
      console.error('Failed to parse section analysis:', e);
    }

    return {
      sheetName: sectionSheet.name,
      sections: [],
      items: [],
      layoutType: 'mixed',
    };
  }

  /**
   * Analyze a sheet's structure using Claude
   */
  async analyzeSheet(sheet: SheetData, documentType: DocumentType = 'excel'): Promise<SheetAnalysis> {
    // Build a text representation of the sheet with formatting hints
    const sheetText = this.buildSheetRepresentation(sheet, documentType);

    const docTypeLabel = documentType === 'excel' ? 'spreadsheet sheet' :
                         documentType === 'word' ? 'Word document' :
                         documentType === 'html' ? 'HTML document/form' : 'PDF document';

    const prompt = `Analyze this ${docTypeLabel} and identify all data items (fields, tables, etc.).

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

4. ROW-IDENTIFIER TABLES: When a table has a first column that identifies WHAT each row is about (like component names, allergen names, product names), ALWAYS include the ACTUAL VALUE from that identifying column in the label, even if there's only ONE data row:
   - Example: Composition table with columns "Components", "Quantity (%)", "Source material", "E-number"
   - Row 1 has: "Isomalt", "100", "sugar beet", "E953"
   - WRONG: label="Quantity (% on total) of components", value="100"
   - WRONG: label="Component 1 - Quantity (%)", value="100" (don't use generic "Component 1")
   - CORRECT: label="Isomalt - Quantity (% on total)", value="100" (use actual name "Isomalt")
   - CORRECT: label="Isomalt - Source material", value="sugar beet"
   - CORRECT: label="Isomalt - E-number", value="E953"
   - The row identifier should be the ACTUAL VALUE (e.g., "Isomalt", "Wheat", "Hazelnuts"), NOT a generic reference like "Component 1" or "Row 1"
   - This applies whether the table has 1 row or 10 rows - always include the actual row identifier value

5. PDF YES/NO TABLES: In PDFs, you may see questions ending with "x" (e.g., "Is there a procedure in place? x"). This "x" indicates a checkmark in a Yes/No/N/A table and typically means "Yes". Extract these as yesno items with value "Yes". If you see a section header like "Yes No N/A COMMENTS", subsequent questions with "x" are from this table structure. The "x" mark means the answer is affirmative (Yes).

6. STRIKETHROUGH ANSWERS: Some questionnaires use strikethrough to indicate the WRONG answer. When you see YES/NO options where one is struck through (has a line through it), the answer is the option WITHOUT strikethrough:
   - If "NO" has strikethrough → answer is "Yes"
   - If "YES" has strikethrough → answer is "No"
   - Strikethrough may appear as text with a horizontal line through it, or as visually different (lighter/greyed) compared to the selected option

7. QUESTIONNAIRE METADATA: Do NOT extract these as answer library items:
   - Document headers, page numbers, form version numbers
   - Instructions to the filler ("Please complete", "Insert by supplier")
   - Attachment/document references ("Certificate attached", "See appendix", "Bijgevoegd")
   - These should be tagged with destination: "questionnaire" or "exclude"

And a level for reusability:
- "standard" = Factual company data, can be auto-filled (name, address, cert numbers)
- "narrative" = Descriptive company info, needs review (policies, procedures)
- "product" = Product-specific, changes per product (ingredients, allergens)

And a topic describing what the item is about (choose the most specific one):

ENTITY topics (for company/organization data):
- "entity_info" = Company name, address, legal info, registration
- "entity_contacts" = Contact persons, phone, email
- "entity_certifications" = Company-level certifications

PRODUCT topics (for product-specific data):
- "product_identification" = Product name, code, reference, article number
- "product_attributes" = Appearance, taste, smell, color, texture
- "product_composition" = Ingredients list, recipe, formula
- "product_allergens" = Allergen declarations, cross-contamination
- "product_nutrition" = Nutritional values, calories
- "product_certifications" = Halal, kosher, organic, vegan
- "product_specifications" = Shelf life, storage conditions
- "product_packaging" = Packaging materials, dimensions, labeling

OPERATIONS topics (for processes):
- "quality_systems" = QMS, HACCP, food safety systems
- "premises" = Building, facilities, zoning, infrastructure
- "equipment" = Production equipment, maintenance, calibration
- "hygiene" = Personal hygiene, handwashing, protective clothing
- "cleaning" = Cleaning procedures, sanitation, disinfection
- "pest_control" = Pest management
- "monitoring" = Environmental monitoring, testing, sampling
- "raw_materials" = Raw material sourcing, suppliers
- "traceability" = Batch tracking, lot numbers
- "logistics" = Transport, storage, shipping
- "waste" = Waste handling, disposal
- "microbiology" = Microbiological testing

COMPLIANCE topics:
- "certifications" = BRC, IFS, FSSC, ISO standards
- "audits" = Internal/external audits, inspections
- "food_safety" = Food safety procedures, hazard analysis
- "food_defense" = Security, tampering prevention
- "food_fraud" = Authenticity, adulteration prevention
- "crisis" = Recall procedures, complaints
- "origin" = Country of origin, provenance

SUSTAINABILITY topics:
- "sustainability" = CSR, carbon footprint
- "environment" = Environmental policies
- "animal_welfare" = Animal welfare policies

ADMIN topics:
- "training" = Staff training, competency
- "documents" = Document references, attachments
- "signature" = Signatures (NOT reusable)
- "approval" = Approvals, authorizations
- "financial" = Financial info, banking

- "other" = Only when no other topic fits

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
      "topic": "company",
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
      "topic": "certifications",
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
      "topic": "contacts",
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
      "topic": "contacts",
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
- CRITICAL: For multi-column contact tables, create separate items for each column
- CRITICAL: For specification/quality parameter tables with 3+ columns, create separate items for EACH column:
  * Example: Row 186 with "Dextrose Equivalent (ISO 5377)", "", "CoA" → create 3 items:
    - Item 1: lCell="A186", label="Dextrose Equivalent (ISO 5377)", value="(parameter name)"
    - Item 2: lCell="B186", label="Dextrose Equivalent - Standard Value", value="EMPTY"
    - Item 3: lCell="C186", label="Dextrose Equivalent - Monitoring Method", value="CoA"
  * DO NOT combine columns A186+C186 into a single item
  * Each column = separate item, even if empty
  * Pattern: Parameter/Standard/Method or Name/Value/Analysis columns

CRITICAL RULES FOR COMMENTS:
- When a row has a Yes/No answer AND a COMMENTS column with text, extract TWO items:
  1. The Yes/No item: "Is there an effective pest control program?" → "Yes"
  2. The Comments item: "Is there an effective pest control program? - Comments" → "A documented pest control system..."
- NEVER rephrase the label for comments. Keep the EXACT original question and append " - Comments"
- DO NOT create labels like "Effective pest control program details" or "Pest control records details"
- ALWAYS use the pattern: "[Original Question] - Comments"

CRITICAL RULES FOR CONDITIONAL FOLLOW-UP QUESTIONS:
- When you see "If yes", "If no", "If applicable", etc., make the label self-explanatory
- Find the parent question and incorporate its context into the label
- Use natural phrasing - "against" for preventive/protective measures, "for" when describing something
- Example:
  Parent: "Are there physical hazards?" → Yes
  Follow-up: "If yes; which preventive measures are in place?" → "Sieve control..."
  WRONG label: "If yes; which preventive measures are in place?"
  WRONG label: "Which preventive measures are in place?"
  CORRECT label: "Which preventive measures are in place against physical hazards?"
- Another example:
  Parent: "Is transportation outsourced?" → Yes
  Follow-up: "If yes; are there contracts in place?" → "Yes"
  CORRECT label: "Are there contracts in place for outsourced transportation?"
- The label should make sense WITHOUT needing to see the parent question
- Remove "If yes/no" prefixes and add context naturally`;

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
  private buildSheetRepresentation(sheet: SheetData, documentType: DocumentType = 'excel'): string {
    const lines: string[] = [];

    // Add merged ranges info (only for Excel)
    if (documentType === 'excel' && sheet.mergedRanges && sheet.mergedRanges.length > 0) {
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

    // PDFs can have many more rows than Excel, increase limit
    const rowLimit = documentType === 'pdf' ? 180 : 150;
    for (const row of sheet.rows.slice(0, rowLimit)) {
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

        const value = cell.value.replace(/\n/g, ' ');
        if (value || cell.role === 'input') {
          cellTexts.push(`${cell.ref}${prefix}: ${value || '(empty input)'}`);
        }
      }

      if (cellTexts.length > 0) {
        lines.push(`Row ${row.row}: ${cellTexts.join(' | ')}`);
      }
    }

    if (sheet.rows.length > rowLimit) {
      lines.push(`... (${sheet.rows.length - rowLimit} more rows)`);
    }

    return lines.join('\n');
  }

  /**
   * Invoke Bedrock Claude model
   */
  private async invokeModel(prompt: string): Promise<string> {
    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 32768,
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

    // Log if response was truncated
    if (responseBody.stop_reason === 'max_tokens') {
      console.warn(`    Warning: Claude response truncated (max_tokens reached)`);
    }

    return responseBody.content[0].text;
  }

  /**
   * Analyze multiple sheets and combine results
   */
  async analyzeQuestionnaire(sheets: SheetData[], documentType: DocumentType = 'excel'): Promise<SheetAnalysis[]> {
    const results: SheetAnalysis[] = [];
    const rowLimit = documentType === 'pdf' ? 180 : 150;

    for (const sheet of sheets) {
      console.log(`  Analyzing sheet: ${sheet.name}...`);
      try {
        // Use two-pass analysis for large documents
        const analysis = sheet.rows.length > rowLimit
          ? await this.analyzeSheetInPasses(sheet, documentType)
          : await this.analyzeSheet(sheet, documentType);
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
    const items: DetectedItem[] = [];

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
        // Convert DetectedQAPair to DetectedItem
        items.push({
          type: 'field',
          label: pair.question,
          value: pair.answer,
          lCell: pair.questionCell,
          vCell: pair.answerCell,
          section: pair.section,
          confidence: pair.confidence,
          level: pair.level,
        });
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
      items,
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
   * Detect if answer is standard or product level
   */
  private detectLevel(section: string, question: string): ItemLevel {
    const lower = (section + ' ' + question).toLowerCase();

    // Product-level indicators
    if (/allerg|ingredi|nutri|shelf|packag|batch|lot|expir|origin|recipe/i.test(lower)) {
      return 'product';
    }

    // Standard (entity-level) for most items
    return 'standard';
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
