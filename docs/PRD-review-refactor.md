# PRD: Review UI Refactor

## Problem Statement

The review UI (`review/index.html`) is a 2,925-line monolithic file with:
- **No type safety** - Pure vanilla JavaScript, data quality bugs
- **Manual HTML regeneration** - Have to regenerate HTML when data changes
- **Global state chaos** - All state in global variables, hard to debug
- **No modularity** - Everything inline, impossible to maintain

## Goals

1. **No more HTML regeneration** - Hot reload during development
2. **Type safety** - Catch bugs at compile time
3. **Simple API calls** - Loading states, caching handled automatically
4. **Maintainable** - Split into small components

## Non-Goals

- Routing (it's a single page)
- State management library (useState is fine)
- CSS framework (keep existing styles)
- tRPC or complex backend changes
- Authentication

---

## Stack (Minimal)

```
Vite + React + TanStack Query
```

| Tool | Purpose | Why |
|------|---------|-----|
| **Vite** | Dev server + build | Instant hot reload, no config |
| **React** | UI components | Most documentation online |
| **TanStack Query** | API calls | Handles loading, errors, caching |

That's it. Three dependencies.

---

## Project Structure

```
review-ui/
├── src/
│   ├── main.tsx                 # Entry point
│   ├── App.tsx                  # Main layout
│   ├── api.ts                   # API functions (fetch wrappers)
│   ├── types.ts                 # TypeScript types
│   │
│   ├── components/
│   │   ├── TabBar.tsx           # Questionnaire tabs
│   │   ├── OriginalPanel.tsx    # Excel preview
│   │   ├── IndexedPanel.tsx     # Indexed items
│   │   ├── LibraryPanel.tsx     # Library items
│   │   ├── ItemCard.tsx         # Single item (accept/reject)
│   │   └── CommandPalette.tsx   # Cmd+K menu
│   │
│   └── styles.css               # Keep existing dark theme
│
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Setup (One-Time)

```bash
cd review-ui
npm create vite@latest . -- --template react-ts
npm install @tanstack/react-query
```

```json
// package.json scripts
{
  "scripts": {
    "dev": "vite",                    // localhost:5173 with hot reload
    "build": "vite build",            // production build
    "preview": "vite preview"         // preview production build
  }
}
```

---

## How It Works

### API Calls with TanStack Query

```tsx
// src/api.ts
export async function fetchQuestionnaires(): Promise<string[]> {
  const res = await fetch('/api/questionnaires');
  if (!res.ok) throw new Error('Failed to load');
  return res.json();
}

export async function fetchQuestionnaire(id: string) {
  const res = await fetch(`/api/questionnaire/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Failed to load');
  return res.json();
}

export async function saveFeedback(feedback: FeedbackItem) {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feedback),
  });
  if (!res.ok) throw new Error('Failed to save');
}
```

```tsx
// src/components/QuestionnaireList.tsx
import { useQuery } from '@tanstack/react-query';
import { fetchQuestionnaires } from '../api';

function QuestionnaireList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['questionnaires'],
    queryFn: fetchQuestionnaires
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {data.map(name => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  );
}
```

### Saving Feedback with Mutations

```tsx
// src/components/ItemCard.tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveFeedback } from '../api';

function ItemCard({ item }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: saveFeedback,
    onSuccess: () => {
      // Refresh the data after saving
      queryClient.invalidateQueries({ queryKey: ['questionnaire'] });
    }
  });

  const handleAccept = () => {
    mutation.mutate({
      id: item.id,
      action: 'accepted',
      label: item.label,
      value: item.value,
      // ...
    });
  };

  return (
    <div className="item-card">
      <div>{item.label}</div>
      <div>{item.value}</div>
      <button onClick={handleAccept} disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving...' : 'Accept'}
      </button>
    </div>
  );
}
```

---

## Proxy API Calls to Backend

Vite proxies `/api` to your Express server:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000'  // Your existing Express server
    }
  }
});
```

---

## Development Workflow

```bash
# Terminal 1: Start Express backend
npx tsx src/pipeline-v2/review/server.ts

# Terminal 2: Start Vite frontend
cd review-ui && npm run dev
```

Open `http://localhost:5173` - changes appear instantly, no regeneration.

---

## Migration Path

### Phase 1: Setup + Shell
- Create Vite project
- Copy existing CSS
- Basic App.tsx with three panels
- Proxy to existing backend

### Phase 2: Panels One by One
- Start with simplest panel (TabBar)
- Then OriginalPanel (Excel preview)
- Then IndexedPanel
- Then LibraryPanel

### Phase 3: Interactions
- Item selection (multi-select)
- Accept/Reject buttons
- Command palette (Cmd+K)

### Phase 4: Cleanup
- Remove old `review/index.html`
- Remove `web-review-generator.ts`
- Update `npm run review` script

---

## What Changes

| Before | After |
|--------|-------|
| `review/index.html` (2,925 lines) | `review-ui/src/` (~10 small files) |
| Manual HTML regeneration | Hot reload |
| Global variables | React state + TanStack Query |
| No types | Full TypeScript |
| Raw fetch + manual loading state | TanStack Query handles it |

## What Stays The Same

- Express backend (`server.ts`) - unchanged
- All API endpoints - unchanged
- Dark theme styling - copy CSS over
- Three-panel layout - same design
- Cmd+K command palette - same UX

---

## Success Criteria

- [ ] `npm run dev` starts with hot reload
- [ ] All existing features work
- [ ] No HTML regeneration needed
- [ ] TypeScript catches type errors
- [ ] Loading/error states shown automatically
