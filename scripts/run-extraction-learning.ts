#!/usr/bin/env npx tsx
/**
 * Run Extraction Learning Cycle
 *
 * Scans all questionnaires for feedback notes, analyzes patterns,
 * and generates prompt improvements for the visual analyzer.
 *
 * Usage:
 *   npx tsx scripts/run-extraction-learning.ts [--apply] [--export]
 *
 * Options:
 *   --apply   Apply pending improvements to visual-analyzer.ts
 *   --export  Export improvements to a separate file
 *   --report  Generate detailed markdown report
 */

import { ExtractionLearner, runLearningCycle } from '../src/services/learning/extraction-learner.js';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function main() {
  const args = process.argv.slice(2);
  const shouldApply = args.includes('--apply');
  const shouldExport = args.includes('--export');
  const shouldReport = args.includes('--report');

  // Run the learning cycle
  await runLearningCycle('./customers');

  const learner = new ExtractionLearner();
  await learner.load();

  // Export prompt additions if requested
  if (shouldExport) {
    const additions = learner.exportPromptAdditions();
    const exportPath = './knowledge/prompt-improvements.txt';
    await writeFile(exportPath, additions);
    console.log(`\n📄 Exported prompt additions to ${exportPath}`);
  }

  // Generate detailed report if requested
  if (shouldReport) {
    const report = await generateReport(learner);
    const reportPath = './knowledge/extraction-learning-report.md';
    await writeFile(reportPath, report);
    console.log(`\n📊 Generated detailed report at ${reportPath}`);
  }

  // Apply improvements if requested
  if (shouldApply) {
    console.log('\n⚠️  --apply not yet implemented');
    console.log('   To apply improvements, manually add the prompt additions to visual-analyzer.ts');
  }
}

async function generateReport(learner: ExtractionLearner): Promise<string> {
  const summary = learner.getSummary();

  let report = `# Extraction Learning Report

Generated: ${new Date().toISOString()}

## Summary

- **Total Issues Tracked**: ${summary.totalIssues}
- **Categories**: ${Object.keys(summary.byCategory).length}
- **Pending Improvements**: ${summary.pendingImprovements.length}

## Issues by Category

| Category | Count | Description |
|----------|-------|-------------|
`;

  for (const pattern of summary.topPatterns) {
    report += `| ${pattern.category} | ${pattern.count} | ${pattern.description.slice(0, 50)}... |\n`;
  }

  report += `

## Top Patterns

`;

  for (const pattern of summary.topPatterns) {
    report += `### ${pattern.category} (${pattern.count} occurrences)

**Description**: ${pattern.description}

**Suggested Fix**: ${pattern.suggestedFix || 'Manual review required'}

**Examples**:
`;
    for (const example of pattern.examples.slice(0, 3)) {
      report += `- \`${example.label}\` in ${example.questionnaire}
  - Note: "${example.note}"
`;
    }
    report += '\n';
  }

  report += `## Pending Prompt Improvements

`;

  if (summary.pendingImprovements.length === 0) {
    report += '_No pending improvements_\n';
  } else {
    for (const imp of summary.pendingImprovements) {
      report += `### ${imp.category}

**Current Behavior**: ${imp.currentBehavior}

**Suggested Behavior**: ${imp.suggestedBehavior}

**Prompt Addition**:
\`\`\`
${imp.promptAddition}
\`\`\`

`;
    }
  }

  report += `---

## How to Use This Report

1. **Review patterns** to understand common extraction issues
2. **Apply pending improvements** by adding prompt additions to \`visual-analyzer.ts\`
3. **Update tag-rules.yaml** for tagging issues
4. **Re-run extraction** on problematic questionnaires to verify fixes

Run \`npx tsx scripts/run-extraction-learning.ts --apply\` to apply improvements automatically.
`;

  return report;
}

main().catch(console.error);
