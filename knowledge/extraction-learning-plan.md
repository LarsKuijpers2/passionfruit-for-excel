# Extraction Learning Plan

## Vision
A two-way questionnaire system:
1. **Extract** (inbound): Filled questionnaire → Extract Q&A → Build answer library
2. **Auto-fill** (outbound): Empty questionnaire → Identify cells → Fill from library → Instant

## Goals
- **Short-term**: 5 min review per questionnaire acceptable
- **Long-term**: Instant processing, minimal/no review
- **Accuracy target**: 99%+ (wrong auto-fills are unacceptable)

## Current State
- **Document types**: PDF, Word, Excel, HTML
- **Pipeline**: Document → Structure (raw extraction) → Indexed (AI-processed Q&A)
- **Current accuracy**: ~99.5% (17 issues in 5500+ items across all customers)
- **Pain points**: Checkboxes, parent-child relationships, answer options in labels

## The Two Flows

### Flow 1: Extraction (Inbound)
```
Filled Questionnaire → Parse Structure → AI Extract Q&A → Review → Library
```
Challenges:
- Reading handwriting/scans
- Checkbox detection
- Parent-child grouping
- Multi-format support

### Flow 2: Auto-Fill (Outbound)
```
Empty Questionnaire → Identify Fields → Match to Library → Fill → Customer Review
```
Challenges:
- Cell/field identification in empty docs
- Question matching (semantic similarity)
- Confidence scoring (don't fill if unsure)
- Format preservation (checkboxes, dropdowns, text)

## Error Sources
1. **Raw extraction errors** - Azure DI / parser misreads document
2. **Structural errors** - Correct text but wrong cell/row mapping
3. **Interpretation errors** - AI misunderstands what's a question vs answer
4. **Edge cases** - Unusual formats, merged cells, strikethrough text
5. **Matching errors** - Wrong library answer matched to question

## Approaches to 99% Accuracy

### Option A: Rule-Based Post-Processing
**How it works**: Detect and fix known patterns after extraction
**Pros**: Fast, predictable, no training needed
**Cons**: Only fixes known issues, doesn't generalize
**Effort**: Low
**Ceiling**: ~99.5% (handles known patterns)

### Option B: Feedback Loop Learning
**How it works**:
- Track every correction made during review
- Analyze patterns in corrections
- Generate rules or prompts from patterns
- Apply to future extractions

**Pros**: Improves over time, learns from real mistakes
**Cons**: Needs volume of corrections, slow to improve
**Effort**: Medium
**Ceiling**: ~99.7% (learns from actual usage)

### Option C: Multi-Stage Validation
**How it works**:
- Stage 1: Primary extraction (Azure DI / Excel parser)
- Stage 2: AI interpretation (Claude)
- Stage 3: Vision verification (Claude Vision on original)
- Stage 4: Cross-check discrepancies
- Confidence score per item

**Pros**: Catches different error types, high accuracy
**Cons**: Slower, more expensive (multiple AI calls)
**Effort**: Medium-High
**Ceiling**: ~99.8%

### Option D: Fine-Tuned Model
**How it works**:
- Collect training data from corrected extractions
- Fine-tune extraction model on your specific documents
- Deploy custom model

**Pros**: Highest potential accuracy, fast inference
**Cons**: Needs significant training data, maintenance burden
**Effort**: High
**Ceiling**: ~99.9%

### Option E: Document Classification + Specialized Extractors
**How it works**:
- First classify document type (supplier audit, product spec, certification request, etc.)
- Apply specialized extraction logic per type
- Each type has its own patterns and validation rules

**Pros**: Better handling of diverse formats
**Cons**: Need to maintain multiple extractors
**Effort**: Medium-High
**Ceiling**: ~99.7%

## Recommended Approach

### Phase 1: Quick Wins (Week 1)
- [x] Quality check script to identify issues
- [ ] Checkbox normalization (☒→Yes, ☐→No)
- [ ] Filter display of empty-label rows
- [ ] Clean up "Yes No N/A" in answer fields

### Phase 2: Feedback Infrastructure (Week 2-3)
- [ ] Track all corrections made in review UI
- [ ] Store correction history per questionnaire
- [ ] Build correction analytics dashboard
- [ ] Identify top 10 recurring error patterns

### Phase 3: Learning Loop (Week 4-6)
- [ ] Generate rules from correction patterns
- [ ] Add rules to indexing prompts
- [ ] A/B test: with vs without learned rules
- [ ] Measure accuracy improvement

### Phase 4: Vision Validation (Week 6-8)
- [ ] Run Vision check on all PDFs automatically
- [ ] Confidence scoring per item
- [ ] Auto-apply high-confidence Vision corrections
- [ ] Flag low-confidence for human review

### Phase 5: Continuous Improvement
- [ ] Weekly accuracy metrics
- [ ] Monthly rule review
- [ ] Quarterly model evaluation (fine-tune vs prompts)

## Metrics to Track

| Metric | Current | Target |
|--------|---------|--------|
| Items needing correction | ~0.5% | <1% |
| Review time per questionnaire | ? min | <5 min |
| Auto-approved rate | 0% | >80% |
| Vision agreement rate | ? | >95% |

## Key Questions to Answer

1. **What's the current review time?** (baseline)
2. **What % of corrections are the same pattern?** (learning potential)
3. **How often does Vision disagree with base extraction?** (validation value)
4. **Which document types have most errors?** (focus areas)

## Roadmap to Fine-Tuned Model

### Stage 1: Data Collection (Now - 2 weeks)
**Goal**: Build high-quality training dataset from corrections

- [ ] Add correction tracking to review UI
- [ ] Log: original extraction → human correction → reason
- [ ] Track cell coordinates, document type, section context
- [ ] Target: 1000+ correction examples

**Output**: `training-data/corrections.jsonl`

### Stage 2: Pattern Analysis (Week 2-3)
**Goal**: Understand error patterns before fine-tuning

- [ ] Cluster corrections by error type
- [ ] Identify: Which document types have most errors?
- [ ] Identify: Which question patterns are hardest?
- [ ] Build test set of "hard cases"

**Output**: Error taxonomy, test benchmark

### Stage 3: Baseline Measurement (Week 3)
**Goal**: Establish metrics to beat

- [ ] Run current pipeline on test set
- [ ] Measure: Extraction accuracy, field identification, matching accuracy
- [ ] Establish baseline numbers

**Output**: Baseline metrics dashboard

### Stage 4: Model Fine-Tuning (Week 4-6)
**Goal**: Train custom model on your data

Options:
1. **Fine-tune Claude** (if available via API)
2. **Fine-tune open model** (Llama, Mistral) for extraction
3. **Train specialized model** for field detection

- [ ] Prepare training data in model format
- [ ] Fine-tune on extraction task
- [ ] Fine-tune on field matching task
- [ ] Evaluate on test set

**Output**: Fine-tuned model, comparison metrics

### Stage 5: Production Pipeline (Week 6-8)
**Goal**: Deploy fine-tuned model in production

- [ ] A/B test: fine-tuned vs current
- [ ] Gradual rollout with confidence thresholds
- [ ] Auto-approve high-confidence extractions
- [ ] Human review only for low-confidence

**Output**: Production system with <1% error rate

### Stage 6: Continuous Learning (Ongoing)
**Goal**: Keep improving from production feedback

- [ ] Log all corrections in production
- [ ] Weekly re-training on new data
- [ ] Monitor accuracy metrics
- [ ] Alert on accuracy drops

## Immediate Next Steps

1. **Build correction tracking** into review UI
2. **Create feedback loop script** that learns from corrections
3. **Start collecting training data** from every review session
4. **Quick wins** in parallel: checkbox fixes, display cleanup

## Architecture for Learning

```
┌─────────────────────────────────────────────────────────┐
│                    REVIEW UI                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Original  │  │   Indexed   │  │   Library   │     │
│  │   Document  │  │    Items    │  │   Matches   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                         │                               │
│              User makes correction                      │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  CORRECTION LOG                                  │   │
│  │  - item_id, original, corrected, reason         │   │
│  │  - document_type, section, cell_ref             │   │
│  │  - timestamp, user                              │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                 LEARNING PIPELINE                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Analyze │→ │ Generate │→ │  Update  │              │
│  │ Patterns │  │  Rules   │  │  Model   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              IMPROVED EXTRACTION                         │
│  Next questionnaire benefits from learned patterns      │
└─────────────────────────────────────────────────────────┘
```

## Training Data Schema

```typescript
interface CorrectionRecord {
  id: string;
  timestamp: string;

  // Source document
  documentType: 'pdf' | 'excel' | 'word' | 'html';
  documentPath: string;
  customer: string;

  // Original extraction
  original: {
    label: string;
    value: string;
    cellRef?: string;
    section?: string;
    topic?: string;
    confidence?: number;
  };

  // Human correction
  corrected: {
    label?: string;      // if label was wrong
    value?: string;      // if value was wrong
    destination?: string; // if categorization was wrong
    shouldExclude?: boolean; // if item shouldn't exist
  };

  // Context for learning
  errorType: 'extraction' | 'interpretation' | 'matching' | 'structural';
  reason?: string;       // human explanation

  // For fine-tuning
  context: {
    surroundingCells?: string[];
    sectionTitle?: string;
    pageNumber?: number;
    visualFeatures?: string[]; // checkbox, table, freetext
  };
}
```
