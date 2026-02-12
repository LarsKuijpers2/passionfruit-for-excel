# Questionnaire Extraction Pipeline

## Overview

This pipeline processes supplier questionnaires (Excel, Word, PDF, HTML) to extract structured Q&A data, build a reusable answer library, and enable auto-filling of future questionnaires.

See [APPROACH.md](./APPROACH.md) for detailed flow and concepts.

## Quick Start

```bash
# CLI commands
pnpm cli store ./customers/acme/incoming/questionnaire.xlsx -c acme
pnpm cli index questionnaire.xlsx -c acme
pnpm cli review -c acme

# Start review server
pnpm server
```

## Commands

| Command | Description |
|---------|-------------|
| `store <file>` | Store questionnaire preserving structure |
| `index <file>` | Index with Claude AI, extract evidence pieces |
| `tag` | Assign destinations based on tag-rules.yaml |
| `review` | Interactive review with web UI |
| `list` | List stored questionnaires |
| `customers` | List all customers |
| `fetch` | Fetch questionnaire from Passionfruit API |
| `batch-fetch` | Fetch multiple questionnaires by evidence IDs |

## Directory Structure

```
frontend/                # React review UI
src/
├── cli.ts              # CLI entry point
├── server.ts           # Express server for review UI
├── types.ts            # Shared TypeScript types
├── config/             # Configuration
│   ├── environments.ts # API config, env vars
│   └── token-manager.ts # OAuth token refresh
├── utils/              # Utilities
│   ├── customer-paths.ts # Customer folder helpers
│   └── rules-manager.ts  # YAML rules loading
└── services/
    ├── extractors/     # Document extractors
    │   ├── index.ts    # Factory
    │   ├── excel.ts    # Excel extraction
    │   ├── word.ts     # Word extraction
    │   ├── pdf.ts      # PDF extraction
    │   ├── html.ts     # HTML extraction
    │   └── azure.ts    # Azure Document Intelligence
    ├── analysis/       # AI analysis
    │   ├── visual-analyzer.ts      # Claude AI analysis
    │   ├── questionnaire-indexer.ts # Organize by section
    │   ├── answer-harvester.ts     # Extract answers
    │   └── destination-tagger.ts   # Assign destinations
    ├── sync/           # Passionfruit API sync
    │   ├── api-client.ts           # HTTP client
    │   ├── aggregate-customer-data.ts
    │   ├── group-related-items.ts
    │   ├── prepare-customer-import.ts
    │   ├── sync-to-nslibrary.ts
    │   └── add-to-answer-library.ts
    └── review/         # Review support
        ├── web-generator.ts  # Generate review HTML
        ├── screenshot.ts     # Visual preview
        ├── feedback.ts       # Store feedback
        └── review-cli.ts     # Terminal review

customers/              # Customer data (per-customer folders)
├── <customer>/
│   ├── incoming/       # Drop files here
│   ├── questionnaires/ # Stored structures
│   ├── indexed/        # Indexed data
│   ├── review/         # Review HTMLs
│   └── approved/       # Approved exports
rules/                  # Global rules (YAML)
answer-library.yaml     # Harvested answers
```

## Key Concepts

- **Evidence Pieces**: Not just Q&A pairs - tables, checklists, narratives
- **Entity vs Product Level**: Entity = reusable across questionnaires
- **Customer Folders**: Each customer has isolated data directories
- **Feedback Loop**: Human feedback improves future extractions

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | For Bedrock | AWS region (default: eu-central-1) |
| `PASSIONFRUIT_API_KEY` | For API | Access token |
| `PASSIONFRUIT_REFRESH_TOKEN` | For API | Refresh token (auto-refresh) |
| `PASSIONFRUIT_ENV` | For API | Environment (production/staging) |
