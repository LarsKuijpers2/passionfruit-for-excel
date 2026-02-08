/**
 * Sync Entity to Passionfruit API
 *
 * Creates or updates an entity based on the prepared preview.
 * Uses correct field mapping:
 * - Top-level: name, email, phone, website, street, city, zipCode, country
 * - data object: contacts, activities, egNumber, etc.
 */

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import { PassionfruitAPIClient } from './api-client.js';
import type { APIEntity } from '../api-types.js';

interface PreparedEntity {
  action: 'create' | 'update';
  existingId?: number;
  entity: APIEntity;
}

async function syncEntity() {
  console.log('\n🔄 Syncing entity to Passionfruit API...\n');

  // Load the prepared entity
  const content = await readFile('./api-ready/entity-preview.yaml', 'utf-8');
  const prepared: PreparedEntity = parseYaml(content);

  const client = new PassionfruitAPIClient();
  console.log(`  Environment: ${client.environment}`);
  console.log(`  API URL: ${client.url}`);

  if (prepared.action === 'update' && prepared.existingId) {
    console.log(`\n  Updating existing entity: ID ${prepared.existingId}`);

    // Build data object - ALL fields go in data (API stores everything in data object)
    // The UI displays certain keys as "Company Information" fields
    const data: Record<string, any> = {
      ...(prepared.entity.data || {}),
    };

    // Add company info fields to data object (UI shows these as "Company Information")
    if (prepared.entity.email) data.email = prepared.entity.email;
    if (prepared.entity.phone) data.phone = prepared.entity.phone;
    if (prepared.entity.website) data.website = prepared.entity.website;
    if (prepared.entity.street) data.street = prepared.entity.street;
    if (prepared.entity.city) data.city = prepared.entity.city;
    if (prepared.entity.zipCode) data.zipCode = prepared.entity.zipCode;
    if (prepared.entity.country) data.country = prepared.entity.country;

    const payload = {
      name: prepared.entity.name,
      data,
    };

    const updated = await client.updateEntity(prepared.existingId, payload);

    console.log(`\n✅ Entity updated: ID ${updated.id}`);
    console.log(`  Name: ${updated.name}`);

    // Show updated data
    console.log('\n  Updated data:');
    console.log(JSON.stringify(data, null, 2).split('\n').map(l => '    ' + l).join('\n'));

  } else {
    console.log(`\n  Creating new entity...`);

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
