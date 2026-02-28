/**
 * Sync Curated Library to Passionfruit API
 *
 * Takes curated library JSON and uploads to NSLibrary API.
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';

// =============================================================================
// TYPES
// =============================================================================

interface CuratedQuestion {
  question: string;
  answer: string;
  originalLabels?: string[];
  sources?: string[];
  topic?: string;
  section?: string;
  status?: string;
}

interface CuratedTopic {
  topic: string;
  topicLabel: string;
  questions: CuratedQuestion[];
}

// Support both flat and nested formats
interface CuratedLibrary {
  customer: string;
  location?: string;
  generatedAt: string;
  sourceFile?: string;
  // Flat format
  answer_library?: CuratedQuestion[] | CuratedTopic[];
  product?: CuratedQuestion[];
  // Nested format (grouped by topic)
  company?: CuratedTopic[];
  stats?: {
    inputItems: number;
    outputQuestions: number;
    merged: number;
  };
}

/**
 * Flatten nested topic structure to flat question array
 */
function flattenLibrary(data: CuratedQuestion[] | CuratedTopic[] | undefined): CuratedQuestion[] {
  if (!data || data.length === 0) return [];

  // Check if it's already flat (has 'question' property)
  if ('question' in data[0]) {
    return data as CuratedQuestion[];
  }

  // It's nested by topic
  const result: CuratedQuestion[] = [];
  for (const topic of data as CuratedTopic[]) {
    for (const q of topic.questions) {
      result.push({
        ...q,
        topic: topic.topic,
        section: topic.topicLabel,
      });
    }
  }
  return result;
}

interface AnswerResponse {
  id: number;
  question: string;
  answer: string;
  note?: string;
  entities: number[];
  evidences: number[];
}

// =============================================================================
// TOKEN REFRESH
// =============================================================================

const AUTH_URL = 'https://auth.passionfruit.earth/realms/passionfruit/protocol/openid-connect/token';
const CLIENT_ID = 'passionfruit';

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string }> {
  console.log('Refreshing access token...');

  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  console.log('Token refreshed successfully\n');
  return data;
}

// =============================================================================
// API CLIENT
// =============================================================================

class SimpleAPIClient {
  private baseUrl: string;
  private accessToken: string;

  constructor(baseUrl: string, accessToken: string) {
    this.baseUrl = baseUrl;
    this.accessToken = accessToken;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
    };

    if (body && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text);
  }

  async listAnswers(): Promise<AnswerResponse[]> {
    const response = await this.request<AnswerResponse[] | { items: AnswerResponse[] }>(
      'GET',
      '/api/v2/answers/'
    );
    return Array.isArray(response) ? response : response.items;
  }

  async createAnswer(answer: {
    question: string;
    answer: string;
    note?: string;
    entities?: number[];
    evidences?: number[];
  }): Promise<AnswerResponse> {
    return this.request('POST', '/api/v2/answers/', {
      ...answer,
      entities: answer.entities ?? [],
      evidences: answer.evidences ?? [],
    });
  }

  async updateAnswer(id: number, answer: {
    question: string;
    answer: string;
    note?: string;
    entities?: number[];
    evidences?: number[];
  }): Promise<AnswerResponse> {
    return this.request('PUT', `/api/v2/answers/${id}`, {
      ...answer,
      entities: answer.entities ?? [],
      evidences: answer.evidences ?? [],
    });
  }
}

// =============================================================================
// SYNC LOGIC
// =============================================================================

async function syncCuratedToAPI(
  curatedPath: string,
  accessToken: string,
  options: {
    dryRun?: boolean;
    apiUrl?: string;
    entityId?: number;
    refreshToken?: string;
    limit?: number;
  } = {}
): Promise<{ created: number; updated: number; skipped: number; failed: number }> {
  const {
    dryRun = false,
    apiUrl = 'https://production.passionfruitapi.com',
    entityId,
    refreshToken,
    limit
  } = options;

  // If refresh token provided, get a fresh access token
  let token = accessToken;
  if (refreshToken) {
    try {
      const tokenData = await refreshAccessToken(refreshToken);
      token = tokenData.access_token;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      console.log('Trying with provided access token...\n');
    }
  }

  // Load curated library
  const library: CuratedLibrary = JSON.parse(readFileSync(curatedPath, 'utf-8'));

  // Flatten nested structure if needed
  const questions = flattenLibrary(library.answer_library);

  console.log(`\n=== SYNC CURATED LIBRARY ===`);
  console.log(`Customer: ${library.customer}`);
  console.log(`Source: ${library.sourceFile || curatedPath}`);
  console.log(`Questions: ${questions.length}`);
  console.log(`API: ${apiUrl}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  if (dryRun) {
    console.log('=== DRY RUN - No changes will be made ===\n');
  }

  const result = { created: 0, updated: 0, skipped: 0, failed: 0 };

  // Initialize client
  const client = new SimpleAPIClient(apiUrl, token);

  // Get existing answers for deduplication
  console.log('Fetching existing answers...');
  let existingAnswers: AnswerResponse[] = [];
  try {
    existingAnswers = await client.listAnswers();
    console.log(`Found ${existingAnswers.length} existing answers\n`);
  } catch (error) {
    console.error('Failed to fetch existing answers:', error);
    return result;
  }

  // Create lookup map by normalized question
  const existingByQuestion = new Map<string, AnswerResponse>();
  for (const answer of existingAnswers) {
    existingByQuestion.set(answer.question.toLowerCase().trim(), answer);
  }

  // Process each question (with optional limit)
  let items = questions;
  if (limit && limit > 0) {
    items = items.slice(0, limit);
    console.log(`Limiting to first ${limit} items\n`);
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const question = item.question;
    const answer = item.answer;

    // Skip empty answers
    if (!answer || answer.trim() === '') {
      console.log(`[${i + 1}/${items.length}] SKIP: "${question.substring(0, 50)}..." (empty answer)`);
      result.skipped++;
      continue;
    }

    // Build note from sources or sourceFile
    const sources = item.sources?.join(', ') || library.sourceFile || library.customer;
    const note = `Source: ${sources}`;

    try {
      // Check if exists
      const existing = existingByQuestion.get(question.toLowerCase().trim());

      if (existing) {
        // Check if answer is different
        if (existing.answer === answer) {
          console.log(`[${i + 1}/${items.length}] SKIP: "${question.substring(0, 50)}..." (same)`);
          result.skipped++;
          continue;
        }

        // Update
        if (!dryRun) {
          await client.updateAnswer(existing.id, {
            question,
            answer,
            note,
            entities: entityId ? [entityId] : existing.entities,
            evidences: existing.evidences,
          });
        }
        console.log(`[${i + 1}/${items.length}] UPDATE: "${question.substring(0, 50)}..."`);
        result.updated++;
      } else {
        // Create new
        if (!dryRun) {
          const created = await client.createAnswer({
            question,
            answer,
            note,
            entities: entityId ? [entityId] : [],
          });
          // Add to map for future deduplication
          existingByQuestion.set(question.toLowerCase().trim(), created);
        }
        console.log(`[${i + 1}/${items.length}] CREATE: "${question.substring(0, 50)}..."`);
        result.created++;
      }

      // Rate limiting
      if (!dryRun) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`[${i + 1}/${items.length}] FAILED: "${question.substring(0, 50)}..." - ${error}`);
      result.failed++;
    }
  }

  return result;
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const curatedPath = args[0];
  const accessToken = args[1] || process.env.PASSIONFRUIT_API_KEY;
  const refreshToken = args[2] || process.env.PASSIONFRUIT_REFRESH_TOKEN;
  const dryRun = args.includes('--dry-run');
  const entityIdArg = args.find(a => a.startsWith('--entity='));
  const entityId = entityIdArg ? parseInt(entityIdArg.split('=')[1]) : undefined;
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;

  if (!curatedPath) {
    console.error('Usage: npx ts-node sync-curated-to-api.ts <curated-file.json> [access-token] [refresh-token] [--dry-run] [--entity=ID]');
    process.exit(1);
  }

  if (!existsSync(curatedPath)) {
    console.error(`File not found: ${curatedPath}`);
    process.exit(1);
  }

  if (!accessToken && !refreshToken) {
    console.error('No access token or refresh token provided.');
    console.error('Pass as arguments or set PASSIONFRUIT_API_KEY / PASSIONFRUIT_REFRESH_TOKEN');
    process.exit(1);
  }

  const result = await syncCuratedToAPI(curatedPath, accessToken || '', {
    dryRun,
    entityId,
    refreshToken,
    limit,
  });

  console.log('\n=== RESULT ===');
  console.log(`Created: ${result.created}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Failed: ${result.failed}`);
}

main().catch(console.error);
