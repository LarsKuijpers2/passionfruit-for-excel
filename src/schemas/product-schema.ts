/**
 * Standardized Product Schema
 *
 * This schema defines canonical field names for product data extracted from
 * supplier questionnaires. It consolidates variations across different
 * questionnaire formats (Dairygold, TIPPAGRAL, Fude+Serrahn, etc.)
 */

// ============================================================================
// TYPES
// ============================================================================

export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'date' | 'array';

export interface FieldDefinition {
  canonical: string;
  type: FieldType;
  category: string;
  subcategory?: string;
  description: string;
  unit?: string;
  enumValues?: string[];
  aliases: string[];  // All known variations that map to this field
  required?: boolean;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface ProductSchema {
  version: string;
  categories: string[];
  fields: FieldDefinition[];
}

// ============================================================================
// EU 14 ALLERGENS (standardized list)
// ============================================================================

export const EU_ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs'
] as const;

export type EUAllergen = typeof EU_ALLERGENS[number];

// ============================================================================
// MICROBIOLOGICAL PARAMETERS
// ============================================================================

export const MICRO_PARAMETERS = [
  'ecoli',
  'staphylococci',
  'listeria',
  'salmonella',
  'coliforms',
  'moulds',
  'yeasts',
  'enterobacteriaceae'
] as const;

export type MicroParameter = typeof MICRO_PARAMETERS[number];

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

export const PRODUCT_SCHEMA: ProductSchema = {
  version: '1.0.0',
  categories: [
    'identification',
    'allergens',
    'origin',
    'ingredients',
    'nutrition',
    'microbiology',
    'packaging',
    'logistics',
    'characteristics',
    'food_safety',
    'compliance'
  ],
  fields: [
    // ========================================================================
    // IDENTIFICATION
    // ========================================================================
    {
      canonical: 'product_name',
      type: 'string',
      category: 'identification',
      description: 'Commercial name of the product',
      required: true,
      aliases: [
        'Product Name',
        'Product',
        'Product / Produit',
        'Produit',
        'Nom du produit',
        'Product name',
        'PRODUCT NAME'
      ]
    },
    {
      canonical: 'product_code',
      type: 'string',
      category: 'identification',
      description: 'Supplier product code/SKU',
      required: true,
      aliases: [
        'Product Code',
        'Product Reference',
        'Reference',
        'Reference / Référence',
        'Référence',
        'Supplier Product Code',
        'Article Number',
        'SKU',
        'Reference on Specifications',
        'Reference on Delivery Note'
      ]
    },
    {
      canonical: 'customer_product_code',
      type: 'string',
      category: 'identification',
      description: 'Customer-specific product code',
      aliases: [
        'Tippagral Product Code',
        'Customer Reference',
        'Client Reference'
      ]
    },
    {
      canonical: 'legal_name',
      type: 'string',
      category: 'identification',
      description: 'Legal name of food for labeling',
      aliases: [
        'Legal Name of Food',
        'Dénomination légale',
        'Legal denomination'
      ]
    },
    {
      canonical: 'product_type',
      type: 'string',
      category: 'identification',
      description: 'Type/category of product',
      aliases: [
        'Product Type',
        'Type of cheese',
        'Type de fromage',
        'Product Category'
      ]
    },
    {
      canonical: 'product_range',
      type: 'string',
      category: 'identification',
      description: 'Product range/family',
      aliases: [
        'Product range',
        'Gamme de produits',
        'Product family'
      ]
    },
    {
      canonical: 'principal_products',
      type: 'string',
      category: 'identification',
      description: 'Principal products manufactured',
      aliases: [
        'Outline principal products manufactured',
        'Principal products',
        'Main products'
      ]
    },
    {
      canonical: 'other_products',
      type: 'string',
      category: 'identification',
      description: 'Other products produced on site',
      aliases: [
        'Please indicate \'other products\' produced',
        'Other products',
        'Autres produits'
      ]
    },
    {
      canonical: 'products_for_customer',
      type: 'string',
      category: 'identification',
      description: 'Products supplied to specific customer',
      aliases: [
        'Current or proposed product supplied to Dairygold',
        'Products supplied',
        'Produits fournis'
      ]
    },

    // ========================================================================
    // ALLERGENS (expanded for each EU allergen)
    // ========================================================================
    // Gluten
    {
      canonical: 'allergen_gluten_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'gluten',
      description: 'Presence of cereals containing gluten',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Cereals containing gluten ‒ Wheat, Rye, Barley, Spelt, Kh',
        'Cereals containing gluten (Wheat, Rye, Barley, Spelt, Khorasan, Kamut, Oats etc.)',
        'Cereals containing gluten',
        'Cereals containing gluten - Presence in recipe',
        'Gluten',
        'Céréales contenant du gluten'
      ]
    },
    {
      canonical: 'allergen_gluten_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'gluten',
      description: 'Cross-contamination risk for gluten',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Cereals containing gluten - Cross-contamination risk'
      ]
    },
    // Crustaceans
    {
      canonical: 'allergen_crustaceans_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'crustaceans',
      description: 'Presence of crustaceans',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Crustaceans (Shellfish)',
        'Crustaceans',
        'Crustaceans and products thereof - Presence in recipe',
        'Crustacés'
      ]
    },
    {
      canonical: 'allergen_crustaceans_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'crustaceans',
      description: 'Cross-contamination risk for crustaceans',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Crustaceans and products thereof - Cross-contamination risk'
      ]
    },
    // Eggs
    {
      canonical: 'allergen_eggs_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'eggs',
      description: 'Presence of eggs',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Egg',
        'Eggs',
        'Eggs and products thereof - Presence in recipe',
        'Œufs'
      ]
    },
    {
      canonical: 'allergen_eggs_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'eggs',
      description: 'Cross-contamination risk for eggs',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Eggs and products thereof - Cross-contamination risk'
      ]
    },
    // Fish
    {
      canonical: 'allergen_fish_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'fish',
      description: 'Presence of fish',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Fish',
        'Fish and products thereof - Presence in recipe',
        'Poisson'
      ]
    },
    {
      canonical: 'allergen_fish_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'fish',
      description: 'Cross-contamination risk for fish',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Fish and products thereof - Cross-contamination risk'
      ]
    },
    // Peanuts
    {
      canonical: 'allergen_peanuts_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'peanuts',
      description: 'Presence of peanuts',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Peanuts',
        'Peanuts and products thereof - Presence in recipe',
        'Arachides'
      ]
    },
    {
      canonical: 'allergen_peanuts_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'peanuts',
      description: 'Cross-contamination risk for peanuts',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Peanuts and products thereof - Cross-contamination risk'
      ]
    },
    // Soybeans
    {
      canonical: 'allergen_soybeans_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'soybeans',
      description: 'Presence of soybeans/soya',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Soya',
        'Soybeans',
        'Soybeans and products thereof - Presence in recipe',
        'Soja'
      ]
    },
    {
      canonical: 'allergen_soybeans_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'soybeans',
      description: 'Cross-contamination risk for soybeans',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Soybeans and products thereof - Cross-contamination risk'
      ]
    },
    // Milk
    {
      canonical: 'allergen_milk_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'milk',
      description: 'Presence of milk',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Milk',
        'Milk and products thereof - Presence in recipe',
        'Lait'
      ]
    },
    {
      canonical: 'allergen_milk_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'milk',
      description: 'Cross-contamination risk for milk',
      enumValues: ['yes', 'no', 'presence', 'absence', 'n/a'],
      aliases: [
        'Milk and products thereof - Cross-contamination risk'
      ]
    },
    {
      canonical: 'allergen_milk_source',
      type: 'string',
      category: 'allergens',
      subcategory: 'milk',
      description: 'Source of milk (cow, goat, sheep, etc.)',
      aliases: [
        'Milk and products thereof - Source',
        'Is milk handled or present on manufacturer site at any time',
        'Milk source'
      ]
    },
    {
      canonical: 'lactose_free',
      type: 'boolean',
      category: 'allergens',
      subcategory: 'milk',
      description: 'Whether product is lactose-free',
      aliases: [
        'Lactose-free',
        'Sans lactose'
      ]
    },
    {
      canonical: 'lactose_level',
      type: 'string',
      category: 'allergens',
      subcategory: 'milk',
      description: 'Lactose level in g/100g',
      unit: 'g/100g',
      aliases: [
        'Lactose level (g/100g)',
        'Teneur en lactose'
      ]
    },
    // Nuts
    {
      canonical: 'allergen_nuts_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'nuts',
      description: 'Presence of tree nuts',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Tree Nuts',
        'Nuts',
        'Nuts and products thereof - Presence in recipe',
        'Fruits à coque',
        'Are nuts or ingredients containing nuts handled or present on manufacture site at any time'
      ]
    },
    {
      canonical: 'allergen_nuts_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'nuts',
      description: 'Cross-contamination risk for nuts',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Nuts and products thereof - Cross-contamination risk'
      ]
    },
    // Celery
    {
      canonical: 'allergen_celery_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'celery',
      description: 'Presence of celery',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Celery',
        'Celery and products thereof - Presence in recipe',
        'Céleri'
      ]
    },
    {
      canonical: 'allergen_celery_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'celery',
      description: 'Cross-contamination risk for celery',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Celery and products thereof - Cross-contamination risk'
      ]
    },
    // Mustard
    {
      canonical: 'allergen_mustard_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'mustard',
      description: 'Presence of mustard',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Mustard',
        'Mustard and products thereof - Presence in recipe',
        'Moutarde'
      ]
    },
    {
      canonical: 'allergen_mustard_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'mustard',
      description: 'Cross-contamination risk for mustard',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Mustard and products thereof - Cross-contamination risk'
      ]
    },
    // Sesame
    {
      canonical: 'allergen_sesame_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'sesame',
      description: 'Presence of sesame',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Sesame',
        'Sesame seeds and products thereof - Presence in recipe',
        'Sésame'
      ]
    },
    {
      canonical: 'allergen_sesame_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'sesame',
      description: 'Cross-contamination risk for sesame',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Sesame seeds and products thereof - Cross-contamination risk'
      ]
    },
    // Sulphites
    {
      canonical: 'allergen_sulphites_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'sulphites',
      description: 'Presence of sulphur dioxide and sulphites (>10mg/kg)',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Sulphur dioxide and Sulphites',
        'Sulphur dioxide and sulphites (>10mg/kg) - Presence in recipe',
        'Sulphites',
        'Anhydride sulfureux et sulfites'
      ]
    },
    {
      canonical: 'allergen_sulphites_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'sulphites',
      description: 'Cross-contamination risk for sulphites',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Sulphur dioxide and sulphites (>10mg/kg) - Cross-contamination risk'
      ]
    },
    // Lupin
    {
      canonical: 'allergen_lupin_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'lupin',
      description: 'Presence of lupin',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Lupin',
        'Lupin and products thereof - Presence in recipe',
        'Lupins'
      ]
    },
    {
      canonical: 'allergen_lupin_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'lupin',
      description: 'Cross-contamination risk for lupin',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Lupin and products thereof - Cross-contamination risk'
      ]
    },
    // Molluscs
    {
      canonical: 'allergen_molluscs_present',
      type: 'enum',
      category: 'allergens',
      subcategory: 'molluscs',
      description: 'Presence of molluscs',
      enumValues: ['yes', 'no', 'presence', 'absence', 'traces'],
      aliases: [
        'Molluscs',
        'Molluscs and products thereof - Presence in recipe',
        'Mollusques'
      ]
    },
    {
      canonical: 'allergen_molluscs_cross_contamination',
      type: 'enum',
      category: 'allergens',
      subcategory: 'molluscs',
      description: 'Cross-contamination risk for molluscs',
      enumValues: ['yes', 'no', 'presence', 'absence'],
      aliases: [
        'Molluscs and products thereof - Cross-contamination risk'
      ]
    },
    // Allergen management
    {
      canonical: 'allergens_assessed',
      type: 'boolean',
      category: 'allergens',
      subcategory: 'management',
      description: 'Are all raw materials assessed for allergens',
      aliases: [
        '4.1.1 - Are all raw materials assessed for allergens',
        'Are all raw materials assessed for allergens',
        'Allergen hazards identified'
      ]
    },
    {
      canonical: 'allergen_controls_in_place',
      type: 'boolean',
      category: 'allergens',
      subcategory: 'management',
      description: 'Suitable allergen contamination controls in place',
      aliases: [
        '4.1.2 - Are suitable allergen contamination controls in place inc',
        '4.1.2 - Are suitable allergen contamination controls in place including for food brought on site by staff',
        'Are suitable allergen contamination controls in place including for food brought on site by staff',
        'Beheersing niet gedeclareerde allergenen'
      ]
    },
    {
      canonical: 'allergens_on_site',
      type: 'string',
      category: 'allergens',
      subcategory: 'management',
      description: 'List of allergens present on site',
      aliases: [
        '4.1.3 - If any of allergen are present on site (except of milk) p',
        '4.1.3 - If any of allergen are present on site (except of milk) please list all ingredients of concern'
      ]
    },

    // ========================================================================
    // ORIGIN / TRACEABILITY
    // ========================================================================
    {
      canonical: 'country_of_origin',
      type: 'string',
      category: 'origin',
      description: 'Country where product is manufactured',
      aliases: [
        'Country of Origin',
        'Origin/Identity Marker',
        'Pays d\'origine'
      ]
    },
    {
      canonical: 'milk_origin_countries',
      type: 'string',
      category: 'origin',
      description: 'Countries where milk is sourced from',
      aliases: [
        'Milk Origin Countries',
        'Pays d\'origine du lait',
        'Pasteurized Cow\'s Milk - Country of Origin'
      ]
    },
    {
      canonical: 'eu27_milk_compliance',
      type: 'boolean',
      category: 'origin',
      description: 'Milk sourced from EU-27 countries',
      aliases: [
        'EU-27 Milk Source Compliance',
        'EU manufacturing and milk origin compliance'
      ]
    },
    {
      canonical: 'healthmark',
      type: 'string',
      category: 'origin',
      description: 'EU health mark / identification mark',
      aliases: [
        'Healthmark of packing site',
        'Marque de salubrité',
        'Health mark'
      ]
    },

    // ========================================================================
    // INGREDIENTS
    // ========================================================================
    {
      canonical: 'ingredient_list',
      type: 'string',
      category: 'ingredients',
      description: 'Full ingredient list for labeling',
      aliases: [
        'Ingredient List for Labelling',
        'Liste des ingrédients',
        'Ingredients'
      ]
    },
    {
      canonical: 'ingredient_milk_percentage',
      type: 'number',
      category: 'ingredients',
      subcategory: 'milk',
      description: 'Milk incorporation percentage',
      unit: '%',
      aliases: [
        'Pasteurized Cow\'s Milk - Incorporation %'
      ]
    },
    {
      canonical: 'ingredient_milk_bio_origin',
      type: 'string',
      category: 'ingredients',
      subcategory: 'milk',
      description: 'Biological origin of milk (A=animal)',
      aliases: [
        'Pasteurized Cow\'s Milk - Biological Origin'
      ]
    },
    {
      canonical: 'ingredient_milk_gmo',
      type: 'boolean',
      category: 'ingredients',
      subcategory: 'milk',
      description: 'GMO status of milk',
      aliases: [
        'Pasteurized Cow\'s Milk - GMO'
      ]
    },
    {
      canonical: 'ingredient_salt_percentage',
      type: 'number',
      category: 'ingredients',
      subcategory: 'salt',
      description: 'Salt incorporation percentage',
      unit: '%',
      aliases: [
        'Salt - Incorporation %'
      ]
    },
    {
      canonical: 'ingredient_salt_origin',
      type: 'string',
      category: 'ingredients',
      subcategory: 'salt',
      description: 'Country of origin for salt',
      aliases: [
        'Salt - Country of Origin'
      ]
    },
    {
      canonical: 'ingredient_starter_percentage',
      type: 'string',
      category: 'ingredients',
      subcategory: 'starter',
      description: 'Starter culture incorporation percentage',
      aliases: [
        'Starter - Incorporation %'
      ]
    },
    {
      canonical: 'ingredient_starter_origin',
      type: 'string',
      category: 'ingredients',
      subcategory: 'starter',
      description: 'Country of origin for starter culture',
      aliases: [
        'Starter - Country of Origin'
      ]
    },
    {
      canonical: 'ingredient_rennet_percentage',
      type: 'string',
      category: 'ingredients',
      subcategory: 'rennet',
      description: 'Rennet incorporation percentage',
      aliases: [
        'Microbial Rennet - Incorporation %'
      ]
    },
    {
      canonical: 'ingredient_rennet_bio_origin',
      type: 'string',
      category: 'ingredients',
      subcategory: 'rennet',
      description: 'Biological origin of rennet (B=bacterial, A=animal)',
      aliases: [
        'Microbial Rennet - Biological Origin'
      ]
    },
    {
      canonical: 'ingredient_rennet_origin',
      type: 'string',
      category: 'ingredients',
      subcategory: 'rennet',
      description: 'Country of origin for rennet',
      aliases: [
        'Microbial Rennet - Country of Origin'
      ]
    },
    {
      canonical: 'contains_colorant',
      type: 'boolean',
      category: 'ingredients',
      description: 'Contains colorant/color additives',
      aliases: [
        'Colour / Colorant',
        'Beta-carotene - E Number'
      ]
    },
    {
      canonical: 'contains_flavoring',
      type: 'boolean',
      category: 'ingredients',
      description: 'Contains flavoring',
      aliases: [
        'Flavoring / Arôme'
      ]
    },
    {
      canonical: 'contains_preservative',
      type: 'boolean',
      category: 'ingredients',
      description: 'Contains preservative',
      aliases: [
        'Preservative / Conservateur'
      ]
    },
    {
      canonical: 'contains_antioxidant',
      type: 'boolean',
      category: 'ingredients',
      description: 'Contains antioxidant',
      aliases: [
        'Antioxidant / Antioxydant'
      ]
    },
    {
      canonical: 'contains_flavour_enhancer',
      type: 'boolean',
      category: 'ingredients',
      description: 'Contains flavour enhancer',
      aliases: [
        'Flavour enhancer / Exhausteur de goût'
      ]
    },
    {
      canonical: 'contains_palm_oil',
      type: 'boolean',
      category: 'ingredients',
      description: 'Contains palm fats/oils',
      aliases: [
        'Presence of Palm Fats/Oils in Ingredient List',
        'Presence of Palm Fats/Oils in All Ingredients (including additives, carriers, etc.)'
      ]
    },
    {
      canonical: 'contains_hydrogenated_fats',
      type: 'boolean',
      category: 'ingredients',
      description: 'Contains wholly or partially hydrogenated fats',
      aliases: [
        'Presence of Wholly Hydrogenated Fats/Oils',
        'Presence of Partially Hydrogenated Fats/Oils'
      ]
    },
    {
      canonical: 'contains_trans_fats',
      type: 'boolean',
      category: 'ingredients',
      description: 'Contains non-natural trans-fatty acids',
      aliases: [
        'Presence of Non-Natural Trans-Fatty Acids'
      ]
    },
    {
      canonical: 'non_animal_compliance',
      type: 'string',
      category: 'ingredients',
      description: 'Compliance statement for non-animal products',
      aliases: [
        'Non-animal product compliance'
      ]
    },

    // ========================================================================
    // NUTRITION (per 100g)
    // ========================================================================
    {
      canonical: 'nutrition_energy_kj',
      type: 'number',
      category: 'nutrition',
      description: 'Energy value',
      unit: 'kJ/100g',
      aliases: [
        'Energy Value (Kj)',
        'Valeur énergétique (kJ)'
      ]
    },
    {
      canonical: 'nutrition_energy_kcal',
      type: 'number',
      category: 'nutrition',
      description: 'Energy value',
      unit: 'kcal/100g',
      aliases: [
        'Energy Value (Kcal)',
        'Valeur énergétique (kcal)'
      ]
    },
    {
      canonical: 'nutrition_fat',
      type: 'number',
      category: 'nutrition',
      description: 'Total fat',
      unit: 'g/100g',
      aliases: [
        'Fat (g)',
        'Matières grasses'
      ]
    },
    {
      canonical: 'nutrition_saturated_fat',
      type: 'number',
      category: 'nutrition',
      description: 'Saturated fat',
      unit: 'g/100g',
      aliases: [
        'Saturated Fat Acids (g)',
        'Acides gras saturés'
      ]
    },
    {
      canonical: 'nutrition_carbohydrates',
      type: 'string',
      category: 'nutrition',
      description: 'Carbohydrates',
      unit: 'g/100g',
      aliases: [
        'Carbohydrates (g)',
        'Glucides'
      ]
    },
    {
      canonical: 'nutrition_sugars',
      type: 'string',
      category: 'nutrition',
      description: 'Sugars',
      unit: 'g/100g',
      aliases: [
        'Sugars (g)',
        'Sucres'
      ]
    },
    {
      canonical: 'nutrition_protein',
      type: 'number',
      category: 'nutrition',
      description: 'Protein',
      unit: 'g/100g',
      aliases: [
        'Proteins (g)',
        'Protéines'
      ]
    },
    {
      canonical: 'nutrition_salt',
      type: 'number',
      category: 'nutrition',
      description: 'Salt',
      unit: 'g/100g',
      aliases: [
        'Salt (g)',
        'Sel'
      ]
    },
    {
      canonical: 'fat_in_dry_matter_min',
      type: 'number',
      category: 'nutrition',
      description: 'Minimum fat in dry matter',
      unit: '%',
      aliases: [
        'Fat in Dry Matter (Min)'
      ]
    },
    {
      canonical: 'fat_in_dry_matter_target',
      type: 'number',
      category: 'nutrition',
      description: 'Target fat in dry matter',
      unit: '%',
      aliases: [
        'Fat in Dry Matter (Target)'
      ]
    },
    {
      canonical: 'fat_in_dry_matter_max',
      type: 'number',
      category: 'nutrition',
      description: 'Maximum fat in dry matter',
      unit: '%',
      aliases: [
        'Fat in Dry Matter (Max)'
      ]
    },

    // ========================================================================
    // MICROBIOLOGY
    // ========================================================================
    // E. coli
    {
      canonical: 'micro_ecoli_target',
      type: 'string',
      category: 'microbiology',
      subcategory: 'ecoli',
      description: 'E. coli target limit',
      aliases: [
        'Escherichia Coli Target'
      ]
    },
    {
      canonical: 'micro_ecoli_tolerance',
      type: 'string',
      category: 'microbiology',
      subcategory: 'ecoli',
      description: 'E. coli tolerance limit',
      aliases: [
        'Escherichia Coli Tolerance'
      ]
    },
    {
      canonical: 'micro_ecoli_method',
      type: 'string',
      category: 'microbiology',
      subcategory: 'ecoli',
      description: 'E. coli analysis method',
      aliases: [
        'Escherichia Coli Analysis Method'
      ]
    },
    // Staphylococci
    {
      canonical: 'micro_staph_target',
      type: 'string',
      category: 'microbiology',
      subcategory: 'staphylococci',
      description: 'Coagulase positive staphylococci target limit',
      aliases: [
        'Coagulase positive staphylococci Target'
      ]
    },
    {
      canonical: 'micro_staph_tolerance',
      type: 'string',
      category: 'microbiology',
      subcategory: 'staphylococci',
      description: 'Coagulase positive staphylococci tolerance limit',
      aliases: [
        'Coagulase positive staphylococci Tolerance'
      ]
    },
    {
      canonical: 'micro_staph_method',
      type: 'string',
      category: 'microbiology',
      subcategory: 'staphylococci',
      description: 'Coagulase positive staphylococci analysis method',
      aliases: [
        'Coagulase positive staphylococci Analysis Method'
      ]
    },
    // Listeria
    {
      canonical: 'micro_listeria_target',
      type: 'string',
      category: 'microbiology',
      subcategory: 'listeria',
      description: 'Listeria monocytogenes target limit',
      aliases: [
        'Listeria monocytogenes Target'
      ]
    },
    {
      canonical: 'micro_listeria_tolerance',
      type: 'string',
      category: 'microbiology',
      subcategory: 'listeria',
      description: 'Listeria monocytogenes tolerance limit',
      aliases: [
        'Listeria monocytogenes Tolerance'
      ]
    },
    {
      canonical: 'micro_listeria_method',
      type: 'string',
      category: 'microbiology',
      subcategory: 'listeria',
      description: 'Listeria monocytogenes analysis method',
      aliases: [
        'Listeria monocytogenes Analysis Method'
      ]
    },
    {
      canonical: 'micro_listeria_growth_support',
      type: 'boolean',
      category: 'microbiology',
      subcategory: 'listeria',
      description: 'Product able to support growth of L. monocytogenes',
      aliases: [
        'Product able to support growth of L. monocytogenes'
      ]
    },
    // Salmonella
    {
      canonical: 'micro_salmonella_target',
      type: 'string',
      category: 'microbiology',
      subcategory: 'salmonella',
      description: 'Salmonella target limit',
      aliases: [
        'Salmonella spp Target'
      ]
    },
    {
      canonical: 'micro_salmonella_tolerance',
      type: 'string',
      category: 'microbiology',
      subcategory: 'salmonella',
      description: 'Salmonella tolerance limit',
      aliases: [
        'Salmonella spp Tolerance'
      ]
    },
    {
      canonical: 'micro_salmonella_method',
      type: 'string',
      category: 'microbiology',
      subcategory: 'salmonella',
      description: 'Salmonella analysis method',
      aliases: [
        'Salmonella spp Analysis Method'
      ]
    },
    // Coliforms
    {
      canonical: 'micro_coliforms_target',
      type: 'string',
      category: 'microbiology',
      subcategory: 'coliforms',
      description: 'Total coliforms target limit',
      aliases: [
        'Total Coliforms Target'
      ]
    },
    {
      canonical: 'micro_coliforms_tolerance',
      type: 'string',
      category: 'microbiology',
      subcategory: 'coliforms',
      description: 'Total coliforms tolerance limit',
      aliases: [
        'Total Coliforms Tolerance'
      ]
    },
    {
      canonical: 'micro_coliforms_method',
      type: 'string',
      category: 'microbiology',
      subcategory: 'coliforms',
      description: 'Total coliforms analysis method',
      aliases: [
        'Total Coliforms Analysis Method'
      ]
    },
    // Moulds
    {
      canonical: 'micro_moulds_target',
      type: 'string',
      category: 'microbiology',
      subcategory: 'moulds',
      description: 'Moulds target limit',
      aliases: [
        'Moulds Target'
      ]
    },
    {
      canonical: 'micro_moulds_tolerance',
      type: 'string',
      category: 'microbiology',
      subcategory: 'moulds',
      description: 'Moulds tolerance limit',
      aliases: [
        'Moulds Tolerance'
      ]
    },
    {
      canonical: 'micro_moulds_method',
      type: 'string',
      category: 'microbiology',
      subcategory: 'moulds',
      description: 'Moulds analysis method',
      aliases: [
        'Moulds Analysis Method'
      ]
    },
    // Yeasts
    {
      canonical: 'micro_yeasts_target',
      type: 'string',
      category: 'microbiology',
      subcategory: 'yeasts',
      description: 'Yeasts target limit',
      aliases: [
        'Yeasts Target'
      ]
    },
    {
      canonical: 'micro_yeasts_tolerance',
      type: 'string',
      category: 'microbiology',
      subcategory: 'yeasts',
      description: 'Yeasts tolerance limit',
      aliases: [
        'Yeasts Tolerance'
      ]
    },
    {
      canonical: 'micro_yeasts_method',
      type: 'string',
      category: 'microbiology',
      subcategory: 'yeasts',
      description: 'Yeasts analysis method',
      aliases: [
        'Yeasts Analysis Method'
      ]
    },
    {
      canonical: 'micro_compliance_statement',
      type: 'string',
      category: 'microbiology',
      description: 'General microbiological compliance statement',
      aliases: [
        'Contamination prevention and microbiological compliance',
        'Chemische en microbiologische analyses'
      ]
    },

    // ========================================================================
    // PACKAGING - PRIMARY
    // ========================================================================
    {
      canonical: 'pkg_primary_type',
      type: 'string',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Type of primary packaging (tray, pouch, etc.)',
      aliases: [
        'Primary Element 1 Type',
        'Primary packaging components'
      ]
    },
    {
      canonical: 'pkg_primary_composition',
      type: 'string',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Material composition of primary packaging',
      aliases: [
        'Primary Element 1 Composition',
        'PEEVOH/PET and PE/APET'
      ]
    },
    {
      canonical: 'pkg_primary_weight',
      type: 'number',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Weight of primary packaging',
      unit: 'g',
      aliases: [
        'Primary Element 1 Weight (kg)',
        'Primary packaging weight (g)',
        'Empty Packaging Weight (g)'
      ]
    },
    {
      canonical: 'pkg_primary_thickness',
      type: 'number',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Thickness of primary packaging',
      unit: 'µm',
      aliases: [
        'Primary Element 1 Thickness (µ)'
      ]
    },
    {
      canonical: 'pkg_primary_recycled_pct',
      type: 'number',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Percentage of recycled material in primary packaging',
      unit: '%',
      aliases: [
        'Primary Element 1 Recycled Material (%)',
        'Primary packaging - Recycled material'
      ]
    },
    {
      canonical: 'pkg_primary_recyclable',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Primary packaging is recyclable',
      aliases: [
        'Primary packaging - Recyclable material'
      ]
    },
    {
      canonical: 'pkg_primary_product_contact',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Primary packaging has product contact',
      aliases: [
        'Primary packaging - Product contact'
      ]
    },
    {
      canonical: 'pkg_lid_type',
      type: 'string',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Type of lid/seal',
      aliases: [
        'Primary Element 2 Type'
      ]
    },
    {
      canonical: 'pkg_lid_composition',
      type: 'string',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Material composition of lid',
      aliases: [
        'Primary Element 2 Composition'
      ]
    },
    {
      canonical: 'pkg_atmosphere',
      type: 'string',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Packaging atmosphere (MAP, vacuum, etc.)',
      aliases: [
        'Packaged In',
        'Atmosphère protectrice/protective atmosphere'
      ]
    },
    {
      canonical: 'pkg_color',
      type: 'string',
      category: 'packaging',
      subcategory: 'primary',
      description: 'Packaging color',
      aliases: [
        'Packaging Colour'
      ]
    },

    // ========================================================================
    // PACKAGING - SECONDARY (BOX/CARTON)
    // ========================================================================
    {
      canonical: 'pkg_secondary_type',
      type: 'string',
      category: 'packaging',
      subcategory: 'secondary',
      description: 'Type of secondary packaging',
      aliases: [
        'Secondary Element 1 Type'
      ]
    },
    {
      canonical: 'pkg_secondary_composition',
      type: 'string',
      category: 'packaging',
      subcategory: 'secondary',
      description: 'Material composition of secondary packaging',
      aliases: [
        'Secondary Element 1 Composition'
      ]
    },
    {
      canonical: 'pkg_secondary_weight',
      type: 'number',
      category: 'packaging',
      subcategory: 'secondary',
      description: 'Weight of secondary packaging',
      unit: 'kg',
      aliases: [
        'Secondary Element 1 Weight (kg)'
      ]
    },
    {
      canonical: 'pkg_secondary_recycled_pct',
      type: 'number',
      category: 'packaging',
      subcategory: 'secondary',
      description: 'Percentage of recycled material',
      unit: '%',
      aliases: [
        'Secondary Element 1 Recycled Material (%)'
      ]
    },
    {
      canonical: 'pkg_secondary_recyclable',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'secondary',
      description: 'Secondary packaging is recyclable',
      aliases: [
        'Secondary Element 1 Recyclable in France'
      ]
    },
    {
      canonical: 'pkg_secondary_recyclability_rate',
      type: 'number',
      category: 'packaging',
      subcategory: 'secondary',
      description: 'Recyclability rate',
      unit: '%',
      aliases: [
        'Secondary Element 1 Recyclability Rate (%)'
      ]
    },

    // ========================================================================
    // PACKAGING - TERTIARY (PALLET)
    // ========================================================================
    {
      canonical: 'pkg_tertiary_type',
      type: 'string',
      category: 'packaging',
      subcategory: 'tertiary',
      description: 'Type of tertiary packaging (pallet)',
      aliases: [
        'Tertiary Element 1 Type',
        'Pallet Type'
      ]
    },
    {
      canonical: 'pkg_tertiary_composition',
      type: 'string',
      category: 'packaging',
      subcategory: 'tertiary',
      description: 'Material of pallet',
      aliases: [
        'Tertiary Element 1 Composition',
        'Wood pallet components'
      ]
    },
    {
      canonical: 'pkg_tertiary_weight',
      type: 'number',
      category: 'packaging',
      subcategory: 'tertiary',
      description: 'Weight of pallet',
      unit: 'kg',
      aliases: [
        'Tertiary Element 1 Weight (kg)',
        'Wood pallet weight (g)'
      ]
    },
    {
      canonical: 'pkg_tertiary_reusable',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'tertiary',
      description: 'Pallet is reusable',
      aliases: [
        'Tertiary Element 1 Reusable'
      ]
    },
    {
      canonical: 'pkg_stretchfilm_composition',
      type: 'string',
      category: 'packaging',
      subcategory: 'tertiary',
      description: 'Stretch film composition',
      aliases: [
        'Tertiary Element 2 Composition'
      ]
    },
    {
      canonical: 'pkg_stretchfilm_thickness',
      type: 'number',
      category: 'packaging',
      subcategory: 'tertiary',
      description: 'Stretch film thickness',
      unit: 'µm',
      aliases: [
        'Tertiary Element 2 Thickness (µ)'
      ]
    },

    // ========================================================================
    // PACKAGING - COMPLIANCE
    // ========================================================================
    {
      canonical: 'pkg_pfas_compliant',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'compliance',
      description: 'PFAS compliance with PPWR regulations',
      aliases: [
        'PFAS (respect des 3 seuils / respect of the 3 concentration limits)'
      ]
    },
    {
      canonical: 'pkg_mosh_level',
      type: 'string',
      category: 'packaging',
      subcategory: 'compliance',
      description: 'MOSH contamination level',
      aliases: [
        'MOSH'
      ]
    },
    {
      canonical: 'pkg_moah_level',
      type: 'string',
      category: 'packaging',
      subcategory: 'compliance',
      description: 'MOAH contamination level',
      aliases: [
        'MOAH'
      ]
    },
    {
      canonical: 'pkg_food_contact_suitable',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'compliance',
      description: 'Packaging suitable for food contact',
      aliases: [
        'Is product packaging suitable for the intended use (i.e. food contact) and stored correctly?',
        'Packaging materials compliance'
      ]
    },
    {
      canonical: 'pkg_environmental_impact_minimized',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'compliance',
      description: 'Packaging designed to minimize environmental impact',
      aliases: [
        'Is packaging designed to minimize environmental impact, yet not compromise product safety / integrity?'
      ]
    },
    {
      canonical: 'pkg_supplier_declarations',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'compliance',
      description: 'Declaration by raw material suppliers available',
      aliases: [
        'Declaration by raw material suppliers'
      ]
    },
    {
      canonical: 'pkg_migration_analysis',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'compliance',
      description: 'Global migration limits analysis performed',
      aliases: [
        'Analyses of Global Migration Limits'
      ]
    },
    {
      canonical: 'pkg_restricted_substances_analysis',
      type: 'boolean',
      category: 'packaging',
      subcategory: 'compliance',
      description: 'Restricted substances analysis performed',
      aliases: [
        'Analyses of restricted substances, including specific migration'
      ]
    },

    // ========================================================================
    // LOGISTICS - DIMENSIONS
    // ========================================================================
    {
      canonical: 'product_length_mm',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Product length',
      unit: 'mm',
      aliases: [
        'Product Length (mm)'
      ]
    },
    {
      canonical: 'product_width_mm',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Product width',
      unit: 'mm',
      aliases: [
        'Product Width (mm)'
      ]
    },
    {
      canonical: 'product_height_mm',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Product height',
      unit: 'mm',
      aliases: [
        'Product Height (mm)'
      ]
    },
    {
      canonical: 'product_net_weight_kg',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Product net weight',
      unit: 'kg',
      aliases: [
        'Product Net Weight (Kg)',
        'Weight (kg)'
      ]
    },
    {
      canonical: 'product_gross_weight_kg',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Product gross weight',
      unit: 'kg',
      aliases: [
        'Product Gross Weight (Kg)'
      ]
    },
    {
      canonical: 'box_length_mm',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Box/carton length',
      unit: 'mm',
      aliases: [
        'Box Length (mm)'
      ]
    },
    {
      canonical: 'box_width_mm',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Box/carton width',
      unit: 'mm',
      aliases: [
        'Box Width (mm)'
      ]
    },
    {
      canonical: 'box_height_mm',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Box/carton height',
      unit: 'mm',
      aliases: [
        'Box Height (mm)'
      ]
    },
    {
      canonical: 'products_per_box',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Number of products per box',
      aliases: [
        'Products Per Box',
        'Units per Box'
      ]
    },
    {
      canonical: 'box_net_weight_kg',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Box net weight',
      unit: 'kg',
      aliases: [
        'Box Net Weight (Kg)'
      ]
    },
    {
      canonical: 'box_gross_weight_kg',
      type: 'number',
      category: 'logistics',
      subcategory: 'dimensions',
      description: 'Box gross weight',
      unit: 'kg',
      aliases: [
        'Box Gross Weight (Kg)'
      ]
    },
    {
      canonical: 'pallet_size',
      type: 'string',
      category: 'logistics',
      subcategory: 'pallet',
      description: 'Pallet size (e.g., Euro 80x120)',
      aliases: [
        'Pallet Size'
      ]
    },
    {
      canonical: 'pallet_height_mm',
      type: 'number',
      category: 'logistics',
      subcategory: 'pallet',
      description: 'Pallet height',
      unit: 'mm',
      aliases: [
        'Pallet Height (mm)'
      ]
    },
    {
      canonical: 'layers_per_pallet',
      type: 'number',
      category: 'logistics',
      subcategory: 'pallet',
      description: 'Number of layers per pallet',
      aliases: [
        'Layers Per Pallet'
      ]
    },
    {
      canonical: 'products_per_layer',
      type: 'number',
      category: 'logistics',
      subcategory: 'pallet',
      description: 'Number of products per layer',
      aliases: [
        'Products Per Layer'
      ]
    },
    {
      canonical: 'products_per_pallet',
      type: 'number',
      category: 'logistics',
      subcategory: 'pallet',
      description: 'Total products per pallet',
      aliases: [
        'Products Per Pallet'
      ]
    },
    {
      canonical: 'pallet_net_weight_kg',
      type: 'number',
      category: 'logistics',
      subcategory: 'pallet',
      description: 'Pallet net weight',
      unit: 'kg',
      aliases: [
        'Pallet Net Weight (Kg)'
      ]
    },
    {
      canonical: 'pallet_gross_weight_kg',
      type: 'number',
      category: 'logistics',
      subcategory: 'pallet',
      description: 'Pallet gross weight',
      unit: 'kg',
      aliases: [
        'Pallet Gross Weight (Kg)'
      ]
    },

    // ========================================================================
    // LOGISTICS - SHELF LIFE
    // ========================================================================
    {
      canonical: 'shelf_life_days',
      type: 'number',
      category: 'logistics',
      subcategory: 'shelf_life',
      description: 'Shelf life in days',
      unit: 'days',
      aliases: [
        'Best Before Date (DDM/BBD)'
      ]
    },
    {
      canonical: 'use_by_days',
      type: 'number',
      category: 'logistics',
      subcategory: 'shelf_life',
      description: 'Use by date in days',
      unit: 'days',
      aliases: [
        'Use By Date (DLC/UBD)'
      ]
    },
    {
      canonical: 'shelf_life_location',
      type: 'string',
      category: 'logistics',
      subcategory: 'shelf_life',
      description: 'Where shelf life is indicated',
      aliases: [
        'Shelf Life Location'
      ]
    },
    {
      canonical: 'storage_temp_min',
      type: 'number',
      category: 'logistics',
      subcategory: 'storage',
      description: 'Minimum storage temperature',
      unit: '°C',
      aliases: []
    },
    {
      canonical: 'storage_temp_max',
      type: 'number',
      category: 'logistics',
      subcategory: 'storage',
      description: 'Maximum storage temperature',
      unit: '°C',
      aliases: []
    },
    {
      canonical: 'storage_temperature',
      type: 'string',
      category: 'logistics',
      subcategory: 'storage',
      description: 'Storage temperature range',
      aliases: [
        'Storage Temperature'
      ]
    },

    // ========================================================================
    // LOGISTICS - TRANSPORT
    // ========================================================================
    {
      canonical: 'transport_suitable',
      type: 'boolean',
      category: 'logistics',
      subcategory: 'transport',
      description: 'Storage and transport facilities suitable',
      aliases: [
        'Are storage and transport facilities suitable for purpose, maintained and kept in good condition?'
      ]
    },
    {
      canonical: 'transport_cleanliness_checked',
      type: 'boolean',
      category: 'logistics',
      subcategory: 'transport',
      description: 'Transport vehicles checked for cleanliness',
      aliases: [
        'Are transport vehicles accessed for cleanliness/suitability before loading for dispatch'
      ]
    },
    {
      canonical: 'transport_gfsi_certified',
      type: 'boolean',
      category: 'logistics',
      subcategory: 'transport',
      description: 'Third party hauliers GFSI certified',
      aliases: [
        'If third party hauliers are used, have they been audited and certified to the global standard for storage and Distribution or alternate GFSI recognized standard'
      ]
    },
    {
      canonical: 'transport_secure_procedures',
      type: 'boolean',
      category: 'logistics',
      subcategory: 'transport',
      description: 'Secure transport procedures in place',
      aliases: [
        'Are there procedures in place to ensure that the product is held under secure conditions during transportation?'
      ]
    },
    {
      canonical: 'transport_breakdown_procedure',
      type: 'boolean',
      category: 'logistics',
      subcategory: 'transport',
      description: 'Vehicle breakdown procedure exists',
      aliases: [
        'Is there a vehicle breakdown procedure?'
      ]
    },

    // ========================================================================
    // PRODUCT CHARACTERISTICS
    // ========================================================================
    {
      canonical: 'appearance',
      type: 'string',
      category: 'characteristics',
      description: 'Expected appearance',
      aliases: [
        'Appearance (Expected Criteria)'
      ]
    },
    {
      canonical: 'taste',
      type: 'string',
      category: 'characteristics',
      description: 'Expected taste',
      aliases: [
        'Taste (Expected Criteria)'
      ]
    },
    {
      canonical: 'color',
      type: 'string',
      category: 'characteristics',
      description: 'Expected color',
      aliases: [
        'Color (Expected Criteria)'
      ]
    },
    {
      canonical: 'smell',
      type: 'string',
      category: 'characteristics',
      description: 'Expected smell',
      aliases: [
        'Smell (Expected Criteria)'
      ]
    },
    {
      canonical: 'texture',
      type: 'string',
      category: 'characteristics',
      description: 'Expected texture/consistency',
      aliases: [
        'Texture/Consistency (Expected Criteria)'
      ]
    },
    {
      canonical: 'ph_value',
      type: 'number',
      category: 'characteristics',
      description: 'Product pH value',
      aliases: [
        'pH'
      ]
    },
    {
      canonical: 'ph_raw_milk',
      type: 'string',
      category: 'characteristics',
      description: 'pH of raw milk',
      aliases: [
        'pH of Raw Milk'
      ]
    },
    {
      canonical: 'melting_properties',
      type: 'string',
      category: 'characteristics',
      description: 'Melting properties description',
      aliases: [
        'Melting Properties'
      ]
    },
    {
      canonical: 'milk_processing',
      type: 'string',
      category: 'characteristics',
      description: 'Milk processing method (pasteurized, etc.)',
      aliases: [
        'Milk processing'
      ]
    },
    {
      canonical: 'milk_heat_treatment',
      type: 'string',
      category: 'characteristics',
      description: 'Time-temperature of milk heat treatment',
      aliases: [
        'Time-Temperature',
        'Type and heating of the product (temperature and heat retention time)'
      ]
    },

    // ========================================================================
    // FOOD SAFETY / HACCP
    // ========================================================================
    {
      canonical: 'haccp_documented',
      type: 'boolean',
      category: 'food_safety',
      description: 'Documented HACCP system in place',
      aliases: [
        'Is there a documented HACCP system covering all products'
      ]
    },
    {
      canonical: 'haccp_codex_compliant',
      type: 'boolean',
      category: 'food_safety',
      description: 'HACCP meets Codex Alimentarius requirements',
      aliases: [
        'Does this meet the requirements of Codex Alimentarius?'
      ]
    },
    {
      canonical: 'haccp_reviewed',
      type: 'boolean',
      category: 'food_safety',
      description: 'HACCP plan regularly reviewed',
      aliases: [
        'Is the HACCP plan regularly reviewed?'
      ]
    },
    {
      canonical: 'haccp_team',
      type: 'string',
      category: 'food_safety',
      description: 'HACCP team composition',
      aliases: [
        'Who is in your HACCP Team Please details job title'
      ]
    },
    {
      canonical: 'haccp_training',
      type: 'string',
      category: 'food_safety',
      description: 'HACCP team training',
      aliases: [
        'What Training Have the HACCP Team undertaken? Please'
      ]
    },
    {
      canonical: 'product_development_procedures',
      type: 'boolean',
      category: 'food_safety',
      description: 'Product development procedures ensure safe and legal product',
      aliases: [
        'Are product development procedures in place to ensure that a safe and legal product is manufactured?'
      ]
    },
    {
      canonical: 'labelling_compliant',
      type: 'boolean',
      category: 'food_safety',
      description: 'Product labelling complies with legal requirements',
      aliases: [
        'Does product labelling comply with the appropriate legal requirements and reviewed whenever any changes occur to recipe, raw materials or suppliers, legislation, country of supplying'
      ]
    },

    // ========================================================================
    // COMPLIANCE
    // ========================================================================
    {
      canonical: 'retailer_own_label',
      type: 'boolean',
      category: 'compliance',
      description: 'Produces retailer own label products',
      aliases: [
        'Do you produce Retailer own label product e.g. M&S, Sainsbury, Morrison etc. Food services'
      ]
    },
    {
      canonical: 'packing_on_site',
      type: 'boolean',
      category: 'compliance',
      description: 'Products packed on site',
      aliases: [
        'Do you pack these products on your site?'
      ]
    },
    {
      canonical: 'packing_site_name',
      type: 'string',
      category: 'compliance',
      description: 'Name of packing site',
      aliases: [
        'Name of packing site'
      ]
    },

    // ========================================================================
    // CONTACTS
    // ========================================================================
    {
      canonical: 'contact_telephone',
      type: 'string',
      category: 'contacts',
      description: 'Contact telephone number',
      aliases: [
        'Telephone'
      ]
    },
    {
      canonical: 'contact_email',
      type: 'string',
      category: 'contacts',
      description: 'Contact email address',
      aliases: [
        'E-mail'
      ]
    }
  ]
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build a lookup map from aliases to canonical names
 */
export function buildAliasMap(): Map<string, string> {
  const map = new Map<string, string>();

  for (const field of PRODUCT_SCHEMA.fields) {
    // Add canonical name itself
    map.set(field.canonical.toLowerCase(), field.canonical);

    // Add all aliases
    for (const alias of field.aliases) {
      map.set(alias.toLowerCase(), field.canonical);
    }
  }

  return map;
}

/**
 * Normalize a label to its canonical form
 */
export function normalizeLabel(label: string, aliasMap?: Map<string, string>): string | null {
  const map = aliasMap ?? buildAliasMap();
  const normalized = label.toLowerCase().trim();
  return map.get(normalized) ?? null;
}

/**
 * Get field definition by canonical name
 */
export function getFieldDefinition(canonical: string): FieldDefinition | undefined {
  return PRODUCT_SCHEMA.fields.find(f => f.canonical === canonical);
}

/**
 * Get all fields for a category
 */
export function getFieldsByCategory(category: string): FieldDefinition[] {
  return PRODUCT_SCHEMA.fields.filter(f => f.category === category);
}

/**
 * Get all fields for a subcategory
 */
export function getFieldsBySubcategory(category: string, subcategory: string): FieldDefinition[] {
  return PRODUCT_SCHEMA.fields.filter(
    f => f.category === category && f.subcategory === subcategory
  );
}

/**
 * Normalize a value based on field type
 */
export function normalizeValue(canonical: string, value: string): string | number | boolean | null {
  const field = getFieldDefinition(canonical);
  if (!field) return value;

  const trimmed = value.trim().toLowerCase();

  switch (field.type) {
    case 'boolean':
      if (['yes', 'ja', 'oui', 'true', '1', 'ja-yes'].includes(trimmed)) return true;
      if (['no', 'nee', 'non', 'false', '0', 'n/a', 'na'].includes(trimmed)) return false;
      return null;

    case 'number':
      const num = parseFloat(value.replace(',', '.').replace(/[^\d.-]/g, ''));
      return isNaN(num) ? null : num;

    case 'enum':
      if (field.enumValues) {
        // Map various responses to standard enum values
        if (['yes', 'ja', 'oui', 'presence'].includes(trimmed)) return 'yes';
        if (['no', 'nee', 'non', 'absence'].includes(trimmed)) return 'no';
        if (trimmed.includes('trace')) return 'traces';
      }
      return trimmed;

    default:
      return value.trim();
  }
}

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

export const SCHEMA_SUMMARY = {
  totalFields: PRODUCT_SCHEMA.fields.length,
  categories: PRODUCT_SCHEMA.categories,
  fieldsByCategory: PRODUCT_SCHEMA.categories.reduce((acc, cat) => {
    acc[cat] = getFieldsByCategory(cat).length;
    return acc;
  }, {} as Record<string, number>)
};
