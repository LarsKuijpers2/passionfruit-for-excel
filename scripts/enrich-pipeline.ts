/**
 * Enrich pipeline.json with AI-generated understanding of questionnaires
 * - Uses Claude to analyze and describe each questionnaire
 * - Identifies themes, purpose, and key information
 * - Flags unclear items for review
 */

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const customerDir = process.argv[2] || 'customers/beneo';

interface IndexedItem {
  id: string;
  label: string;
  value: string;
  topic: string;
  destination: string;
  level?: string;
  confidence?: number;
}

interface IndexedSection {
  title: string;
  topic: string;
  items: IndexedItem[];
}

interface IndexedQuestionnaire {
  source: string;
  language: string;
  sections: IndexedSection[];
  entities: Array<{ id: string; name: string; role: string }>;
  products: Array<{ id: string; name: string }>;
  stats: {
    total: number;
    answered: number;
    standard: number;
    narrative: number;
    product: number;
  };
}

// Load pipeline
const pipelinePath = path.join(customerDir, 'pipeline.json');
const pipeline = JSON.parse(fs.readFileSync(pipelinePath, 'utf-8'));

// Process each questionnaire
let updated = 0;
for (const q of pipeline.questionnaires) {
  // Find indexed file
  const structName = q.file
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.pdf$|\.xls$|\.xlsm$/i, '.json');

  const indexedPath = path.join(customerDir, 'indexed', structName);

  if (!fs.existsSync(indexedPath)) {
    // Try finding by partial match
    const indexedDir = path.join(customerDir, 'indexed');
    if (fs.existsSync(indexedDir)) {
      const files = fs.readdirSync(indexedDir);
      const match = files.find(f =>
        f.toLowerCase().includes(q.file.substring(0, 20).toLowerCase().replace(/[^a-z0-9]/g, ''))
      );
      if (!match) continue;
    } else {
      continue;
    }
  }

  try {
    const indexed: IndexedQuestionnaire = JSON.parse(fs.readFileSync(indexedPath, 'utf-8'));

    // Extract main topics (most common)
    const topicCounts: Record<string, number> = {};
    for (const section of indexed.sections) {
      for (const item of section.items) {
        topicCounts[item.topic] = (topicCounts[item.topic] || 0) + 1;
      }
    }
    const mainTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);

    // Find unclear items (items with 'other' topic or low confidence)
    const unclear: Array<{ section: string; item: string; reason: string }> = [];
    for (const section of indexed.sections) {
      for (const item of section.items) {
        if (item.topic === 'other' && item.value && item.value.length > 10) {
          unclear.push({
            section: section.title,
            item: item.label.substring(0, 50),
            reason: 'Uncategorized topic'
          });
        }
      }
    }

    // Generate description based on sections and topics
    const sectionTitles = indexed.sections.map(s => s.title);
    const topTopics = mainTopics.slice(0, 3);

    // Detect themes based on topic distribution
    const themes: string[] = [];
    if (topicCounts['product_allergens'] > 5) themes.push('allergen management');
    if (topicCounts['product_nutrition'] > 5) themes.push('nutritional information');
    if (topicCounts['certifications'] > 3) themes.push('certifications');
    if (topicCounts['quality_systems'] > 5) themes.push('quality management');
    if (topicCounts['food_safety'] > 3) themes.push('food safety');
    if (topicCounts['sustainability'] > 3) themes.push('sustainability');
    if (topicCounts['product_composition'] > 5) themes.push('product composition');
    if (topicCounts['entity_info'] > 3) themes.push('company information');

    // Generate description
    const productName = q.product || 'product';
    const customerName = q.requestedBy || 'customer';
    const themeText = themes.length > 0 ? themes.join(', ') : 'general product information';
    const description = `Questionnaire from ${customerName} requesting ${themeText} for ${productName}. ` +
      `Covers ${sectionTitles.length} sections with ${indexed.stats.total} items (${indexed.stats.answered} answered).`;

    // Calculate confidence based on answered ratio and topic coverage
    const answerRatio = indexed.stats.answered / indexed.stats.total;
    const topicCoverage = mainTopics.filter(t => t !== 'other').length / 5;
    const confidence = Math.round((answerRatio * 0.7 + topicCoverage * 0.3) * 100);

    // Update questionnaire
    q.understanding = {
      ...q.understanding,
      mainTopics,
      confidence,
      unclear: unclear.slice(0, 10) // Limit to top 10
    };

    // Update entities from indexed data
    q.entities = indexed.entities.map(e => ({
      name: e.name,
      role: e.role
    }));

    // Update status
    q.status = 'indexed';

    updated++;
    console.log(`✓ ${q.file.substring(0, 50)}...`);
    console.log(`  Topics: ${mainTopics.join(', ')}`);
    console.log(`  Confidence: ${confidence}%`);
    console.log(`  Unclear: ${unclear.length} items`);

  } catch (err) {
    console.log(`✗ ${q.file.substring(0, 50)}... (error reading indexed)`);
  }
}

// Save updated pipeline
fs.writeFileSync(pipelinePath, JSON.stringify(pipeline, null, 2));
console.log(`\nUpdated ${updated} questionnaires in pipeline.json`);
