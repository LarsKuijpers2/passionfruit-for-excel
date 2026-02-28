---
date: 2026-02-25
topic: pdf-content-preservation
---

# PDF Content Preservation - Stop Discarding Paragraphs

## What We're Building

Fix the PDF extraction pipeline to preserve ALL content from documents instead of discarding paragraphs as "noise". The goal is to match the PDF visual structure in the view component - every paragraph, instruction, header, and Q&A pair should appear in the extracted output in document order.

Currently, `pdf.ts:775-793` discards all paragraphs that aren't identified as Q&A pairs by Claude Vision. This loses valuable content like instruction paragraphs, contextual notes, and any content that doesn't fit the Q&A pattern.

## Why This Approach

**Approaches considered:**

1. **Smart paragraph classification** - Classify paragraphs as instruction/header/qa/metadata using rules
   - Rejected: Too complex, rules will miss edge cases, premature optimization

2. **Always use Claude Vision for pairing** - Run Claude on every page
   - Rejected: Expensive, slow, and still doesn't solve the "discard non-Q&A" problem

3. **Extract everything, filter later** (CHOSEN)
   - Keep all content from Azure in document order
   - Let the questionnaire-indexer do semantic analysis
   - Let the UI render content matching PDF structure
   - Simple, robust, no data loss

**Why this approach wins:**
- YAGNI - don't make filtering decisions during extraction
- The indexer already uses Claude for semantic understanding
- Preserves all potentially relevant info
- Easier to filter later than recover lost data

## Key Decisions

- **Extract all paragraphs**: Remove the "discard as noise" logic entirely
- **Preserve document order**: Content sorted by page + Y-position (already works)
- **Keep position metadata**: Page number, Y-position, bounding box for each item
- **No layout assumptions**: Don't assume Q&A is horizontal or vertical - capture raw content
- **Downstream filtering**: Let indexer/UI decide what's relevant, not the extractor

## Technical Context

**Problem location:** `src/services/extractors/pdf.ts:775-793`

```typescript
// Current code (PROBLEMATIC):
// Discard all other paragraphs to avoid showing noise (metadata, headers, etc.)
// Do NOT keep remaining paragraphs - they're usually noise

// This discards:
// - Instruction paragraphs
// - Section context
// - Any content not matched as Q&A
```

**What Azure provides:**
- Tables (well-structured, works fine)
- Paragraphs (with bounding boxes - currently discarded)
- Lines (raw text lines)
- KeyValuePairs (Azure's native K-V detection)

**What we're losing:**
- "The table in this section does not need to be completed in case the product is not RSPO certified."
- Section headers that aren't in tables
- Contextual notes, disclaimers, guidance text
- Any Q&A pair that Claude Vision didn't identify

## Content Types to Preserve

| Type | Example | Currently Handled |
|------|---------|-------------------|
| Tables | Component lists, checklists | Yes |
| Q&A pairs | "Is RSPO certified?" → "No" | Partially (some lost) |
| Instructions | "Complete only if applicable" | No - discarded |
| Section headers | "Composition - RSPO" | Inconsistent |
| Contextual notes | Disclaimers, definitions | No - discarded |
| Empty fields | Labels without values | Inconsistent |

## Open Questions

- Should we add a `contentType` field to distinguish paragraphs from Q&A in the output?
- How should the UI render non-Q&A paragraphs differently from Q&A items?
- Should we keep Azure's `keyValuePairs` separate or merge with paragraphs?

## Success Criteria

1. All paragraphs from Barry Callebaut RSPO section appear in indexed output
2. Instruction paragraph "The table in this section does not need to be completed..." is preserved
3. Content order matches PDF visual order
4. No regression in table extraction quality

## Next Steps

→ `/workflows:plan` to create implementation plan with specific file changes
