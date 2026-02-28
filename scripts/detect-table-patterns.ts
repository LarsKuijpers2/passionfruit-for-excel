/**
 * Table Pattern Detector
 *
 * Tests the pattern detection logic against structure files.
 * Run: npx ts-node scripts/detect-table-patterns.ts [customer]
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// Types
interface Pattern {
  id: string;
  name: string;
  description: string;
  frequency: string;
  languages: string[];
  detection: {
    headerKeywords?: string[];
    headerKeywordsMatchCount?: number;
    columnCount?: { min: number; max: number };
    noCheckboxHeaders?: boolean;
    hasMergedCells?: boolean;
    matrixStructure?: boolean;
    longTextValues?: boolean;
  };
  columns: Record<string, unknown>;
  extraction: Record<string, unknown>;
  examples: string[];
}

interface PatternLibrary {
  patterns: Pattern[];
  detectionPriority: string[];
  languageDetection: Record<string, { keywords: string[]; yesNo: Record<string, string> }>;
}

interface Cell {
  ref: string;
  value: string;
  type: string;
  filled: boolean;
  role: string;
  format?: {
    isMerged?: boolean;
    mergeRange?: string;
  };
}

interface Row {
  row: number;
  cells: Record<string, Cell>;
  isEmpty: boolean;
  rowType: string;
}

interface Sheet {
  name: string;
  index: number;
  rows: Row[];
}

interface StructureFile {
  source: {
    filename: string;
    documentType: string;
  };
  sheets: Sheet[];
}

interface TableInfo {
  sheetName: string;
  headerRow: number;
  headers: string[];
  columnCount: number;
  hasMergedCells: boolean;
  sampleDataRows: string[][];
}

interface DetectionResult {
  file: string;
  tables: Array<{
    sheet: string;
    headerRow: number;
    headers: string[];
    columnCount: number;
    matchedPattern: string | null;
    matchScore: number;
    matchDetails: string[];
  }>;
}

// Load pattern library
async function loadPatterns(): Promise<PatternLibrary> {
  const content = await readFile('./knowledge/table-patterns.json', 'utf-8');
  return JSON.parse(content);
}

// Extract table info from structure
function extractTables(structure: StructureFile): TableInfo[] {
  const tables: TableInfo[] = [];

  for (const sheet of structure.sheets) {
    // Find header rows
    const headerRows = sheet.rows.filter(r => r.rowType === 'header');

    for (const headerRow of headerRows) {
      const cells = Object.values(headerRow.cells);
      const filledCells = cells.filter(c => c.filled && c.value?.trim());

      if (filledCells.length < 2) continue; // Skip single-cell headers

      const headers = filledCells.map(c => c.value?.trim() || '');
      const hasMergedCells = cells.some(c => c.format?.isMerged);

      // Get sample data rows after this header
      const headerIdx = sheet.rows.findIndex(r => r.row === headerRow.row);
      const dataRows = sheet.rows
        .slice(headerIdx + 1, headerIdx + 4)
        .filter(r => r.rowType === 'data')
        .map(r => Object.values(r.cells).map(c => c.value?.trim() || ''));

      tables.push({
        sheetName: sheet.name,
        headerRow: headerRow.row,
        headers,
        columnCount: filledCells.length,
        hasMergedCells,
        sampleDataRows: dataRows,
      });
    }
  }

  return tables;
}

// Match a table against patterns
function matchPattern(table: TableInfo, patterns: Pattern[], priority: string[]): {
  pattern: string | null;
  score: number;
  details: string[];
} {
  let bestMatch: { pattern: string | null; score: number; details: string[] } = {
    pattern: null,
    score: 0,
    details: [],
  };

  const headersLower = table.headers.map(h => h.toLowerCase());
  const headersJoined = headersLower.join(' ');

  for (const patternId of priority) {
    const pattern = patterns.find(p => p.id === patternId);
    if (!pattern) continue;

    let score = 0;
    const details: string[] = [];

    // Check column count
    if (pattern.detection.columnCount) {
      const { min, max } = pattern.detection.columnCount;
      if (table.columnCount >= min && table.columnCount <= max) {
        score += 20;
        details.push(`Column count ${table.columnCount} in range [${min}-${max}]`);
      } else {
        continue; // Hard fail if column count doesn't match
      }
    }

    // Check header keywords
    if (pattern.detection.headerKeywords) {
      const keywords = pattern.detection.headerKeywords.map(k => k.toLowerCase());
      const matchCount = keywords.filter(kw =>
        headersLower.some(h => h.includes(kw)) || headersJoined.includes(kw.toLowerCase())
      ).length;

      const required = pattern.detection.headerKeywordsMatchCount || 1;

      if (matchCount >= required) {
        score += matchCount * 15;
        details.push(`Matched ${matchCount}/${keywords.length} keywords: ${keywords.filter(kw => headersJoined.includes(kw.toLowerCase())).join(', ')}`);
      } else {
        continue; // Hard fail if not enough keywords match
      }
    }

    // Check merged cells requirement
    if (pattern.detection.hasMergedCells !== undefined) {
      if (pattern.detection.hasMergedCells === table.hasMergedCells) {
        score += 10;
        details.push(`Merged cells: ${table.hasMergedCells}`);
      }
    }

    // Check noCheckboxHeaders
    if (pattern.detection.noCheckboxHeaders) {
      const checkboxKeywords = ['yes', 'no', 'ja', 'nein', 'oui', 'non', 'nee'];
      const hasCheckbox = headersLower.some(h => checkboxKeywords.includes(h));
      if (!hasCheckbox) {
        score += 10;
        details.push('No checkbox headers found');
      } else {
        continue; // Hard fail
      }
    }

    // Bonus for language-specific matches
    if (pattern.languages.length === 1) {
      score += 5; // Prefer specific language patterns
    }

    if (score > bestMatch.score) {
      bestMatch = { pattern: patternId, score, details };
    }
  }

  return bestMatch;
}

// Detect language from headers
function detectLanguage(headers: string[], langDetection: PatternLibrary['languageDetection']): string {
  const headersLower = headers.map(h => h.toLowerCase()).join(' ');

  const scores: Record<string, number> = {};

  for (const [lang, config] of Object.entries(langDetection)) {
    scores[lang] = config.keywords.filter(kw =>
      headersLower.includes(kw.toLowerCase())
    ).length;
  }

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return 'unknown';

  return Object.entries(scores).find(([_, s]) => s === maxScore)?.[0] || 'unknown';
}

// Main function
async function main() {
  const customer = process.argv[2];

  console.log('\n📊 Table Pattern Detector\n');
  console.log('═'.repeat(60));

  // Load patterns
  const library = await loadPatterns();
  console.log(`Loaded ${library.patterns.length} patterns\n`);

  // Find structure files
  const customersDir = './customers';
  let customers: string[];

  if (customer) {
    customers = [customer];
  } else {
    customers = (await readdir(customersDir)).filter(c =>
      existsSync(join(customersDir, c, 'structure'))
    );
  }

  const results: DetectionResult[] = [];
  const patternCounts: Record<string, number> = {};
  const unmatchedTables: Array<{ file: string; headers: string[] }> = [];

  for (const cust of customers) {
    const structureDir = join(customersDir, cust, 'structure');
    if (!existsSync(structureDir)) continue;

    const files = (await readdir(structureDir)).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const content = await readFile(join(structureDir, file), 'utf-8');
      const structure: StructureFile = JSON.parse(content);

      const tables = extractTables(structure);
      const fileResult: DetectionResult = {
        file: `${cust}/${file}`,
        tables: [],
      };

      for (const table of tables) {
        const match = matchPattern(table, library.patterns, library.detectionPriority);
        const lang = detectLanguage(table.headers, library.languageDetection);

        fileResult.tables.push({
          sheet: table.sheetName,
          headerRow: table.headerRow,
          headers: table.headers,
          columnCount: table.columnCount,
          matchedPattern: match.pattern,
          matchScore: match.score,
          matchDetails: match.details,
        });

        if (match.pattern) {
          patternCounts[match.pattern] = (patternCounts[match.pattern] || 0) + 1;
        } else {
          unmatchedTables.push({ file: `${cust}/${file}`, headers: table.headers });
        }
      }

      if (fileResult.tables.length > 0) {
        results.push(fileResult);
      }
    }
  }

  // Print results
  console.log('\n📋 DETECTION RESULTS\n');

  for (const result of results) {
    console.log(`\n📄 ${result.file}`);

    for (const table of result.tables) {
      const status = table.matchedPattern ? '✅' : '❌';
      const pattern = table.matchedPattern || 'NO MATCH';
      console.log(`   ${status} Row ${table.headerRow}: ${pattern} (score: ${table.matchScore})`);
      console.log(`      Headers: ${table.headers.slice(0, 5).join(' | ')}${table.headers.length > 5 ? ' ...' : ''}`);
      if (table.matchDetails.length > 0) {
        console.log(`      Match: ${table.matchDetails[0]}`);
      }
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY\n');

  console.log('Pattern distribution:');
  const sortedPatterns = Object.entries(patternCounts).sort((a, b) => b[1] - a[1]);
  for (const [pattern, count] of sortedPatterns) {
    console.log(`   ${pattern}: ${count} tables`);
  }

  const totalTables = results.reduce((sum, r) => sum + r.tables.length, 0);
  const matchedTables = results.reduce((sum, r) => sum + r.tables.filter(t => t.matchedPattern).length, 0);

  console.log(`\nTotal: ${matchedTables}/${totalTables} tables matched (${Math.round(matchedTables/totalTables*100)}%)`);

  if (unmatchedTables.length > 0) {
    console.log(`\n⚠️  ${unmatchedTables.length} unmatched tables:`);
    for (const t of unmatchedTables.slice(0, 10)) {
      console.log(`   ${t.file}`);
      console.log(`      Headers: ${t.headers.slice(0, 4).join(' | ')}`);
    }
    if (unmatchedTables.length > 10) {
      console.log(`   ... and ${unmatchedTables.length - 10} more`);
    }
  }

  console.log('\n✅ Detection complete\n');
}

main().catch(console.error);
