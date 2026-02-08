/**
 * Review Server
 *
 * Local Express server for the review interface.
 * Handles auto-saving feedback and applying rules.
 */

import express from 'express';
import cors from 'cors';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { existsSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { exec } from 'child_process';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Types
export interface FeedbackItem {
  id: string;
  action: 'accepted' | 'rejected' | 'edited' | 'destination_changed';
  label: string;
  value?: string;
  cells?: string;
  section?: string;
  topic?: string;
  destination?: string;
  reason?: string;
  editedLabel?: string;
  editedValue?: string;
  reviewedAt: string;
}

export interface FeedbackData {
  meta: {
    source: string;
    questionnaire: string;
    startedAt: string;
    lastUpdatedAt: string;
  };
  index: FeedbackItem[];
  library: FeedbackItem[];
}

export interface ReviewStatus {
  total: number;
  accepted: number;
  rejected: number;
  edited: number;
  pending: number;
}

/** Annotation request - cells selected + user instruction */
export interface AnnotationRequest {
  cells: Array<{
    id: string;       // e.g., "B10"
    value: string;    // cell content
    row: number;
    col: string;
  }>;
  instruction: string;
  sheetName: string;
  questionnaireId: string;
  sections?: Array<{
    name: string;
    topic: string;
    rowRange?: string;
  }>;
}

/** Suggested change from Claude */
export interface SuggestedChange {
  action: 'create' | 'update' | 'merge' | 'split' | 'delete';
  description: string;
  items: Array<{
    label: string;
    value: string;
    lCell?: string;
    vCell?: string;
    section?: string;  // Section name to add to
    topic?: string;
    level?: string;
  }>;
  reasoning: string;
}

// Server class
export class ReviewServer {
  private app: express.Application;
  private port: number;
  private questionnaire: string;
  private reviewDir: string;
  private feedbackPath: string;
  private feedback: FeedbackData;
  private bedrockClient: BedrockRuntimeClient;
  private modelId: string;

  constructor(questionnaire: string, options: { port?: number; reviewDir?: string } = {}) {
    this.questionnaire = questionnaire;
    this.port = options.port || 3456;
    this.reviewDir = options.reviewDir || './review';

    // Initialize Bedrock client for Claude annotations
    this.bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'eu-central-1' });
    this.modelId = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';

    // Create safe folder name from questionnaire
    const safeName = questionnaire.replace(/[^a-zA-Z0-9-_]/g, '_');
    const feedbackDir = join(this.reviewDir, safeName);
    this.feedbackPath = join(feedbackDir, 'feedback.json');

    this.app = express();
    this.feedback = this.createEmptyFeedback();

    this.setupMiddleware();
    this.setupRoutes();
  }

  private createEmptyFeedback(): FeedbackData {
    return {
      meta: {
        source: this.questionnaire,
        questionnaire: this.questionnaire,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString()
      },
      index: [],
      library: []
    };
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());

    // Serve static review HTML files
    this.app.use('/review', express.static(this.reviewDir));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', questionnaire: this.questionnaire });
    });

    // List all available questionnaires
    this.app.get('/api/questionnaires', async (req, res) => {
      try {
        const questionnaires = await this.listQuestionnaires();
        res.json({ questionnaires, current: this.questionnaire });
      } catch (error) {
        console.error('Error listing questionnaires:', error);
        res.status(500).json({ error: 'Failed to list questionnaires' });
      }
    });

    // Get current feedback status
    this.app.get('/api/status', (req, res) => {
      const indexAccepted = this.feedback.index.filter(f => f.action === 'accepted').length;
      const indexRejected = this.feedback.index.filter(f => f.action === 'rejected').length;
      const indexEdited = this.feedback.index.filter(f => f.action === 'edited').length;

      const libAccepted = this.feedback.library.filter(f => f.action === 'accepted').length;
      const libRejected = this.feedback.library.filter(f => f.action === 'rejected').length;
      const libEdited = this.feedback.library.filter(f => f.action === 'edited').length;

      res.json({
        questionnaire: this.questionnaire,
        lastUpdated: this.feedback.meta.lastUpdatedAt,
        index: {
          total: this.feedback.index.length,
          accepted: indexAccepted,
          rejected: indexRejected,
          edited: indexEdited
        },
        library: {
          total: this.feedback.library.length,
          accepted: libAccepted,
          rejected: libRejected,
          edited: libEdited
        }
      });
    });

    // Get all feedback
    this.app.get('/api/feedback', (req, res) => {
      res.json(this.feedback);
    });

    // Save single feedback item
    this.app.post('/api/feedback', async (req, res) => {
      try {
        const { panel, item, questionnaire } = req.body;

        if (!panel || !item) {
          return res.status(400).json({ error: 'Missing panel or item' });
        }

        // Add timestamp if not present
        if (!item.reviewedAt) {
          item.reviewedAt = new Date().toISOString();
        }

        // Generate ID if not present
        if (!item.id) {
          item.id = `${panel}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        // Determine which questionnaire's feedback to update
        const targetQuestionnaire = questionnaire || this.questionnaire;
        const safeName = targetQuestionnaire.replace(/[^a-zA-Z0-9-_]/g, '_');
        const feedbackPath = join(this.reviewDir, safeName, 'feedback.json');

        // Load existing feedback for this questionnaire
        let feedback: FeedbackData;
        if (existsSync(feedbackPath)) {
          feedback = JSON.parse(await readFile(feedbackPath, 'utf-8'));
        } else {
          feedback = {
            meta: {
              source: targetQuestionnaire,
              questionnaire: targetQuestionnaire,
              startedAt: new Date().toISOString(),
              lastUpdatedAt: new Date().toISOString()
            },
            index: [],
            library: []
          };
        }

        // Add to appropriate list (replace if same cells exist)
        const list = panel === 'library' ? feedback.library : feedback.index;
        const existingIndex = list.findIndex(f => f.cells === item.cells && f.label === item.label);

        if (existingIndex >= 0) {
          list[existingIndex] = item;
        } else {
          list.push(item);
        }

        // Update timestamp
        feedback.meta.lastUpdatedAt = new Date().toISOString();

        // Save to questionnaire-specific path
        await mkdir(dirname(feedbackPath), { recursive: true });
        await writeFile(feedbackPath, JSON.stringify(feedback, null, 2), 'utf-8');
        console.log(`Saved feedback to ${feedbackPath}`);

        res.json({ success: true, id: item.id });
      } catch (error) {
        console.error('Error saving feedback:', error);
        res.status(500).json({ error: 'Failed to save feedback' });
      }
    });

    // Bulk save feedback
    this.app.post('/api/feedback/bulk', async (req, res) => {
      try {
        const { panel, items } = req.body;

        if (!panel || !items || !Array.isArray(items)) {
          return res.status(400).json({ error: 'Missing panel or items array' });
        }

        const list = panel === 'library' ? this.feedback.library : this.feedback.index;

        for (const item of items) {
          if (!item.reviewedAt) {
            item.reviewedAt = new Date().toISOString();
          }
          if (!item.id) {
            item.id = `${panel}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          }

          const existingIndex = list.findIndex(f => f.cells === item.cells && f.label === item.label);
          if (existingIndex >= 0) {
            list[existingIndex] = item;
          } else {
            list.push(item);
          }
        }

        this.feedback.meta.lastUpdatedAt = new Date().toISOString();
        await this.saveFeedback();

        res.json({ success: true, count: items.length });
      } catch (error) {
        console.error('Error saving bulk feedback:', error);
        res.status(500).json({ error: 'Failed to save feedback' });
      }
    });

    // Clear all feedback
    this.app.delete('/api/feedback', async (req, res) => {
      try {
        this.feedback = this.createEmptyFeedback();
        await this.saveFeedback();
        res.json({ success: true });
      } catch (error) {
        console.error('Error clearing feedback:', error);
        res.status(500).json({ error: 'Failed to clear feedback' });
      }
    });

    // Apply rules from feedback
    this.app.post('/api/apply-rules', async (req, res) => {
      try {
        const rules = await this.generateRules();
        await this.saveRules(rules);
        res.json({ success: true, rules });
      } catch (error) {
        console.error('Error applying rules:', error);
        res.status(500).json({ error: 'Failed to apply rules' });
      }
    });

    // Get generated rules preview
    this.app.get('/api/rules/preview', async (req, res) => {
      try {
        const rules = await this.generateRules();
        res.json(rules);
      } catch (error) {
        console.error('Error generating rules preview:', error);
        res.status(500).json({ error: 'Failed to generate rules' });
      }
    });

    // Export approved items to database files
    this.app.post('/api/export-approved', async (req, res) => {
      try {
        const exported = await this.exportApproved();
        res.json({ success: true, exported });
      } catch (error) {
        console.error('Error exporting approved:', error);
        res.status(500).json({ error: 'Failed to export approved items' });
      }
    });

    // Get export preview
    this.app.get('/api/export-approved/preview', async (req, res) => {
      try {
        const preview = this.generateExportPreview();
        res.json(preview);
      } catch (error) {
        console.error('Error generating export preview:', error);
        res.status(500).json({ error: 'Failed to generate preview' });
      }
    });

    // Open source file
    this.app.post('/api/open-file/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        // Find the source file
        const indexedPath = join(this.indexedDir, id + '.yaml');
        const indexed = parseYaml(await readFile(indexedPath, 'utf-8'));
        const sourcePath = indexed?.source_file || join('./incoming', indexed?.source || id);

        // Open with default application (works on macOS)
        await execAsync(`open "${sourcePath}"`);
        res.json({ success: true, path: sourcePath });
      } catch (error) {
        console.error('Error opening file:', error);
        res.status(500).json({ error: 'Failed to open file' });
      }
    });

    // Get questionnaire data (structure + indexed + library)
    this.app.get('/api/questionnaire/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const data = await this.loadQuestionnaireData(id);
        res.json(data);
      } catch (error) {
        console.error('Error loading questionnaire data:', error);
        res.status(500).json({ error: 'Failed to load questionnaire data' });
      }
    });

    // Annotate cells with Claude AI
    this.app.post('/api/annotate', async (req, res) => {
      try {
        const { cells, instruction, sheetName, questionnaireId } = req.body as AnnotationRequest;

        if (!cells || cells.length === 0) {
          return res.status(400).json({ error: 'No cells selected' });
        }
        if (!instruction || instruction.trim() === '') {
          return res.status(400).json({ error: 'No instruction provided' });
        }

        console.log(`\nAnnotation request: ${cells.length} cells, instruction: "${instruction}"`);

        // Load indexed data to get sections context
        let sections: AnnotationRequest['sections'] = [];
        if (questionnaireId) {
          try {
            const data = await this.loadQuestionnaireData(questionnaireId);
            if (data.indexed?.sections) {
              sections = data.indexed.sections.map((s: any) => ({
                name: s.name || s.title,
                topic: s.topic || 'general',
                sheet: s.sheet,
                rowRange: s.startRow && s.endRow ? `${s.startRow}-${s.endRow}` : undefined
              }));
            }
          } catch (e) {
            console.log('Could not load sections context:', e);
          }
        }

        const suggestion = await this.processAnnotation({ cells, instruction, sheetName, questionnaireId, sections });
        res.json({ success: true, suggestion });
      } catch (error) {
        console.error('Error processing annotation:', error);
        res.status(500).json({ error: 'Failed to process annotation' });
      }
    });

    // Apply a suggested change from annotation
    this.app.post('/api/annotate/apply', async (req, res) => {
      try {
        const { suggestion, questionnaireId } = req.body;

        if (!suggestion || !suggestion.items) {
          return res.status(400).json({ error: 'No suggestion to apply' });
        }

        // Apply the suggestion by adding items to feedback as 'created'
        const appliedItems: FeedbackItem[] = [];
        for (const item of suggestion.items) {
          const feedbackItem: FeedbackItem = {
            id: `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            action: 'accepted',
            label: item.label,
            value: item.value,
            cells: item.lCell && item.vCell ? `${item.lCell} → ${item.vCell}` : item.lCell,
            section: item.section,
            topic: item.topic,
            reason: `Created via annotation: ${suggestion.description}`,
            reviewedAt: new Date().toISOString()
          };

          this.feedback.index.push(feedbackItem);
          appliedItems.push(feedbackItem);
        }

        this.feedback.meta.lastUpdatedAt = new Date().toISOString();
        await this.saveFeedback();

        res.json({ success: true, applied: appliedItems.length });
      } catch (error) {
        console.error('Error applying annotation:', error);
        res.status(500).json({ error: 'Failed to apply annotation' });
      }
    });

    // Serve the single-page app at root
    this.app.get('/', (req, res) => {
      const indexPath = join(this.reviewDir, 'index.html');
      if (existsSync(indexPath)) {
        res.sendFile(indexPath, { root: process.cwd() });
      } else {
        res.status(404).send('Review app not found. Run the review command first.');
      }
    });
  }

  private async saveFeedback(): Promise<void> {
    const dir = dirname(this.feedbackPath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.feedbackPath, JSON.stringify(this.feedback, null, 2), 'utf-8');
    console.log(`Saved feedback to ${this.feedbackPath}`);
  }

  private async loadFeedback(): Promise<void> {
    try {
      if (existsSync(this.feedbackPath)) {
        const content = await readFile(this.feedbackPath, 'utf-8');
        this.feedback = JSON.parse(content);
        console.log(`Loaded ${this.feedback.index.length} index + ${this.feedback.library.length} library feedback items`);
      }
    } catch (error) {
      console.error('Error loading feedback:', error);
      this.feedback = this.createEmptyFeedback();
    }
  }

  private async generateRules(): Promise<{ indexRules: any; harvestRules: any }> {
    const indexRejected = this.feedback.index.filter(f => f.action === 'rejected');
    const indexEdited = this.feedback.index.filter(f => f.action === 'edited');
    const libRejected = this.feedback.library.filter(f => f.action === 'rejected');
    const libEdited = this.feedback.library.filter(f => f.action === 'edited');

    const indexRules = {
      version: '1.0',
      updatedAt: new Date().toISOString().split('T')[0],
      source: this.questionnaire,
      exclude: indexRejected.map(f => ({
        label: f.label,
        cells: f.cells,
        reason: f.reason || 'Rejected during review',
        reviewedAt: f.reviewedAt
      })),
      corrections: indexEdited.map(f => ({
        match: { label: f.label, cells: f.cells },
        correct: {
          label: f.editedLabel || f.label,
          value: f.editedValue || f.value
        },
        reviewedAt: f.reviewedAt
      }))
    };

    const harvestRules = {
      version: '1.0',
      updatedAt: new Date().toISOString().split('T')[0],
      source: this.questionnaire,
      exclude: libRejected.map(f => ({
        label: f.label,
        topic: f.topic,
        reason: f.reason || 'Rejected during review',
        reviewedAt: f.reviewedAt
      })),
      corrections: libEdited.map(f => ({
        match: { label: f.label, topic: f.topic },
        correct: {
          label: f.editedLabel || f.label,
          value: f.editedValue || f.value
        },
        reviewedAt: f.reviewedAt
      }))
    };

    return { indexRules, harvestRules };
  }

  private async saveRules(rules: { indexRules: any; harvestRules: any }): Promise<void> {
    const rulesDir = './rules';
    await mkdir(rulesDir, { recursive: true });

    // Load existing rules and merge
    const indexRulesPath = join(rulesDir, 'index-rules.yaml');
    const harvestRulesPath = join(rulesDir, 'harvest-rules.yaml');

    let existingIndexRules: any = { version: '1.0', exclude: [], corrections: [] };
    let existingHarvestRules: any = { version: '1.0', exclude: [], corrections: [] };

    try {
      if (existsSync(indexRulesPath)) {
        existingIndexRules = parseYaml(await readFile(indexRulesPath, 'utf-8'));
      }
    } catch {}

    try {
      if (existsSync(harvestRulesPath)) {
        existingHarvestRules = parseYaml(await readFile(harvestRulesPath, 'utf-8'));
      }
    } catch {}

    // Merge rules (avoid duplicates by cells/label)
    const mergeRules = (existing: any[], newItems: any[], key: string) => {
      const merged = [...existing];
      for (const item of newItems) {
        const exists = merged.some(e => e[key] === item[key] || (e.label === item.label && e.cells === item.cells));
        if (!exists) {
          merged.push(item);
        }
      }
      return merged;
    };

    existingIndexRules.exclude = mergeRules(existingIndexRules.exclude || [], rules.indexRules.exclude, 'cells');
    existingIndexRules.corrections = mergeRules(existingIndexRules.corrections || [], rules.indexRules.corrections, 'cells');
    existingIndexRules.updatedAt = new Date().toISOString().split('T')[0];

    existingHarvestRules.exclude = mergeRules(existingHarvestRules.exclude || [], rules.harvestRules.exclude, 'label');
    existingHarvestRules.corrections = mergeRules(existingHarvestRules.corrections || [], rules.harvestRules.corrections, 'label');
    existingHarvestRules.updatedAt = new Date().toISOString().split('T')[0];

    await writeFile(indexRulesPath, stringifyYaml(existingIndexRules), 'utf-8');
    await writeFile(harvestRulesPath, stringifyYaml(existingHarvestRules), 'utf-8');

    console.log(`Saved rules to ${indexRulesPath} and ${harvestRulesPath}`);
  }

  /**
   * Generate preview of what will be exported
   */
  private generateExportPreview(): { entityDb: any[]; answerLibrary: any[]; productDb: any[] } {
    const indexAccepted = this.feedback.index.filter(f => f.action === 'accepted');
    const indexEdited = this.feedback.index.filter(f => f.action === 'edited');
    const libAccepted = this.feedback.library.filter(f => f.action === 'accepted');
    const libEdited = this.feedback.library.filter(f => f.action === 'edited');

    // Also include destination_changed items (they were moved but may not have accept/reject)
    const destChanged = this.feedback.library.filter(f => f.action === 'destination_changed');

    // Entity DB topics (company-level data) - used as fallback when no destination specified
    const entityTopics = ['company', 'contacts', 'certifications', 'financial', 'approval', 'signature'];

    // Separate entity-level from answer-library items
    const entityDb: any[] = [];
    const productDb: any[] = [];
    const answerLibrary: any[] = [];

    // Helper to determine destination
    const getDestination = (item: any) => {
      // If destination explicitly set by user, use it
      if (item.destination) {
        return item.destination;
      }
      // Fallback to topic-based detection
      const topic = item.topic || 'other';
      if (entityTopics.includes(topic)) {
        return 'company';
      }
      return 'answer_library';
    };

    // Process index items
    for (const item of [...indexAccepted, ...indexEdited]) {
      const topic = item.topic || 'other';
      const destination = getDestination(item);
      const entry = {
        label: item.editedLabel || item.label,
        value: item.editedValue || item.value,
        cells: item.cells,
        section: item.section,
        topic,
        destination,
        source: this.questionnaire,
        approvedAt: item.reviewedAt
      };

      if (destination === 'company') {
        entityDb.push(entry);
      } else if (destination === 'product') {
        productDb.push(entry);
      } else {
        answerLibrary.push(entry);
      }
    }

    // Process library items - respect user-defined destination
    for (const item of [...libAccepted, ...libEdited, ...destChanged]) {
      const destination = getDestination(item);
      const entry = {
        label: item.editedLabel || item.label,
        value: item.editedValue || item.value,
        cells: item.cells,
        topic: item.topic || 'other',
        destination,
        source: this.questionnaire,
        approvedAt: item.reviewedAt
      };

      if (destination === 'company') {
        entityDb.push(entry);
      } else if (destination === 'product') {
        productDb.push(entry);
      } else {
        answerLibrary.push(entry);
      }
    }

    return { entityDb, answerLibrary, productDb };
  }

  /**
   * Export approved items to database files
   */
  private async exportApproved(): Promise<{
    entityDb: any[];
    productDb: any[];
    answerLibrary: any[];
    paths: { entityDb: string; productDb: string; answerLibrary: string }
  }> {
    const { entityDb, productDb, answerLibrary } = this.generateExportPreview();

    // Create export directory
    const exportDir = './approved-exports';
    const safeName = this.questionnaire.replace(/[^a-zA-Z0-9-_]/g, '_');
    const questionnaireDir = join(exportDir, safeName);
    await mkdir(questionnaireDir, { recursive: true });

    const timestamp = new Date().toISOString();

    // Save Entity DB export (company-level data)
    const entityDbPath = join(questionnaireDir, 'entity-db.json');
    const entityDbExport = {
      meta: {
        source: this.questionnaire,
        exportedAt: timestamp,
        version: '1.0'
      },
      items: entityDb
    };
    await writeFile(entityDbPath, JSON.stringify(entityDbExport, null, 2), 'utf-8');

    // Save Product DB export (product-level data)
    const productDbPath = join(questionnaireDir, 'product-db.json');
    const productDbExport = {
      meta: {
        source: this.questionnaire,
        exportedAt: timestamp,
        version: '1.0'
      },
      items: productDb
    };
    await writeFile(productDbPath, JSON.stringify(productDbExport, null, 2), 'utf-8');

    // Save Answer Library export
    const answerLibraryPath = join(questionnaireDir, 'answer-library.json');
    const answerLibraryExport = {
      meta: {
        source: this.questionnaire,
        exportedAt: timestamp,
        version: '1.0'
      },
      items: answerLibrary
    };
    await writeFile(answerLibraryPath, JSON.stringify(answerLibraryExport, null, 2), 'utf-8');

    console.log(`Exported ${entityDb.length} entity (company) items to ${entityDbPath}`);
    console.log(`Exported ${productDb.length} product items to ${productDbPath}`);
    console.log(`Exported ${answerLibrary.length} library items to ${answerLibraryPath}`);

    return {
      entityDb,
      productDb,
      answerLibrary,
      paths: {
        entityDb: entityDbPath,
        productDb: productDbPath,
        answerLibrary: answerLibraryPath
      }
    };
  }

  /**
   * List all available questionnaires from indexed folder
   */
  private async listQuestionnaires(): Promise<Array<{
    name: string;
    displayName: string;
    hasReview: boolean;
    reviewUrl?: string;
    indexed: boolean;
    feedbackCount?: number;
  }>> {
    const indexedDir = './indexed';
    const questionnaires: Array<{
      name: string;
      displayName: string;
      hasReview: boolean;
      reviewUrl?: string;
      indexed: boolean;
      feedbackCount?: number;
    }> = [];

    try {
      const files = await readdir(indexedDir);

      // Also list review HTML files to match against
      let reviewFiles: string[] = [];
      try {
        reviewFiles = await readdir(this.reviewDir);
      } catch {}

      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

        const name = file.replace(/\.(yaml|yml)$/, '');
        const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');

        // Find matching review HTML file (may have _xlsx or other suffixes)
        const reviewFile = reviewFiles.find(f =>
          f.endsWith('_review.html') &&
          (f.startsWith(safeName) || f.includes(safeName))
        );
        const hasReview = !!reviewFile;

        // Check feedback count
        let feedbackCount = 0;
        const feedbackPath = join(this.reviewDir, safeName, 'feedback.json');
        if (existsSync(feedbackPath)) {
          try {
            const feedbackData = JSON.parse(await readFile(feedbackPath, 'utf-8'));
            feedbackCount = (feedbackData.index?.length || 0) + (feedbackData.library?.length || 0);
          } catch {}
        }

        // Create display name (shorter, more readable)
        const displayName = name
          .replace(/_/g, ' ')
          .replace(/\d{8}/, (d) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`)
          .replace(/  +/g, ' ')
          .trim();

        questionnaires.push({
          name,
          displayName,
          hasReview,
          reviewUrl: hasReview ? reviewFile : undefined,
          indexed: true,
          feedbackCount
        });
      }
    } catch (error) {
      console.error('Error reading indexed directory:', error);
    }

    return questionnaires;
  }

  /**
   * Load all data for a specific questionnaire (structure + indexed + library)
   */
  private async loadQuestionnaireData(questionnaireId: string): Promise<{
    id: string;
    structure: any;
    indexed: any;
    library: any;
    feedback: FeedbackData | null;
  }> {
    const safeName = questionnaireId.replace(/[^a-zA-Z0-9-_]/g, '_');

    // Load structure (questionnaires/*.json)
    const structurePath = join('./questionnaires', `${safeName}.json`);
    let structure = null;
    if (existsSync(structurePath)) {
      structure = JSON.parse(await readFile(structurePath, 'utf-8'));
    }

    // Load indexed (indexed/*.yaml)
    const indexedPath = join('./indexed', `${safeName}.yaml`);
    let indexed = null;
    if (existsSync(indexedPath)) {
      indexed = parseYaml(await readFile(indexedPath, 'utf-8'));
    }

    // Load library (answer-library.yaml)
    const libraryPath = './answer-library.yaml';
    let library = null;
    if (existsSync(libraryPath)) {
      library = parseYaml(await readFile(libraryPath, 'utf-8'));
    }

    // Load feedback for this questionnaire
    const feedbackPath = join(this.reviewDir, safeName, 'feedback.json');
    let feedback = null;
    if (existsSync(feedbackPath)) {
      feedback = JSON.parse(await readFile(feedbackPath, 'utf-8'));
    }

    return {
      id: questionnaireId,
      structure,
      indexed,
      library,
      feedback
    };
  }

  /**
   * Process an annotation request using Claude
   */
  private async processAnnotation(request: AnnotationRequest): Promise<SuggestedChange> {
    const { cells, instruction, sheetName, sections } = request;

    // Build a representation of the selected cells
    const cellsDescription = cells.map(c => `${c.id}: "${c.value}"`).join('\n');

    // Build sections context
    let sectionsContext = '';
    if (sections && sections.length > 0) {
      sectionsContext = `\n## Existing Sections in this questionnaire:
${sections.map(s => `- "${s.name}" (topic: ${s.topic}${s.rowRange ? `, rows ${s.rowRange}` : ''})`).join('\n')}

You MUST assign each item to one of these existing sections based on the cell row numbers and content.
`;
    }

    const prompt = `You are helping a user organize data extracted from an Excel questionnaire.

## Selected Cells (from sheet "${sheetName || 'Unknown'}"):
${cellsDescription}
${sectionsContext}
## User Instruction:
${instruction}

## Task:
Interpret the user's instruction and suggest how to structure this data.
The data will be stored as label/value pairs for future auto-filling of similar questionnaires.

Common actions:
- "create": Create new label/value item(s) from the selected cells
- "merge": Combine multiple cells into one item
- "split": Split one cell into multiple items
- "update": Change how an existing item is labeled/stored

Respond in this exact JSON format:
{
  "action": "create|merge|split|update|delete",
  "description": "Brief description of what will be done",
  "items": [
    {
      "label": "The label/question (human-readable)",
      "value": "The value/answer",
      "lCell": "Cell reference for label (e.g., B10)",
      "vCell": "Cell reference for value (e.g., C10)",
      "section": "Name of the section this belongs to (must match an existing section name)",
      "topic": "Topic category (company, contacts, certifications, financial, quality, sustainability, other)",
      "level": "standard|narrative|product"
    }
  ],
  "reasoning": "Explanation of why this interpretation makes sense"
}

Only respond with the JSON, no other text.`;

    try {
      const response = await this.bedrockClient.send(new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      }));

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text = responseBody.content[0].text;

      // Parse the JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const suggestion = JSON.parse(jsonMatch[0]) as SuggestedChange;
      console.log('Claude suggestion:', JSON.stringify(suggestion, null, 2));

      return suggestion;
    } catch (error) {
      console.error('Error calling Claude:', error);
      // Return a fallback suggestion based on basic interpretation
      return this.createFallbackSuggestion(cells, instruction);
    }
  }

  /**
   * Create a fallback suggestion when Claude call fails
   */
  private createFallbackSuggestion(cells: AnnotationRequest['cells'], instruction: string): SuggestedChange {
    // Simple heuristic: if 2 cells, assume first is label, second is value
    if (cells.length === 2) {
      return {
        action: 'create',
        description: 'Create item from selected cells (fallback)',
        items: [{
          label: cells[0].value,
          value: cells[1].value,
          lCell: cells[0].id,
          vCell: cells[1].id,
          topic: 'other',
          level: 'standard'
        }],
        reasoning: 'Claude API unavailable - using simple label/value assumption'
      };
    }

    // Multiple cells: create separate items or note for manual review
    return {
      action: 'create',
      description: 'Manual review needed',
      items: cells.map(c => ({
        label: c.value.substring(0, 50),
        value: c.value,
        lCell: c.id,
        topic: 'other',
        level: 'standard'
      })),
      reasoning: 'Claude API unavailable - cells listed for manual organization'
    };
  }

  async start(): Promise<void> {
    // Load existing feedback
    await this.loadFeedback();

    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`\nPassionfruit Review Server running at http://localhost:${this.port}`);
        if (this.questionnaire) {
          console.log(`Default questionnaire: ${this.questionnaire}`);
        }
        console.log(`\nAPI endpoints:`);
        console.log(`  GET  /                      - Review app (single-page)`);
        console.log(`  GET  /api/health            - Health check`);
        console.log(`  GET  /api/questionnaires    - List all questionnaires`);
        console.log(`  GET  /api/questionnaire/:id - Get questionnaire data`);
        console.log(`  GET  /api/status            - Review status`);
        console.log(`  GET  /api/feedback          - Get all feedback`);
        console.log(`  POST /api/feedback          - Save feedback item`);
        console.log(`  POST /api/feedback/bulk     - Save multiple items`);
        console.log(`  DELETE /api/feedback        - Clear all feedback`);
        console.log(`  POST /api/apply-rules       - Apply rules from feedback`);
        console.log(`  GET  /api/rules/preview     - Preview generated rules`);
        console.log(`  POST /api/export-approved   - Export approved to DB files`);
        console.log(`\nPress Ctrl+C to stop\n`);
        resolve();
      });
    });
  }

  openBrowser(path: string = ''): void {
    // Handle new URL format: root with optional query parameter
    // path can be: '' (welcome), '?q=questionnaire-id', or legacy 'filename.html'
    let url: string;
    if (path.startsWith('?') || path === '') {
      url = `http://localhost:${this.port}/${path}`;
    } else {
      // Legacy: direct HTML file path
      url = `http://localhost:${this.port}/review/${path}`;
    }
    console.log(`Opening browser: ${url}`);

    const command = process.platform === 'darwin' ? 'open' :
                   process.platform === 'win32' ? 'start' : 'xdg-open';

    exec(`${command} "${url}"`, (error) => {
      if (error) {
        console.log(`Could not open browser automatically. Please open: ${url}`);
      }
    });
  }
}
