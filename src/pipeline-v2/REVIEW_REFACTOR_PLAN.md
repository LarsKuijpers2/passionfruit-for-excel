# Review System Refactor Plan

## Current State

We have a web-based review interface (`web-review-generator.ts`) that:
- Shows 3 panels: Original questionnaire, Indexed Structure, Harvested Library
- Allows accept/reject/edit per item and per section
- Uses localStorage for persistence (survives refresh)
- Exports JSON files on manual download (not ideal)

**Problems:**
- ~1600 lines of embedded HTML/CSS/JS in one file
- Can't auto-save to files (browser security)
- Manual download workflow is clunky
- State management is scattered

## Goals

1. **Auto-save feedback** - No manual export, saves directly to files
2. **Per-questionnaire review history** - See what was reviewed for each file
3. **Rules integration** - Rejected/edited items feed back into extraction rules
4. **Clean architecture** - Maintainable code

## Proposed Architecture

```
src/pipeline-v2/
├── review/
│   ├── server.ts          # Local Express server
│   ├── api.ts             # API endpoints (save feedback, get status)
│   ├── components/        # React components (or keep vanilla, organized)
│   │   ├── App.tsx
│   │   ├── OriginalPanel.tsx
│   │   ├── IndexedPanel.tsx
│   │   ├── LibraryPanel.tsx
│   │   ├── Item.tsx
│   │   └── ReviewActions.tsx
│   ├── state.ts           # Centralized state management
│   └── styles.css         # Extracted styles
├── rules/
│   ├── index-rules.yaml   # Rules for INDEX step
│   ├── harvest-rules.yaml # Rules for HARVEST step
│   └── rules-manager.ts   # Load/save/apply rules
└── cli.ts                 # Add: `review serve` command
```

## Data Flow

```
1. User runs: npx tsx cli.ts review serve <questionnaire>
   → Starts local server on localhost:3000
   → Opens browser automatically

2. User reviews items in browser
   → Each action POSTs to localhost:3000/api/feedback
   → Server saves to: review/<questionnaire>/feedback.json

3. User clicks "Apply to Rules"
   → POST to localhost:3000/api/apply-rules
   → Server updates rules/index-rules.yaml and rules/harvest-rules.yaml

4. Next INDEX/HARVEST run uses updated rules automatically
```

## File Structure for Saved Reviews

```
review/
├── 20241112_Marfo_questionnaire/
│   ├── feedback.json      # All feedback for this questionnaire
│   ├── review-status.json # Summary: 27 items, 25 accepted, 2 rejected
│   └── applied-rules.json # Rules generated from this review
└── 20241113_Another_questionnaire/
    └── ...
```

## Feedback Schema

```yaml
# review/<questionnaire>/feedback.json
meta:
  source: "20241112 RL14-1 Questionnaire.xlsx"
  startedAt: "2024-02-08T14:00:00Z"
  lastUpdatedAt: "2024-02-08T14:30:00Z"

index:
  - id: "item_001"
    action: "accepted"
    label: "Bedrijfsnaam"
    value: "Kaas-Pack Holland BV"
    cells: "A8,C8"
    section: "Algemene informatie"
    reviewedAt: "2024-02-08T14:05:00Z"

  - id: "item_002"
    action: "rejected"
    label: "Some header text"
    cells: "A5"
    reason: "This is a section header, not a data item"
    reviewedAt: "2024-02-08T14:06:00Z"

library:
  - id: "lib_001"
    action: "accepted"
    label: "Bedrijfsnaam"
    value: "Kaas-Pack Holland BV"
    topic: "company"
    reviewedAt: "2024-02-08T14:10:00Z"
```

## Rules Schema

```yaml
# rules/index-rules.yaml
version: "1.0"
updatedAt: "2024-02-08"

exclude:
  - pattern: "section header"
    reason: "Headers should not be extracted as items"
    source: "20241112_Marfo - rejected item_002"

  - pattern:
      cells: "A1:A5"  # First 5 rows often headers
    reason: "Top rows usually contain document headers"

corrections:
  - match:
      label: "Bedrijfsnaam"
    correct:
      label: "Company Name"
    source: "20241112_Marfo - edited item_003"
```

## Implementation Steps

### Phase 1: Server Setup (30 min)
- [ ] Create `review/server.ts` with Express
- [ ] Add endpoints: GET /api/status, POST /api/feedback, POST /api/apply-rules
- [ ] Add `review serve` CLI command
- [ ] Test basic save/load

### Phase 2: Update HTML to Use Server (30 min)
- [ ] Replace localStorage with fetch() calls to server
- [ ] Remove download logic, use auto-save
- [ ] Add connection status indicator
- [ ] Handle offline gracefully (queue actions)

### Phase 3: Rules Integration (30 min)
- [ ] Create `rules/rules-manager.ts`
- [ ] Add "Apply to Rules" button
- [ ] Update INDEX step to load and apply rules
- [ ] Update HARVEST step to load and apply rules

### Phase 4: Polish (30 min)
- [ ] Add review status to CLI `list` command
- [ ] Show which questionnaires have been reviewed
- [ ] Add `review status` command for summary
- [ ] Clean up and document

## Decision: React or Vanilla?

**Recommendation: Keep Vanilla for now**

Reasons:
- Server-side changes are the priority (auto-save)
- Current UI works, just needs better organization
- React adds complexity without immediate benefit
- Can always migrate later if needed

**If we do React later:**
- Use Vite for fast dev server
- Keep it simple: React + fetch, no Redux
- Components map 1:1 to current panels

## Commands After Refactor

```bash
# Start review server (opens browser)
npx tsx src/pipeline-v2/cli.ts review serve <questionnaire>

# Check review status
npx tsx src/pipeline-v2/cli.ts review status

# Apply all pending rules
npx tsx src/pipeline-v2/cli.ts review apply-rules

# Full pipeline with rules
npx tsx src/pipeline-v2/cli.ts index <file>  # Uses rules/index-rules.yaml
npx tsx src/pipeline-v2/cli.ts harvest       # Uses rules/harvest-rules.yaml
```
