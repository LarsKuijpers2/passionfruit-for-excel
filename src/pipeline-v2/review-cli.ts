/**
 * Interactive CLI Review for Pipeline v2
 *
 * Walks through flagged items for human review.
 */

import * as readline from 'readline';
import type {
  ClassifiedQuestion,
  ReviewItem,
  ReviewSession,
  ReviewStatus,
} from './types.js';
import { AnswerLibraryManager } from './answer-library.js';
import type { LoadedRules } from './rules-loader.js';
import { getTopicById } from './rules-loader.js';

interface ReviewResult {
  approved: ClassifiedQuestion[];
  rejected: ClassifiedQuestion[];
  modified: ClassifiedQuestion[];
  addedToLibrary: string[];
}

export class ReviewCLI {
  private rl: readline.Interface;
  private answerLibrary: AnswerLibraryManager;
  private rules: LoadedRules;

  constructor(
    answerLibraryDir: string,
    rules: LoadedRules
  ) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.answerLibrary = new AnswerLibraryManager(answerLibraryDir);
    this.rules = rules;
  }

  /**
   * Start interactive review session
   */
  async review(
    questions: ClassifiedQuestion[],
    sourceFile: string
  ): Promise<ReviewResult> {
    const flagged = questions.filter(q => q.classification.flagReasons.length > 0);

    if (flagged.length === 0) {
      console.log('\n✅ No items flagged for review.\n');
      return {
        approved: questions,
        rejected: [],
        modified: [],
        addedToLibrary: [],
      };
    }

    console.log(`\n📋 Review Session: ${sourceFile}`);
    console.log(`   ${flagged.length} items need review\n`);
    console.log('─'.repeat(60));

    const result: ReviewResult = {
      approved: [],
      rejected: [],
      modified: [],
      addedToLibrary: [],
    };

    // Review each flagged item
    for (let i = 0; i < flagged.length; i++) {
      const question = flagged[i];
      console.log(`\n[${i + 1}/${flagged.length}] Row ${question.rowNumber}`);

      const action = await this.reviewItem(question);

      switch (action.status) {
        case 'approved':
          result.approved.push(question);
          if (action.addToLibrary) {
            await this.addToAnswerLibrary(question, action.reviewer || 'unknown');
            result.addedToLibrary.push(question.id);
          }
          break;
        case 'rejected':
          result.rejected.push(question);
          break;
        case 'modified':
          if (action.modifiedQuestion) {
            result.modified.push(action.modifiedQuestion);
          }
          break;
      }
    }

    // Add non-flagged items to approved
    const nonFlagged = questions.filter(q => q.classification.flagReasons.length === 0);
    result.approved.push(...nonFlagged);

    console.log('\n─'.repeat(60));
    console.log('\n✅ Review Complete');
    console.log(`   Approved: ${result.approved.length}`);
    console.log(`   Rejected: ${result.rejected.length}`);
    console.log(`   Modified: ${result.modified.length}`);
    console.log(`   Added to Answer Library: ${result.addedToLibrary.length}\n`);

    this.rl.close();
    return result;
  }

  /**
   * Review a single item
   */
  private async reviewItem(
    question: ClassifiedQuestion
  ): Promise<{
    status: ReviewStatus;
    addToLibrary?: boolean;
    reviewer?: string;
    modifiedQuestion?: ClassifiedQuestion;
  }> {
    // Display the question
    this.displayQuestion(question);

    // Check for similar answers in library
    const matches = await this.answerLibrary.findMatches(
      question.questionText,
      question.classification.topicId
    );

    if (matches.length > 0) {
      console.log('\n💡 Similar answers found in library:');
      for (let i = 0; i < Math.min(3, matches.length); i++) {
        const m = matches[i];
        console.log(`   ${i + 1}. [${Math.round(m.similarity * 100)}%] ${m.answer.answerEN.substring(0, 60)}...`);
      }
    }

    // Prompt for action
    console.log('\nActions:');
    console.log('  [a] Approve as-is');
    console.log('  [l] Approve and add to Answer Library');
    console.log('  [t] Change topic/classification');
    console.log('  [r] Reject (exclude from output)');
    console.log('  [s] Skip (keep flagged)');
    console.log('  [q] Quit review');

    const action = await this.prompt('Choice: ');

    switch (action.toLowerCase()) {
      case 'a':
        console.log('  → Approved');
        return { status: 'approved' };

      case 'l':
        console.log('  → Approved and will be added to Answer Library');
        return { status: 'approved', addToLibrary: true, reviewer: 'cli-review' };

      case 't':
        const modified = await this.changeTopic(question);
        return { status: 'modified', modifiedQuestion: modified };

      case 'r':
        console.log('  → Rejected');
        return { status: 'rejected' };

      case 's':
        console.log('  → Skipped');
        return { status: 'pending' };

      case 'q':
        console.log('\n⚠️  Review interrupted. Progress saved.');
        process.exit(0);

      default:
        console.log('  → Invalid choice, skipping');
        return { status: 'pending' };
    }
  }

  /**
   * Display a question for review
   */
  private displayQuestion(question: ClassifiedQuestion): void {
    console.log('\n┌─ Question ─────────────────────────────────────────');
    console.log(`│ ${this.wrapText(question.questionText, 55)}`);
    console.log('├─ Answer ───────────────────────────────────────────');
    console.log(`│ ${this.wrapText(question.answerText || '(empty)', 55)}`);
    console.log('├─ Classification ──────────────────────────────────');
    console.log(`│ Topic: ${question.classification.topicName}`);
    console.log(`│ Destination: ${question.classification.destination}`);
    console.log(`│ Confidence: ${question.classification.confidenceLevel} (${Math.round(question.classification.confidence * 100)}%)`);
    console.log(`│ Cell: ${question.questionCell}`);
    console.log('├─ Flag Reasons ────────────────────────────────────');
    for (const reason of question.classification.flagReasons) {
      console.log(`│ ⚠️  ${reason}`);
    }
    console.log('└───────────────────────────────────────────────────');
  }

  /**
   * Change topic/classification
   */
  private async changeTopic(
    question: ClassifiedQuestion
  ): Promise<ClassifiedQuestion> {
    console.log('\nAvailable topics:');

    // Group by destination
    const topics = this.rules.config.topics;
    const entityTopics = topics.filter(t => t.level.some(l => ['company', 'group', 'site'].includes(l)));
    const productTopics = topics.filter(t => t.level.some(l => ['product', 'product_group'].includes(l)));

    console.log('\nEntity-level topics:');
    for (let i = 0; i < entityTopics.length; i++) {
      console.log(`  ${i + 1}. ${entityTopics[i].name} → ${entityTopics[i].destination}`);
    }

    console.log('\nProduct-level topics:');
    for (let i = 0; i < productTopics.length; i++) {
      console.log(`  ${entityTopics.length + i + 1}. ${productTopics[i].name} → ${productTopics[i].destination}`);
    }

    const choice = await this.prompt('\nEnter topic number (or press Enter to cancel): ');

    if (!choice.trim()) {
      return question;
    }

    const num = parseInt(choice, 10);
    const allTopics = [...entityTopics, ...productTopics];

    if (num >= 1 && num <= allTopics.length) {
      const newTopic = allTopics[num - 1];
      console.log(`  → Changed to: ${newTopic.name}`);

      // Update classification
      const modified: ClassifiedQuestion = {
        ...question,
        classification: {
          ...question.classification,
          topicId: newTopic.id,
          topicName: newTopic.name,
          destination: newTopic.destination as ClassifiedQuestion['classification']['destination'],
          entityLevel: newTopic.level[0] as ClassifiedQuestion['classification']['entityLevel'],
          evidenceType: newTopic.evidence_type as ClassifiedQuestion['classification']['evidenceType'],
          isReusable: newTopic.reusable,
          flagReasons: [],  // Clear flags since manually reviewed
          confidence: 1.0,
          confidenceLevel: 'high',
          classificationMethod: 'bedrock',  // Treated as manually verified
        },
      };

      return modified;
    }

    console.log('  → Invalid choice, keeping original');
    return question;
  }

  /**
   * Add question to Answer Library
   */
  private async addToAnswerLibrary(
    question: ClassifiedQuestion,
    reviewer: string
  ): Promise<void> {
    try {
      await this.answerLibrary.addAnswer(question, reviewer);
      console.log('  📚 Added to Answer Library');
    } catch (error) {
      console.error(`  ❌ Failed to add to library: ${error}`);
    }
  }

  /**
   * Prompt for input
   */
  private prompt(message: string): Promise<string> {
    return new Promise(resolve => {
      this.rl.question(message, answer => {
        resolve(answer);
      });
    });
  }

  /**
   * Wrap text for display
   */
  private wrapText(text: string, width: number): string {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= width) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);

    return lines.join('\n│ ');
  }
}

/**
 * Quick review mode: just show summary and ask for bulk approval
 */
export async function quickReview(
  questions: ClassifiedQuestion[],
  sourceFile: string
): Promise<boolean> {
  const flagged = questions.filter(q => q.classification.flagReasons.length > 0);

  console.log(`\n📋 Quick Review: ${sourceFile}`);
  console.log(`   Total: ${questions.length} questions`);
  console.log(`   Flagged: ${flagged.length} items`);

  if (flagged.length === 0) {
    console.log('\n✅ No items flagged. Auto-approving all.');
    return true;
  }

  console.log('\nFlagged items:');
  for (const q of flagged.slice(0, 10)) {
    console.log(`  • [${q.classification.topicName}] ${q.questionText.substring(0, 50)}...`);
    console.log(`    Reason: ${q.classification.flagReasons[0]}`);
  }
  if (flagged.length > 10) {
    console.log(`  ... and ${flagged.length - 10} more`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question('\nApprove all? [y/N/review] ', answer => {
      rl.close();
      if (answer.toLowerCase() === 'y') {
        resolve(true);
      } else if (answer.toLowerCase() === 'review') {
        resolve(false);  // Caller should start full review
      } else {
        console.log('Aborted.');
        process.exit(0);
      }
    });
  });
}
