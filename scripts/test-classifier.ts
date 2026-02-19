/**
 * Test the document classifier
 */

import { readFile } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { classifyDocument, quickTocCheck } from '../src/services/analysis/document-classifier.js';

const execAsync = promisify(exec);

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.log('Usage: npx tsx scripts/test-classifier.ts <structure-json-path-or-pdf-path>');
    process.exit(1);
  }

  console.log(`\nClassifying: ${inputPath}\n`);

  let textContent = '';
  let filename = inputPath.split('/').pop() || 'unknown';

  // Check if input is a PDF or JSON
  if (inputPath.endsWith('.pdf')) {
    // Extract text directly from PDF
    console.log('Extracting text from PDF with pdftotext...');
    try {
      const { stdout } = await execAsync(`pdftotext -layout "${inputPath}" -`);
      textContent = stdout;
      console.log(`Extracted ${textContent.length} characters from PDF\n`);
    } catch (error) {
      console.error('Failed to extract text from PDF:', error);
      process.exit(1);
    }
  } else {
    // Load the structure file to get the markdown/text content
    const data = JSON.parse(await readFile(inputPath, 'utf-8'));

    // If we have sheets with rows, concatenate cell values
    if (data.sheets) {
      for (const sheet of data.sheets) {
        for (const row of sheet.rows || []) {
          const cells = row.cells || {};
          const rowText = Object.values(cells)
            .map((cell: any) => cell.value || '')
            .filter((v: string) => v)
            .join(' | ');
          if (rowText) {
            textContent += rowText + '\n';
          }
        }
      }
    }

    // Also check for raw markdown if available
    if (data.rawMarkdown) {
      textContent = data.rawMarkdown;
    }

    filename = data.source?.filename || filename;
  }

  console.log(`Content length: ${textContent.length} characters`);
  console.log(`First 500 chars:\n${textContent.slice(0, 500)}\n`);

  // Quick TOC check
  const isTocQuick = quickTocCheck(textContent);
  console.log(`Quick TOC check: ${isTocQuick ? 'YES - looks like TOC' : 'NO - not a TOC'}\n`);

  // Full classification
  console.log('Running full classification with Claude...\n');
  const classification = await classifyDocument(textContent, filename);

  console.log('=== CLASSIFICATION RESULT ===\n');
  console.log(`Document Type: ${classification.documentType}`);
  console.log(`Confidence: ${(classification.confidence * 100).toFixed(0)}%`);
  console.log(`Language: ${classification.language}`);
  console.log(`\nElements found: ${classification.elements.join(', ')}`);
  console.log(`\nSummary: ${classification.summary}`);
  console.log(`Topics: ${classification.topics.join(', ')}`);
  console.log(`\nHas table structure: ${classification.hasTableStructure}`);
  console.log(`Has text content: ${classification.hasTextContent}`);

  // Section-level decisions
  console.log(`\n=== SECTIONS (${classification.sections?.length || 0}) ===\n`);
  for (const section of classification.sections || []) {
    const icon = section.shouldExtract ? '✅' : '⏭️';
    console.log(`${icon} ${section.name}`);
    console.log(`   Type: ${section.type}`);
    console.log(`   Extract: ${section.shouldExtract ? 'YES' : 'SKIP'}`);
    console.log(`   Reason: ${section.reason}`);
    console.log();
  }

  console.log(`\n=== OVERALL DECISION ===`);
  console.log(`Should extract: ${classification.shouldExtract}`);
  console.log(`Reason: ${classification.extractionReason}`);
  console.log(`\nRecommended method: ${classification.recommendedMethod}`);
  console.log(`Method reason: ${classification.methodReason}`);

  if (classification.warnings.length > 0) {
    console.log(`\nWarnings: ${classification.warnings.join(', ')}`);
  }
}

main().catch(console.error);
