# Questionnaire Processing Pipeline v2

## Goals

1. **Separate Content Types**: Distinguish what goes WHERE (Answer Library, Entity DB, Specification, Log)
2. **Better Section Extraction**: Preserve questionnaire structure for context
3. **Configurable Rules**: YAML-based rules that can be iterated on
4. **Human Review Workflow**: Markdown output for review, approval feeds back into system
5. **Learning Loop**: Approved answers become reusable for future questionnaires

---

## Output Destinations

| Destination | Purpose | What Goes Here |
|-------------|---------|----------------|
| **Answer Library** | Reusable approved answers | Procedural answers, policy statements, standard formulations |
| **Entity DB** | Structured entity data | Company name, address, contacts, registration numbers, cert details |
| **Product Specs** | Product-specific data | Composition, allergens, nutritional, analytical values |
| **Questionnaire Log** | Audit trail | WHO said WHAT to WHOM, WHEN (customer-specific context) |

---

## Processing Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INPUT: Questionnaire                         │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: Structure Extraction                                       │
│  - Detect sections/chapters                                         │
│  - Build hierarchy (nested questions)                               │
│  - Identify conditional questions                                   │
│  - Extract metadata (customer, date, version)                       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: Topic Classification (per question)                        │
│  - Match to 1 of 33 topics (from rules.yaml)                        │
│  - Determine entity level (Group/Company/Site/Product/ProductGroup) │
│  - Identify evidence type needed                                    │
│  - Route to data source                                             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: Answer Analysis                                            │
│  - Is this a reusable answer? (procedural, policy)                  │
│  - Is this entity data? (address, cert number)                      │
│  - Is this product-specific? (composition, specs)                   │
│  - Is this customer-specific? (commitments, promises)               │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 4: Output Generation                                          │
│  - Markdown file for human review                                   │
│  - Structured YAML for machine processing                           │
│  - Separate sections by destination                                 │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 5: Human Review                                               │
│  - Review in Markdown (easy to read/edit)                           │
│  - Approve/reject/modify classifications                            │
│  - Add corrections to Answer Library                                │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 6: Learning Loop                                              │
│  - Approved answers → Answer Library                                │
│  - Entity data → Entity DB                                          │
│  - Corrections → improve rules.yaml patterns                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Output Format: Markdown for Review

```markdown
# Questionnaire Extraction: TIPPAGRAL TC01 2025
**Customer:** Tippagral
**Date Received:** 2025-01-30
**Processed:** 2025-02-07

---

## Summary

| Destination | Count | Review Needed |
|-------------|-------|---------------|
| Answer Library | 45 | 3 |
| Entity DB | 28 | 0 |
| Product Specs | 156 | 12 |
| Log Only | 34 | 0 |

---

## Section 1: Company Information

### → Entity DB

| # | Question | Answer | Cell | Status |
|---|----------|--------|------|--------|
| 1 | Company legal name | Tippagral SAS | A5 | ✓ Auto |
| 2 | Address | 123 Rue Example | A6 | ✓ Auto |
| 3 | VAT Number | FR12345678901 | A7 | ✓ Auto |

### → Answer Library (reusable)

| # | Question | Answer | Topic | Status |
|---|----------|--------|-------|--------|
| 4 | Describe your quality policy | We maintain... | Quality Systems | ⚠️ Review |

---

## Section 2: Certifications

### → Entity DB (certificate data)

| # | Question | Answer | Cert Type | Expiry | Status |
|---|----------|--------|-----------|--------|--------|
| 5 | FSSC 22000 certified? | Yes | FSSC 22000 | 2026-03 | ✓ Auto |
| 6 | Certificate number | FSSC-12345 | FSSC 22000 | — | ✓ Auto |

---

## Section 5: Product Specifications

### → Product: EXBERRY Shade Red

| # | Question | Answer | Topic | Status |
|---|----------|--------|-------|--------|
| 45 | Shelf life | 24 months | Shelf Life | ✓ Auto |
| 46 | Storage temperature | 15-25°C | Storage | ✓ Auto |
| 47 | Contains allergens? | None | Allergens | ⚠️ Review |

---

## Flagged for Review

| # | Question | Answer | Reason | Suggested Action |
|---|----------|--------|--------|------------------|
| 4 | Describe your quality policy | We maintain... | New answer pattern | Add to Answer Library? |
| 47 | Contains allergens? | None | Confirm no allergens | Verify against spec |

---

## Log Only (Customer Context)

These items are logged for audit trail but not added to reusable sources:

| # | Question | Answer | Note |
|---|----------|--------|------|
| 89 | Can you guarantee delivery by March? | Yes, confirmed | Customer-specific commitment |
| 90 | Special labeling requirements? | Add customer logo | Customer-specific |
```

---

## Rules File: `rules.yaml`

```yaml
# Questionnaire Processing Rules v1.0

topics:
  - id: company_information
    name: Company Information
    description: Legal details, registration, contact, ownership, structure
    level: [company, group]
    destination: entity_db
    keywords:
      - company name
      - legal name
      - address
      - phone
      - fax
      - email
      - website
      - vat
      - coc
      - chamber of commerce
      - registration
      - founding year
      - ownership
    patterns:
      - "(?i)company.*name"
      - "(?i)legal.*form"
      - "(?i)vat.*(id|number)"

  - id: certifications
    name: Certifications
    description: GFSI, ISO, Organic, Halal, Kosher — certificate data
    level: [company]
    destination: entity_db
    evidence_type: certificate
    keywords:
      - fssc
      - brc
      - ifs
      - iso
      - halal
      - kosher
      - organic
      - certificate
      - certified
      - certification
      - accreditation
    extract_fields:
      - cert_type
      - cert_number
      - valid_until
      - scope
      - certification_body

  - id: quality_systems
    name: Quality Systems
    description: HACCP, food safety management, audits, validation
    level: [company]
    destination: answer_library
    evidence_type: procedure
    keywords:
      - haccp
      - food safety
      - quality management
      - audit
      - validation
      - ccp
      - critical control
    reusable: true

  - id: allergens
    name: Allergens
    description: Allergen declarations, cross-contamination, management
    level: [product, product_group]
    destination: product_spec
    keywords:
      - allergen
      - contains
      - may contain
      - traces
      - cross-contamination
      - gluten
      - milk
      - egg
      - nuts
      - peanut
      - soy
      - sesame
    never_answer_library: true  # Always product-specific

  # ... (33 topics total)

# Routing rules
routing:
  entity_level:
    - company_information → entity_db
    - contact_persons → entity_db
    - certifications → entity_db + evidence_ref
    - quality_systems → answer_library
    - complaints → answer_library
    - traceability → answer_library
    - food_fraud → answer_library
    - food_defense → answer_library
    - foreign_bodies → answer_library
    - sustainability → evidence_ref
    - ethical_social → answer_library

  product_level:
    - identification → product_spec
    - physical_properties → product_spec
    - sensory → product_spec
    - analytical → product_spec
    - formula_composition → product_spec
    - allergens → product_spec
    - nutritional → product_spec
    - contaminants → product_spec
    - gmo → product_spec
    - claims → product_spec
    - packaging → product_spec
    - storage_transport → product_spec
    - coding → product_spec + answer_library
    - origin → product_spec

# Flag conditions
flag_for_review:
  - condition: no_match_found
    message: "No topic match found"
  - condition: low_confidence
    threshold: 0.6
    message: "Low confidence classification"
  - condition: contains_commitment
    patterns:
      - "(?i)guarantee"
      - "(?i)promise"
      - "(?i)we will"
      - "(?i)we can ensure"
    message: "Contains commitment - verify before adding to library"
  - condition: new_answer_pattern
    message: "New answer pattern - review before adding to Answer Library"
  - condition: conflicting_sources
    message: "Conflicting information found"

# Answer format templates
answer_formats:
  yes_no:
    pattern: "(?i)^(yes|no|ja|nein)\\b"
    format: "{answer} — {explanation}"

  numeric:
    pattern: "\\d+(\\.\\d+)?\\s*(mg|kg|%|°C|months?|years?)"
    format: "{value} {unit}"

  certificate_ref:
    format: "See attached {cert_type} certificate, valid until {expiry}"

  not_found:
    format: "Information not found in available sources. [FLAG FOR REVIEW]"
```

---

## Directory Structure

```
./incoming/               # Drop questionnaire files here
./processing/             # Currently being processed
./review/                 # Markdown files awaiting human review
  ├── TIPPAGRAL-2025-01-30.md
  └── MARFO-2025-02-01.md
./approved/               # Human-approved extractions
  ├── TIPPAGRAL-2025-01-30.yaml
  └── MARFO-2025-02-01.yaml
./answer-library/         # Approved reusable answers
  ├── quality_systems.yaml
  ├── certifications.yaml
  └── procedures.yaml
./entity-db/              # Entity data exports
  └── entities.yaml
./logs/                   # Processing logs
./rules/                  # Rules configuration
  ├── topics.yaml
  ├── routing.yaml
  └── patterns.yaml
```

---

## Review Workflow

1. **Process**: `npx tsx src/pipeline/cli.ts process incoming/TIPPAGRAL.xlsx`
2. **Review**: Open `review/TIPPAGRAL-2025-01-30.md` in VS Code / Obsidian
3. **Approve/Edit**:
   - Change `⚠️ Review` to `✓ Approved` or `✗ Rejected`
   - Edit answers if needed
   - Add notes for future learning
4. **Finalize**: `npx tsx src/pipeline/cli.ts approve review/TIPPAGRAL-2025-01-30.md`
5. **Learn**: Approved items flow to Answer Library / Entity DB

---

## Learning Loop

When you approve an answer:

```yaml
# answer-library/quality_systems.yaml

- question_pattern: "describe.*quality.*policy"
  approved_answer: |
    We maintain a comprehensive quality policy focused on...
  topic: quality_systems
  source: TIPPAGRAL-2025-01-30
  approved_by: lars
  approved_date: 2025-02-07
  reuse_count: 0
```

Next questionnaire with similar question:
- Pipeline checks Answer Library first
- Finds match → suggests approved answer
- Human confirms → reuse_count++
- High reuse_count = high confidence auto-fill

---

## Implementation Priority

1. **Phase 1**: Rules engine + Markdown output
   - Implement 33-topic classification
   - Generate Markdown review files
   - Separate by destination

2. **Phase 2**: Review workflow
   - Parse reviewed Markdown
   - Extract approved items
   - Update Answer Library / Entity DB

3. **Phase 3**: Learning loop
   - Pattern matching from approved answers
   - Confidence scoring based on reuse
   - Auto-fill suggestions

---

## Questions for You

1. **Markdown editor**: Do you prefer VS Code, Obsidian, or a web UI for review?
2. **Answer Library format**: YAML files, or should this be a database (SQLite/Postgres)?
3. **Product handling**: How do we know which product a questionnaire is about? Is it in the filename or extracted from content?
4. **Multi-product questionnaires**: Some questionnaires ask about multiple products — handle how?
