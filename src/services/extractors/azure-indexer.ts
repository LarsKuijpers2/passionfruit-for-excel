/**
 * Azure Indexer
 *
 * Extracts Q&A items from structure.json using LOCAL JSON parsing only.
 * No external API calls - processes the already-stored Azure Document Intelligence output.
 *
 * This is one of two extraction strategies:
 * - AzureIndexer: Local JSON parsing (this file)
 * - VisionIndexer: Claude Vision API for visual analysis
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { franc } from 'franc';
import type { QuestionnaireStructure, SheetData, RowData, CellData } from './excel.js';
import type { AzureEvidence, ExtractionSource } from '../../types.js';
import type {
  IndexedItem,
  IndexedSection,
  IndexedQuestionnaire,
  DetectedEntity,
  DetectedProduct,
  Language,
  ItemDestination,
  EntityRole,
} from '../analysis/questionnaire-indexer.js';
import type { ItemType, ItemLevel } from '../analysis/visual-analyzer.js';
import { RulesManager } from '../../utils/rules-manager.js';

// =============================================================================
// TOPIC DEFINITION
// =============================================================================

interface TopicDefinition {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  patterns?: string[];
}

// =============================================================================
// AZURE INDEXER CLASS
// =============================================================================

export class AzureIndexer {
  private storageDir: string;
  private rulesManager: RulesManager;
  private topics: TopicDefinition[] = [];

  constructor(storageDir: string = './structure', rulesDir: string = './rules') {
    this.storageDir = storageDir;
    this.rulesManager = new RulesManager(rulesDir);
  }

  /**
   * Index a questionnaire using Azure structure only (no Claude API calls)
   */
  async index(filename: string, outputDir?: string): Promise<IndexedQuestionnaire> {
    // Load stored structure
    const jsonName = filename.replace(/\.(xlsx?|docx?|pdf|json)$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const filepath = join(this.storageDir, `${jsonName}.json`);
    const content = await readFile(filepath, 'utf-8');
    const structure: QuestionnaireStructure = JSON.parse(content);

    // Load topics
    await this.loadTopics();

    // Build cell ref to pageNumber map
    const cellPageMap = this.buildCellPageMap(structure);

    // Detect language from first few values
    const language = this.detectDocumentLanguage(structure);

    // Extract sections from each sheet
    const sections = this.extractSections(structure, cellPageMap, language);

    // Detect entities from extracted items
    const entities = this.detectEntities(sections);

    // Calculate stats
    const allItems = sections.flatMap((s) => s.items);
    const stats = {
      total: allItems.length,
      answered: allItems.filter((i) => i.value && i.value.trim()).length,
      standard: allItems.filter((i) => i.level === 'standard').length,
      narrative: allItems.filter((i) => i.level === 'narrative').length,
      product: allItems.filter((i) => i.level === 'product').length,
    };

    const result: IndexedQuestionnaire = {
      id: randomUUID().slice(0, 8),
      source: structure.source.filename,
      indexed: new Date().toISOString().split('T')[0],
      language,
      entities,
      products: [], // Products detection can be added later
      sections,
      stats,
    };

    // Optionally write to output file
    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
      const outPath = join(outputDir, `${jsonName}-azure.json`);
      await writeFile(outPath, JSON.stringify(result, null, 2));
      console.log(`  Azure extraction saved to: ${outPath}`);
    }

    return result;
  }

  /**
   * Load topic definitions from rules/topics.yaml
   */
  private async loadTopics(): Promise<void> {
    try {
      const topicsConfig = await this.rulesManager.loadYaml<{ topics: TopicDefinition[] }>('topics.yaml');
      this.topics = topicsConfig?.topics || [];
    } catch {
      console.warn('  Warning: Could not load topics.yaml, using default topic detection');
      this.topics = [];
    }
  }

  /**
   * Build a map of cell references to page numbers for PDF navigation
   */
  private buildCellPageMap(structure: QuestionnaireStructure): Map<string, number> {
    const map = new Map<string, number>();
    for (const sheet of structure.sheets) {
      for (const row of sheet.rows) {
        for (const [col, cell] of Object.entries(row.cells)) {
          if (cell.pageNumber) {
            map.set(cell.ref, cell.pageNumber);
          }
        }
      }
    }
    return map;
  }

  /**
   * Detect document language from cell values
   */
  private detectDocumentLanguage(structure: QuestionnaireStructure): Language {
    const sampleText: string[] = [];
    for (const sheet of structure.sheets.slice(0, 3)) {
      for (const row of sheet.rows.slice(0, 20)) {
        for (const cell of Object.values(row.cells)) {
          if (cell.value && cell.value.length > 10) {
            sampleText.push(cell.value);
            if (sampleText.length >= 10) break;
          }
        }
        if (sampleText.length >= 10) break;
      }
      if (sampleText.length >= 10) break;
    }

    if (sampleText.length === 0) return 'en';

    const combined = sampleText.join(' ');
    const detected = franc(combined);
    const langMap: Record<string, Language> = {
      eng: 'en',
      deu: 'de',
      nld: 'nl',
      fra: 'fr',
    };
    return langMap[detected] || 'en';
  }

  /**
   * Extract sections from structure sheets
   */
  private extractSections(
    structure: QuestionnaireStructure,
    cellPageMap: Map<string, number>,
    language: Language
  ): IndexedSection[] {
    const sections: IndexedSection[] = [];

    for (const sheet of structure.sheets) {
      // Skip hidden sheets
      if (sheet.hidden) continue;

      // Group rows into sections based on section headers
      const sheetSections = this.groupRowsIntoSections(sheet);

      for (const sectionGroup of sheetSections) {
        const items = this.extractItemsFromRows(
          sectionGroup.rows,
          sheet,
          cellPageMap,
          language,
          sectionGroup.title
        );

        if (items.length > 0) {
          const topic = this.detectTopic(sectionGroup.title, items);
          const rowNumbers = sectionGroup.rows.map((r) => r.row);
          const rowRange = rowNumbers.length > 0 ? `${Math.min(...rowNumbers)}-${Math.max(...rowNumbers)}` : '0-0';

          sections.push({
            title: sectionGroup.title || sheet.name,
            topic,
            rows: rowRange,
            sheet: sheet.name,
            items,
            sectionType: 'individual_items',
          });
        }
      }
    }

    return sections;
  }

  /**
   * Group rows into sections based on detected section headers
   */
  private groupRowsIntoSections(sheet: SheetData): Array<{ title: string; rows: RowData[] }> {
    const sections: Array<{ title: string; rows: RowData[] }> = [];
    let currentSection = { title: sheet.name, rows: [] as RowData[] };

    for (const row of sheet.rows) {
      // Check if this row is a section header
      if (this.isSectionHeader(row, sheet)) {
        // Save current section if it has rows
        if (currentSection.rows.length > 0) {
          sections.push(currentSection);
        }
        // Start new section
        const headerText = this.extractSectionTitle(row);
        currentSection = { title: headerText || sheet.name, rows: [] };
      } else if (!row.isEmpty) {
        currentSection.rows.push(row);
      }
    }

    // Don't forget the last section
    if (currentSection.rows.length > 0) {
      sections.push(currentSection);
    }

    return sections.length > 0 ? sections : [{ title: sheet.name, rows: sheet.rows }];
  }

  /**
   * Check if a row is a section header
   */
  private isSectionHeader(row: RowData, sheet: SheetData): boolean {
    // Check row type
    if (row.rowType === 'header' || row.rowType === 'section') {
      return true;
    }

    // Check for merged cells spanning multiple columns (common for headers)
    const cells = Object.values(row.cells);
    for (const cell of cells) {
      if (cell.format?.isMerged && cell.format?.isMergeOrigin) {
        // Check merge range
        const mergeRange = sheet.mergedRanges.find((m) => m.start === cell.ref);
        if (mergeRange) {
          const startCol = mergeRange.startCol.charCodeAt(0);
          const endCol = mergeRange.endCol.charCodeAt(0);
          if (endCol - startCol >= 2) {
            // Spans 3+ columns = likely a header
            return true;
          }
        }
      }
    }

    // Check for bold formatting in first cell
    const firstCell = cells[0];
    if (firstCell?.format?.bold && cells.length === 1) {
      return true;
    }

    return false;
  }

  /**
   * Extract section title from a header row
   */
  private extractSectionTitle(row: RowData): string {
    if (row.sectionTitle) return row.sectionTitle;

    // Get the value from the first non-empty cell
    for (const cell of Object.values(row.cells)) {
      if (cell.value && cell.value.trim()) {
        return cell.value.trim();
      }
    }

    return '';
  }

  /**
   * Extract items from rows within a section
   */
  private extractItemsFromRows(
    rows: RowData[],
    sheet: SheetData,
    cellPageMap: Map<string, number>,
    language: Language,
    sectionTitle: string
  ): IndexedItem[] {
    const items: IndexedItem[] = [];

    for (const row of rows) {
      // Skip empty rows
      if (row.isEmpty) continue;

      // Look for label-value pairs (typically columns A and B)
      const extractedItems = this.extractLabelValuePairs(row, sheet, cellPageMap, language, sectionTitle);
      items.push(...extractedItems);
    }

    return items;
  }

  /**
   * Extract label-value pairs from a row
   */
  private extractLabelValuePairs(
    row: RowData,
    sheet: SheetData,
    cellPageMap: Map<string, number>,
    language: Language,
    sectionTitle: string
  ): IndexedItem[] {
    const items: IndexedItem[] = [];
    const cells = row.cells;
    const columns = Object.keys(cells).sort();

    // Try A/B pattern first (most common)
    if (cells['A'] && cells['B']) {
      const labelCell = cells['A'];
      const valueCell = cells['B'];

      // Skip if label looks empty or is just a number
      if (labelCell.role === 'label' || (labelCell.value && labelCell.value.trim() && !/^\d+\.?\d*$/.test(labelCell.value.trim()))) {
        const item = this.createItem(labelCell, valueCell, sheet, cellPageMap, language, sectionTitle);
        if (item) {
          items.push(item);
        }
      }
    }

    // Try other column pairs (C/D, E/F, etc.) for multi-column layouts
    for (let i = 2; i < columns.length; i += 2) {
      const labelCol = columns[i];
      const valueCol = columns[i + 1];
      if (labelCol && valueCol && cells[labelCol] && cells[valueCol]) {
        const labelCell = cells[labelCol];
        const valueCell = cells[valueCol];

        if (labelCell.role === 'label' || (labelCell.value && labelCell.value.trim())) {
          const item = this.createItem(labelCell, valueCell, sheet, cellPageMap, language, sectionTitle);
          if (item) {
            items.push(item);
          }
        }
      }
    }

    return items;
  }

  /**
   * Create an IndexedItem from label/value cells
   */
  private createItem(
    labelCell: CellData,
    valueCell: CellData,
    sheet: SheetData,
    cellPageMap: Map<string, number>,
    language: Language,
    sectionTitle: string
  ): IndexedItem | null {
    const label = labelCell.value?.trim();
    const value = valueCell.value?.trim();

    // Skip if no label
    if (!label) return null;

    // Detect item type from value
    const type = this.detectItemType(label, value);

    // Detect level
    const level = this.detectItemLevel(label, value, type);

    // Detect topic
    const topic = this.detectTopicForItem(label, sectionTitle);

    // Detect destination
    const destination = this.detectDestination(label, value, topic, level);

    // Detect entity role
    const entityRole = this.detectEntityRole(label, sectionTitle);

    // Get page number
    const pageNumber = cellPageMap.get(valueCell.ref) || cellPageMap.get(labelCell.ref);

    // Build Azure evidence
    const evidence: AzureEvidence = {
      type: 'azure',
      sheet: sheet.name,
      lCell: labelCell.ref,
      vCell: valueCell.ref,
    };

    return {
      id: randomUUID().slice(0, 8),
      type,
      label,
      value: value || undefined,
      lCell: labelCell.ref,
      vCell: valueCell.ref,
      topic,
      level,
      lang: language,
      destination,
      entityRole,
      pageNumber,
      extractionSource: 'azure' as ExtractionSource,
      evidence,
    };
  }

  /**
   * Detect item type from label and value
   */
  private detectItemType(label: string, value?: string): ItemType {
    const labelLower = label.toLowerCase();
    const valueLower = value?.toLowerCase() || '';

    // Date detection
    if (labelLower.includes('date') || labelLower.includes('datum') || labelLower.includes('fecha')) {
      return 'date';
    }

    // Yes/No detection
    if (
      valueLower === 'yes' ||
      valueLower === 'no' ||
      valueLower === 'ja' ||
      valueLower === 'nein' ||
      valueLower === 'oui' ||
      valueLower === 'non' ||
      /^(yes|no|ja|nein|oui|non|si|no)\s*$/i.test(valueLower)
    ) {
      return 'yesno';
    }

    // Text (long responses)
    if (value && value.length > 200) {
      return 'text';
    }

    // Default to field
    return 'field';
  }

  /**
   * Detect item level
   */
  private detectItemLevel(label: string, value?: string, type?: ItemType): ItemLevel {
    const labelLower = label.toLowerCase();

    // Product level indicators
    const productIndicators = [
      'product',
      'artikel',
      'produkt',
      'specification',
      'batch',
      'lot',
      'sku',
      'ingredient',
      'allergen',
      'recipe',
    ];
    if (productIndicators.some((ind) => labelLower.includes(ind))) {
      return 'product';
    }

    // Narrative level (long text)
    if (value && value.length > 500) {
      return 'narrative';
    }

    if (type === 'text') {
      return 'narrative';
    }

    return 'standard';
  }

  /**
   * Detect topic from label and section title
   */
  private detectTopicForItem(label: string, sectionTitle: string): string {
    const text = `${label} ${sectionTitle}`.toLowerCase();

    // Use loaded topics if available
    for (const topic of this.topics) {
      for (const keyword of topic.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          return topic.id;
        }
      }
    }

    // Fallback topic detection
    if (text.includes('certif') || text.includes('iso') || text.includes('brc') || text.includes('fssc')) {
      return 'entity_certifications';
    }
    if (text.includes('contact') || text.includes('email') || text.includes('phone') || text.includes('name')) {
      return 'entity_contacts';
    }
    if (text.includes('address') || text.includes('city') || text.includes('country') || text.includes('zip')) {
      return 'entity_info';
    }
    if (text.includes('quality') || text.includes('qms') || text.includes('haccp')) {
      return 'quality_systems';
    }
    if (text.includes('food safety') || text.includes('safety plan')) {
      return 'food_safety';
    }
    if (text.includes('allergen')) {
      return 'product_allergens';
    }
    if (text.includes('recall') || text.includes('traceab')) {
      return 'traceability';
    }

    return 'other';
  }

  /**
   * Detect topic for a section based on title and items
   */
  private detectTopic(sectionTitle: string, items: IndexedItem[]): string {
    // Check section title first
    const topic = this.detectTopicForItem('', sectionTitle);
    if (topic !== 'other') return topic;

    // Check most common topic in items
    const topicCounts: Record<string, number> = {};
    for (const item of items) {
      topicCounts[item.topic] = (topicCounts[item.topic] || 0) + 1;
    }

    const sorted = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || 'other';
  }

  /**
   * Detect destination for an item
   */
  private detectDestination(label: string, value: string | undefined, topic: string, level: ItemLevel): ItemDestination {
    // Company-level data
    if (
      topic === 'entity_info' ||
      topic === 'entity_contacts' ||
      (topic === 'entity_certifications' && level !== 'product')
    ) {
      // Check if it's a main company identifier
      const labelLower = label.toLowerCase();
      if (
        labelLower.includes('company name') ||
        labelLower.includes('supplier name') ||
        labelLower.includes('vendor name')
      ) {
        return 'company';
      }
      return 'answer_library';
    }

    // Product level data
    if (level === 'product' || topic.startsWith('product_')) {
      return 'product';
    }

    return 'answer_library';
  }

  /**
   * Detect entity role from label text
   */
  private detectEntityRole(label: string, sectionTitle?: string): EntityRole | undefined {
    const text = `${label} ${sectionTitle || ''}`.toLowerCase();

    // Supplier indicators
    if (
      text.includes('supplier') ||
      text.includes('vendor') ||
      text.includes('leverancier') ||
      text.includes('lieferant')
    ) {
      return 'supplier';
    }

    // Manufacturer indicators
    if (text.includes('manufacturer') || text.includes('manufacturing') || text.includes('production site')) {
      return 'manufacturer';
    }

    // Customer indicators
    if (text.includes('customer') || text.includes('client') || text.includes('buyer')) {
      return 'customer';
    }

    // Group/parent indicators
    if (text.includes('parent company') || text.includes('group') || text.includes('head office')) {
      return 'group';
    }

    return undefined;
  }

  /**
   * Detect entities from extracted sections
   */
  private detectEntities(sections: IndexedSection[]): DetectedEntity[] {
    const entities: DetectedEntity[] = [];
    const seenNames = new Set<string>();

    for (const section of sections) {
      for (const item of section.items) {
        // Look for company/supplier name items
        if (item.destination === 'company' && item.value) {
          const name = item.value.trim();
          if (name && !seenNames.has(name.toLowerCase())) {
            seenNames.add(name.toLowerCase());
            entities.push({
              id: randomUUID().slice(0, 8),
              name,
              role: item.entityRole || 'supplier',
              nameSource: {
                label: item.label,
                cell: item.vCell,
              },
            });

            // Update item with entity ID
            item.entityId = entities[entities.length - 1].id;
          }
        }
      }
    }

    return entities;
  }
}
