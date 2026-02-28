---
title: "fix: Preserve all PDF paragraphs in extraction"
type: fix
status: completed
date: 2026-02-25
origin: docs/brainstorms/2026-02-25-pdf-content-preservation-brainstorm.md
---

# fix: Preserve all PDF paragraphs in extraction

## Overview

The PDF extraction pipeline discards paragraphs that aren't identified as Q&A pairs, losing valuable content like instruction text, section headers, and contextual notes. This fix removes the "discard as noise" logic to preserve all document content in order.

## Problem Statement

In `src/services/extractors/pdf.ts`, the `correctParagraphsWithClaude` method (lines 728-807) discards all paragraphs that Claude Vision doesn't match as Q&A pairs. This causes loss of:

- Instruction paragraphs (e.g., "The table in this section does not need to be completed...")
- Section headers not in tables
- Contextual notes, disclaimers, guidance text
- Any Q&A pair that Claude Vision missed

**Example:** Barry Callebaut RSPO section loses the instruction paragraph explaining when the table should be completed.

(see brainstorm: docs/brainstorms/2026-02-25-pdf-content-preservation-brainstorm.md)

## Proposed Solution

**Keep all paragraphs** - modify `correctParagraphsWithClaude` to return remaining paragraphs alongside Q&A pairs and tables. Let downstream processing (indexer, UI) decide what's relevant.

## Implementation

### File: `src/services/extractors/pdf.ts`

#### Change 1: Keep paragraphs when no Q&A pairs found (lines 766-770)

```typescript
// BEFORE:
if (qaPairs.length === 0) {
  console.log('  No Q&A pairs identified by Claude, keeping only tables and Azure keyValuePairs');
  return otherBlocks;
}

// AFTER:
if (qaPairs.length === 0) {
  console.log('  No Q&A pairs identified by Claude, keeping all content');
  // Keep all blocks including paragraphs
  return [...otherBlocks, ...paragraphBlocks].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return a.yPosition - b.yPosition;
  });
}
```

#### Change 2: Keep unmatched paragraphs after Q&A extraction (lines 774-794)

```typescript
// BEFORE:
// ONLY keep Claude-identified Q&A pairs as keyvalue blocks
// Discard all other paragraphs to avoid showing noise (metadata, headers, etc.)
const newKeyValueBlocks: ContentBlock[] = [];

for (const pair of qaPairs) {
  // ... creates keyvalue blocks from Q&A pairs
}

// Combine: other blocks (tables, Azure keyValuePairs) + Claude-identified Q&A pairs only
// Do NOT keep remaining paragraphs - they're usually noise (headers, metadata, etc.)
const correctedBlocks = [...otherBlocks, ...newKeyValueBlocks];

// AFTER:
// Convert Claude-identified Q&A pairs to keyvalue blocks
const newKeyValueBlocks: ContentBlock[] = [];
const usedParagraphIndices = new Set<number>();

for (const pair of qaPairs) {
  const questionElement = paragraphBlocks[pair.questionIdx];
  usedParagraphIndices.add(pair.questionIdx);
  if (pair.answerIdx !== undefined) {
    usedParagraphIndices.add(pair.answerIdx);
  }

  newKeyValueBlocks.push({
    type: 'keyvalue',
    pageNumber: pair.pageNumber,
    yPosition: questionElement?.yPosition || 0,
    content: pair.question,
    kvValue: pair.answer,
    polygon: pair.questionBoundingBox,
  });
}

// Keep remaining paragraphs that weren't matched as Q&A
const remainingParagraphs = paragraphBlocks.filter((_, idx) => !usedParagraphIndices.has(idx));

// Combine ALL content: tables + Azure keyValuePairs + Claude Q&A pairs + remaining paragraphs
const correctedBlocks = [...otherBlocks, ...newKeyValueBlocks, ...remainingParagraphs];
```

#### Change 3: Keep paragraphs on error (lines 804-807)

```typescript
// BEFORE:
} catch (error) {
  console.error('  Error in Claude paragraph correction:', error);
  return otherBlocks;
}

// AFTER:
} catch (error) {
  console.error('  Error in Claude paragraph correction:', error);
  // On error, keep all content including paragraphs
  return [...otherBlocks, ...paragraphBlocks].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return a.yPosition - b.yPosition;
  });
}
```

## Acceptance Criteria

- [x] All paragraphs from Barry Callebaut RSPO section appear in indexed output
- [x] Instruction paragraph "The table in this section does not need to be completed..." is preserved
- [x] Content order matches PDF visual order (sorted by page + Y-position)
- [x] No regression in table extraction quality
- [x] Q&A pairs still correctly identified and marked as `keyvalue` type

## Testing

1. Re-index Barry Callebaut questionnaire: `pnpm cli index "Barry Callebaut US_Raw Material Questionnaire*.pdf" -c beneo`
2. Verify RSPO section in indexed JSON includes instruction paragraph
3. Check UI displays content in correct visual order
4. Spot-check other questionnaires for regressions

## Open Questions (from brainstorm)

- **contentType field:** Consider adding later if UI needs to render paragraph vs Q&A differently
- **UI rendering:** May need UI updates to display non-Q&A paragraphs appropriately
- **keyValuePairs:** Azure's keyValuePairs already handled separately, no change needed

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-02-25-pdf-content-preservation-brainstorm.md](../brainstorms/2026-02-25-pdf-content-preservation-brainstorm.md)
- Problem location: `src/services/extractors/pdf.ts:728-807`
- Key decisions: Extract all content, preserve order, filter later (YAGNI)
