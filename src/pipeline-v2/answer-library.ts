/**
 * Answer Library for Pipeline v2
 *
 * YAML-based storage for approved reusable answers.
 * Supports pattern matching for answer suggestions.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { randomUUID } from 'crypto';
import type {
  ApprovedAnswer,
  AnswerLibrary,
  ClassifiedQuestion,
} from './types.js';

const LIBRARY_FILENAME = 'answers.yaml';

export class AnswerLibraryManager {
  private libraryDir: string;
  private library: AnswerLibrary | null = null;

  constructor(libraryDir: string) {
    this.libraryDir = libraryDir;
  }

  /**
   * Load the answer library
   */
  async load(): Promise<AnswerLibrary> {
    if (this.library) return this.library;

    try {
      const filePath = join(this.libraryDir, LIBRARY_FILENAME);
      const content = await readFile(filePath, 'utf-8');
      this.library = parseYaml(content) as AnswerLibrary;
    } catch {
      // Initialize empty library
      this.library = {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        answers: [],
      };
    }

    return this.library;
  }

  /**
   * Save the answer library
   */
  async save(): Promise<void> {
    if (!this.library) return;

    await mkdir(this.libraryDir, { recursive: true });

    this.library.lastUpdated = new Date().toISOString();
    const content = stringifyYaml(this.library, { lineWidth: 0 });
    const filePath = join(this.libraryDir, LIBRARY_FILENAME);
    await writeFile(filePath, content, 'utf-8');
  }

  /**
   * Add an approved answer to the library
   */
  async addAnswer(
    question: ClassifiedQuestion,
    approvedBy: string,
    reviewNotes?: string
  ): Promise<ApprovedAnswer> {
    await this.load();

    // Create question pattern from the question text
    const pattern = this.createPattern(question.questionText);

    const answer: ApprovedAnswer = {
      id: randomUUID(),
      topicId: question.classification.topicId,
      questionPatterns: [pattern],
      exampleQuestions: [question.questionText],
      answerDE: question.answerDE || question.answerText,
      answerEN: question.answerEN || question.answerText,
      sourceFile: question.questionCell.split('!')[0] || 'unknown',
      approvedBy,
      approvedAt: new Date().toISOString(),
      reuseCount: 0,
      reviewNotes,
    };

    this.library!.answers.push(answer);
    await this.save();

    return answer;
  }

  /**
   * Find matching answers for a question
   */
  async findMatches(
    questionText: string,
    topicId?: string
  ): Promise<Array<{ answer: ApprovedAnswer; similarity: number }>> {
    await this.load();

    const matches: Array<{ answer: ApprovedAnswer; similarity: number }> = [];
    const normalizedQuestion = this.normalize(questionText);

    for (const answer of this.library!.answers) {
      // Filter by topic if specified
      if (topicId && answer.topicId !== topicId) continue;

      // Check pattern matches
      for (const pattern of answer.questionPatterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(normalizedQuestion)) {
            matches.push({ answer, similarity: 0.9 });
            break;
          }
        } catch {
          // Invalid regex, skip
        }
      }

      // Check similarity to example questions
      for (const example of answer.exampleQuestions) {
        const similarity = this.calculateSimilarity(normalizedQuestion, this.normalize(example));
        if (similarity > 0.7) {
          matches.push({ answer, similarity });
          break;
        }
      }
    }

    // Sort by similarity descending
    matches.sort((a, b) => b.similarity - a.similarity);

    // Remove duplicates (keep highest similarity)
    const seen = new Set<string>();
    return matches.filter(m => {
      if (seen.has(m.answer.id)) return false;
      seen.add(m.answer.id);
      return true;
    });
  }

  /**
   * Increment reuse count for an answer
   */
  async markUsed(answerId: string): Promise<void> {
    await this.load();

    const answer = this.library!.answers.find(a => a.id === answerId);
    if (answer) {
      answer.reuseCount++;
      answer.lastUsedAt = new Date().toISOString();
      await this.save();
    }
  }

  /**
   * Add an example question to an existing answer
   */
  async addExample(answerId: string, questionText: string): Promise<void> {
    await this.load();

    const answer = this.library!.answers.find(a => a.id === answerId);
    if (answer) {
      if (!answer.exampleQuestions.includes(questionText)) {
        answer.exampleQuestions.push(questionText);
      }

      // Also add a pattern if significantly different
      const pattern = this.createPattern(questionText);
      if (!answer.questionPatterns.includes(pattern)) {
        answer.questionPatterns.push(pattern);
      }

      await this.save();
    }
  }

  /**
   * Get statistics about the library
   */
  async getStats(): Promise<{
    totalAnswers: number;
    byTopic: Record<string, number>;
    mostReused: ApprovedAnswer[];
  }> {
    await this.load();

    const byTopic: Record<string, number> = {};
    for (const answer of this.library!.answers) {
      byTopic[answer.topicId] = (byTopic[answer.topicId] || 0) + 1;
    }

    const mostReused = [...this.library!.answers]
      .sort((a, b) => b.reuseCount - a.reuseCount)
      .slice(0, 10);

    return {
      totalAnswers: this.library!.answers.length,
      byTopic,
      mostReused,
    };
  }

  /**
   * Create a regex pattern from question text
   */
  private createPattern(questionText: string): string {
    // Extract key terms and create a flexible pattern
    const normalized = this.normalize(questionText);

    // Remove common question words
    const stopWords = new Set([
      'please', 'indicate', 'provide', 'describe', 'explain',
      'is', 'are', 'do', 'does', 'have', 'has', 'the', 'a', 'an',
      'your', 'you', 'we', 'our', 'if', 'yes', 'no',
      'bitte', 'angeben', 'beschreiben', 'ihr', 'ihre',
    ]);

    const words = normalized.split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    // Create pattern that matches any order of key terms
    if (words.length === 0) return normalized;

    // Use the most distinctive words (longer words)
    const keyWords = words
      .sort((a, b) => b.length - a.length)
      .slice(0, 4);

    // Create pattern: must contain all key words
    return keyWords.map(w => `(?=.*${this.escapeRegex(w)})`).join('') + '.*';
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
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Calculate text similarity (Jaccard index on word sets)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\s+/));
    const words2 = new Set(text2.split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }
}
