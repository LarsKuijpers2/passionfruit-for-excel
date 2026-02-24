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
import { groupByTopicWithSimilarity, getSimilarityStats } from './services/sync/similarity-detector.js';
import { correctionTracker, type ErrorType } from './services/learning/correction-tracker.js';

// Helper to get current timestamp in Netherlands timezone
function getNetherlandsTimestamp(): string {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).replace(' ', 'T') + '+01:00';
}

function getNetherlandsDate(): string {
  return new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Amsterdam'
  });
}

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
  private customersDir: string;
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
    this.customersDir = './customers';

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
        startedAt: getNetherlandsTimestamp(),
        lastUpdatedAt: getNetherlandsTimestamp()
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

    // Get pipeline data for a customer
    this.app.get('/api/pipeline/:customer', async (req, res) => {
      try {
        const { customer } = req.params;
        const customerDir = join(this.customersDir, customer);
        const pipelinePath = join(customerDir, 'pipeline.json');

        // Check if pipeline.json exists
        if (existsSync(pipelinePath)) {
          const pipeline = JSON.parse(await readFile(pipelinePath, 'utf-8'));

          // Update status from actual files
          const incomingDir = join(customerDir, 'incoming');
          const structureDir = join(customerDir, 'structure');
          const indexedDir = join(customerDir, 'indexed');
          const approvedDir = join(customerDir, 'approved');

          const incomingFiles = existsSync(incomingDir)
            ? (await readdir(incomingDir)).filter(f => !f.startsWith('.'))
            : [];
          const structureFiles = existsSync(structureDir)
            ? (await readdir(structureDir)).filter(f => f.endsWith('.json'))
            : [];
          const indexedFiles = existsSync(indexedDir)
            ? (await readdir(indexedDir)).filter(f => f.endsWith('.json'))
            : [];
          const approvedFiles = existsSync(approvedDir)
            ? (await readdir(approvedDir)).filter(f => f.endsWith('.json'))
            : [];

          // Update questionnaire statuses
          if (pipeline.questionnaires) {
            for (const q of pipeline.questionnaires) {
              const baseName = q.file.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30).toLowerCase();
              const isStored = structureFiles.some(f => f.toLowerCase().includes(baseName));
              const isIndexed = indexedFiles.some(f => f.toLowerCase().includes(baseName));
              const isApproved = approvedFiles.some(f => f.toLowerCase().includes(baseName));

              if (isApproved) q.status = 'approved';
              else if (isIndexed) q.status = 'indexed';
              else if (isStored) q.status = 'stored';
              else q.status = 'incoming';
            }
          }

          // Add counts
          pipeline.counts = {
            incoming: pipeline.questionnaires?.filter((q: any) => q.status === 'incoming').length || 0,
            stored: pipeline.questionnaires?.filter((q: any) => q.status === 'stored').length || 0,
            indexed: pipeline.questionnaires?.filter((q: any) => q.status === 'indexed').length || 0,
            reviewed: pipeline.questionnaires?.filter((q: any) => q.status === 'reviewed').length || 0,
            approved: pipeline.questionnaires?.filter((q: any) => q.status === 'approved').length || 0,
          };

          res.json(pipeline);
        } else {
          // No pipeline.json - return basic structure from folders
          const incomingDir = join(customerDir, 'incoming');
          const structureDir = join(customerDir, 'structure');
          const indexedDir = join(customerDir, 'indexed');

          const incomingFiles = existsSync(incomingDir)
            ? (await readdir(incomingDir)).filter(f => !f.startsWith('.'))
            : [];
          const structureFiles = existsSync(structureDir)
            ? (await readdir(structureDir)).filter(f => f.endsWith('.json'))
            : [];
          const indexedFiles = existsSync(indexedDir)
            ? (await readdir(indexedDir)).filter(f => f.endsWith('.json'))
            : [];

          res.json({
            customer,
            questionnaires: incomingFiles.map(f => ({
              file: f,
              status: indexedFiles.some(idx => idx.includes(f.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_')))
                ? 'indexed'
                : structureFiles.some(str => str.includes(f.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_')))
                  ? 'stored'
                  : 'incoming'
            })),
            counts: {
              incoming: incomingFiles.length,
              stored: structureFiles.length,
              indexed: indexedFiles.length,
              reviewed: 0,
              approved: 0
            }
          });
        }
      } catch (error) {
        console.error('Error fetching pipeline:', error);
        res.status(500).json({ error: 'Failed to fetch pipeline data' });
      }
    });

    // List structure files for structure analyzer tool
    this.app.get('/api/structure-files', async (req, res) => {
      try {
        const files: Array<{ customer: string; file: string; path: string }> = [];

        if (existsSync(this.customersDir)) {
          const customers = await readdir(this.customersDir);

          for (const customer of customers) {
            const structureDir = join(this.customersDir, customer, 'structure');
            if (existsSync(structureDir)) {
              const structureFiles = (await readdir(structureDir)).filter(f => f.endsWith('.json'));
              for (const file of structureFiles) {
                files.push({
                  customer,
                  file,
                  path: `/api/structure-files/${encodeURIComponent(customer)}/${encodeURIComponent(file)}`
                });
              }
            }
          }
        }

        res.json({ files });
      } catch (error) {
        console.error('Error listing structure files:', error);
        res.status(500).json({ error: 'Failed to list structure files' });
      }
    });

    // Get a specific structure file
    this.app.get('/api/structure-files/:customer/:file', async (req, res) => {
      try {
        const { customer, file } = req.params;
        const filePath = join(this.customersDir, customer, 'structure', file);

        if (!existsSync(filePath)) {
          return res.status(404).json({ error: 'Structure file not found' });
        }

        const content = await readFile(filePath, 'utf-8');
        res.json(JSON.parse(content));
      } catch (error) {
        console.error('Error fetching structure file:', error);
        res.status(500).json({ error: 'Failed to fetch structure file' });
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
          item.reviewedAt = getNetherlandsTimestamp();
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
                startedAt: getNetherlandsTimestamp(),
                lastUpdatedAt: getNetherlandsTimestamp()
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
          feedback.meta.lastUpdatedAt = getNetherlandsTimestamp();

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
            item.reviewedAt = getNetherlandsTimestamp();
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

        this.feedback.meta.lastUpdatedAt = getNetherlandsTimestamp();
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
          questionnaire: [],
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
          const structureResult = await findFile('structure', `${safeName}.json`);
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
        const exportDir = join('./customers', customer, 'approved');
        await mkdir(exportDir, { recursive: true });

        const exportPath = join(exportDir, `${safeName}.json`);
        const exportData = {
          meta: {
            questionnaire: questionnaireId,
            source: indexed.source,
            customer,
            exportedAt: getNetherlandsTimestamp()
          },
          company: grouped.company,
          library: grouped.answer_library,
          product: grouped.product,
          questionnaire: grouped.questionnaire,
          exclude: grouped.exclude,
          stats: {
            company: grouped.company.length,
            library: grouped.answer_library.length,
            product: grouped.product.length,
            questionnaire: grouped.questionnaire.length,
            exclude: grouped.exclude.length,
            total: grouped.company.length + grouped.answer_library.length + grouped.product.length + grouped.questionnaire.length + grouped.exclude.length
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

    // Get aggregated answer library for a customer
    this.app.get('/api/aggregated-library/:customer', async (req, res) => {
      try {
        const { customer } = req.params;
        // Use original customer name for path (folder names may have spaces)
        const customerPath = customer;
        const safeCustomer = customer.replace(/[^a-zA-Z0-9-_]/g, '-');

        // Try to load aggregated data
        const aggregatedPath = join('./customers', customerPath, 'api-ready', `${safeCustomer}-aggregated.json`);

        if (!existsSync(aggregatedPath)) {
          // Try to find any aggregated file in api-ready
          const apiReadyDir = join('./customers', customerPath, 'api-ready');
          if (existsSync(apiReadyDir)) {
            const files = await readdir(apiReadyDir);
            const aggFile = files.find(f => f.endsWith('-aggregated.json'));
            if (aggFile) {
              const data = JSON.parse(await readFile(join(apiReadyDir, aggFile), 'utf-8'));
              return res.json(this.processAggregatedLibrary(data, customerPath));
            }
          }

          // If no aggregated data, aggregate from approved exports
          const approvedDir = join('./customers', customerPath, 'approved');
          if (!existsSync(approvedDir)) {
            // Return empty result when no approved data yet
            return res.json({
              customer: customerPath,
              questionnaires: [],
              totalItems: 0,
              uniqueItems: 0,
              aggregatedAt: new Date().toISOString(),
              groups: [],
              company: { count: 0, items: [] },
              product: { count: 0, items: [] },
              questionnaire: { count: 0, items: [] },
              excluded: { count: 0, items: [] },
              stats: { totalTopics: 0, standaloneItems: 0, relatedGroups: 0, suggestedMerges: 0 }
            });
          }

          // Build aggregated data from approved files
          const approvedFiles = await readdir(approvedDir);
          const jsonFiles = approvedFiles.filter(f => f.endsWith('.json'));

          if (jsonFiles.length === 0) {
            // Return empty result instead of error when no approved exports yet
            return res.json({
              customer: customerPath,
              questionnaires: [],
              totalItems: 0,
              uniqueItems: 0,
              aggregatedAt: new Date().toISOString(),
              groups: [],
              company: { count: 0, items: [] },
              product: { count: 0, items: [] },
              questionnaire: { count: 0, items: [] },
              excluded: { count: 0, items: [] },
              stats: { totalTopics: 0, standaloneItems: 0, relatedGroups: 0, suggestedMerges: 0 }
            });
          }

          // Simple aggregation from approved files
          const items: any[] = [];
          const questionnaires: string[] = [];

          for (const file of jsonFiles) {
            const filePath = join(approvedDir, file);
            const data = JSON.parse(await readFile(filePath, 'utf-8'));
            const questionnaire = data.meta?.questionnaire || file.replace('.json', '');
            questionnaires.push(questionnaire);

            // Collect items from different destinations
            for (const dest of ['library', 'company', 'product', 'questionnaire', 'exclude']) {
              const destItems = data[dest] || [];
              for (const item of destItems) {
                items.push({
                  ...item,
                  destination: dest === 'library' ? 'answer_library' : dest,
                  source: questionnaire
                });
              }
            }
          }

          // Deduplicate and group
          const aggregated = this.deduplicateItems(items);

          return res.json(this.processAggregatedLibrary({
            customer: safeCustomer,
            aggregatedAt: getNetherlandsTimestamp(),
            questionnaires,
            answerLibrary: {
              total: items.length,
              unique: aggregated.length,
              duplicates: items.length - aggregated.length,
              items: aggregated
            }
          }, safeCustomer));
        }

        const data = JSON.parse(await readFile(aggregatedPath, 'utf-8'));
        res.json(this.processAggregatedLibrary(data, safeCustomer));

      } catch (error) {
        console.error('Error loading aggregated library:', error);
        res.status(500).json({ error: 'Failed to load aggregated library' });
      }
    });

    // Merge similar items in aggregated library
    this.app.post('/api/aggregated-library/:customer/merge', async (req, res) => {
      try {
        const { customer } = req.params;
        const { itemIds, keepId, mergedLabel } = req.body;

        if (!itemIds || !Array.isArray(itemIds) || itemIds.length < 2) {
          return res.status(400).json({ error: 'Need at least 2 item IDs to merge' });
        }

        if (!keepId || !itemIds.includes(keepId)) {
          return res.status(400).json({ error: 'keepId must be one of the itemIds' });
        }

        const safeCustomer = customer.replace(/[^a-zA-Z0-9-_]/g, '-');
        const aggregatedPath = join('./customers', safeCustomer, 'api-ready', `${safeCustomer}-aggregated.json`);

        if (!existsSync(aggregatedPath)) {
          return res.status(404).json({ error: 'Aggregated data not found' });
        }

        const data = JSON.parse(await readFile(aggregatedPath, 'utf-8'));

        // Find items to merge
        const toMerge = itemIds.filter((id: string) => id !== keepId);
        const keepItem = data.answerLibrary?.items?.find((item: any) => item.id === keepId);

        if (!keepItem) {
          return res.status(404).json({ error: 'Keep item not found' });
        }

        // Merge sources from other items into keep item
        for (const mergeId of toMerge) {
          const mergeItem = data.answerLibrary?.items?.find((item: any) => item.id === mergeId);
          if (mergeItem) {
            // Merge sources
            if (mergeItem.sources) {
              keepItem.sources = [...new Set([...(keepItem.sources || []), ...mergeItem.sources])];
            }
            // Merge cell refs
            if (mergeItem.cellRefs) {
              keepItem.cellRefs = { ...(keepItem.cellRefs || {}), ...mergeItem.cellRefs };
            }
          }
        }

        // Update label if provided
        if (mergedLabel) {
          keepItem.label = mergedLabel;
        }

        // Remove merged items
        data.answerLibrary.items = data.answerLibrary.items.filter(
          (item: any) => !toMerge.includes(item.id)
        );

        // Update counts
        data.answerLibrary.unique = data.answerLibrary.items.length;

        // Save updated data
        await writeFile(aggregatedPath, JSON.stringify(data, null, 2), 'utf-8');

        res.json({
          success: true,
          merged: toMerge.length,
          result: keepItem
        });

      } catch (error) {
        console.error('Error merging items:', error);
        res.status(500).json({ error: 'Failed to merge items' });
      }
    });

    // Get standard questions for a customer
    this.app.get('/api/standard-questions/:customer', async (req, res) => {
      try {
        const { customer } = req.params;
        const standardQuestionsPath = join('./customers', customer, 'standard-questions.json');

        if (!existsSync(standardQuestionsPath)) {
          // Return empty result when no standard questions yet
          return res.json({ questions: [], topics: [], stats: { total: 0 } });
        }

        const data = JSON.parse(await readFile(standardQuestionsPath, 'utf-8'));
        res.json(data);

      } catch (error) {
        console.error('Error loading standard questions:', error);
        res.status(500).json({ error: 'Failed to load standard questions' });
      }
    });

    // Get curated library for a customer
    this.app.get('/api/curated-library/:customer', async (req, res) => {
      try {
        const { customer } = req.params;
        const curatedPath = join('./customers', customer, 'curated-library.json');

        if (!existsSync(curatedPath)) {
          // Return empty result when no curated library yet
          return res.json({ items: [], topics: [], stats: { total: 0 } });
        }

        const data = JSON.parse(await readFile(curatedPath, 'utf-8'));
        res.json(data);

      } catch (error) {
        console.error('Error loading curated library:', error);
        res.status(500).json({ error: 'Failed to load curated library' });
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

    // Serve the original PDF file for overlay rendering
    this.app.get('/api/questionnaire/:id/pdf', async (req, res) => {
      try {
        const { id } = req.params;
        const data = await this.loadQuestionnaireData(id);

        if (!data.structure?.source?.filepath) {
          return res.status(404).json({ error: 'PDF path not found' });
        }

        const pdfPath = data.structure.source.filepath;
        if (!existsSync(pdfPath)) {
          return res.status(404).json({ error: 'PDF file not found' });
        }

        // Only serve PDF files
        if (!pdfPath.toLowerCase().endsWith('.pdf')) {
          return res.status(400).json({ error: 'Not a PDF file' });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${id}.pdf"`);
        const pdfBuffer = await readFile(pdfPath);
        res.send(pdfBuffer);
      } catch (error) {
        console.error('Error serving PDF:', error);
        res.status(500).json({ error: 'Failed to serve PDF' });
      }
    });

    // Get visual Q&A training data for a questionnaire
    this.app.get('/api/questionnaire/:id/visual-qa', async (req, res) => {
      try {
        const { id } = req.params;
        const data = await this.loadQuestionnaireData(id);

        if (!data.structure?.source?.filepath) {
          return res.status(404).json({ error: 'PDF path not found' });
        }

        // Find customer folder and visual-qa-training directory
        const pdfPath = data.structure.source.filepath;
        const customerDir = dirname(dirname(pdfPath));
        const trainingDir = join(customerDir, 'visual-qa-training');

        if (!existsSync(trainingDir)) {
          return res.json({ trainingData: [] });
        }

        // Find training data files for this questionnaire
        const pdfBasename = basename(pdfPath, '.pdf').replace(/[^a-zA-Z0-9_-]/g, '_');
        const files = await readdir(trainingDir);
        const jsonFiles = files.filter(f => f.startsWith(pdfBasename) && f.endsWith('.json'));

        const trainingData = await Promise.all(
          jsonFiles.map(async (f) => {
            const content = await readFile(join(trainingDir, f), 'utf-8');
            const data = JSON.parse(content);
            // Convert absolute image path to relative URL
            const imageFile = basename(data.imagePath);
            return {
              ...data,
              imageUrl: `/api/questionnaire/${id}/visual-qa/image/${imageFile}`,
            };
          })
        );

        // Sort by page number
        trainingData.sort((a, b) => a.pageNumber - b.pageNumber);

        res.json({ trainingData });
      } catch (error) {
        console.error('Error loading visual Q&A training data:', error);
        res.status(500).json({ error: 'Failed to load visual Q&A training data' });
      }
    });

    // Serve visual Q&A training images
    this.app.get('/api/questionnaire/:id/visual-qa/image/:filename', async (req, res) => {
      try {
        const { id, filename } = req.params;
        const data = await this.loadQuestionnaireData(id);

        if (!data.structure?.source?.filepath) {
          return res.status(404).json({ error: 'PDF path not found' });
        }

        const pdfPath = data.structure.source.filepath;
        const customerDir = dirname(dirname(pdfPath));
        const imagePath = join(customerDir, 'visual-qa-training', filename);

        if (!existsSync(imagePath)) {
          return res.status(404).json({ error: 'Image not found' });
        }

        res.setHeader('Content-Type', 'image/png');
        const imageBuffer = await readFile(imagePath);
        res.send(imageBuffer);
      } catch (error) {
        console.error('Error serving visual Q&A image:', error);
        res.status(500).json({ error: 'Failed to serve image' });
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
          let structurePath = join('./structure', `${safeName}.json`);
          if (!existsSync(structurePath)) {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerStructurePath = join('./customers', customer, 'structure', `${safeName}.json`);
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
          let structurePath = join('./structure', `${safeName}.json`);
          if (!existsSync(structurePath)) {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerStructurePath = join('./customers', customer, 'structure', `${safeName}.json`);
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

    // Save notes for a questionnaire
    this.app.post('/api/questionnaire/:questionnaireId/notes', async (req, res) => {
      try {
        const { questionnaireId } = req.params;
        const { notes } = req.body;

        if (typeof notes !== 'string') {
          return res.status(400).json({ error: 'Notes must be a string' });
        }

        // Helper to find indexed file
        const findIndexedFile = async (filename: string): Promise<string | null> => {
          const rootPath = join('./indexed', filename);
          if (existsSync(rootPath)) return rootPath;
          try {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerPath = join('./customers', customer, 'indexed', filename);
              if (existsSync(customerPath)) return customerPath;
            }
          } catch {}
          return null;
        };

        const safeName = questionnaireId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const indexedPath = await findIndexedFile(`${safeName}.json`);

        if (!indexedPath) {
          return res.status(404).json({ error: 'Questionnaire not found' });
        }

        const indexed = JSON.parse(await readFile(indexedPath, 'utf-8'));

        // Initialize meta if needed and save notes
        if (!indexed.meta) indexed.meta = {};
        indexed.meta.notes = notes;
        indexed.meta.notesUpdatedAt = getNetherlandsTimestamp();

        await writeFile(indexedPath, JSON.stringify(indexed, null, 2), 'utf-8');
        console.log(`Saved notes for ${questionnaireId}`);

        res.json({ success: true });
      } catch (error) {
        console.error('Error saving notes:', error);
        res.status(500).json({ error: 'Failed to save notes' });
      }
    });

    // Submit verdict for a Vision discrepancy
    this.app.post('/api/questionnaire/:questionnaireId/vision-validation/verdict', async (req, res) => {
      try {
        const { questionnaireId } = req.params;
        const { discrepancyIndex, verdict } = req.body;

        if (typeof discrepancyIndex !== 'number' || !['base_correct', 'vision_correct'].includes(verdict)) {
          return res.status(400).json({ error: 'Invalid discrepancyIndex or verdict' });
        }

        // Helper to find indexed file
        const findIndexedFile = async (filename: string): Promise<string | null> => {
          const rootPath = join('./indexed', filename);
          if (existsSync(rootPath)) return rootPath;
          try {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerPath = join('./customers', customer, 'indexed', filename);
              if (existsSync(customerPath)) return customerPath;
            }
          } catch {}
          return null;
        };

        const safeName = questionnaireId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const indexedPath = await findIndexedFile(`${safeName}.json`);

        if (!indexedPath) {
          return res.status(404).json({ error: 'Questionnaire not found' });
        }

        const indexed = JSON.parse(await readFile(indexedPath, 'utf-8'));
        const validation = indexed.visionValidation;

        if (!validation || !validation.discrepancies || !validation.discrepancies[discrepancyIndex]) {
          return res.status(404).json({ error: 'Discrepancy not found' });
        }

        const discrepancy = validation.discrepancies[discrepancyIndex];

        // Mark as reviewed with verdict
        discrepancy.reviewed = true;
        discrepancy.verdict = verdict;
        discrepancy.reviewedAt = getNetherlandsTimestamp();

        // If vision_correct, update the item value
        if (verdict === 'vision_correct') {
          // Find and update the item
          for (const section of indexed.sections || []) {
            for (const item of section.items || []) {
              if (item.id === discrepancy.itemId) {
                item.value = discrepancy.visionValue;
                console.log(`Updated item "${item.label}" to Vision value: ${discrepancy.visionValue}`);
                break;
              }
            }
          }
        }

        await writeFile(indexedPath, JSON.stringify(indexed, null, 2), 'utf-8');
        console.log(`Verdict for discrepancy ${discrepancyIndex}: ${verdict}`);

        res.json({ success: true });
      } catch (error) {
        console.error('Error submitting verdict:', error);
        res.status(500).json({ error: 'Failed to submit verdict' });
      }
    });

    // Undo verdict for a Vision discrepancy
    this.app.post('/api/questionnaire/:questionnaireId/vision-validation/undo', async (req, res) => {
      try {
        const { questionnaireId } = req.params;
        const { discrepancyIndex } = req.body;

        if (typeof discrepancyIndex !== 'number') {
          return res.status(400).json({ error: 'Invalid discrepancyIndex' });
        }

        // Helper to find indexed file
        const findIndexedFile = async (filename: string): Promise<string | null> => {
          const rootPath = join('./indexed', filename);
          if (existsSync(rootPath)) return rootPath;
          try {
            const customers = await readdir('./customers');
            for (const customer of customers) {
              const customerPath = join('./customers', customer, 'indexed', filename);
              if (existsSync(customerPath)) return customerPath;
            }
          } catch {}
          return null;
        };

        const safeName = questionnaireId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const indexedPath = await findIndexedFile(`${safeName}.json`);

        if (!indexedPath) {
          return res.status(404).json({ error: 'Questionnaire not found' });
        }

        const indexed = JSON.parse(await readFile(indexedPath, 'utf-8'));
        const validation = indexed.visionValidation;

        if (!validation || !validation.discrepancies || !validation.discrepancies[discrepancyIndex]) {
          return res.status(404).json({ error: 'Discrepancy not found' });
        }

        const discrepancy = validation.discrepancies[discrepancyIndex];

        // If the verdict was vision_correct, revert the item value back to baseValue
        if (discrepancy.verdict === 'vision_correct') {
          for (const section of indexed.sections || []) {
            for (const item of section.items || []) {
              if (item.id === discrepancy.itemId) {
                // Revert to base value (could be null/empty)
                item.value = discrepancy.baseValue || '';
                console.log(`Reverted item "${item.label}" to base value: ${discrepancy.baseValue}`);
                break;
              }
            }
          }
        }

        // Remove the reviewed status and verdict
        delete discrepancy.reviewed;
        delete discrepancy.verdict;
        delete discrepancy.reviewedAt;

        await writeFile(indexedPath, JSON.stringify(indexed, null, 2), 'utf-8');
        console.log(`Undo verdict for discrepancy ${discrepancyIndex}`);

        res.json({ success: true });
      } catch (error) {
        console.error('Error undoing verdict:', error);
        res.status(500).json({ error: 'Failed to undo verdict' });
      }
    });

    // Get feedback summary for a questionnaire (destination corrections)
    this.app.get('/api/questionnaire/:questionnaireId/feedback-summary', async (req, res) => {
      try {
        const { questionnaireId } = req.params;
        const safeName = questionnaireId.replace(/[^a-zA-Z0-9-_]/g, '_');

        // Find feedback file
        const feedbackPaths = [
          join(this.reviewDir, safeName, 'feedback.json'),
        ];

        // Also check customer directories
        try {
          const customers = await readdir('./customers');
          for (const customer of customers) {
            feedbackPaths.push(join('./customers', customer, 'review', safeName, 'feedback.json'));
          }
        } catch {}

        let feedback = null;
        for (const path of feedbackPaths) {
          if (existsSync(path)) {
            feedback = JSON.parse(await readFile(path, 'utf-8'));
            break;
          }
        }

        if (!feedback) {
          return res.json({ corrections: [], stats: { total: 0 } });
        }

        // Extract destination corrections (where aiDestination !== destination)
        const corrections: Array<{
          label: string;
          aiDestination: string;
          correctedTo: string;
          topic: string;
          section: string;
        }> = [];

        for (const item of [...(feedback.index || []), ...(feedback.library || [])]) {
          if (item.aiDestination && item.destination && item.aiDestination !== item.destination) {
            corrections.push({
              label: item.label,
              aiDestination: item.aiDestination,
              correctedTo: item.destination,
              topic: item.topic || 'unknown',
              section: item.section || 'unknown'
            });
          }
        }

        // Calculate stats
        const stats = {
          total: corrections.length,
          byCorrection: {} as Record<string, number>
        };

        for (const c of corrections) {
          const key = `${c.aiDestination} → ${c.correctedTo}`;
          stats.byCorrection[key] = (stats.byCorrection[key] || 0) + 1;
        }

        res.json({ corrections, stats });
      } catch (error) {
        console.error('Error getting feedback summary:', error);
        res.status(500).json({ error: 'Failed to get feedback summary' });
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
            reviewedAt: getNetherlandsTimestamp()
          };

          this.feedback.index.push(feedbackItem);
          appliedItems.push(feedbackItem);
        }

        this.feedback.meta.lastUpdatedAt = getNetherlandsTimestamp();
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
      updatedAt: getNetherlandsDate(),
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
      updatedAt: getNetherlandsDate(),
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
    existingExtractionRules.updatedAt = getNetherlandsDate();

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
    existingTagRules.updatedAt = getNetherlandsDate();

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
      const structurePath = join('./structure', `${safeName}.json`);
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

    const timestamp = getNetherlandsTimestamp();

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
    approvedAt?: string;
    approvedCount?: number;
    apiReadyAt?: string;
    apiReadyCount?: number;
  }>> {
    const questionnaires: Array<{
      name: string;
      displayName: string;
      hasReview: boolean;
      reviewUrl?: string;
      indexed: boolean;
      feedbackCount?: number;
      customer?: string;
      approvedAt?: string;
      approvedCount?: number;
      apiReadyAt?: string;
      apiReadyCount?: number;
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
      const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '_');

      // If no customer provided, try to get it from questionnaire structure filepath
      if (!customer) {
        // Try both the original name and safeName for looking up structure
        const structurePaths = [
          join('./structure', `${name}.json`),
          join('./structure', `${safeName}.json`)
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

      // Check approved status (from approved folder)
      let approvedAt: string | undefined;
      let approvedCount: number | undefined;
      const approvedDir = customer
        ? join('./customers', customer, 'approved')
        : join('./customers', 'default', 'approved');
      const approvedPath = join(approvedDir, `${safeName}.json`);
      if (existsSync(approvedPath)) {
        try {
          const approvedData = JSON.parse(await readFile(approvedPath, 'utf-8'));
          approvedAt = approvedData.meta?.exportedAt;
          approvedCount = (approvedData.company?.length || 0) +
                          (approvedData.library?.length || 0) +
                          (approvedData.product?.length || 0);
        } catch {}
      }

      // Check API-ready status (from api-ready folder)
      let apiReadyAt: string | undefined;
      let apiReadyCount: number | undefined;
      const apiReadyDir = customer
        ? join('./customers', customer, 'api-ready')
        : join('./customers', 'default', 'api-ready');
      const apiReadyPath = join(apiReadyDir, `${safeName}.json`);
      if (existsSync(apiReadyPath)) {
        try {
          const apiReadyData = JSON.parse(await readFile(apiReadyPath, 'utf-8'));
          apiReadyAt = apiReadyData.meta?.exportedAt || apiReadyData.meta?.syncedAt;
          apiReadyCount = apiReadyData.items?.length || apiReadyData.total || 0;
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
        approvedAt,
        approvedCount,
        apiReadyAt,
        apiReadyCount
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
   * Process aggregated library data for API response
   * Groups by topic and detects similar items
   */
  private processAggregatedLibrary(data: any, customer: string): any {
    const items = data.answerLibrary?.items || [];

    // Import similarity detection inline to avoid circular deps
    // groupByTopicWithSimilarity and getSimilarityStats imported at top of file

    // Separate by destination
    const libraryItems = items.filter((i: any) => i.destination === 'answer_library');
    const excludedItems = items.filter((i: any) => i.destination === 'exclude');
    const companyItems = items.filter((i: any) => i.destination === 'company');
    const productItems = items.filter((i: any) => i.destination === 'product');
    const questionnaireItems = items.filter((i: any) => i.destination === 'questionnaire');

    // Group library items by topic with similarity detection
    const grouped = groupByTopicWithSimilarity(libraryItems);
    const stats = getSimilarityStats(grouped);

    return {
      customer,
      aggregatedAt: data.aggregatedAt || new Date().toISOString(),
      questionnaires: data.questionnaires || [],
      totalItems: items.length,
      uniqueItems: data.answerLibrary?.unique || items.length,
      groups: grouped,
      company: {
        count: companyItems.length,
        items: companyItems
      },
      product: {
        count: productItems.length,
        items: productItems
      },
      questionnaire: {
        count: questionnaireItems.length,
        items: questionnaireItems
      },
      excluded: {
        count: excludedItems.length,
        items: excludedItems
      },
      stats: {
        ...stats,
        company: companyItems.length,
        product: productItems.length,
        questionnaire: questionnaireItems.length,
        excluded: excludedItems.length
      }
    };
  }

  /**
   * Deduplicate items by normalized label + value
   */
  private deduplicateItems(items: any[]): any[] {
    const seen = new Map<string, any>();

    for (const item of items) {
      const normalizedLabel = (item.label || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
      const normalizedValue = (item.value || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
      const key = `${normalizedLabel}::${normalizedValue}`;

      if (!seen.has(key)) {
        seen.set(key, {
          id: this.generateItemId(item.label, item.value),
          label: item.label,
          fullLabel: item.fullLabel || item.label,
          normalizedLabel,
          value: item.value,
          topic: item.topic || 'other',
          section: item.section || '',
          destination: item.destination || 'answer_library',
          sources: [item.source],
          firstApprovedAt: item.approvedAt || new Date().toISOString(),
          lastApprovedAt: item.approvedAt || new Date().toISOString(),
          cellRefs: item.lCell ? { [item.source]: item.lCell } : {}
        });
      } else {
        // Merge sources
        const existing = seen.get(key)!;
        if (item.source && !existing.sources.includes(item.source)) {
          existing.sources.push(item.source);
        }
        if (item.lCell && item.source) {
          existing.cellRefs[item.source] = item.lCell;
        }
        if (item.approvedAt) {
          existing.lastApprovedAt = item.approvedAt;
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Generate a unique ID for an item based on label + value
   */
  private generateItemId(label: string, value: string): string {
    // Simple hash without crypto - use string char codes
    const normalized = `${label}:${value}`.toLowerCase();
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0').substring(0, 12);
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

    // Load structure (structure/*.json)
    let structure = null;
    const structurePath = await findFile('structure', `${safeName}.json`);
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
