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

// Types
export interface FeedbackItem {
  id: string;
  action: 'accepted' | 'rejected' | 'edited';
  label: string;
  value?: string;
  cells?: string;
  section?: string;
  topic?: string;
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

// Server class
export class ReviewServer {
  private app: express.Application;
  private port: number;
  private questionnaire: string;
  private reviewDir: string;
  private feedbackPath: string;
  private feedback: FeedbackData;

  constructor(questionnaire: string, options: { port?: number; reviewDir?: string } = {}) {
    this.questionnaire = questionnaire;
    this.port = options.port || 3456;
    this.reviewDir = options.reviewDir || './review';

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
        const { panel, item } = req.body;

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

        // Add to appropriate list (replace if same cells exist)
        const list = panel === 'library' ? this.feedback.library : this.feedback.index;
        const existingIndex = list.findIndex(f => f.cells === item.cells && f.label === item.label);

        if (existingIndex >= 0) {
          list[existingIndex] = item;
        } else {
          list.push(item);
        }

        // Update timestamp
        this.feedback.meta.lastUpdatedAt = new Date().toISOString();

        // Auto-save
        await this.saveFeedback();

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
  private generateExportPreview(): { entityDb: any[]; answerLibrary: any[] } {
    const indexAccepted = this.feedback.index.filter(f => f.action === 'accepted');
    const indexEdited = this.feedback.index.filter(f => f.action === 'edited');
    const libAccepted = this.feedback.library.filter(f => f.action === 'accepted');
    const libEdited = this.feedback.library.filter(f => f.action === 'edited');

    // Entity DB topics (company-level data)
    const entityTopics = ['company', 'contacts', 'certifications', 'financial', 'approval', 'signature'];

    // Separate entity-level from answer-library items
    const entityDb: any[] = [];
    const answerLibrary: any[] = [];

    // Process index items
    for (const item of [...indexAccepted, ...indexEdited]) {
      const topic = item.topic || 'other';
      const entry = {
        label: item.editedLabel || item.label,
        value: item.editedValue || item.value,
        cells: item.cells,
        section: item.section,
        topic,
        source: this.questionnaire,
        approvedAt: item.reviewedAt
      };

      if (entityTopics.includes(topic)) {
        entityDb.push(entry);
      } else {
        answerLibrary.push(entry);
      }
    }

    // Process library items (all go to answer library)
    for (const item of [...libAccepted, ...libEdited]) {
      answerLibrary.push({
        label: item.editedLabel || item.label,
        value: item.editedValue || item.value,
        cells: item.cells,
        topic: item.topic || 'other',
        source: this.questionnaire,
        approvedAt: item.reviewedAt
      });
    }

    return { entityDb, answerLibrary };
  }

  /**
   * Export approved items to database files
   */
  private async exportApproved(): Promise<{ entityDb: any[]; answerLibrary: any[]; paths: { entityDb: string; answerLibrary: string } }> {
    const { entityDb, answerLibrary } = this.generateExportPreview();

    // Create export directory
    const exportDir = './approved-exports';
    const safeName = this.questionnaire.replace(/[^a-zA-Z0-9-_]/g, '_');
    const questionnaireDir = join(exportDir, safeName);
    await mkdir(questionnaireDir, { recursive: true });

    const timestamp = new Date().toISOString();

    // Save Entity DB export
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

    console.log(`Exported ${entityDb.length} entity items to ${entityDbPath}`);
    console.log(`Exported ${answerLibrary.length} library items to ${answerLibraryPath}`);

    return {
      entityDb,
      answerLibrary,
      paths: {
        entityDb: entityDbPath,
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

      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

        const name = file.replace(/\.(yaml|yml)$/, '');
        const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');

        // Check if review HTML exists
        const reviewHtmlPath = join(this.reviewDir, `${safeName}_review.html`);
        const hasReview = existsSync(reviewHtmlPath);

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
          reviewUrl: hasReview ? `${safeName}_review.html` : undefined,
          indexed: true,
          feedbackCount
        });
      }
    } catch (error) {
      console.error('Error reading indexed directory:', error);
    }

    return questionnaires;
  }

  async start(): Promise<void> {
    // Load existing feedback
    await this.loadFeedback();

    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`\nReview server running at http://localhost:${this.port}`);
        console.log(`Questionnaire: ${this.questionnaire}`);
        console.log(`\nAPI endpoints:`);
        console.log(`  GET  /api/health           - Health check`);
        console.log(`  GET  /api/questionnaires   - List all questionnaires`);
        console.log(`  GET  /api/status           - Review status`);
        console.log(`  GET  /api/feedback         - Get all feedback`);
        console.log(`  POST /api/feedback         - Save feedback item`);
        console.log(`  POST /api/feedback/bulk    - Save multiple items`);
        console.log(`  DELETE /api/feedback       - Clear all feedback`);
        console.log(`  POST /api/apply-rules      - Apply rules from feedback`);
        console.log(`  GET  /api/rules/preview    - Preview generated rules`);
        console.log(`  POST /api/export-approved  - Export approved to DB files`);
        console.log(`  GET  /api/export-approved/preview - Preview export`);
        console.log(`\nPress Ctrl+C to stop\n`);
        resolve();
      });
    });
  }

  openBrowser(htmlPath: string): void {
    const url = `http://localhost:${this.port}/review/${htmlPath}`;
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
