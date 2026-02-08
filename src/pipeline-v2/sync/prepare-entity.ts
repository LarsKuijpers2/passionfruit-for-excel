/**
 * Prepare Entity for Sync
 *
 * Extracts entity data from answer library and prepares for API sync.
 * Shows preview for review before actually syncing.
 */

import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { PassionfruitAPIClient } from './api-client.js';
import { EntityExtractor } from '../entity-extractor.js';
import type { ExtractedEntityData, APIEntity } from '../api-types.js';
import type { AnswerLibrary, HarvestedItem } from '../answer-harvester.js';

interface PreparedEntity {
  action: 'create' | 'update';
  existingId?: number;
  entity: APIEntity;
  sources: Array<{
    field: string;
    label: string;
    value: string;
    cell: string;
    file: string;
  }>;
}

async function loadAnswerLibrary(path: string = './answer-library.yaml'): Promise<AnswerLibrary> {
  const content = await readFile(path, 'utf-8');
  return parseYaml(content);
}

function extractEntityFromLibrary(library: AnswerLibrary): { data: ExtractedEntityData; sources: PreparedEntity['sources'] } {
  const data: ExtractedEntityData = {};
  const sources: PreparedEntity['sources'] = [];

  // Field mapping from Dutch/multilingual labels to entity fields
  const fieldMappings: Array<{ patterns: RegExp[]; field: string; nested?: { parent: string; subfield: string } }> = [
    { patterns: [/bedrijfsnaam/i, /company\s*name/i], field: 'name' },
    { patterns: [/^adres$/i, /address/i], field: 'address' },
    { patterns: [/postcode.*plaats/i, /zip.*city/i], field: 'location' },
    { patterns: [/e-?mail/i], field: 'email' },
    { patterns: [/telefoon/i, /phone/i], field: 'phone' },
    { patterns: [/contactpersoon/i, /contact.*person/i], field: 'contacts', nested: { parent: 'contacts', subfield: 'name' } },
    { patterns: [/^functie$/i, /function/i, /role/i], field: 'contacts', nested: { parent: 'contacts', subfield: 'role' } },
    { patterns: [/bedrijfsactiviteiten/i, /activities/i], field: 'activities' },
    { patterns: [/eg-?nummer/i, /eu.*approval/i], field: 'egNumber' },
  ];

  // Process company topic items
  const companyItems = library.byTopic['company'] || [];
  const signatureItems = library.byTopic['signature'] || [];
  const allItems = [...companyItems, ...signatureItems];

  for (const item of allItems) {
    if (!item.value || item.level === 'product') continue;

    // Find matching field
    for (const mapping of fieldMappings) {
      const matches = mapping.patterns.some(p => p.test(item.label));
      if (!matches) continue;

      // Record source
      sources.push({
        field: mapping.nested ? `${mapping.nested.parent}[].${mapping.nested.subfield}` : mapping.field,
        label: item.label,
        value: item.value,
        cell: item.source.lCell,
        file: item.source.file,
      });

      // Set value
      if (mapping.nested) {
        const parent = mapping.nested.parent as 'contacts' | 'certifications';
        if (!data[parent]) data[parent] = [];
        const arr = data[parent] as any[];

        // Find or create entry
        let entry = arr.find(e => !e[mapping.nested!.subfield]);
        if (!entry) {
          entry = {};
          arr.push(entry);
        }
        entry[mapping.nested.subfield] = item.value;
      } else if (mapping.field === 'activities') {
        if (!data.activities) data.activities = [];
        data.activities.push(item.value);
      } else {
        (data as any)[mapping.field] = item.value;
      }

      break;
    }
  }

  return { data, sources };
}

async function prepareEntity(): Promise<PreparedEntity> {
  console.log('\n📦 Preparing entity for sync...\n');

  // Load answer library
  const library = await loadAnswerLibrary();
  console.log(`  Loaded ${library.total} items from answer library`);

  // Extract entity data
  const { data, sources } = extractEntityFromLibrary(library);
  console.log(`  Extracted ${sources.length} entity fields`);

  // Check API for existing entity
  const client = new PassionfruitAPIClient();
  console.log(`  Checking ${client.environment} API for existing entity...`);

  const existingEntity = data.name ? await client.findEntityByName(data.name) : null;

  const prepared: PreparedEntity = {
    action: existingEntity ? 'update' : 'create',
    existingId: existingEntity?.id,
    entity: {
      name: data.name || 'Unknown Entity',
      data,
    },
    sources,
  };

  return prepared;
}

async function main() {
  try {
    const prepared = await prepareEntity();

    console.log('\n' + '═'.repeat(60));
    console.log('  ENTITY PREVIEW FOR REVIEW');
    console.log('═'.repeat(60));

    console.log(`\n  Action: ${prepared.action.toUpperCase()}`);
    if (prepared.existingId) {
      console.log(`  Existing ID: ${prepared.existingId}`);
    }

    console.log('\n  Entity Data:');
    console.log('  ─────────────────────────────────────────');

    const { data } = prepared.entity;
    console.log(`  Name:       ${data.name || '-'}`);
    console.log(`  Address:    ${data.address || '-'}`);
    console.log(`  Location:   ${data.location || '-'}`);
    console.log(`  Email:      ${data.email || '-'}`);
    console.log(`  Phone:      ${data.phone || '-'}`);
    console.log(`  EG Number:  ${data.egNumber || '-'}`);

    if (data.contacts && data.contacts.length > 0) {
      console.log('\n  Contacts:');
      for (const contact of data.contacts) {
        console.log(`    - ${contact.name}${contact.role ? ` (${contact.role})` : ''}`);
      }
    }

    if (data.activities && data.activities.length > 0) {
      console.log('\n  Activities:');
      for (const activity of data.activities) {
        console.log(`    - ${activity}`);
      }
    }

    console.log('\n  Sources:');
    console.log('  ─────────────────────────────────────────');
    for (const source of prepared.sources) {
      console.log(`  ${source.field}: "${source.value.substring(0, 40)}${source.value.length > 40 ? '...' : ''}"`);
      console.log(`    ← ${source.label} [${source.cell}]`);
    }

    // Save for review
    await mkdir('./api-ready', { recursive: true });
    await writeFile('./api-ready/entity-preview.yaml', stringifyYaml(prepared, { lineWidth: 0 }), 'utf-8');

    console.log('\n' + '═'.repeat(60));
    console.log('  Saved to: ./api-ready/entity-preview.yaml');
    console.log('  Review and run: npx tsx src/pipeline-v2/sync/sync-entity.ts');
    console.log('═'.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
