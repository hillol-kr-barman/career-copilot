# External Integrations

**Analysis Date:** 2026-08-26

## APIs & External Services

**LLM Providers:**
- **Google Gemini** - Text generation for interview prep and resume analysis
  - SDK/Client: `@google/genai` 2.4.0
  - Auth: User-provided API key (detected by `AIza*` prefix)
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models`
  - Method: Direct REST API via SDK
  - Configuration: `providers.ts` lines 93–112

- **OpenAI** - GPT models for analysis tasks
  - SDK/Client: `openai` 7.5.0
  - Auth: User-provided API key (detected by `sk-*` prefix, excludes Anthropic)
  - Method: Official OpenAI SDK
  - Configuration: `providers.ts` lines 137–159

- **Anthropic Claude** - Text generation (Sonnet preferred, with Haiku/Opus fallbacks)
  - SDK/Client: `@anthropic-ai/sdk` 0.120.0
  - Auth: User-provided API key (detected by `sk-ant-*` prefix)
  - Method: Official Anthropic SDK
  - Configuration: `providers.ts` lines 161–182

**Multi-Provider Architecture:**
- User provides a single API key from any of the three providers
- Key prefix detection: `detectProvider()` in `providers.ts` lines 45–52
- Provider is identified at runtime on each request (`resolveProvider()` at `providers.ts` lines 214–276)
- Model selection: Automatic ranking based on availability and version (not hardcoded)
- Caching: Provider info cached for 10 minutes per key (SHA256 hash)
- Fallback models: On transient errors (503, 429, timeout), retries on next-ranked model
- Request routing:
  - `/api/ai/identify` - Verify key and discover available models
  - `/api/resume/analyze` - Multi-provider text generation
  - `/api/interview/questions` - Structured JSON output from any provider
  - `/api/interview/evaluate` - Candidate evaluation via any provider

**Timeout Configuration:**
- Model discovery: 20 seconds (`AbortSignal.timeout(20000)`)
- Generation requests: 120 seconds (`timeout: 120000`)

## Data Storage

**Databases:**
- None - Application is stateless

**File Storage:**
- Local filesystem only (development/demo mode)
- Public directory: `public/` (created if missing at startup)
- No cloud storage integration

**Caching:**
- In-memory only: Provider resolution cache (`resolutionCache` in `providers.ts` lines 197–203)
- Client-side: Browser localStorage for session persistence
  - Key: `cc_shared_context` - Resume, job description, applied position
  - Key: `user_ai_api_key` - User's API key (plaintext)
  - Legacy fallback: `user_gemini_api_key` (from v1 migration)

## Authentication & Identity

**Auth Provider:**
- Custom - No centralized authentication
- User provides their own API key from chosen LLM provider
- Keys are validated by attempting model list discovery at provider

**Key Management:**
- Keys stored in browser localStorage (not encrypted)
- Keys sent to backend via HTTPS POST in request body
- No rate limiting or API key rotation enforced server-side
- Each request includes full API key (not token-based)

**Security Model:**
- Bring-your-own-key (BYOK) architecture
- No server-side key storage
- No operator billing/key management
- Keys never logged (only shown in UI for confirmation)

## Monitoring & Observability

**Error Tracking:**
- None - Application logs to console only

**Logs:**
- Console-based logging via `console.log()` and `console.error()`
- Development: Server logs AI provider calls, detection scores, and errors
- No centralized log aggregation or remote error reporting
- Log examples:
  - `[ai] ${model} unavailable, trying next model…` (transient retry)
  - `[ai-detect] scores — burst:... ttr:... → composite:...` (detection scoring)
  - Error messages: "Key identification failed", "Error in /api/resume/extract", etc.

## CI/CD & Deployment

**Hosting:**
- Traditional Node.js server hosting (not serverless)
- Port: 3000 (hardcoded, `server.ts` line 337)
- Environment: `NODE_ENV` (development vs. production)
- Server binding: `0.0.0.0` (all interfaces)

**CI Pipeline:**
- Not detected - No GitHub Actions, GitLab CI, or similar

**Build Process:**
1. `npm run build` - Builds React app via Vite, bundles server with esbuild
2. Output: `dist/` directory with app files and `dist/server.cjs`
3. `npm run start` - Runs compiled server

**Development:**
- `npm run dev` - Hot reloading via Vite dev server
- Vite HMR controlled by `DISABLE_HMR` env var (for IDE integration, disables file watching)

## Environment Configuration

**Required env vars:**
- None (all external integrations use user-provided API keys)

**Optional env vars:**
- `NODE_ENV` - Set to "production" for production builds (default: development)
- `FAST_DETECT_GPT_URL` - Optional: URL of local fast-detect-gpt server (e.g., `http://localhost:8765/detect`) for advanced AI detection
- `DISABLE_HMR` - Set to "true" to disable Vite HMR and file watching (used in AI Studio)

**Secrets location:**
- `.env` file (in project root, not in Git)
- Currently holds only application config (not secrets with BYOK model)

## Webhooks & Callbacks

**Incoming:**
- None - Application is request-response only

**Outgoing:**
- None - No callbacks or outbound webhooks to external services

## Document Processing

**Supported Input Formats:**
- PDF - Via `unpdf` (PDF.js based)
- DOCX - Via `mammoth` library
- TXT, CSV, MD - Direct text parsing

**Extraction:**
- Endpoint: `/api/resume/extract` (server.ts lines 375–407)
- Max file size: 5MB
- Minimum text output: 50 characters (scanned images rejected)
- Error handling: Specific format rejection, not fallback

**Export Formats:**
- PDF - Via `jspdf` library
- DOCX - Via `docx` library (for Q&A export)

## Local AI Detection (Offline)

**AI Content Detection:**
- Endpoint: `/api/ai-detect` (server.ts lines 543–584)
- Primary: Local statistical detector (no API key required)
  - 6 linguistic signals: burstiness, vocabulary richness, AI phrase markers, transition density, sentence length, punctuation
  - Weighted combination: 30% phrase detection, 20% transitions/burst, 10% TTR/sentLen/punct each
  - Output: `aiProbability` (0-100%), `engine: "Local Statistical Detector"`

**Optional External:**
- Secondary: fast-detect-gpt (PyTorch-based, user-run locally if `FAST_DETECT_GPT_URL` set)
  - If configured, tries local server before falling back to statistical method
  - Timeout: 30 seconds

## Structured Output

**Interview Q&A Schema:**
- JSON Schema (strict mode for OpenAI, schema mode for Anthropic, JSON schema for Google)
- Generated via `/api/interview/questions` with `generateJSON()` call
- Schema defined in `server.ts` lines 116–145
- Output: Array of Q&A pairs with question, model answer, category, rationale

---

*Integration audit: 2026-08-26*
