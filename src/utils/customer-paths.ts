/**
 * Customer Paths Helper
 *
 * Manages customer-specific folder structure for the pipeline.
 * All data is organized per-customer under the customers/ directory.
 */

import { join, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';

// =============================================================================
// TYPES
// =============================================================================

export interface CustomerPaths {
  /** Customer identifier */
  customer: string;
  /** Root directory for this customer */
  root: string;
  /** Incoming questionnaire files */
  incoming: string;
  /** Document structure JSON (cells, rows, sheets) */
  structure: string;
  /** AI-indexed questionnaires with Q&A pairs */
  indexed: string;
  /** Human-approved items grouped by destination */
  approved: string;
  /** Customer's answer library */
  answerLibrary: string;
  /** Customer-specific rules directory */
  rules: string;
  /** Final API-ready export files */
  apiReady: string;
  /** Review output directory */
  review: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Base directory for all customer data */
const CUSTOMERS_DIR = './customers';

/** Global rules directory (fallback) */
const GLOBAL_RULES_DIR = './rules';

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Get all paths for a customer
 */
export function getCustomerPaths(customer: string): CustomerPaths {
  const root = resolve(CUSTOMERS_DIR, customer);

  return {
    customer,
    root,
    incoming: join(root, 'incoming'),
    structure: join(root, 'structure'),
    indexed: join(root, 'indexed'),
    approved: join(root, 'approved'),
    answerLibrary: join(root, 'answer-library.yaml'),
    rules: join(root, 'rules'),
    apiReady: join(root, 'api-ready'),
    review: join(root, 'review'),
  };
}

/**
 * Ensure all customer directories exist
 */
export function ensureCustomerDirs(customer: string): CustomerPaths {
  const paths = getCustomerPaths(customer);

  // Create all directories
  const dirs = [
    paths.incoming,
    paths.structure,
    paths.indexed,
    paths.approved,
    paths.rules,
    paths.apiReady,
    paths.review,
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  return paths;
}

/**
 * List all customers (directories under customers/)
 */
export function listCustomers(): string[] {
  const customersDir = resolve(CUSTOMERS_DIR);

  if (!existsSync(customersDir)) {
    return [];
  }

  return readdirSync(customersDir)
    .filter((name) => {
      const fullPath = join(customersDir, name);
      return statSync(fullPath).isDirectory() && !name.startsWith('.');
    })
    .sort();
}

/**
 * Check if a customer exists
 */
export function customerExists(customer: string): boolean {
  const paths = getCustomerPaths(customer);
  return existsSync(paths.root);
}

/**
 * Get the rules directory for a customer (with global fallback)
 *
 * Returns customer-specific rules if they exist, otherwise global rules.
 */
export function getRulesDir(customer?: string): string {
  if (customer) {
    const paths = getCustomerPaths(customer);
    if (existsSync(paths.rules)) {
      return paths.rules;
    }
  }
  return resolve(GLOBAL_RULES_DIR);
}

/**
 * Get a specific rules file path (with global fallback)
 *
 * Looks for the file in customer rules first, then global rules.
 */
export function getRulesFile(filename: string, customer?: string): string | null {
  // Try customer-specific first
  if (customer) {
    const paths = getCustomerPaths(customer);
    const customerFile = join(paths.rules, filename);
    if (existsSync(customerFile)) {
      return customerFile;
    }
  }

  // Fall back to global
  const globalFile = join(resolve(GLOBAL_RULES_DIR), filename);
  if (existsSync(globalFile)) {
    return globalFile;
  }

  return null;
}

/**
 * Detect customer from a file path
 *
 * If the file is under customers/<name>/..., returns the customer name.
 * Otherwise returns undefined.
 */
export function detectCustomerFromPath(filePath: string): string | undefined {
  const resolved = resolve(filePath);
  const customersDir = resolve(CUSTOMERS_DIR);

  if (resolved.startsWith(customersDir)) {
    const relative = resolved.slice(customersDir.length + 1);
    const parts = relative.split('/');
    if (parts.length > 0 && parts[0]) {
      return parts[0];
    }
  }

  return undefined;
}

/**
 * Get legacy paths (for backward compatibility during migration)
 */
export function getLegacyPaths() {
  return {
    incoming: './incoming',
    structure: './questionnaires',  // Legacy name was "questionnaires"
    indexed: './indexed',
    approved: './approved-exports',
    answerLibrary: './answer-library.yaml',
    rules: './rules',
    apiReady: './api-ready',
    review: './review',
  };
}
