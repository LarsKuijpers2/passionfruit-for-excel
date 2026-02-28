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
knowledge/              # Domain knowledge
├── food-industry.md    # Certifications, standards, terminology
answer-library.yaml     # Harvested answers
```

## Key Concepts

- **Evidence Pieces**: Not just Q&A pairs - tables, checklists, narratives
- **Entity vs Product Level**: Entity = reusable across questionnaires
- **Customer Folders**: Each customer has isolated data directories
- **Feedback Loop**: Human feedback improves future extractions
- **Supplier vs Customer**: Supplier fills out questionnaires, Customer requests them

## Review UI

The review UI has two main views:

### Questionnaire View
- Shows individual questionnaire with original document, indexed items, and library panels
- Access via sidebar by clicking on a questionnaire name
- TabBar at top shows open questionnaire tabs

### Database View
- Full-screen aggregated view of all data for a customer
- Access via database icon (🗄) next to customer name in sidebar
- Tabs: Questionnaires, Library, Entities, Product, Metadata, Excluded, Curated

### Entity Role Detection

Questionnaires ask about different parties. During **indexing**, each company-destination item gets an `entityRole` field detected from the question label and section title:

| Role | Detected from labels/sections like |
|------|-------------------------------------|
| `supplier` | "Supplier Name", "Vendor Company", "Our Company", "Leverancier" |
| `manufacturer` | "Manufacturer Name", "Manufacturing Site", "Production Site" |
| `producer` | "Producer Name", "Producteur" |
| `customer` | "Customer Name", "Client", "Buyer", "Recipient" |
| `group` | "Parent Company", "Group Name", "Holding Company", "Head Office" |

**Pipeline flow:**
1. **INDEX** → `detectEntityRole()` in `questionnaire-indexer.ts` adds `entityRole` to each item
2. **EXPORT** → entityRole is preserved in approved exports
3. **AGGREGATE** → entityRole flows through to aggregated data
4. **UI** → Database view groups entities by detected role

### Entity Grouping (UI)
In the Database → Entities tab:
- Entities are grouped by **name + role** (e.g., "Doehler Oosterhout (Supplier)")
- The same company can have **multiple roles** across questionnaires:
  - "Doehler Oosterhout (Supplier)" - when filling out a questionnaire
  - "Doehler Oosterhout (Manufacturer)" - when asked about production site
  - "Doehler Oosterhout (Customer)" - when they're the recipient
- Each name+role combination is a separate entry
- Role comes from `entityRole` field if available, otherwise detected from label
- Fields are merged within the same name+role group across questionnaires

### Product Grouping
Products are grouped by source file (questionnaire they came from).

## Knowledge Files

Reference these for domain understanding:

- **[knowledge/food-industry.md](./knowledge/food-industry.md)** - Certifications (GFSI, ISO, RSPO), social compliance (SEDEX, SMETA), terminology
- **customers/\<name\>/company.md** - Company-specific facts, confirmed certifications, open questions

When processing questionnaires:
1. A supplier may give different answers to different customers (product-specific, time-sensitive)
2. Flag conflicting data rather than picking one answer
3. Update company.md with confirmed facts and open questions

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | For Bedrock | AWS region (default: eu-central-1) |
| `PASSIONFRUIT_API_KEY` | For API | Access token |
| `PASSIONFRUIT_REFRESH_TOKEN` | For API | Refresh token (auto-refresh) |
| `PASSIONFRUIT_ENV` | For API | Environment (production/staging) |
