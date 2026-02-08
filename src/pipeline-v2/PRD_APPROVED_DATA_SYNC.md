# PRD: Approved Data Sync to Passionfruit API

## Overview

This document describes how to implement the integration layer that takes **approved review data** and syncs it to the Passionfruit API (Entity Database, Answer Library, and Evidence).

## Context

The questionnaire extraction pipeline produces three types of data:

1. **Entities** - Company-level data (name, contacts, certifications, financial info)
2. **Answers** - Reusable Q&A pairs for future questionnaire auto-fill
3. **Evidence** - Uploaded questionnaire files with extracted metadata

After human review, approved items need to be synced to the Passionfruit API.

---

## Environment Configuration

### Environments

| Environment | Base URL | Use Case |
|-------------|----------|----------|
| **Development** | `https://dev.passionfruitapi.com` | Testing, development |
| **Production** | `https://passionfruitapi.com` | Live data |

### Configuration File

Create `config/environments.ts`:

```typescript
export type Environment = 'development' | 'production';

export interface EnvironmentConfig {
  name: Environment;
  apiBaseUrl: string;
  requiresAuth: boolean;
}

export const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  development: {
    name: 'development',
    apiBaseUrl: 'https://dev.passionfruitapi.com',
    requiresAuth: true,
  },
  production: {
    name: 'production',
    apiBaseUrl: 'https://passionfruitapi.com',
    requiresAuth: true,
  },
};

export function getEnvironment(): Environment {
  const env = process.env.PASSIONFRUIT_ENV || 'development';
  if (env !== 'development' && env !== 'production') {
    throw new Error(`Invalid environment: ${env}. Use 'development' or 'production'`);
  }
  return env;
}

export function getConfig(): EnvironmentConfig {
  return ENVIRONMENTS[getEnvironment()];
}
```

### Environment Variables

```bash
# Required
PASSIONFRUIT_ENV=development|production
PASSIONFRUIT_API_KEY=your-jwt-token

# Optional overrides
PASSIONFRUIT_API_URL=https://custom-url.com  # Override base URL
```

### .env.example

```bash
# Passionfruit API Configuration
# Environment: 'development' or 'production'
PASSIONFRUIT_ENV=development

# API authentication (JWT token from /api/v2/auth/login)
PASSIONFRUIT_API_KEY=

# Optional: Override API URL (useful for local testing)
# PASSIONFRUIT_API_URL=http://localhost:3000
```

---

## Passionfruit API Endpoints

### Authentication

```
POST /api/v2/auth/login
```

Returns JWT token for subsequent requests.

### Entities

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v2/entities/` | List entities |
| `POST` | `/api/v2/entities/` | Create entity |
| `GET` | `/api/v2/entities/{id}` | Get entity |
| `PUT` | `/api/v2/entities/{id}` | Update entity |
| `DELETE` | `/api/v2/entities/{id}` | Delete entity |

**Entity Schema:**

The entity has two parts:
1. **Top-level fields**: `name`, `parentId` (required)
2. **Data object**: All other fields (displayed in UI as "Company Information" + "Additional Fields")

```json
{
  "name": "Kaas-Pack Holland BV",
  "parentId": null,
  "data": {
    // Company Information fields (shown in UI form)
    "email": "quality@kaaspack.nl",
    "phone": "0528-268246",
    "website": "https://kaaspack.nl",
    "street": "Buitenvaart 2109",
    "city": "Hoogeveen",
    "zipCode": "7905 SW",
    "country": "Nederland",

    // Additional Fields (shown as key-value pairs in UI)
    "contacts": [
      { "name": "I. Vegter", "role": "QA Manager" }
    ],
    "activities": ["versnijden en raspen van kaas"],
    "egNumber": "NL Z 0159 EG",
    "certifications": [
      { "type": "FSSC 22000", "number": "ABC123" }
    ]
  }
}
```

**Entity Field Mapping from Questionnaires:**

| Questionnaire Label | Entity Field | Notes |
|---------------------|--------------|-------|
| Bedrijfsnaam / Company name | `name` | Top-level field |
| Adres / Address / Street | `data.street` | |
| Postcode, plaats, land | Parse into: | Dutch format: "1234 AB City, Country" |
| | `data.zipCode` | "7905 SW" |
| | `data.city` | "Hoogeveen" |
| | `data.country` | "Nederland" |
| Email-adres / E-mail | `data.email` | |
| Telefoonnummer / Phone | `data.phone` | |
| Website / Homepage | `data.website` | |
| Contactpersoon | `data.contacts[].name` | |
| Functie / Function | `data.contacts[].role` | |
| Bedrijfsactiviteiten | `data.activities[]` | |
| EG-nummer | `data.egNumber` | |
| KvK-nummer | `data.kvkNumber` | |
| BTW-nummer | `data.vatNumber` | |
| Certificering (FSSC, IFS, etc.) | `data.certifications[].type` | |
| Certificaatnummer | `data.certifications[].number` | |

### Answers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v2/answers/` | List answers |
| `POST` | `/api/v2/answers/` | Create answer |
| `GET` | `/api/v2/answers/search?q={query}` | Search answers (min 5 chars) |
| `GET` | `/api/v2/answers/{id}` | Get answer |
| `PUT` | `/api/v2/answers/{id}` | Update answer |
| `DELETE` | `/api/v2/answers/{id}` | Delete answer |

**Answer Schema:**
```json
{
  "question": "Welke kwaliteitsstandaarden zijn in werking?",
  "answer": "VLOG en Weidegang",
  "note": "Optional user-facing note",
  "entities": [1, 2],
  "evidences": [5]
}
```

**Proposed Extension** - `extractionMetadata` field (not yet in API):
```json
{
  "question": "...",
  "answer": "...",
  "extractionMetadata": {
    "type": "text",
    "level": "narrative",
    "lang": "nl",
    "topic": "quality",
    "lCell": "A21",
    "vCell": "C21",
    "source": {
      "file": "questionnaire.xlsx",
      "harvestedAt": "2026-02-08"
    }
  }
}
```

### Evidence

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v2/evidences/` | List evidences |
| `POST` | `/api/v2/evidences/` | Create evidence |
| `GET` | `/api/v2/evidences/search?q={query}` | Search evidences |
| `GET` | `/api/v2/evidences/{id}` | Get evidence |
| `PUT` | `/api/v2/evidences/{id}` | Update evidence |
| `POST` | `/api/v2/upload/` | Upload file |

**Evidence Schema:**
```json
{
  "name": "20241112 RL14-1 Questionnaire.xlsx",
  "classification": "supplier_questionnaire",
  "metadata": {
    "customer": "Marfo",
    "language": "nl",
    "extractedAt": "2026-02-08"
  },
  "extractedMetadata": {
    "questionnaire": {
      "id": "abc123",
      "sections": 5,
      "items": 47,
      "answered": 42
    }
  },
  "entities": [1]
}
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  LOCAL EXTRACTION                                            │
│                                                              │
│  indexed/*.yaml ──→ extract command ──→ extracted/           │
│                                          ├── entity-data.yaml │
│                                          ├── answers.yaml     │
│                                          └── narratives.yaml  │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  REVIEW (human approval)                                     │
│                                                              │
│  approved-exports/<questionnaire>/                           │
│  ├── entity-db.json                                          │
│  └── answer-library.json                                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  SYNC TO API                                                 │
│                                                              │
│  sync-approved command                                       │
│  ├── Upload evidence (questionnaire file)                    │
│  ├── Create/update entity                                    │
│  └── Create answers (linked to entity + evidence)            │
└─────────────────────┬───────────────────────────────────────┘
                      │
              ┌───────┴───────┐
              ▼               ▼
┌─────────────────┐   ┌─────────────────┐
│ DEV API         │   │ PROD API        │
│ dev.passionfruit│   │ passionfruitapi │
│ api.com         │   │ .com            │
└─────────────────┘   └─────────────────┘
```

---

## Implementation

### File Structure

```
src/pipeline-v2/
├── config/
│   └── environments.ts      # Environment configuration
├── sync/
│   ├── api-client.ts        # Base API client with auth
│   ├── entity-sync.ts       # Entity sync service
│   ├── answer-sync.ts       # Answer sync service
│   ├── evidence-sync.ts     # Evidence upload service
│   ├── sync-orchestrator.ts # Main sync coordinator
│   └── types.ts             # Sync-specific types
├── api-types.ts             # API data types (created)
├── entity-extractor.ts      # Extract entities (created)
├── cli.ts                   # CLI commands
└── ...
```

### API Client

```typescript
// src/pipeline-v2/sync/api-client.ts

import { getConfig } from '../config/environments.js';

export class PassionfruitAPIClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    const config = getConfig();
    this.baseUrl = process.env.PASSIONFRUIT_API_URL || config.apiBaseUrl;
    this.apiKey = process.env.PASSIONFRUIT_API_KEY || '';

    if (!this.apiKey) {
      throw new Error('PASSIONFRUIT_API_KEY is required');
    }
  }

  get environment() {
    return getConfig().name;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Entity methods
  async createEntity(entity: APIEntity): Promise<{ id: number }> {
    return this.request('POST', '/api/v2/entities/', entity);
  }

  async updateEntity(id: number, entity: APIEntity): Promise<void> {
    return this.request('PUT', `/api/v2/entities/${id}`, entity);
  }

  async listEntities(): Promise<APIEntity[]> {
    return this.request('GET', '/api/v2/entities/');
  }

  // Answer methods
  async createAnswer(answer: APIAnswer): Promise<{ id: number }> {
    return this.request('POST', '/api/v2/answers/', answer);
  }

  async searchAnswers(query: string): Promise<APIAnswer[]> {
    return this.request('GET', `/api/v2/answers/search?q=${encodeURIComponent(query)}`);
  }

  // Evidence methods
  async createEvidence(evidence: APIEvidence): Promise<{ id: number }> {
    return this.request('POST', '/api/v2/evidences/', evidence);
  }

  async uploadFile(file: Buffer, filename: string): Promise<{ filekey: string }> {
    const formData = new FormData();
    formData.append('file', new Blob([file]), filename);

    const response = await fetch(`${this.baseUrl}/api/v2/upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload error: ${response.status}`);
    }

    return response.json();
  }
}
```

---

## CLI Commands

### Sync Command

```bash
# Sync to current environment (from PASSIONFRUIT_ENV)
npx tsx src/pipeline-v2/cli.ts sync-approved

# Sync specific questionnaire
npx tsx src/pipeline-v2/cli.ts sync-approved --questionnaire "20241112 RL14-1"

# Dry run (preview without syncing)
npx tsx src/pipeline-v2/cli.ts sync-approved --dry-run

# Force sync to specific environment
npx tsx src/pipeline-v2/cli.ts sync-approved --env production
```

### Show Current Environment

```bash
# Show which environment is configured
npx tsx src/pipeline-v2/cli.ts env

# Output:
# Environment: development
# API URL: https://dev.passionfruitapi.com
# Auth: Configured ✓
```

---

## Sync Logic

### 1. Evidence Upload (First)

Upload the questionnaire file first to get an evidence ID:

```typescript
async function syncEvidence(questionnaire: string): Promise<number> {
  // 1. Read the original Excel file
  const filepath = `./incoming/${questionnaire}`;
  const file = await readFile(filepath);

  // 2. Upload file
  const { filekey } = await client.uploadFile(file, questionnaire);

  // 3. Create evidence with extracted metadata
  const indexed = await loadIndexed(questionnaire);
  const evidence = await client.createEvidence({
    name: questionnaire,
    classification: 'supplier_questionnaire',
    metadata: {
      language: indexed.language,
      extractedAt: indexed.indexed,
    },
    extractedMetadata: {
      questionnaire: {
        id: indexed.id,
        sections: indexed.sections.length,
        items: indexed.stats.total,
        answered: indexed.stats.answered,
      },
    },
  });

  return evidence.id;
}
```

### 2. Entity Sync

Create or update the entity:

```typescript
async function syncEntity(extraction: QuestionnaireEntityExtraction): Promise<number> {
  // Check if entity exists by name
  const entities = await client.listEntities();
  const existing = entities.find(e => e.name === extraction.data.name);

  if (existing) {
    // Merge and update
    const merged = mergeEntityData(existing.data, extraction.data);
    await client.updateEntity(existing.id, { name: existing.name, data: merged });
    return existing.id;
  } else {
    // Create new
    const { id } = await client.createEntity({
      name: extraction.data.name || 'Unknown Entity',
      data: extraction.data,
    });
    return id;
  }
}
```

### 3. Answer Sync

Create answers linked to entity and evidence:

```typescript
async function syncAnswers(
  answers: APIAnswer[],
  entityId: number,
  evidenceId: number
): Promise<void> {
  for (const answer of answers) {
    // Check for duplicate (same question text)
    const existing = await client.searchAnswers(answer.question);

    if (existing.length === 0) {
      await client.createAnswer({
        ...answer,
        entities: [entityId],
        evidences: [evidenceId],
      });
    } else {
      console.log(`  Skipping duplicate: ${answer.question.substring(0, 40)}...`);
    }
  }
}
```

---

## Sync Status Tracking

Track what has been synced in `sync-status.yaml`:

```yaml
lastSync: 2026-02-08T14:30:00.000Z
environment: development

questionnaires:
  "20241112 RL14-1 Questionnaire.xlsx":
    synced: true
    syncedAt: 2026-02-08T14:30:00.000Z
    evidenceId: 5
    entityId: 1
    answersCount: 18

  "F_S_Supplier_Questionnaire.xlsx":
    synced: false
    error: "API connection failed"
    lastAttempt: 2026-02-08T15:00:00.000Z
```

---

## Error Handling

1. **Authentication failure** - Prompt to check API key
2. **Network errors** - Retry with exponential backoff
3. **Duplicate detection** - Skip and log, don't fail
4. **Validation errors** - Log and continue with other items
5. **Rate limiting** - Respect API rate limits

---

## Success Criteria

1. ✅ Environment configuration (dev/production) is clearly set
2. ✅ CLI shows current environment
3. [ ] Evidence files are uploaded and linked
4. [ ] Entity data is created/updated with merge logic
5. [ ] Answers are created with extraction metadata
6. [ ] Sync status is tracked locally
7. [ ] Dry-run mode works correctly
8. [ ] Errors don't block other items from syncing

---

## Notes

1. **Start with dev** - Always test in development first
2. **Confirm before prod** - Add confirmation prompt for production sync
3. **Audit trail** - Log all sync operations
4. **Rollback plan** - Keep local copies of synced data
5. **API key security** - Never commit API keys to git
