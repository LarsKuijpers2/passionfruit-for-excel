/**
 * Create grouped-answers.json from approved exports
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

interface ApprovedItem {
  label: string;
  value: string;
  cells: string;
  section: string;
  topic: string;
  destination: string;
  source: string;
  approvedAt: string;
}

interface ApprovedFile {
  meta: {
    source: string;
    exportedAt: string;
    version: string;
  };
  items: ApprovedItem[];
}

interface GroupedItem {
  label: string;
  value: string;
  sources: string[];
}

interface TopicGroup {
  topic: string;
  items: GroupedItem[];
}

interface GroupedAnswers {
  customer: string;
  generatedAt: string;
  company: TopicGroup[];
  answer_library: TopicGroup[];
  product: TopicGroup[];
  excluded: TopicGroup[];
  stats: {
    totalItems: number;
    uniqueLabels: number;
    byTopic: Record<string, number>;
  };
}

// Map destination to category
const DESTINATION_MAP: Record<string, 'company' | 'answer_library' | 'product' | 'excluded'> = {
  company: 'company',
  entity: 'company',
  answer_library: 'answer_library',
  product: 'product',
  exclude: 'excluded',
};

// Company topics
const COMPANY_TOPICS = ['company', 'contacts', 'crisis', 'financial'];

function main() {
  const customer = process.argv[2] || 'kaas-pack';
  const approvedDir = join('./customers', customer, 'approved');

  if (!existsSync(approvedDir)) {
    console.error(`Approved directory not found: ${approvedDir}`);
    process.exit(1);
  }

  console.log(`Creating grouped-answers.json for: ${customer}\n`);

  // Read all approved folders
  const folders = readdirSync(approvedDir).filter(f =>
    existsSync(join(approvedDir, f, 'answer-library.json'))
  );

  console.log(`Found ${folders.length} approved questionnaires`);

  // Collect all items
  const allItems: ApprovedItem[] = [];

  for (const folder of folders) {
    const filePath = join(approvedDir, folder, 'answer-library.json');
    const data: ApprovedFile = JSON.parse(readFileSync(filePath, 'utf-8'));
    allItems.push(...data.items);
    console.log(`  ${folder}: ${data.items.length} items`);
  }

  console.log(`\nTotal items: ${allItems.length}`);

  // Group by normalized label + value
  const grouped = new Map<string, GroupedItem & { topic: string; destination: string }>();

  for (const item of allItems) {
    const key = `${item.label.toLowerCase().trim()}::${item.value.toLowerCase().trim()}`;

    if (grouped.has(key)) {
      const existing = grouped.get(key)!;
      if (!existing.sources.includes(item.source)) {
        existing.sources.push(item.source);
      }
    } else {
      grouped.set(key, {
        label: item.label,
        value: item.value,
        sources: [item.source],
        topic: item.topic,
        destination: item.destination,
      });
    }
  }

  console.log(`Unique items: ${grouped.size}`);

  // Organize by destination and topic
  const result: GroupedAnswers = {
    customer,
    generatedAt: new Date().toISOString(),
    company: [],
    answer_library: [],
    product: [],
    excluded: [],
    stats: {
      totalItems: allItems.length,
      uniqueLabels: grouped.size,
      byTopic: {},
    },
  };

  // Group by topic
  const topicGroups = new Map<string, Map<string, GroupedItem[]>>();

  for (const item of grouped.values()) {
    // Determine category based on topic or destination
    let category: 'company' | 'answer_library' | 'product' | 'excluded';

    if (COMPANY_TOPICS.includes(item.topic)) {
      category = 'company';
    } else {
      category = DESTINATION_MAP[item.destination] || 'answer_library';
    }

    if (!topicGroups.has(category)) {
      topicGroups.set(category, new Map());
    }

    const categoryMap = topicGroups.get(category)!;
    if (!categoryMap.has(item.topic)) {
      categoryMap.set(item.topic, []);
    }

    categoryMap.get(item.topic)!.push({
      label: item.label,
      value: item.value,
      sources: item.sources,
    });

    // Stats
    result.stats.byTopic[item.topic] = (result.stats.byTopic[item.topic] || 0) + 1;
  }

  // Convert to arrays
  for (const [category, topics] of topicGroups) {
    for (const [topic, items] of topics) {
      (result as any)[category].push({ topic, items });
    }
  }

  // Sort topics
  result.company.sort((a, b) => a.topic.localeCompare(b.topic));
  result.answer_library.sort((a, b) => a.topic.localeCompare(b.topic));
  result.product.sort((a, b) => a.topic.localeCompare(b.topic));

  // Save
  const outputPath = join('./customers', customer, 'grouped-answers.json');
  writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(`\n=== SUMMARY ===`);
  console.log(`Company topics: ${result.company.length}`);
  result.company.forEach(t => console.log(`  ${t.topic}: ${t.items.length} items`));
  console.log(`\nAnswer Library topics: ${result.answer_library.length}`);
  result.answer_library.forEach(t => console.log(`  ${t.topic}: ${t.items.length} items`));

  console.log(`\nSaved to: ${outputPath}`);
}

main();
