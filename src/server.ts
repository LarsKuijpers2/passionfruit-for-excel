/**
 * Review Server
 *
 * Local Express server for the review interface.
 * Handles auto-saving feedback and applying rules.
 */

import express from 'express';
import cors from 'cors';
import { readFile, writeFile, mkdir, readdir, rename } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { existsSync, writeFileSync, renameSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { exec } from 'child_process';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Types
export type EntityRole = 'supplier' | 'client' | 'manufacturer' | 'other';

export interface FeedbackItem {
  id: string;
  action: 'accepted' | 'rejected' | 'edited' | 'destination_changed' | 'entity_role_changed' | 'promoted';
  label: string;
  value?: string;
  cells?: string;
  section?: string;
  topic?: string;
  destination?: string;
  promotedTo?: string;
  entityRole?: EntityRole;
  reason?: string;
  editedLabel?: string;
  editedValue?: string;
  reviewedAt: string;
  _panel?: 'index' | 'library';  // Which panel this feedback item came from
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
  // Write locks to prevent concurrent file writes causing corruption
  private writeLocks: Map<string, Promise<void>> = new Map();

  constructor(questionnaire?: string, options: { port?: number; reviewDir?: string } = {}) {
    this.questionnaire = questionnaire || '';
    this.port = options.port || 3456;
    this.reviewDir = options.reviewDir || './review';

    // Initialize Bedrock client for Claude annotations
    this.bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'eu-central-1' });
    this.modelId = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';

    // Create safe folder name from questionnaire (only if provided)
    if (questionnaire) {
      const safeName = questionnaire.replace(/[^a-zA-Z0-9-_]/g, '_');
      const feedbackDir = join(this.reviewDir, safeName);
      this.feedbackPath = join(feedbackDir, 'feedback.json');
    } else {
      this.feedbackPath = '';
    }

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

    // Serve React app from frontend/dist
    const reactAppPath = join(process.cwd(), 'frontend', 'dist');
    if (existsSync(reactAppPath)) {
      this.app.use(express.static(reactAppPath));
    }

    // Serve static review HTML files (legacy)
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

        // Store the panel in the item so we can identify its source later
        // This is critical for restoring promoted items from the index panel
        item._panel = panel;

        // Determine which questionnaire's feedback to update
        const targetQuestionnaire = questionnaire || this.questionnaire;
        const safeName = targetQuestionnaire.replace(/[^a-zA-Z0-9-_]/g, '_');
        const feedbackPath = join(this.reviewDir, safeName, 'feedback.json');

        // Use write lock to prevent concurrent file corruption
        await this.withWriteLock(feedbackPath, async () => {
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

          // Add to appropriate list (replace if same ID or cells+label exist)
          const list = panel === 'library' ? feedback.library : feedback.index;
          // Prefer ID matching if available, fall back to cells+label
          const existingIndex = list.findIndex(f =>
            (item.id && (f as any).id === item.id) ||
            (!item.id && f.cells === item.cells && f.label === item.label)
          );

          if (existingIndex >= 0) {
            list[existingIndex] = item;
          } else {
            list.push(item);
          }

          // Update timestamp
          feedback.meta.lastUpdatedAt = new Date().toISOString();

          // Save to questionnaire-specific path using atomic write
          await mkdir(dirname(feedbackPath), { recursive: true });
          this.atomicWriteFileSync(feedbackPath, JSON.stringify(feedback, null, 2));
          console.log(`Saved feedback to ${feedbackPath}`);
        });

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
        const { questionnaire } = req.body || {};
        const targetQuestionnaire = questionnaire || this.questionnaire;

        // Load feedback for the target questionnaire
        const safeName = targetQuestionnaire.replace(/[^a-zA-Z0-9-_]/g, '_');
        const feedbackPath = join(this.reviewDir, safeName, 'feedback.json');

        if (existsSync(feedbackPath)) {
          this.feedback = JSON.parse(await readFile(feedbackPath, 'utf-8'));
          this.questionnaire = targetQuestionnaire;
          this.feedbackPath = feedbackPath;
        }

        console.log(`Exporting ${targetQuestionnaire} with ${this.feedback.index.length} index + ${this.feedback.library.length} library items`);

        const exported = await this.exportApproved();
        console.log(`Exported: ${exported.entityDb.length} entity, ${exported.productDb.length} product, ${exported.answerLibrary.length} library items`);

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

    // Export indexed items grouped by destination (Company, Library, Product, Exclude)
    this.app.post('/api/export-grouped/:questionnaireId', async (req, res) => {
      try {
        const { questionnaireId } = req.params;
        const safeName = questionnaireId.replace(/[^a-zA-Z0-9-_]/g, '_');

        // Helper to find file in root or customer directories
        const findFile = async (rootDir: string, filename: string): Promise<{ path: string; customer?: string } | null> => {
          // First check root directory
          const rootPath = join(rootDir, filename);
          if (existsSync(rootPath)) {
            return { path: rootPath };
          }

          // Then check all customer directories
          try {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerPath = join('./customers', customer, rootDir, filename);
              if (existsSync(customerPath)) {
                return { path: customerPath, customer };
              }
            }
          } catch {}

          return null;
        };

        // Load indexed data
        const indexedResult = await findFile('indexed', `${safeName}.json`);
        if (!indexedResult) {
          return res.status(404).json({ error: 'Indexed file not found' });
        }

        const indexed = JSON.parse(await readFile(indexedResult.path, 'utf-8'));

        // Group items by destination
        const grouped: Record<string, any[]> = {
          company: [],
          answer_library: [],
          product: [],
          exclude: []
        };

        for (const section of indexed.sections || []) {
          for (const item of section.items || []) {
            const destination = item.destination || 'answer_library';
            if (grouped[destination]) {
              grouped[destination].push({
                id: item.id,
                label: item.label,
                value: item.value,
                topic: item.topic,
                lCell: item.lCell,
                vCell: item.vCell,
                section: section.title
              });
            }
          }
        }

        // Get customer from indexed file location or questionnaire structure
        let customer = indexedResult.customer || 'default';
        if (customer === 'default') {
          const structureResult = await findFile('questionnaires', `${safeName}.json`);
          if (structureResult) {
            try {
              const structure = JSON.parse(await readFile(structureResult.path, 'utf-8'));
              const filepath = structure?.source?.filepath || '';
              const incomingMatch = filepath.match(/incoming[\/\\]([^\/\\]+)[\/\\][^\/\\]+$/);
              if (incomingMatch && incomingMatch[1]) {
                customer = incomingMatch[1].replace(/[^a-zA-Z0-9-_]/g, '-');
              } else if (structureResult.customer) {
                customer = structureResult.customer;
              }
            } catch {}
          }
        }

        // Create export directory and save
        const exportDir = join('./customers', customer, 'api-ready');
        await mkdir(exportDir, { recursive: true });

        const exportPath = join(exportDir, `${safeName}.json`);
        const exportData = {
          meta: {
            questionnaire: questionnaireId,
            source: indexed.source,
            customer,
            exportedAt: new Date().toISOString()
          },
          company: grouped.company,
          library: grouped.answer_library,
          product: grouped.product,
          exclude: grouped.exclude,
          stats: {
            company: grouped.company.length,
            library: grouped.answer_library.length,
            product: grouped.product.length,
            exclude: grouped.exclude.length,
            total: grouped.company.length + grouped.answer_library.length + grouped.product.length + grouped.exclude.length
          }
        };

        await writeFile(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');
        console.log(`Exported grouped data to ${exportPath}`);

        res.json({
          success: true,
          path: exportPath,
          stats: exportData.stats
        });
      } catch (error) {
        console.error('Error exporting grouped data:', error);
        res.status(500).json({ error: 'Failed to export grouped data' });
      }
    });

    // Open source file
    this.app.post('/api/open-file/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        // Find the source file (JSON only)
        const indexedPath = join('./indexed', id + '.json');
        if (!existsSync(indexedPath)) {
          return res.status(404).json({ error: 'Indexed file not found' });
        }
        const indexed = JSON.parse(await readFile(indexedPath, 'utf-8'));
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

    // Update item destination in indexed JSON (persists changes)
    this.app.post('/api/update-destination', async (req, res) => {
      try {
        const { questionnaireId, itemId, destination } = req.body;
        console.log(`Update destination: ${questionnaireId} / ${itemId} -> ${destination}`);

        if (!questionnaireId || !itemId || !destination) {
          return res.status(400).json({ error: 'Missing questionnaireId, itemId, or destination' });
        }

        // Helper to find file in root or customer directories
        const findIndexedFile = async (filename: string): Promise<string | null> => {
          // First check root directory
          const rootPath = join('./indexed', filename);
          if (existsSync(rootPath)) {
            return rootPath;
          }

          // Then check all customer directories
          try {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerPath = join('./customers', customer, 'indexed', filename);
              if (existsSync(customerPath)) {
                return customerPath;
              }
            }
          } catch {}

          return null;
        };

        // Load the indexed file (JSON only)
        const safeName = questionnaireId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const indexedPath = await findIndexedFile(`${safeName}.json`);

        if (!indexedPath) {
          return res.status(404).json({ error: `Indexed file not found: ${safeName}.json` });
        }

        const indexed = JSON.parse(await readFile(indexedPath, 'utf-8'));

        // Find and update the item
        let found = false;
        for (const section of indexed.sections || []) {
          for (const item of section.items || []) {
            if (item.id === itemId) {
              item.destination = destination;
              item.needs_review = false;
              item.tag_source = 'manual';
              found = true;
              break;
            }
          }
          if (found) break;
        }

        if (!found) {
          return res.status(404).json({ error: 'Item not found' });
        }

        // Save back to file (JSON only)
        await writeFile(indexedPath, JSON.stringify(indexed, null, 2), 'utf-8');
        console.log(`Updated destination for ${itemId} to ${destination} in ${indexedPath}`);

        // Regenerate the HTML review file
        try {
          const { WebReviewGenerator } = await import('./services/review/web-generator.js');
          const generator = new WebReviewGenerator(this.reviewDir);
          // Also search for structure file in customer directories
          let structurePath = join('./questionnaires', `${safeName}.json`);
          if (!existsSync(structurePath)) {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerStructurePath = join('./customers', customer, 'questionnaires', `${safeName}.json`);
              if (existsSync(customerStructurePath)) {
                structurePath = customerStructurePath;
                break;
              }
            }
          }
          const libraryPath = './answer-library.yaml';
          await generator.generate(structurePath, indexedPath, libraryPath);
          console.log(`Regenerated HTML for ${questionnaireId}`);
        } catch (e) {
          console.error('Failed to regenerate HTML:', e);
          // Don't fail the request, YAML was still updated
        }

        res.json({ success: true, itemId, destination });
      } catch (error) {
        console.error('Error updating destination:', error);
        res.status(500).json({ error: 'Failed to update destination' });
      }
    });

    // Bulk update items in indexed JSON (persists changes)
    this.app.patch('/api/questionnaire/:questionnaireId/:panel/bulk', async (req, res) => {
      try {
        const { questionnaireId, panel } = req.params;
        const { itemIds, updates } = req.body;
        console.log(`Bulk update: ${questionnaireId} / ${panel} - ${itemIds.length} items`);

        if (!questionnaireId || !itemIds || !Array.isArray(itemIds) || !updates) {
          return res.status(400).json({ error: 'Missing questionnaireId, itemIds, or updates' });
        }

        if (panel !== 'indexed' && panel !== 'library') {
          return res.status(400).json({ error: 'Invalid panel type' });
        }

        // For now, only support indexed panel updates
        if (panel === 'library') {
          return res.status(501).json({ error: 'Library updates not yet implemented' });
        }

        // Helper to find file in root or customer directories
        const findIndexedFile = async (filename: string): Promise<string | null> => {
          // First check root directory
          const rootPath = join('./indexed', filename);
          if (existsSync(rootPath)) {
            return rootPath;
          }

          // Then check all customer directories
          try {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerPath = join('./customers', customer, 'indexed', filename);
              if (existsSync(customerPath)) {
                return customerPath;
              }
            }
          } catch {}

          return null;
        };

        // Load the indexed file (JSON only)
        const safeName = questionnaireId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const indexedPath = await findIndexedFile(`${safeName}.json`);

        if (!indexedPath) {
          return res.status(404).json({ error: `Indexed file not found: ${safeName}.json` });
        }

        const indexed = JSON.parse(await readFile(indexedPath, 'utf-8'));

        // Create a set of itemIds for fast lookup
        const itemIdSet = new Set(itemIds);
        let updatedCount = 0;

        // Find and update the items
        for (const section of indexed.sections || []) {
          for (const item of section.items || []) {
            if (itemIdSet.has(item.id)) {
              // Apply updates to the item
              for (const [key, value] of Object.entries(updates)) {
                item[key] = value;
              }
              updatedCount++;
            }
          }
        }

        // Save back to file (JSON only)
        await writeFile(indexedPath, JSON.stringify(indexed, null, 2), 'utf-8');
        console.log(`Bulk updated ${updatedCount} items in ${indexedPath}`);

        // Regenerate the HTML review file
        try {
          const { WebReviewGenerator } = await import('./services/review/web-generator.js');
          const generator = new WebReviewGenerator(this.reviewDir);
          // Also search for structure file in customer directories
          let structurePath = join('./questionnaires', `${safeName}.json`);
          if (!existsSync(structurePath)) {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerStructurePath = join('./customers', customer, 'questionnaires', `${safeName}.json`);
              if (existsSync(customerStructurePath)) {
                structurePath = customerStructurePath;
                break;
              }
            }
          }
          const libraryPath = './answer-library.yaml';
          await generator.generate(structurePath, indexedPath, libraryPath);
          console.log(`Regenerated HTML for ${questionnaireId}`);
        } catch (e) {
          console.error('Failed to regenerate HTML:', e);
          // Don't fail the request, YAML was still updated
        }

        res.json({ success: true, updatedCount });
      } catch (error) {
        console.error('Error bulk updating items:', error);
        res.status(500).json({ error: 'Failed to bulk update items' });
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
    // Serve React SPA index.html for root path
    this.app.get('/', (req, res) => {
      // Try React app first
      const reactIndexPath = join(process.cwd(), 'frontend', 'dist', 'index.html');
      if (existsSync(reactIndexPath)) {
        res.sendFile(reactIndexPath);
        return;
      }

      // Fall back to static HTML
      const staticIndexPath = join(this.reviewDir, 'index.html');
      if (existsSync(staticIndexPath)) {
        res.sendFile(staticIndexPath, { root: process.cwd() });
      } else {
        res.status(404).send('Review app not found. Build the React app with: cd frontend && npm run build');
      }
    });
  }

  private async saveFeedback(): Promise<void> {
    const dir = dirname(this.feedbackPath);
    await mkdir(dir, { recursive: true });
    this.atomicWriteFileSync(this.feedbackPath, JSON.stringify(this.feedback, null, 2));
    console.log(`Saved feedback to ${this.feedbackPath}`);
  }

  /**
   * Acquire a write lock for a specific file to prevent concurrent writes
   * Uses a proper queue to ensure serialized access
   */
  private async withWriteLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    // Get or create a queue for this file
    let queue = this.writeLocks.get(filePath);

    // Chain this operation after any pending operations
    const execute = async (): Promise<T> => {
      try {
        return await fn();
      } finally {
        // Clean up if this was the last operation
        const currentQueue = this.writeLocks.get(filePath);
        if (currentQueue === newQueue) {
          this.writeLocks.delete(filePath);
        }
      }
    };

    // Create new promise that waits for previous operations
    const newQueue = queue ? queue.then(execute, execute) : execute();
    this.writeLocks.set(filePath, newQueue as Promise<void>);

    return newQueue;
  }

  /**
   * Atomically write a file (write to temp, then rename)
   * This prevents partial writes from corrupting the file
   */
  private atomicWriteFileSync(filePath: string, content: string): void {
    const tempPath = filePath + '.tmp.' + Date.now();
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, filePath);
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

  private async generateRules(): Promise<{ extractionRules: any; tagRules: any }> {
    // Extraction panel feedback → extraction-rules.yaml
    const indexRejected = this.feedback.index.filter(f => f.action === 'rejected');
    const indexEdited = this.feedback.index.filter(f => f.action === 'edited');

    // Library/tagging panel feedback → tag-rules.yaml (destination tagging rules)
    const libRejected = this.feedback.library.filter(f => f.action === 'rejected');
    const libDestinationChanges = this.feedback.library.filter(f => f.action === 'destination_changed');

    // Extraction rules (what to extract, what to exclude)
    const extractionRules = {
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

    // Tag rules (destination routing patterns learned from review)
    // Add new pattern overrides based on destination changes and rejections
    const tagRulePatterns: Array<{ pattern: string; destination: string; source: string }> = [];

    // Learn from destination changes - if user sets a specific destination for a label pattern
    for (const f of libDestinationChanges) {
      if (f.destination && f.label) {
        // Create a pattern from the label (escape special chars, make case-insensitive)
        const pattern = f.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        tagRulePatterns.push({
          pattern,
          destination: f.destination,
          source: `learned from: ${f.label}`
        });
      }
    }

    // Rejections in library panel mean "exclude this item"
    for (const f of libRejected) {
      if (f.label) {
        const pattern = f.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        tagRulePatterns.push({
          pattern,
          destination: 'exclude',
          source: `rejected: ${f.reason || f.label}`
        });
      }
    }

    const tagRules = {
      version: '1.0',
      updatedAt: new Date().toISOString().split('T')[0],
      learned_patterns: tagRulePatterns
    };

    return { extractionRules, tagRules };
  }

  private async saveRules(rules: { extractionRules: any; tagRules: any }): Promise<void> {
    const rulesDir = './rules';
    await mkdir(rulesDir, { recursive: true });

    // Load existing rules and merge
    const extractionRulesPath = join(rulesDir, 'extraction-rules.yaml');
    const tagRulesPath = join(rulesDir, 'tag-rules.yaml');

    let existingExtractionRules: any = { version: '1.0', exclude: [], corrections: [] };
    let existingTagRules: any = { version: '1.0', pattern_overrides: [], topic_destinations: {} };

    try {
      if (existsSync(extractionRulesPath)) {
        existingExtractionRules = parseYaml(await readFile(extractionRulesPath, 'utf-8'));
      }
    } catch {}

    try {
      if (existsSync(tagRulesPath)) {
        existingTagRules = parseYaml(await readFile(tagRulesPath, 'utf-8'));
      }
    } catch {}

    // Merge extraction rules (avoid duplicates by cells/label)
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

    existingExtractionRules.exclude = mergeRules(existingExtractionRules.exclude || [], rules.extractionRules.exclude, 'cells');
    existingExtractionRules.corrections = mergeRules(existingExtractionRules.corrections || [], rules.extractionRules.corrections, 'cells');
    existingExtractionRules.updatedAt = new Date().toISOString().split('T')[0];

    // Merge tag rules - add learned patterns to pattern_overrides
    const existingPatterns = existingTagRules.pattern_overrides || [];
    const learnedPatterns = rules.tagRules.learned_patterns || [];

    for (const learned of learnedPatterns) {
      // Check if pattern already exists
      const exists = existingPatterns.some((p: any) => p.pattern === learned.pattern);
      if (!exists) {
        existingPatterns.push({
          pattern: learned.pattern,
          destination: learned.destination,
          // Add a comment showing this was learned
          _source: learned.source
        });
      }
    }

    existingTagRules.pattern_overrides = existingPatterns;
    existingTagRules.updatedAt = new Date().toISOString().split('T')[0];

    await writeFile(extractionRulesPath, stringifyYaml(existingExtractionRules), 'utf-8');
    await writeFile(tagRulesPath, stringifyYaml(existingTagRules), 'utf-8');

    console.log(`Saved extraction rules to ${extractionRulesPath}`);
    console.log(`Saved tag rules to ${tagRulesPath}`);
  }

  /**
   * Generate preview of what will be exported
   */
  private generateExportPreview(): { entityDb: any[]; answerLibrary: any[]; productDb: any[] } {
    // Entity DB topics (company-level data) - used as fallback when no destination specified
    const entityTopics = ['company', 'contacts', 'certifications', 'financial', 'approval', 'signature'];

    // Helper to determine destination
    const getDestination = (item: any) => {
      // If promotedTo is set (from promoted items), use it
      if (item.promotedTo) {
        return item.promotedTo;
      }
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

    // Merge all feedback and deduplicate by ID (preferred) or cells+label, keeping LATEST action
    // This ensures that if an item was accepted then rejected, we use the final state
    const allItems = [...this.feedback.index, ...this.feedback.library];
    const deduped = new Map<string, FeedbackItem>();

    for (const item of allItems) {
      // Create unique key from ID (preferred) or cells + label (fallback)
      const key = (item as any).id || `${item.cells}|${item.label}`;
      const existing = deduped.get(key);

      // Keep the item with the latest reviewedAt timestamp
      if (!existing || new Date(item.reviewedAt) > new Date(existing.reviewedAt)) {
        deduped.set(key, item);
      }
    }

    // Filter to only exportable actions (exclude rejected)
    const exportableActions = ['accepted', 'edited', 'destination_changed', 'promoted'];
    const exportable = Array.from(deduped.values()).filter(item => exportableActions.includes(item.action));

    // Separate entity-level from answer-library items
    const entityDb: any[] = [];
    const productDb: any[] = [];
    const answerLibrary: any[] = [];

    // Process deduplicated items
    for (const item of exportable) {
      const topic = item.topic || 'other';
      const destination = getDestination(item);

      // Skip excluded items - they should not be exported
      if (destination === 'exclude') {
        continue;
      }

      // Skip items with empty values - nothing to export
      const value = item.editedValue || item.value || '';
      if (!value || value.trim() === '' || value.trim() === '(empty)') {
        continue;
      }

      // Parse cells from "A8 → C9" format to separate lCells and vCells
      let lCells: string | undefined;
      let vCells: string | undefined;
      if (item.cells) {
        const parts = item.cells.split(/\s*→\s*/);
        lCells = parts[0]?.trim();
        vCells = parts[1]?.trim() || lCells; // If no arrow, both are the same cell
      }

      const entry: any = {
        label: item.editedLabel || item.label,
        value: item.editedValue || item.value,
        lCells,
        vCells,
        section: item.section,
        topic,
        destination,
        source: this.questionnaire,
        approvedAt: item.reviewedAt
      };

      // Include entityRole for company items
      if (destination === 'company' && item.entityRole) {
        entry.entityRole = item.entityRole;
      }

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
   * Structure: customers/<customer>/approved/<questionnaire>/
   */
  private async exportApproved(): Promise<{
    entityDb: any[];
    productDb: any[];
    answerLibrary: any[];
    paths: { entityDb: string; productDb: string; answerLibrary: string }
  }> {
    const { entityDb, productDb, answerLibrary } = this.generateExportPreview();

    // Try to get customer folder from questionnaire structure
    let customerFolder = 'default';
    const safeName = this.questionnaire.replace(/[^a-zA-Z0-9-_]/g, '_');

    try {
      const structurePath = join('./questionnaires', `${safeName}.json`);
      if (existsSync(structurePath)) {
        const structure = JSON.parse(await readFile(structurePath, 'utf-8'));
        const filepath = structure?.source?.filepath || '';

        // Extract customer folder from path: incoming/<customer>/file.xlsx
        const incomingMatch = filepath.match(/incoming[\/\\]([^\/\\]+)[\/\\][^\/\\]+$/);
        if (incomingMatch && incomingMatch[1]) {
          customerFolder = incomingMatch[1].replace(/[^a-zA-Z0-9-_]/g, '_');
        }
      }
    } catch (e) {
      console.log('Could not determine customer folder, using default');
    }

    // Create export directory: customers/<customer>/approved/<questionnaire>/
    const exportDir = './customers';
    const questionnaireDir = join(exportDir, customerFolder, 'approved', safeName);
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
   * List all available questionnaires from indexed folder and customer folders
   */
  private async listQuestionnaires(): Promise<Array<{
    name: string;
    displayName: string;
    hasReview: boolean;
    reviewUrl?: string;
    indexed: boolean;
    feedbackCount?: number;
    customer?: string;
    lastExported?: string;
  }>> {
    const questionnaires: Array<{
      name: string;
      displayName: string;
      hasReview: boolean;
      reviewUrl?: string;
      indexed: boolean;
      feedbackCount?: number;
      customer?: string;
      lastExported?: string;
    }> = [];

    // Also list review HTML files to match against
    let reviewFiles: string[] = [];
    try {
      reviewFiles = await readdir(this.reviewDir);
    } catch {}

    // Helper to process questionnaire files (JSON only)
    const processFile = async (file: string, indexedDir: string, customer?: string) => {
      if (!file.endsWith('.json')) return;

      const name = file.replace(/\.json$/, '');
      const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');

      // If no customer provided, try to get it from questionnaire structure filepath
      if (!customer) {
        // Try both the original name and safeName for looking up structure
        const structurePaths = [
          join('./questionnaires', `${name}.json`),
          join('./questionnaires', `${safeName}.json`)
        ];
        for (const structurePath of structurePaths) {
          if (existsSync(structurePath)) {
            try {
              const structure = JSON.parse(await readFile(structurePath, 'utf-8'));
              const filepath = structure?.source?.filepath || '';
              // Extract customer folder from path: incoming/<customer>/file.xlsx
              const incomingMatch = filepath.match(/incoming[\/\\]([^\/\\]+)[\/\\][^\/\\]+$/);
              if (incomingMatch && incomingMatch[1]) {
                customer = incomingMatch[1].replace(/[^a-zA-Z0-9-_]/g, '-');
                break;
              }
            } catch {}
          }
        }
      }

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

      // Check last exported date
      let lastExported: string | undefined;
      const exportDir = customer
        ? join('./customers', customer, 'approved', safeName)
        : join('./customers', 'default', 'approved', safeName);
      const entityDbPath = join(exportDir, 'entity-db.json');
      if (existsSync(entityDbPath)) {
        try {
          const exportData = JSON.parse(await readFile(entityDbPath, 'utf-8'));
          lastExported = exportData.meta?.exportedAt;
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
        feedbackCount,
        customer,
        lastExported
      });
    };

    // 1. Check legacy ./indexed folder
    try {
      const indexedDir = './indexed';
      const files = await readdir(indexedDir);
      for (const file of files) {
        await processFile(file, indexedDir);
      }
    } catch (error) {
      // No legacy indexed folder, that's ok
    }

    // 2. Check customer folders: customers/*/indexed
    try {
      const customersDir = './customers';
      const customers = await readdir(customersDir);

      for (const customer of customers) {
        const customerIndexedDir = join(customersDir, customer, 'indexed');
        try {
          const files = await readdir(customerIndexedDir);
          for (const file of files) {
            await processFile(file, customerIndexedDir, customer);
          }
        } catch {
          // Customer folder has no indexed subfolder, skip
        }
      }
    } catch {
      // No customers folder, that's ok
    }

    // Sort by customer (with undefined/legacy first), then by name
    questionnaires.sort((a, b) => {
      if (a.customer && !b.customer) return 1;
      if (!a.customer && b.customer) return -1;
      if (a.customer !== b.customer) return (a.customer || '').localeCompare(b.customer || '');
      return a.name.localeCompare(b.name);
    });

    return questionnaires;
  }

  /**
   * Load all data for a specific questionnaire (structure + indexed + library)
   * Searches in both root directories and customer-specific directories
   */
  private async loadQuestionnaireData(questionnaireId: string): Promise<{
    id: string;
    structure: any;
    indexed: any;
    library: any;
    feedback: FeedbackData | null;
  }> {
    const safeName = questionnaireId.replace(/[^a-zA-Z0-9-_]/g, '_');

    // Helper to find file in root or customer directories
    const findFile = async (rootDir: string, filename: string): Promise<string | null> => {
      // First check root directory
      const rootPath = join(rootDir, filename);
      if (existsSync(rootPath)) {
        return rootPath;
      }

      // Then check all customer directories
      try {
        const customers = await readdir('./customers');
        for (const customer of customers) {
          const customerPath = join('./customers', customer, rootDir, filename);
          if (existsSync(customerPath)) {
            return customerPath;
          }
        }
      } catch {}

      return null;
    };

    // Load structure (questionnaires/*.json)
    let structure = null;
    const structurePath = await findFile('questionnaires', `${safeName}.json`);
    if (structurePath) {
      structure = JSON.parse(await readFile(structurePath, 'utf-8'));
    }

    // Load indexed (indexed/*.json only)
    let indexed = null;
    const indexedPath = await findFile('indexed', `${safeName}.json`);
    if (indexedPath) {
      indexed = JSON.parse(await readFile(indexedPath, 'utf-8'));
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

// Run if this file is executed directly
if (import.meta.url.endsWith(process.argv[1]?.replace(/^file:\/\//, '') || '') ||
    process.argv[1]?.endsWith('server.ts')) {
  const server = new ReviewServer();
  server.start().catch(console.error);
}
