# Extraction Pipeline Design

## Overview

A 6-stage pipeline with metrics and learning at each step.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTRACTION PIPELINE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐│
│  │    1     │    │    2     │    │    3     │    │    4     │    │   5   ││
│  │ EXTRACT  │───▶│ STRUCTURE│───▶│  Q&A     │───▶│ CLASSIFY │───▶│VALIDATE│
│  │          │    │          │    │          │    │          │    │       ││
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘    └───┬───┘│
│       │               │               │               │              │     │
│       ▼               ▼               ▼               ▼              ▼     │
│   [metrics]       [metrics]       [metrics]       [metrics]      [metrics] │
│   [learning]      [learning]      [learning]      [learning]     [learning]│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                              ┌──────────────┐
                              │   6. REVIEW  │
                              │   (Human)    │
                              └──────┬───────┘
                                     │
                                     ▼
                              [corrections]
                                     │
                              ┌──────┴──────┐
                              │  LEARNING   │
                              │   SYSTEM    │
                              └─────────────┘
```

---

## Stage 1: EXTRACT

**Goal**: Get all content out of the document (PDF, Excel, Word, HTML)

### Input
- Raw document file

### Output
```typescript
interface RawDocument {
  source: string;
  documentType: 'pdf' | 'excel' | 'word' | 'html';
  extractedAt: string;
  pages: RawPage[];
  extractionMethod: string;  // 'azure_di' | 'excel_parser' | 'pdf_parse'
  extractionDuration: number; // ms
}

interface RawPage {
  pageNumber: number;
  elements: Array<RawTable | RawTextBlock>;
}
```

### Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| `extraction_success` | Did extraction complete without error? | 100% |
| `tables_found` | Number of tables detected | > 0 for questionnaires |
| `text_blocks_found` | Number of text blocks | varies |
| `empty_cells_ratio` | % of cells that are empty | < 50% |
| `extraction_time_ms` | Time to extract | < 30s |

### Learning
- Track documents that fail extraction → improve extractor
- Track documents with low table count → might need different method
- Compare Azure DI vs pdf-parse results → choose best method per doc type

---

## Stage 2: STRUCTURE

**Goal**: Identify table patterns and document structure

### Input
- RawDocument from Stage 1

### Output
```typescript
interface StructuredDocument {
  source: string;
  language: string;
  documentPattern: string;  // 'supplier_questionnaire', 'product_spec', etc.
  tables: StructuredTable[];
  textBlocks: TextBlock[];
  structureConfidence: number;
}

interface StructuredTable {
  id: string;
  pattern: string;  // 'STANDARD_YESNO_EN', 'SIMPLE_KEYVALUE', etc.
  patternConfidence: number;
  headers: string[];
  columnRoles: ColumnRole[];  // 'question', 'yes', 'no', 'comment', 'value'
  dataRows: DataRow[];
  sectionTitle?: string;
}
```

### Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| `pattern_match_rate` | % of tables with matched pattern | > 90% |
| `avg_pattern_confidence` | Average confidence of matches | > 0.7 |
| `unknown_patterns` | Tables with no pattern match | < 10% |
| `language_detected` | Was language identified? | 100% |

### Learning
- Track unmatched table headers → discover new patterns
- Track low-confidence matches → improve detection rules
- Track pattern distribution → understand document types

---

## Stage 3: Q&A IDENTIFICATION

**Goal**: Extract question/answer pairs from structured tables

### Input
- StructuredDocument from Stage 2

### Output
```typescript
interface ExtractedItems {
  source: string;
  items: ExtractedItem[];
  extractionStats: {
    totalRows: number;
    itemsExtracted: number;
    skippedRows: number;
    lowConfidenceItems: number;
  };
}

interface ExtractedItem {
  id: string;
  type: 'yesno' | 'text' | 'field' | 'choice' | 'date' | 'signature';
  label: string;
  value: string | null;
  comment?: string;
  confidence: number;
  source: {
    tableId: string;
    rowIndex: number;
    cellRefs: { label: string; value: string };
  };
  flags: string[];  // 'low_confidence', 'missing_value', 'unusual_format'
}
```

### Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| `items_per_table` | Average items extracted per table | varies by pattern |
| `value_fill_rate` | % of items with non-empty value | > 70% |
| `avg_confidence` | Average item confidence | > 0.8 |
| `flagged_items_rate` | % of items with flags | < 15% |
| `checkbox_detection_rate` | For Yes/No tables, did we detect the answer? | > 95% |

### Learning
- Track items with missing values → improve value extraction
- Track low-confidence items → identify hard cases
- Track checkbox misdetection → improve checkbox logic

---

## Stage 4: CLASSIFY

**Goal**: Assign topic, destination, entity role to each item

### Input
- ExtractedItems from Stage 3

### Output
```typescript
interface ClassifiedItems {
  source: string;
  items: ClassifiedItem[];
  entities: DetectedEntity[];
  products: DetectedProduct[];
}

interface ClassifiedItem extends ExtractedItem {
  topic: string;  // 'quality', 'allergens', 'certifications', etc.
  destination: 'answer_library' | 'company' | 'product' | 'exclude';
  level: 'standard' | 'narrative' | 'metadata';
  entityRole?: 'supplier' | 'manufacturer' | 'customer';
  entityId?: string;
  productId?: string;
}
```

### Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| `topic_assignment_rate` | % of items with topic assigned | 100% |
| `destination_distribution` | Breakdown by destination | balanced |
| `entity_detection_rate` | % of company items linked to entity | > 90% |
| `exclude_rate` | % of items marked exclude | < 30% |

### Learning
- Track destination corrections → improve classification rules
- Track entity detection misses → improve entity patterns
- Track topic misassignments → update topic keywords

---

## Stage 5: VALIDATE

**Goal**: Check for issues and flag problems

### Input
- ClassifiedItems from Stage 4

### Output
```typescript
interface ValidatedDocument {
  source: string;
  items: ValidatedItem[];
  validationReport: {
    totalItems: number;
    issueCount: number;
    issuesByType: Record<string, number>;
    qualityScore: number;  // 0-100
  };
}

interface ValidatedItem extends ClassifiedItem {
  issues: ValidationIssue[];
  needsReview: boolean;
}

interface ValidationIssue {
  type: string;  // 'MISSING_VALUE', 'DUPLICATE_QUESTION', 'ORPHAN_FOLLOWUP', etc.
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}
```

### Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| `quality_score` | Overall document quality | > 85 |
| `items_needing_review` | % flagged for human review | < 20% |
| `issues_per_document` | Average issues per doc | < 10 |
| `issue_distribution` | Breakdown by issue type | track trends |

### Learning
- Track issue patterns → improve earlier stages
- Track false positive flags → tune validation rules
- Track quality score trends → measure improvement

---

## Stage 6: REVIEW (Human)

**Goal**: Human validates and corrects extraction

### Input
- ValidatedDocument from Stage 5

### Output
```typescript
interface ReviewedDocument {
  source: string;
  items: ReviewedItem[];
  reviewStats: {
    itemsReviewed: number;
    correctionsCount: number;
    approvedCount: number;
    reviewTimeSeconds: number;
  };
}

interface ReviewedItem extends ValidatedItem {
  reviewed: boolean;
  approved: boolean;
  corrections?: {
    field: string;
    original: string;
    corrected: string;
    reason?: string;
  }[];
}
```

### Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| `correction_rate` | % of items needing correction | < 5% |
| `auto_approve_rate` | % approved without changes | > 80% |
| `review_time_per_doc` | Time spent reviewing | < 5 min |
| `corrections_by_type` | What gets corrected most | track |

### Learning
- **This is the gold mine for learning**
- Every correction becomes training data
- Pattern: original → corrected → reason
- Feed back to all earlier stages

---

## Metrics Dashboard

### Per-Document Metrics
```typescript
interface DocumentMetrics {
  source: string;
  customer: string;
  processedAt: string;

  // Stage metrics
  extraction: {
    method: string;
    duration: number;
    tablesFound: number;
    success: boolean;
  };

  structure: {
    patternsDetected: string[];
    patternMatchRate: number;
    unknownTables: number;
  };

  qa: {
    itemsExtracted: number;
    valuesFillRate: number;
    avgConfidence: number;
  };

  classification: {
    topicsCovered: string[];
    destinationBreakdown: Record<string, number>;
    entitiesDetected: number;
  };

  validation: {
    qualityScore: number;
    issueCount: number;
    needsReviewCount: number;
  };

  review: {
    correctionCount: number;
    reviewTime: number;
    approved: boolean;
  };
}
```

### Aggregate Metrics (Per Customer / Overall)
```typescript
interface AggregateMetrics {
  period: string;  // 'day', 'week', 'month'

  // Volume
  documentsProcessed: number;
  itemsExtracted: number;

  // Quality
  avgQualityScore: number;
  correctionRate: number;
  autoApproveRate: number;

  // Efficiency
  avgReviewTime: number;
  avgProcessingTime: number;

  // Learning
  newPatternsDiscovered: number;
  rulesUpdated: number;

  // Trends
  qualityTrend: 'improving' | 'stable' | 'declining';
  correctionTrend: 'improving' | 'stable' | 'declining';
}
```

---

## Learning System

### Correction Tracking
Every correction is logged:
```typescript
interface Correction {
  timestamp: string;
  source: string;
  stage: 'structure' | 'qa' | 'classification' | 'validation';
  itemId: string;

  original: {
    field: string;
    value: any;
  };

  corrected: {
    value: any;
  };

  context: {
    label: string;
    pattern: string;
    tableHeaders: string[];
  };

  reason?: string;
}
```

### Learning Loops

**Pattern Learning** (Stage 2):
```
Unmatched tables collected
        ↓
Cluster by header similarity
        ↓
Review clusters with > 3 occurrences
        ↓
Define new pattern
        ↓
Add to table-patterns.json
```

**Classification Learning** (Stage 4):
```
Destination corrections collected
        ↓
Analyze: "What label patterns get misclassified?"
        ↓
Update classification rules
        ↓
Re-test on historical data
```

**Extraction Learning** (Stage 3):
```
Value corrections collected
        ↓
Analyze: "What patterns have wrong values?"
        ↓
Improve extraction logic or prompts
        ↓
A/B test new vs old
```

---

## Implementation Priority

### Phase 1: Metrics Collection (This Week)
- [ ] Add metrics tracking to each stage
- [ ] Create DocumentMetrics output
- [ ] Save metrics to `customers/{customer}/metrics/`

### Phase 2: Dashboard (Next Week)
- [ ] Create metrics aggregation script
- [ ] Build simple CLI dashboard: `pnpm cli metrics -c beneo`
- [ ] Track trends over time

### Phase 3: Learning Automation (Week 3-4)
- [ ] Automated pattern discovery from unmatched tables
- [ ] Automated rule suggestions from corrections
- [ ] A/B testing framework for extraction changes

---

## File Structure

```
customers/{customer}/
├── incoming/           # Raw documents
├── extracted/          # Stage 1 output (RawDocument)
├── structure/          # Stage 2 output (StructuredDocument)
├── indexed/            # Stage 3+4+5 output (full pipeline)
├── approved/           # Stage 6 output (reviewed)
├── metrics/            # Per-document metrics
│   └── {filename}.metrics.json
└── corrections/        # Corrections from review
    └── {filename}.corrections.json

knowledge/
├── table-patterns.json      # Pattern definitions
├── classification-rules.json # Topic/destination rules
├── extraction-learning.json  # Learned improvements
└── pipeline-metrics.json     # Aggregate metrics
```
