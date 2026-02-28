/**
 * Check API answers count and details
 */
import 'dotenv/config';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

async function main() {
  const client = new PassionfruitAPIClient();
  console.log('API:', client.url);
  console.log('Environment:', client.environment);

  const stats = await client.getStats();
  console.log('\nStats:', stats);

  const answers = await client.listAnswers();
  console.log('\nAnswers fetched:', answers.length);

  if (answers.length > 0) {
    // Group by date
    const byDate = new Map<string, number>();
    for (const a of answers) {
      const date = a.created_at?.split('T')[0] || 'unknown';
      byDate.set(date, (byDate.get(date) || 0) + 1);
    }

    console.log('\nAnswers by creation date:');
    for (const [date, count] of Array.from(byDate.entries()).sort()) {
      console.log(`  ${date}: ${count}`);
    }

    console.log('\nSample answers:');
    for (const a of answers.slice(0, 5)) {
      console.log(`  ID: ${a.id} | Created: ${a.created_at} | Q: ${a.question.substring(0, 60)}...`);
    }
  }
}

main().catch(console.error);
