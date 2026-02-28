/**
 * Standardized Entity (Company) Schema
 *
 * This schema defines canonical field names for company/entity-level data
 * extracted from supplier questionnaires. These are reusable answers that
 * apply across all products from a supplier.
 */

import { FieldType, FieldDefinition } from './product-schema.js';

export interface EntitySchema {
  version: string;
  categories: string[];
  fields: FieldDefinition[];
}

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

export const ENTITY_SCHEMA: EntitySchema = {
  version: '1.0.0',
  categories: [
    'company_info',
    'contacts',
    'financial',
    'certifications',
    'quality_systems',
    'food_safety',
    'audits',
    'training',
    'facilities',
    'social_compliance',
    'sustainability',
    'crisis_management',
    'traceability'
  ],
  fields: [
    // ========================================================================
    // COMPANY INFORMATION
    // ========================================================================
    {
      canonical: 'company_name',
      type: 'string',
      category: 'company_info',
      description: 'Legal company name',
      required: true,
      aliases: [
        'Company Name',
        'Supplier Name',
        'Bedrijfsnaam',
        'Company',
        'Supplier (company name)',
        'Company Production Plant',
        'Manufacturing site name',
        'Raison sociale'
      ]
    },
    {
      canonical: 'company_address_street',
      type: 'string',
      category: 'company_info',
      description: 'Street address',
      aliases: [
        'Street',
        'Address',
        'Adres',
        'Supplier Address Head Office',
        'Full address of Manufacturing site',
        'Rue'
      ]
    },
    {
      canonical: 'company_address_postcode',
      type: 'string',
      category: 'company_info',
      description: 'Postal/ZIP code',
      aliases: [
        'Post Code',
        'Postal Code',
        'Postcode',
        'Postcode, plaats, land',
        'ZIP Code',
        'Code postal'
      ]
    },
    {
      canonical: 'company_address_city',
      type: 'string',
      category: 'company_info',
      description: 'City',
      aliases: [
        'City',
        'Plaats',
        'Town',
        'Ville'
      ]
    },
    {
      canonical: 'company_address_country',
      type: 'string',
      category: 'company_info',
      description: 'Country',
      aliases: [
        'Country',
        'Land',
        'State',
        'Pays'
      ]
    },
    {
      canonical: 'company_website',
      type: 'string',
      category: 'company_info',
      description: 'Company website URL',
      aliases: [
        'Website',
        'Web',
        'Site web'
      ]
    },
    {
      canonical: 'company_established',
      type: 'string',
      category: 'company_info',
      description: 'Year company was established',
      aliases: [
        'When was the company established?',
        'Year established',
        'Founded',
        'Année de création'
      ]
    },
    {
      canonical: 'company_type',
      type: 'enum',
      category: 'company_info',
      description: 'Company type (private/limited/public)',
      enumValues: ['private', 'limited', 'public', 'partnership'],
      aliases: [
        'Is the company Private/Limited/Public?',
        'Company type',
        'Legal form',
        'Forme juridique'
      ]
    },
    {
      canonical: 'company_parent',
      type: 'string',
      category: 'company_info',
      description: 'Parent company name if part of a group',
      aliases: [
        'If part of a group please note parent company',
        'Parent company',
        'Group',
        'Maison mère'
      ]
    },
    {
      canonical: 'company_part_of_group',
      type: 'boolean',
      category: 'company_info',
      description: 'Is company part of a group',
      aliases: [
        'Is your company part of a group?',
        'Part of group'
      ]
    },
    {
      canonical: 'company_stock_listed',
      type: 'boolean',
      category: 'company_info',
      description: 'Is company listed on stock market',
      aliases: [
        'Is your company listed on the stock market?',
        'Listed',
        'Cotée en bourse'
      ]
    },
    {
      canonical: 'company_subsidiaries',
      type: 'boolean',
      category: 'company_info',
      description: 'Has subsidiaries that can be included in approval',
      aliases: [
        'Does the company have subsidiaries (>50% stake) that can be included in supplier approval?'
      ]
    },
    {
      canonical: 'company_activities',
      type: 'string',
      category: 'company_info',
      description: 'Main business activities',
      aliases: [
        'Bedrijfsactiviteiten',
        'Business activities',
        'Main activities',
        'Activités principales'
      ]
    },
    {
      canonical: 'company_business_type',
      type: 'enum',
      category: 'company_info',
      description: 'Type of business (manufacturer/retailer)',
      enumValues: ['manufacturer', 'producer', 'retailer', 'distributor', 'trader'],
      aliases: [
        'Are you a manufacturer or retailer?',
        'Type of business',
        'Business type'
      ]
    },
    {
      canonical: 'company_employees',
      type: 'string',
      category: 'company_info',
      description: 'Number of employees',
      aliases: [
        'Number of employees',
        'Employees',
        'Staff count',
        'Nombre d\'employés'
      ]
    },
    {
      canonical: 'company_factories_count',
      type: 'string',
      category: 'company_info',
      description: 'Number of factories/production sites',
      aliases: [
        'Number of factories/production sites from which you supply Dairygold?',
        'Number of sites',
        'Production sites'
      ]
    },
    {
      canonical: 'company_org_chart',
      type: 'boolean',
      category: 'company_info',
      description: 'Has organizational chart with deputization',
      aliases: [
        'Does the company have an organizational chart including staff cover/deputisation?',
        'Organizational chart available'
      ]
    },
    {
      canonical: 'company_eu_number',
      type: 'string',
      category: 'company_info',
      description: 'EU approval/identification number',
      aliases: [
        'EG-nummer',
        'EU number',
        'EC number',
        'Healthmark',
        'Health mark',
        'Numéro CEE'
      ]
    },
    {
      canonical: 'company_vat_number',
      type: 'string',
      category: 'company_info',
      description: 'VAT/Tax identification number',
      aliases: [
        'Tax number',
        'VAT number',
        'BTW nummer',
        'Numéro TVA'
      ]
    },

    // ========================================================================
    // CONTACTS
    // ========================================================================
    {
      canonical: 'contact_main_name',
      type: 'string',
      category: 'contacts',
      description: 'Main contact person name',
      aliases: [
        'Contactpersoon',
        'Contact person',
        'Name contact person',
        'Name',
        'Personne de contact'
      ]
    },
    {
      canonical: 'contact_main_position',
      type: 'string',
      category: 'contacts',
      description: 'Main contact person position',
      aliases: [
        'Functie',
        'Position',
        'Title',
        'Job title',
        'Fonction'
      ]
    },
    {
      canonical: 'contact_main_phone',
      type: 'string',
      category: 'contacts',
      description: 'Main contact telephone',
      aliases: [
        'Telefoonnummer',
        'Telephone',
        'Phone',
        'Phone contact person',
        'Téléphone'
      ]
    },
    {
      canonical: 'contact_main_mobile',
      type: 'string',
      category: 'contacts',
      description: 'Main contact mobile phone',
      aliases: [
        'Mobile',
        'Mobile phone',
        'Cell phone',
        'Portable'
      ]
    },
    {
      canonical: 'contact_main_email',
      type: 'string',
      category: 'contacts',
      description: 'Main contact email',
      aliases: [
        'Email-adres',
        'E-mail',
        'Email',
        'E-mail address contact person',
        'Email address contact person'
      ]
    },
    {
      canonical: 'contact_main_fax',
      type: 'string',
      category: 'contacts',
      description: 'Main contact fax',
      aliases: [
        'Fax',
        'Fax number'
      ]
    },
    {
      canonical: 'contact_general_email',
      type: 'string',
      category: 'contacts',
      description: 'General company email',
      aliases: [
        'General e-mail address',
        'General email',
        'Info email'
      ]
    },
    {
      canonical: 'contact_sales_name',
      type: 'string',
      category: 'contacts',
      description: 'Sales contact name',
      aliases: [
        'Contact person for sales',
        'Sales contact'
      ]
    },
    {
      canonical: 'contact_sales_phone',
      type: 'string',
      category: 'contacts',
      description: 'Sales contact phone',
      aliases: [
        'Phone number sales'
      ]
    },
    {
      canonical: 'contact_sales_email',
      type: 'string',
      category: 'contacts',
      description: 'Sales contact email',
      aliases: [
        'Email address sales'
      ]
    },
    {
      canonical: 'contact_quality_name',
      type: 'string',
      category: 'contacts',
      description: 'Quality contact name',
      aliases: [
        'Contact person quality management',
        'QA contact',
        'Quality manager'
      ]
    },
    {
      canonical: 'contact_quality_phone',
      type: 'string',
      category: 'contacts',
      description: 'Quality contact phone',
      aliases: [
        'Phone number quality management'
      ]
    },
    {
      canonical: 'contact_quality_email',
      type: 'string',
      category: 'contacts',
      description: 'Quality contact email',
      aliases: [
        'Email address quality management'
      ]
    },
    {
      canonical: 'contact_accounting_name',
      type: 'string',
      category: 'contacts',
      description: 'Accounting contact name',
      aliases: [
        'Contact for accounting'
      ]
    },
    {
      canonical: 'contact_accounting_phone',
      type: 'string',
      category: 'contacts',
      description: 'Accounting contact phone',
      aliases: [
        'Phone number accounting'
      ]
    },
    {
      canonical: 'contact_accounting_email',
      type: 'string',
      category: 'contacts',
      description: 'Accounting contact email',
      aliases: [
        'Email address accounting'
      ]
    },
    {
      canonical: 'contact_sustainability_name',
      type: 'string',
      category: 'contacts',
      description: 'Sustainability contact name',
      aliases: [
        'Sustainability contact person name'
      ]
    },
    {
      canonical: 'contact_sustainability_phone',
      type: 'string',
      category: 'contacts',
      description: 'Sustainability contact phone',
      aliases: [
        'Sustainability contact person phone',
        'Sustainability contact person mobile phone'
      ]
    },
    {
      canonical: 'contact_sustainability_email',
      type: 'string',
      category: 'contacts',
      description: 'Sustainability contact email',
      aliases: [
        'Sustainability contact person email'
      ]
    },
    {
      canonical: 'contact_emergency_1_name',
      type: 'string',
      category: 'contacts',
      description: 'Emergency contact 1 name',
      aliases: [
        'Emergency contact name',
        'Name (Emergency Contact 1)'
      ]
    },
    {
      canonical: 'contact_emergency_1_phone',
      type: 'string',
      category: 'contacts',
      description: 'Emergency contact 1 phone',
      aliases: [
        'Emergency contact phone',
        'Telephone (Emergency Contact 1)'
      ]
    },
    {
      canonical: 'contact_emergency_1_email',
      type: 'string',
      category: 'contacts',
      description: 'Emergency contact 1 email',
      aliases: [
        'Emergency contact email',
        'E-mail (Emergency Contact 1)'
      ]
    },
    {
      canonical: 'contact_emergency_2_name',
      type: 'string',
      category: 'contacts',
      description: 'Emergency contact 2 name',
      aliases: [
        'Name (Emergency Contact 2)'
      ]
    },
    {
      canonical: 'contact_emergency_2_phone',
      type: 'string',
      category: 'contacts',
      description: 'Emergency contact 2 phone',
      aliases: [
        'Telephone (Emergency Contact 2)'
      ]
    },
    {
      canonical: 'contact_emergency_2_email',
      type: 'string',
      category: 'contacts',
      description: 'Emergency contact 2 email',
      aliases: [
        'E-mail (Emergency Contact 2)'
      ]
    },

    // ========================================================================
    // FINANCIAL
    // ========================================================================
    {
      canonical: 'financial_bank_iban',
      type: 'string',
      category: 'financial',
      description: 'Bank account IBAN',
      aliases: [
        'Bank details (IBAN)',
        'IBAN'
      ]
    },
    {
      canonical: 'financial_bank_bic',
      type: 'string',
      category: 'financial',
      description: 'Bank BIC/SWIFT code',
      aliases: [
        'Bank details (BIC)',
        'BIC',
        'SWIFT'
      ]
    },
    {
      canonical: 'financial_turnover_above_threshold',
      type: 'boolean',
      category: 'financial',
      description: 'Annual turnover above threshold (e.g., 36M EUR)',
      aliases: [
        'Is your annual turnover euro 36M or more'
      ]
    },
    {
      canonical: 'financial_liability_insurance',
      type: 'boolean',
      category: 'financial',
      description: 'Has product/public liability insurance',
      aliases: [
        'Do you have full product/ingredient/ public liability insurance cover?',
        'The supplier hereby declares that a product liability insurance policy exists in an adequate amount',
        'Liability insurance'
      ]
    },
    {
      canonical: 'financial_insurance_name',
      type: 'string',
      category: 'financial',
      description: 'Insurance company name',
      aliases: [
        'Name of the insurer',
        'Insurance company',
        'Insurer'
      ]
    },
    {
      canonical: 'financial_insurance_limit',
      type: 'string',
      category: 'financial',
      description: 'Insurance coverage limit',
      aliases: [
        'Insured Limit euro',
        'Insurance limit',
        'Coverage amount'
      ]
    },
    {
      canonical: 'financial_insurance_expiry',
      type: 'date',
      category: 'financial',
      description: 'Insurance policy expiry date',
      aliases: [
        'Expiry',
        'Insurance expiry',
        'Policy expiry date'
      ]
    },
    {
      canonical: 'financial_insurance_certificate',
      type: 'string',
      category: 'financial',
      description: 'Insurance certificate attachment',
      aliases: [
        'Liability insurance cover attachment (Question 70)'
      ]
    },

    // ========================================================================
    // CERTIFICATIONS
    // ========================================================================
    {
      canonical: 'cert_gfsi_type',
      type: 'string',
      category: 'certifications',
      description: 'GFSI-recognized certification type',
      aliases: [
        'Do you hold any of the following GFSI-recognised certifications?',
        'GFSI certification',
        'Food safety certification'
      ]
    },
    {
      canonical: 'cert_brc',
      type: 'boolean',
      category: 'certifications',
      description: 'BRC certification',
      aliases: [
        'BRC certified',
        'BRCGS'
      ]
    },
    {
      canonical: 'cert_ifs',
      type: 'boolean',
      category: 'certifications',
      description: 'IFS certification',
      aliases: [
        'IFS certified',
        'IFS Food'
      ]
    },
    {
      canonical: 'cert_fssc22000',
      type: 'boolean',
      category: 'certifications',
      description: 'FSSC 22000 certification',
      aliases: [
        'FSSC 22000 certified',
        'FSSC22000'
      ]
    },
    {
      canonical: 'cert_iso22000',
      type: 'boolean',
      category: 'certifications',
      description: 'ISO 22000 certification',
      aliases: [
        'ISO 22000 certified',
        'ISO22000'
      ]
    },
    {
      canonical: 'cert_organic',
      type: 'boolean',
      category: 'certifications',
      description: 'Organic certification',
      aliases: [
        'Is there an organic certification?',
        'Organic certified',
        'Bio certified'
      ]
    },
    {
      canonical: 'cert_organic_body',
      type: 'string',
      category: 'certifications',
      description: 'Organic certification body',
      aliases: [
        'Organic certification body',
        'Bio control body'
      ]
    },
    {
      canonical: 'cert_halal',
      type: 'boolean',
      category: 'certifications',
      description: 'Halal certification',
      aliases: [
        'Halal certified'
      ]
    },
    {
      canonical: 'cert_kosher',
      type: 'boolean',
      category: 'certifications',
      description: 'Kosher certification',
      aliases: [
        'Kosher certified'
      ]
    },
    {
      canonical: 'cert_other',
      type: 'string',
      category: 'certifications',
      description: 'Other certifications',
      aliases: [
        'Are there any other certifications?',
        'Other certifications'
      ]
    },
    {
      canonical: 'cert_supplier_organic_certs',
      type: 'boolean',
      category: 'certifications',
      description: 'Organic certificates available from raw material suppliers',
      aliases: [
        'Are certificates according to Regulation (EC) No. 834/2007 available from each supplier/grower of organic raw materials?'
      ]
    },

    // ========================================================================
    // QUALITY SYSTEMS
    // ========================================================================
    {
      canonical: 'quality_purchasing_specs',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Quality ensured through purchasing specifications',
      aliases: [
        'Is quality ensured through own purchasing specifications?'
      ]
    },
    {
      canonical: 'quality_suppliers_audited',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Suppliers are audited and evaluated',
      aliases: [
        'Are suppliers audited and evaluated?'
      ]
    },
    {
      canonical: 'quality_packaging_compliance',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Packaging compliance declarations available (EC 1935/2004, EU 10/2011)',
      aliases: [
        'Are declarations of compliance for packaging and (printed) materials according to Regulation (EC) No 1935/2004 as amended and Regulation (EU) No 10/2011 as amended available?'
      ]
    },
    {
      canonical: 'quality_logistics_certified',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Logisticians subject to quality management',
      aliases: [
        'Are all logisticians and freight forwarders subject to a quality management system?'
      ]
    },
    {
      canonical: 'quality_own_laboratory',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Has own laboratory',
      aliases: [
        'Does the company have its own laboratory?'
      ]
    },
    {
      canonical: 'quality_risk_analysis_plan',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Has risk-based analysis plan',
      aliases: [
        'Is there a risk-based analysis plan that specifies the frequency and type of analyses?'
      ]
    },
    {
      canonical: 'quality_incoming_inspection',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Incoming goods inspection performed',
      aliases: [
        'Are incoming goods inspections carried out on delivery?'
      ]
    },
    {
      canonical: 'quality_outgoing_inspection',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Outgoing goods inspection performed',
      aliases: [
        'Are outgoing goods inspections carried out? What parameters are taken into account?'
      ]
    },
    {
      canonical: 'quality_retained_raw_materials',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Retained samples of raw materials kept',
      aliases: [
        'Are retained samples of raw materials kept? If yes, for how long?'
      ]
    },
    {
      canonical: 'quality_retained_finished_goods',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Retained samples of finished goods kept',
      aliases: [
        'Are retained samples of finished goods kept? If yes, for how long?'
      ]
    },
    {
      canonical: 'quality_batch_testing',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Every production batch sampled and tested',
      aliases: [
        'Is at least every production batch sampled and tested once?'
      ]
    },
    {
      canonical: 'quality_product_specification',
      type: 'boolean',
      category: 'quality_systems',
      description: 'Product specification for every item',
      aliases: [
        'Is there a product specification for every item produced?'
      ]
    },

    // ========================================================================
    // FOOD SAFETY / HACCP
    // ========================================================================
    {
      canonical: 'haccp_concept',
      type: 'boolean',
      category: 'food_safety',
      description: 'HACCP concept with risk analysis exists',
      aliases: [
        'Is there an HACCP concept, including a risk analysis, which can be inspected if required?'
      ]
    },
    {
      canonical: 'haccp_flow_diagrams',
      type: 'boolean',
      category: 'food_safety',
      description: 'Flow diagrams with CCPs available',
      aliases: [
        'Are there flow diagrams (incl. critical control points) that can be inspected if required?'
      ]
    },
    {
      canonical: 'haccp_gmo_used',
      type: 'boolean',
      category: 'food_safety',
      description: 'GMOs used in company',
      aliases: [
        'Are genetically modified organisms used in the company?'
      ]
    },
    {
      canonical: 'haccp_ionizing_radiation',
      type: 'boolean',
      category: 'food_safety',
      description: 'Products exposed to ionizing radiation',
      aliases: [
        'Are products or ingredients exposed to ionising radiation?'
      ]
    },
    {
      canonical: 'haccp_foreign_body_prevention',
      type: 'boolean',
      category: 'food_safety',
      description: 'Foreign body prevention measures in place',
      aliases: [
        'Are there measures for foreign body prevention?'
      ]
    },
    {
      canonical: 'haccp_food_defense',
      type: 'boolean',
      category: 'food_safety',
      description: 'Food defense risk analysis exists',
      aliases: [
        'Is there a risk analysis regarding food defence?'
      ]
    },
    {
      canonical: 'haccp_food_fraud',
      type: 'boolean',
      category: 'food_safety',
      description: 'Food fraud assessment exists',
      aliases: [
        'Is there an assessment regarding food fraud?'
      ]
    },
    {
      canonical: 'haccp_allergen_storage',
      type: 'boolean',
      category: 'food_safety',
      description: 'Allergen-containing materials stored separately',
      aliases: [
        'Are raw materials containing allergens stored separately from allergen-free raw materials?'
      ]
    },
    {
      canonical: 'haccp_allergen_separation',
      type: 'boolean',
      category: 'food_safety',
      description: 'Allergen processing separated',
      aliases: [
        'Is the processing of allergen-containing and allergen-free products separated in space or time to prevent cross-contamination?'
      ]
    },
    {
      canonical: 'haccp_organic_storage',
      type: 'boolean',
      category: 'food_safety',
      description: 'Organic raw materials stored separately',
      aliases: [
        'Are organic raw materials stored separately from conventional ones?'
      ]
    },
    {
      canonical: 'haccp_organic_separation',
      type: 'boolean',
      category: 'food_safety',
      description: 'Organic processing separated',
      aliases: [
        'Is the processing of organic and conventional products separated in space or time?'
      ]
    },

    // ========================================================================
    // AUDITS
    // ========================================================================
    {
      canonical: 'audit_site_inspections',
      type: 'boolean',
      category: 'audits',
      description: 'Regular site inspections take place',
      aliases: [
        'Do regular inspections of the site take place?'
      ]
    },
    {
      canonical: 'audit_internal_audits',
      type: 'boolean',
      category: 'audits',
      description: 'Internal audits performed regularly',
      aliases: [
        'Do internal audits take place on a regular basis?'
      ]
    },
    {
      canonical: 'audit_unannounced_allowed',
      type: 'boolean',
      category: 'audits',
      description: 'Unannounced audits allowed',
      aliases: [
        'The supplier hereby agrees to allow Stiegl to conduct unannounced audits at its premises if required'
      ]
    },

    // ========================================================================
    // TRAINING
    // ========================================================================
    {
      canonical: 'training_employees_regular',
      type: 'boolean',
      category: 'training',
      description: 'Employees regularly trained (hygiene, GHP, HACCP)',
      aliases: [
        'Are the employees regularly trained (hygiene, GHP, HACCP, infection control)?'
      ]
    },

    // ========================================================================
    // FACILITIES / EQUIPMENT
    // ========================================================================
    {
      canonical: 'equipment_calibration',
      type: 'boolean',
      category: 'facilities',
      description: 'Test equipment regularly calibrated',
      aliases: [
        'Is test equipment regularly calibrated?'
      ]
    },
    {
      canonical: 'equipment_suitable_materials',
      type: 'boolean',
      category: 'facilities',
      description: 'Operating materials suitable for use (H1 lubricants)',
      aliases: [
        'Are all operating and auxiliary materials used suitable for the intended use? (e.g .: use of H1 lubricants)'
      ]
    },
    {
      canonical: 'equipment_cleaning_suitable',
      type: 'boolean',
      category: 'facilities',
      description: 'Cleaning agents suitable for use',
      aliases: [
        'Are all cleaning agents and disinfectants used suitable for the intended use?'
      ]
    },
    {
      canonical: 'equipment_maintenance',
      type: 'boolean',
      category: 'facilities',
      description: 'Maintenance at designated intervals',
      aliases: [
        'Is maintenance carried out at the designated intervals?'
      ]
    },
    {
      canonical: 'equipment_pest_control',
      type: 'boolean',
      category: 'facilities',
      description: 'Pest monitoring measures in place',
      aliases: [
        'Are there pest monitoring measures?'
      ]
    },

    // ========================================================================
    // CRISIS MANAGEMENT
    // ========================================================================
    {
      canonical: 'crisis_complaints_system',
      type: 'boolean',
      category: 'crisis_management',
      description: 'System for dealing with complaints',
      aliases: [
        'Is there a system for dealing with complaints?'
      ]
    },
    {
      canonical: 'crisis_emergency_plan',
      type: 'boolean',
      category: 'crisis_management',
      description: 'Emergency/crisis plan exists',
      aliases: [
        'Is there a system for dealing with crisis situations/an emergency plan?'
      ]
    },
    {
      canonical: 'crisis_past_recalls',
      type: 'boolean',
      category: 'crisis_management',
      description: 'Past recalls or complaints in last 5 years',
      aliases: [
        'Have there been any official complaints, recalls or other cases of non-conformity within the last five years?'
      ]
    },

    // ========================================================================
    // TRACEABILITY
    // ========================================================================
    {
      canonical: 'traceability_system',
      type: 'boolean',
      category: 'traceability',
      description: 'Full traceability system in place',
      aliases: [
        'Is there a functioning system to ensure full traceability?'
      ]
    },
    {
      canonical: 'traceability_reviewed',
      type: 'boolean',
      category: 'traceability',
      description: 'Traceability system regularly reviewed',
      aliases: [
        'Is the traceability system regularly reviewed?'
      ]
    },

    // ========================================================================
    // SOCIAL COMPLIANCE
    // ========================================================================
    {
      canonical: 'social_sedex_member',
      type: 'boolean',
      category: 'social_compliance',
      description: 'SEDEX member',
      aliases: [
        'SEDEX member',
        'Sedex membership'
      ]
    },
    {
      canonical: 'social_smeta_audit',
      type: 'boolean',
      category: 'social_compliance',
      description: 'SMETA audit completed',
      aliases: [
        'SMETA audit',
        'SMETA certified'
      ]
    },
    {
      canonical: 'social_laws_compliance',
      type: 'boolean',
      category: 'social_compliance',
      description: 'Complies with all relevant laws',
      aliases: [
        'The supplier hereby declares that it knows, observes and complies with all relevant laws and regulations of the countries in which its company operates'
      ]
    },

    // ========================================================================
    // SIGNATURE / DECLARATION
    // ========================================================================
    {
      canonical: 'declaration_date',
      type: 'date',
      category: 'declaration',
      description: 'Date of declaration/signature',
      aliases: [
        'Date',
        'Signature date',
        'Declaration date'
      ]
    },
    {
      canonical: 'declaration_signatory',
      type: 'string',
      category: 'declaration',
      description: 'Name/stamp of signatory',
      aliases: [
        'Stamp and Signature of the supplier',
        'Signature',
        'Signatory'
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
export function buildEntityAliasMap(): Map<string, string> {
  const map = new Map<string, string>();

  for (const field of ENTITY_SCHEMA.fields) {
    map.set(field.canonical.toLowerCase(), field.canonical);
    for (const alias of field.aliases) {
      map.set(alias.toLowerCase(), field.canonical);
    }
  }

  return map;
}

/**
 * Normalize a label to its canonical form
 */
export function normalizeEntityLabel(label: string, aliasMap?: Map<string, string>): string | null {
  const map = aliasMap ?? buildEntityAliasMap();
  return map.get(label.toLowerCase().trim()) ?? null;
}

/**
 * Get field definition by canonical name
 */
export function getEntityFieldDefinition(canonical: string): FieldDefinition | undefined {
  return ENTITY_SCHEMA.fields.find(f => f.canonical === canonical);
}

/**
 * Get all fields for a category
 */
export function getEntityFieldsByCategory(category: string): FieldDefinition[] {
  return ENTITY_SCHEMA.fields.filter(f => f.category === category);
}

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

export const ENTITY_SCHEMA_SUMMARY = {
  totalFields: ENTITY_SCHEMA.fields.length,
  categories: ENTITY_SCHEMA.categories,
  fieldsByCategory: ENTITY_SCHEMA.categories.reduce((acc, cat) => {
    acc[cat] = getEntityFieldsByCategory(cat).length;
    return acc;
  }, {} as Record<string, number>)
};
