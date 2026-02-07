# Questionnaire Extraction Pipeline — Claude Code Instructions

## Overview

This pipeline processes supplier and product questionnaires (Excel, PDF, Word) to extract structured Q&A data, categorise it, handle bilingual content, and generate standardised output files.

## Rules

All categorisation, language handling, and output format rules are defined in [RULES.md](./RULES.md). Read RULES.md before processing any file.

## Pipeline Commands

### Process a single file

```bash
npx tsx src/pipeline/cli.ts process <file-path>
```

### Process all files in the incoming folder

```bash
npx tsx src/pipeline/cli.ts batch
```

### Process with options

```bash
# Dry run (no output files)
npx tsx src/pipeline/cli.ts process <file-path> --dry-run

# Specify output directory
npx tsx src/pipeline/cli.ts process <file-path> --output-dir ./extracted

# Skip Claude API calls (rule-based categorisation only)
npx tsx src/pipeline/cli.ts process <file-path> --offline
```

## Processing Steps

For each file in `./incoming/`:

1. **Detect file type** — Check extension (.xlsx, .xls, .pdf, .docx)
2. **Read content** — Use the appropriate reader (ExcelJS, pdf-parse, mammoth)
3. **Map structure** — Detect sheets, columns, question/answer positions
4. **Extract Q&A pairs** — Get all pairs with cell references, including blank answers
5. **Categorise** — Apply RULES.md categorisation (EntityDB / Procedures / Product)
6. **Split languages** — Detect bilingual content, split DE/EN, translate where needed
7. **Score confidence** — Assign HIGH / MEDIUM / LOW per RULES.md criteria
8. **Generate output** — Create standardised Excel in `./extracted/`
9. **Log results** — Record per-file summary in `./logs/`

## Directory Structure

```
./incoming/       # Drop questionnaire files here
./extracted/      # Output: one Excel per input file
./reviewed/       # Human-approved files (moved manually)
./failed/         # Files that errored during processing
./logs/           # Per-batch processing logs + summary.json
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | For Claude API features | Used for categorisation + translation |
| `AWS_REGION` | For Bedrock | AWS region (default: eu-central-1) |

## Architecture

The pipeline is built in TypeScript, leveraging the existing passionfruit-for-excel modules:

- `src/pipeline/types.ts` — Pipeline-specific type definitions
- `src/pipeline/file-reader.ts` — Unified file reader for xlsx, pdf, docx
- `src/pipeline/categoriser.ts` — Rule-based + Claude API categorisation
- `src/pipeline/language-handler.ts` — Language detection, splitting, translation
- `src/pipeline/output-generator.ts` — Standardised Excel output generation
- `src/pipeline/pipeline.ts` — Main orchestrator
- `src/pipeline/logger.ts` — Structured logging
- `src/pipeline/cli.ts` — CLI entry point

## Key Principles

1. **Preserve exact wording** — Never summarise or paraphrase source text
2. **Include blank answers** — Extract every Q&A pair, even if the answer is empty
3. **Cell references for everything** — Every Q&A must have source cell references
4. **Graceful failure** — If one file fails, continue with the rest and log the error
5. **Idempotent** — Re-running on the same file produces the same output
6. **Human review** — Low-confidence items are flagged, not auto-decided
