import 'dotenv/config';
import { writeFileSync } from 'fs';
import { getValidAccessToken } from '../src/config/token-manager.js';

const API_BASE = 'https://production.passionfruitapi.com';

async function fetchAnswers() {
  console.log('Refreshing access token...');
  const token = await getValidAccessToken();
  console.log('Token refreshed successfully\n');

  // Fetch all pages
  const allItems: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${API_BASE}/api/v2/answers/?limit=${limit}&offset=${offset}`;
    const response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (response.status !== 200) {
      console.error('Error:', response.status, await response.text());
      return;
    }

    const data = await response.json() as { items: any[]; limit: number; offset: number };
    allItems.push(...data.items);
    console.log(`Fetched ${data.items.length} answers (offset ${offset})`);

    if (data.items.length < limit) break;
    offset += limit;
  }

  console.log(`\nTotal: ${allItems.length} answers from API`);

  // Save for comparison
  writeFileSync('customers/numidia/api-answers.json', JSON.stringify(allItems, null, 2));
  console.log('Saved to customers/numidia/api-answers.json');

  // Find duplicates by topic + answer
  console.log('\n=== FINDING DUPLICATES ===\n');

  const topics = [
    'business continuity', 'document control', 'records', 'food safety plan',
    'food quality plan', 'food safety and food quality', 'food legislation',
    'corrective action', 'preventive action', 'management responsibility',
    'management review', 'complaint management', 'internal audit',
    'supplier validation', 'stock rotation', 'incoming goods', 'food defense',
    'corporate quality policy', 'processing and manufacturing', 'verification schedule',
    'food safety fundamentals', 'haccp', 'iso 14', 'sqf', 'gfsi', 'sedex',
    'certification', 'emergency contact', 'core competencies'
  ];

  function extractTopic(q: string): string {
    const lower = q.toLowerCase();
    for (const topic of topics) {
      if (lower.includes(topic)) return topic;
    }
    return 'other';
  }

  // Group by topic
  const byTopic = new Map<string, any[]>();
  for (const answer of allItems) {
    const topic = extractTopic(answer.question || '');
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic)!.push(answer);
  }

  const duplicateCandidates: { topic: string; answer: string; items: any[] }[] = [];

  for (const [topic, items] of byTopic) {
    const byAnswer = new Map<string, any[]>();
    for (const item of items) {
      const ans = (item.answer || '').toLowerCase().trim();
      if (!byAnswer.has(ans)) byAnswer.set(ans, []);
      byAnswer.get(ans)!.push(item);
    }

    for (const [ans, group] of byAnswer) {
      if (group.length > 1) {
        const preview = ans.length > 30 ? ans.slice(0, 30) + '...' : ans;
        console.log('\n📦 TOPIC: "' + topic + '" | ANSWER: "' + preview + '" (' + group.length + ' items)');
        console.log('─'.repeat(70));
        group.forEach((g, i) => {
          console.log('  ' + (i + 1) + '. [ID ' + g.id + '] ' + g.question);
        });
        duplicateCandidates.push({ topic, answer: ans, items: group });
      }
    }
  }

  const totalDuplicates = duplicateCandidates.reduce((sum, d) => sum + d.items.length - 1, 0);
  console.log('\n\n=== SUMMARY ===');
  console.log('Topics with duplicates: ' + duplicateCandidates.length);
  console.log('Potential items to remove: ' + totalDuplicates);

  writeFileSync('customers/numidia/duplicate-candidates.json', JSON.stringify(duplicateCandidates, null, 2));
  console.log('\nSaved to customers/numidia/duplicate-candidates.json');
}

fetchAnswers();
