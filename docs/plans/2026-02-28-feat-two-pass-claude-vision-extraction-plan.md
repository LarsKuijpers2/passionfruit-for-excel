---
title: Two-Pass Claude Vision PDF Extraction
type: feat
status: active
date: 2026-02-28
origin: docs/brainstorms/2026-02-28-claude-vision-extraction-brainstorm.md
---

# Two-Pass Claude Vision PDF Extraction

## Overview

Implement a two-pass PDF extraction pipeline using Claude Vision that runs in parallel with the existing Azure OCR approach. This addresses poor accuracy on complex questionnaire layouts by replicating the approach that achieved 99% accuracy in Claude Chat testing.

**Key decisions from brainstorm:**
- Two-pass architecture (structure extraction → Q&A parsing)
- Accuracy over cost/speed
- Keep existing pipeline working
- Layered feedback loop

## Problem Statement

Current pipeline: `Azure OCR → cell-by-cell JSON → Claude post-processing`

**Issues:**
- Azure gives consistent but often wrong results for complex layouts
- Post-processing Claude fixes symptoms, not root cause
- Tables, checkboxes, and section relationships get lost

**Evidence:** Same PDFs uploaded to Claude Chat with simple prompts achieve ~99% accuracy.

## Proposed Solution

Replicate Claude Chat's approach programmatically:

```
Pass 1: PDF pages → Claude Vision → Structured markdown/JSON (document understanding)
Pass 2: Structure → Claude → Q&A pairs in JSON (information extraction)
```

**Why two-pass wins (see brainstorm):**
1. Separation of concerns - structure ≠ Q&A extraction
2. Debuggable - see what each pass produced
3. Proven to work - Claude Chat testing showed 99% accuracy

## Technical Approach

### Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           PDF Input                     │
                    └─────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
        ┌──────────────────────┐           ┌──────────────────────┐
        │   Existing Pipeline   │           │   New Pipeline        │
        │   (Azure OCR)         │           │   (Claude Vision)     │
        └──────────────────────┘           └──────────────────────┘
                    │                                   │
                    │                       ┌───────────┴───────────┐
                    │                       ▼                       ▼
                    │           ┌──────────────────┐   ┌──────────────────┐
                    │           │   Pass 1:        │   │   Pass 2:        │
                    │           │   Structure      │   │   Q&A Extract    │
                    │           │   Extraction     │   │                  │
                    │           └──────────────────┘   └──────────────────┘
                    │                       │                       │
                    ▼                       └───────────┬───────────┘
        ┌──────────────────────┐                       ▼
        │ QuestionnaireStructure│       ┌──────────────────────┐
        └──────────────────────┘       │ QuestionnaireStructure│
                    │                   └──────────────────────┘
                    └─────────────────────┬─────────────────────┘
                                          ▼
                              ┌──────────────────────┐
                              │     Indexer          │
                              │ (questionnaire-      │
                              │  indexer.ts)         │
                              └──────────────────────┘
```

### Key Components

#### 1. TwoPassVisionExtractor Class

**Location:** `src/services/extractors/two-pass-vision-extractor.ts`

```typescript
export class TwoPassVisionExtractor implements DocumentExtractor {
  private customerDir: string;

  constructor(customerDir?: string) {
    this.customerDir = customerDir || './customers/default';
  }

  async extract(filepath: string): Promise<QuestionnaireStructure> {
    // 1. Convert PDF to page images
    const pageImages = await this.convertToImages(filepath);

    // 2. Pass 1: Structure extraction
    const structure = await this.extractStructure(pageImages, filepath);

    // 3. Save Pass 1 output (for debugging/feedback)
    await this.saveIntermediateOutput(filepath, 'pass1', structure);

    // 4. Pass 2: Q&A extraction from structure
    const qaStructure = await this.extractQAPairs(structure);

    // 5. Save Pass 2 output
    await this.saveIntermediateOutput(filepath, 'pass2', qaStructure);

    // 6. Convert to QuestionnaireStructure format
    return this.toQuestionnaireStructure(qaStructure, filepath);
  }

  getDocumentType(): DocumentType {
    return 'application/pdf';
  }
}
```

#### 2. Pass 1: Structure Extraction

**Purpose:** Get Claude to understand the document layout - sections, tables, checkboxes, relationships.

**Approach:**
- Send all page images to Claude (up to 20 pages; batch larger docs)
- Simple prompt: "Extract this document to structured markdown preserving all tables, checkboxes, and section hierarchy"
- Output: Markdown with tables, checkbox Unicode (☐/☒), section headers

**Prompt Strategy:**
```
You are extracting a supplier questionnaire PDF. Output structured markdown that:
1. Preserves all section headers with hierarchy (##, ###)
2. Converts tables to markdown tables with all columns
3. Shows checkboxes as ☐ (unchecked) or ☒ (checked)
4. Keeps all text content verbatim
5. Maintains document order

Do not summarize or interpret. Extract exactly what you see.
```

#### 3. Pass 2: Q&A Extraction

**Purpose:** Parse the structured representation to extract question-answer pairs.

**Approach:**
- Send markdown from Pass 1 to Claude
- Prompt focuses on identifying Q&A pairs, destinations, topics
- Output: JSON array of `{ question, answer, section, type, destination }`

**Prompt Strategy:**
```
Given this structured document, extract all question-answer pairs.

For each pair, provide:
- label: The question text
- value: The answer (including checkbox interpretations: ☒ YES = "Yes")
- section: Section header this belongs to
- type: question | table_row | checkbox_list | certification
- destination: library | entity | product | excluded

Output as JSON array.
```

### Integration Points

#### Factory Registration

**File:** `src/services/extractors/index.ts`

```typescript
// Add to getExtractor() function around line 49
case 'two-pass-vision':
  return new TwoPassVisionExtractor(customerDir);
```

#### CLI Option

**File:** `src/cli.ts`

Add `--extractor` flag to store command:
```typescript
.option('-e, --extractor <type>', 'Extractor type: azure | two-pass-vision', 'azure')
```

#### Parallel Mode

**File:** `src/services/extractors/pdf.ts`

Add option to run both extractors and compare:
```typescript
if (mode === 'compare') {
  const [azureResult, visionResult] = await Promise.all([
    extractWithAzure(filepath),
    new TwoPassVisionExtractor(customerDir).extract(filepath)
  ]);
  return { azure: azureResult, vision: visionResult };
}
```

### Data Capture for Feedback Loop

**Location:** `customers/<customer>/vision-extraction/`

```
customers/<customer>/vision-extraction/
├── <questionnaire>/
│   ├── pass1-structure.md         # Markdown from Pass 1
│   ├── pass2-qa-pairs.json        # JSON from Pass 2
│   ├── final-structure.json       # QuestionnaireStructure output
│   ├── page-images/               # Cached page images
│   │   ├── page-1.png
│   │   ├── page-2.png
│   │   └── ...
│   └── metadata.json              # Timestamps, model versions, etc.
```

This enables:
- **Few-shot examples:** When corrections are made, link back to Pass 1/2 outputs
- **Pattern detection:** Analyze systematic errors across documents
- **Fine-tuning data:** Pair incorrect outputs with corrections

## Acceptance Criteria

### Functional Requirements

- [x] New `TwoPassVisionExtractor` class implementing `DocumentExtractor` interface
- [x] Pass 1 extracts document structure to markdown
- [x] Pass 2 extracts Q&A pairs from structure
- [x] Output compatible with existing `QuestionnaireIndexer`
- [x] Intermediate outputs saved for debugging/feedback
- [x] CLI flag to select extractor type
- [ ] Compare mode to run both extractors

### Quality Gates

- [ ] Extraction accuracy ≥95% on test set of 5 complex questionnaires
- [ ] Processing time <60s for documents <20 pages
- [x] All intermediate outputs persisted
- [x] Existing Azure pipeline unaffected

### Testing

- [ ] Unit tests for `TwoPassVisionExtractor`
- [ ] Integration test: full extraction → indexing pipeline
- [ ] Comparison test: Azure vs Vision results on same PDFs

## Implementation Plan

### Phase 1: Core Extractor (MVP)

**Files to create:**
- `src/services/extractors/two-pass-vision-extractor.ts`

**Files to modify:**
- `src/services/extractors/index.ts` (register new extractor)
- `src/cli.ts` (add --extractor flag)

**Tasks:**
1. Create `TwoPassVisionExtractor` class skeleton
2. Implement `convertToImages()` - reuse from `claude-markdown-extractor.ts`
3. Implement `extractStructure()` - Pass 1 with Claude
4. Implement `extractQAPairs()` - Pass 2 with Claude
5. Implement `toQuestionnaireStructure()` - convert to expected format
6. Register in factory and CLI

### Phase 2: Data Capture

**Files to create:**
- None (use existing customer folder structure)

**Files to modify:**
- `src/services/extractors/two-pass-vision-extractor.ts`

**Tasks:**
1. Implement `saveIntermediateOutput()` for Pass 1/2 results
2. Add page image caching
3. Add extraction metadata (timestamps, model version)

### Phase 3: Compare Mode

**Files to modify:**
- `src/services/extractors/pdf.ts`
- `src/cli.ts`

**Tasks:**
1. Add compare mode to run both extractors
2. Output comparison report
3. Add CLI command: `pnpm cli compare <file> -c <customer>`

### Phase 4: Feedback Integration

**Files to modify:**
- `src/services/learning/correction-tracker.ts`
- Review UI (frontend)

**Tasks:**
1. Link corrections to Pass 1/2 outputs
2. Show Pass 1 markdown in review UI for debugging
3. Track which extractor was used

## Error Handling Strategy

### Pass 1 Failure
- **On timeout/error:** Log error with context, throw `ExtractionError` with details
- **Retry:** 2 retries with exponential backoff (2s, 4s)
- **Partial failure:** If any batch fails, fail entire extraction (no partial results)
- **Cleanup:** Delete any saved intermediate files on failure

### Pass 2 Failure
- **On JSON parse error:** Retry once with stricter prompt ("Output ONLY valid JSON array")
- **On timeout:** Same retry strategy as Pass 1
- **Keep Pass 1 output:** Even if Pass 2 fails, keep pass1-structure.md for debugging

### Exit Codes
- `0` - Success
- `1` - Extraction failed (Pass 1 or Pass 2)
- `2` - Invalid input (file not found, not PDF)
- `3` - Configuration error (no API access)

## Large Document Handling

### Batching Strategy (>20 pages)
- **Batch size:** 15 pages per Pass 1 call (leaves headroom)
- **Page tracking:** Each batch includes page range in prompt ("Pages 1-15 of 45")
- **Section continuity:** Prompt instructs to continue section numbering from previous batch
- **Merging:** Concatenate markdown from all batches, then run single Pass 2

### Example for 45-page PDF
```
Batch 1: Pages 1-15  → markdown_1.md
Batch 2: Pages 16-30 → markdown_2.md
Batch 3: Pages 31-45 → markdown_3.md
Merge: markdown_1 + markdown_2 + markdown_3 → full_structure.md
Pass 2: full_structure.md → qa_pairs.json
```

## Format Conversion (toQuestionnaireStructure)

### Pass 2 Output → QuestionnaireStructure Mapping

```typescript
// Pass 2 produces:
interface ExtractedQA {
  label: string;      // Question text
  value: string;      // Answer text
  section: string;    // Section header
  type: 'question' | 'table_row' | 'checkbox_list' | 'certification';
  destination: 'library' | 'entity' | 'product' | 'excluded';
}

// Maps to QuestionnaireStructure:
// - Each section becomes a SheetData with name = section
// - Each Q&A becomes a RowData with:
//   - cells.A = { value: label, role: 'label', filled: true }
//   - cells.B = { value: value, role: 'value', filled: !!value }
// - rowType = type mapping: question→'data', table_row→'data', etc.
// - extractionSource = 'visualQA'
```

### Field Mapping Table
| Pass 2 Field | QuestionnaireStructure Field |
|--------------|------------------------------|
| label | cells.A.value, cells.A.role='label' |
| value | cells.B.value, cells.B.role='value' |
| section | SheetData.name, RowData.sectionTitle |
| type | RowData.rowType (mapped) |
| destination | Stored in metadata for indexer |

## Caching Strategy

### Page Image Cache
- **Location:** `customers/<customer>/vision-extraction/<questionnaire>/page-images/`
- **TTL:** Indefinite (images don't change for same PDF)
- **Invalidation:** Delete cache if PDF modified date > cache date
- **Reuse on retry:** Yes, reuse cached images

### Intermediate Output Retention
- **pass1-structure.md:** Keep indefinitely (for feedback loop)
- **pass2-qa-pairs.json:** Keep indefinitely (for feedback loop)
- **final-structure.json:** Keep indefinitely (main output)
- **Cleanup:** Manual via `pnpm cli clean-cache -c <customer>`

### Metadata Tracking (metadata.json)
```json
{
  "extractedAt": "2026-02-28T14:30:00Z",
  "modelId": "eu.anthropic.claude-sonnet-4-20250514-v1:0",
  "pass1Tokens": { "input": 15000, "output": 8000 },
  "pass2Tokens": { "input": 8000, "output": 3000 },
  "processingTimeMs": 45000,
  "pageCount": 11,
  "batchCount": 1,
  "retryCount": 0,
  "pdfHash": "sha256:abc123..."
}
```

## Dependencies & Prerequisites

- AWS Bedrock access configured (already in place)
- `pdftoppm` installed for PDF→image conversion (already used)
- Claude model: `eu.anthropic.claude-sonnet-4-20250514-v1:0`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude API costs | Medium | Batch similar documents, cache results |
| Context window limits | Low | Most docs <20 pages; batch larger docs |
| Output format variations | Medium | Strong prompts, output validation |
| Integration issues | Low | Comprehensive type compatibility |

## Success Metrics

- **Accuracy:** ≥95% correct extractions (measured against human-reviewed gold standard)
- **Comparison win rate:** Vision extractor outperforms Azure on complex layouts
- **Correction rate:** <5% items need human correction

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-02-28-claude-vision-extraction-brainstorm.md](../brainstorms/2026-02-28-claude-vision-extraction-brainstorm.md)
- Key decisions carried forward: two-pass architecture, accuracy priority, layered feedback

### Internal References

- Extractor interface: `src/services/extractors/index.ts:18-25`
- QuestionnaireStructure type: `src/services/extractors/excel.ts:166-215`
- Existing Claude Vision: `src/services/extractors/claude-markdown-extractor.ts`
- Correction tracking: `src/services/learning/correction-tracker.ts`
- Knowledge base: `knowledge/extraction-learning-plan.md`

### External References

- Claude Vision API: https://docs.anthropic.com/claude/docs/vision
