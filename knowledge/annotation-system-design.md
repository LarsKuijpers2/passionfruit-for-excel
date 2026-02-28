# Annotation System Design for Document Extraction

## Research Summary

Based on industry best practices from [Scale AI](https://scale.com/guides/data-labeling-annotation-guide), [Parseur HITL Guide](https://parseur.com/blog/hitl-best-practices), [Label Studio](https://labelstud.io/), [Prodigy](https://prodi.gy/), and academic research on [Active Learning](https://lilianweng.github.io/posts/2022-02-20-active-learning/).

---

## The Core Problem

Current workflow:
```
Structure (raw) → Indexed (AI) → Review UI → Only see AI output
                                              Can't see what's MISSING
                                              Can't see original cells
```

What we need:
```
Structure (raw) → Indexed (AI) → Review UI → See BOTH original and extracted
                                              Identify missing items
                                              Correct at cell level
                                              Feedback improves model
```

---

## Best Practice #1: Pre-Annotation + Human Review

**Don't label from scratch. Let AI pre-annotate, humans correct.**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Document   │ ──► │  AI Pre-    │ ──► │   Human     │
│  (raw)      │     │  Annotation │     │   Review    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           └───── 80% done ────┘
                                 Human fixes 20%
```

**Why this works:**
- Humans are bad at labeling from scratch (slow, inconsistent)
- Humans are good at spotting errors (fast, accurate)
- AI does the heavy lifting, humans quality-check

**We already have this!** Our indexed output IS the pre-annotation. We just need a better review interface.

---

## Best Practice #2: Side-by-Side Comparison Interface

**The review interface must show original and extracted together.**

```
┌─────────────────────────────────────────────────────────────────┐
│                     REVIEW INTERFACE                             │
├────────────────────────────┬────────────────────────────────────┤
│   ORIGINAL DOCUMENT        │   EXTRACTED DATA                    │
│   (PDF/Excel view)         │   (Editable list)                  │
│                            │                                     │
│   ┌─────────────────┐      │   ┌─────────────────────────────┐  │
│   │ Company: Beneo  │◄─────┼──►│ ✓ Company Name: Beneo       │  │
│   │ Address: Mann.. │◄─────┼──►│ ✓ Address: Mannheim         │  │
│   │ Phone: +49 621  │      │   │ ✗ (not extracted)           │  │
│   │ BRC: ☒          │◄─────┼──►│ ✓ BRC Certified: Yes        │  │
│   └─────────────────┘      │   └─────────────────────────────┘  │
│                            │                                     │
│   [Click cell to link]     │   [Add Missing] [Edit] [Delete]    │
└────────────────────────────┴────────────────────────────────────┘
```

**Key interactions:**
1. Click extracted item → highlights source in original
2. Click original cell → shows if/how it was extracted
3. Double-click to edit extracted value
4. "Add Missing" button to add items from original

---

## Best Practice #3: Confidence-Based Prioritization

**Don't review everything equally. Focus on uncertain items.**

| Confidence | Action | % of Items |
|------------|--------|------------|
| >95% | Auto-approve (no review) | ~70% |
| 80-95% | Quick review (spot check) | ~20% |
| <80% | Full review (human validates) | ~10% |

**This reduces review time by 70%** while maintaining quality.

**How to calculate confidence:**
- Model confidence (if available)
- Pattern matching score (known vs unknown patterns)
- Section type confidence (table_qa vs unknown)
- Historical accuracy for similar items

---

## Best Practice #4: Active Learning Loop

**Let corrections improve the model iteratively.**

```
┌─────────────────────────────────────────────────────────────────┐
│                    ACTIVE LEARNING LOOP                          │
│                                                                  │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐  │
│   │ Extract │ ──► │ Review  │ ──► │ Collect │ ──► │ Retrain │  │
│   │         │     │         │     │ Errors  │     │ Model   │  │
│   └─────────┘     └─────────┘     └─────────┘     └─────────┘  │
│        ▲                                               │        │
│        └───────────────────────────────────────────────┘        │
│                     Model improves each cycle                    │
└─────────────────────────────────────────────────────────────────┘
```

**Uncertainty Sampling:**
After each batch, identify items where model is most uncertain and prioritize those for next review round. This targets the most valuable examples for training.

---

## Best Practice #5: Track Metrics

**Measure to improve.**

| Metric | What it tells you |
|--------|-------------------|
| **Override rate** | How often humans change AI output |
| **Override by field type** | Which extractions are weakest |
| **Time per review** | UI efficiency |
| **Inter-annotator agreement** | Consistency of corrections |
| **Accuracy over time** | Is the model improving? |

---

## Recommended Interface Design

### View 1: Document Overview
```
┌─────────────────────────────────────────────────────────────────┐
│  📄 Questionnaire: Barry_Callebaut_Supplier_Audit.pdf           │
│  ────────────────────────────────────────────────────────────   │
│  Extraction confidence: 87%    Sections: 12    Items: 156       │
│  ────────────────────────────────────────────────────────────   │
│                                                                  │
│  ⚠️ 8 items need review (confidence <80%)                       │
│  ✓ 142 items auto-approved                                      │
│  ❓ 6 potential missing items detected                          │
│                                                                  │
│  [Review Uncertain Items]  [Review All]  [View Missing]         │
└─────────────────────────────────────────────────────────────────┘
```

### View 2: Side-by-Side Review
```
┌──────────────────────────────┬───────────────────────────────────┐
│  ORIGINAL                    │  EXTRACTED                         │
│  ──────────────────────────  │  ─────────────────────────────     │
│                              │                                     │
│  Section: Certifications     │  Section: Certifications           │
│  ┌────────────────────────┐  │  ┌─────────────────────────────┐  │
│  │ Row 45: BRC | ☒        │◄─┼──│ BRC Certified: Yes    [95%] │  │
│  │ Row 46: IFS | ☐        │◄─┼──│ IFS Certified: No     [94%] │  │
│  │ Row 47: FSSC | ☒       │◄─┼──│ FSSC 22000: Yes       [93%] │  │
│  │ Row 48: Valid until    │  │  │ ⚠️ NOT EXTRACTED      [--]  │  │
│  │         2025-12-31     │  │  │    [Add This Item]           │  │
│  └────────────────────────┘  │  └─────────────────────────────┘  │
│                              │                                     │
│  [◄ Prev Section]            │            [Next Section ►]        │
└──────────────────────────────┴───────────────────────────────────┘
```

### View 3: Quick Correction Mode
```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ LOW CONFIDENCE ITEMS (8 items need review)                  │
│  ────────────────────────────────────────────────────────────   │
│                                                                  │
│  1/8: "Certificate valid until" → "2025-12-31"                  │
│       Confidence: 62%  |  Reason: Date format unclear           │
│       ┌─────────────────────────────────────────────────────┐   │
│       │  Original cell: "Gültig bis: 31.12.2025"            │   │
│       └─────────────────────────────────────────────────────┘   │
│                                                                  │
│       [✓ Correct]  [✎ Edit]  [✗ Delete]  [Skip]                 │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  Progress: ████████░░ 75%                     [Finish Review]   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Missing Item Detection

**Automatically find cells that should have been extracted but weren't.**

Algorithm:
1. For each cell in structure (original):
   - Check if it matches an indexed item (fuzzy match)
   - If no match found AND cell looks like Q&A (has question mark, reasonable length)
   - Flag as "potential missing"

2. Present to user:
   - "We found 6 cells that might be missing from extraction"
   - Show each, let user confirm or dismiss

---

## Correction Data Format

Every correction logged for training:

```json
{
  "id": "corr_123",
  "timestamp": "2024-02-20T15:30:00Z",
  "document": {
    "path": "customers/beneo/structure/Barry_Callebaut.json",
    "type": "pdf"
  },
  "action": "value_corrected",
  "original": {
    "cellRef": "B45",
    "label": "BRC Certified",
    "value": "☒",
    "confidence": 0.72
  },
  "corrected": {
    "value": "Yes"
  },
  "context": {
    "section": "Certifications",
    "surroundingCells": ["IFS: ☐", "FSSC: ☒"]
  }
}
```

---

## Implementation Recommendation

### Phase 1: Enhance Existing UI (1-2 weeks)
Add to current Review UI:
- [ ] "Original Panel" showing structure data
- [ ] Click-to-highlight linking between original and extracted
- [ ] "Add Missing Item" from original cells
- [ ] Correction logging (every edit tracked)

### Phase 2: Confidence Scoring (1 week)
- [ ] Add confidence score to each extracted item
- [ ] Sort by confidence (uncertain first)
- [ ] Auto-approve threshold setting

### Phase 3: Missing Detection (1 week)
- [ ] Algorithm to find unextracted cells
- [ ] "Missing Items" view
- [ ] One-click add to extracted

### Phase 4: Active Learning (2 weeks)
- [ ] Uncertainty sampling: prioritize uncertain items
- [ ] Batch retraining workflow
- [ ] Accuracy tracking dashboard

---

## Tools Considered

| Tool | Pros | Cons | Recommendation |
|------|------|------|----------------|
| **Label Studio** | Free, open-source, flexible | Setup complexity | Good for standalone labeling |
| **Prodigy** | Best UX, active learning built-in | $390/seat, single user | Good for power users |
| **Custom UI** | Integrated with our system, tailored workflow | Build effort | **Best for our case** |

**Recommendation: Build custom UI** because:
1. We already have a Review UI
2. Our workflow is specific (pre-annotation → review)
3. Integration with our pipeline is critical
4. Active learning needs tight coupling

---

## Summary: Senior ML Expert Approach

1. **Don't label from scratch** - Use AI pre-annotation, humans correct
2. **Side-by-side interface** - Always show original next to extracted
3. **Confidence-based routing** - Auto-approve high confidence, focus review on uncertain
4. **Track corrections** - Every edit becomes training data
5. **Active learning loop** - Prioritize uncertain items, retrain, repeat
6. **Measure everything** - Override rates, accuracy, time per review

The goal is not to label 1000 examples. The goal is to build a system that gets better with every correction, so eventually you need fewer and fewer corrections.
