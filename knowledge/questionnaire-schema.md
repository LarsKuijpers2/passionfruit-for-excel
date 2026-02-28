# Questionnaire Field Schema

This document standardizes the fields extracted from supplier questionnaires across all customers. It maps the many variations in question labels to canonical field names for consistent data handling.

## Overview

| Schema | Fields | Categories | Purpose |
|--------|--------|------------|---------|
| Product Schema | 150+ | 11 | Product-specific data (allergens, nutrition, packaging) |
| Entity Schema | 90+ | 13 | Company-wide data (contacts, certifications, quality systems) |

---

## Product Schema

Product-level fields are specific to individual products/SKUs and vary per product.

### Categories

| Category | Fields | Description |
|----------|--------|-------------|
| `identification` | 9 | Product name, code, legal name, type |
| `allergens` | 32 | EU 14 allergens (presence + cross-contamination) |
| `origin` | 4 | Country of origin, milk origin, EU compliance |
| `ingredients` | 15 | Ingredient list, percentages, GMO status |
| `nutrition` | 11 | Energy, fat, protein, carbs, salt per 100g |
| `microbiology` | 22 | E.coli, Listeria, Salmonella, etc. (target/tolerance/method) |
| `packaging` | 35 | Primary/secondary/tertiary packaging details |
| `logistics` | 25 | Dimensions, shelf life, storage, pallet specs |
| `characteristics` | 10 | Appearance, taste, pH, melting properties |
| `food_safety` | 7 | HACCP, labelling compliance |
| `compliance` | 3 | Retailer own label, packing site |

### Product Identification

| Canonical | Type | Description | Aliases |
|-----------|------|-------------|---------|
| `product_name` | string | Commercial product name | Product Name, Product, Produit |
| `product_code` | string | Supplier product code/SKU | Product Code, Reference, SKU, Article Number |
| `customer_product_code` | string | Customer-specific code | Tippagral Product Code, Customer Reference |
| `legal_name` | string | Legal name for labeling | Legal Name of Food, Dénomination légale |
| `product_type` | string | Product category | Product Type, Type of cheese |

### Allergens (EU 14)

Each allergen has two fields: presence and cross-contamination risk.

| Allergen | Presence Field | Cross-Contamination Field |
|----------|---------------|---------------------------|
| Gluten | `allergen_gluten_present` | `allergen_gluten_cross_contamination` |
| Crustaceans | `allergen_crustaceans_present` | `allergen_crustaceans_cross_contamination` |
| Eggs | `allergen_eggs_present` | `allergen_eggs_cross_contamination` |
| Fish | `allergen_fish_present` | `allergen_fish_cross_contamination` |
| Peanuts | `allergen_peanuts_present` | `allergen_peanuts_cross_contamination` |
| Soybeans | `allergen_soybeans_present` | `allergen_soybeans_cross_contamination` |
| Milk | `allergen_milk_present` | `allergen_milk_cross_contamination` |
| Nuts | `allergen_nuts_present` | `allergen_nuts_cross_contamination` |
| Celery | `allergen_celery_present` | `allergen_celery_cross_contamination` |
| Mustard | `allergen_mustard_present` | `allergen_mustard_cross_contamination` |
| Sesame | `allergen_sesame_present` | `allergen_sesame_cross_contamination` |
| Sulphites | `allergen_sulphites_present` | `allergen_sulphites_cross_contamination` |
| Lupin | `allergen_lupin_present` | `allergen_lupin_cross_contamination` |
| Molluscs | `allergen_molluscs_present` | `allergen_molluscs_cross_contamination` |

**Values:** `yes`, `no`, `presence`, `absence`, `traces`

**Additional milk fields:**
- `allergen_milk_source` - Source (cow, goat, sheep)
- `lactose_free` - Boolean
- `lactose_level` - g/100g

**Label Variations Found:**
- "Cereals containing gluten" / "Cereals containing gluten (Wheat, Rye...)" / "Céréales contenant du gluten"
- "Soya" / "Soybeans" / "Soja"
- "Tree Nuts" / "Nuts" / "Fruits à coque"
- "Sulphur dioxide and Sulphites" / "Sulphites" / "Anhydride sulfureux et sulfites"

### Nutrition (per 100g)

| Canonical | Unit | Aliases |
|-----------|------|---------|
| `nutrition_energy_kj` | kJ | Energy Value (Kj), Valeur énergétique (kJ) |
| `nutrition_energy_kcal` | kcal | Energy Value (Kcal), Valeur énergétique (kcal) |
| `nutrition_fat` | g | Fat (g), Matières grasses |
| `nutrition_saturated_fat` | g | Saturated Fat Acids (g), Acides gras saturés |
| `nutrition_carbohydrates` | g | Carbohydrates (g), Glucides |
| `nutrition_sugars` | g | Sugars (g), Sucres |
| `nutrition_protein` | g | Proteins (g), Protéines |
| `nutrition_salt` | g | Salt (g), Sel |

### Microbiology

Pattern: Each parameter has target, tolerance, and method fields.

| Parameter | Target | Tolerance | Method |
|-----------|--------|-----------|--------|
| E. coli | `micro_ecoli_target` | `micro_ecoli_tolerance` | `micro_ecoli_method` |
| Staphylococci | `micro_staph_target` | `micro_staph_tolerance` | `micro_staph_method` |
| Listeria | `micro_listeria_target` | `micro_listeria_tolerance` | `micro_listeria_method` |
| Salmonella | `micro_salmonella_target` | `micro_salmonella_tolerance` | `micro_salmonella_method` |
| Coliforms | `micro_coliforms_target` | `micro_coliforms_tolerance` | `micro_coliforms_method` |
| Moulds | `micro_moulds_target` | `micro_moulds_tolerance` | `micro_moulds_method` |
| Yeasts | `micro_yeasts_target` | `micro_yeasts_tolerance` | `micro_yeasts_method` |

### Packaging (3-Tier Structure)

**Primary (product contact):**
| Canonical | Unit | Description |
|-----------|------|-------------|
| `pkg_primary_type` | - | Type (tray, pouch) |
| `pkg_primary_composition` | - | Material (APET/PE, EVOH) |
| `pkg_primary_weight` | g | Weight |
| `pkg_primary_thickness` | µm | Thickness |
| `pkg_primary_recycled_pct` | % | Recycled material percentage |
| `pkg_primary_recyclable` | bool | Is recyclable |

**Secondary (box/carton):**
| Canonical | Unit | Description |
|-----------|------|-------------|
| `pkg_secondary_type` | - | Type (cardboard) |
| `pkg_secondary_composition` | - | Material |
| `pkg_secondary_weight` | kg | Weight |
| `pkg_secondary_recycled_pct` | % | Recycled percentage |
| `pkg_secondary_recyclable` | bool | Recyclable in France |

**Tertiary (pallet):**
| Canonical | Unit | Description |
|-----------|------|-------------|
| `pkg_tertiary_type` | - | Type (pallet, stretchfoil) |
| `pkg_tertiary_composition` | - | Material (wood, PE) |
| `pkg_tertiary_weight` | kg | Weight |
| `pkg_tertiary_reusable` | bool | Is reusable |

**Compliance:**
| Canonical | Description |
|-----------|-------------|
| `pkg_pfas_compliant` | PFAS compliance with PPWR |
| `pkg_mosh_level` | MOSH contamination level |
| `pkg_moah_level` | MOAH contamination level |

### Logistics

**Dimensions:**
| Canonical | Unit | Description |
|-----------|------|-------------|
| `product_net_weight_kg` | kg | Net weight |
| `product_gross_weight_kg` | kg | Gross weight |
| `products_per_box` | - | Units per box |
| `layers_per_pallet` | - | Layers per pallet |
| `products_per_pallet` | - | Total products per pallet |

**Shelf Life:**
| Canonical | Unit | Description |
|-----------|------|-------------|
| `shelf_life_days` | days | Best before date (BBD) |
| `use_by_days` | days | Use by date (UBD) |
| `storage_temperature` | - | Storage temp range |

---

## Entity Schema

Entity-level fields are company-wide and reusable across all products.

### Categories

| Category | Fields | Description |
|----------|--------|-------------|
| `company_info` | 19 | Name, address, type, activities |
| `contacts` | 24 | Main, sales, quality, emergency contacts |
| `financial` | 8 | Insurance, bank details |
| `certifications` | 11 | GFSI, BRC, IFS, organic, halal, kosher |
| `quality_systems` | 12 | Purchasing specs, inspections, retained samples |
| `food_safety` | 11 | HACCP, GMO, allergen separation |
| `audits` | 3 | Internal audits, unannounced audits |
| `training` | 1 | Employee training |
| `facilities` | 5 | Equipment calibration, pest control |
| `crisis_management` | 3 | Complaints, recalls, emergency plan |
| `traceability` | 2 | Traceability system |
| `social_compliance` | 3 | SEDEX, SMETA |
| `declaration` | 2 | Signature, date |

### Company Information

| Canonical | Type | Aliases |
|-----------|------|---------|
| `company_name` | string | Company Name, Supplier Name, Bedrijfsnaam, Raison sociale |
| `company_address_street` | string | Street, Address, Adres, Rue |
| `company_address_postcode` | string | Post Code, Postal Code, Postcode, Code postal |
| `company_address_city` | string | City, Plaats, Town, Ville |
| `company_address_country` | string | Country, Land, State, Pays |
| `company_website` | string | Website, Web, Site web |
| `company_established` | string | When was the company established?, Year established |
| `company_type` | enum | Is the company Private/Limited/Public? |
| `company_parent` | string | If part of a group please note parent company |
| `company_employees` | string | Number of employees, Nombre d'employés |
| `company_eu_number` | string | EG-nummer, EU number, Health mark, Numéro CEE |
| `company_vat_number` | string | Tax number, VAT number, BTW nummer |

### Contacts

Each contact type has name, phone, and email fields.

| Contact Type | Name Field | Phone Field | Email Field |
|--------------|------------|-------------|-------------|
| Main | `contact_main_name` | `contact_main_phone` | `contact_main_email` |
| Sales | `contact_sales_name` | `contact_sales_phone` | `contact_sales_email` |
| Quality | `contact_quality_name` | `contact_quality_phone` | `contact_quality_email` |
| Accounting | `contact_accounting_name` | `contact_accounting_phone` | `contact_accounting_email` |
| Sustainability | `contact_sustainability_name` | `contact_sustainability_phone` | `contact_sustainability_email` |
| Emergency 1 | `contact_emergency_1_name` | `contact_emergency_1_phone` | `contact_emergency_1_email` |
| Emergency 2 | `contact_emergency_2_name` | `contact_emergency_2_phone` | `contact_emergency_2_email` |

### Certifications

| Canonical | Type | Description |
|-----------|------|-------------|
| `cert_gfsi_type` | string | GFSI-recognized certification type |
| `cert_brc` | bool | BRC/BRCGS certified |
| `cert_ifs` | bool | IFS Food certified |
| `cert_fssc22000` | bool | FSSC 22000 certified |
| `cert_iso22000` | bool | ISO 22000 certified |
| `cert_organic` | bool | Organic/Bio certified |
| `cert_organic_body` | string | Organic certification body |
| `cert_halal` | bool | Halal certified |
| `cert_kosher` | bool | Kosher certified |
| `cert_other` | string | Other certifications |

### Quality Systems (Yes/No Questions)

| Canonical | Question |
|-----------|----------|
| `quality_purchasing_specs` | Is quality ensured through own purchasing specifications? |
| `quality_suppliers_audited` | Are suppliers audited and evaluated? |
| `quality_packaging_compliance` | Are declarations of compliance for packaging available (EC 1935/2004)? |
| `quality_logistics_certified` | Are all logisticians subject to a quality management system? |
| `quality_own_laboratory` | Does the company have its own laboratory? |
| `quality_risk_analysis_plan` | Is there a risk-based analysis plan? |
| `quality_incoming_inspection` | Are incoming goods inspections carried out? |
| `quality_outgoing_inspection` | Are outgoing goods inspections carried out? |
| `quality_retained_raw_materials` | Are retained samples of raw materials kept? |
| `quality_retained_finished_goods` | Are retained samples of finished goods kept? |
| `quality_batch_testing` | Is every production batch sampled and tested? |

### Food Safety / HACCP

| Canonical | Question |
|-----------|----------|
| `haccp_concept` | Is there an HACCP concept with risk analysis? |
| `haccp_flow_diagrams` | Are flow diagrams with CCPs available? |
| `haccp_gmo_used` | Are GMOs used in the company? |
| `haccp_ionizing_radiation` | Are products exposed to ionizing radiation? |
| `haccp_foreign_body_prevention` | Are foreign body prevention measures in place? |
| `haccp_food_defense` | Is there a food defense risk analysis? |
| `haccp_food_fraud` | Is there a food fraud assessment? |
| `haccp_allergen_storage` | Are allergen materials stored separately? |
| `haccp_allergen_separation` | Is allergen processing separated? |
| `haccp_organic_storage` | Are organic materials stored separately? |
| `haccp_organic_separation` | Is organic processing separated? |

---

## Tracking Unanswered Questions

When extracting data, track which canonical fields were:
1. **Answered** - Field has a meaningful value
2. **Skipped** - Question was present but not answered (empty, N/A, dash)
3. **Not Asked** - Question was not in this questionnaire

### Skip Indicators

These values indicate a skipped/unanswered question:
- Empty string / blank
- `N/A`, `n/a`, `NA`
- `--`, `-`
- `not applicable`
- `Ethical Skip` (used when question is inappropriate)
- `not available`

### Data Structure for Tracking

```typescript
interface ExtractedField {
  canonical: string;        // Standardized field name
  value: string | null;     // Extracted value (null if skipped)
  status: 'answered' | 'skipped' | 'not_asked';
  originalLabel: string;    // Original question text
  source: string;           // Source file
  cells?: string;           // Cell reference if from Excel
}

interface QuestionnaireExtraction {
  source: string;
  extractedAt: string;

  // All fields that were found in this questionnaire
  fields: ExtractedField[];

  // Summary statistics
  stats: {
    total: number;          // Total fields in schema
    found: number;          // Fields present in questionnaire
    answered: number;       // Fields with valid answers
    skipped: number;        // Fields present but unanswered
    notAsked: number;       // Fields not in this questionnaire
  };
}
```

### Coverage Report

For each customer, generate a coverage report showing:

```
Customer: Kaas-Pack Holland BV
Total Canonical Fields: 240

Company Information: 19/19 (100%)
  - company_name: answered
  - company_address_street: answered
  - company_website: answered
  - company_employees: skipped (was asked but not answered)
  ...

Certifications: 8/11 (73%)
  - cert_brc: answered (Yes)
  - cert_ifs: answered (Yes)
  - cert_halal: not_asked (question not in questionnaire)
  ...

Allergens: 28/32 (88%)
  - allergen_gluten_present: answered (No)
  - allergen_milk_source: skipped
  ...
```

---

## Usage in Code

```typescript
import { PRODUCT_SCHEMA, buildAliasMap, normalizeLabel } from './schemas/product-schema';
import { ENTITY_SCHEMA, buildEntityAliasMap, normalizeEntityLabel } from './schemas/entity-schema';

// Build alias maps for fast lookup
const productAliasMap = buildAliasMap();
const entityAliasMap = buildEntityAliasMap();

// Normalize a label from questionnaire
const label = "Cereals containing gluten (Wheat, Rye, Barley)";
const canonical = normalizeLabel(label, productAliasMap);
// Returns: "allergen_gluten_present"

// Check if field was answered or skipped
function isSkipped(value: string): boolean {
  const skipIndicators = ['', 'n/a', 'na', '--', '-', 'not applicable', 'not available'];
  return skipIndicators.includes(value.toLowerCase().trim());
}

// Normalize values
const rawValue = "ja-yes";
const normalized = normalizeValue('allergen_gluten_present', rawValue);
// Returns: "yes"
```

---

## Questionnaire Sources Analyzed

| Questionnaire | Customer | Type | Fields |
|---------------|----------|------|--------|
| Dairygold SAQ V6 | Kaas-Pack | HTML | 45 entity, 24 product |
| Marfo RL14-1 | Kaas-Pack | Excel | 9 entity, 3 product |
| TIPPAGRAL E_023 v6 | Kaas-Pack | Excel | 50 entity, 167 product |
| Fude+Serrahn Cheese 2025 | Kaas-Pack | Excel | 37 entity, 28 product |
| Questionnaire emballages | Kaas-Pack | Excel | 0 entity, 46 product |
| Supplier Self-Disclosure | Doehler | PDF | 68 entity, 0 product |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02-19 | Initial schema with 240+ fields across product and entity levels |
