import 'dotenv/config';
import { readFileSync } from 'fs';
import { getValidAccessToken } from '../src/config/token-manager';
import { getApiBaseUrl } from '../src/config/environments';

const allUpdates = JSON.parse(readFileSync('customers/numidia/ai-rephrased-updates.json', 'utf-8'));

// Exclude contact-related items - those were already synced properly
const contactRelatedIds = new Set([911, 912, 819, 820, 3801]); // Supplier Name, Address, Emergency/Contact details
const updates = allUpdates.filter((u: any) => !contactRelatedIds.has(u.id));

console.log(`Filtered out ${allUpdates.length - updates.length} contact-related items (already synced)\n`);

async function pushUpdates() {
  const token = await getValidAccessToken();
  const baseUrl = getApiBaseUrl();

  console.log(`Pushing ${updates.length} question updates to API...\n`);

  let success = 0;
  let failed = 0;
  const errors: { id: number; error: string }[] = [];

  for (const update of updates) {
    try {
      // PUT requires full answer object
      const response = await fetch(`${baseUrl}/api/v2/answers/${update.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question: update.newQuestion,
          answer: update.answer,
          entities: [],
          evidences: []
        })
      });

      if (response.ok) {
        success++;
        console.log(`✓ Updated ID ${update.id}`);
      } else {
        const errorText = await response.text();
        failed++;
        errors.push({ id: update.id, error: `${response.status}: ${errorText}` });
        console.log(`✗ Failed ID ${update.id}: ${response.status}`);
      }
    } catch (error) {
      failed++;
      errors.push({ id: update.id, error: String(error) });
      console.log(`✗ Error ID ${update.id}: ${error}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);

  if (errors.length > 0) {
    console.log(`\nErrors:`);
    errors.forEach(e => console.log(`  ID ${e.id}: ${e.error}`));
  }
}

pushUpdates().catch(console.error);
