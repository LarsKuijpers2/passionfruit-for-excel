/**
 * Sync Entity to Passionfruit API
 *
 * Creates or updates an entity based on the prepared preview.
 */

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import { PassionfruitAPIClient } from './api-client.js';

async function syncEntity() {
  console.log('\n🔄 Syncing entity to Passionfruit API...\n');

  // Load the prepared entity
  const content = await readFile('./api-ready/entity-preview.yaml', 'utf-8');
  const prepared = parseYaml(content);

  const client = new PassionfruitAPIClient();
  console.log(`  Environment: ${client.environment}`);
  console.log(`  API URL: ${client.url}`);

  // Check again for existing entity
  const existing = await client.findEntityByName(prepared.entity.name);

  if (existing) {
    console.log(`\n  Found existing entity: ID ${existing.id}`);
    console.log(`  Updating with new data...`);

    // Merge data
    const mergedData = { ...existing.data, ...prepared.entity.data };

    // Merge contacts (don't duplicate)
    if (prepared.entity.data.contacts && existing.data?.contacts) {
      const existingNames = new Set(existing.data.contacts.map((c: any) => c.name));
      const newContacts = prepared.entity.data.contacts.filter((c: any) => !existingNames.has(c.name));
      mergedData.contacts = [...existing.data.contacts, ...newContacts];
    }

    // Merge activities (don't duplicate)
    if (prepared.entity.data.activities && existing.data?.activities) {
      const existingActivities = new Set(existing.data.activities);
      const newActivities = prepared.entity.data.activities.filter((a: string) => !existingActivities.has(a));
      mergedData.activities = [...existing.data.activities, ...newActivities];
    }

    const updated = await client.updateEntity(existing.id, {
      name: prepared.entity.name,
      data: mergedData,
    });

    console.log(`\n✅ Entity updated: ID ${updated.id}`);
    console.log(`  Name: ${updated.name}`);

  } else {
    console.log(`\n  No existing entity found`);
    console.log(`  Creating new entity...`);

    const created = await client.createEntity(prepared.entity);

    console.log(`\n✅ Entity created: ID ${created.id}`);
    console.log(`  Name: ${created.name}`);
  }

  console.log();
}

syncEntity().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
