---
date: 2026-03-01
topic: extraction-separation
status: ready-for-plan
---

# Extraction Strategy Separation & Self-Explaining Questions

## What We're Building

Refactor the questionnaire extraction pipeline to:
1. **Separate Azure and Claude Vision extractions** - no more mixing strategies in the indexer
2. **Generate self-explaining questions** - transform raw labels like "Records" into "Do you have Records (document control)?"
3. **Per-questionnaire strategy selection** - show both extractions, recommend one, let user choose

## Current Problem

The `questionnaire-indexer.ts` mixes Azure structure extraction with Claude Vision analysis:

```
STORE (Azure) → structure.json (cells, coordinates)
     ↓
INDEX → takes structure.sheets, passes to VisualAnalyzer → MIXED OUTPUT
        └─ buildOutline() → Claude API call
        └─ analyzeSection() → Claude API call per section
```

This causes:
- Duplicate labels like "4.2.2 Records - Records"
- Loss of extraction source clarity
- Context-less labels that are meaningless in isolation
- Mixed data sources make it hard to know which extraction provided what

## Why This Approach (Dual-Output with Strategy Selector)

**Considered alternatives:**

| Approach | Why Not |
|----------|---------|
| Auto-detect strategy | Less transparency, can't compare quality |
| Single unified extractor | Doesn't solve "which source is better" |
| **Dual-output + selector** | ✅ Clean separation, user review, recommendations |

**Key benefits:**
- Both extractions preserved for comparison
- User always in control with recommendation guidance
- Self-explaining questions generated as post-processing
- No mixing of strategies

## Processing Model

Understanding where processing happens:

### Current State (Mixed)
```
STORE   → Azure Document Intelligence API    [External API]
INDEX   → VisualAnalyzer (Claude API calls)  [External API - mixed with Azure data]
```

### Proposed State (Separated)

| Strategy | INDEX Processing | Data Source |
|----------|------------------|-------------|
| **Azure INDEX** | Local only | Parses existing structure.json |
| **Vision INDEX** | Claude API | Analyzes original PDF/images |

**Azure INDEX** works locally because:
1. `structure.json` already contains all cell values, coordinates, tables from STORE
2. We reorganize this data into sections by sheet and position
3. No additional API calls - just JSON parsing and structuring

**Vision INDEX** uses Claude API because:
1. It analyzes the original document visually
2. Extracts Q&A pairs with bounding box coordinates
3. Can handle complex visual layouts that Azure misses

## Key Decisions

### 1. Separate Output Files
- `indexed-azure.json` - Azure Document Intelligence extraction (tables, cells)
- `indexed-vision.json` - Claude Vision extraction (visual Q&A with coordinates)
- `indexed.json` - Final selected output (user's choice)

### 2. Self-Explaining Question Generation
Transform raw labels by incorporating section context:

| Raw Label | Section | Self-Explaining |
|-----------|---------|-----------------|
| Records | 4.2 Document Control | Do you have Records for document control? |
| Yes/No | Food Safety Plan | Do you have a Food Safety Plan in place? |
| Han van Hagen | CEO Contact | CEO Name |

This is a **post-processing step** applied to the selected extraction, not during extraction itself.

### 3. Per-Questionnaire Review UI

Add a review step in the pipeline:

```
INDEX (both strategies)
     ↓
REVIEW (compare + recommend + select)
     ↓
FINALIZE (apply self-explaining transform)
```

**Review screen shows:**
- Side-by-side comparison of Azure vs Vision extraction
- Quality metrics (item count, coverage, duplicate rate)
- System recommendation with reasoning
- User can select either strategy or hybrid

### 4. UI Presentation Strategy

Each extraction type has different evidence formats. The UI should handle both clearly:

| Extraction | Evidence Format | Click Behavior |
|------------|-----------------|----------------|
| Azure | Cell refs (A3, B4) + sheet | Show sheet tab + highlight cell in grid view |
| Vision | Bounding boxes + page | Show PDF page + draw highlight rectangle |

**Unified Preview Panel:**

```
┌─────────────────────────────────────────────────────────┐
│ [Original] tab shows:                                    │
│                                                          │
│ ┌─ Source Type Indicator ─────────────────────────────┐ │
│ │ 📊 Excel View (Azure)  |  📄 PDF View (Vision)      │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ For Azure-selected questionnaires:                       │
│ ┌─────────────────────────────────────────────────────┐ │
│ │  Sheet: [Supplier Info ▼]                           │ │
│ │  ┌───┬───────────────┬────────────────┐            │ │
│ │  │   │      A        │       B        │            │ │
│ │  ├───┼───────────────┼────────────────┤            │ │
│ │  │ 1 │ Supplier Name │ [Numidia B.V.] │ ← clicked  │ │
│ │  │ 2 │ Address       │ Boven de...    │            │ │
│ │  └───┴───────────────┴────────────────┘            │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ For Vision-selected questionnaires:                      │
│ ┌─────────────────────────────────────────────────────┐ │
│ │  Page: [3 of 12]  [◀] [▶]                          │ │
│ │  ┌─────────────────────────────────────┐           │ │
│ │  │                                     │           │ │
│ │  │    ┌──────────────────┐            │           │ │
│ │  │    │ Supplier Name:   │ ← bbox     │           │ │
│ │  │    │ Numidia B.V.     │   highlight│           │ │
│ │  │    └──────────────────┘            │           │ │
│ │  │                                     │           │ │
│ │  └─────────────────────────────────────┘           │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Item List Badges:**

Each extracted item shows its evidence source clearly:

```
┌────────────────────────────────────────────────────────┐
│ Supplier Name                                          │
│ Value: Numidia B.V.                                    │
│ [📊 Sheet: Supplier Info, Cell: B1]  ← Azure badge    │
│   OR                                                   │
│ [📄 Page 3, bbox: 120,340,280,360]   ← Vision badge   │
└────────────────────────────────────────────────────────┘
```

**Review/Compare Mode:**

During strategy selection, show split view:

```
┌─────────────────────┬─────────────────────┐
│ Azure Extraction    │ Vision Extraction   │
│ ─────────────────── │ ─────────────────── │
│ 📊 45 items         │ 📄 52 items         │
│ 3 duplicates        │ 1 duplicate         │
│                     │                     │
│ [Click to preview]  │ [Click to preview]  │
│                     │ ⭐ RECOMMENDED      │
├─────────────────────┴─────────────────────┤
│ [Use Azure] [Use Vision] [Use Both/Merge] │
└───────────────────────────────────────────┘
```

### 5. Recommendation Algorithm

Recommend based on document characteristics and extraction quality:

| Factor | Azure Better | Vision Better |
|--------|--------------|---------------|
| Document type | Excel (.xlsx) | PDF, scanned |
| Table structure | Clear cells | Complex visual layout |
| Duplicate rate | Lower dupes | Lower dupes |
| Item coverage | Higher count | Higher count |

Display recommendation with:
- Confidence level
- Quality metrics (items extracted, duplicate rate)
- Specific reasoning (e.g., "Azure extracted 45 items with 3 duplicates")

## Data Flow (New)

```
INCOMING FILE (Excel, PDF, Word, HTML)
     ↓
┌─────────────────────────────────────────────────────────────┐
│ STORE (existing)                                            │
│ - Azure Document Intelligence API                           │
│ - Extracts: cells, tables, coordinates, text                │
│ - Output: structure.json (contains ALL raw data)            │
└─────────────────────────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────────────────────────┐
│ INDEX (refactored - runs BOTH strategies)                   │
│                                                             │
│ ├─ Azure strategy                               [Local]     │
│ │  - Input: structure.json                                  │
│ │  - Process: JSON parsing, organize by sheet/position      │
│ │  - Output: indexed-azure.json                             │
│ │                                                           │
│ └─ Vision strategy                              [Claude API]│
│    - Input: Original PDF/images                             │
│    - Process: Claude analyzes visual layout                 │
│    - Extract Q&A with bounding box coordinates              │
│    - Output: indexed-vision.json                            │
└─────────────────────────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────────────────────────┐
│ REVIEW (new step)                                           │
│ - Compare both extractions side-by-side                     │
│ - Calculate quality metrics (items, duplicates, coverage)   │
│ - Show recommendation                                       │
│ - User selects strategy                                     │
│ - Output: indexed.json (copy of selected strategy)          │
└─────────────────────────────────────────────────────────────┘
     ↓
┌─────────────────────────────────────────────────────────────┐
│ CONTEXTUALIZE (new step)                                    │
│ - Generate self-explaining questions                        │
│ - Transform: "Records" → "Do you have Records?"             │
│ - Rule-based + section context                              │
│ - Output: indexed.json (updated with better labels)         │
└─────────────────────────────────────────────────────────────┘
     ↓
HARVEST / AGGREGATE (existing)
```

## Implementation Outline

### Phase 1: Separate Extractors
- [ ] Create `AzureExtractor` class
  - Input: structure.json only
  - Local JSON parsing (no API calls)
  - Organize cells into sections by sheet name and row ranges
  - Detect section headers, label/value pairs
  - Output: indexed-azure.json
- [ ] Create `VisionExtractor` class
  - Input: Original PDF/images
  - Uses Claude API (via `visual-qa-extractor.ts` pattern)
  - Extract Q&A pairs with bounding box coordinates
  - Output: indexed-vision.json
- [ ] Modify `index` command
  - `--strategy azure` → runs AzureExtractor only
  - `--strategy vision` → runs VisionExtractor only
  - `--strategy both` (default) → runs both for comparison
  - Output separate files for each strategy

### Phase 2: Review UI
- [ ] Add review panel in frontend showing both extractions side-by-side
- [ ] Implement quality metrics calculation (item count, duplicates, coverage)
- [ ] Add recommendation engine with reasoning display
- [ ] Add selection UI (pick Azure, Vision, or merge)
- [ ] Add extraction source badge to each item (📊 cell ref or 📄 bbox)

### Phase 2b: Evidence Preview Panel
- [ ] Create Excel grid view component for Azure extractions
  - Sheet selector dropdown
  - Cell highlighting on click
  - Render from structure.json cell data
- [ ] Enhance PDF view for Vision extractions (already partially exists)
  - Bounding box drawing on click
  - Page navigation tied to item selection
- [ ] Add source type indicator toggle (📊 Excel View | 📄 PDF View)
- [ ] Sync click behavior: item click → appropriate preview highlight

### Phase 3: Self-Explaining Questions
- [ ] Create `QuestionContextualizer` service
- [ ] Build section context → label transformation rules
- [ ] Add as post-processing step after selection

### Phase 4: CLI Integration
- [ ] Add `review` command for CLI-based selection
- [ ] Add `--strategy azure|vision|auto` flag to index command
- [ ] Update pipeline to support new flow

## Open Questions

*None - all key decisions made.*

## Next Steps

→ `/workflows:plan` for detailed implementation plan
