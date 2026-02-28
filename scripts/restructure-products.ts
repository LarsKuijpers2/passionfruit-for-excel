#!/usr/bin/env npx ts-node
/**
 * Restructure Product Data
 *
 * Loads all product-db.json files, maps labels to canonical field names,
 * and creates a unified product overview with standardized columns.
 *
 * Data Model:
 * - Entity level: company-wide data (shared across products)
 * - Product level: product-specific data (allergens, nutrition, packaging per SKU)
 *
 * Questionnaires come from customers, answered by suppliers, may be part of groups
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// INLINE ALIAS MAP (key product fields)
// ============================================================================

const PRODUCT_ALIASES: Record<string, string[]> = {
  // Identification
  product_name: ['Product Name', 'Product', 'Product / Produit', 'Produit', 'Nom du produit', 'PRODUCT NAME'],
  product_code: ['Product Code', 'Product Reference', 'Reference', 'Reference / Référence', 'Supplier Product Code', 'Article Number', 'SKU', 'Tippagral Product Code'],
  product_type: ['Product Type', 'Type of cheese', 'Type de fromage'],
  product_range: ['Product range', 'Gamme de produits', 'Product family'],
  legal_name: ['Legal Name of Food', 'Dénomination légale', 'Legal Name of Food (English)'],
  principal_products: ['Outline principal products manufactured', 'Principal products'],
  other_products: ["Please indicate 'other products' produced", 'Other products'],
  weight_kg: ['Weight (kg)', 'Net Weight (Kg)'],

  // Allergens
  allergen_gluten_present: ['Cereals containing gluten', 'Cereals containing gluten ‒ Wheat, Rye, Barley, Spelt, Kh', 'Cereals containing gluten (Wheat, Rye, Barley, Spelt, Khorasan, Kamut, Oats etc.)'],
  allergen_crustaceans_present: ['Crustaceans (Shellfish)', 'Crustaceans'],
  allergen_eggs_present: ['Egg', 'Eggs'],
  allergen_fish_present: ['Fish'],
  allergen_peanuts_present: ['Peanuts'],
  allergen_soybeans_present: ['Soya', 'Soybeans'],
  allergen_milk_present: ['Milk'],
  allergen_molluscs_present: ['Molluscs'],
  allergen_nuts_present: ['Tree Nuts', 'Nuts'],
  allergen_celery_present: ['Celery'],
  allergen_sesame_present: ['Sesame'],
  allergen_mustard_present: ['Mustard'],
  allergen_sulphites_present: ['Sulphur dioxide and Sulphites', 'Sulphites'],
  allergen_lupin_present: ['Lupin'],
  allergens_assessed: ['4.1.1 - Are all raw materials assessed for allergens', 'Are all raw materials assessed for allergens'],
  allergen_controls_in_place: ['4.1.2 - Are suitable allergen contamination controls in place inc', '4.1.2 - Are suitable allergen contamination controls in place including for food brought on site by staff', 'Beheersing niet gedeclareerde allergenen'],
  allergens_on_site: ['4.1.3 - If any of allergen are present on site (except of milk) p', '4.1.3 - If any of allergen are present on site (except of milk) please list all ingredients of concern'],

  // Origin
  country_of_origin: ['Country of Origin', 'Origin/Identity Marker'],
  milk_origin_countries: ['Milk Origin Countries', 'Pasteurized Cow\'s Milk - Country of Origin'],
  eu27_milk_compliance: ['EU-27 Milk Source Compliance', 'EU manufacturing and milk origin compliance'],

  // Nutrition
  nutrition_energy_kj: ['Energy Value (Kj)'],
  nutrition_energy_kcal: ['Energy Value (Kcal)'],
  nutrition_fat: ['Fat (g)'],
  nutrition_saturated_fat: ['Saturated Fat Acids (g)'],
  nutrition_carbohydrates: ['Carbohydrates (g)'],
  nutrition_sugars: ['Sugars (g)'],
  nutrition_protein: ['Proteins (g)'],
  nutrition_salt: ['Salt (g)'],

  // Microbiology
  micro_ecoli_target: ['Escherichia Coli Target'],
  micro_listeria_target: ['Listeria monocytogenes Target'],
  micro_salmonella_target: ['Salmonella spp Target'],
  micro_compliance: ['Chemische en microbiologische analyses'],

  // Packaging
  pkg_primary_type: ['Primary Element 1 Type'],
  pkg_primary_composition: ['Primary Element 1 Composition'],
  pkg_primary_weight: ['Primary Element 1 Weight (kg)'],
  pkg_environmental_minimized: ['Is packaging designed to minimize environmental impact, yet not compromise product safety / integrity?'],
  pkg_food_contact_suitable: ['Is product packaging suitable for the intended use (i.e. food contact) and stored correctly?'],
  packing_on_site: ['Do you pack these products on your site?'],
  packing_site_name: ['Name of packing site'],
  healthmark: ['Healthmark of packing site'],

  // Logistics
  transport_suitable: ['Are storage and transport facilities suitable for purpose, maintained and kept in good condition?'],
  transport_cleanliness_checked: ['Are transport vehicles accessed for cleanliness/suitability before loading for dispatch'],
  transport_gfsi_certified: ['If third party hauliers are used, have they been audited and certified to the global standard for storage and Distribution or alternate GFSI recognized standard'],
  transport_secure: ['Are there procedures in place to ensure that the product is held under secure conditions during transportation?'],
  transport_breakdown_procedure: ['Is there a vehicle breakdown procedure?'],

  // Food Safety
  haccp_documented: ['Is there a documented HACCP system covering all products'],
  haccp_codex_compliant: ['Does this meet the requirements of Codex Alimentarius?'],
  haccp_reviewed: ['Is the HACCP plan regularly reviewed?'],
  haccp_team: ['Who is in your HACCP Team Please details job title'],
  haccp_training: ['What Training Have the HACCP Team undertaken? Please'],
  product_development: ['Are product development procedures in place to ensure that a safe and legal product is manufactured?'],
  labelling_compliant: ['Does product labelling comply with the appropriate legal requirements and reviewed whenever any changes occur to recipe, raw materials or suppliers, legislation, country of supplying'],

  // Compliance
  retailer_own_label: ['Do you produce Retailer own label product e.g. M&S, Sainsbury, Morrison etc. Food services'],
  products_for_customer: ['Current or proposed product supplied to Dairygold'],

  // Additional labels from Fude+Serrahn (without product code suffix)
  country_of_origin: ['Country of Origin', 'Origin/Identity Marker', 'Country'],
  milk_origin_countries: ['Milk Origin Countries', 'Pasteurized Cow\'s Milk - Country of Origin'],
  eu27_milk_compliance: ['EU-27 Milk Source Compliance', 'EU manufacturing and milk origin compliance'],

  // Shelf life / Storage
  shelf_life_days: ['Best Before Date (DDM/BBD)', 'Shelf life'],
  use_by_days: ['Use By Date (DLC/UBD)'],
  shelf_life_location: ['Shelf Life Location'],
  storage_temperature: ['Storage Temperature'],

  // Lactose
  lactose_free: ['Lactose-free'],
  lactose_level: ['Lactose level (g/100g)'],

  // Milk characteristics
  milk_processing: ['Milk processing'],
  milk_heat_treatment: ['Time-Temperature', 'Type and heating of the product (temperature and heat retention time)'],

  // Characteristics
  appearance: ['Appearance (Expected Criteria)'],
  taste: ['Taste (Expected Criteria)'],
  color: ['Color (Expected Criteria)'],
  smell: ['Smell (Expected Criteria)'],
  texture: ['Texture/Consistency (Expected Criteria)'],
  ph_value: ['pH'],
  ph_raw_milk: ['pH of Raw Milk'],
  melting_properties: ['Melting Properties'],

  // Packaging compliance
  pkg_materials_compliance: ['Packaging materials compliance'],
  contamination_prevention: ['Contamination prevention and microbiological compliance'],
  non_animal_compliance: ['Non-animal product compliance'],

  // Packaging elements (French questionnaire)
  pfas_compliance: ['PFAS (respect des 3 seuils / respect of the 3 concentration limits)'],
  mosh_level: ['MOSH'],
  moah_level: ['MOAH'],
  reusable: ['Réemployable'],

  // Contacts (entity level but sometimes in product-db)
  contact_telephone: ['Telephone'],
  contact_email: ['E-mail']
};

// Build reverse lookup map
function buildAliasMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(PRODUCT_ALIASES)) {
    map.set(canonical.toLowerCase(), canonical);
    for (const alias of aliases) {
      map.set(alias.toLowerCase(), canonical);
    }
  }
  return map;
}

const SKIP_VALUES = ['', 'n/a', 'na', '--', '-', 'not applicable', 'not available', 'ethical skip'];

function isSkipped(value: string): boolean {
  return SKIP_VALUES.includes(value.toLowerCase().trim());
}

// ============================================================================
// TYPES
// ============================================================================

interface RawItem {
  label: string;
  value: string;
  cells?: string;
  lCells?: string;
  vCells?: string;
  section?: string;
  topic?: string;
  destination?: string;
  source: string;
}

interface ProductDB {
  meta: { source: string; exportedAt: string; version: string };
  items: RawItem[];
}

interface MappedField {
  canonical: string;
  original: string;
  value: string;
  normalized: any;
  source: string;
  topic?: string;
  status: 'answered' | 'skipped' | 'unmapped';
}

// ============================================================================
// HELPERS
// ============================================================================

function findProductDBFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(d: string) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'product-db.json') files.push(full);
    }
  }
  walk(dir);
  return files;
}

function extractProductCodeFromLabel(label: string): string | null {
  const match = label.match(/\s(\d{5,7})$/);
  return match ? match[1] : null;
}

function stripProductCodeFromLabel(label: string): string {
  // Remove trailing product code from label like "Product Code 300230" -> "Product Code"
  return label.replace(/\s+\d{5,7}$/, '').trim();
}

function normalizeBoolean(value: string): boolean | null {
  const v = value.toLowerCase().trim();
  if (['yes', 'ja', 'oui', 'true', '1', 'ja-yes'].includes(v)) return true;
  if (['no', 'nee', 'non', 'false', '0', 'nein-no'].includes(v)) return false;
  return null;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const customersDir = path.join(process.cwd(), 'customers');
  const aliasMap = buildAliasMap();

  console.log('='.repeat(60));
  console.log('RESTRUCTURE PRODUCT DATA');
  console.log('='.repeat(60));
  console.log('');

  // Track data
  const unmapped = new Map<string, { count: number; sources: Set<string> }>();
  const allFields: MappedField[] = [];
  const dbFiles = findProductDBFiles(customersDir);

  console.log(`Found ${dbFiles.length} product-db.json files\n`);

  for (const file of dbFiles) {
    const rel = path.relative(customersDir, file);
    console.log(`Processing: ${rel}`);

    try {
      const db: ProductDB = JSON.parse(fs.readFileSync(file, 'utf-8'));
      let mapped = 0;

      for (const item of db.items) {
        const label = item.label.trim();
        // Try exact match first, then try stripped version (without product code suffix)
        let canonical = aliasMap.get(label.toLowerCase());
        if (!canonical) {
          const stripped = stripProductCodeFromLabel(label);
          canonical = aliasMap.get(stripped.toLowerCase());
        }

        if (canonical) {
          mapped++;
          const boolVal = normalizeBoolean(item.value);
          allFields.push({
            canonical,
            original: label,
            value: item.value,
            normalized: boolVal !== null ? boolVal : item.value,
            source: db.meta.source,
            topic: item.topic,
            status: isSkipped(item.value) ? 'skipped' : 'answered'
          });
        } else {
          const existing = unmapped.get(label) || { count: 0, sources: new Set() };
          existing.count++;
          existing.sources.add(db.meta.source);
          unmapped.set(label, existing);

          allFields.push({
            canonical: `_unmapped`,
            original: label,
            value: item.value,
            normalized: item.value,
            source: db.meta.source,
            topic: item.topic,
            status: 'unmapped'
          });
        }
      }

      console.log(`  - ${db.items.length} items, ${mapped} mapped`);
    } catch (e) {
      console.error(`  Error: ${e}`);
    }
  }

  // Build products grouped by source + optional product code
  const products: Record<string, any>[] = [];
  const sourceGroups = new Map<string, MappedField[]>();

  for (const f of allFields) {
    const key = f.source;
    if (!sourceGroups.has(key)) sourceGroups.set(key, []);
    sourceGroups.get(key)!.push(f);
  }

  for (const [source, fields] of sourceGroups) {
    // Try to detect per-product grouping (labels ending with product codes)
    const productCodes = new Set<string>();
    for (const f of fields) {
      const code = extractProductCodeFromLabel(f.original);
      if (code) productCodes.add(code);
    }

    if (productCodes.size > 0) {
      // Multiple products in this source
      for (const code of productCodes) {
        const product: Record<string, any> = { _source: source, _productCode: code };
        for (const f of fields) {
          const fCode = extractProductCodeFromLabel(f.original);
          if (fCode === code && f.canonical !== '_unmapped') {
            product[f.canonical] = f.normalized;
          }
        }
        products.push(product);
      }
      // Also add general fields (no code)
      const general: Record<string, any> = { _source: source, _productCode: '_general' };
      for (const f of fields) {
        if (!extractProductCodeFromLabel(f.original) && f.canonical !== '_unmapped') {
          general[f.canonical] = f.normalized;
        }
      }
      if (Object.keys(general).length > 2) products.push(general);
    } else {
      // Single product/entity per source
      const product: Record<string, any> = { _source: source, _productCode: null };
      for (const f of fields) {
        if (f.canonical !== '_unmapped') {
          product[f.canonical] = f.normalized;
        }
      }
      products.push(product);
    }
  }

  // Calculate coverage
  const fieldCounts = new Map<string, number>();
  for (const p of products) {
    for (const k of Object.keys(p)) {
      if (!k.startsWith('_')) {
        fieldCounts.set(k, (fieldCounts.get(k) || 0) + 1);
      }
    }
  }

  const coverage = Array.from(fieldCounts.entries())
    .map(([f, c]) => ({ field: f, count: c, pct: Math.round((c / products.length) * 100) }))
    .sort((a, b) => b.count - a.count);

  const unmappedList = Array.from(unmapped.entries())
    .map(([l, d]) => ({ label: l, count: d.count, sources: Array.from(d.sources) }))
    .sort((a, b) => b.count - a.count);

  // Output JSON
  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      sources: dbFiles.length,
      products: products.length,
      mappedFields: fieldCounts.size,
      unmappedLabels: unmappedList.length
    },
    fieldCoverage: coverage,
    unmappedLabels: unmappedList.slice(0, 50),
    products
  };

  const jsonPath = path.join(customersDir, 'unified-products.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\nWritten: ${jsonPath}`);

  // Output markdown
  const md = generateMarkdown(output);
  const mdPath = path.join(customersDir, 'unified-products.md');
  fs.writeFileSync(mdPath, md);
  console.log(`Written: ${mdPath}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Sources: ${dbFiles.length}`);
  console.log(`Products: ${products.length}`);
  console.log(`Mapped fields: ${fieldCounts.size}`);
  console.log(`Unmapped labels: ${unmappedList.length}`);

  console.log('\nTop mapped fields:');
  for (const f of coverage.slice(0, 10)) {
    console.log(`  ${f.field}: ${f.count} (${f.pct}%)`);
  }

  console.log('\nTop unmapped labels (need to add to schema):');
  for (const u of unmappedList.slice(0, 10)) {
    console.log(`  "${u.label.substring(0, 50)}": ${u.count}`);
  }
}

function generateMarkdown(data: any): string {
  const lines = [
    '# Unified Product Data Overview',
    '',
    `Generated: ${data.generatedAt}`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Sources | ${data.summary.sources} |`,
    `| Products | ${data.summary.products} |`,
    `| Mapped Fields | ${data.summary.mappedFields} |`,
    `| Unmapped Labels | ${data.summary.unmappedLabels} |`,
    '',
    '## Field Coverage',
    '',
    'Fields that are mapped across products:',
    '',
    '| Canonical Field | Count | Coverage |',
    '|-----------------|-------|----------|'
  ];

  for (const f of data.fieldCoverage.slice(0, 40)) {
    lines.push(`| \`${f.field}\` | ${f.count} | ${f.pct}% |`);
  }

  lines.push('', '## Unmapped Labels', '');
  lines.push('Labels from questionnaires that need to be added to the schema:');
  lines.push('');
  lines.push('| Label | Count |');
  lines.push('|-------|-------|');

  for (const u of data.unmappedLabels.slice(0, 30)) {
    lines.push(`| ${u.label.substring(0, 70)} | ${u.count} |`);
  }

  lines.push('', '## Products Table', '');
  lines.push('Key fields across all products:', '');

  const keyCols = ['_source', '_productCode', 'product_name', 'product_code', 'country_of_origin',
    'allergen_milk_present', 'allergen_gluten_present', 'nutrition_energy_kcal'];
  const available = keyCols.filter(c => data.products.some((p: any) => p[c] !== undefined));

  if (available.length > 0) {
    lines.push('| ' + available.map(c => c.replace(/_/g, ' ')).join(' | ') + ' |');
    lines.push('| ' + available.map(() => '---').join(' | ') + ' |');

    for (const p of data.products.slice(0, 30)) {
      const row = available.map(c => {
        const v = p[c];
        if (v === undefined || v === null) return '-';
        if (typeof v === 'boolean') return v ? 'Yes' : 'No';
        const s = String(v);
        return s.length > 25 ? s.substring(0, 22) + '...' : s;
      });
      lines.push('| ' + row.join(' | ') + ' |');
    }
  }

  return lines.join('\n');
}

main().catch(console.error);
