---
title: "Refactor: Separate Azure and Vision Extraction Strategies"
type: refactor
status: active
date: 2026-03-01
origin: docs/brainstorms/2026-03-01-extraction-separation-brainstorm.md
---

# Refactor: Separate Azure and Vision Extraction Strategies

## Overview

Refactor the questionnaire extraction pipeline to cleanly separate Azure Document Intelligence and Claude Vision extraction strategies. Currently, the `questionnaire-indexer.ts` mixes both strategies, causing duplicate labels and loss of extraction source clarity. This refactor introduces:

1. **Separate extractors** - `AzureExtractor` (local JSON parsing) and `VisionExtractor` (Claude API)
2. **Dual output files** - `indexed-azure.json` and `indexed-vision.json` for comparison
3. **Review UI** - Side-by-side comparison with quality metrics and recommendations
4. **Self-explaining questions** - Transform context-less labels into meaningful questions

## Problem Statement / Motivation

The current `questionnaire-indexer.ts` mixes Azure structure extraction with Claude Vision analysis:

```
STORE (Azure) → structure.json (cells, coordinates)
     ↓
INDEX → takes structure.sheets, passes to VisualAnalyzer → MIXED OUTPUT
        └─ buildOutline() → Claude API call
        └─ analyzeSection() → Claude API call per section
```

This causes:
- Duplicate labels like "4.2.2 Records - Records"
- Loss of extraction source clarity (which strategy provided what?)
- Context-less labels that are meaningless in isolation
- Mixed data sources make debugging and improvement difficult

## Proposed Solution

Separate the INDEX phase into two independent extractors that run in parallel and produce separate outputs:

```
STORE → structure.json (existing)
     ↓
INDEX (runs BOTH strategies)
├─ AzureExtractor     [Local only - parses structure.json]
│  └─ indexed-azure.json
└─ VisionExtractor    [Claude API - analyzes original PDF]
   └─ indexed-vision.json
     ↓
REVIEW (new step)
├─ Compare both extractions side-by-side
├─ Show quality metrics (items, duplicates, coverage)
├─ Display recommendation
└─ User selects strategy → indexed.json
     ↓
CONTEXTUALIZE (new step)
├─ Generate self-explaining questions
└─ Update indexed.json with better labels
     ↓
HARVEST / AGGREGATE (existing)
```

## Technical Approach

### Architecture

```
src/services/extractors/
├── index.ts                    # Factory (existing)
├── azure.ts                    # Azure Document Intelligence (existing)
├── azure-indexer.ts            # NEW: Local JSON parser for indexing
├── vision-indexer.ts           # NEW: Claude Vision Q&A extraction
└── question-contextualizer.ts  # NEW: Self-explaining question generator

src/services/analysis/
├── questionnaire-indexer.ts    # MODIFY: Orchestrate both strategies
├── extraction-comparator.ts    # NEW: Quality metrics calculation
└── strategy-recommender.ts     # NEW: Recommendation logic

frontend/src/components/
├── IndexedPanel.tsx            # MODIFY: Add extraction source badges
├── ExtractionReviewPanel.tsx   # NEW: Side-by-side comparison
├── ExcelGridView.tsx           # NEW: Azure evidence preview
└── PdfBboxOverlay.tsx          # MODIFY: Vision evidence preview (enhance existing)
```

### Implementation Phases

#### Phase 1: Separate Extractors

Create two independent indexing strategies that produce clean, non-mixed outputs.

**Tasks:**

- [x] Create `AzureIndexer` class (`src/services/extractors/azure-indexer.ts`)
  - Input: `structure.json` only (no API calls)
  - Parse sheets, identify sections by sheet name and row ranges
  - Detect section headers using formatting (bold, merged cells)
  - Extract label/value pairs from adjacent cells
  - Output: `indexed-azure.json` with `lCell`/`vCell` references

- [x] Create `VisionIndexer` class (`src/services/extractors/vision-indexer.ts`)
  - Input: Original PDF/images
  - Use existing `visual-qa-extractor.ts` patterns
  - Extract Q&A pairs (simplified to just pageNumber, no bbox)
  - Output: `indexed-vision.json` with `pageNumber`
  - **Fixed duplicate extraction bug**: Refactored to process each page ONCE (not once per section)

- [x] Add extraction source metadata to `IndexedItem` type
  ```typescript
  // In src/types.ts
  interface IndexedItem {
    // ... existing fields
    extractionSource: 'azure' | 'vision';
    evidence: AzureEvidence | VisionEvidence;
  }

  interface AzureEvidence {
    type: 'azure';
    sheet: string;
    lCell: string;
    vCell: string;
  }

  interface VisionEvidence {
    type: 'vision';
    pageNumber: number;
    bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  }
  ```

- [x] Modify `questionnaire-indexer.ts` to orchestrate both strategies
  - Add `--strategy azure|vision|both` CLI option
  - Run selected strategy or both
  - Output separate files: `indexed-azure.json`, `indexed-vision.json`

- [x] Update CLI `index` command
  - Add `--strategy` flag with default `both`
  - Handle output file naming

**Files to create:**
- `src/services/extractors/azure-indexer.ts`
- `src/services/extractors/vision-indexer.ts`

**Files to modify:**
- `src/types.ts` - Add `extractionSource` and evidence types
- `src/services/analysis/questionnaire-indexer.ts` - Orchestrate strategies
- `src/cli.ts` - Add `--strategy` flag

#### Phase 2: Review UI

Add side-by-side comparison and selection interface.

**Tasks:**

- [x] Create `ExtractionComparator` service (`src/services/analysis/extraction-comparator.ts`)
  - Calculate quality metrics: item count, duplicate rate, coverage
  - Compare both extractions for overlap
  - Output comparison summary

- [x] ~~Create `StrategyRecommender` service~~ (Skipped - user prefers manual selection)
  - Recommend based on:
    - Document type (Excel → Azure, PDF → Vision)
    - Duplicate rate (lower is better)
    - Item coverage (higher is better)
  - Output recommendation with reasoning

- [ ] Create `ExtractionReviewPanel` component (`frontend/src/components/ExtractionReviewPanel.tsx`)
  - Split view showing Azure vs Vision extractions
  - Quality metrics summary (items, duplicates)
  - Recommendation badge with reasoning
  - Selection buttons: [Use Azure] [Use Vision] [Merge Both]

- [ ] Create `ExcelGridView` component (`frontend/src/components/ExcelGridView.tsx`)
  - Render structure.json as spreadsheet grid
  - Sheet selector dropdown
  - Cell highlighting on item click
  - Use existing `structure.json` cell data

- [ ] Enhance `PdfOverlayViewer` for Vision evidence
  - Draw bounding box highlights
  - Sync page navigation with item selection
  - Style different from table annotations (different color)

- [x] ~~Add extraction source badges to `IndexedPanel.tsx`~~ (Replaced with view toggle)
  - Per-item badges were confusing when reviewing
  - Instead: Added extraction view toggle to App.tsx sheet tabs area
  - Toggle allows switching between Default/Azure/Vision views
  - Selected view refetches questionnaire data with ?extraction= query param
  - Server loads extraction-specific files: `*-azure.json` or `*-vision.json`

- [ ] Add review step to pipeline
  - After INDEX, before existing workflow
  - Show ExtractionReviewPanel
  - On selection, copy chosen file to `indexed.json`

**Files to create:**
- `src/services/analysis/extraction-comparator.ts`
- `src/services/analysis/strategy-recommender.ts`
- `frontend/src/components/ExtractionReviewPanel.tsx`
- `frontend/src/components/ExcelGridView.tsx`

**Files to modify:**
- `frontend/src/components/IndexedPanel.tsx` - ~~Add source badges~~ Removed badges (replaced with toggle)
- `frontend/src/components/PdfOverlayViewer.tsx` - Enhance bbox drawing
- `frontend/src/App.tsx` - ~~Add review step routing~~ Added extraction view toggle in sheet tabs
- `frontend/src/api.ts` - Updated fetchQuestionnaire to accept extractionView parameter
- `frontend/src/types.ts` - Added ExtractionView type, extractionView to QuestionnaireData
- `src/server.ts` - Updated loadQuestionnaireData to load extraction-specific files

#### Phase 3: Self-Explaining Questions

Transform context-less labels into meaningful, self-contained questions.

**Tasks:**

- [x] Create `QuestionContextualizer` service (`src/services/analysis/question-contextualizer.ts`)
  - Input: indexed.json with section context
  - Transform rules:
    - Single-word labels → "Do you have {label} (for {section})?"
    - "Yes/No" type → "Do you have {section topic}?"
    - Name values → "{Role} Name" (e.g., "CEO Name")
  - Preserve original label in `originalLabel` field
  - Also created frontend version: `frontend/src/utils/question-contextualizer.ts`

- [x] Define transformation rules
  ```typescript
  const transformRules = [
    // Pattern: single word Yes/No in section context
    {
      match: (item, section) =>
        item.type === 'yesno' && item.label.split(' ').length <= 2,
      transform: (item, section) => ({
        ...item,
        originalLabel: item.label,
        label: `Do you have ${item.label} (${section.title})?`
      })
    },
    // Pattern: contact name detection
    {
      match: (item) =>
        item.topic === 'entity_contacts' && isPersonName(item.value),
      transform: (item) => ({
        ...item,
        originalLabel: item.label,
        label: deriveRoleFromContext(item)
      })
    }
  ];
  ```

- [x] Add contextualize step to pipeline
  - Implemented in frontend LibraryPanel for real-time display
  - Contextualization happens at display time using section context
  - `contextualizeLabel()` applies transformation rules based on section title

- [x] Update UI to show original vs contextualized labels
  - LibraryPanel shows contextualized labels with purple asterisk (*) for transformed items
  - Tooltip shows original label on hover
  - Original label preserved in item data

**Files created:**
- `src/services/analysis/question-contextualizer.ts` - Backend contextualizer
- `frontend/src/utils/question-contextualizer.ts` - Frontend contextualizer for real-time display

**Files modified:**
- `src/types.ts` - Added `originalLabel` field (already existed)
- `frontend/src/types.ts` - Added `originalLabel` to IndexedItem, `sectionTitle` to LibraryItem
- `frontend/src/components/LibraryPanel.tsx` - Integrated contextualizer, shows transformed labels with tooltip
- `frontend/src/App.tsx` - Passes sectionTitle with items to LibraryPanel

#### Phase 4: CLI Integration

Expose new functionality through CLI commands.

**Tasks:**

- [x] Add `--strategy` flag to `index` command
  ```bash
  pnpm cli index questionnaire.xlsx -c customer --strategy azure
  pnpm cli index questionnaire.xlsx -c customer --strategy vision
  pnpm cli index questionnaire.xlsx -c customer --strategy both  # default
  ```

- [ ] Add `review` subcommand for extraction selection
  ```bash
  pnpm cli review questionnaire.xlsx -c customer
  # Opens browser to ExtractionReviewPanel
  # Or outputs comparison to terminal with selection prompt
  ```

- [ ] Add `--skip-contextualize` flag for raw output
  ```bash
  pnpm cli index questionnaire.xlsx -c customer --skip-contextualize
  ```

- [ ] Update `list` command to show extraction status
  - Show which extractions exist (azure/vision/selected)
  - Show if contextualized

**Files to modify:**
- `src/cli.ts` - Add flags and commands
- `src/server.ts` - Add review endpoint

## Alternative Approaches Considered

| Approach | Why Not Chosen |
|----------|----------------|
| Auto-detect strategy | Less transparency - users can't compare quality |
| Single unified extractor | Doesn't solve "which source is better" problem |
| Replace Azure with Vision entirely | Azure excels at structured Excel, Vision at complex PDFs |
| Per-section strategy mixing | Too complex, hard to debug, source unclear |

**Chosen: Dual-output with selector** because it provides:
- Clean separation of concerns
- User visibility into extraction quality
- Easy debugging (know exactly which strategy produced each item)
- Flexibility to choose best strategy per document

## System-Wide Impact

### Interaction Graph

```
INDEX command
  → QuestionnaireIndexer.index()
    → AzureIndexer.extract() [parallel]
    → VisionIndexer.extract() [parallel]
  → writes indexed-azure.json, indexed-vision.json

REVIEW (new)
  → ExtractionComparator.compare()
  → StrategyRecommender.recommend()
  → User selection
  → copies selected to indexed.json

CONTEXTUALIZE (new)
  → QuestionContextualizer.transform()
  → updates indexed.json labels

Downstream (unchanged)
  → TAG command reads indexed.json
  → HARVEST reads indexed.json
  → AGGREGATE reads approved/*.json
```

### Error & Failure Propagation

- **AzureIndexer fails**: Continue with VisionIndexer only, warn user
- **VisionIndexer fails**: Continue with AzureIndexer only, warn user
- **Both fail**: Error out with clear message
- **Review selection fails**: Keep both files, don't create indexed.json
- **Contextualize fails**: Keep indexed.json with raw labels, warn user

### State Lifecycle Risks

- **Partial extraction**: If one strategy fails mid-extraction, clean up partial file
- **File naming**: Clear naming convention prevents confusion
  - `indexed-azure.json` - Azure strategy output
  - `indexed-vision.json` - Vision strategy output
  - `indexed.json` - Selected/final output

### API Surface Parity

- CLI and server both support strategy selection
- Frontend reflects extraction source in badges
- All outputs follow same `IndexedQuestionnaire` type

### Integration Test Scenarios

1. **Excel document with clear tables** → Azure should extract more items, recommend Azure
2. **Scanned PDF with complex layout** → Vision should extract more items, recommend Vision
3. **Document with both strategies equal** → Show comparison, let user decide
4. **Strategy selection persists** → After selection, indexed.json is correct copy
5. **Contextualization transforms labels** → "Records" → "Do you have Records (Document Control)?"

## Acceptance Criteria

### Functional Requirements

- [ ] `pnpm cli index file.xlsx -c customer --strategy azure` produces `indexed-azure.json`
- [ ] `pnpm cli index file.xlsx -c customer --strategy vision` produces `indexed-vision.json`
- [ ] `pnpm cli index file.xlsx -c customer --strategy both` produces both files
- [ ] Review UI shows side-by-side comparison with quality metrics
- [ ] User can select strategy, which creates `indexed.json`
- [ ] Self-explaining questions transform context-less labels
- [ ] Each item has clear `extractionSource` and evidence data
- [ ] Clicking item in UI highlights evidence in appropriate view (grid or PDF)

### Non-Functional Requirements

- [ ] AzureIndexer makes no external API calls (local JSON parsing only)
- [ ] VisionIndexer uses existing Claude Vision patterns
- [ ] No breaking changes to existing indexed.json consumers
- [ ] Backward compatible: old indexed.json files still work

### Quality Gates

- [ ] All existing tests pass
- [ ] New tests for AzureIndexer, VisionIndexer, Comparator, Recommender
- [ ] Manual test: process Numidia questionnaire with both strategies
- [ ] UI review: ExtractionReviewPanel works in dev server

## Success Metrics

- **Clarity**: Each extracted item has unambiguous source
- **Comparison**: User can see quality difference between strategies
- **Labels**: Self-explaining questions readable without section context
- **No duplicates**: "4.2.2 Records - Records" pattern eliminated

## Dependencies & Prerequisites

- Existing `structure.json` format (from STORE phase)
- Existing `visual-qa-extractor.ts` patterns
- Existing `PdfOverlayViewer` component
- Frontend review server (`pnpm server`)

## Risk Analysis & Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing workflows | Keep indexed.json format unchanged, add new fields |
| Performance (running both strategies) | Add `--strategy` flag to run single strategy |
| Complex merge logic | Start with simple selection, defer merge to later |
| Label transformation errors | Preserve originalLabel, allow toggle |

## Future Considerations

- **Merge mode**: Combine best items from both strategies
- **Learning from selection**: Track which strategy users prefer by document type
- **Auto-selection**: Default to recommended strategy with override option
- **Quality scoring**: More sophisticated metrics beyond item count

## Documentation Plan

- Update CLAUDE.md with new CLI flags
- Add inline code comments for extractor classes
- Update APPROACH.md with new pipeline diagram

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-01-extraction-separation-brainstorm.md](docs/brainstorms/2026-03-01-extraction-separation-brainstorm.md)
  - Key decisions: Dual-output with selector, self-explaining questions as post-processing, evidence preview based on extraction type

### Internal References

- Extractor factory: `src/services/extractors/index.ts`
- Current indexer: `src/services/analysis/questionnaire-indexer.ts`
- Visual QA patterns: `src/services/extractors/visual-qa-extractor.ts`
- Frontend panel: `frontend/src/components/IndexedPanel.tsx`
- PDF viewer: `frontend/src/components/PdfOverlayViewer.tsx`
- Types: `src/types.ts` - IndexedItem, IndexedSection
- Example indexed output: `customers/numidia/indexed/Supplier_Assessment_Survey_Numidia_B_V__.json`

### Related Work

- Two-pass vision extraction (existing): Pass 1 structure, Pass 2 Q&A
- Confidence scoring patterns (existing): `matchScore` in vision validation
