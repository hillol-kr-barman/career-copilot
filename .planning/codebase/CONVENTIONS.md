# Coding Conventions

**Analysis Date:** 2026-08-26

## Naming Patterns

**Files:**
- React components: PascalCase with `.tsx` extension (e.g., `ApiKeySetup.tsx`, `ToolSection.tsx`)
- Utility/library files: camelCase with `.ts` extension (e.g., `download.ts`, `exportQA.ts`, `renderMarkdown.tsx`)
- Configuration files: descriptive lowercase or camelCase (e.g., `server.ts`, `vite.config.ts`)

**Functions:**
- camelCase for all functions (arrow functions and regular functions): `loadContext`, `handleDetect`, `detectAiStatistically`, `extractResumeText`
- Descriptive names that indicate purpose and action (verb + noun pattern)

**Variables:**
- camelCase for all local variables and state: `apiKey`, `isVerifying`, `resumeText`, `verifyError`
- Boolean flags use `is` or `has` prefix: `isDetecting`, `isVerifying`, `connected`, `locked`

**Constants:**
- CONSTANT_CASE for top-level constants: `CONTEXT_STORAGE_KEY`, `API_KEY_STORAGE_KEY`, `MAX_UPLOAD_BYTES`, `DEFAULT_RESUME_PROMPT`
- Used for configuration values, API endpoints, magic strings, limits

**Types and Interfaces:**
- PascalCase for all types and interfaces: `SharedContext`, `ProviderInfo`, `QAPair`, `ScoreRow`, `ApiKeySetupProps`
- Props interfaces follow pattern `{ComponentName}Props` (e.g., `ToolSectionProps`)
- Use full words in type names, no abbreviations

**React Components:**
- PascalCase for component names (both filename and export): `App`, `ApiKeySetup`, `SharedInputs`
- Type components with `React.FC<Props>` pattern
- Named exports preferred: `export const ComponentName: React.FC<Props> = ...`

## Code Style

**Formatting:**
- No dedicated linter/formatter config (no `.eslintrc`, `.prettierrc`, `biome.json`)
- TypeScript compiler used for validation: `npm run lint` runs `tsc --noEmit`
- Indentation: 2 spaces (observed in codebase)
- Trailing semicolons: used consistently
- Arrow functions preferred over function keyword for callbacks and short functions

**Linting:**
- TypeScript strict mode implied (tsconfig.json has `isolatedModules: true`, `noEmit: true`)
- Type checking only — no style enforcement beyond TypeScript rules
- No automatic code formatting — rely on IDE/editor for consistency

## Import Organization

**Order:**
1. External packages (React, libraries): `import React from "react"`, `import { useState } from "react"`
2. External UI libraries: `import { KeyRound, Eye } from "lucide-react"`
3. Internal types: `import { ProviderInfo, SharedContext } from "../types"` or `import type { ... }`
4. Internal components: `import { ApiKeySetup } from "./components/ApiKeySetup"`
5. Internal utilities/libs: `import { downloadBlob } from "../lib/download"`

**Path Aliases:**
- `@/` maps to project root (configured in `tsconfig.json`)
- Used for imports from root-level files: `import { generate, generateJSON } from "@/providers"`
- Not always used (relative paths also common), but available for convenience

**Type Imports:**
- Use `import type { SomeName }` for TypeScript-only imports to avoid bundling issues

## Error Handling

**Patterns:**
- Try-catch blocks in async functions for await chains
- Synchronous error handling via custom Error objects with `statusCode` property
- Promise chains use `.catch()` for error handling
- Error state stored in component state (e.g., `[error, setError]`)
- Errors displayed to users via error UI components (div with red styling)

**Custom Errors:**
```typescript
// Example from providers.ts and server.ts
function authError(message: string): Error {
  const err: any = new Error(message);
  err.statusCode = 401;
  return err;
}
```

**Null checks:**
- Use `Boolean()` for null/undefined checks: `const connected = Boolean(providerInfo)`
- Use optional chaining: `error?.message`, `error?.statusCode`
- Use nullish coalescing: `value || "fallback"`

## Logging

**Framework:** `console` — no dedicated logging library

**Patterns:**
- `console.log()` for informational messages
- `console.error()` for error conditions
- Log messages include context: `console.log('Key identification failed:', error?.message)`
- No structured logging — simple string messages

**Examples from codebase:**
```typescript
// server.ts
console.log(`[ai-detect] scores — burst:${burstScore.toFixed(2)} ...`);
console.error("Error in /api/resume/extract:", error);
console.log("Key identification failed:", error?.message);
```

## Comments

**When to Comment:**
- Complex algorithms or non-obvious logic (e.g., AI detection scoring in `server.ts`, regex parsing in `renderMarkdown.tsx`)
- Important clarifications about why something is done a certain way
- Section separators using comment lines with dashes: `// ── Signal 1: Burstiness ──────`
- NOT for obvious code (avoid noise)

**JSDoc/TSDoc:**
- Used for complex functions and components
- Explain purpose, key details, and important context
- Format: `/** ... */` over regular comments for public functions

**Examples:**
```typescript
/**
 * Identify the engine and model behind the current key.
 *
 * Debounced because this fires as the user types or pastes, and aborted on
 * change so a slow earlier check can't overwrite a newer result.
 */
useEffect(() => { ... }, [apiKey]);

/**
 * Tool 1 — runs the local statistical detector over the shared resume.
 * No API key needed: /api/ai-detect never calls out to a model.
 */
export const AiDetection: React.FC<AiDetectionProps> = ...
```

## Function Design

**Size:** Functions are generally compact (10-50 lines), extracted into smaller helpers when logic gets complex

**Parameters:**
- Use destructuring for object parameters
- Props passed as single props object to components
- Callback handlers prefixed with `on`: `onApiKeyChange`, `onChange`, `onTextLoaded`

**Return Values:**
- React components return JSX/React.ReactNode
- Utility functions return specific types (never bare `any`)
- Server endpoints return JSON via `res.json()`
- Functions that fail throw errors or use .catch()

**Async Patterns:**
```typescript
// Fetch with proper error handling
const response = await fetch(url);
const data = await response.json();
if (!response.ok) throw new Error(...);

// AbortController for cancellation (seen in App.tsx)
const controller = new AbortController();
const timer = setTimeout(() => {
  fetch(url, { signal: controller.signal }).catch(err => {
    if (err?.name === "AbortError") return;
    // handle error
  });
}, 600);
return () => {
  clearTimeout(timer);
  controller.abort();
};
```

## Module Design

**Exports:**
- Named exports preferred: `export const ComponentName = ...` or `export function name() {}`
- Default exports used for main App component: `export default function App()`
- Barrel files NOT used (no index.ts re-exporting multiple items)

**File Structure:**
- One component per file (React components)
- Related utilities grouped by domain (all download utils in `download.ts`)
- Types centralized in `src/types.ts`
- Server logic co-located in `server.ts` (not split into route files)

**Dependencies:**
- Prefer functional dependencies over class-based
- React hooks for state management (no Redux or Context API used)
- Props passed down through component tree
- Shared state managed at top level (App.tsx) with setter callbacks

## Key Conventions Summary

| Item | Pattern | Example |
|------|---------|---------|
| React Component | PascalCase + React.FC<Props> | `export const ApiKeySetup: React.FC<ApiKeySetupProps> = ...` |
| Utility Function | camelCase arrow function | `export const downloadBlob = (filename: string, blob: Blob) => ...` |
| Constant | CONSTANT_CASE | `const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;` |
| Variable | camelCase | `const [isVerifying, setIsVerifying] = useState(false);` |
| Handler Function | camelCase + "handle" prefix | `const handleDetect = async () => ...` |
| Props Interface | ComponentName + "Props" | `interface ApiKeySetupProps { ... }` |
| Event Handler Callback | "on" + PascalCase event | `onApiKeyChange`, `onChange`, `onTextLoaded` |
| Boolean Variable | "is"/"has" prefix | `isVerifying`, `connected`, `locked` |
| Type Import | import type { } | `import type { Paragraph as ParagraphType } from "docx";` |
| Error Object | Custom with statusCode | `const err: any = new Error(msg); err.statusCode = 401;` |

---

*Convention analysis: 2026-08-26*
