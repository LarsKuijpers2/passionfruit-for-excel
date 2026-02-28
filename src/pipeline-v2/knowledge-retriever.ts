/**
 * Knowledge Retriever
 *
 * Retrieves relevant domain knowledge based on topic.
 * Used by agents to pull context-specific information.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface KnowledgeSection {
  topic: string;
  keywords: string[];
  content: string;
}

// Map topics to their relevant sections in the knowledge file
const TOPIC_MAPPINGS: Record<string, string[]> = {
  // Certifications
  certifications: ['GFSI Standards', 'Religious Certifications', 'Social Compliance', 'ISO Standards', 'Dietary & Organic', 'Animal Welfare Certifications', 'Agricultural Certifications', 'Questionnaire Structure'],
  halal: ['Religious Certifications', 'Questionnaire Structure'],
  kosher: ['Religious Certifications', 'Questionnaire Structure'],
  organic: ['Dietary & Organic'],
  brc: ['GFSI Standards'],
  ifs: ['GFSI Standards'],
  fssc: ['GFSI Standards'],
  gfsi: ['GFSI Standards'],
  iso: ['ISO Standards'],

  // Social compliance
  sedex: ['Social Compliance', 'SEDEX vs SMETA'],
  smeta: ['Social Compliance', 'SEDEX vs SMETA'],
  bsci: ['Social Compliance'],

  // Animal welfare
  animal_welfare: ['Animal Welfare Certifications'],
  bord_bia: ['Animal Welfare Certifications'],
  red_tractor: ['Animal Welfare Certifications'],
  beter_leven: ['Animal Welfare Certifications'],

  // Agricultural certifications
  global_gap: ['Agricultural Certifications'],
  rainforest_alliance: ['Agricultural Certifications'],
  fairtrade: ['Agricultural Certifications'],

  // Sustainability
  sustainability: ['Sustainability', 'Climate & ESG', 'EUDR', 'Agricultural Certifications'],
  rspo: ['Sustainability'],
  sbti: ['Climate & ESG'],
  ecovadis: ['Climate & ESG'],
  co2: ['Climate & ESG'],
  carbon: ['Climate & ESG'],
  deforestation: ['EUDR', 'Sustainability'],
  eudr: ['EUDR'],

  // Soy certifications
  soy: ['Sustainability'],
  donau_soja: ['Sustainability'],
  proterra: ['Sustainability'],
  rtrs: ['Sustainability'],
  iscc: ['Sustainability'],

  // Food safety
  food_safety: ['Food Safety Terms'],
  haccp: ['Food Safety Terms'],
  codex: ['Food Safety Terms'],
  food_fraud: ['Food Safety Terms'],
  food_defense: ['Food Safety Terms'],

  // Dietary
  vegan: ['Dietary & Organic'],
  vegetarian: ['Dietary & Organic'],
  vlog: ['Dietary & Organic'],
  weidegang: ['Dietary & Organic'],

  // Allergens
  allergens: ['EU Allergens'],

  // Regulatory
  approval: ['EU Regulatory'],
  health_mark: ['EU Regulatory'],
  labeling: ['EU Regulatory'],
  packaging: ['EU Regulatory'],
};

// Keywords that trigger specific knowledge sections
const KEYWORD_TRIGGERS: Record<string, string[]> = {
  'Religious Certifications': ['halal', 'kosher', 'religious', 'islamic', 'jewish'],
  'GFSI Standards': ['brc', 'brcgs', 'ifs', 'fssc', 'sqf', 'gfsi', 'food safety certification', 'agents & brokers', 'agents and brokers'],
  'Social Compliance': ['sedex', 'smeta', 'bsci', 'sa 8000', 'ics', 'ethical', 'social audit'],
  'ISO Standards': ['iso 9001', 'iso 14001', 'iso 22000', 'iso 45001', 'iso 50001'],
  'Animal Welfare Certifications': ['bord bia', 'red tractor', 'farm assured', 'beter leven', 'ama gütesiegel', 'animal welfare'],
  'Agricultural Certifications': ['global gap', 'globalgap', 'rainforest alliance', 'rac certified', 'fairtrade', 'fair trade', 'utz'],
  'Sustainability': ['rspo', 'palm oil', 'sustainable', 'mass balance', 'segregated', 'donau soja', 'europe soya', 'proterra', 'rtrs', 'iscc', 'soy', 'soja'],
  'EUDR': ['eudr', 'deforestation', 'deforestation-free', 'due diligence', 'geolocation'],
  'Climate & ESG': ['sbti', 'science based', 'co2', 'carbon', 'ecovadis', 'pcf', 'csrd', 'esg'],
  'Dietary & Organic': ['organic', 'bio', 'vegan', 'vegetarian', 'v-label', 'vlog', 'weidegang', 'non-gmo', 'gmo'],
  'Food Safety Terms': ['haccp', 'ccp', 'codex', 'codex alimentarius', 'food safety', 'hazard'],
  'EU Regulatory': ['health approval', 'health mark', 'eu approval', 'nl z', 'ec 1935', 'eu 1169', 'ec 1334', 'flavouring', '1829/2003', '1830/2003', 'novel food', 'food contact'],
  'EU Allergens': ['allergen', 'gluten', 'crustacean', 'peanut', 'soybean', 'tree nut', 'celery', 'mustard', 'sesame', 'sulphite', 'lupin', 'mollusc', 'cross-contamination', 'may contain'],
  'Questionnaire Structure': ['entity', 'factory', 'site', 'company level', 'product level', 'conflict'],
};

let knowledgeCache: Map<string, string> | null = null;

function loadKnowledge(): Map<string, string> {
  if (knowledgeCache) return knowledgeCache;

  const knowledgePath = join(process.cwd(), 'knowledge', 'food-industry.md');

  if (!existsSync(knowledgePath)) {
    console.warn('Knowledge file not found:', knowledgePath);
    return new Map();
  }

  const content = readFileSync(knowledgePath, 'utf-8');
  const sections = new Map<string, string>();

  // Parse markdown into sections by ## headers
  const sectionRegex = /^## (.+)$/gm;
  let lastIndex = 0;
  let lastHeader = '';
  let match;

  while ((match = sectionRegex.exec(content)) !== null) {
    if (lastHeader) {
      sections.set(lastHeader, content.slice(lastIndex, match.index).trim());
    }
    lastHeader = match[1];
    lastIndex = match.index + match[0].length;
  }

  // Don't forget the last section
  if (lastHeader) {
    sections.set(lastHeader, content.slice(lastIndex).trim());
  }

  knowledgeCache = sections;
  return sections;
}

/**
 * Get relevant knowledge for a topic
 */
export function getKnowledge(topic: string): string {
  const sections = loadKnowledge();
  const relevantSections: string[] = [];

  // Get sections mapped to this topic
  const mappedSections = TOPIC_MAPPINGS[topic.toLowerCase()] || [];

  for (const sectionName of mappedSections) {
    for (const [header, content] of sections) {
      if (header.includes(sectionName) || sectionName.includes(header)) {
        relevantSections.push(`## ${header}\n${content}`);
      }
    }
  }

  // Remove duplicates
  return [...new Set(relevantSections)].join('\n\n');
}

/**
 * Auto-detect relevant knowledge based on content
 * Scans the text for keywords and returns matching knowledge sections
 */
export function getKnowledgeForContent(text: string): string {
  const sections = loadKnowledge();
  const lowerText = text.toLowerCase();
  const matchedSections = new Set<string>();

  // Check each keyword trigger
  for (const [sectionName, keywords] of Object.entries(KEYWORD_TRIGGERS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        matchedSections.add(sectionName);
        break;
      }
    }
  }

  // Build result from matched sections
  const relevantSections: string[] = [];

  for (const sectionName of matchedSections) {
    for (const [header, content] of sections) {
      if (header.includes(sectionName) || sectionName.includes(header)) {
        relevantSections.push(`## ${header}\n${content}`);
      }
    }
  }

  return [...new Set(relevantSections)].join('\n\n');
}

/**
 * Get all knowledge (for cases where full context is needed)
 */
export function getAllKnowledge(): string {
  const knowledgePath = join(process.cwd(), 'knowledge', 'food-industry.md');

  if (!existsSync(knowledgePath)) {
    return '';
  }

  return readFileSync(knowledgePath, 'utf-8');
}

// CLI test
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const topic = process.argv[2] || 'halal';
  console.log(`Knowledge for topic: ${topic}\n`);
  console.log(getKnowledge(topic) || 'No specific knowledge found');

  console.log('\n---\n');

  const testText = 'Is the company Halal certified? What about RSPO MB?';
  console.log(`Auto-detected knowledge for: "${testText}"\n`);
  console.log(getKnowledgeForContent(testText) || 'No relevant knowledge found');
}
