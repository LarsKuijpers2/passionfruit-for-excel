/**
 * Questionnaire Indexer
 *
 * Indexes questionnaire structure with ALL items organized by section/topic.
 * Produces clean YAML with no translations (translations happen in HARVEST).
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { randomUUID } from 'crypto';
import { franc } from 'franc';
import { VisualAnalyzer, type SheetAnalysis, type DetectedItem, type ItemType, type ItemLevel } from './visual-analyzer.js';
import type { QuestionnaireStructure } from './excel-structure.js';

// =============================================================================
// TYPES
// =============================================================================

export type Language = 'en' | 'de' | 'fr' | 'nl';

/** An indexed item from a questionnaire */
export interface IndexedItem {
  type: ItemType;
  label: string;
  value?: string;
  lCell?: string;
  vCell?: string;
  ref?: string;
  level: ItemLevel;
  lang: Language | undefined;
}

/** A section in the questionnaire */
export interface IndexedSection {
  title: string;
  topic: string;
  rows: string;
  items: IndexedItem[];
}

/** Full indexed questionnaire */
export interface IndexedQuestionnaire {
  id: string;
  source: string;
  indexed: string;
  language: Language;
  sections: IndexedSection[];
  stats: {
    total: number;
    answered: number;
    standard: number;
    narrative: number;
    product: number;
  };
}

// =============================================================================
// TOPIC NORMALIZATION
// =============================================================================

const TOPIC_PATTERNS: Array<{ pattern: RegExp; topic: string }> = [
  { pattern: /company|firmierung|entreprise|bedrijf|general.*data|allgemeine.*daten|algemene/i, topic: 'company' },
  { pattern: /contact|ansprech|kontakt/i, topic: 'contacts' },
  { pattern: /certif|zertif/i, topic: 'certifications' },
  { pattern: /allerg/i, topic: 'allergens' },
  { pattern: /haccp|food.*safety|lebensmittel.*sicherheit/i, topic: 'food_safety' },
  { pattern: /quality|qualität|qualite|kwaliteit|qm.*system/i, topic: 'quality' },
  { pattern: /sustain|nachhaltig|durable|duurzaam|rse|csr/i, topic: 'sustainability' },
  { pattern: /environment|umwelt|environnement|milieu/i, topic: 'environment' },
  { pattern: /packag|verpack|emballage|verpakking/i, topic: 'packaging' },
  { pattern: /logist|transport|shipping|lieferung|livraison/i, topic: 'logistics' },
  { pattern: /origin|herkunft|origine|oorsprong/i, topic: 'origin' },
  { pattern: /fraud|betrug|fraude/i, topic: 'food_fraud' },
  { pattern: /nutri|nährwert|valeur/i, topic: 'nutrition' },
  { pattern: /crisis|krisen|crise/i, topic: 'crisis' },
  { pattern: /financ|finanz|bank|steuer|tax/i, topic: 'financial' },
  { pattern: /animal|tier|welfare|wohl/i, topic: 'animal_welfare' },
  { pattern: /audit|inspection|prüfung/i, topic: 'audits' },
  { pattern: /product|produkt|produit/i, topic: 'product' },
  { pattern: /ingredient|zutat|ingrédient|ingrediënt/i, topic: 'ingredients' },
  { pattern: /bacterio|micro|keime/i, topic: 'microbiology' },
  { pattern: /export/i, topic: 'export' },
  { pattern: /document|dokument|pièce/i, topic: 'documents' },
  { pattern: /onderteken|signature|unterschrift/i, topic: 'signature' },
  { pattern: /autoris|approval|genehmigung/i, topic: 'approval' },
];

function normalizeTopic(sectionTitle: string): string {
  for (const { pattern, topic } of TOPIC_PATTERNS) {
    if (pattern.test(sectionTitle)) {
      return topic;
    }
  }
  return 'other';
}

// =============================================================================
// QUESTIONNAIRE INDEXER
// =============================================================================

export class QuestionnaireIndexer {
  private storageDir: string;
  private analyzer: VisualAnalyzer;

  constructor(storageDir: string = './questionnaires', region: string = 'eu-central-1') {
    this.storageDir = storageDir;
    this.analyzer = new VisualAnalyzer(region);
  }

  /**
   * Index a questionnaire - extract ALL items organized by section
   */
  async index(filename: string): Promise<IndexedQuestionnaire> {
    // Load stored structure
    const jsonName = filename.replace(/\.(xlsx?|json)$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const filepath = join(this.storageDir, `${jsonName}.json`);
    const content = await readFile(filepath, 'utf-8');
    const structure: QuestionnaireStructure = JSON.parse(content);

    console.log(`  Analyzing ${structure.sheets.length} sheets with Claude...`);

    // Analyze all sheets
    const analyses = await this.analyzer.analyzeQuestionnaire(structure.sheets);

    // Build indexed structure
    const sections: IndexedSection[] = [];
    const allItems: IndexedItem[] = [];

    for (const analysis of analyses) {
      // Group items by section
      const sectionMap = new Map<string, DetectedItem[]>();

      for (const item of analysis.items) {
        const sectionTitle = item.section || analysis.sheetName;
        if (!sectionMap.has(sectionTitle)) {
          sectionMap.set(sectionTitle, []);
        }
        sectionMap.get(sectionTitle)!.push(item);
      }

      // Convert to indexed sections
      for (const [sectionTitle, items] of sectionMap) {
        const topic = normalizeTopic(sectionTitle);
        const indexedItems: IndexedItem[] = [];

        for (const item of items) {
          const lang = this.detectLanguage(item.label + ' ' + (item.value || ''));

          const indexedItem: IndexedItem = {
            type: item.type,
            label: item.label,
            value: item.value && item.value !== 'EMPTY' ? item.value : undefined,
            level: item.level,
            lang: lang !== 'unknown' ? lang : undefined,
          };

          // Add cell references based on type
          if (item.type === 'table' && item.ref) {
            indexedItem.ref = item.ref;
          } else {
            if (item.lCell) indexedItem.lCell = item.lCell;
            if (item.vCell) indexedItem.vCell = item.vCell;
          }

          indexedItems.push(indexedItem);
          allItems.push(indexedItem);
        }

        // Sort items by row (extract from lCell or ref)
        indexedItems.sort((a, b) => {
          const rowA = this.extractRow(a.lCell || a.ref || '');
          const rowB = this.extractRow(b.lCell || b.ref || '');
          return rowA - rowB;
        });

        if (indexedItems.length > 0) {
          const rows = this.calculateRowRange(indexedItems);
          sections.push({
            title: sectionTitle,
            topic,
            rows,
            items: indexedItems,
          });
        }
      }
    }

    // Sort sections by start row
    sections.sort((a, b) => {
      const rowA = parseInt(a.rows.split('-')[0], 10) || 0;
      const rowB = parseInt(b.rows.split('-')[0], 10) || 0;
      return rowA - rowB;
    });

    // Calculate stats
    const stats = this.calculateStats(allItems);

    // Detect primary language
    const primaryLanguage = this.detectPrimaryLanguage(allItems);

    return {
      id: randomUUID().split('-')[0],
      source: structure.source.filename,
      indexed: new Date().toISOString().split('T')[0],
      language: primaryLanguage,
      sections,
      stats,
    };
  }

  /**
   * Calculate row range string from items
   */
  private calculateRowRange(items: IndexedItem[]): string {
    const rows: number[] = [];
    for (const item of items) {
      const row = this.extractRow(item.lCell || item.ref || '');
      if (row > 0) rows.push(row);

      // For tables, also get end row
      if (item.ref && item.ref.includes(':')) {
        const endRow = this.extractRow(item.ref.split(':')[1]);
        if (endRow > 0) rows.push(endRow);
      }
    }

    if (rows.length === 0) return '0-0';
    const min = Math.min(...rows);
    const max = Math.max(...rows);
    return `${min}-${max}`;
  }

  /**
   * Detect language using franc
   */
  private detectLanguage(text: string): Language | 'unknown' {
    if (text.length < 20) {
      return this.detectLanguageSimple(text);
    }

    const detected = franc(text, { only: ['eng', 'deu', 'fra', 'nld'] });
    const langMap: Record<string, Language | 'unknown'> = {
      eng: 'en',
      deu: 'de',
      fra: 'fr',
      nld: 'nl',
      und: 'unknown',
    };

    return langMap[detected] || 'unknown';
  }

  /**
   * Simple pattern-based language detection for short texts
   */
  private detectLanguageSimple(text: string): Language | 'unknown' {
    const lower = text.toLowerCase();

    if (/[äöüß]/.test(text)) return 'de';
    if (/\b(und|oder|nicht|das|die|der)\b/i.test(lower)) return 'de';

    if (/[éèêëàâùûôîç]/.test(text)) return 'fr';
    if (/\b(et|ou|les|des|une|que)\b/i.test(lower)) return 'fr';

    if (/\b(en|of|het|een|zijn|van)\b/i.test(lower)) return 'nl';

    if (/\b(and|or|the|is|are)\b/i.test(lower)) return 'en';

    return 'unknown';
  }

  /**
   * Extract row number from cell reference
   */
  private extractRow(cellRef: string): number {
    const match = cellRef.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  /**
   * Calculate statistics
   */
  private calculateStats(items: IndexedItem[]): IndexedQuestionnaire['stats'] {
    let standard = 0;
    let narrative = 0;
    let product = 0;
    let answered = 0;

    for (const item of items) {
      if (item.level === 'standard') standard++;
      else if (item.level === 'narrative') narrative++;
      else product++;

      if (item.value) answered++;
    }

    return {
      total: items.length,
      answered,
      standard,
      narrative,
      product,
    };
  }

  /**
   * Detect primary language
   */
  private detectPrimaryLanguage(items: IndexedItem[]): Language {
    const counts: Record<Language, number> = { en: 0, de: 0, fr: 0, nl: 0 };

    for (const item of items) {
      if (item.lang) {
        counts[item.lang]++;
      }
    }

    let maxLang: Language = 'en';
    let maxCount = 0;

    for (const [lang, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        maxLang = lang as Language;
      }
    }

    return maxLang;
  }

  /**
   * Save indexed questionnaire
   */
  async save(indexed: IndexedQuestionnaire, outputDir: string = './indexed'): Promise<string> {
    await mkdir(outputDir, { recursive: true });

    const safeName = indexed.source
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]/g, '_');

    const filename = `${safeName}.yaml`;
    const filepath = join(outputDir, filename);

    await writeFile(filepath, stringifyYaml(indexed, { lineWidth: 0 }), 'utf-8');

    return filepath;
  }
}
