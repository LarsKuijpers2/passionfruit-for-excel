# Questionnaire Extraction Pipeline — Approach

## The Problem

We receive supplier questionnaires from customers (Tippagral, F+S, Marfo, etc.) in Excel format. These questionnaires:
- Have different layouts, languages (DE/FR/NL/EN), and structures
- Ask about company info, certifications, allergens, food safety, sustainability, etc.
- Need to be filled repeatedly with similar information

## The Goal

1. **Extract & understand** incoming questionnaires (preserve structure, detect Q&A pairs)
2. **Build an answer library** of reusable entity-level answers (company name, certifications, contacts — things that don't change per product)
3. **Auto-fill future questionnaires** by matching questions to known answers
4. **Keep product-level answers** as reference for similar products

---

## Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         INCOMING                                 │
│                    (Excel questionnaire)                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. STORE                                                        │
│     - Extract Excel structure (sheets, rows, cells, formatting)  │
│     - Preserve merged cells, colors, borders                     │
│     - Detect cell roles (header, label, input, value)            │
│     - Output: questionnaires/*.json                              │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. INDEX                                                        │
│     - Claude AI analyzes layout using extraction rules           │
│     - Identifies items (fields, tables, yes/no, text, etc.)      │
│     - Organizes by section/topic                                 │
│     - Classifies: standard / narrative / product                 │
│     - Clean extraction, no translations (happens in HARVEST)     │
│     - Output: indexed/*.yaml                                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. HARVEST                                                      │
│     - Extract standard + narrative items (reusable)              │
│     - Add English translations for searchability                 │
│     - Add context/interpretation for library use                 │
│     - Deduplicate across questionnaires                          │
│     - Group by topic                                             │
│     - Output: answer-library.yaml                                │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. REVIEW                                                       │
│     - Human reviews harvested answers                            │
│     - Approve / Reject / Edit                                    │
│     - Output: approved-answers.yaml                              │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. FILL                                                         │
│     - New questionnaire comes in                                 │
│     - Match questions to approved answers                        │
│     - Auto-fill or suggest answers                               │
│     - Human reviews & submits                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### Items (not "Questions")

Not everything in a questionnaire is a question. We extract **items** with different types:

| Type | Use for | Example |
|------|---------|---------|
| `field` | Simple label/value pairs | Company name, address, phone |
| `text` | Longer text responses | Policy descriptions, explanations |
| `yesno` | Yes/No choices | "Do you have HACCP?" → "Yes" |
| `choice` | Dropdown/selection | Certification type selection |
| `table` | Tabular data (kept as one piece) | Allergen declaration matrix |
| `signature` | Signature fields | Name + signature |
| `date` | Date fields | Certification expiry dates |

**Why this matters:** A table of allergens is not 14 separate items — it's one piece of evidence. The whole table should be stored and reused together.

### Levels: Standard vs Narrative vs Product

| Level | Description | Auto-fillable? | Examples |
|-------|-------------|----------------|----------|
| `standard` | Factual company data | Yes, from database | Company name, address, cert numbers |
| `narrative` | Descriptive company info | No, needs review | Quality policies, procedures |
| `product` | Product-specific | No, changes per product | Ingredients, allergens, shelf life |

### Indexed YAML Format

The INDEX step produces clean YAML files. No translations — those happen during HARVEST.

```yaml
id: 425633e0
source: 20241112 RL14-1 Questionnaire Quality Fraude Environment_Marfo.xlsx
indexed: 2026-02-08
language: nl

sections:
  - title: Algemene informatie
    topic: company
    rows: 8-17
    items:
      # Simple field (label + value in separate cells)
      - type: field
        label: Contactpersoon
        value: I. Vegter
        lCell: A11
        vCell: C11
        level: standard
        lang: nl

      # Narrative text response
      - type: text
        label: Welke kwaliteitsstandaarden zijn in werking?
        value: VLOG en Weidegang
        lCell: A21
        vCell: C21
        level: narrative
        lang: nl

      # Yes/No choice
      - type: yesno
        label: Is er een Food Fraude-analyse uitgevoerd?
        value: Ja
        lCell: A35
        vCell: C35
        level: product
        lang: nl

      # Table kept as single evidence piece
      - type: table
        label: Allergenen declaratie
        ref: A30:E45
        level: product
        lang: nl

stats:
  total: 27
  answered: 27
  standard: 15
  narrative: 6
  product: 6
```

**Field reference formats:**
- `lCell` + `vCell` — Label and value in separate cells
- `ref` — Single range for tables or complex structures

### Extraction Rules

The INDEX step uses rules to guide Claude in identifying evidence pieces. These rules are stored in `rules/extraction-rules.yaml` and define:

1. **How to identify questions/labels**
   - Formatting patterns (bold, merged cells, gray background)
   - Position patterns (column A/B typically labels, C+ typically answers)
   - Language patterns (ends with ":", "/", or is bilingual)

2. **How to identify answer fields**
   - Input formatting (colored background, borders)
   - Empty vs filled detection
   - Data type inference (text, yes/no, date, number)

3. **How to detect evidence piece boundaries**
   - Section headers (merged, bold, larger font)
   - Table boundaries (consistent column structure)
   - Visual grouping (borders, background colors)

4. **How to classify topics**
   - Keyword patterns per topic
   - Section name matching
   - Content-based inference

---

## Directory Structure

```
./incoming/           # Drop questionnaire files here
./questionnaires/     # Stored raw structures (JSON)
./indexed/            # Indexed questionnaires with all evidence pieces (YAML)
./answer-library.yaml # Harvested entity-level answers
./approved/           # Human-approved answers
./rules/              # Extraction and classification rules
./logs/               # Processing logs
```

---

## Commands

| Command | Description |
|---------|-------------|
| `store <file>` | Store questionnaire preserving Excel structure |
| `index <file>` | Index with Claude AI, extract all evidence pieces |
| `harvest` | Harvest entity-level answers into library |
| `review` | Interactive review of harvested answers |
| `fill <file>` | Match & auto-fill a new questionnaire |

---

## Current State

- **4 questionnaires** stored & indexed
- **493 evidence pieces** identified
- **196 entity-level answers** harvested
- **10 topics** covered

## Next Steps

1. ✅ Create extraction rules file (`rules/extraction-rules.yaml`)
2. ✅ Build interactive review command (`review`)
3. Build fill/match command

---

## Feedback Loop (Reinforcement Learning)

The review system implements a learning loop:

```
┌─────────────────────────────────────────────────────────────────┐
│  EXTRACT                                                        │
│  Claude analyzes using: rules + gold examples from feedback     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  REVIEW                                                         │
│  Human provides feedback:                                       │
│    [c] Correct → Add to gold examples                           │
│    [w] Wrong → Store as negative example + reason               │
│    [e] Edit → Correct it, add to gold examples                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  LEARN                                                          │
│  Gold examples → included in future Claude prompts (few-shot)   │
│  Negative examples → "don't do this" in prompts                 │
│  Patterns emerge → update extraction rules                      │
└─────────────────────────────────────────────────────────────────┘
```

### Feedback Storage

Feedback is stored in `feedback/feedback.yaml`:

```yaml
sections:
  - id: "..."
    source: { file: "...", sheet: "..." }
    detected: { title: "...", startRow: 5, endRow: 20, topic: "..." }
    verdict: "correct" | "wrong" | "edited"
    wrongReason: "wrong_boundaries" | "not_a_section" | ...
    corrected: { ... }  # If edited

extractions:
  - id: "..."
    source: { file: "...", sheet: "...", cells: "B10:C10" }
    extracted: { type: "simple_qa", question: "...", answer: "...", topic: "...", level: "entity" }
    verdict: "correct" | "wrong" | "edited"
    wrongReason: "not_a_question" | "should_be_table" | "wrong_topic" | ...
    corrected: { ... }  # If edited
```

### Visual Preview

The review command generates HTML previews of each sheet showing:
- Cell colors indicating role (header, section, label, input, value)
- Merged cell indicators
- Click to see cell details

Open `review/<filename>_index.html` in browser while reviewing in terminal.
