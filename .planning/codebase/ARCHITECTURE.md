<!-- refreshed: 2026-08-26 -->
# Architecture

**Analysis Date:** 2026-08-26

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Browser / Client                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  React 19 Application                      │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  App Component (src/App.tsx)                         │  │ │
│  │  │  - Context: SharedContext (resume, JD, position)    │  │ │
│  │  │  - State: apiKey, providerInfo, verification status │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │       ▼              ▼              ▼                       │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐           │ │
│  │  │ API Key  │  │ Shared   │  │  Three Tools:    │           │ │
│  │  │ Setup    │  │ Inputs   │  │  1. AI Detection │           │ │
│  │  └──────────┘  └──────────┘  │  2. Resume Audit │           │ │
│  │                              │  3. Interview Prep           │ │
│  │                              └──────────────────┘           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           ▼ HTTP/REST                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
        ┌─────────────────┐ ┌─────────────┐ ┌──────────────┐
        │ POST /api/...   │ │ Local Proc. │ │ POST /api/.. │
        │ (Resume Audit)  │ │ (AI Detect) │ │ (Interview)  │
        └─────────────────┘ └─────────────┘ └──────────────┘
                │
                ▼
    ┌──────────────────────────────────────────┐
    │     Express Server (server.ts)            │
    │  ┌──────────────────────────────────────┐ │
    │  │ API Endpoints:                       │ │
    │  │ - /api/resume/extract                │ │
    │  │ - /api/resume/analyze                │ │
    │  │ - /api/interview/questions           │ │
    │  │ - /api/interview/evaluate            │ │
    │  │ - /api/ai-detect (local)             │ │
    │  │ - /api/ai/identify                   │ │
    │  └──────────────────────────────────────┘ │
    │            ▼                               │
    │  ┌──────────────────────────────────────┐ │
    │  │  Multi-Provider AI Layer             │ │
    │  │  (providers.ts)                      │ │
    │  │                                      │ │
    │  │  - Google Gemini                     │ │
    │  │  - OpenAI GPT                        │ │
    │  │  - Anthropic Claude                  │ │
    │  └──────────────────────────────────────┘ │
    │            ▼                               │
    │  ┌──────────────────────────────────────┐ │
    │  │ File Processing:                     │ │
    │  │ - unpdf (PDF text extraction)        │ │
    │  │ - mammoth (DOCX text extraction)     │ │
    │  │ - AI Statistical Detection           │ │
    │  └──────────────────────────────────────┘ │
    └──────────────────────────────────────────┘
                │
                ▼
    External AI APIs (user-provided keys)
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App | Manages global context (resume, JD, position), API key state, provider resolution | `src/App.tsx` |
| ApiKeySetup | User key input, provider detection, model verification | `src/components/ApiKeySetup.tsx` |
| SharedInputs | Resume upload/paste, job description, position entry | `src/components/SharedInputs.tsx` |
| AiDetection | Client-side AI probability detection via local statistical model | `src/sections/AiDetection.tsx` |
| ResumeAudit | Multi-tab resume scoring and feedback against job description | `src/sections/ResumeAudit.tsx` |
| InterviewPrep | Q&A generation and optional interview scoring ledger | `src/sections/InterviewPrep.tsx` |
| Providers | Multi-provider abstraction (Google, OpenAI, Anthropic) | `providers.ts` |
| Server | Express endpoints for AI calls, file extraction, AI detection | `server.ts` |

## Pattern Overview

**Overall:** Full-stack single-page application (SPA) with bring-your-own-key architecture.

**Key Characteristics:**
- **Stateless server** — No API keys stored server-side; every request carries a user key
- **Provider-agnostic** — Detects provider from key prefix; routes to the correct API
- **Context-driven UI** — App component holds shared context (resume, JD, position) passed down to all three tools
- **Lazy-loaded exports** — PDF/DOCX libraries loaded only when user clicks export
- **Local AI detection** — No external API call for resume AI scanning; six statistical signals run server-side

## Layers

**Frontend (Browser):**
- Purpose: User interface, input capture, result rendering
- Location: `src/`
- Contains: React components (App, sections, components), utilities, types
- Depends on: Express API backend via fetch()
- Used by: Browser / user

**API (Express Server):**
- Purpose: Route user requests to AI providers, extract file text, run local detection
- Location: `server.ts`
- Contains: Seven API endpoints, file extraction logic, error handling
- Depends on: `providers.ts`, file libraries (unpdf, mammoth), external AI APIs
- Used by: Frontend via HTTP/REST

**Provider Abstraction (`providers.ts`):**
- Purpose: Unified interface to Google, OpenAI, and Anthropic APIs
- Location: `providers.ts` (root directory)
- Contains: Provider detection, model selection, generation functions, structured output handling
- Depends on: SDK packages (@google/genai, openai, @anthropic-ai/sdk)
- Used by: `server.ts` endpoints

**Utilities (`src/lib/`):**
- Purpose: Cross-cutting functions (file download, markdown rendering, Q&A export)
- Location: `src/lib/`
- Contains: Browser helpers, formatting logic
- Depends on: jsPDF, docx (lazy-loaded)
- Used by: Section components

## Data Flow

### Primary Request Path: Resume Audit

1. User enters resume, job description → `SharedInputs` updates context in `App.tsx` (in-memory state + localStorage)
2. User clicks "Analyze" → `ResumeAudit` component sends POST to `/api/resume/analyze` with `resumeText`, `jobDescription`, `apiKey`
3. Server (`server.ts`) builds combined prompt from DEFAULT_RESUME_PROMPT template
4. Server calls `generate()` from `providers.ts` with apiKey
5. `providers.ts` identifies provider (from key prefix), resolves best model via provider's list-models API (cached 10 min)
6. `generateOpenAI()`, `generateGoogle()`, or `generateAnthropic()` dispatches request to the identified provider
7. If first model is overloaded (503), retries on alternate models (if available)
8. Response text parsed into sections (via `[[Section]]` markers) in `ResumeAudit` component
9. Results rendered in tabs; user can export as text

### Secondary Path: Interview Question Generation

1. Same context loaded from `SharedInputs`
2. User clicks "Generate Questions" in `InterviewPrep` → POST to `/api/interview/questions`
3. Server builds prompt from DEFAULT_INTERVIEW_PROMPT
4. Server calls `generateJSON()` (not `generate()`) with QA_SCHEMA — requests structured JSON output
5. Provider returns JSON array of {question, answer, category, rationale} pairs
6. Results rendered as Q&A pairs; user can download as PDF or DOCX

### Tertiary Path: Resume AI Detection

1. User has resume in context (from `SharedInputs`)
2. User clicks "Scan my resume" → POST to `/api/ai-detect` (no apiKey needed)
3. Server runs `detectAiStatistically()` locally on the text (six linguistic signals)
4. Returns aiProbability (0–100%) and engine name
5. `AiDetection` component renders as a progress bar and verdict

### Interview Scoring Evaluation (Optional)

1. User scores practice interview answers in optional ledger
2. User clicks "Evaluate Scores" → POST to `/api/interview/evaluate` with scoringTable, metricTable
3. Server builds prompt from DEFAULT_EVALUATION_PROMPT + score JSON
4. Response is a narrative assessment report
5. Rendered below the scoring table; downloadable as text

**State Management:**
- Shared context (`resumeText`, `jobDescription`, `appliedPosition`, `resumeFileName`) lives in `App.tsx` state
- Persisted to localStorage so refresh doesn't lose the user's resume
- Passed down to child sections via props; sections call `updateContext()` to modify
- API key stored separately in localStorage (sent to server only when making calls)
- Provider info (engine, model) cached in browser state (resolved once per valid key)

## Key Abstractions

**SharedContext:**
- Purpose: Single source of truth for user inputs (resume, job, position)
- Examples: `src/App.tsx`, `src/types.ts` (interface definition)
- Pattern: Lifted state in React; persisted to localStorage for session resilience

**ProviderInfo:**
- Purpose: Encapsulate detected AI engine and resolved model
- Examples: Returned by `/api/ai/identify` and `providers.ts:resolveProvider()`
- Pattern: Detected at login; cached for 10 minutes; used to route all subsequent requests

**ResumeReportData & InterviewReportData:**
- Purpose: Type-safe containers for model responses
- Examples: `src/types.ts` (definitions), used in `ResumeAudit.tsx` and `InterviewPrep.tsx`
- Pattern: Defines expected shape of responses; allows sections to render predictably

**GenerateOptions & GenerateResult:**
- Purpose: Standardized contract for AI generation across all providers
- Examples: `providers.ts` interface definitions
- Pattern: Single function signature routes to all three SDKs; error handling centralized

## Entry Points

**Browser Entry:**
- Location: `src/main.tsx`
- Triggers: Page load (HTTP GET /)
- Responsibilities: React root initialization, render `App.tsx` into #root DOM element

**API Entry (Server):**
- Location: `server.ts:startServer()`
- Triggers: `npm run dev` (tsx server.ts) or `npm start` (node dist/server.cjs)
- Responsibilities: Start Express server, register routes, Vite middleware (dev) / static SPA (prod)

**Client-side Entry (SPA):**
- Location: `src/App.tsx`
- Triggers: After React hydration
- Responsibilities: Initialize context from localStorage, render header, nav, hero, then three sections

## Architectural Constraints

- **Threading:** Single-threaded event loop (Node.js). AI calls are async but non-blocking.
- **Global state:** API key stored in localStorage (client-side); provider cache map lives in `providers.ts` module (server-side, per process)
- **Circular imports:** None detected; imports follow a hierarchy (App → sections → components → types/lib)
- **Single server instance:** Each `startServer()` call creates one Express app; caching (e.g., provider resolution cache) is per-process, not per-request
- **File size limits:** 5MB per upload enforced in `/api/resume/extract` (checked before extraction)
- **No database:** All state is ephemeral (in-memory on server, localStorage on client)

## Anti-Patterns

### Hardcoded Model IDs

**What happens:** Earlier versions might have hard-coded a specific model (e.g., `"gpt-4-turbo"`)
**Why it's wrong:** Model retirements, restrictions, or API changes break the app for all users; no way to adapt without redeploying
**Do this instead:** Use `providers.ts:resolveProvider()` to query the key's available models at request time, rank them by version and tier, and pick the best one. (This is already implemented in `providers.ts`.)

### Re-parsing CSV/JSON Responses

**What happens:** If the model returned structured data as prose (e.g., `"question: Q1\nanswer: A1"`) and you tried to parse it client-side
**Why it's wrong:** Prone to off-by-one errors, edge cases (quotes in answers), and fragility when model output format changes
**Do this instead:** Use `generateJSON()` from `providers.ts` with a JSON schema. Providers that support structured output (OpenAI strict mode, Anthropic output_config, Gemini responseSchema) return typed JSON directly. (This is implemented in `/api/interview/questions`.)

### Sending API Keys in URL or Headers Without HTTPS

**What happens:** If the key were passed as a query param or unencrypted header to a server
**Why it's wrong:** Network sniffer captures the key; credentials leak
**Do this instead:** Send keys in POST body over HTTPS only; never store on server. (This is correctly implemented — development uses HTTP for localhost only; production should use HTTPS reverse proxy.)

## Error Handling

**Strategy:** Explicit error messages shown to the user; no silent failures.

**Patterns:**
- File extraction: If a PDF is scanned images (no text layer), return 422 with "Almost no text could be read"
- AI calls: If a provider returns 503 or 429, retry on alternate models before failing
- Provider detection: If a key doesn't match any known prefix, probe all three providers before declaring it invalid
- Structured output: If JSON parsing fails after a model call, return 502 with "The model returned malformed data"
- Validation: Missing required fields (resumeText, jobDescription, apiKey) return 400

## Cross-Cutting Concerns

**Logging:** Console.log() used at key points (provider resolution, model fallback, AI detection scoring); no persistent logging layer.

**Validation:** 
- Client-side: Input presence checks before button enable (`lockedReason` in ToolSection)
- Server-side: Missing fields checked at endpoint entry; file size checked before extraction

**Authentication:** 
- No traditional auth (no user accounts); "authentication" is the user's own API key
- Key verified once at `/api/ai/identify` before first use
- Key sent in POST body on every subsequent AI request (stateless)

---

*Architecture analysis: 2026-08-26*
