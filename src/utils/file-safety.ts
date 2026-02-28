/**
 * File Safety Utilities
 *
 * Prevents accidental creation of customer data files in root directory.
 * All customer-related files must be created within customers/<name>/ folders.
 */

import { join, resolve, relative } from 'path';
import { existsSync } from 'fs';

const PROJECT_ROOT = resolve('.');
const CUSTOMERS_DIR = join(PROJECT_ROOT, 'customers');

/**
 * Validates that a file path is within the customers directory
 */
export function validateCustomerFilePath(filePath: string, customerName?: string): void {
  const absolutePath = resolve(filePath);
  const relativePath = relative(PROJECT_ROOT, absolutePath);

  // Check if file would be created in root
  if (!relativePath.startsWith('customers/')) {
    throw new Error(
      `❌ SAFETY CHECK FAILED: Customer data files must be created in customers/ folder.\n` +
      `   Attempted path: ${filePath}\n` +
      `   Required pattern: customers/<customer-name>/...\n` +
      `   Use getCustomerPaths() to get proper paths.`
    );
  }

  // If customer name provided, ensure it's in the right customer folder
  if (customerName) {
    const expectedPrefix = `customers/${customerName}/`;
    if (!relativePath.startsWith(expectedPrefix)) {
      throw new Error(
        `❌ SAFETY CHECK FAILED: File must be in ${expectedPrefix}\n` +
        `   Attempted path: ${relativePath}\n` +
        `   Use getCustomerPaths('${customerName}') to get proper paths.`
      );
    }
  }
}

/**
 * Safe wrapper for creating customer data files
 */
export function safeCustomerFilePath(customerName: string, subPath: string): string {
  const fullPath = join(CUSTOMERS_DIR, customerName, subPath);
  validateCustomerFilePath(fullPath, customerName);
  return fullPath;
}

/**
 * Get standard customer directory structure
 */
export function getCustomerDataPaths(customerName: string) {
  const base = join(CUSTOMERS_DIR, customerName);

  return {
    base,
    incoming: join(base, 'incoming'),
    structure: join(base, 'structure'),
    indexed: join(base, 'indexed'),
    approved: join(base, 'approved'),
    apiReady: join(base, 'api-ready'),
    apiEvidence: join(base, 'api-evidence'),

    // Helper methods that validate before returning paths
    answerLibrary: (filename: string) => safeCustomerFilePath(customerName, filename),
    policyQuestions: (filename: string) => safeCustomerFilePath(customerName, filename),
    evidenceData: (filename: string) => safeCustomerFilePath(customerName, `api-evidence/${filename}`),
  };
}

/**
 * Check if we're accidentally working in root
 */
export function preventRootDirectoryMistakes() {
  const cwd = process.cwd();
  if (cwd === PROJECT_ROOT) {
    console.warn('⚠️  WARNING: Working in project root. Use customer-specific paths for data files.');
  }
}