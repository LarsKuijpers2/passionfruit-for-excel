#!/usr/bin/env npx tsx

/**
 * Migration Script: Move Existing Files to Customer Folders
 *
 * This script migrates data from the legacy flat structure to the new
 * customer-based folder structure.
 *
 * Usage:
 *   npx tsx src/pipeline-v2/migrate-to-customer-folders.ts <customer>
 *   npx tsx src/pipeline-v2/migrate-to-customer-folders.ts <customer> --dry-run
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { ensureCustomerDirs, getCustomerPaths } from './customer-paths.js';

// =============================================================================
// TYPES
// =============================================================================

interface MigrationResult {
  customer: string;
  incoming: { copied: string[]; skipped: string[] };
  questionnaires: { copied: string[]; skipped: string[] };
  indexed: { copied: string[]; skipped: string[] };
  approved: { copied: string[]; skipped: string[] };
  answerLibrary: { copied: boolean; skipped: boolean };
}

// =============================================================================
// MIGRATION FUNCTIONS
// =============================================================================

/**
 * Copy files from source to destination directory
 */
function copyFiles(
  sourceDir: string,
  destDir: string,
  filter?: (filename: string) => boolean,
  dryRun = false
): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(sourceDir)) {
    return { copied, skipped };
  }

  const files = readdirSync(sourceDir).filter((f) => {
    if (f.startsWith('.')) return false;
    const fullPath = join(sourceDir, f);
    if (statSync(fullPath).isDirectory()) return false;
    if (filter && !filter(f)) return false;
    return true;
  });

  for (const file of files) {
    const sourcePath = join(sourceDir, file);
    const destPath = join(destDir, file);

    if (existsSync(destPath)) {
      skipped.push(file);
    } else {
      if (!dryRun) {
        copyFileSync(sourcePath, destPath);
      }
      copied.push(file);
    }
  }

  return { copied, skipped };
}

/**
 * Copy a single file
 */
function copySingleFile(
  sourcePath: string,
  destPath: string,
  dryRun = false
): { copied: boolean; skipped: boolean } {
  if (!existsSync(sourcePath)) {
    return { copied: false, skipped: false };
  }

  if (existsSync(destPath)) {
    return { copied: false, skipped: true };
  }

  if (!dryRun) {
    copyFileSync(sourcePath, destPath);
  }
  return { copied: true, skipped: false };
}

/**
 * Migrate data for a customer from legacy to new structure
 */
function migrateCustomer(customer: string, dryRun = false): MigrationResult {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Migrating: ${customer}${dryRun ? ' (DRY RUN)' : ''}`);
  console.log('='.repeat(60));

  // Ensure customer directories exist
  if (!dryRun) {
    ensureCustomerDirs(customer);
  }
  const paths = getCustomerPaths(customer);

  // Legacy paths
  const legacyIncoming = `./incoming/${customer}`;
  const legacyQuestionnaires = './questionnaires';
  const legacyIndexed = './indexed';
  const legacyApproved = `./approved-exports/${customer}`;
  const legacyLibrary = './answer-library.yaml';

  const result: MigrationResult = {
    customer,
    incoming: { copied: [], skipped: [] },
    questionnaires: { copied: [], skipped: [] },
    indexed: { copied: [], skipped: [] },
    approved: { copied: [], skipped: [] },
    answerLibrary: { copied: false, skipped: false },
  };

  // 1. Copy incoming files (customer-specific folder)
  console.log(`\n📥 Incoming files from ${legacyIncoming}:`);
  result.incoming = copyFiles(legacyIncoming, paths.incoming, undefined, dryRun);
  console.log(`   Copied: ${result.incoming.copied.length}`);
  console.log(`   Skipped: ${result.incoming.skipped.length}`);

  // 2. Copy questionnaires (need to identify which belong to this customer)
  // For now, we'll just copy all - user should review
  console.log(`\n📄 Questionnaires from ${legacyQuestionnaires}:`);
  result.questionnaires = copyFiles(
    legacyQuestionnaires,
    paths.questionnaires,
    (f) => f.endsWith('.json') || f.endsWith('.yaml'),
    dryRun
  );
  console.log(`   Copied: ${result.questionnaires.copied.length}`);
  console.log(`   Skipped: ${result.questionnaires.skipped.length}`);

  // 3. Copy indexed files
  console.log(`\n📇 Indexed files from ${legacyIndexed}:`);
  result.indexed = copyFiles(
    legacyIndexed,
    paths.indexed,
    (f) => f.endsWith('.yaml'),
    dryRun
  );
  console.log(`   Copied: ${result.indexed.copied.length}`);
  console.log(`   Skipped: ${result.indexed.skipped.length}`);

  // 4. Copy approved exports (customer-specific folder)
  console.log(`\n✅ Approved exports from ${legacyApproved}:`);
  if (existsSync(legacyApproved)) {
    // Approved exports are in subfolders per questionnaire
    const questionnaireFolders = readdirSync(legacyApproved).filter((f) => {
      const fullPath = join(legacyApproved, f);
      return statSync(fullPath).isDirectory() && !f.startsWith('.');
    });

    for (const qFolder of questionnaireFolders) {
      const sourceFolder = join(legacyApproved, qFolder);
      const destFolder = join(paths.approved, qFolder);

      if (!existsSync(destFolder)) {
        if (!dryRun) {
          mkdirSync(destFolder, { recursive: true });
        }
        // Copy all files in the folder
        const files = readdirSync(sourceFolder).filter(
          (f) => !f.startsWith('.') && !statSync(join(sourceFolder, f)).isDirectory()
        );
        for (const file of files) {
          if (!dryRun) {
            copyFileSync(join(sourceFolder, file), join(destFolder, file));
          }
          result.approved.copied.push(`${qFolder}/${file}`);
        }
      } else {
        result.approved.skipped.push(qFolder);
      }
    }
  }
  console.log(`   Copied: ${result.approved.copied.length} files`);
  console.log(`   Skipped: ${result.approved.skipped.length} folders`);

  // 5. Copy answer library (global → customer-specific)
  console.log(`\n📚 Answer library:`);
  if (existsSync(legacyLibrary)) {
    result.answerLibrary = copySingleFile(legacyLibrary, paths.answerLibrary, dryRun);
    if (result.answerLibrary.copied) {
      console.log(`   Copied: ${legacyLibrary} → ${paths.answerLibrary}`);
    } else if (result.answerLibrary.skipped) {
      console.log(`   Skipped: ${paths.answerLibrary} already exists`);
    }
  } else {
    console.log(`   No legacy library found at ${legacyLibrary}`);
  }

  return result;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: npx tsx src/pipeline-v2/migrate-to-customer-folders.ts <customer> [options]

Migrate data from legacy flat structure to customer folder structure.

Arguments:
  customer     Customer name to migrate

Options:
  --dry-run    Preview changes without copying files
  --all        Migrate all customers found in incoming/ and approved-exports/
  --help       Show this help

Examples:
  npx tsx src/pipeline-v2/migrate-to-customer-folders.ts kaas-pack
  npx tsx src/pipeline-v2/migrate-to-customer-folders.ts kaas-pack --dry-run
  npx tsx src/pipeline-v2/migrate-to-customer-folders.ts --all --dry-run
`);
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const migrateAll = args.includes('--all');

  if (migrateAll) {
    // Find all customers from incoming/ and approved-exports/
    const customers = new Set<string>();

    if (existsSync('./incoming')) {
      readdirSync('./incoming')
        .filter((f) => statSync(join('./incoming', f)).isDirectory() && !f.startsWith('.'))
        .forEach((c) => customers.add(c));
    }

    if (existsSync('./approved-exports')) {
      readdirSync('./approved-exports')
        .filter((f) => statSync(join('./approved-exports', f)).isDirectory() && !f.startsWith('.'))
        .forEach((c) => customers.add(c));
    }

    if (customers.size === 0) {
      console.log('\n❌ No customers found to migrate');
      process.exit(1);
    }

    console.log(`\nFound ${customers.size} customers to migrate:`);
    for (const c of customers) {
      console.log(`  - ${c}`);
    }

    const results: MigrationResult[] = [];
    for (const customer of customers) {
      results.push(migrateCustomer(customer, dryRun));
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('MIGRATION SUMMARY');
    console.log('='.repeat(60));
    for (const r of results) {
      const totalCopied =
        r.incoming.copied.length +
        r.questionnaires.copied.length +
        r.indexed.copied.length +
        r.approved.copied.length +
        (r.answerLibrary.copied ? 1 : 0);
      console.log(`  ${r.customer}: ${totalCopied} files copied`);
    }
  } else {
    const customer = args.find((a) => !a.startsWith('--'));
    if (!customer) {
      console.error('\n❌ Please provide a customer name');
      process.exit(1);
    }

    const result = migrateCustomer(customer, dryRun);

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('MIGRATION SUMMARY');
    console.log('='.repeat(60));
    const totalCopied =
      result.incoming.copied.length +
      result.questionnaires.copied.length +
      result.indexed.copied.length +
      result.approved.copied.length +
      (result.answerLibrary.copied ? 1 : 0);
    const totalSkipped =
      result.incoming.skipped.length +
      result.questionnaires.skipped.length +
      result.indexed.skipped.length +
      result.approved.skipped.length +
      (result.answerLibrary.skipped ? 1 : 0);

    console.log(`  Customer: ${result.customer}`);
    console.log(`  Files copied: ${totalCopied}`);
    console.log(`  Files skipped: ${totalSkipped}`);

    if (dryRun) {
      console.log(`\n⚠️  This was a dry run. No files were actually copied.`);
      console.log(`   Run without --dry-run to perform the migration.`);
    } else {
      console.log(`\n✅ Migration complete!`);
      console.log(`   Customer data is now in: customers/${result.customer}/`);
    }
  }
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
