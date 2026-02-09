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
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
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
  table_grouping?: TableGroupingRules;
}

interface TableGroupingPattern {
  name: string;
  trigger_patterns: string[];
  topics: string[];
  min_items: number;
}

interface TableGroupingRules {
  min_items: number;
  max_row_gap: number;
  patterns: TableGroupingPattern[];
}

let loadedTopics: TopicDefinition[] | null = null;
let loadedTableGrouping: TableGroupingRules | null = null;

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
    loadedTableGrouping = rules.table_grouping || null;
    return loadedTopics;
  } catch (error) {
    console.warn(`  Warning: Failed to load topics from rules.yaml: ${error}`);
    return [];
  }
}

function getTableGroupingRules(): TableGroupingRules | null {
  return loadedTableGrouping;
}

// =============================================================================
// TYPES
// =============================================================================

export type Language = 'en' | 'de' | 'fr' | 'nl';

/** Destination for where the item should be stored */
export type ItemDestination = 'answer_library' | 'product' | 'company' | 'exclude';

/** An indexed item from a questionnaire */
export interface IndexedItem {
  id: string;  // Unique identifier for this item
  type: ItemType;
  label: string;
  value?: string;
  lCell?: string;
  vCell?: string;
  ref?: string;
  topic: string;
  level: ItemLevel;
  lang: Language | undefined;
  destination: ItemDestination;  // AI-suggested destination based on level and value
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
// AI TOPIC CLASSIFIER (fallback for unmatched sections)
// =============================================================================

class AITopicClassifier {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private topics: TopicDefinition[];

  constructor(region: string, topics: TopicDefinition[]) {
    this.client = new BedrockRuntimeClient({ region });
    this.modelId = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
    this.topics = topics;
  }

  /**
   * Classify multiple section titles that couldn't be matched by patterns
   */
  async classifyUnmatchedSections(sectionTitles: string[]): Promise<Map<string, string>> {
    if (sectionTitles.length === 0 || this.topics.length === 0) {
      return new Map();
    }

    // Build topic list for the prompt
    const topicList = this.topics.map(t => `- ${t.id}: ${t.name} - ${t.description}`).join('\n');

    const prompt = `You are classifying questionnaire section titles into predefined topics for a food industry supplier questionnaire system.

## Available Topics:
${topicList}

## Section Titles to Classify:
${sectionTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

For each section title, determine the most appropriate topic from the list above. Consider that:
- Titles may be in English, German, French, Dutch, or other languages
- Some titles are abbreviations or domain-specific terms
- If no topic fits well, use "other"

Respond with a JSON array of objects, one for each title:
[
  {"title": "exact title", "topic": "topic_id", "confidence": 0.0-1.0}
]

Only output the JSON array, no other text.`;

    try {
      const response = await this.client.send(new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      }));

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text = responseBody.content?.[0]?.text || '';

      // Parse JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn('  Warning: AI classifier returned no valid JSON');
        return new Map();
      }

      const results = JSON.parse(jsonMatch[0]) as Array<{ title: string; topic: string; confidence: number }>;
      const topicMap = new Map<string, string>();

      for (const result of results) {
        // Only use high-confidence classifications
        if (result.confidence >= 0.6) {
          topicMap.set(result.title, result.topic);
        }
      }

      return topicMap;
    } catch (error) {
      console.warn(`  Warning: AI topic classification failed: ${error}`);
      return new Map();
    }
  }
}

// =============================================================================
// TABLE GROUPING (groups consecutive product data items as single evidence)
// =============================================================================

interface GroupedTable {
  type: 'table';
  label: string;
  value: string;
  ref: string;
  topic: string;
  level: ItemLevel;
  itemCount: number;
  items: IndexedItem[];
}

function shouldGroupAsTable(
  items: IndexedItem[],
  sectionTitle: string,
  groupingRules: TableGroupingRules | null
): GroupedTable | null {
  if (!groupingRules || items.length < groupingRules.min_items) {
    return null;
  }

  // Check if section/items match any grouping pattern
  for (const pattern of groupingRules.patterns) {
    // Check if topic matches
    const topicMatches = items.some(item => pattern.topics.includes(item.topic));
    if (!topicMatches) continue;

    // Check if section title or item labels match trigger patterns
    let patternMatches = false;
    for (const triggerPattern of pattern.trigger_patterns) {
      try {
        const regex = new RegExp(triggerPattern, 'i');
        if (regex.test(sectionTitle)) {
          patternMatches = true;
          break;
        }
        // Also check item labels
        if (items.some(item => regex.test(item.label))) {
          patternMatches = true;
          break;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    if (!patternMatches) continue;

    // Check if we have enough items
    if (items.length < pattern.min_items) continue;

    // Check if items are in consecutive rows
    const rows = items.map(item => extractRowFromCell(item.lCell || item.ref || ''));
    const validRows = rows.filter(r => r > 0).sort((a, b) => a - b);

    if (validRows.length < pattern.min_items) continue;

    // Check for max row gap
    let isConsecutive = true;
    for (let i = 1; i < validRows.length; i++) {
      if (validRows[i] - validRows[i - 1] > groupingRules.max_row_gap) {
        isConsecutive = false;
        break;
      }
    }

    if (!isConsecutive) continue;

    // Create grouped table
    const startRow = Math.min(...validRows);
    const endRow = Math.max(...validRows);
    const primaryTopic = items[0]?.topic || 'other';

    // Build summary value from items
    const summaryParts = items.slice(0, 5).map(item =>
      `${item.label}: ${item.value || '(empty)'}`
    );
    if (items.length > 5) {
      summaryParts.push(`... and ${items.length - 5} more`);
    }

    return {
      type: 'table',
      label: `${sectionTitle} (${pattern.name})`,
      value: summaryParts.join('\n'),
      ref: `${startRow}:${endRow}`,
      topic: primaryTopic,
      level: 'product',
      itemCount: items.length,
      items: items,
    };
  }

  return null;
}

function extractRowFromCell(cellRef: string): number {
  const match = cellRef.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

// =============================================================================
// QUESTIONNAIRE INDEXER
// =============================================================================

export class QuestionnaireIndexer {
  private storageDir: string;
  private analyzer: VisualAnalyzer;
  private rulesManager: RulesManager;
  private rulesDir: string;
  private region: string;
  private topics: TopicDefinition[] = [];

  constructor(storageDir: string = './questionnaires', region: string = 'eu-central-1', rulesDir: string = './rules') {
    this.storageDir = storageDir;
    this.analyzer = new VisualAnalyzer(region);
    this.rulesManager = new RulesManager(rulesDir);
    this.rulesDir = rulesDir;
    this.region = region;
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
    const unmatchedSectionTitles: string[] = [];

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

        // Track unmatched sections for AI classification
        if (topic === 'other' && !unmatchedSectionTitles.includes(sectionTitle)) {
          unmatchedSectionTitles.push(sectionTitle);
        }

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
          const hasValue = item.value && item.value !== 'EMPTY' && item.value.trim() !== '';

          // Compute AI-suggested destination based on level and value
          let aiDestination: ItemDestination;
          if (!hasValue) {
            aiDestination = 'exclude'; // Empty items should be excluded
          } else if (item.level === 'product') {
            aiDestination = 'product';
          } else {
            aiDestination = 'answer_library'; // standard and narrative → answer_library
          }

          let indexedItem: IndexedItem = {
            id: randomUUID().split('-')[0], // Short unique ID
            type: item.type,
            label: item.label,
            value: hasValue ? item.value : undefined,
            topic: item.topic || topic, // Use item's topic if available, otherwise section topic
            level: item.level,
            lang: lang !== 'unknown' ? lang : undefined,
            destination: aiDestination, // AI-suggested destination
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

    // Use AI to classify unmatched sections
    if (unmatchedSectionTitles.length > 0 && this.topics.length > 0) {
      console.log(`  Classifying ${unmatchedSectionTitles.length} unmatched sections with AI...`);
      const classifier = new AITopicClassifier(this.region, this.topics);
      const aiTopics = await classifier.classifyUnmatchedSections(unmatchedSectionTitles);

      // Update sections and their items with AI-classified topics
      for (const section of sections) {
        if (section.topic === 'other' && aiTopics.has(section.title)) {
          const newTopic = aiTopics.get(section.title)!;
          section.topic = newTopic;
          // Also update items that inherited the section topic
          for (const item of section.items) {
            if (item.topic === 'other') {
              item.topic = newTopic;
            }
          }
        }
      }

      const classified = [...aiTopics.values()].length;
      if (classified > 0) {
        console.log(`    AI classified ${classified} sections`);
      }
    }

    // Apply table grouping rules to consolidate product data tables
    const groupingRules = getTableGroupingRules();
    if (groupingRules) {
      let tablesGrouped = 0;
      for (const section of sections) {
        // Only group product-level items
        const productItems = section.items.filter(item => item.level === 'product');
        if (productItems.length >= groupingRules.min_items) {
          const grouped = shouldGroupAsTable(productItems, section.title, groupingRules);
          if (grouped) {
            // Replace individual items with grouped table
            const nonProductItems = section.items.filter(item => item.level !== 'product');
            section.items = [
              ...nonProductItems,
              {
                id: randomUUID().split('-')[0], // Short unique ID for grouped table
                type: grouped.type,
                label: grouped.label,
                value: grouped.value,
                ref: grouped.ref,
                topic: grouped.topic,
                level: grouped.level,
                lang: undefined,
                destination: 'product' as ItemDestination, // Grouped tables are product-level
              },
            ];
            tablesGrouped++;
          }
        }
      }
      if (tablesGrouped > 0) {
        console.log(`  Grouped ${tablesGrouped} product data tables`);
      }
    }

    // Sort sections by start row
    sections.sort((a, b) => {
      const rowA = parseInt(a.rows.split('-')[0], 10) || 0;
      const rowB = parseInt(b.rows.split('-')[0], 10) || 0;
      return rowA - rowB;
    });

    // Recalculate allItems after grouping
    const finalItems: IndexedItem[] = [];
    for (const section of sections) {
      finalItems.push(...section.items);
    }

    // Calculate stats
    const stats = this.calculateStats(finalItems);

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
