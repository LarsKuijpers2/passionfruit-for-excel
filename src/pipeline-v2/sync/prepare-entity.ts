/**
 * Prepare Entity for Sync
 *
 * Extracts entity data from answer library and prepares for API sync.
 * Maps fields to correct Passionfruit API structure:
 * - Top-level: name, email, phone, website, street, city, zipCode, country
 * - data object: contacts, certifications, activities, egNumber, etc.
 */

import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { PassionfruitAPIClient } from './api-client.js';
import type { APIEntity, EntityAdditionalData } from '../api-types.js';
import type { AnswerLibrary } from '../answer-harvester.js';

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

interface RawExtraction {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  street?: string;
  location?: string; // Raw "7905 SW Hoogeveen, Nederland"
  contacts: Array<{ name?: string; role?: string }>;
  activities: string[];
  egNumber?: string;
}

async function loadAnswerLibrary(path: string = './answer-library.yaml'): Promise<AnswerLibrary> {
  const content = await readFile(path, 'utf-8');
  return parseYaml(content);
}

/**
 * Parse Dutch location format: "7905 SW Hoogeveen, Nederland"
 * Returns: { zipCode: "7905 SW", city: "Hoogeveen", country: "Nederland" }
 */
function parseLocation(location: string): { zipCode?: string; city?: string; country?: string } {
  if (!location) return {};

  // Try to match Dutch format: "1234 AB City, Country"
  const dutchMatch = location.match(/^(\d{4}\s*[A-Z]{2})\s+([^,]+),?\s*(.*)$/i);
  if (dutchMatch) {
    return {
      zipCode: dutchMatch[1].trim(),
      city: dutchMatch[2].trim(),
      country: dutchMatch[3]?.trim() || undefined,
    };
  }

  // Try to match "City, Country" format
  const simpleParts = location.split(',').map(p => p.trim());
  if (simpleParts.length >= 2) {
    return {
      city: simpleParts[0],
      country: simpleParts[simpleParts.length - 1],
    };
  }

  // Just return as city
  return { city: location };
}

function extractEntityFromLibrary(library: AnswerLibrary): { raw: RawExtraction; sources: PreparedEntity['sources'] } {
  const raw: RawExtraction = {
    contacts: [],
    activities: [],
  };
  const sources: PreparedEntity['sources'] = [];

  // Field mapping from Dutch/multilingual labels
  const fieldMappings: Array<{ patterns: RegExp[]; field: keyof RawExtraction | string; nested?: { parent: 'contacts'; subfield: string } }> = [
    { patterns: [/bedrijfsnaam/i, /company\s*name/i, /firmenname/i], field: 'name' },
    { patterns: [/^adres$/i, /address/i, /straat/i, /street/i], field: 'street' },
    { patterns: [/postcode.*plaats/i, /zip.*city/i, /plz.*ort/i], field: 'location' },
    { patterns: [/e-?mail/i], field: 'email' },
    { patterns: [/telefoon/i, /phone/i, /tel\b/i], field: 'phone' },
    { patterns: [/website/i, /www/i, /homepage/i], field: 'website' },
    { patterns: [/contactpersoon/i, /contact.*person/i, /ansprechpartner/i], field: 'contacts', nested: { parent: 'contacts', subfield: 'name' } },
    { patterns: [/^functie$/i, /function/i, /role/i, /position/i], field: 'contacts', nested: { parent: 'contacts', subfield: 'role' } },
    { patterns: [/bedrijfsactiviteiten/i, /activities/i, /geschäftstätigkeit/i], field: 'activities' },
    { patterns: [/eg-?nummer/i, /eu.*approval/i], field: 'egNumber' },
  ];

  // Process company and signature topic items
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
        // Handle nested contacts
        let contact = raw.contacts.find(c => !c[mapping.nested!.subfield as keyof typeof c]);
        if (!contact) {
          contact = {};
          raw.contacts.push(contact);
        }
        (contact as any)[mapping.nested.subfield] = item.value;
      } else if (mapping.field === 'activities') {
        raw.activities.push(item.value);
      } else {
        (raw as any)[mapping.field] = item.value;
      }

      break;
    }
  }

  return { raw, sources };
}

function mapToAPIEntity(raw: RawExtraction): APIEntity {
  // Parse location into city/zipCode/country
  const parsedLocation = parseLocation(raw.location || '');

  // Build top-level fields
  const entity: APIEntity = {
    name: raw.name || 'Unknown Entity',
    email: raw.email,
    phone: raw.phone,
    website: raw.website,
    street: raw.street,
    city: parsedLocation.city,
    zipCode: parsedLocation.zipCode,
    country: parsedLocation.country,
  };

  // Build data object for additional fields
  const data: EntityAdditionalData = {};

  if (raw.contacts.length > 0) {
    data.contacts = raw.contacts.filter(c => c.name) as any;
  }

  if (raw.activities.length > 0) {
    data.activities = raw.activities;
  }

  if (raw.egNumber) {
    data.egNumber = raw.egNumber;
  }

  // Only add data if there's something in it
  if (Object.keys(data).length > 0) {
    entity.data = data;
  }

  return entity;
}

async function prepareEntity(): Promise<PreparedEntity> {
  console.log('\n📦 Preparing entity for sync...\n');

  // Load answer library
  const library = await loadAnswerLibrary();
  console.log(`  Loaded ${library.total} items from answer library`);

  // Extract entity data
  const { raw, sources } = extractEntityFromLibrary(library);
  console.log(`  Extracted ${sources.length} entity fields`);

  // Map to API structure
  const entity = mapToAPIEntity(raw);

  // Check API for existing entity
  const client = new PassionfruitAPIClient();
  console.log(`  Checking ${client.environment} API for existing entity...`);

  const existingEntity = entity.name ? await client.findEntityByName(entity.name) : null;

  const prepared: PreparedEntity = {
    action: existingEntity ? 'update' : 'create',
    existingId: existingEntity?.id,
    entity,
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

    console.log('\n  === TOP-LEVEL FIELDS (Company Information) ===');
    console.log('  ─────────────────────────────────────────');
    console.log(`  Name:     ${prepared.entity.name}`);
    console.log(`  Email:    ${prepared.entity.email || '-'}`);
    console.log(`  Phone:    ${prepared.entity.phone || '-'}`);
    console.log(`  Website:  ${prepared.entity.website || '-'}`);
    console.log(`  Street:   ${prepared.entity.street || '-'}`);
    console.log(`  City:     ${prepared.entity.city || '-'}`);
    console.log(`  ZIP Code: ${prepared.entity.zipCode || '-'}`);
    console.log(`  Country:  ${prepared.entity.country || '-'}`);

    if (prepared.entity.data) {
      console.log('\n  === DATA OBJECT (Additional Fields) ===');
      console.log('  ─────────────────────────────────────────');

      const data = prepared.entity.data;

      if (data.contacts && data.contacts.length > 0) {
        console.log('  contacts:');
        for (const contact of data.contacts) {
          console.log(`    - ${contact.name}${contact.role ? ` (${contact.role})` : ''}`);
        }
      }

      if (data.activities && data.activities.length > 0) {
        console.log('  activities:');
        for (const activity of data.activities) {
          console.log(`    - ${activity}`);
        }
      }

      if (data.egNumber) {
        console.log(`  egNumber: ${data.egNumber}`);
      }
    }

    console.log('\n  === SOURCES ===');
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
