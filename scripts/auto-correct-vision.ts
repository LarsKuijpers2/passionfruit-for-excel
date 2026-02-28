/**
 * Auto-correct Yes/No discrepancies using Vision validation results
 *
 * This script reads the indexed questionnaire, finds Yes/No discrepancies
 * where vision disagrees with the base extraction, and corrects them
 * using the vision values.
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

interface VisionDiscrepancy {
  itemId: string;
  label: string;
  baseValue: string | null;
  visionValue: string;
  matchScore: number;
  visionQuestion: string;
  type: string;
}

interface IndexedItem {
  id: string;
  type: string;
  label: string;
  value?: string;
  [key: string]: any;
}

interface IndexedSection {
  title: string;
  items: IndexedItem[];
  [key: string]: any;
}

interface IndexedQuestionnaire {
  sections: IndexedSection[];
  visionValidation?: {
    discrepancies: VisionDiscrepancy[];
    [key: string]: any;
  };
  [key: string]: any;
}

async function autoCorrectVisionDiscrepancies(indexedPath: string) {
  console.log(`\nReading indexed file: ${indexedPath}\n`);

  const data: IndexedQuestionnaire = JSON.parse(await readFile(indexedPath, 'utf-8'));

  const discrepancies = data.visionValidation?.discrepancies || [];

  // Filter to Yes/No discrepancies only
  const yesNoDiscrepancies = discrepancies.filter(d => {
    const baseVal = d.baseValue?.toLowerCase();
    const visionVal = d.visionValue?.toLowerCase();
    return (baseVal === 'yes' || baseVal === 'no') ||
           (visionVal === 'yes' || visionVal === 'no');
  });

  console.log(`Found ${yesNoDiscrepancies.length} Yes/No discrepancies to correct\n`);

  // Build a map of item IDs to discrepancies
  const discrepancyMap = new Map<string, VisionDiscrepancy>();
  for (const d of yesNoDiscrepancies) {
    discrepancyMap.set(d.itemId, d);
  }

  // Track corrections
  let corrected = 0;
  const corrections: Array<{ label: string; oldValue: string; newValue: string }> = [];

  // Update items in sections
  for (const section of data.sections) {
    for (const item of section.items) {
      const discrepancy = discrepancyMap.get(item.id);
      if (discrepancy) {
        const oldValue = item.value || 'N/A';
        const newValue = discrepancy.visionValue;

        // Only correct if values are different
        if (oldValue.toLowerCase() !== newValue.toLowerCase()) {
          item.value = newValue;
          item.visionCorrected = true;
          item.originalValue = oldValue;
          corrected++;
          corrections.push({ label: item.label, oldValue, newValue });
        }
      }
    }
  }

  // Update vision validation to mark discrepancies as reviewed
  if (data.visionValidation) {
    data.visionValidation.autoCorrectionsApplied = corrected;
    data.visionValidation.autoCorrectionsTimestamp = new Date().toISOString();
  }

  // Save the updated file
  await writeFile(indexedPath, JSON.stringify(data, null, 2));

  console.log(`Corrections applied: ${corrected}\n`);
  console.log('Details:');
  for (const c of corrections) {
    console.log(`  - ${c.label.substring(0, 50)}: ${c.oldValue} → ${c.newValue}`);
  }
  console.log(`\nSaved to: ${indexedPath}`);
}

// Main
const customer = process.argv[2] || 'Doehler Oosterhout';
const questionnaire = process.argv[3] || 'FESQC322__C__-_Supplier_Data_Questionnaire_-_EN__DH_.json';

const indexedPath = join('./customers', customer, 'indexed', questionnaire);

autoCorrectVisionDiscrepancies(indexedPath).catch(console.error);
