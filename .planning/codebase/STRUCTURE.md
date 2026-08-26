# Codebase Structure

**Analysis Date:** 2026-08-26

## Directory Layout

```
Interview Feedback/
├── server.ts              # Express server + API endpoints
├── providers.ts           # Multi-provider AI abstraction (Google, OpenAI, Anthropic)
├── package.json           # Dependencies (React, Express, Tailwind, AI SDKs)
├── vite.config.ts         # Vite + Tailwind + React setup
├── tsconfig.json          # TypeScript config
├── index.html             # HTML entry point (SPA)
│
├── src/                   # React frontend application
│   ├── main.tsx           # Entry point (React root init)
│   ├── App.tsx            # Main app component (context, layout, three tools)
│   ├── types.ts           # TypeScript interfaces (SharedContext, ProviderInfo, etc.)
│   ├── vite-env.d.ts      # Vite type definitions
│   ├── index.css          # Global styles (Tailwind imports)
│   │
│   ├── components/        # Reusable UI components
│   │   ├── ApiKeySetup.tsx           # API key input + provider selection + verification
│   │   ├── SharedInputs.tsx          # Resume upload/paste + job description + position
│   │   ├── FileUploader.tsx          # File drop/click upload (PDF, DOCX, TXT, etc.)
│   │   ├── ToolSection.tsx           # Chrome wrapper for each tool (header, locked state)
│   │   └── InterviewScoringTable.tsx # Optional scoring ledger for interview evaluation
│   │
│   ├── sections/          # Three main feature sections
│   │   ├── AiDetection.tsx           # Tool 1: Resume AI probability detector (local, no key)
│   │   ├── ResumeAudit.tsx           # Tool 2: Resume scoring + multi-tab audit report
│   │   └── InterviewPrep.tsx         # Tool 3: Q&A generation + optional scoring interface
│   │
│   ├── lib/               # Utility functions and helpers
│   │   ├── download.ts               # Browser blob download (text, exports)
│   │   ├── exportQA.ts               # Format Q&A pairs for PDF/DOCX export
│   │   └── renderMarkdown.tsx        # Markdown to React renderer
│   │
│   └── assets/
│       └── images/        # Hero image + other visual assets
│
├── .planning/
│   └── codebase/          # This analysis (ARCHITECTURE.md, STRUCTURE.md, etc.)
│
├── node_modules/          # Installed dependencies (not version-controlled)
└── dist/                  # Built output (Vite client + esbuild server)
```

## Directory Purposes

**Root (`/`):**
- `server.ts` — Express server and seven API endpoints; Vite middleware (dev) or static SPA (prod); 600+ lines
- `providers.ts` — Multi-provider AI abstraction; model resolution logic; 500+ lines
- `package.json` — Dependency manifest; npm scripts
- `vite.config.ts` — Vite, React, and Tailwind configuration
- `tsconfig.json` — TypeScript strict mode
- `index.html` — SPA root; loads `/src/main.tsx`

**`src/`:**
- React application source
- Contains top-level `App.tsx`, `main.tsx`, types, and organized subdirectories

**`src/components/`:**
- Purpose: Reusable UI components (no feature logic)
- Contains: ApiKeySetup, SharedInputs, FileUploader, ToolSection, InterviewScoringTable
- Pattern: Presentational + lightweight state (e.g., visibility toggles, UI state only)
- Passed in: Props from parent (App or sections)

**`src/sections/`:**
- Purpose: Three main feature areas, each a complete tool
- Contains: AiDetection, ResumeAudit, InterviewPrep
- Pattern: Feature-level components that manage their own flow (API calls, result state, error handling)
- Receives: Shared context from App via props

**`src/lib/`:**
- Purpose: Cross-cutting utility functions (no components)
- Contains: File download, export formatting, markdown rendering
- Pattern: Pure functions or helpers; no React state

**`src/assets/`:**
- Purpose: Static images (hero, icons if any)
- Contains: Prism hero image (background, branding)

**`.planning/codebase/`:**
- Purpose: Architecture and structure documentation
- This analysis and any future phase docs

## Key File Locations

**Entry Points:**
- `src/main.tsx` — React bootstrap; creates root and renders App
- `index.html` — HTML entry point; `<div id="root">` target
- `server.ts:startServer()` — Server startup (Express listen)

**Configuration:**
- `vite.config.ts` — Build tool config, Tailwind plugin, React plugin
- `tsconfig.json` — TypeScript strict, module resolution
- `package.json` — Dependencies, npm scripts
- `.env` (optional) — `FAST_DETECT_GPT_URL` only (optional local fast-detect-gpt integration)

**Core Logic:**
- `src/App.tsx` — Shared context (resume, JD, position), API key state, provider info, three tool sections
- `server.ts` — API endpoint implementations (`/api/resume/extract`, `/api/resume/analyze`, `/api/interview/questions`, `/api/interview/evaluate`, `/api/ai-detect`, `/api/ai/identify`)
- `providers.ts` — Provider detection, model resolution, generation dispatch (routes to Google/OpenAI/Anthropic SDKs)

**Testing:**
- No test files; no test framework configured
- Manual testing only (run app, interact via browser)

## Naming Conventions

**Files:**
- React components: PascalCase, `.tsx` (e.g., `ApiKeySetup.tsx`)
- Utilities: camelCase, `.ts` (e.g., `download.ts`)
- API handlers: Named after the endpoint they handle (e.g., `/api/resume/analyze` → function `handleAnalyzeResume()` within `server.ts`)
- Types: Interfaces in `src/types.ts`, named with `Interface` suffix optional but used (e.g., `SharedContext`, `ProviderInfo`, `QAPair`)

**Directories:**
- Feature sections: Lowercase, plural when grouping (e.g., `components/`, `sections/`, `lib/`)
- Assets: Lowercase, descriptive (e.g., `assets/images/`)

**Variables / Constants:**
- Local state: camelCase (e.g., `resumeText`, `isAnalyzing`, `providerInfo`)
- Exported constants: UPPERCASE (e.g., `MAX_UPLOAD_BYTES`, `CONTEXT_STORAGE_KEY`)
- API keys in `.env`: UPPERCASE with underscore (e.g., `FAST_DETECT_GPT_URL`)

**API Endpoints:**
- Hierarchical, noun-based (e.g., `/api/resume/extract`, `/api/interview/questions`)
- No verb prefixes (REST convention)

## Where to Add New Code

**New Feature (Tool or Functionality):**
- Create a new file in `src/sections/` if it's a standalone tool (e.g., `src/sections/CoverLetterGenerator.tsx`)
- Add props interface at the top (follow ResumeAudit/InterviewPrep pattern)
- Import and render in `src/App.tsx` with `<ToolSection>` wrapper
- If the tool needs a new API endpoint, add it to `server.ts` and call it via fetch() in your section component

**New Component (UI Building Block):**
- Create in `src/components/`
- Lean towards presentational (props in, JSX out; minimal state)
- Accept callbacks for actions (e.g., `onUpload`, `onChange`)
- Use existing ToolSection, FileUploader as templates

**New Utility Function:**
- Add to appropriate file in `src/lib/` (or create new if thematic mismatch)
- Export as named export (e.g., `export const myHelper = () => {...}`)
- Import where needed with `import { myHelper } from "../lib/file"`

**New API Endpoint:**
- Add route and handler in `server.ts` after existing endpoints
- Follow error-handling pattern: `try` block, validate inputs, call `generate()` or `generateJSON()` from `providers.ts`, return `res.json(result)`
- If it calls an AI, pass `apiKey` from request body to `generate()`
- Test via `curl` or browser fetch() before integrating with frontend

**New Provider Support (e.g., Claude via Bedrock):**
- Add `ProviderId` type variant in `providers.ts` (e.g., `type ProviderId = ... | "bedrock"`)
- Add functions: `listBedrockModels()`, `scoreBedrockModel()`, `generateBedrock()`
- Register in `SCORERS` and `LISTERS` maps
- Update `detectProvider()` to recognize Bedrock key format
- Test with a Bedrock key at `/api/ai/identify`

**Styling / UI Updates:**
- Tailwind classes in JSX; no CSS files (except `src/index.css` for global imports)
- Dark theme colors already established: `bg-[#0a0c0d]`, `text-[#eef0f3]`, `text-[#6b7685]`, accent `#00d4dc`
- Add new style in existing component or create new component in `src/components/`

## Special Directories

**`node_modules/`:**
- Purpose: Installed npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No (in `.gitignore`)

**`dist/`:**
- Purpose: Production build output
- Generated: Yes (by `npm run build`)
- Contents: 
  - `dist/index.html` — Built SPA with bundled JS
  - `dist/assets/` — Vite output (bundled React + styles)
  - `dist/server.cjs` — Bundled Express server (from esbuild)
- Committed: No (in `.gitignore`)

**`.planning/codebase/`:**
- Purpose: Codebase analysis and documentation (for GSD orchestrator)
- Generated: By GSD mapping commands
- Committed: Yes (version-controlled)

---

*Structure analysis: 2026-08-26*
