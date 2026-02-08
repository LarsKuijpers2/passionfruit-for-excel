# Questionnaire Extraction Pipeline

## Overview

This pipeline processes supplier questionnaires (Excel) to extract structured Q&A data, build a reusable answer library, and enable auto-filling of future questionnaires.

See [APPROACH.md](./APPROACH.md) for detailed flow and concepts.

## Quick Start

```bash
# Show pipeline flow
npx tsx src/pipeline-v2/cli.ts flow

# 1. Store a questionnaire
npx tsx src/pipeline-v2/cli.ts store ./incoming/questionnaire.xlsx

# 2. Index with Claude AI
npx tsx src/pipeline-v2/cli.ts index questionnaire.xlsx

# 3. Harvest entity-level answers
npx tsx src/pipeline-v2/cli.ts harvest

# 4. Interactive review
npx tsx src/pipeline-v2/cli.ts review
```

## Commands

| Command | Description |
|---------|-------------|
| `store <file>` | Store questionnaire preserving Excel structure |
| `index <file>` | Index with Claude AI, extract all evidence pieces |
| `harvest` | Harvest entity-level answers into library |
| `review` | Interactive review with visual preview and feedback |
| `list` | List stored questionnaires |
| `flow` | Show the pipeline flow |

## Directory Structure

```
./incoming/           # Drop questionnaire files here
./questionnaires/     # Stored raw structures (JSON)
./indexed/            # Indexed questionnaires (YAML)
./answer-library.yaml # Harvested entity-level answers
./feedback/           # Human feedback for learning
./rules/              # Extraction rules
```

## Pipeline Files

```
src/pipeline-v2/
├── cli.ts                  # CLI entry point
├── excel-structure.ts      # Excel extraction (STORE)
├── visual-analyzer.ts      # Claude AI analysis (INDEX)
├── questionnaire-indexer.ts # Organize by section/topic (INDEX)
├── answer-harvester.ts     # Extract entity answers (HARVEST)
├── review-cli.ts           # Interactive review (REVIEW)
├── screenshot-generator.ts # Visual preview (REVIEW)
└── feedback-store.ts       # Store feedback (REVIEW)
```

## Key Concepts

- **Evidence Pieces**: Not just Q&A pairs - tables, checklists, narratives
- **Entity vs Product Level**: Entity = reusable across questionnaires
- **Feedback Loop**: Human feedback improves future extractions

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | For Bedrock | AWS region (default: eu-central-1) |
