/**
 * Questionnaire Indexer
 *
 * Indexes questionnaire structure with ALL items organized by section/topic.
 * Produces clean YAML with no translations (translations happen in HARVEST).
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { randomUUID } from 'crypto';
import { franc } from 'franc';
import { VisualAnalyzer, type SheetAnalysis, type DetectedItem, type ItemType, type ItemLevel } from './visual-analyzer.js';
import type { QuestionnaireStructure } from './excel-structure.js';
import { RulesManager } from './rules/rules-manager.js';

// =============================================================================
// TOPIC DEFINITION (loaded from rules/rules.yaml)
// =============================================================================

interface TopicDefinition {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  patterns?: string[];
}

interface TopicRules {
  topics: TopicDefinition[];
}

let loadedTopics: TopicDefinition[] | null = null;

async function loadTopicsFromRules(rulesDir: string): Promise<TopicDefinition[]> {
  if (loadedTopics) return loadedTopics;

  const rulesPath = join(rulesDir, 'rules.yaml');
  if (!existsSync(rulesPath)) {
    console.warn('  Warning: rules/rules.yaml not found, using fallback topics');
    return [];
  }

  try {
    const content = await readFile(rulesPath, 'utf-8');
    const rules = parseYaml(content) as TopicRules;
    loadedTopics = rules.topics || [];
    return loadedTopics;
  } catch (error) {
    console.warn(`  Warning: Failed to load topics from rules.yaml: ${error}`);
    return [];
  }
}

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
  topic: string;
  level: ItemLevel;
  lang: Language | undefined;
}

/** A section in the questionnaire */
export interface IndexedSection {
  title: string;
  topic: string;
  rows: string;
  sheet?: string;
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

// Fallback patterns if rules.yaml is not available
const FALLBACK_TOPIC_PATTERNS: Array<{ pattern: RegExp; topic: string }> = [
  { pattern: /company|firmierung|entreprise|bedrijf|general.*data|allgemeine.*daten|algemene/i, topic: 'company_information' },
  { pattern: /contact|ansprech|kontakt/i, topic: 'contact_persons' },
  { pattern: /certif|zertif/i, topic: 'certifications' },
  { pattern: /allerg/i, topic: 'allergens' },
  { pattern: /haccp|food.*safety|lebensmittel.*sicherheit/i, topic: 'quality_systems' },
  { pattern: /quality|qualität|qualite|kwaliteit|qm.*system/i, topic: 'quality_systems' },
  { pattern: /sustain|nachhaltig|durable|duurzaam|rse|csr/i, topic: 'sustainability' },
  { pattern: /environment|umwelt|environnement|milieu/i, topic: 'sustainability' },
  { pattern: /packag|verpack|emballage|verpakking/i, topic: 'packaging' },
  { pattern: /logist|transport|shipping|lieferung|livraison/i, topic: 'storage_transport' },
  { pattern: /origin|herkunft|origine|oorsprong/i, topic: 'origin_provenance' },
  { pattern: /fraud|betrug|fraude/i, topic: 'food_fraud' },
  { pattern: /nutri|nährwert|valeur/i, topic: 'nutritional' },
  { pattern: /crisis|krisen|crise/i, topic: 'complaints' },
  { pattern: /financ|finanz|bank|steuer|tax/i, topic: 'company_information' },
  { pattern: /animal|tier|welfare|wohl/i, topic: 'ethical_social' },
  { pattern: /product|produkt|produit/i, topic: 'identification' },
  { pattern: /ingredient|zutat|ingrédient|ingrediënt/i, topic: 'formula_composition' },
  { pattern: /bacterio|micro|keime/i, topic: 'microbiological' },
  { pattern: /export/i, topic: 'country_regulatory' },
  { pattern: /document|dokument|pièce/i, topic: 'declaration' },
  { pattern: /onderteken|signature|unterschrift/i, topic: 'signature' },
  { pattern: /autoris|approval|genehmigung/i, topic: 'approval' },
  { pattern: /foreign.*bod|fremdkörper|corps.*étrang/i, topic: 'foreign_bodies' },
  { pattern: /raw.*material|rohstoff|matière.*première/i, topic: 'raw_materials' },
  { pattern: /traceab|rückverfolgb|traça/i, topic: 'traceability' },
  { pattern: /complaint|reklamation|réclamation/i, topic: 'complaints' },
  { pattern: /shelf.*life|haltbarkeit|durée.*conservation/i, topic: 'shelf_life' },
  { pattern: /defense|verteidigung|défense/i, topic: 'food_defense' },
  { pattern: /gmo|genetisch|génétique/i, topic: 'gmo' },
  { pattern: /contaminant|verunreinig|contamin/i, topic: 'contaminants' },
  { pattern: /claim|angabe|allégation/i, topic: 'claims' },
  { pattern: /palm|rspo/i, topic: 'rspo_palm' },
  { pattern: /calibrat|kalibrier|étalon/i, topic: 'measuring_instruments' },
];

function normalizeTopicWithRules(sectionTitle: string, topics: TopicDefinition[]): string {
  const lowerTitle = sectionTitle.toLowerCase();

  // First try fallback patterns (more specific and multilingual)
  for (const { pattern, topic } of FALLBACK_TOPIC_PATTERNS) {
    if (pattern.test(sectionTitle)) {
      return topic;
    }
  }

  // Then try matching against loaded topic patterns (regex)
  for (const topic of topics) {
    for (const pattern of topic.patterns || []) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(sectionTitle)) {
          return topic.id;
        }
      } catch {
        // Invalid regex pattern, skip
      }
    }
  }

  // Finally try keywords with word boundary matching to avoid false positives
  for (const topic of topics) {
    for (const keyword of topic.keywords || []) {
      // Use word boundary to avoid partial matches like "format" in "informatie"
      const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keywordRegex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (keywordRegex.test(lowerTitle)) {
        return topic.id;
      }
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
  private rulesManager: RulesManager;
  private rulesDir: string;
  private topics: TopicDefinition[] = [];

  constructor(storageDir: string = './questionnaires', region: string = 'eu-central-1', rulesDir: string = './rules') {
    this.storageDir = storageDir;
    this.analyzer = new VisualAnalyzer(region);
    this.rulesManager = new RulesManager(rulesDir);
    this.rulesDir = rulesDir;
  }

  /**
   * Index a questionnaire - extract ALL items organized by section
   */
  async index(filename: string): Promise<IndexedQuestionnaire> {
    // Load stored structure
    const jsonName = filename.replace(/\.(xlsx?|docx?|pdf|json)$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const filepath = join(this.storageDir, `${jsonName}.json`);
    const content = await readFile(filepath, 'utf-8');
    const structure: QuestionnaireStructure = JSON.parse(content);

    // Load topics from rules.yaml
    this.topics = await loadTopicsFromRules(this.rulesDir);
    if (this.topics.length > 0) {
      console.log(`  Loaded ${this.topics.length} topic definitions from rules.yaml`);
    }

    // Load rules
    const rules = await this.rulesManager.loadIndexRules();
    const ruleStats = this.rulesManager.getStats();
    if (ruleStats.index.exclude > 0 || ruleStats.index.corrections > 0) {
      console.log(`  Loaded ${ruleStats.index.exclude} exclude + ${ruleStats.index.corrections} correction rules`);
    }

    const docType = structure.source.documentType || 'excel';
    console.log(`  Analyzing ${structure.sheets.length} sheets with Claude... (${docType})`);

    // Analyze all sheets
    const analyses = await this.analyzer.analyzeQuestionnaire(structure.sheets, docType);

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
        const topic = normalizeTopicWithRules(sectionTitle, this.topics);
        const indexedItems: IndexedItem[] = [];

        for (const item of items) {
          // Check if item should be excluded by rules
          if (this.rulesManager.shouldExcludeFromIndex({
            label: item.label,
            lCell: item.lCell,
            vCell: item.vCell,
            ref: item.ref,
          })) {
            continue; // Skip excluded items
          }

          const lang = this.detectLanguage(item.label + ' ' + (item.value || ''));

          let indexedItem: IndexedItem = {
            type: item.type,
            label: item.label,
            value: item.value && item.value !== 'EMPTY' ? item.value : undefined,
            topic: item.topic || topic, // Use item's topic if available, otherwise section topic
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

          // Apply corrections from rules
          indexedItem = this.rulesManager.applyIndexCorrections(indexedItem);

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
            sheet: analysis.sheetName,
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
