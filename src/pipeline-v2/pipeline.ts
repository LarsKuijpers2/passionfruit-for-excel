/**
 * Pipeline v2 Orchestrator
 *
 * Coordinates the full extraction, classification, and output flow.
 */

import { basename } from 'path';
import type {
  PipelineV2Options,
  ExtractionResult,
  ClassifiedQuestion,
  QuestionnaireMetadata,
  QuestionnaireSection,
  ExtractedQuestion,
} from './types.js';
import { loadRules, shouldExclude, type LoadedRules } from './rules-loader.js';
import { SectionExtractor } from './section-extractor.js';
import { VisualExtractor } from './visual-extractor.js';
import { TopicClassifier } from './topic-classifier.js';
import { SectionClassifier, type SectionClassification } from './section-classifier.js';
import { MarkdownGenerator, buildSummary } from './markdown-generator.js';
import { AnswerLibraryManager } from './answer-library.js';
import { ReviewCLI, quickReview } from './review-cli.js';

const DEFAULT_OPTIONS: PipelineV2Options = {
  inputDir: './incoming',
  reviewDir: './review',
  approvedDir: './approved',
  answerLibraryDir: './answer-library',
  rulesFile: './rules/rules.yaml',
  logsDir: './logs',
  awsRegion: 'eu-central-1',
  useBedrock: true,
  dryRun: false,
};

export class PipelineV2 {
  private options: PipelineV2Options;
  private rules: LoadedRules | null = null;
  private sectionExtractor: SectionExtractor;
  private visualExtractor: VisualExtractor;
  private classifier: TopicClassifier | null = null;
  private sectionClassifier: SectionClassifier | null = null;
  private markdownGenerator: MarkdownGenerator;
  private answerLibrary: AnswerLibraryManager;

  constructor(options: Partial<PipelineV2Options> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.sectionExtractor = new SectionExtractor();
    this.visualExtractor = new VisualExtractor({
      region: this.options.awsRegion,
      model: this.options.bedrockModel,
    });
    this.markdownGenerator = new MarkdownGenerator();
    this.answerLibrary = new AnswerLibraryManager(this.options.answerLibraryDir);
  }

  /**
   * Initialize pipeline (load rules, etc.)
   */
  async init(): Promise<void> {
    console.log('Loading rules...');
    this.rules = await loadRules(this.options.rulesFile);
    console.log(`  Loaded ${this.rules.config.topics.length} topics`);

    this.classifier = new TopicClassifier(this.rules, {
      region: this.options.awsRegion,
      model: this.options.bedrockModel,
      useBedrock: this.options.useBedrock,
    });

    this.sectionClassifier = new SectionClassifier(this.rules, {
      region: this.options.awsRegion,
      model: this.options.bedrockModel,
    });
  }

  /**
   * Process a single file
   */
  async processFile(
    filePath: string,
    options: { useVision?: boolean; interactive?: boolean; sectionFirst?: boolean } = {}
  ): Promise<ExtractionResult> {
    if (!this.rules || !this.classifier) {
      await this.init();
    }

    const filename = basename(filePath);
    console.log(`\nProcessing: ${filename}`);

    // Step 1: Extract structure
    console.log('  Extracting structure...');
    let metadata: QuestionnaireMetadata;
    let sections: QuestionnaireSection[];
    let questions: ExtractedQuestion[];

    if (options.useVision) {
      console.log('  Using visual extraction (Claude Vision)...');
      const result = await this.visualExtractor.extract(filePath);
      metadata = result.metadata;
      sections = result.sections;
      questions = result.questions;
    } else {
      const result = await this.sectionExtractor.extract(filePath);
      metadata = result.metadata;
      sections = result.sections;
      questions = result.questions;
    }

    console.log(`  Found ${sections.length} sections, ${questions.length} questions`);

    // Step 1.5: Filter out placeholder/template questions
    const originalCount = questions.length;
    questions = questions.filter(q => !shouldExclude(this.rules!, q.questionText, q.answerText));
    const excludedCount = originalCount - questions.length;
    if (excludedCount > 0) {
      console.log(`  Filtered out ${excludedCount} placeholder/template items`);
    }

    // Step 2: Check Answer Library for matches
    console.log('  Checking Answer Library...');
    const libraryMatches = await this.findLibraryMatches(questions);
    console.log(`  Found ${libraryMatches.size} potential matches`);

    // Step 3: Classify questions
    console.log('  Classifying questions...');
    const sectionTitles = new Map(sections.map(s => [s.id, s.title]));

    let classifiedQuestions: ClassifiedQuestion[];

    if (options.sectionFirst && sections.length > 0 && this.options.useBedrock) {
      // Section-first: classify sections, then assign topics to questions
      console.log('    Using section-first classification...');
      classifiedQuestions = await this.classifyBySections(sections, questions, sectionTitles);
    } else {
      // Per-question classification (fallback)
      const classifications = await this.classifier!.classifyBatch(questions, sectionTitles);
      classifiedQuestions = questions.map((q, i) => ({
        ...q,
        classification: classifications[i],
      }));
    }

    // Step 4: Build extraction result
    const summary = buildSummary(classifiedQuestions);
    const result: ExtractionResult = {
      metadata,
      sections,
      questions: classifiedQuestions,
      summary,
      processedAt: new Date().toISOString(),
    };

    // Step 5: Generate Markdown for review
    if (!this.options.dryRun) {
      console.log('  Generating review file...');
      const reviewPath = await this.markdownGenerator.generate(result, this.options.reviewDir);
      console.log(`  Review file: ${reviewPath}`);
    }

    // Step 6: Interactive review if requested
    if (options.interactive && !this.options.dryRun) {
      const shouldFullReview = !(await quickReview(classifiedQuestions, filename));

      if (shouldFullReview) {
        const reviewCli = new ReviewCLI(this.options.answerLibraryDir, this.rules!);
        await reviewCli.review(classifiedQuestions, filename);
      }
    }

    // Log summary
    console.log('\n  Summary:');
    console.log(`    Total: ${summary.totalQuestions}`);
    console.log(`    Flagged: ${summary.flaggedForReview}`);
    console.log(`    → Answer Library: ${summary.byDestination.answer_library}`);
    console.log(`    → Entity DB: ${summary.byDestination.entity_db}`);
    console.log(`    → Product Spec: ${summary.byDestination.product_spec}`);
    console.log(`    → Evidence Ref: ${summary.byDestination.evidence_ref}`);
    console.log(`    → Log Only: ${summary.byDestination.log_only}`);

    return result;
  }

  /**
   * Classify questions using section-first approach
   * 1. Classify sections by their titles
   * 2. Assign topics to questions based on their section
   * 3. Fall back to per-question classification for unclassified sections
   */
  private async classifyBySections(
    sections: QuestionnaireSection[],
    questions: ExtractedQuestion[],
    sectionTitles: Map<string, string>
  ): Promise<ClassifiedQuestion[]> {
    // Step 1: Classify sections
    const { classified, unclassifiedQuestions } = await this.sectionClassifier!.classifySections(
      sections,
      questions
    );

    console.log(`    Sections classified: ${classified.length}/${sections.length}`);
    console.log(`    Questions needing individual classification: ${unclassifiedQuestions.length}`);

    // Step 2: Build map of sectionId -> classification
    const sectionTopicMap = new Map<string, SectionClassification>();
    for (const c of classified) {
      sectionTopicMap.set(c.sectionId, c);
    }

    // Step 3: Classify questions in classified sections
    const classifiedQuestions: ClassifiedQuestion[] = [];

    for (const q of questions) {
      const sectionClass = sectionTopicMap.get(q.sectionId);

      if (sectionClass) {
        // Use section's topic
        const topic = this.rules!.config.topics.find(t => t.id === sectionClass.topicId);
        if (topic) {
          classifiedQuestions.push({
            ...q,
            classification: {
              topicId: topic.id,
              topicName: topic.name,
              confidence: sectionClass.confidence,
              confidenceLevel: sectionClass.confidence >= 0.8 ? 'high' : 'medium',
              destination: topic.destination,
              entityLevel: topic.level[0],
              evidenceType: topic.evidence_type,
              isReusable: topic.reusable,
              flagReasons: [],
              classificationMethod: 'keyword', // section-based counts as keyword
            },
          });
          continue;
        }
      }

      // Fall back to per-question classification
      const [classification] = await this.classifier!.classifyBatch([q], sectionTitles);
      classifiedQuestions.push({ ...q, classification });
    }

    return classifiedQuestions;
  }

  /**
   * Find matches in Answer Library
   */
  private async findLibraryMatches(
    questions: ExtractedQuestion[]
  ): Promise<Map<string, { answerId: string; similarity: number }>> {
    const matches = new Map<string, { answerId: string; similarity: number }>();

    for (const q of questions) {
      const found = await this.answerLibrary.findMatches(q.questionText);
      if (found.length > 0 && found[0].similarity > 0.8) {
        matches.set(q.id, {
          answerId: found[0].answer.id,
          similarity: found[0].similarity,
        });
      }
    }

    return matches;
  }

  /**
   * Get Answer Library statistics
   */
  async getLibraryStats(): Promise<{
    totalAnswers: number;
    byTopic: Record<string, number>;
  }> {
    const stats = await this.answerLibrary.getStats();
    return {
      totalAnswers: stats.totalAnswers,
      byTopic: stats.byTopic,
    };
  }
}
