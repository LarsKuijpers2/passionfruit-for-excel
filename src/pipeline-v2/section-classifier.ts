/**
 * Section-First Classifier
 *
 * Uses Claude to identify sections in a questionnaire and map them to topics.
 * Much more efficient than classifying each question individually.
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { QuestionnaireSection, ExtractedQuestion, TopicRule } from './types.js';
import type { LoadedRules } from './rules-loader.js';

export interface SectionClassification {
  sectionId: string;
  sectionTitle: string;
  topicId: string;
  topicName: string;
  confidence: number;
}

export interface ClassifiedSections {
  /** Sections that were successfully mapped to topics */
  classified: SectionClassification[];
  /** Questions in sections that couldn't be mapped (need per-question classification) */
  unclassifiedQuestions: ExtractedQuestion[];
}

export class SectionClassifier {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private rules: LoadedRules;

  constructor(
    rules: LoadedRules,
    options: { region?: string; model?: string } = {}
  ) {
    this.rules = rules;
    this.client = new BedrockRuntimeClient({
      region: options.region || process.env.AWS_REGION || 'eu-central-1',
    });
    // Use Claude Sonnet 4 via EU inference profile
    this.modelId = options.model || 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
  }

  /**
   * Classify sections by their titles
   * Returns classified sections and any questions that need individual classification
   */
  async classifySections(
    sections: QuestionnaireSection[],
    questions: ExtractedQuestion[]
  ): Promise<ClassifiedSections> {
    if (sections.length === 0) {
      return { classified: [], unclassifiedQuestions: questions };
    }

    // Build topic list for the prompt
    const topicList = this.rules.config.topics
      .map(t => `- ${t.id}: ${t.name} - ${t.description}`)
      .join('\n');

    // Build section list
    const sectionList = sections
      .map(s => `- Section "${s.title}" (ID: ${s.id})`)
      .join('\n');

    const prompt = `You are analyzing a questionnaire to map sections to topics.

## Available Topics
${topicList}

## Sections Found in Questionnaire
${sectionList}

## Task
For each section, determine which topic it belongs to based on the section title.
Return a JSON array with your classification.

If a section clearly matches a topic, assign it with high confidence (0.8-1.0).
If a section partially matches, assign with medium confidence (0.5-0.79).
If a section doesn't match any topic, set topicId to null.

## Output Format (JSON only, no markdown)
[
  {"sectionId": "1", "topicId": "company_information", "confidence": 0.95},
  {"sectionId": "2", "topicId": "allergens", "confidence": 0.9},
  {"sectionId": "3", "topicId": null, "confidence": 0}
]`;

    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: 8000, temperature: 0.1 },
        })
      );

      const content = response.output?.message?.content?.[0];
      if (!content || !('text' in content)) {
        return { classified: [], unclassifiedQuestions: questions };
      }

      // Parse JSON response - handle both complete and truncated JSON
      let jsonText = content.text;

      // Try to find complete JSON array first
      const jsonMatch = jsonText.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        // Response might be truncated - try to fix it
        const startBracket = jsonText.indexOf('[');
        if (startBracket >= 0) {
          jsonText = jsonText.substring(startBracket);
          // Find the last complete object (ends with })
          const lastComplete = jsonText.lastIndexOf('}');
          if (lastComplete > 0) {
            jsonText = jsonText.substring(0, lastComplete + 1) + ']';
          }
        } else {
          return { classified: [], unclassifiedQuestions: questions };
        }
      } else {
        jsonText = jsonMatch[0];
      }

      const classifications = JSON.parse(jsonText) as Array<{
        sectionId: string;
        topicId: string | null;
        confidence: number;
      }>;

      // Build classified sections
      const classified: SectionClassification[] = [];
      const classifiedSectionIds = new Set<string>();

      for (const c of classifications) {
        if (c.topicId && c.confidence >= 0.5) {
          const section = sections.find(s => s.id === c.sectionId);
          const topic = this.rules.config.topics.find(t => t.id === c.topicId);

          if (section && topic) {
            classified.push({
              sectionId: c.sectionId,
              sectionTitle: section.title,
              topicId: c.topicId,
              topicName: topic.name,
              confidence: c.confidence,
            });
            classifiedSectionIds.add(c.sectionId);
          }
        }
      }

      // Find questions in unclassified sections
      const unclassifiedQuestions = questions.filter(
        q => !classifiedSectionIds.has(q.sectionId)
      );

      return { classified, unclassifiedQuestions };

    } catch (error) {
      console.error('Section classification error:', error);
      return { classified: [], unclassifiedQuestions: questions };
    }
  }

  /**
   * Get topic for a question based on its section
   */
  getTopicForSection(
    sectionId: string,
    classifiedSections: SectionClassification[]
  ): { topic: TopicRule; confidence: number } | null {
    const section = classifiedSections.find(s => s.sectionId === sectionId);
    if (!section) return null;

    const topic = this.rules.config.topics.find(t => t.id === section.topicId);
    if (!topic) return null;

    return { topic, confidence: section.confidence };
  }
}
