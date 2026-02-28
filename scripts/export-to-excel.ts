/**
 * Export Grouped Answers to Excel by Topic
 */

import * as fs from 'fs';
import * as XLSX from 'xlsx';

interface GroupedItem {
  id: string;
  label: string;
  fullLabel: string;
  value: string;
  topic: string;
  section: string;
  sources: string[];
}

interface GroupedData {
  customer: string;
  answerLibrary: {
    items: GroupedItem[];
  };
}

const customer = process.argv[2] || 'Doehler Oosterhout';
const inputPath = `./api-ready/${customer}-grouped.json`;
const outputPath = `./customers/${customer}/api-ready/${customer.replace(/ /g, '_')}-curated.xlsx`;

// Load grouped data
const data: GroupedData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

// Group items by topic
const byTopic = new Map<string, GroupedItem[]>();
for (const item of data.answerLibrary.items) {
  const topic = item.topic || 'other';
  if (!byTopic.has(topic)) {
    byTopic.set(topic, []);
  }
  byTopic.get(topic)!.push(item);
}

// Create workbook
const wb = XLSX.utils.book_new();

// Create a sheet for each topic
const sortedTopics = Array.from(byTopic.keys()).sort();
for (const topic of sortedTopics) {
  const items = byTopic.get(topic)!;

  // Create rows
  const rows = items.map(item => ({
    'ID': item.id,
    'Question': item.fullLabel || item.label,
    'Answer': item.value,
    'Section': item.section,
    'Sources': item.sources.join(', '),
    'Include?': 'YES', // Default to include
    'Rephrased Question': '',
    'Notes': '',
  }));

  // Create worksheet
  const ws = XLSX.utils.json_to_sheet(rows);

  // Set column widths
  ws['!cols'] = [
    { wch: 10 },  // ID
    { wch: 80 },  // Question
    { wch: 50 },  // Answer
    { wch: 30 },  // Section
    { wch: 40 },  // Sources
    { wch: 10 },  // Include?
    { wch: 80 },  // Rephrased
    { wch: 30 },  // Notes
  ];

  // Truncate sheet name to 31 chars (Excel limit)
  const sheetName = topic.substring(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

// Create summary sheet
const summaryRows = sortedTopics.map(topic => ({
  'Topic': topic,
  'Count': byTopic.get(topic)!.length,
}));
const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
summaryWs['!cols'] = [{ wch: 30 }, { wch: 10 }];
XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

// Ensure output directory exists
const outputDir = `./customers/${customer}/api-ready`;
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write file
XLSX.writeFile(wb, outputPath);

console.log(`\n Exported to: ${outputPath}`);
console.log(`\nTopics (${sortedTopics.length}):`);
for (const topic of sortedTopics) {
  console.log(`  ${topic}: ${byTopic.get(topic)!.length} items`);
}
console.log(`\nTotal items: ${data.answerLibrary.items.length}`);
