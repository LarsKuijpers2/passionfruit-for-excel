/**
 * Vision Indexer
 *
 * Extracts Q&A items from PDFs using Claude Vision API.
 * Each item includes bounding box coordinates for visual evidence.
 *
 * This is one of two extraction strategies:
 * - AzureIndexer: Local JSON parsing (parses structure.json)
 * - VisionIndexer: Claude Vision API for visual analysis (this file)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { execSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { franc } from 'franc';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { VisionEvidence, ExtractionSource } from '../../types.js';
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
// CONFIGURATION
// =============================================================================

const CLAUDE_MODEL_ID = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
const MAX_PAGES_PER_BATCH = 10;
const MAX_RETRIES = 2;
const RETRY_DELAYS = [2000, 4000];

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
// EXTRACTED Q&A FROM VISION
// =============================================================================

interface VisionQAPair {
  question: string;
  originalLabel?: string;  // The exact text as it appears in the document
  answer: string;
  section: string;
  pageNumber: number;
  confidence: number;
  type: 'field' | 'yesno' | 'text' | 'table' | 'choice' | 'date';
  level?: 'standard' | 'narrative' | 'product';
  topic?: string;
  destination?: string;
  entityRole?: string;
}

interface VisionSection {
  title: string;
  pages: number[];
  type: 'form' | 'table' | 'checklist' | 'text' | 'mixed';
}

// =============================================================================
// VISION INDEXER CLASS
// =============================================================================

export class VisionIndexer {
  private client: BedrockRuntimeClient;
  private rulesManager: RulesManager;
  private topics: TopicDefinition[] = [];
  private storageDir: string;

  constructor(storageDir: string = './structure', region: string = 'eu-central-1', rulesDir: string = './rules') {
    this.storageDir = storageDir;
    this.client = new BedrockRuntimeClient({ region });
    this.rulesManager = new RulesManager(rulesDir);
  }

  /**
   * Index a questionnaire using Claude Vision (API calls for visual analysis)
   */
  async index(pdfPath: string, outputDir?: string): Promise<IndexedQuestionnaire> {
    const filename = basename(pdfPath);
    console.log(`  🔍 Vision indexing: ${filename}`);

    // Load topics
    await this.loadTopics();

    // Convert PDF to images
    const { images, pageCount } = await this.convertPdfToImages(pdfPath);
    console.log(`  📄 Converted ${pageCount} pages to images`);

    // Phase 1: Discover document structure (sections)
    console.log(`  📋 Phase 1: Discovering sections...`);
    const sections = await this.discoverSections(images, pageCount);
    console.log(`  ✓ Found ${sections.length} sections`);

    // Phase 2: Extract Q&A pairs
    console.log(`  📝 Phase 2: Extracting Q&A pairs...`);
    const qaPairs = await this.extractQAPairs(images, sections);
    console.log(`  ✓ Extracted ${qaPairs.length} Q&A pairs`);

    // Detect language from extracted content
    const language = this.detectLanguage(qaPairs);

    // Build indexed sections
    const indexedSections = this.buildIndexedSections(sections, qaPairs, language);

    // Detect entities
    const entities = this.detectEntities(indexedSections);

    // Calculate stats
    const allItems = indexedSections.flatMap((s) => s.items);
    const stats = {
      total: allItems.length,
      answered: allItems.filter((i) => i.value && i.value.trim()).length,
      standard: allItems.filter((i) => i.level === 'standard').length,
      narrative: allItems.filter((i) => i.level === 'narrative').length,
      product: allItems.filter((i) => i.level === 'product').length,
    };

    const result: IndexedQuestionnaire = {
      id: randomUUID().slice(0, 8),
      source: filename,
      indexed: new Date().toISOString().split('T')[0],
      language,
      entities,
      products: [], // Products detection can be added later
      sections: indexedSections,
      stats,
    };

    // Optionally write to output file
    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
      const jsonName = filename.replace(/\.(pdf|xlsx?|docx?)$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
      const outPath = join(outputDir, `${jsonName}-vision.json`);
      await writeFile(outPath, JSON.stringify(result, null, 2));
      console.log(`  Vision extraction saved to: ${outPath}`);
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
   * Convert PDF to page images
   */
  private async convertPdfToImages(
    pdfPath: string
  ): Promise<{ images: Buffer[]; pageCount: number }> {
    // Get page count
    let pageCount = 1;
    try {
      const pageCountOutput = execSync(`pdfinfo "${pdfPath}" | grep Pages | awk '{print $2}'`, {
        encoding: 'utf-8',
      }).trim();
      pageCount = parseInt(pageCountOutput, 10) || 1;
    } catch {
      console.warn('  Could not detect page count, assuming 1 page');
    }

    const images: Buffer[] = [];

    // Create temp directory for images
    const tempDir = `/tmp/vision-indexer-${Date.now()}`;
    await mkdir(tempDir, { recursive: true });

    for (let page = 1; page <= pageCount; page++) {
      try {
        const outputPath = join(tempDir, `page-${page}`);

        // Use pdftoppm to convert PDF page to image
        execSync(`pdftoppm -f ${page} -l ${page} -r 150 "${pdfPath}" "${outputPath}"`, {
          maxBuffer: 50 * 1024 * 1024,
        });

        // Find the generated file (pdftoppm adds suffix)
        const generatedFile = `${outputPath}-${String(page).padStart(6, '0')}.ppm`;
        const pngPath = join(tempDir, `page-${page}.png`);

        // Convert PPM to PNG
        try {
          execSync(`sips -s format png "${generatedFile}" --out "${pngPath}" 2>/dev/null`, {
            maxBuffer: 50 * 1024 * 1024,
          });
          execSync(`rm "${generatedFile}"`, { encoding: 'utf-8' });
        } catch {
          // If sips fails, use ImageMagick or just use PPM
          try {
            execSync(`convert "${generatedFile}" "${pngPath}"`, { encoding: 'utf-8' });
            execSync(`rm "${generatedFile}"`, { encoding: 'utf-8' });
          } catch {
            // Rename PPM to PNG as fallback
            execSync(`mv "${generatedFile}" "${pngPath}"`, { encoding: 'utf-8' });
          }
        }

        if (existsSync(pngPath)) {
          images.push(await readFile(pngPath));
        }
      } catch (error) {
        console.warn(`  Warning: Could not convert page ${page}: ${error}`);
      }
    }

    // Clean up temp dir
    try {
      execSync(`rm -rf "${tempDir}"`, { encoding: 'utf-8' });
    } catch {
      // Ignore cleanup errors
    }

    return { images, pageCount };
  }

  /**
   * Phase 1: Discover document sections
   */
  private async discoverSections(images: Buffer[], pageCount: number): Promise<VisionSection[]> {
    const allSections: VisionSection[] = [];

    // Process in batches
    for (let i = 0; i < images.length; i += MAX_PAGES_PER_BATCH) {
      const batchImages = images.slice(i, i + MAX_PAGES_PER_BATCH);
      const startPage = i + 1;
      const endPage = Math.min(i + MAX_PAGES_PER_BATCH, images.length);

      console.log(`    Analyzing pages ${startPage}-${endPage}...`);

      const sections = await this.callSectionDiscovery(batchImages, startPage, endPage, pageCount);
      allSections.push(...sections);
    }

    // Merge duplicate sections
    return this.mergeSections(allSections);
  }

  private async callSectionDiscovery(
    images: Buffer[],
    startPage: number,
    endPage: number,
    totalPages: number
  ): Promise<VisionSection[]> {
    const content: any[] = [];

    // Add images with page numbers
    images.forEach((image, idx) => {
      content.push({
        type: 'text',
        text: `--- Page ${startPage + idx} ---`,
      });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: image.toString('base64'),
        },
      });
    });

    // Add prompt
    content.push({
      type: 'text',
      text: `Analyze this questionnaire and identify all distinct sections.

For each section, provide:
- title: The section header/name
- pages: Array of page numbers where this section appears
- type: "form" | "table" | "checklist" | "text" | "mixed"

Page numbers for these images are ${startPage}-${endPage} out of ${totalPages} total.

Output ONLY valid JSON array:
[{"title": "Section Name", "pages": [1, 2], "type": "table"}]`,
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.send(
          new InvokeModelCommand({
            modelId: CLAUDE_MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 4000,
              messages: [{ role: 'user', content }],
            }),
          })
        );

        const result = JSON.parse(new TextDecoder().decode(response.body));
        const responseText = result.content?.[0]?.text || '[]';
        return this.parseJsonResponse<VisionSection[]>(responseText, []);
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          console.log(`    Retry ${attempt + 1}/${MAX_RETRIES}...`);
          await this.sleep(RETRY_DELAYS[attempt]);
        } else {
          console.error(`    Section discovery failed: ${error}`);
          return [];
        }
      }
    }
    return [];
  }

  /**
   * Phase 2: Extract Q&A pairs - process each page ONCE
   *
   * Previous approach sent each page multiple times (once per section spanning that page).
   * New approach: Send each page once, let Claude identify sections, then group.
   */
  private async extractQAPairs(
    images: Buffer[],
    sections: VisionSection[]
  ): Promise<VisionQAPair[]> {
    const allPairs: VisionQAPair[] = [];

    // Build section context for Claude (list of known sections)
    const sectionList = sections.map(s => s.title);

    // Process pages in batches
    for (let i = 0; i < images.length; i += MAX_PAGES_PER_BATCH) {
      const batchImages = images.slice(i, i + MAX_PAGES_PER_BATCH);
      const startPage = i + 1;
      const endPage = Math.min(i + MAX_PAGES_PER_BATCH, images.length);

      console.log(`    Extracting Q&A from pages ${startPage}-${endPage}...`);

      const pairs = await this.callQAExtractionForPages(batchImages, startPage, sectionList);
      allPairs.push(...pairs);
    }

    return allPairs;
  }

  /**
   * Extract Q&A pairs from a batch of pages
   * Each page is processed once, Claude assigns items to their correct sections
   */
  private async callQAExtractionForPages(
    images: Buffer[],
    startPage: number,
    knownSections: string[]
  ): Promise<VisionQAPair[]> {
    const content: any[] = [];

    // Add images with page numbers
    images.forEach((image, idx) => {
      content.push({
        type: 'text',
        text: `--- Page ${startPage + idx} ---`,
      });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: image.toString('base64'),
        },
      });
    });

    // Add extraction prompt with known sections
    const sectionsHint = knownSections.length > 0
      ? `\nKnown sections in this document:\n${knownSections.map(s => `- "${s}"`).join('\n')}\n`
      : '';

    content.push({
      type: 'text',
      text: `Extract ALL question-answer pairs from these pages.
${sectionsHint}
For EACH piece of data, provide:
- question: A COMPLETE, STANDALONE question that makes sense without context, WITHOUT numbering.
  * If a section header asks a parent question (e.g. "4.1 Do you have in Place?") and rows underneath list items (e.g. "Corporate Quality Policy", "Food Safety Manual"), COMBINE them into complete questions like "Do you have a Corporate Quality Policy in Place?" or "Do you have a Food Safety Manual in Place?"
  * If a table has a header row asking "Do you have Specifications for:" with sub-rows like "Food Safety", "Food Quality", create questions like "Do you have Specifications for Food Safety?" and "Do you have Specifications for Food Quality?"
  * Each question must be understandable on its own without needing to see the section title or surrounding context.
  * DO NOT include numbering (like "4.1.1") in the question - this is for the answer library.
- originalLabel: The EXACT text as it appears in the document INCLUDING any numbering (e.g. "4.1.1 Corporate Quality Policy" - the raw label/row text)
- answer: The filled-in value (or empty string if not answered)
- section: The section this item belongs to (use the section header text, e.g. "4.1 Do you have in Place?")
- pageNumber: Page number where this appears
- confidence: 0.0-1.0 confidence score
- type: "field" | "yesno" | "text" | "table" | "choice" | "date"
- level: "standard" | "narrative" | "product"
- topic: category like "entity_info", "quality_systems", "product_allergens", "food_safety", "traceability", etc.
- destination: "answer_library" | "company" | "product"
- entityRole: "supplier" | "customer" | "manufacturer" (only for company data)

IMPORTANT: Assign each item to its CORRECT section based on the document structure.
Items numbered 4.1.x belong to section "4.1 ...", items numbered 4.2.x belong to section "4.2 ...", etc.

Output ONLY valid JSON array:
[{
  "question": "Do you have a Corporate Quality Policy in Place?",
  "originalLabel": "4.1.1 Corporate Quality Policy",
  "answer": "Yes",
  "section": "4.1 Do you have in Place?",
  "pageNumber": 2,
  "confidence": 0.95,
  "type": "yesno",
  "level": "standard",
  "topic": "quality_systems",
  "destination": "company",
  "entityRole": "supplier"
}]`,
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.send(
          new InvokeModelCommand({
            modelId: CLAUDE_MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 16000,
              messages: [{ role: 'user', content }],
            }),
          })
        );

        const result = JSON.parse(new TextDecoder().decode(response.body));
        const responseText = result.content?.[0]?.text || '[]';
        return this.parseJsonResponse<VisionQAPair[]>(responseText, []);
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          console.log(`    Retry ${attempt + 1}/${MAX_RETRIES}...`);
          await this.sleep(RETRY_DELAYS[attempt]);
        } else {
          console.error(`    Q&A extraction failed: ${error}`);
          return [];
        }
      }
    }
    return [];
  }

  /**
   * Build indexed sections from vision Q&A pairs
   *
   * IMPORTANT: We iterate over ALL unique sections from Q&A pairs, not just
   * Phase 1 discovered sections. This ensures no items are dropped if Phase 2
   * assigns different section names than Phase 1 discovered.
   */
  private buildIndexedSections(
    visionSections: VisionSection[],
    qaPairs: VisionQAPair[],
    language: Language
  ): IndexedSection[] {
    const sections: IndexedSection[] = [];

    // Group Q&A pairs by section
    const pairsBySection = new Map<string, VisionQAPair[]>();
    for (const pair of qaPairs) {
      const sectionName = pair.section || 'Document';
      if (!pairsBySection.has(sectionName)) {
        pairsBySection.set(sectionName, []);
      }
      pairsBySection.get(sectionName)!.push(pair);
    }

    // Build a lookup map for Phase 1 section metadata
    const visionSectionMap = new Map<string, VisionSection>();
    for (const vs of visionSections) {
      visionSectionMap.set(vs.title.toLowerCase().trim(), vs);
    }

    // Process ALL sections from Q&A pairs (not just Phase 1 sections)
    // This ensures we never drop items even if section names don't match exactly
    for (const [sectionTitle, sectionPairs] of pairsBySection) {
      // Try to find matching Phase 1 section metadata (case-insensitive)
      const visionSection = visionSectionMap.get(sectionTitle.toLowerCase().trim());

      // Build items from pairs
      const items: IndexedItem[] = sectionPairs.map((pair) => {
        // Build vision evidence
        const evidence: VisionEvidence = {
          type: 'vision',
          pageNumber: pair.pageNumber,
        };

        // Determine topic (use sectionTitle since visionSection may be undefined)
        const topic = pair.topic || this.detectTopicForItem(pair.question, sectionTitle);

        // Determine destination
        let destination: ItemDestination = 'answer_library';
        if (pair.destination === 'company') {
          destination = 'company';
        } else if (pair.destination === 'product' || pair.level === 'product') {
          destination = 'product';
        }

        // Determine entity role
        let entityRole: EntityRole | undefined;
        if (pair.entityRole) {
          entityRole = pair.entityRole as EntityRole;
        }

        return {
          id: randomUUID().slice(0, 8),
          type: (pair.type || 'field') as ItemType,
          label: pair.question,
          originalLabel: pair.originalLabel,
          value: pair.answer || undefined,
          topic,
          level: (pair.level || 'standard') as ItemLevel,
          lang: language,
          destination,
          entityRole,
          pageNumber: pair.pageNumber,
          extractionSource: 'vision' as ExtractionSource,
          evidence,
        };
      });

      // Calculate row range from page numbers
      const pageNumbers = items.map((i) => i.pageNumber || 1);
      const minPage = Math.min(...(pageNumbers.length > 0 ? pageNumbers : [1]));
      const maxPage = Math.max(...(pageNumbers.length > 0 ? pageNumbers : [1]));

      // Detect section topic (use sectionTitle since visionSection may be undefined)
      const sectionTopic = this.detectSectionTopic(sectionTitle, items);

      sections.push({
        title: sectionTitle,
        topic: sectionTopic,
        rows: `${minPage}-${maxPage}`, // Using page range instead of row range
        items,
        sectionType: visionSection?.type === 'table' ? 'table_data' : 'individual_items',
      });
    }

    return sections;
  }

  /**
   * Detect topic for an item based on label and section
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
   * Detect section topic from title and items
   */
  private detectSectionTopic(sectionTitle: string, items: IndexedItem[]): string {
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
   * Detect entities from sections
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
            });
          }
        }
      }
    }

    return entities;
  }

  /**
   * Detect language from Q&A pairs
   */
  private detectLanguage(pairs: VisionQAPair[]): Language {
    const sampleText: string[] = [];
    for (const pair of pairs.slice(0, 20)) {
      if (pair.question && pair.question.length > 5) {
        sampleText.push(pair.question);
      }
      if (pair.answer && pair.answer.length > 5) {
        sampleText.push(pair.answer);
      }
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
   * Merge duplicate sections
   */
  private mergeSections(sections: VisionSection[]): VisionSection[] {
    const titleMap = new Map<string, VisionSection>();

    for (const section of sections) {
      const normalizedTitle = section.title.toLowerCase().trim();

      if (titleMap.has(normalizedTitle)) {
        const existing = titleMap.get(normalizedTitle)!;
        const allPages = new Set([...existing.pages, ...section.pages]);
        existing.pages = Array.from(allPages).sort((a, b) => a - b);
      } else {
        titleMap.set(normalizedTitle, { ...section });
      }
    }

    return Array.from(titleMap.values());
  }

  /**
   * Parse JSON from Claude response
   */
  private parseJsonResponse<T>(response: string, fallback: T): T {
    let jsonStr = response.trim();

    // Remove markdown code blocks
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    try {
      return JSON.parse(jsonStr);
    } catch {
      console.warn('    ⚠ JSON parse failed, using fallback');
      return fallback;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
