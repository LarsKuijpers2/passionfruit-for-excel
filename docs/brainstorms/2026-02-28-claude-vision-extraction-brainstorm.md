---
date: 2026-02-28
topic: claude-vision-extraction
---

# Claude Vision PDF Extraction

## What We're Building

A two-pass PDF extraction pipeline using Claude Vision that replaces the current Azure OCR approach for complex questionnaires.

**The problem:** Current pipeline (Azure OCR → cell-by-cell JSON → Claude post-processing) produces poor results on complex questionnaire layouts. When the same PDFs are uploaded to Claude Chat with simple prompts like "extract this to markdown", the results are 99% accurate.

**The solution:** Replicate what Claude Chat does:
1. Convert PDF to page images
2. Send images to Claude Vision for structure extraction
3. Parse the structure to extract Q&A pairs

## Why This Approach

### Approaches Considered

**Option A: Keep Azure OCR, improve Claude post-processing**
- Azure gives consistent but often wrong results for complex layouts
- Adding more post-processing logic creates fragile code
- Rejected: treating symptoms, not the cause

**Option B: Direct PDF → Claude → JSON (one-pass)**
- Simpler pipeline, fewer API calls
- Risk: Claude must understand structure AND extract Q&A simultaneously
- If structure is misunderstood, can't recover

**Option C: Two-pass Claude Vision (chosen)**
- Pass 1: Claude focuses on understanding document structure
- Pass 2: Claude focuses on extracting Q&A from that structure
- More debuggable, each step can be fixed independently
- Matches what worked in Claude Chat testing

### Why Two-Pass Wins

1. **Accuracy is the priority** - user explicitly stated cost/speed are secondary
2. **Separation of concerns** - structure understanding ≠ Q&A extraction
3. **Debuggability** - can see what each pass produced, fix issues precisely
4. **Proven to work** - Claude Chat with simple prompts achieved 99% accuracy

## Key Decisions

### 1. Two-Pass Architecture
- **Pass 1 (Extraction):** PDF pages → Claude Vision → Structured representation
- **Pass 2 (Indexing):** Structure → Claude → Q&A pairs in JSON

**Rationale:** Complex questionnaires benefit from Claude first understanding the layout (tables, checkboxes, sections) before making extraction decisions.

### 2. Intermediate Format: Keep Flexible
- Start with structured JSON or markdown from Pass 1
- Don't force HTML unless needed for UI rendering
- The accuracy comes from Claude seeing the images, not from the output format

**Rationale:** HTML was initially considered for debugging/UI, but adds complexity. Save intermediate output for debugging, but don't require specific format.

### 3. Feedback Loop: Layered Approach
- **Layer 1 (Immediate):** Few-shot examples from corrections fed into prompts
- **Layer 2 (Pattern-based):** Detect correction patterns, add post-processing rules
- **Layer 3 (Future):** Collect training data for potential fine-tuning

**Rationale:** Start simple (few-shot), add complexity as patterns emerge, save data for future model training.

### 4. Large Documents: Edge Case Handling
- Most questionnaires are <20 pages (fits in context window)
- For 50+ pages: batch by section or page ranges, merge results
- Don't over-optimize for rare cases

**Rationale:** Design for the common case, handle edge cases when they occur.

### 5. Keep Current Pipeline Working
- Branch off for new approach
- Don't break existing functionality
- Compare results side-by-side

**Rationale:** Current approach works reasonably well for some documents. New approach is experimental until validated.

## Data to Capture

For the feedback loop to work, save:
1. **Original PDF** - source of truth
2. **Pass 1 output** - what Claude understood about structure
3. **Pass 2 output** - extracted Q&A pairs
4. **User corrections** - what was changed in review

This enables all three feedback layers (few-shot, rules, fine-tuning).

## Open Questions

None currently - all major decisions clarified.

## Next Steps

→ `/workflows:plan` to design the implementation:
- New extractor module using Claude Vision
- Prompts for Pass 1 (structure) and Pass 2 (Q&A extraction)
- Integration with existing pipeline (parallel path)
- Feedback data capture
