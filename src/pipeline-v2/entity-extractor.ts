/**
 * Entity Extractor
 *
 * Extracts entity data (company info, contacts, certifications) from indexed questionnaires.
 * Each questionnaire contributes partial data that can be merged over time.
 */

import { randomUUID } from 'crypto';
import type { IndexedQuestionnaire, IndexedItem, IndexedSection } from './questionnaire-indexer.js';
import type {
  ExtractedEntityData,
  QuestionnaireEntityExtraction,
  FieldSource,
  APIEntity,
} from './api-types.js';

// =============================================================================
// FIELD MAPPING PATTERNS
// =============================================================================

interface FieldPattern {
  field: string;
  patterns: RegExp[];
  /** For nested fields like contacts[].name */
  nested?: {
    parent: 'contacts' | 'certifications';
    subfield: string;
  };
  /** Topics where this field is typically found */
  topics?: string[];
}

const FIELD_PATTERNS: FieldPattern[] = [
  // Company name
  {
    field: 'name',
    patterns: [
      /^bedrijfsnaam$/i,
      /^company\s*name$/i,
      /^firmenname$/i,
      /^nom\s*(de\s*l['''])?entreprise$/i,
      /^raison\s*sociale$/i,
      /^supplier\s*name$/i,
      /^naam\s*(van\s*het)?\s*bedrijf$/i,
    ],
    topics: ['company'],
  },
  // Address
  {
    field: 'address',
    patterns: [
      /^adres$/i,
      /^address$/i,
      /^adresse$/i,
      /^anschrift$/i,
      /^straat/i,
      /^street/i,
    ],
    topics: ['company'],
  },
  // Location (postcode + city)
  {
    field: 'location',
    patterns: [
      /postcode.*plaats/i,
      /postcode.*city/i,
      /plz.*ort/i,
      /code\s*postal/i,
      /zip.*city/i,
      /^plaats$/i,
      /^city$/i,
      /^ort$/i,
      /^ville$/i,
    ],
    topics: ['company'],
  },
  // Country
  {
    field: 'country',
    patterns: [
      /^land$/i,
      /^country$/i,
      /^pays$/i,
      /^land\s*\/\s*country$/i,
    ],
    topics: ['company'],
  },
  // Email
  {
    field: 'email',
    patterns: [
      /e-?mail/i,
      /^email$/i,
      /^mail$/i,
      /e-?mail.*adres/i,
    ],
    topics: ['company', 'contacts'],
  },
  // Phone
  {
    field: 'phone',
    patterns: [
      /telefoon/i,
      /phone/i,
      /telefon/i,
      /téléphone/i,
      /tel\.?\s*$/i,
      /gsm/i,
      /mobiel/i,
      /mobile/i,
    ],
    topics: ['company', 'contacts'],
  },
  // Fax
  {
    field: 'fax',
    patterns: [
      /^fax$/i,
      /faxnummer/i,
      /fax\s*number/i,
    ],
    topics: ['company'],
  },
  // Website
  {
    field: 'website',
    patterns: [
      /website/i,
      /^url$/i,
      /^www$/i,
      /homepage/i,
      /webseite/i,
      /site\s*web/i,
    ],
    topics: ['company'],
  },
  // Contact person name
  {
    field: 'contacts[].name',
    patterns: [
      /contactpersoon/i,
      /contact\s*person/i,
      /ansprechpartner/i,
      /personne\s*de\s*contact/i,
      /^naam$/i,  // In signature context
      /^name$/i,
    ],
    nested: { parent: 'contacts', subfield: 'name' },
    topics: ['company', 'contacts', 'signature'],
  },
  // Contact role/function
  {
    field: 'contacts[].role',
    patterns: [
      /^functie$/i,
      /^function$/i,
      /^rolle$/i,
      /^fonction$/i,
      /^title$/i,
      /^titel$/i,
      /^position$/i,
    ],
    nested: { parent: 'contacts', subfield: 'role' },
    topics: ['company', 'contacts', 'signature'],
  },
  // Certification type
  {
    field: 'certifications[].type',
    patterns: [
      /fssc\s*22000/i,
      /^ifs$/i,
      /ifs\s*food/i,
      /^brc$/i,
      /brcgs/i,
      /iso\s*\d+/i,
      /haccp/i,
      /certificering/i,
      /certification/i,
      /zertifizierung/i,
    ],
    nested: { parent: 'certifications', subfield: 'type' },
    topics: ['certifications', 'quality'],
  },
  // Certification number
  {
    field: 'certifications[].number',
    patterns: [
      /certificaat\s*nummer/i,
      /certificate\s*number/i,
      /zertifikat\s*nummer/i,
      /numéro\s*de\s*certificat/i,
      /cert\.?\s*no\.?/i,
      /kenmerk/i,
    ],
    nested: { parent: 'certifications', subfield: 'number' },
    topics: ['certifications'],
  },
  // Certification valid until
  {
    field: 'certifications[].validUntil',
    patterns: [
      /geldig\s*tot/i,
      /valid\s*until/i,
      /gültig\s*bis/i,
      /valable\s*jusqu/i,
      /expiry/i,
      /vervaldatum/i,
    ],
    nested: { parent: 'certifications', subfield: 'validUntil' },
    topics: ['certifications'],
  },
  // Business activities
  {
    field: 'activities',
    patterns: [
      /bedrijfsactiviteiten/i,
      /business\s*activities/i,
      /geschäftstätigkeit/i,
      /activités/i,
      /^activiteiten$/i,
    ],
    topics: ['company'],
  },
  // Employees
  {
    field: 'employees',
    patterns: [
      /aantal\s*medewerkers/i,
      /number\s*of\s*employees/i,
      /anzahl\s*mitarbeiter/i,
      /nombre\s*d[''']employés/i,
      /fte/i,
    ],
    topics: ['company'],
  },
  // Turnover
  {
    field: 'turnover',
    patterns: [
      /omzet/i,
      /turnover/i,
      /umsatz/i,
      /chiffre\s*d[''']affaires/i,
      /revenue/i,
    ],
    topics: ['company', 'financial'],
  },
  // EG number (EU approval number)
  {
    field: 'egNumber',
    patterns: [
      /eg-?nummer/i,
      /eu\s*approval/i,
      /eg\s*nummer/i,
      /numéro\s*ce/i,
    ],
    topics: ['company'],
  },
  // KvK number (Chamber of Commerce)
  {
    field: 'kvkNumber',
    patterns: [
      /kvk/i,
      /kamer\s*van\s*koophandel/i,
      /chamber\s*of\s*commerce/i,
      /handelsregister/i,
    ],
    topics: ['company', 'financial'],
  },
  // VAT number
  {
    field: 'vatNumber',
    patterns: [
      /btw/i,
      /vat/i,
      /mwst/i,
      /tva/i,
      /ust/i,
    ],
    topics: ['company', 'financial'],
  },
];

// =============================================================================
// ENTITY EXTRACTOR
// =============================================================================

export class EntityExtractor {
  /**
   * Extract entity data from an indexed questionnaire
   */
  extract(indexed: IndexedQuestionnaire): QuestionnaireEntityExtraction {
    const data: ExtractedEntityData = {};
    const sources: FieldSource[] = [];

    // Process all sections
    for (const section of indexed.sections) {
      for (const item of section.items) {
        // Only process standard level items (entity-level data)
        if (item.level !== 'standard' || !item.value) {
          continue;
        }

        // Try to match the item's label to a field pattern
        const match = this.matchField(item.label, section.topic);
        if (!match) {
          continue;
        }

        // Extract the value
        const value = item.value.trim();
        if (!value) continue;

        // Record the source
        const source: FieldSource = {
          field: match.field,
          cell: item.lCell || item.ref || '',
          value,
          label: item.label,
        };
        sources.push(source);

        // Set the field value
        if (match.nested) {
          // Handle nested fields like contacts[].name
          this.setNestedField(data, match.nested.parent, match.nested.subfield, value);
        } else if (match.field === 'activities') {
          // Activities is an array
          if (!data.activities) data.activities = [];
          // Split by common separators
          const activities = value.split(/[,;]/).map(a => a.trim()).filter(Boolean);
          data.activities.push(...activities);
        } else {
          // Simple field
          (data as any)[match.field] = value;
        }
      }
    }

    return {
      id: randomUUID().split('-')[0],
      source: indexed.source,
      extractedAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
      data,
      sources,
    };
  }

  /**
   * Match a label to a field pattern
   */
  private matchField(label: string, topic: string): FieldPattern | null {
    const normalized = label.toLowerCase().trim();

    for (const pattern of FIELD_PATTERNS) {
      // Check if topic matches (if specified)
      if (pattern.topics && !pattern.topics.includes(topic)) {
        continue;
      }

      // Check if any regex pattern matches
      for (const regex of pattern.patterns) {
        if (regex.test(normalized)) {
          return pattern;
        }
      }
    }

    return null;
  }

  /**
   * Set a nested field value (e.g., contacts[0].name)
   */
  private setNestedField(
    data: ExtractedEntityData,
    parent: 'contacts' | 'certifications',
    subfield: string,
    value: string
  ): void {
    if (!data[parent]) {
      data[parent] = [];
    }

    const arr = data[parent] as any[];

    // Try to find an existing incomplete entry to fill
    let entry = arr.find(e => !e[subfield]);
    if (!entry) {
      // Create new entry
      entry = {};
      arr.push(entry);
    }

    entry[subfield] = value;
  }

  /**
   * Merge multiple extractions into one entity data object
   * Newer values override older ones, arrays are merged
   */
  merge(extractions: QuestionnaireEntityExtraction[]): ExtractedEntityData {
    const merged: ExtractedEntityData = {};

    // Sort by date (oldest first, so newer values win)
    const sorted = [...extractions].sort((a, b) =>
      a.extractedAt.localeCompare(b.extractedAt)
    );

    for (const extraction of sorted) {
      for (const [key, value] of Object.entries(extraction.data)) {
        if (value === undefined || value === null) continue;

        if (Array.isArray(value)) {
          // Merge arrays
          if (!merged[key]) merged[key] = [];
          const existing = merged[key] as any[];

          for (const item of value) {
            // For contacts/certifications, check for duplicates
            if (typeof item === 'object' && item !== null) {
              const isDuplicate = existing.some(e =>
                JSON.stringify(e) === JSON.stringify(item)
              );
              if (!isDuplicate) {
                existing.push(item);
              }
            } else if (!existing.includes(item)) {
              existing.push(item);
            }
          }
        } else {
          // Simple value - newer wins
          merged[key] = value;
        }
      }
    }

    return merged;
  }

  /**
   * Convert extracted entity data to API entity format
   */
  toAPIEntity(data: ExtractedEntityData): APIEntity {
    return {
      name: data.name || 'Unknown Entity',
      data,
    };
  }
}
