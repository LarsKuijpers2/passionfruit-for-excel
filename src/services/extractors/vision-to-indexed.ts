/**
 * Vision to Indexed Converter
 *
 * Converts vision extraction Q&A pairs to the indexed format
 * so they can be displayed in the Extraction panel with destination tagging.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { randomBytes } from 'crypto';
import type { ExtractedQA, IdentifiedSection, VisionExtractionResult } from './vision-extractor.js';

// =============================================================================
// TYPES
// =============================================================================

interface IndexedItem {
  id: string;
  type: string;
  label: string;
  value: string;
  topic: string;
  level: string;
  lang: string;
  destination?: string;
  lCell?: string;
  vCell?: string;
  entityRole?: string;
  entityId?: string;
  productId?: string;
  pageNumber?: number;
}

interface IndexedSection {
  title: string;
  topic: string;
  rows: string;
  sheet: string;
  items: IndexedItem[];
}

interface DetectedEntity {
  id: string;
  name: string;
  role: string;
  nameSource: {
    label: string;
    cell?: string;
  };
}

interface DetectedProduct {
  id: string;
  name: string;
  nameSource: {
    label: string;
    cell?: string;
  };
}

interface IndexedDocument {
  id: string;
  source: string;
  indexed: string;
  language: string;
  entities: DetectedEntity[];
  products: DetectedProduct[];
  sections: IndexedSection[];
  stats?: {
    total: number;
    answered: number;
  };
  meta?: {
    visionExtraction: boolean;
    extractedAt: string;
    modelId?: string;
  };
}

// =============================================================================
// TOPIC MAPPING
// =============================================================================

const SECTION_TO_TOPIC: Record<string, string> = {
  // Identity sections
  'identity of the supplier': 'identity',
  'identity of the manufacturer': 'identity',
  'product identification': 'identity',
  'supplier identification': 'identity',
  'company information': 'identity',
  'contact': 'identity',
  'emergency contact': 'identity',

  // Product sections
  'product composition': 'product',
  'ingredients': 'product',
  'recipe': 'product',
  'formulation': 'product',

  // Quality sections
  'quality': 'quality',
  'haccp': 'quality',
  'food safety': 'quality',

  // Allergens
  'allergen': 'allergens',
  'food intolerance': 'allergens',

  // Nutrition
  'nutritional': 'nutrition',
  'nutrition': 'nutrition',

  // Certifications
  'certification': 'certifications',
  'kosher': 'certifications',
  'halal': 'certifications',
  'organic': 'certifications',

  // GMO
  'gmo': 'gmo',
  'genetically modified': 'gmo',

  // Microbiology
  'microbiol': 'microbiology',
  'pathogen': 'microbiology',

  // Logistics
  'logistics': 'logistics',
  'storage': 'logistics',
  'packaging': 'logistics',
  'shelf life': 'logistics',

  // Policy
  'policy': 'policy',
  'clean label': 'policy',

  // Documents
  'change log': 'documents',
  'version': 'documents',
  'approval': 'documents',

  // Contaminants
  'contamin': 'contaminants',
  'irradiation': 'contaminants',
  'radioactive': 'contaminants',

  // Specifications
  'organoleptic': 'specifications',
  'physicochemical': 'specifications',
  'physical': 'specifications',
};

// =============================================================================
// ENTITY DETECTION
// =============================================================================

const ENTITY_PATTERNS = {
  supplier: [
    /supplier\s*(name|company)/i,
    /vendor\s*(name|company)/i,
    /our\s*company/i,
    /leverancier/i,
  ],
  manufacturer: [
    /manufacturer/i,
    /manufacturing\s*site/i,
    /production\s*site/i,
    /fabricant/i,
  ],
  customer: [
    /customer\s*(name|company)/i,
    /client/i,
    /buyer/i,
  ],
  group: [
    /parent\s*company/i,
    /group\s*name/i,
    /head\s*office/i,
    /holding/i,
  ],
};

// =============================================================================
// CONVERTER
// =============================================================================

export async function convertVisionToIndexed(
  customerDir: string,
  questionnaireName: string
): Promise<IndexedDocument> {
  // Load vision extraction data
  const safeName = questionnaireName.replace(/\.(pdf|json)$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
  const visionDir = join(customerDir, 'vision-extraction', safeName);

  // Support both file naming conventions:
  // - VisionExtractor: phase2-qa-pairs.json, phase1-sections.json
  // - TwoPassVisionExtractor: pass2-qa-pairs.json, pass1-structure.md
  let qaPairsPath = join(visionDir, 'phase2-qa-pairs.json');
  let sectionsPath = join(visionDir, 'phase1-sections.json');
  const metadataPath = join(visionDir, 'metadata.json');

  // Try VisionExtractor format first, then TwoPassVisionExtractor
  if (!existsSync(qaPairsPath)) {
    qaPairsPath = join(visionDir, 'pass2-qa-pairs.json');
    sectionsPath = join(visionDir, 'pass1-structure.md'); // Not used, just for reference
  }

  if (!existsSync(qaPairsPath)) {
    throw new Error(`Vision extraction not found in: ${visionDir}`);
  }

  const qaPairs: ExtractedQA[] = JSON.parse(await readFile(qaPairsPath, 'utf-8'));
  let sections: IdentifiedSection[] = [];
  let metadata: any = {};

  if (existsSync(sectionsPath)) {
    sections = JSON.parse(await readFile(sectionsPath, 'utf-8'));
  }
  if (existsSync(metadataPath)) {
    metadata = JSON.parse(await readFile(metadataPath, 'utf-8'));
  }

  // Group Q&A pairs by section
  const sectionMap = new Map<string, ExtractedQA[]>();
  for (const qa of qaPairs) {
    const section = qa.section || 'Uncategorized';
    if (!sectionMap.has(section)) {
      sectionMap.set(section, []);
    }
    sectionMap.get(section)!.push(qa);
  }

  // Detect entities and products
  const entities: DetectedEntity[] = [];
  const products: DetectedProduct[] = [];
  const entityNameMap = new Map<string, string>(); // name -> id
  const productNameMap = new Map<string, string>(); // name -> id

  // First pass: detect entities and products
  for (const qa of qaPairs) {
    const label = qa.question.toLowerCase();
    const value = qa.answer?.trim();

    if (!value || value === 'NA' || value === 'N/A' || value === '-') continue;

    // Check for entity patterns
    for (const [role, patterns] of Object.entries(ENTITY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(label) && label.includes('name')) {
          if (!entityNameMap.has(value)) {
            const id = generateId();
            entityNameMap.set(value, id);
            entities.push({
              id,
              name: value,
              role,
              nameSource: { label: qa.question },
            });
          }
          break;
        }
      }
    }

    // Check for product patterns
    if (/product\s*(name|code)/i.test(label) && !productNameMap.has(value)) {
      const id = generateId();
      productNameMap.set(value, id);
      products.push({
        id,
        name: value,
        nameSource: { label: qa.question },
      });
    }
  }

  // Convert to indexed sections
  const indexedSections: IndexedSection[] = [];

  for (const [sectionTitle, sectionQAs] of sectionMap) {
    const topic = detectTopic(sectionTitle);
    const items: IndexedItem[] = [];

    // Track page range
    const pages = sectionQAs.map(qa => qa.page).filter(Boolean);
    const minPage = Math.min(...pages);
    const maxPage = Math.max(...pages);

    for (const qa of sectionQAs) {
      // Build label with full context to make it self-explanatory
      let label = qa.question;
      const rowCtx = qa.metadata?.rowContext?.trim();
      const colHeader = qa.metadata?.columnHeader?.trim();

      // Add row context if it provides additional info (avoid duplication)
      if (rowCtx) {
        const rowCtxLower = rowCtx.toLowerCase();
        const labelLower = label.toLowerCase();
        // Only add if neither contains the other
        if (!labelLower.includes(rowCtxLower) && !rowCtxLower.includes(labelLower)) {
          label = `${rowCtx} - ${label}`;
        } else if (rowCtxLower.includes(labelLower) && rowCtx.length > label.length) {
          // rowContext is more complete, use it instead
          label = rowCtx;
        }
      }

      // Add column header if it provides meaningful context
      if (colHeader) {
        const colHeaderLower = colHeader.toLowerCase();
        // Skip generic column headers that don't add context
        const isGenericHeader = ['yes', 'no', 'y', 'n', 'x', 'check', 'value', 'answer'].includes(colHeaderLower);

        if (!isGenericHeader && !label.toLowerCase().includes(colHeaderLower.replace('?', ''))) {
          // Meaningful column header - append it
          if (colHeader.endsWith('?')) {
            label = `${label} - ${colHeader}`;
          } else {
            label = `${label} - ${colHeader}?`;
          }
        }
      }

      // Store original label (raw question) for toggle feature
      const originalLabel = qa.question;

      const item: IndexedItem = {
        id: generateId(),
        type: qa.type || 'field',
        label,
        originalLabel: label !== originalLabel ? originalLabel : undefined, // Only store if different
        value: qa.answer || '',
        topic,
        level: 'standard',
        lang: 'en',
        pageNumber: qa.page,
      };

      // Assign destination based on topic and patterns
      item.destination = detectDestination(item, sectionTitle);

      // Link to entity if applicable
      const entityRole = detectEntityRole(qa.question, sectionTitle);
      if (entityRole) {
        item.entityRole = entityRole;
        // Try to find matching entity
        for (const entity of entities) {
          if (entity.role === entityRole) {
            item.entityId = entity.id;
            break;
          }
        }
      }

      items.push(item);
    }

    indexedSections.push({
      title: sectionTitle,
      topic,
      rows: pages.length > 0 ? `Page ${minPage}-${maxPage}` : 'Unknown',
      sheet: 'Document',
      items,
    });
  }

  // Build the indexed document
  const indexed: IndexedDocument = {
    id: generateId(),
    source: questionnaireName,
    indexed: new Date().toISOString().split('T')[0],
    language: 'en',
    entities,
    products,
    sections: indexedSections,
    stats: {
      total: qaPairs.length,
      answered: qaPairs.filter(qa => qa.answer && qa.answer.trim()).length,
    },
    meta: {
      visionExtraction: true,
      extractedAt: metadata.extractedAt || new Date().toISOString(),
      modelId: metadata.modelId,
    },
  };

  return indexed;
}

// =============================================================================
// HELPERS
// =============================================================================

function generateId(): string {
  return randomBytes(4).toString('hex');
}

function detectTopic(sectionTitle: string): string {
  const lower = sectionTitle.toLowerCase();

  for (const [pattern, topic] of Object.entries(SECTION_TO_TOPIC)) {
    if (lower.includes(pattern)) {
      return topic;
    }
  }

  return 'other';
}

function detectDestination(item: IndexedItem, sectionTitle: string): string {
  const label = item.label.toLowerCase();
  const topic = item.topic;

  // Company-level destinations
  if (topic === 'identity') {
    if (/name|address|tel|phone|email|contact|approval/i.test(label)) {
      return 'company';
    }
  }

  // Product-level destinations
  if (topic === 'product' || topic === 'nutrition' || topic === 'specifications') {
    return 'product';
  }

  // Exclude document metadata
  if (topic === 'documents') {
    if (/version|change|editor|approval|signature/i.test(label)) {
      return 'exclude';
    }
  }

  // Default to answer_library
  return 'answer_library';
}

function detectEntityRole(label: string, sectionTitle: string): string | undefined {
  const lower = label.toLowerCase();
  const sectionLower = sectionTitle.toLowerCase();

  // Check section title first
  if (sectionLower.includes('supplier') || sectionLower.includes('manufacturer')) {
    if (/name|address|tel|contact|email/i.test(lower)) {
      return sectionLower.includes('manufacturer') ? 'manufacturer' : 'supplier';
    }
  }

  // Check label patterns
  for (const [role, patterns] of Object.entries(ENTITY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        return role;
      }
    }
  }

  return undefined;
}

// =============================================================================
// CLI FUNCTION
// =============================================================================

export async function convertAndSave(
  customerDir: string,
  questionnaireName: string
): Promise<string> {
  const indexed = await convertVisionToIndexed(customerDir, questionnaireName);

  // Save to indexed folder
  const indexedDir = join(customerDir, 'indexed');
  await mkdir(indexedDir, { recursive: true });

  const safeName = questionnaireName.replace(/\.(pdf|json)$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
  const outputPath = join(indexedDir, `${safeName}.json`);

  await writeFile(outputPath, JSON.stringify(indexed, null, 2), 'utf-8');

  console.log(`✓ Converted ${indexed.stats?.total} Q&A pairs to indexed format`);
  console.log(`  - ${indexed.sections.length} sections`);
  console.log(`  - ${indexed.entities.length} entities detected`);
  console.log(`  - ${indexed.products.length} products detected`);
  console.log(`  Saved to: ${outputPath}`);

  return outputPath;
}
