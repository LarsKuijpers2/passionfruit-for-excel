/**
 * Topic Classifier for Pipeline v2
 *
 * Classifies questions into topics using:
 * 1. Keyword matching
 * 2. Regex pattern matching
 * 3. Bedrock Claude for ambiguous cases
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  ClassificationResult,
  ExtractedQuestion,
  ConfidenceLevel,
  Destination,
  EntityLevel,
  EvidenceType,
} from './types.js';
import type { LoadedRules, CompiledTopicPatterns } from './rules-loader.js';
import { getTopicById, getFlagReasons, isLogOnly } from './rules-loader.js';

const DEFAULT_MODEL = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
const DEFAULT_REGION = 'eu-central-1';

interface ClassifierConfig {
  region?: string;
  model?: string;
  useBedrock?: boolean;
}

interface TopicScore {
  topicId: string;
  score: number;
  keywordMatches: number;
  patternMatches: number;
}

export class TopicClassifier {
  private bedrockClient: BedrockRuntimeClient | null = null;
  private model: string;
  private region: string;
  private useBedrock: boolean;
  private rules: LoadedRules;

  constructor(rules: LoadedRules, config?: ClassifierConfig) {
    this.rules = rules;
    this.region = config?.region || DEFAULT_REGION;
    this.model = config?.model || DEFAULT_MODEL;
    this.useBedrock = config?.useBedrock ?? true;
  }

  /** Initialize Bedrock client (lazy) */
  private getBedrockClient(): BedrockRuntimeClient {
    if (!this.bedrockClient) {
      this.bedrockClient = new BedrockRuntimeClient({ region: this.region });
    }
    return this.bedrockClient;
  }

  /**
   * Classify a single question
   */
  async classify(question: ExtractedQuestion, sectionTitle?: string): Promise<ClassificationResult> {
    const text = `${question.questionText} ${question.answerText}`.toLowerCase();

    // Check if this should be log-only (customer-specific)
    if (isLogOnly(this.rules, text)) {
      return this.createLogOnlyResult(question);
    }

    // Score all topics using keywords and patterns
    const scores = this.scoreAllTopics(text, sectionTitle);

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    const topScore = scores[0];
    const secondScore = scores[1];

    // Determine confidence and method
    let confidence: number;
    let method: 'keyword' | 'pattern' | 'bedrock' | 'fallback';
    let topicId: string;

    if (topScore.score >= 3) {
      // Strong match
      confidence = 0.9;
      method = topScore.patternMatches > 0 ? 'pattern' : 'keyword';
      topicId = topScore.topicId;
    } else if (topScore.score >= 2) {
      // Good match
      confidence = 0.75;
      method = topScore.patternMatches > 0 ? 'pattern' : 'keyword';
      topicId = topScore.topicId;
    } else if (topScore.score >= 1) {
      // Weak match - check if ambiguous
      if (secondScore && secondScore.score >= 1 && (topScore.score - secondScore.score) < 1) {
        // Ambiguous - use Bedrock if available
        if (this.useBedrock) {
          return await this.classifyWithBedrock(question, sectionTitle);
        }
        confidence = 0.4;
        method = 'fallback';
        topicId = topScore.topicId;
      } else {
        confidence = 0.6;
        method = topScore.patternMatches > 0 ? 'pattern' : 'keyword';
        topicId = topScore.topicId;
      }
    } else {
      // No match - use Bedrock or fallback
      if (this.useBedrock) {
        return await this.classifyWithBedrock(question, sectionTitle);
      }
      // Fallback to quality_systems (most common bucket)
      confidence = 0.3;
      method = 'fallback';
      topicId = 'quality_systems';
    }

    return this.buildResult(topicId, confidence, method, question);
  }

  /**
   * Classify a batch of questions
   */
  async classifyBatch(
    questions: ExtractedQuestion[],
    sectionTitles?: Map<string, string>
  ): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = [];
    const needsBedrock: { question: ExtractedQuestion; index: number; sectionTitle?: string }[] = [];

    // First pass: rule-based classification
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const sectionTitle = sectionTitles?.get(question.sectionId);

      // Check if log-only
      const text = `${question.questionText} ${question.answerText}`.toLowerCase();
      if (isLogOnly(this.rules, text)) {
        results[i] = this.createLogOnlyResult(question);
        continue;
      }

      // Score topics
      const scores = this.scoreAllTopics(text, sectionTitle);
      scores.sort((a, b) => b.score - a.score);

      const topScore = scores[0];
      const secondScore = scores[1];

      if (topScore.score >= 2) {
        // Good match
        const confidence = topScore.score >= 3 ? 0.9 : 0.75;
        const method = topScore.patternMatches > 0 ? 'pattern' : 'keyword';
        results[i] = this.buildResult(topScore.topicId, confidence, method, question);
      } else if (topScore.score >= 1 && (!secondScore || secondScore.score === 0)) {
        // Single weak match
        results[i] = this.buildResult(topScore.topicId, 0.6, 'keyword', question);
      } else {
        // Needs Bedrock or is ambiguous
        needsBedrock.push({ question, index: i, sectionTitle });
        results[i] = null as unknown as ClassificationResult; // Placeholder
      }
    }

    // Second pass: Bedrock for ambiguous items
    if (needsBedrock.length > 0 && this.useBedrock) {
      const bedrockResults = await this.classifyBatchWithBedrock(needsBedrock);
      for (let i = 0; i < needsBedrock.length; i++) {
        const { index } = needsBedrock[i];
        results[index] = bedrockResults[i];
      }
    } else {
      // Fill in fallbacks for items that needed Bedrock
      for (const { question, index } of needsBedrock) {
        results[index] = this.buildResult('quality_systems', 0.3, 'fallback', question);
      }
    }

    return results;
  }

  /**
   * Score all topics for a text
   */
  private scoreAllTopics(text: string, sectionTitle?: string): TopicScore[] {
    const scores: TopicScore[] = [];
    const words = new Set(text.split(/\s+/).map(w => w.replace(/[^a-z0-9äöüß]/g, '')));

    for (const [topicId, patterns] of this.rules.topicPatterns) {
      let keywordMatches = 0;
      let patternMatches = 0;

      // Count keyword matches
      for (const keyword of patterns.keywords) {
        // Check for multi-word keywords
        if (keyword.includes(' ')) {
          if (text.includes(keyword)) {
            keywordMatches++;
          }
        } else if (words.has(keyword)) {
          keywordMatches++;
        }
      }

      // Count pattern matches
      for (const pattern of patterns.patterns) {
        if (pattern.test(text)) {
          patternMatches++;
        }
      }

      // Bonus for section title match
      if (sectionTitle) {
        const topic = getTopicById(this.rules, topicId);
        if (topic) {
          const sectionLower = sectionTitle.toLowerCase();
          if (topic.keywords.some(k => sectionLower.includes(k))) {
            keywordMatches += 0.5;
          }
        }
      }

      const score = keywordMatches + patternMatches * 1.5; // Patterns are weighted higher
      scores.push({ topicId, score, keywordMatches, patternMatches });
    }

    return scores;
  }

  /**
   * Classify a single question using Bedrock
   */
  private async classifyWithBedrock(
    question: ExtractedQuestion,
    sectionTitle?: string
  ): Promise<ClassificationResult> {
    const results = await this.classifyBatchWithBedrock([
      { question, index: 0, sectionTitle },
    ]);
    return results[0];
  }

  /**
   * Classify multiple questions using Bedrock
   */
  private async classifyBatchWithBedrock(
    items: { question: ExtractedQuestion; index: number; sectionTitle?: string }[]
  ): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = [];

    try {
      const client = this.getBedrockClient();

      // Build topic list for prompt
      const topicList = this.rules.config.topics.map(t =>
        `- ${t.id}: ${t.name} — ${t.description}`
      ).join('\n');

      // Process in batches of 30
      const batchSize = 30;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);

        const questionsForClaude = batch.map((item, idx) => ({
          idx: idx + 1,
          section: item.sectionTitle || 'unknown',
          question: item.question.questionText.substring(0, 500),
          answer: item.question.answerText.substring(0, 300),
        }));

        const command = new ConverseCommand({
          modelId: this.model,
          messages: [{
            role: 'user',
            content: [{
              text: `Classify each question-answer pair into exactly one topic.

TOPICS:
${topicList}

RULES:
1. Product-specific data (ingredients, specs, values) → use product-level topics (identification, allergens, nutritional, etc.)
2. Company procedures and policies → use entity-level topics (quality_systems, complaints, traceability, etc.)
3. Entity data (name, address, contacts, cert numbers) → use company_information or certifications
4. If unclear, default to quality_systems

Respond with JSON array: [{"idx": 1, "topic": "topic_id", "confidence": 0.0-1.0}, ...]

QUESTIONS:
${JSON.stringify(questionsForClaude, null, 2)}`,
            }],
          }],
          inferenceConfig: {
            maxTokens: 2000,
          },
        });

        const response = await client.send(command);
        const textContent = response.output?.message?.content?.[0];

        if (textContent && 'text' in textContent) {
          const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const claudeResults: Array<{ idx: number; topic: string; confidence: number }> =
              JSON.parse(jsonMatch[0]);

            for (const cr of claudeResults) {
              const item = batch[cr.idx - 1];
              if (item) {
                const validTopic = this.rules.config.topics.find(t => t.id === cr.topic);
                if (validTopic) {
                  results.push(this.buildResult(
                    cr.topic,
                    Math.min(cr.confidence, 0.85), // Cap Bedrock confidence
                    'bedrock',
                    item.question
                  ));
                } else {
                  // Invalid topic from Claude - fallback
                  results.push(this.buildResult('quality_systems', 0.4, 'fallback', item.question));
                }
              }
            }
          }
        }

        // Fill any missing results
        while (results.length < i + batch.length) {
          const missingIdx = results.length - i;
          if (missingIdx < batch.length) {
            results.push(this.buildResult('quality_systems', 0.3, 'fallback', batch[missingIdx].question));
          }
        }
      }
    } catch (error) {
      console.error(`Bedrock classification failed: ${error instanceof Error ? error.message : error}`);

      // Fill all with fallback
      for (const item of items) {
        results.push(this.buildResult('quality_systems', 0.3, 'fallback', item.question));
      }
    }

    return results;
  }

  /**
   * Build a classification result
   */
  private buildResult(
    topicId: string,
    confidence: number,
    method: 'keyword' | 'pattern' | 'bedrock' | 'fallback',
    question: ExtractedQuestion
  ): ClassificationResult {
    const topic = getTopicById(this.rules, topicId);

    if (!topic) {
      // Fallback to quality_systems if topic not found
      return this.buildResult('quality_systems', 0.3, 'fallback', question);
    }

    // Determine confidence level
    let confidenceLevel: ConfidenceLevel;
    if (confidence >= 0.75) {
      confidenceLevel = 'high';
    } else if (confidence >= 0.5) {
      confidenceLevel = 'medium';
    } else {
      confidenceLevel = 'low';
    }

    // Get flag reasons
    const flagReasons = getFlagReasons(
      this.rules,
      question.questionText,
      question.answerText,
      confidence,
      topicId !== 'quality_systems' || method !== 'fallback'
    );

    return {
      topicId,
      topicName: topic.name,
      confidence,
      confidenceLevel,
      destination: topic.destination as Destination,
      entityLevel: topic.level[0] as EntityLevel,
      evidenceType: topic.evidence_type as EvidenceType,
      isReusable: topic.reusable,
      flagReasons,
      classificationMethod: method,
    };
  }

  /**
   * Create a log-only result for customer-specific content
   */
  private createLogOnlyResult(question: ExtractedQuestion): ClassificationResult {
    return {
      topicId: 'customer_specific',
      topicName: 'Customer Specific',
      confidence: 0.9,
      confidenceLevel: 'high',
      destination: 'log_only',
      entityLevel: 'company',
      evidenceType: null,
      isReusable: false,
      flagReasons: [],
      classificationMethod: 'pattern',
    };
  }
}
