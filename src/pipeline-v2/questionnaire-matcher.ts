/**
 * Questionnaire Matcher
 *
 * Matches questions in a new questionnaire to existing sources.
 * Used to suggest answers from previously filled questionnaires.
 */

import type { ExtractedQuestion, QuestionnaireSection } from './types.js';
import type { QuestionnaireIndex, LabeledField } from './questionnaire-index.js';
import { SourceStorage } from './source-storage.js';
import { AnswerLibraryManager } from './answer-library.js';

/** Match result for a question */
export interface QuestionMatch {
  /** The question being matched */
  question: ExtractedQuestion;
  /** Matches from source questionnaires */
  sourceMatches: Array<{
    sourceFile: string;
    field: LabeledField;
    similarity: number;
  }>;
  /** Matches from Answer Library */
  libraryMatches: Array<{
    answerId: string;
    answerText: string;
    similarity: number;
  }>;
  /** Best overall match */
  bestMatch?: {
    source: 'questionnaire' | 'library';
    answerText: string;
    similarity: number;
    sourceFile?: string;
  };
}

/** Matcher configuration */
export interface MatcherConfig {
  /** Minimum similarity score (0-1) */
  minSimilarity?: number;
  /** Maximum matches to return per question */
  maxMatches?: number;
  /** Prefer library answers over source matches */
  preferLibrary?: boolean;
}

const DEFAULT_CONFIG: MatcherConfig = {
  minSimilarity: 0.6,
  maxMatches: 5,
  preferLibrary: true,
};

export class QuestionnaireMatcher {
  private sourceStorage: SourceStorage;
  private answerLibrary: AnswerLibraryManager;
  private config: MatcherConfig;
  private sources: QuestionnaireIndex[] = [];

  constructor(
    sourcesDir: string,
    answerLibraryDir: string,
    config: Partial<MatcherConfig> = {}
  ) {
    this.sourceStorage = new SourceStorage(sourcesDir);
    this.answerLibrary = new AnswerLibraryManager(answerLibraryDir);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Load sources for matching
   */
  async init(): Promise<void> {
    this.sources = await this.sourceStorage.loadAll();
    console.log(`  Loaded ${this.sources.length} source questionnaires`);
  }

  /**
   * Match all questions in a questionnaire
   */
  async matchAll(
    questions: ExtractedQuestion[],
    sections: QuestionnaireSection[]
  ): Promise<QuestionMatch[]> {
    if (this.sources.length === 0) {
      await this.init();
    }

    const matches: QuestionMatch[] = [];

    for (const question of questions) {
      const match = await this.matchQuestion(question, sections);
      matches.push(match);
    }

    return matches;
  }

  /**
   * Match a single question
   */
  async matchQuestion(
    question: ExtractedQuestion,
    sections: QuestionnaireSection[]
  ): Promise<QuestionMatch> {
    const section = sections.find(s => s.id === question.sectionId);
    const sectionTitle = section?.title || '';

    // Find matches in source questionnaires
    const sourceMatches = this.findSourceMatches(question, sectionTitle);

    // Find matches in Answer Library
    const libraryResults = await this.answerLibrary.findMatches(
      question.questionText
    );
    const libraryMatches = libraryResults
      .filter(r => r.similarity >= this.config.minSimilarity!)
      .slice(0, this.config.maxMatches!)
      .map(r => ({
        answerId: r.answer.id,
        answerText: r.answer.answerDE || r.answer.answerEN,
        similarity: r.similarity,
      }));

    // Determine best match
    let bestMatch: QuestionMatch['bestMatch'];

    if (this.config.preferLibrary && libraryMatches.length > 0) {
      bestMatch = {
        source: 'library',
        answerText: libraryMatches[0].answerText,
        similarity: libraryMatches[0].similarity,
      };
    } else if (sourceMatches.length > 0) {
      bestMatch = {
        source: 'questionnaire',
        answerText: sourceMatches[0].field.answerText,
        similarity: sourceMatches[0].similarity,
        sourceFile: sourceMatches[0].sourceFile,
      };
    } else if (libraryMatches.length > 0) {
      bestMatch = {
        source: 'library',
        answerText: libraryMatches[0].answerText,
        similarity: libraryMatches[0].similarity,
      };
    }

    return {
      question,
      sourceMatches,
      libraryMatches,
      bestMatch,
    };
  }

  /**
   * Find matches in source questionnaires
   */
  private findSourceMatches(
    question: ExtractedQuestion,
    sectionTitle: string
  ): Array<{ sourceFile: string; field: LabeledField; similarity: number }> {
    const matches: Array<{
      sourceFile: string;
      field: LabeledField;
      similarity: number;
    }> = [];

    const normalizedQuestion = this.normalize(question.questionText);
    const normalizedSection = this.normalize(sectionTitle);

    for (const source of this.sources) {
      for (const field of source.fields) {
        if (!field.isFilled) continue;

        // Calculate similarity
        const questionSim = this.calculateSimilarity(
          normalizedQuestion,
          this.normalize(field.questionText)
        );

        // Boost if section titles match
        const sectionSim = this.calculateSimilarity(
          normalizedSection,
          this.normalize(field.topic)
        );

        const similarity = questionSim * 0.8 + sectionSim * 0.2;

        if (similarity >= this.config.minSimilarity!) {
          matches.push({
            sourceFile: source.source.filename,
            field,
            similarity,
          });
        }
      }
    }

    // Sort by similarity and limit
    return matches
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.config.maxMatches!);
  }

  /**
   * Get fill suggestions for a questionnaire
   */
  async getSuggestions(
    questions: ExtractedQuestion[],
    sections: QuestionnaireSection[]
  ): Promise<{
    filled: number;
    suggested: number;
    noMatch: number;
    suggestions: Array<{
      question: string;
      cell: string;
      suggestedAnswer: string;
      source: string;
      confidence: number;
    }>;
  }> {
    const matches = await this.matchAll(questions, sections);

    let filled = 0;
    let suggested = 0;
    let noMatch = 0;
    const suggestions: Array<{
      question: string;
      cell: string;
      suggestedAnswer: string;
      source: string;
      confidence: number;
    }> = [];

    for (const match of matches) {
      if (match.question.answerText.trim()) {
        filled++;
        continue;
      }

      if (match.bestMatch) {
        suggested++;
        suggestions.push({
          question: match.question.questionText.substring(0, 80),
          cell: match.question.answerCell,
          suggestedAnswer: match.bestMatch.answerText.substring(0, 100),
          source: match.bestMatch.source === 'library'
            ? 'Answer Library'
            : match.bestMatch.sourceFile || 'Unknown',
          confidence: Math.round(match.bestMatch.similarity * 100),
        });
      } else {
        noMatch++;
      }
    }

    return { filled, suggested, noMatch, suggestions };
  }

  /**
   * Normalize text for comparison
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate text similarity (Jaccard + common subsequence)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }
}
