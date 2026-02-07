# Questionnaire Extraction Pipeline — Rules

This document defines the categorisation rules, language handling rules, output format specification, and confidence scoring criteria for the questionnaire extraction pipeline.

---

## 1. Categorisation Rules

Every extracted Q&A pair must be assigned to exactly one of three categories:

### 1.1 EntityDB — WHO / WHERE / HOW TO REACH

Identifies **who or where the entity is**, or **how to contact them**.

**Assign to EntityDB when the question asks for:**

| Signal | Examples |
|--------|----------|
| Company identity | Company name, legal form, trade name, parent company, group name |
| Location / address | Street, city, ZIP, country, GPS coordinates, site address |
| Contact details | Phone, fax, email, website, LinkedIn |
| Contact persons | Name + role (e.g., quality manager, managing director, crisis contact) |
| Registration numbers | VAT ID, tax number, DUNS, COID, Sedex ID, EU approval number |
| Financial identifiers | IBAN, BIC/SWIFT, bank name |
| Membership / platform IDs | Ecovadis ID, SMETA registration, customer portal IDs |
| Organisational metadata | Number of employees, founding year, ownership structure (if identifying WHO) |

**Edge cases:**
- "Number of employees" → EntityDB (describes the entity, not a procedure)
- "Year founded" → EntityDB
- "Managing Director name" → EntityDB (contact person)
- "Crisis contact person (Person 1 / Person 2)" → EntityDB, with multi-column answer handling

### 1.2 Procedures — WHAT THEY DO / COMPLY WITH / HAVE CERTIFIED

Describes **what the entity does, complies with, or has been certified for**.

**Assign to Procedures when the question asks for:**

| Signal | Examples |
|--------|----------|
| Certifications | IFS, BRC, FSSC 22000, ISO 9001, ISO 14001, ISO 22000, Halal, Kosher, Bio/Organic |
| Certification details | Certificate number, expiry date, scope, auditing body |
| Food safety measures | HACCP plan, allergen management, pest control, glass/brittle policy |
| Quality management | Complaint handling process, recall procedure, traceability system |
| Sustainability | Carbon footprint policy, water usage policy, waste management, PCF methodology |
| Social compliance | Code of conduct, child labour policy, anti-corruption, human rights |
| Audit consent | "Do you agree to unannounced audits?" |
| Corporate governance | Organisational chart (as procedure/structure), management review process |
| Supplier management | How do you evaluate your suppliers? Do you have a supplier code of conduct? |
| Insurance | Product liability insurance (yes/no, amount, provider) |

**Edge cases:**
- "IFS score" → Procedures (certification detail)
- "Do you have ISO 14001?" → Procedures (certification yes/no)
- "Sustainability report available?" → Procedures
- "Organisational chart" → Procedures (describes corporate structure as a procedure)

### 1.3 Product — SPECIFIC TO A PRODUCT / SKU / INGREDIENT

Anything specific to a **product, SKU, recipe, or ingredient** rather than the entity as a whole.

**Assign to Product when the question asks for:**

| Signal | Examples |
|--------|----------|
| Product identity | Product name, SKU, article number, EAN/GTIN |
| Product specifications | Weight, dimensions, shelf life, storage conditions |
| Ingredients / composition | Ingredient list, allergen declaration per product, recipe |
| Origin per product | Country of origin for THIS product (not company location) |
| Processing details | Pasteurisation, heating temperature, processing method |
| Nutritional information | Nutritional values per 100g, energy, fat, protein |
| Residue / contaminant testing | Pesticide residue per product, heavy metals, mycotoxins |
| Product-specific PCF | Carbon footprint per product/kg |
| Labelling | Label claims, organic/non-GMO per product |
| Packaging | Packaging material, recycling info per product |

**Edge cases:**
- "Country of origin" → **Product** if asking about a specific product; **EntityDB** if asking about the company's country
- "Allergen management policy" → Procedures; "Contains allergens (product X)" → Product
- "GMO-free policy" → Procedures; "Product X GMO status" → Product
- Per-product columns in multi-product questionnaires → Product

### 1.4 Decision Tree

```
Is the question about a specific PRODUCT/SKU/ingredient?
  → YES → Product
  → NO →
    Does it identify WHO/WHERE the entity is, or HOW to contact them?
      → YES → EntityDB
      → NO → Procedures
```

---

## 2. Language Handling Rules

### 2.1 Bilingual Question Detection

Many questionnaires contain bilingual questions (typically DE/EN). Detect by:

- Slash separator: `"Firmenname / Company name"`
- Line break separator: `"Firmenname\nCompany name"`
- Parenthetical: `"Firmenname (Company name)"`
- Separate columns for DE and EN text

**Splitting rules:**
1. Split on ` / ` (space-slash-space) first
2. If no slash, split on `\n` where the second line is clearly a different language
3. If parenthetical, extract inner text as the translation

### 2.2 Answer Language Splitting

| Answer pattern | DE column | EN column |
|---------------|-----------|-----------|
| `ja-yes` | `ja` | `yes` |
| `nein-no` | `nein` | `no` |
| `ja / yes` | `ja` | `yes` |
| `Ja` (German only) | `Ja` | `Yes` (translate) |
| `Yes` (English only) | `Ja` (translate) | `Yes` |
| Language-neutral (name, email, number) | Same value | Same value |
| Free text in German only | Original DE | Translate to EN |
| Free text in English only | Translate to DE | Original EN |
| Empty / blank | (empty) | (empty) |

### 2.3 Language-Neutral Data

The following data types are identical in both DE and EN columns:
- Names (person names, company names)
- Email addresses
- Phone/fax numbers
- URLs/websites
- Numeric values (dates, amounts, counts)
- Codes (VAT IDs, certificate numbers, IBAN, etc.)
- Yes/No when already bilingual in the source

### 2.4 Translation Rules

- Preserve exact original wording — never summarise or paraphrase
- For free-text German answers, provide a faithful English translation
- For technical terms, use industry-standard translations
- Mark translated content with a note in the Notes column: `"[translated from DE]"` or `"[translated from EN]"`

### 2.5 Non-DE/EN Questionnaires

When a questionnaire is in a language other than DE or EN:
- Detect the source language
- Use the source language in the DE column (relabel as "Source Language")
- Translate to EN for the EN column
- Add a note: `"Source language: [language]"`

---

## 3. Output Format Specification

### 3.1 Output File

One `.xlsx` file per input file, saved to `./extracted/`.

Naming convention: `{original-filename}-extracted.xlsx`

### 3.2 Sheet 1: README

| Field | Value |
|-------|-------|
| Pipeline version | 1.0.0 |
| Source file | Original filename |
| Extraction date | ISO 8601 timestamp |
| Total Q&A pairs | Count |
| Categories | EntityDB: N, Procedures: N, Product: N |
| Languages detected | DE, EN (or others) |
| Low-confidence items | Count (see Review sheet) |
| Rules version | Reference to RULES.md commit/version |

Column definitions for the Q&A Data sheet should also be listed here.

### 3.3 Sheet 2: Q&A Data

12 columns:

| # | Column | Description |
|---|--------|-------------|
| 1 | `#` | Sequential row number |
| 2 | `Sheet` | Source sheet name |
| 3 | `Category` | EntityDB / Procedures / Product |
| 4 | `Question (DE)` | German question text |
| 5 | `Question (EN)` | English question text |
| 6 | `Answer (DE)` | German answer text |
| 7 | `Answer (EN)` | English answer text |
| 8 | `Notes (DE)` | German notes/comments from the source |
| 9 | `Notes (EN)` | English notes/comments |
| 10 | `Question Cell` | Cell reference in source file (e.g., `Sheet1!A5`) |
| 11 | `Answer Cell` | Cell reference in source file (e.g., `Sheet1!B5`) |
| 12 | `Comment Cell` | Cell reference for any comment/note |

**Formatting:**
- Header row: frozen, bold, auto-filter enabled
- Category colour coding:
  - EntityDB → Blue fill (`#D6EAF8`)
  - Procedures → Green fill (`#D5F5E3`)
  - Product → Yellow fill (`#FEF9E7`)
- Include ALL Q&A pairs, including those with blank answers
- Sort by: Sheet → Row number (preserve source order)

### 3.4 Sheet 3: Review

Only contains low-confidence items that need human review.

| Column | Description |
|--------|-------------|
| `#` | Reference to Q&A Data row number |
| `Question` | Question text (EN) |
| `Current Category` | Assigned category |
| `Confidence` | HIGH / MEDIUM / LOW |
| `Reason` | Why this was flagged |
| `Suggested Action` | What the reviewer should check |
| `Reviewer Decision` | (blank — for human to fill) |

---

## 4. Confidence Scoring

### 4.1 Levels

| Level | Threshold | Meaning |
|-------|-----------|---------|
| HIGH | ≥ 0.80 | Clear match to categorisation rules, no ambiguity |
| MEDIUM | 0.50 – 0.79 | Fits a rule but could be an edge case |
| LOW | < 0.50 | Ambiguous, requires human review |

### 4.2 Scoring Signals

**Positive signals (increase confidence):**
- Question contains strong category keywords (e.g., "company name" → EntityDB +0.30)
- Answer format matches expected type (e.g., email address for a contact field +0.20)
- Surrounding questions are in the same category (context agreement +0.10)
- Question matches a known pattern from previous extractions (+0.20)

**Negative signals (decrease confidence):**
- Question could belong to multiple categories (-0.20)
- Question is very short or generic (e.g., just "Name:") (-0.15)
- Answer is empty and question is ambiguous (-0.10)
- Conditional question ("only if Q2.1 = yes") — still categorise but flag (-0.10)

### 4.3 Flagging Rules

Flag for review when:
- Confidence < 0.50
- Question mentions multiple categories (e.g., "Product liability insurance" touches both Procedures and Product)
- Conditional question detected
- Multi-plant answer columns detected (need to verify plant mapping)
- Translation uncertainty (free text with domain-specific terms)

---

## 5. Special Handling

### 5.1 Multi-Column Answers

Some questionnaires have multiple answer columns (e.g., Plant 1, Plant 2, Plant 3 or Person 1, Person 2).

- Extract each column as a separate Q&A row
- Add column identifier to the Notes field: `"Plant 1"`, `"Person 2"`, etc.
- Keep the same question text for all columns
- Category stays the same across columns

### 5.2 Conditional Questions

Questions like "If yes, please specify:" or "Only if Q2.1 = yes":

- Extract the conditional question as a separate Q&A pair
- Add the condition to the Notes field: `"Condition: Q2.1 = yes"`
- Categorise based on the question content, not the condition

### 5.3 Section Headers

Section headers in the source (e.g., "1. General Information", "2. Quality Management"):

- Do NOT extract as Q&A pairs
- Use them to inform categorisation context
- Record the section name in the Notes field for each Q&A pair in that section

### 5.4 Protected / Locked Sheets

- Read values using data_only mode (ExcelJS handles this)
- If a sheet is password-protected and unreadable, log the error and skip
- Record in the processing log which sheets were skipped

### 5.5 Merged Cells

- Use the master cell (top-left) as the reference
- Record the full merge range in the cell reference (e.g., `Sheet1!B5:D5`)
- Handle merged question cells that span multiple answer rows
