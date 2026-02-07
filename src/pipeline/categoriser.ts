/**
 * Categoriser module for the questionnaire extraction pipeline.
 *
 * Assigns each Q&A pair to one of three categories:
 * - EntityDB: WHO/WHERE/HOW TO REACH
 * - Procedures: WHAT THEY DO/COMPLY WITH/HAVE CERTIFIED
 * - Product: SPECIFIC TO A PRODUCT/SKU/INGREDIENT
 *
 * Uses rule-based matching first, then Claude API for ambiguous cases.
 */

import type { Category, RawQAPair, ConfidenceLevel } from './types.js';

/** Result of categorising a single Q&A pair */
export interface CategorisationResult {
  category: Category;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  flagReason?: string;
  suggestedAction?: string;
}

/** Keyword patterns for rule-based categorisation */
const ENTITY_DB_PATTERNS: RegExp[] = [
  // Company identity
  /\b(company\s*name|firmenname|firmierung|legal\s*form|rechtsform|trade\s*name|handelsname)\b/i,
  /\b(parent\s*company|muttergesellschaft|group\s*name|konzern)\b/i,
  // Location / address
  /\b(address|adresse|anschrift|street|stra[sß]e|city|stadt|ort|zip|plz|postal\s*code|country|land|gps|standort|site\s*address)\b/i,
  // Contact details
  /\b(phone|telefon|fax|email|e-mail|website|web|url|linkedin)\b/i,
  // Contact persons
  /\b(contact\s*person|ansprechpartner|managing\s*director|gesch[äa]ftsf[üu]hr|quality\s*manager|crisis\s*contact)\b/i,
  // Registration numbers
  /\b(vat\s*(id|number|nr)|ust-?id|tax\s*number|steuernummer|duns|coid|sedex\s*id|eu\s*approval|zulassungsnummer)\b/i,
  // Financial identifiers
  /\b(iban|bic|swift|bank\s*name|bankverbindung)\b/i,
  // Membership IDs
  /\b(ecovadis|smeta\s*registration|customer\s*portal|portal\s*id)\b/i,
  // Organisational metadata
  /\b(number\s*of\s*employees|mitarbeiterzahl|anzahl\s*mitarbeiter|founding\s*year|gr[üu]ndungsjahr|ownership)\b/i,
];

const PROCEDURES_PATTERNS: RegExp[] = [
  // Certifications
  /\b(ifs|brc|fssc\s*22000|iso\s*\d{4,5}|haccp|halal|kosher|bio|organic|demeter)\b/i,
  /\b(certif|zertifik|accredit|akkreditier)\w*/i,
  /\b(certificate\s*number|zertifikatsnummer|expiry|g[üu]ltig|scope|geltungsbereich|audit\w*\s*body)\b/i,
  // Food safety
  /\b(food\s*safety|lebensmittelsicherheit|allergen\s*management|pest\s*control|sch[äa]dlingsbek[äa]mpfung)\b/i,
  /\b(glass\s*policy|glass\s*and\s*brittle|fremdk[öo]rper|foreign\s*body)\b/i,
  // Quality management
  /\b(complaint\s*handling|reklamation|recall\s*procedure|r[üu]ckruf|traceability|r[üu]ckverfolgbarkeit)\b/i,
  /\b(quality\s*management|qualit[äa]tsmanagement|qm\s*system)\b/i,
  // Sustainability
  /\b(carbon\s*footprint\s*policy|sustainability|nachhaltigkeit|water\s*usage|waste\s*management)\b/i,
  /\b(environmental\s*policy|umweltpolitik|energy\s*management|energiemanagement)\b/i,
  // Social compliance
  /\b(code\s*of\s*conduct|verhaltenskodex|child\s*labour|kinderarbeit|anti-?corruption|korruption)\b/i,
  /\b(human\s*rights|menschenrechte|social\s*compliance|soziale\s*verantwortung)\b/i,
  // Audit consent
  /\b(audit\s*consent|unannounced\s*audit|unangemeldete\s*audit|agree\s*to\s*audit)\b/i,
  // Supplier management
  /\b(supplier\s*code|lieferanten\s*code|evaluate\s*suppliers|lieferantenbewertung)\b/i,
  // Insurance
  /\b(product\s*liability\s*insurance|produkthaftpflicht|betriebshaftpflicht|insurance\s*cover)\b/i,
  // Corporate structure (as procedure)
  /\b(organisational\s*chart|organigramm|management\s*review)\b/i,
];

const PRODUCT_PATTERNS: RegExp[] = [
  // Product identity
  /\b(product\s*name|produktname|sku|article\s*number|artikelnummer|ean|gtin)\b/i,
  // Product specifications
  /\b(shelf\s*life|mindesthaltbarkeit|mhd|storage\s*condition|lagerbedingung|weight|gewicht)\b/i,
  // Ingredients
  /\b(ingredient|zutat|allergen\s*declaration|allergenkennzeichnung|recipe|rezept)\b/i,
  /\b(composition|zusammensetzung)\b/i,
  // Origin per product
  /\b(country\s*of\s*origin|herkunftsland|origin\s*of)\b/i,
  // Processing
  /\b(pasteuris|heating\s*temperature|erhitzungstemperatur|processing\s*method|verarbeitungsmethode)\b/i,
  // Nutritional
  /\b(nutritional\s*value|n[äa]hrwert|energy|energie|fat|fett|protein|eiwei[sß]|carbohydrate|kohlenhydrat)\b/i,
  // Residue testing
  /\b(pesticide\s*residue|r[üu]ckstand|heavy\s*metal|schwermetall|mycotoxin|mykotoxin|contaminant)\b/i,
  // Product-specific PCF
  /\b(pcf\s*per\s*product|product\s*carbon\s*footprint|co2\s*per\s*kg)\b/i,
  // Labelling
  /\b(label\s*claim|kennzeichnung|gmo\s*status|gmo-?free)\b/i,
  // Packaging
  /\b(packaging\s*material|verpackungsmaterial|recycling\s*info)\b/i,
  // Specific product indicators
  /\b(per\s*product|per\s*sku|product\s*specific|produktspezifisch)\b/i,
];

export class Categoriser {
  private anthropicApiKey?: string;

  constructor(anthropicApiKey?: string) {
    this.anthropicApiKey = anthropicApiKey;
  }

  /** Categorise a single Q&A pair using rules */
  categorise(pair: RawQAPair): CategorisationResult {
    const text = `${pair.questionText} ${pair.answerText}`.toLowerCase();

    const entityScore = this.matchPatterns(text, ENTITY_DB_PATTERNS);
    const procedureScore = this.matchPatterns(text, PROCEDURES_PATTERNS);
    const productScore = this.matchPatterns(text, PRODUCT_PATTERNS);

    // Apply decision tree from RULES.md
    let category: Category;
    let confidence: number;
    let flagReason: string | undefined;
    let suggestedAction: string | undefined;

    // Check for ambiguity (matches multiple categories)
    const scores = [
      { cat: 'EntityDB' as Category, score: entityScore },
      { cat: 'Procedures' as Category, score: procedureScore },
      { cat: 'Product' as Category, score: productScore },
    ].sort((a, b) => b.score - a.score);

    const topScore = scores[0].score;
    const secondScore = scores[1].score;

    if (topScore === 0) {
      // No pattern matches — use context-based heuristics
      category = this.categoriseByContext(pair);
      confidence = 0.30;
      flagReason = 'No keyword pattern matches found';
      suggestedAction = 'Review the question text and assign the correct category';
    } else if (topScore > 0 && secondScore > 0 && (topScore - secondScore) <= 1) {
      // Close scores — ambiguous
      category = scores[0].cat;
      confidence = 0.45;
      flagReason = `Ambiguous: could be ${scores[0].cat} or ${scores[1].cat}`;
      suggestedAction = `Verify whether this belongs to ${scores[0].cat} or ${scores[1].cat}`;
    } else if (topScore >= 3) {
      // Very strong match
      category = scores[0].cat;
      confidence = 0.95;
    } else if (topScore >= 2) {
      // Strong match
      category = scores[0].cat;
      confidence = 0.85;
    } else {
      // Single match
      category = scores[0].cat;
      confidence = 0.70;
    }

    // Apply modifiers
    if (pair.isConditional) {
      confidence -= 0.10;
      if (!flagReason) {
        flagReason = 'Conditional question detected';
        suggestedAction = `Verify categorisation; condition: ${pair.conditionText || 'unknown'}`;
      }
    }

    if (pair.questionText.trim().length < 10) {
      confidence -= 0.15;
      if (!flagReason) {
        flagReason = 'Very short question text';
        suggestedAction = 'Review context to confirm categorisation';
      }
    }

    if (!pair.answerText.trim()) {
      confidence -= 0.05;
    }

    // "Country of origin" disambiguation
    if (/country\s*of\s*origin|herkunftsland/i.test(pair.questionText)) {
      if (pair.sectionHeader && /product|produkt/i.test(pair.sectionHeader)) {
        category = 'Product';
        confidence = Math.max(confidence, 0.80);
      } else if (pair.sectionHeader && /company|unternehmen|general|allgemein/i.test(pair.sectionHeader)) {
        category = 'EntityDB';
        confidence = Math.max(confidence, 0.80);
      } else {
        // Ambiguous — flag for review
        confidence = 0.40;
        flagReason = 'Country of origin: could be Entity (company) or Product (product-specific)';
        suggestedAction = 'Check if this refers to company location or product origin';
      }
    }

    confidence = Math.max(0, Math.min(1, confidence));
    const confidenceLevel = this.toConfidenceLevel(confidence);

    return { category, confidence, confidenceLevel, flagReason, suggestedAction };
  }

  /** Categorise a batch of Q&A pairs */
  categoriseBatch(pairs: RawQAPair[]): CategorisationResult[] {
    return pairs.map(pair => this.categorise(pair));
  }

  /** Categorise using Claude API for ambiguous cases */
  async categoriseWithClaude(pairs: RawQAPair[]): Promise<CategorisationResult[]> {
    if (!this.anthropicApiKey) {
      return this.categoriseBatch(pairs);
    }

    // First pass: rule-based
    const results = this.categoriseBatch(pairs);

    // Find low-confidence items that need API help
    const lowConfItems = results
      .map((r, i) => ({ result: r, index: i, pair: pairs[i] }))
      .filter(item => item.result.confidenceLevel === 'LOW');

    if (lowConfItems.length === 0) {
      return results;
    }

    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: this.anthropicApiKey });

      // Batch API call for low-confidence items
      const questionsForClaude = lowConfItems.map(item => ({
        index: item.index,
        question: item.pair.questionText,
        answer: item.pair.answerText,
        section: item.pair.sectionHeader || 'unknown',
      }));

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Categorise each Q&A pair into exactly one category. The categories are:

1. **EntityDB** — Identifies WHO/WHERE the entity is or HOW to reach them (company name, address, contacts, registration numbers, financial identifiers)
2. **Procedures** — Describes WHAT the entity does, complies with, or has certified (certifications, food safety, quality management, sustainability, social compliance)
3. **Product** — Specific to a PRODUCT/SKU/INGREDIENT (product names, specifications, ingredients, processing details, nutritional info)

Decision tree: Is it about a specific product? → Product. Does it identify who/where? → EntityDB. Otherwise → Procedures.

Respond with a JSON array of objects with "index" and "category" fields.

Q&A pairs:
${JSON.stringify(questionsForClaude, null, 2)}`,
        }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const claudeResults: Array<{ index: number; category: Category }> = JSON.parse(jsonMatch[0]);

          for (const cr of claudeResults) {
            if (cr.index !== undefined && cr.category) {
              const validCategories: Category[] = ['EntityDB', 'Procedures', 'Product'];
              if (validCategories.includes(cr.category)) {
                results[cr.index].category = cr.category;
                results[cr.index].confidence = Math.max(results[cr.index].confidence, 0.65);
                results[cr.index].confidenceLevel = this.toConfidenceLevel(results[cr.index].confidence);
                results[cr.index].flagReason = `${results[cr.index].flagReason || ''} [Claude API assisted]`.trim();
              }
            }
          }
        }
      }
    } catch (error) {
      // API failure is non-fatal — keep rule-based results
      console.error(`Claude API categorisation failed: ${error instanceof Error ? error.message : error}`);
    }

    return results;
  }

  /** Count pattern matches */
  private matchPatterns(text: string, patterns: RegExp[]): number {
    let count = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        count++;
      }
    }
    return count;
  }

  /** Context-based categorisation when no keyword matches */
  private categoriseByContext(pair: RawQAPair): Category {
    const section = (pair.sectionHeader || '').toLowerCase();

    if (/general|allgemein|company|unternehmen|contact|kontakt|address|adresse/i.test(section)) {
      return 'EntityDB';
    }
    if (/quality|qualit|certif|zertifik|safety|sicherheit|sustainability|nachhaltigkeit|compliance/i.test(section)) {
      return 'Procedures';
    }
    if (/product|produkt|ingredient|zutat|specification|spezifikation/i.test(section)) {
      return 'Product';
    }

    // Default to Procedures (most common bucket)
    return 'Procedures';
  }

  /** Convert numeric confidence to level */
  private toConfidenceLevel(confidence: number): ConfidenceLevel {
    if (confidence >= 0.80) return 'HIGH';
    if (confidence >= 0.50) return 'MEDIUM';
    return 'LOW';
  }
}
