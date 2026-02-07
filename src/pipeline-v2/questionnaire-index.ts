/**
 * Questionnaire Index System
 *
 * Creates a structured index (TOC) for each questionnaire showing:
 * - What sections exist
 * - What's filled in vs empty
 * - Labels for each value type
 */

import type {
  QuestionnaireSection,
  ExtractedQuestion,
  QuestionnaireMetadata,
} from './types.js';
import type { LoadedRules } from './rules-loader.js';

// =============================================================================
// INDEX TYPES
// =============================================================================

/** Value types that can be in a questionnaire */
export type ValueType =
  | 'company_name'
  | 'address'
  | 'contact_name'
  | 'contact_email'
  | 'contact_phone'
  | 'certificate_number'
  | 'certificate_expiry'
  | 'date'
  | 'yes_no'
  | 'number'
  | 'percentage'
  | 'narrative'  // Free text descriptions - THESE go to Answer Library
  | 'list'
  | 'unknown';

/** A labeled field in the questionnaire */
export interface LabeledField {
  /** Unique ID */
  id: string;
  /** Original question text */
  questionText: string;
  /** Answer value */
  answerText: string;
  /** Cell references */
  questionCell: string;
  answerCell: string;
  /** What type of value this is */
  valueType: ValueType;
  /** Is this filled in or empty? */
  isFilled: boolean;
  /** Is this a narrative answer (reusable)? */
  isNarrative: boolean;
  /** Section this belongs to */
  sectionId: string;
  /** Topic/category */
  topic: string;
  /** Row number */
  rowNumber: number;
}

/** Section summary for TOC */
export interface SectionSummary {
  /** Section ID */
  id: string;
  /** Section title */
  title: string;
  /** Sheet name */
  sheetName: string;
  /** What topics are covered */
  topics: string[];
  /** Total fields in section */
  totalFields: number;
  /** Fields that are filled in */
  filledFields: number;
  /** Fields that are empty */
  emptyFields: number;
  /** Narrative fields (potential Answer Library) */
  narrativeFields: number;
}

/** Complete questionnaire index */
export interface QuestionnaireIndex {
  /** Source file info */
  source: {
    filename: string;
    filepath: string;
    processedAt: string;
    customer?: string;
  };
  /** Table of Contents */
  toc: SectionSummary[];
  /** All labeled fields */
  fields: LabeledField[];
  /** Summary statistics */
  summary: {
    totalSections: number;
    totalFields: number;
    filledFields: number;
    emptyFields: number;
    narrativeFields: number;
    topicsCovered: string[];
  };
}

// =============================================================================
// INDEX GENERATOR
// =============================================================================

export class QuestionnaireIndexer {
  private rules: LoadedRules;

  constructor(rules: LoadedRules) {
    this.rules = rules;
  }

  /**
   * Create a structured index for a questionnaire
   */
  createIndex(
    metadata: QuestionnaireMetadata,
    sections: QuestionnaireSection[],
    questions: ExtractedQuestion[],
    filepath: string
  ): QuestionnaireIndex {
    // Label all fields
    const fields = questions.map(q => this.labelField(q, sections));

    // Build section summaries (TOC)
    const toc = this.buildTOC(sections, fields);

    // Collect all topics
    const topicsCovered = [...new Set(fields.map(f => f.topic))].sort();

    // Calculate summary
    const filledFields = fields.filter(f => f.isFilled).length;
    const narrativeFields = fields.filter(f => f.isNarrative && f.isFilled).length;

    return {
      source: {
        filename: metadata.filename,
        filepath,
        processedAt: new Date().toISOString(),
        customer: metadata.customer,
      },
      toc,
      fields,
      summary: {
        totalSections: sections.length,
        totalFields: fields.length,
        filledFields,
        emptyFields: fields.length - filledFields,
        narrativeFields,
        topicsCovered,
      },
    };
  }

  /**
   * Label a field with its value type
   */
  private labelField(
    question: ExtractedQuestion,
    sections: QuestionnaireSection[]
  ): LabeledField {
    const answer = question.answerText.trim();
    const isFilled = answer.length > 0;
    const valueType = this.detectValueType(question.questionText, answer);
    const isNarrative = valueType === 'narrative' && isFilled;

    // Find section
    const section = sections.find(s => s.id === question.sectionId);
    const topic = this.detectTopic(question.questionText, section?.title || '');

    return {
      id: question.id,
      questionText: question.questionText,
      answerText: answer,
      questionCell: question.questionCell,
      answerCell: question.answerCell,
      valueType,
      isFilled,
      isNarrative,
      sectionId: question.sectionId,
      topic,
      rowNumber: question.rowNumber,
    };
  }

  /**
   * Detect the type of value based on question and answer
   */
  private detectValueType(question: string, answer: string): ValueType {
    const q = question.toLowerCase();
    const a = answer.toLowerCase();

    // Company/contact info patterns
    if (/company\s*name|firm|firmenname|nom.*société/i.test(q)) return 'company_name';
    if (/address|adresse|street|straße|city|stadt|postal|plz/i.test(q)) return 'address';
    if (/contact.*name|ansprechpartner|nom.*contact/i.test(q)) return 'contact_name';
    if (/email|e-mail|mail/i.test(q)) return 'contact_email';
    if (/phone|telefon|téléphone|fax/i.test(q)) return 'contact_phone';

    // Certificate patterns
    if (/certificate.*number|zertifikat.*nummer|numéro.*certificat/i.test(q)) return 'certificate_number';
    if (/valid.*until|expiry|ablauf|gültig.*bis/i.test(q)) return 'certificate_expiry';

    // Date patterns
    if (/date|datum|datum/i.test(q) || /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(a)) return 'date';

    // Yes/No patterns
    if (/^(yes|no|ja|nein|oui|non|y|n)$/i.test(a)) return 'yes_no';
    if (/yes.*no|ja.*nein|oui.*non/i.test(q)) return 'yes_no';

    // Number/percentage patterns
    if (/^\d+([.,]\d+)?%$/.test(a)) return 'percentage';
    if (/^\d+([.,]\d+)?$/.test(a) && a.length < 10) return 'number';

    // List patterns (comma separated, multiple lines)
    if (a.includes(',') && a.split(',').length > 2) return 'list';
    if (a.includes('\n')) return 'list';

    // Narrative = longer text (>50 chars) that's not structured
    if (a.length > 50) return 'narrative';

    return 'unknown';
  }

  /**
   * Detect topic based on question and section
   */
  private detectTopic(question: string, sectionTitle: string): string {
    const combined = `${sectionTitle} ${question}`.toLowerCase();

    // Check against rules topics
    for (const topic of this.rules.config.topics) {
      // Check keywords
      for (const keyword of topic.keywords) {
        if (combined.includes(keyword.toLowerCase())) {
          return topic.name;
        }
      }
    }

    // Fallback based on common patterns
    if (/company|firm|contact|address/i.test(combined)) return 'Company Information';
    if (/allerg/i.test(combined)) return 'Allergens';
    if (/certif|iso|brc|ifs|fssc/i.test(combined)) return 'Certifications';
    if (/sustain|environment|co2|carbon/i.test(combined)) return 'Sustainability';
    if (/quality|haccp/i.test(combined)) return 'Quality Systems';
    if (/product|ingredi|composition/i.test(combined)) return 'Product Information';

    return 'Other';
  }

  /**
   * Build Table of Contents from sections and fields
   */
  private buildTOC(
    sections: QuestionnaireSection[],
    fields: LabeledField[]
  ): SectionSummary[] {
    return sections.map(section => {
      const sectionFields = fields.filter(f => f.sectionId === section.id);
      const topics = [...new Set(sectionFields.map(f => f.topic))];
      const filledFields = sectionFields.filter(f => f.isFilled).length;
      const narrativeFields = sectionFields.filter(f => f.isNarrative).length;

      return {
        id: section.id,
        title: section.title,
        sheetName: section.sheetName,
        topics,
        totalFields: sectionFields.length,
        filledFields,
        emptyFields: sectionFields.length - filledFields,
        narrativeFields,
      };
    });
  }
}

/**
 * Check if a field should go to Answer Library (narrative + reusable)
 */
export function isAnswerLibraryCandidate(field: LabeledField): boolean {
  if (!field.isFilled || !field.isNarrative) return false;

  // Check if topic is reusable based on rules
  const reusableTopics = [
    'Quality Systems',
    'Food Safety',
    'Sustainability',
    'Ethical / Social',
    'Food Fraud',
    'Food Defense',
  ];

  return reusableTopics.some(t =>
    field.topic.toLowerCase().includes(t.toLowerCase())
  );
}
