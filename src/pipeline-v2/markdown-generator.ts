/**
 * Markdown Output Generator for Pipeline v2
 *
 * Generates human-readable Markdown files for review,
 * grouped by destination (Answer Library, Entity DB, Product Spec, Log).
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type {
  ExtractionResult,
  ClassifiedQuestion,
  QuestionnaireSection,
  ExtractionSummary,
  Destination,
} from './types.js';

export class MarkdownGenerator {
  /**
   * Generate review Markdown file
   */
  async generate(
    result: ExtractionResult,
    outputDir: string
  ): Promise<string> {
    await mkdir(outputDir, { recursive: true });

    const filename = result.metadata.filename.replace(/\.[^.]+$/, '');
    const date = new Date().toISOString().split('T')[0];
    const outputPath = join(outputDir, `${filename}-${date}.md`);

    const content = this.buildMarkdown(result);
    await writeFile(outputPath, content, 'utf-8');

    return outputPath;
  }

  /**
   * Build the Markdown content
   */
  private buildMarkdown(result: ExtractionResult): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Questionnaire Extraction: ${result.metadata.filename}`);
    lines.push('');
    lines.push(`**Customer:** ${result.metadata.customer || 'Unknown'}`);
    if (result.metadata.products?.length) {
      lines.push(`**Products:** ${result.metadata.products.join(', ')}`);
    }
    lines.push(`**Processed:** ${result.processedAt}`);
    lines.push(`**Sheets:** ${result.metadata.sheetCount}`);
    lines.push('');

    // Summary
    lines.push('---');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(this.buildSummaryTable(result.summary));
    lines.push('');

    // Flagged items (at the top for visibility)
    const flaggedQuestions = result.questions.filter(q => q.classification.flagReasons.length > 0);
    if (flaggedQuestions.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Flagged for Review');
      lines.push('');
      lines.push('> These items need human review before processing.');
      lines.push('');
      lines.push(this.buildFlaggedTable(flaggedQuestions));
      lines.push('');
    }

    // Group by destination
    const byDestination = this.groupByDestination(result.questions);

    // Answer Library
    if (byDestination.answer_library.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Answer Library (Reusable Answers)');
      lines.push('');
      lines.push('> These answers can be reused for future questionnaires.');
      lines.push('');
      lines.push(this.buildDestinationSection(byDestination.answer_library, result.sections));
    }

    // Entity DB
    if (byDestination.entity_db.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Entity Database (Company Data)');
      lines.push('');
      lines.push('> Structured entity data: names, addresses, contacts, certificates.');
      lines.push('');
      lines.push(this.buildDestinationSection(byDestination.entity_db, result.sections));
    }

    // Product Spec
    if (byDestination.product_spec.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Product Specifications');
      lines.push('');
      lines.push('> Product-specific data: composition, allergens, specs.');
      lines.push('');
      lines.push(this.buildDestinationSection(byDestination.product_spec, result.sections));
    }

    // Evidence Ref
    if (byDestination.evidence_ref.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Evidence References');
      lines.push('');
      lines.push('> References to certificates, declarations, reports.');
      lines.push('');
      lines.push(this.buildDestinationSection(byDestination.evidence_ref, result.sections));
    }

    // Log Only
    if (byDestination.log_only.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Customer-Specific (Log Only)');
      lines.push('');
      lines.push('> These items are customer-specific and logged for audit only.');
      lines.push('');
      lines.push(this.buildDestinationSection(byDestination.log_only, result.sections));
    }

    // Footer
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Review Instructions');
    lines.push('');
    lines.push('1. Review flagged items above');
    lines.push('2. Edit classifications if needed (change topic or destination)');
    lines.push('3. Mark items as approved: change `[ ]` to `[x]`');
    lines.push('4. Run: `npx tsx src/pipeline-v2/cli.ts approve <this-file>`');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Build summary table
   */
  private buildSummaryTable(summary: ExtractionSummary): string {
    const lines: string[] = [];

    lines.push('| Metric | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Total Questions | ${summary.totalQuestions} |`);
    lines.push(`| **Flagged for Review** | **${summary.flaggedForReview}** |`);
    lines.push('| | |');
    lines.push(`| → Answer Library | ${summary.byDestination.answer_library || 0} |`);
    lines.push(`| → Entity DB | ${summary.byDestination.entity_db || 0} |`);
    lines.push(`| → Product Spec | ${summary.byDestination.product_spec || 0} |`);
    lines.push(`| → Evidence Ref | ${summary.byDestination.evidence_ref || 0} |`);
    lines.push(`| → Log Only | ${summary.byDestination.log_only || 0} |`);
    lines.push('| | |');
    lines.push(`| High Confidence | ${summary.highConfidence} |`);
    lines.push(`| Medium Confidence | ${summary.mediumConfidence} |`);
    lines.push(`| Low Confidence | ${summary.lowConfidence} |`);

    return lines.join('\n');
  }

  /**
   * Build flagged items table
   */
  private buildFlaggedTable(questions: ClassifiedQuestion[]): string {
    const lines: string[] = [];

    lines.push('| # | Question | Answer | Topic | Reason | Action |');
    lines.push('|---|----------|--------|-------|--------|--------|');

    for (const q of questions) {
      const questionText = this.truncate(q.questionText, 50);
      const answerText = this.truncate(q.answerText, 30);
      const reasons = q.classification.flagReasons.join('; ');

      lines.push(
        `| ${q.rowNumber} | ${questionText} | ${answerText} | ${q.classification.topicName} | ${reasons} | [ ] Approve / [ ] Reject |`
      );
    }

    return lines.join('\n');
  }

  /**
   * Build section for a destination
   */
  private buildDestinationSection(
    questions: ClassifiedQuestion[],
    sections: QuestionnaireSection[]
  ): string {
    const lines: string[] = [];

    // Group by topic
    const byTopic = new Map<string, ClassifiedQuestion[]>();
    for (const q of questions) {
      const topic = q.classification.topicId;
      if (!byTopic.has(topic)) {
        byTopic.set(topic, []);
      }
      byTopic.get(topic)!.push(q);
    }

    // Output each topic group
    for (const [topicId, topicQuestions] of byTopic) {
      const topicName = topicQuestions[0]?.classification.topicName || topicId;

      lines.push(`### ${topicName}`);
      lines.push('');
      lines.push('| # | Question | Answer | Cell | Status |');
      lines.push('|---|----------|--------|------|--------|');

      for (const q of topicQuestions) {
        const status = q.classification.flagReasons.length > 0
          ? '⚠️ Review'
          : `✓ ${q.classification.confidenceLevel}`;

        const questionText = this.truncate(q.questionText, 60);
        const answerText = this.truncate(q.answerText, 40);
        const cell = q.questionCell.split('!')[1] || q.questionCell;

        lines.push(`| ${q.rowNumber} | ${questionText} | ${answerText} | ${cell} | ${status} |`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Group questions by destination
   */
  private groupByDestination(
    questions: ClassifiedQuestion[]
  ): Record<Destination, ClassifiedQuestion[]> {
    const groups: Record<Destination, ClassifiedQuestion[]> = {
      answer_library: [],
      entity_db: [],
      product_spec: [],
      evidence_ref: [],
      log_only: [],
    };

    for (const q of questions) {
      const dest = q.classification.destination;
      groups[dest].push(q);
    }

    return groups;
  }

  /**
   * Truncate text for table display
   */
  private truncate(text: string, maxLen: number): string {
    // Escape pipe characters for Markdown tables
    const escaped = text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

    if (escaped.length <= maxLen) return escaped;
    return escaped.substring(0, maxLen - 3) + '...';
  }
}

/**
 * Generate extraction summary from classified questions
 */
export function buildSummary(questions: ClassifiedQuestion[]): ExtractionSummary {
  const byDestination: Record<Destination, number> = {
    answer_library: 0,
    entity_db: 0,
    product_spec: 0,
    evidence_ref: 0,
    log_only: 0,
  };

  const byTopic: Record<string, number> = {};
  let flagged = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const q of questions) {
    const c = q.classification;

    byDestination[c.destination]++;

    byTopic[c.topicId] = (byTopic[c.topicId] || 0) + 1;

    if (c.flagReasons.length > 0) flagged++;

    if (c.confidenceLevel === 'high') high++;
    else if (c.confidenceLevel === 'medium') medium++;
    else low++;
  }

  return {
    totalQuestions: questions.length,
    byDestination,
    byTopic,
    flaggedForReview: flagged,
    highConfidence: high,
    mediumConfidence: medium,
    lowConfidence: low,
  };
}
