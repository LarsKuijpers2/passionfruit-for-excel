# Questionnaire Extraction System - Master Plan

## Vision

A two-way intelligent questionnaire system:
1. **Extract**: Filled questionnaires → Structured Q&A → Answer Library
2. **Auto-fill**: Empty questionnaires → Identify fields → Fill from Library → Instant

**Target**: 99%+ accuracy with minimal human review

---

## Current State

### What Works Well
- Multi-format support (PDF, Excel, Word, HTML)
- Azure Document Intelligence for structure extraction
- Claude AI for Q&A interpretation
- ~99.5% accuracy on most documents

### What Needs Improvement
- Checkbox symbol handling (☒/☐ → Yes/No)
- Parent-child question grouping
- Answer options appearing as values ("Yes No N/A")
- Inconsistent patterns across document types

---

## Architecture: Modular Pipeline

Instead of one monolithic extraction, break into testable components:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOCUMENT INPUT                                │
│                 (PDF, Excel, Word, HTML)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 1: STRUCTURE EXTRACTION                                   │
│  ─────────────────────────────                                   │
│  Tool: Azure Document Intelligence / Excel Parser               │
│  Output: Raw cells with coordinates                              │
│  Trainable: No (use existing tools)                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 2: SECTION FINDER                                         │
│  ───────────────────────                                         │
│  Input: Raw cells                                                │
│  Output: Sections with boundaries                                │
│  Logic: Detect headers, group related rows                       │
│  Trainable: Yes (classification task)                           │
│  Training data needed: ~100-200 examples                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 3: CONTENT TYPE CLASSIFIER                                │
│  ────────────────────────────────                                │
│  Input: Section rows                                             │
│  Output: Type (table_qa, checklist, form_fields, matrix, text)  │
│  Logic: Pattern analysis of row structures                       │
│  Trainable: Yes (classification task)                           │
│  Training data needed: ~100-200 examples                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 4: TYPE-SPECIFIC EXTRACTORS                               │
│  ─────────────────────────────────                               │
│  Each type has specialized logic:                                │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │  TABLE Q&A   │ │  CHECKLIST   │ │ FORM FIELDS  │             │
│  │  Extractor   │ │  Extractor   │ │  Extractor   │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
│                                                                  │
│  Trainable: Yes (extraction task)                               │
│  Training data needed: ~200-500 examples per type               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 5: NORMALIZER                                             │
│  ───────────────────                                             │
│  Input: Raw extracted values                                     │
│  Output: Normalized values                                       │
│  Logic: ☒→Yes, ☐→No, date formats, phone formats, etc.          │
│  Trainable: Rules-based (no ML needed)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 6: TOPIC CLASSIFIER                                       │
│  ─────────────────────────                                       │
│  Input: Q&A pair + section context                              │
│  Output: Topic (certifications, allergens, quality, etc.)       │
│  Trainable: Yes (classification task)                           │
│  Training data needed: ~500-1000 examples                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 7: CONFIDENCE SCORER                                      │
│  ──────────────────────────                                      │
│  Input: All stage outputs                                        │
│  Output: Confidence score per item (0-100)                       │
│  Logic: Combine signals from each stage                          │
│  Use: Route to auto-approve vs human review                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  OUTPUT: Structured Q&A with confidence                          │
│  ───────────────────────────────────                             │
│  High confidence (>90%) → Auto-approve                          │
│  Medium (70-90%) → Quick review                                  │
│  Low (<70%) → Manual review                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Analysis & Baseline (Week 1)

**Goal**: Understand patterns and establish baseline metrics

**Tasks**:
1. [ ] Run pattern analyzer on ALL customers
2. [ ] Categorize all sections by content type
3. [ ] Run quality check on ALL customers
4. [ ] Calculate current accuracy metrics
5. [ ] Identify top 10 problem patterns

**Output**:
- Pattern analysis report per customer
- Baseline accuracy numbers
- Priority list of issues to fix

**Command to run**:
```bash
for customer in beneo kaas-pack "Taste Strik" "Doehler SVZ" "Doehler Oosterhout"; do
  npx tsx scripts/analyze-document-patterns.ts "$customer" --detailed
  npx tsx scripts/extraction-quality-check.ts "$customer" --verbose
done
```

---

### Phase 2: Quick Wins (Week 1-2)

**Goal**: Fix obvious issues with rules (no ML)

**Tasks**:
1. [ ] Checkbox normalization (☒→Yes, ☐→No)
2. [ ] "Yes No N/A" in value field → extract actual answer
3. [ ] Empty label row → link to parent question
4. [ ] Display improvements in UI

**Output**:
- Improved accuracy on ~80% of issues
- Better user experience

---

### Phase 3: Correction Infrastructure (Week 2-3)

**Goal**: Build the learning foundation

**Tasks**:
1. [ ] Add correction tracking to review UI
2. [ ] Store corrections in training format (JSONL)
3. [ ] Build correction analytics dashboard
4. [ ] Export corrections for fine-tuning

**Schema**:
```json
{
  "system": "You are an expert at extracting Q&A from documents...",
  "messages": [
    {"role": "user", "content": "<section context + raw cells>"},
    {"role": "assistant", "content": "<correct Q&A extraction>"}
  ]
}
```

**Output**:
- Every correction becomes a training example
- Dashboard showing correction patterns
- Export ready for fine-tuning

---

### Phase 4: Collect Training Data (Week 3-4)

**Goal**: Build sufficient dataset for fine-tuning

**Target volumes**:
| Component | Examples Needed | How to Collect |
|-----------|-----------------|----------------|
| Section finder | 200 | Manual labeling of section boundaries |
| Content classifier | 200 | Automated from pattern analysis + review |
| Table Q&A extractor | 500 | Corrections during review |
| Checklist extractor | 200 | Corrections during review |
| Topic classifier | 500 | Existing labeled data + corrections |

**Strategy**:
- Primary: Capture corrections during normal review work
- Secondary: Dedicated labeling sessions for gaps
- Tertiary: Synthetic data generation for edge cases

---

### Phase 5: Fine-Tune Components (Week 5-6)

**Goal**: Train specialized models per stage

**Approach**:
1. Start with highest-impact component (likely Table Q&A extractor)
2. Fine-tune Claude 3 Haiku on AWS Bedrock
3. A/B test against current approach
4. Measure accuracy improvement
5. If improved, deploy; if not, analyze why

**Fine-tuning settings**:
- Model: Claude 3 Haiku (cost-effective, fast)
- Format: JSONL with system/user/assistant
- Validation: 10-20% holdout set
- Epochs: Start with 1, increase if underfitting

---

### Phase 6: Integration & Confidence Scoring (Week 7-8)

**Goal**: Deploy fine-tuned components with smart routing

**Tasks**:
1. [ ] Integrate fine-tuned models into pipeline
2. [ ] Implement confidence scoring
3. [ ] Set up auto-approve thresholds
4. [ ] Build routing logic (auto vs review)
5. [ ] Monitor accuracy in production

**Confidence signals**:
- Model confidence from fine-tuned output
- Pattern matching confidence (known vs unknown patterns)
- Cross-validation (multiple extraction methods agree)
- Historical accuracy for similar documents

---

### Phase 7: Continuous Improvement (Ongoing)

**Goal**: System keeps getting better

**Feedback loop**:
```
Production → Corrections → Training Data → Re-train → Deploy → Production
     │                                                           │
     └─────────────────── Weekly cycle ──────────────────────────┘
```

**Metrics to track**:
- Auto-approve rate (target: >80%)
- Review time per document (target: <2 min)
- Correction rate (target: <1%)
- User satisfaction

---

## Key Decisions to Make

### 1. Fine-tune Claude vs Open Source?

| Option | Pros | Cons |
|--------|------|------|
| **Claude Haiku (Bedrock)** | Easy, high quality, your infra | Cost, vendor lock-in |
| **Open source (Llama/Mistral)** | Free, full control | Setup complexity, may need more data |

**Recommendation**: Start with Claude Haiku. It's available now, high quality, and you're already using Claude. Can migrate to open source later if cost becomes an issue.

### 2. How much to automate vs review?

**Recommendation**: Start conservative (more review), gradually increase automation as confidence grows.

| Phase | Auto-approve threshold | Expected auto-approve rate |
|-------|------------------------|---------------------------|
| Initial | >95% confidence | ~50% |
| After 1 month | >90% confidence | ~70% |
| After 3 months | >85% confidence | ~85% |

### 3. Train one model or many?

**Recommendation**: Multiple specialized models. Easier to debug, improve, and maintain. A failing checkbox extractor doesn't break the whole system.

---

## Success Metrics

| Metric | Current | 1 Month | 3 Months | 6 Months |
|--------|---------|---------|----------|----------|
| Accuracy | 99.5% | 99.5% | 99.7% | 99.9% |
| Auto-approve rate | 0% | 50% | 75% | 90% |
| Avg review time | 10 min? | 5 min | 2 min | <1 min |
| Corrections per doc | ? | <5 | <2 | <1 |

---

## Next Steps

1. **Today**: Run pattern analysis on all customers
2. **This week**: Implement quick wins (checkbox, display)
3. **Next week**: Add correction tracking to UI
4. **Week 3-4**: Collect training data through normal review
5. **Week 5**: First fine-tuning experiment

---

## Files Created

| File | Purpose |
|------|---------|
| `scripts/extraction-quality-check.ts` | Analyze indexed files for issues |
| `scripts/analyze-document-patterns.ts` | Analyze structure patterns |
| `src/services/learning/correction-tracker.ts` | Track corrections for training |
| `knowledge/extraction-learning-plan.md` | Detailed learning approach |
| `EXTRACTION-SYSTEM-PLAN.md` | This master plan |
