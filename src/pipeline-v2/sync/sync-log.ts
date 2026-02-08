/**
 * Sync Log
 *
 * Tracks what has been synced to the Passionfruit API.
 * Maps local IDs to API IDs for entities and answers.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const SYNC_LOG_PATH = './api-ready/sync-log.yaml';

export interface EntitySyncRecord {
  apiId: number;
  name: string;
  syncedAt: string;
  action: 'create' | 'update';
}

export interface AnswerSyncRecord {
  localId: string;
  apiId: number;
  question: string;
  syncedAt: string;
  action: 'create' | 'update';
}

export interface SyncLog {
  lastUpdated: string;
  environment: string;
  entity?: EntitySyncRecord;
  answers: Record<string, AnswerSyncRecord>; // keyed by localId
}

/**
 * Load the sync log
 */
export async function loadSyncLog(): Promise<SyncLog> {
  try {
    const content = await readFile(SYNC_LOG_PATH, 'utf-8');
    return parseYaml(content);
  } catch {
    // Return empty log if file doesn't exist
    return {
      lastUpdated: new Date().toISOString(),
      environment: '',
      answers: {},
    };
  }
}

/**
 * Save the sync log
 */
export async function saveSyncLog(log: SyncLog): Promise<void> {
  await mkdir('./api-ready', { recursive: true });
  log.lastUpdated = new Date().toISOString();
  await writeFile(SYNC_LOG_PATH, stringifyYaml(log, { lineWidth: 0 }), 'utf-8');
}

/**
 * Record an entity sync
 */
export async function recordEntitySync(
  apiId: number,
  name: string,
  action: 'create' | 'update',
  environment: string
): Promise<void> {
  const log = await loadSyncLog();
  log.environment = environment;
  log.entity = {
    apiId,
    name,
    syncedAt: new Date().toISOString(),
    action,
  };
  await saveSyncLog(log);
}

/**
 * Record answer syncs (batch)
 */
export async function recordAnswerSyncs(
  records: Array<{
    localId: string;
    apiId: number;
    question: string;
    action: 'create' | 'update';
  }>,
  environment: string
): Promise<void> {
  const log = await loadSyncLog();
  log.environment = environment;

  const now = new Date().toISOString();
  for (const record of records) {
    log.answers[record.localId] = {
      localId: record.localId,
      apiId: record.apiId,
      question: record.question,
      syncedAt: now,
      action: record.action,
    };
  }

  await saveSyncLog(log);
}

/**
 * Get API ID for a local answer ID
 */
export async function getAnswerApiId(localId: string): Promise<number | null> {
  const log = await loadSyncLog();
  return log.answers[localId]?.apiId ?? null;
}

/**
 * Get API ID for entity
 */
export async function getEntityApiId(): Promise<number | null> {
  const log = await loadSyncLog();
  return log.entity?.apiId ?? null;
}

/**
 * Find answer by question text in sync log
 */
export async function findAnswerByQuestion(question: string): Promise<AnswerSyncRecord | null> {
  const log = await loadSyncLog();
  const normalizedQ = question.toLowerCase().trim();

  for (const record of Object.values(log.answers)) {
    if (record.question.toLowerCase().trim() === normalizedQ) {
      return record;
    }
  }

  return null;
}
