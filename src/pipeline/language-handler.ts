/**
 * Language handler for the questionnaire extraction pipeline.
 *
 * Handles:
 * - Bilingual question detection and splitting (DE/EN)
 * - Answer language splitting
 * - Translation via Claude API
 * - Language-neutral data detection
 */

/** Result of splitting a text into DE and EN */
export interface LanguageSplit {
  de: string;
  en: string;
  wasTranslated: boolean;
  sourceLanguage?: string;
}

/** Common bilingual answer patterns */
const BILINGUAL_ANSWER_PATTERNS: Array<{ pattern: RegExp; de: string; en: string }> = [
  { pattern: /^ja[\s-]+yes$/i, de: 'ja', en: 'yes' },
  { pattern: /^nein[\s-]+no$/i, de: 'nein', en: 'no' },
  { pattern: /^ja\s*\/\s*yes$/i, de: 'ja', en: 'yes' },
  { pattern: /^nein\s*\/\s*no$/i, de: 'nein', en: 'no' },
  { pattern: /^ja$/i, de: 'ja', en: 'yes' },
  { pattern: /^nein$/i, de: 'nein', en: 'no' },
  { pattern: /^yes$/i, de: 'ja', en: 'yes' },
  { pattern: /^no$/i, de: 'nein', en: 'no' },
  { pattern: /^n\/a$/i, de: 'n/a', en: 'n/a' },
  { pattern: /^nicht zutreffend$/i, de: 'nicht zutreffend', en: 'not applicable' },
  { pattern: /^not applicable$/i, de: 'nicht zutreffend', en: 'not applicable' },
  { pattern: /^siehe anlage[\s-]+see attachment$/i, de: 'siehe Anlage', en: 'see attachment' },
  { pattern: /^siehe anhang[\s-]+see appendix$/i, de: 'siehe Anhang', en: 'see appendix' },
];

/** Patterns indicating language-neutral data */
const LANGUAGE_NEUTRAL_PATTERNS: RegExp[] = [
  // Email
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  // Phone/fax (digits, spaces, +, -, parentheses)
  /^[+\d\s\-().\/]{5,}$/,
  // URL
  /^(https?:\/\/|www\.)/i,
  // Pure numbers (possibly with units)
  /^\d[\d.,\s]*(%|kg|t|m|l|€|\$|°C)?$/i,
  // Dates in common formats
  /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/,
  // ISO dates
  /^\d{4}-\d{2}-\d{2}/,
  // Registration/ID numbers (alphanumeric with dashes)
  /^[A-Z]{0,3}\d{2,}[-/]?\d*$/i,
  // IBAN
  /^[A-Z]{2}\d{2}\s?[\dA-Z\s]{10,30}$/i,
  // BIC/SWIFT
  /^[A-Z]{4}[A-Z]{2}\d{2}([A-Z\d]{3})?$/i,
  // Certification numbers
  /^(IFS|BRC|FSSC|ISO|DE|NL|FR|AT|CH)\s*[-/]?\s*\d/i,
];

/** Common German words for language detection */
const GERMAN_INDICATORS = [
  'und', 'die', 'der', 'das', 'ist', 'ein', 'eine', 'für', 'mit', 'auf',
  'des', 'den', 'dem', 'nicht', 'sich', 'von', 'werden', 'wird', 'sind',
  'bei', 'nach', 'über', 'aus', 'oder', 'auch', 'zum', 'zur', 'wie',
  'ja', 'nein', 'bitte', 'angeben', 'gemäß', 'bzw', 'ggf', 'siehe',
  'zertifiziert', 'verfügbar', 'vorhanden', 'durchgeführt',
];

/** Common English words for language detection */
const ENGLISH_INDICATORS = [
  'the', 'and', 'is', 'are', 'for', 'with', 'that', 'this', 'from',
  'not', 'have', 'has', 'been', 'was', 'were', 'will', 'can', 'shall',
  'should', 'would', 'may', 'must', 'yes', 'please', 'provide', 'specify',
  'certified', 'available', 'applicable', 'conducted',
];

export class LanguageHandler {
  private anthropicApiKey?: string;
  private translationCache: Map<string, string> = new Map();

  constructor(anthropicApiKey?: string) {
    this.anthropicApiKey = anthropicApiKey;
  }

  /** Split a question text into DE and EN */
  splitQuestion(text: string): LanguageSplit {
    if (!text.trim()) {
      return { de: '', en: '', wasTranslated: false };
    }

    // Check for slash separator: "German text / English text"
    const slashParts = text.split(/\s+\/\s+/);
    if (slashParts.length === 2) {
      const lang1 = this.detectLanguage(slashParts[0]);
      const lang2 = this.detectLanguage(slashParts[1]);

      if (lang1 === 'de' && lang2 === 'en') {
        return { de: slashParts[0].trim(), en: slashParts[1].trim(), wasTranslated: false };
      }
      if (lang1 === 'en' && lang2 === 'de') {
        return { de: slashParts[1].trim(), en: slashParts[0].trim(), wasTranslated: false };
      }
    }

    // Check for line break separator
    const lineParts = text.split('\n').map(l => l.trim()).filter(l => l);
    if (lineParts.length === 2) {
      const lang1 = this.detectLanguage(lineParts[0]);
      const lang2 = this.detectLanguage(lineParts[1]);

      if (lang1 === 'de' && lang2 === 'en') {
        return { de: lineParts[0], en: lineParts[1], wasTranslated: false };
      }
      if (lang1 === 'en' && lang2 === 'de') {
        return { de: lineParts[1], en: lineParts[0], wasTranslated: false };
      }
    }

    // Check for parenthetical: "German (English)" or "English (German)"
    const parenMatch = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (parenMatch) {
      const main = parenMatch[1].trim();
      const paren = parenMatch[2].trim();
      const mainLang = this.detectLanguage(main);
      const parenLang = this.detectLanguage(paren);

      if (mainLang === 'de' && parenLang === 'en') {
        return { de: main, en: paren, wasTranslated: false };
      }
      if (mainLang === 'en' && parenLang === 'de') {
        return { de: paren, en: main, wasTranslated: false };
      }
    }

    // Single language — detect and note that translation is needed
    const lang = this.detectLanguage(text);
    if (lang === 'de') {
      return { de: text.trim(), en: text.trim(), wasTranslated: false, sourceLanguage: 'de' };
    }
    if (lang === 'en') {
      return { de: text.trim(), en: text.trim(), wasTranslated: false, sourceLanguage: 'en' };
    }

    // Unknown language
    return { de: text.trim(), en: text.trim(), wasTranslated: false, sourceLanguage: 'unknown' };
  }

  /** Split an answer text into DE and EN */
  splitAnswer(text: string): LanguageSplit {
    if (!text.trim()) {
      return { de: '', en: '', wasTranslated: false };
    }

    // Check for bilingual answer patterns
    for (const pattern of BILINGUAL_ANSWER_PATTERNS) {
      if (pattern.pattern.test(text.trim())) {
        return { de: pattern.de, en: pattern.en, wasTranslated: false };
      }
    }

    // Check if language-neutral
    if (this.isLanguageNeutral(text)) {
      return { de: text.trim(), en: text.trim(), wasTranslated: false };
    }

    // Check for slash separator in answer
    const slashParts = text.split(/\s*[-\/]\s*/);
    if (slashParts.length === 2) {
      const first = slashParts[0].trim();
      const second = slashParts[1].trim();

      // Short bilingual answers like "ja-yes"
      if (first.length < 20 && second.length < 20) {
        const lang1 = this.detectLanguage(first);
        const lang2 = this.detectLanguage(second);

        if (lang1 === 'de' && lang2 === 'en') {
          return { de: first, en: second, wasTranslated: false };
        }
        if (lang1 === 'en' && lang2 === 'de') {
          return { de: second, en: first, wasTranslated: false };
        }
      }
    }

    // Single language answer — mark for translation
    const lang = this.detectLanguage(text);
    if (lang === 'de') {
      return { de: text.trim(), en: text.trim(), wasTranslated: false, sourceLanguage: 'de' };
    }
    if (lang === 'en') {
      return { de: text.trim(), en: text.trim(), wasTranslated: false, sourceLanguage: 'en' };
    }

    return { de: text.trim(), en: text.trim(), wasTranslated: false, sourceLanguage: 'unknown' };
  }

  /** Translate texts using Claude API (batch) */
  async translateBatch(
    items: Array<{ text: string; fromLang: string; toLang: string; index: number }>
  ): Promise<Map<number, string>> {
    const translations = new Map<number, string>();

    if (!this.anthropicApiKey || items.length === 0) {
      return translations;
    }

    // Check cache first
    const uncached: typeof items = [];
    for (const item of items) {
      const cacheKey = `${item.fromLang}:${item.toLang}:${item.text}`;
      const cached = this.translationCache.get(cacheKey);
      if (cached) {
        translations.set(item.index, cached);
      } else {
        uncached.push(item);
      }
    }

    if (uncached.length === 0) {
      return translations;
    }

    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: this.anthropicApiKey });

      // Batch in groups of 50 to stay within token limits
      const batchSize = 50;
      for (let i = 0; i < uncached.length; i += batchSize) {
        const batch = uncached.slice(i, i + batchSize);

        const prompt = batch.map((item, idx) => (
          `${idx + 1}. [${item.fromLang}→${item.toLang}] "${item.text}"`
        )).join('\n');

        const response = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: `Translate each text faithfully. Preserve exact meaning — do not summarise or paraphrase. For technical/industry terms, use standard translations. Respond with a JSON array of objects with "index" (1-based) and "translation" fields.

${prompt}`,
          }],
        });

        const textContent = response.content.find(c => c.type === 'text');
        if (textContent && textContent.type === 'text') {
          const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const results: Array<{ index: number; translation: string }> = JSON.parse(jsonMatch[0]);

            for (const r of results) {
              const originalItem = batch[r.index - 1];
              if (originalItem) {
                translations.set(originalItem.index, r.translation);
                const cacheKey = `${originalItem.fromLang}:${originalItem.toLang}:${originalItem.text}`;
                this.translationCache.set(cacheKey, r.translation);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Translation API call failed: ${error instanceof Error ? error.message : error}`);
    }

    return translations;
  }

  /** Detect language of a text */
  detectLanguage(text: string): 'de' | 'en' | 'unknown' {
    if (!text.trim()) return 'unknown';

    const words = text.toLowerCase().split(/\s+/);

    let deScore = 0;
    let enScore = 0;

    for (const word of words) {
      const cleanWord = word.replace(/[^a-zäöüß]/g, '');
      if (GERMAN_INDICATORS.includes(cleanWord)) deScore++;
      if (ENGLISH_INDICATORS.includes(cleanWord)) enScore++;
    }

    // Check for German-specific characters
    if (/[äöüß]/i.test(text)) deScore += 2;

    // Check for German compound words (long words are more likely German)
    for (const word of words) {
      if (word.length > 15 && /[a-z]/i.test(word)) deScore += 1;
    }

    if (deScore > enScore && deScore >= 1) return 'de';
    if (enScore > deScore && enScore >= 1) return 'en';
    if (deScore === enScore && deScore >= 1) return 'de'; // Prefer DE when equal

    return 'unknown';
  }

  /** Check if text is language-neutral (same in any language) */
  isLanguageNeutral(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;

    for (const pattern of LANGUAGE_NEUTRAL_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }

    // Pure proper nouns (starts with capital, no common words)
    if (/^[A-Z][a-zA-Z\s&.,'-]+$/.test(trimmed) && trimmed.length < 50) {
      const words = trimmed.toLowerCase().split(/\s+/);
      const hasCommonWord = words.some(w =>
        GERMAN_INDICATORS.includes(w) || ENGLISH_INDICATORS.includes(w)
      );
      if (!hasCommonWord) return true;
    }

    return false;
  }
}
