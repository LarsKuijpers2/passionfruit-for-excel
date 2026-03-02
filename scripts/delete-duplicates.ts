import 'dotenv/config';
import { readFileSync } from 'fs';
import { getValidAccessToken } from '../src/config/token-manager';
import { getApiBaseUrl } from '../src/config/environments';

const idsToDelete: number[] = JSON.parse(readFileSync('customers/numidia/ids-to-delete.json', 'utf-8'));

async function deleteDuplicates() {
  const token = await getValidAccessToken();
  const baseUrl = getApiBaseUrl();

  console.log(`Deleting ${idsToDelete.length} duplicate answers...\n`);

  let success = 0;
  let failed = 0;
  const errors: { id: number; error: string }[] = [];

  for (const id of idsToDelete) {
    try {
      const response = await fetch(`${baseUrl}/api/v2/answers/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok || response.status === 204) {
        success++;
        console.log(`✓ Deleted ID ${id}`);
      } else {
        const errorText = await response.text();
        failed++;
        errors.push({ id, error: `${response.status}: ${errorText}` });
        console.log(`✗ Failed ID ${id}: ${response.status}`);
      }
    } catch (error) {
      failed++;
      errors.push({ id, error: String(error) });
      console.log(`✗ Error ID ${id}: ${error}`);
    }

    // Small delay
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Deleted: ${success}`);
  console.log(`Failed: ${failed}`);

  if (errors.length > 0) {
    console.log(`\nErrors:`);
    errors.forEach(e => console.log(`  ID ${e.id}: ${e.error}`));
  }
}

deleteDuplicates().catch(console.error);
