#!/usr/bin/env tsx

/**
 * Custom Model Training Script
 *
 * Trains a custom Azure Document Intelligence model using our accumulated
 * questionnaire data and optimizes the current extraction pipeline.
 */

import { resolve } from 'path';
import { readdir, stat } from 'fs/promises';
import { trainCustomModel } from '../src/services/training/custom-model-trainer';
import { EnhancedAzureExtractor } from '../src/services/extractors/enhanced-azure';

async function main() {
  console.log('🎯 Custom Model Training Pipeline\n');

  try {
    // 1. Find all customer directories with approved data
    const customersDir = resolve('./customers');
    const customerPaths = await findCustomersWithApprovedData(customersDir);

    console.log(`📊 Found ${customerPaths.length} customers with training data:`);
    customerPaths.forEach(path => console.log(`  - ${path.split('/').pop()}`));

    if (customerPaths.length === 0) {
      console.log('❌ No training data found. Run questionnaire processing first.');
      process.exit(1);
    }

    // 2. Analyze training data quality
    console.log('\n📈 Analyzing training data quality...');
    const dataAnalysis = await analyzeTrainingDataQuality(customerPaths);
    console.log(`  - Total documents: ${dataAnalysis.totalDocuments}`);
    console.log(`  - High quality: ${dataAnalysis.highQuality}`);
    console.log(`  - Medium quality: ${dataAnalysis.mediumQuality}`);
    console.log(`  - Low quality: ${dataAnalysis.lowQuality}`);

    if (dataAnalysis.highQuality < 10) {
      console.log('⚠️  Warning: Less than 10 high-quality training samples. Consider processing more questionnaires.');
    }

    // 3. Train custom model
    console.log('\n🚀 Starting custom model training...');
    const modelId = await trainCustomModel(customerPaths);
    console.log(`✅ Custom model trained: ${modelId}`);

    // 4. Test enhanced extraction on sample documents
    console.log('\n🧪 Testing enhanced extraction...');
    await testEnhancedExtraction(customerPaths[0]);

    // 5. Generate training report
    console.log('\n📋 Generating training report...');
    await generateTrainingReport(modelId, dataAnalysis, customerPaths);

    console.log('\n🎉 Training pipeline completed successfully!');
    console.log(`\n📝 Next steps:`);
    console.log(`1. Set AZURE_MODEL_ID=${modelId} in your environment`);
    console.log(`2. Test extraction with: pnpm cli test-extraction -m ${modelId}`);
    console.log(`3. Deploy to production when ready`);

  } catch (error) {
    console.error('❌ Training failed:', error);
    process.exit(1);
  }
}

async function findCustomersWithApprovedData(customersDir: string): Promise<string[]> {
  const entries = await readdir(customersDir);
  const customerPaths: string[] = [];

  for (const entry of entries) {
    const customerPath = resolve(customersDir, entry);
    const customerStat = await stat(customerPath);

    if (!customerStat.isDirectory()) continue;

    // Check if customer has approved data
    const approvedDir = resolve(customerPath, 'approved');
    try {
      const approvedStat = await stat(approvedDir);
      if (approvedStat.isDirectory()) {
        const approvedFiles = await readdir(approvedDir);
        const jsonFiles = approvedFiles.filter(f => f.endsWith('.json'));

        if (jsonFiles.length > 0) {
          customerPaths.push(customerPath);
        }
      }
    } catch {
      // No approved directory
    }
  }

  return customerPaths;
}

async function analyzeTrainingDataQuality(customerPaths: string[]): Promise<{
  totalDocuments: number;
  highQuality: number;
  mediumQuality: number;
  lowQuality: number;
}> {
  let totalDocuments = 0;
  let highQuality = 0;
  let mediumQuality = 0;
  let lowQuality = 0;

  for (const customerPath of customerPaths) {
    const approvedDir = resolve(customerPath, 'approved');
    const approvedFiles = await readdir(approvedDir);
    const jsonFiles = approvedFiles.filter(f => f.endsWith('.json'));

    totalDocuments += jsonFiles.length;

    // Simple quality scoring based on file size and structure
    // In reality, you'd analyze the content more deeply
    for (const file of jsonFiles) {
      const fileStat = await stat(resolve(approvedDir, file));
      const sizeKB = fileStat.size / 1024;

      if (sizeKB > 50) highQuality++; // Well-structured questionnaires tend to be larger
      else if (sizeKB > 20) mediumQuality++;
      else lowQuality++;
    }
  }

  return { totalDocuments, highQuality, mediumQuality, lowQuality };
}

async function testEnhancedExtraction(sampleCustomerPath: string): Promise<void> {
  const incomingDir = resolve(sampleCustomerPath, 'incoming');

  try {
    const files = await readdir(incomingDir);
    const pdfFiles = files.filter(f => f.endsWith('.pdf')).slice(0, 1); // Test first PDF

    if (pdfFiles.length === 0) {
      console.log('  - No PDF files found for testing');
      return;
    }

    const testFile = resolve(incomingDir, pdfFiles[0]);
    console.log(`  - Testing on: ${pdfFiles[0]}`);

    const extractor = new EnhancedAzureExtractor();
    const result = await extractor.extractWithOptimizations(testFile, {
      documentType: 'questionnaire',
      prioritizeTableStructure: true
    });

    console.log(`  - ✅ Extraction successful`);
    console.log(`  - Pages: ${result.pages?.length || 0}`);
    console.log(`  - Tables: ${result.tables?.length || 0}`);
    console.log(`  - Paragraphs: ${result.paragraphs?.length || 0}`);

  } catch (error) {
    console.log(`  - ❌ Test extraction failed: ${error}`);
  }
}

async function generateTrainingReport(
  modelId: string,
  dataAnalysis: any,
  customerPaths: string[]
): Promise<void> {
  const reportPath = resolve('./training-report.md');

  const report = `# Custom Model Training Report

Generated: ${new Date().toISOString()}

## Model Information
- **Model ID**: \`${modelId}\`
- **Training Date**: ${new Date().toLocaleDateString()}
- **Model Type**: Azure Document Intelligence Custom Model

## Training Data Summary
- **Total Documents**: ${dataAnalysis.totalDocuments}
- **High Quality**: ${dataAnalysis.highQuality} (${((dataAnalysis.highQuality / dataAnalysis.totalDocuments) * 100).toFixed(1)}%)
- **Medium Quality**: ${dataAnalysis.mediumQuality} (${((dataAnalysis.mediumQuality / dataAnalysis.totalDocuments) * 100).toFixed(1)}%)
- **Low Quality**: ${dataAnalysis.lowQuality} (${((dataAnalysis.lowQuality / dataAnalysis.totalDocuments) * 100).toFixed(1)}%)

## Customers Included
${customerPaths.map(path => `- ${path.split('/').pop()}`).join('\n')}

## Deployment Instructions

### Environment Setup
\`\`\`bash
export AZURE_MODEL_ID=${modelId}
\`\`\`

### Testing
\`\`\`bash
# Test with enhanced extraction
pnpm cli test-extraction -m ${modelId}

# Compare with baseline
pnpm cli compare-models --baseline prebuilt-layout --custom ${modelId}
\`\`\`

### Production Deployment
1. Update environment variables in production
2. Monitor extraction accuracy
3. Collect feedback for next training iteration

## Next Steps
1. Validate model performance on test set
2. Deploy to staging environment
3. Collect production feedback
4. Schedule next training iteration

---
Generated by Custom Model Training Pipeline
`;

  await require('fs/promises').writeFile(reportPath, report);
  console.log(`  - Report saved to: ${reportPath}`);
}

// Run the training pipeline
if (require.main === module) {
  main();
}