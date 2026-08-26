# Codebase Concerns

**Analysis Date:** 2026-08-26

## Tech Debt

**No Test Coverage:**
- Issue: Zero test files in the `src/` directory. All logic — resume parsing, AI provider detection, markdown rendering, PDF/DOCX export — runs untested in production.
- Files: All `src/**/*.ts` and `src/**/*.tsx`
- Impact: Any change risks breaking core functionality silently. Edge cases in provider detection (`providers.ts`), resume extraction (`server.ts`), or markdown rendering (`src/lib/renderMarkdown.tsx`) are discovered only by users.
- Fix approach: Add Jest or Vitest with coverage targets. Start with critical paths: provider detection logic (`providers.ts` lines 45-276), resume text extraction (`server.ts` lines 297-333), and JSON schema parsing for interview Q&A.

**Weak Type Safety:**
- Issue: 13 instances of `any` type throughout codebase, primarily in error handling and response parsing.
- Files: `src/App.tsx` (lines 77, 80), `server.ts` (lines 318, 349), `providers.ts` (lines 362, 396, 402, 405, 440, 441, 485, 502), `src/sections/InterviewPrep.tsx` (line 95), and `src/components/FileUploader.tsx` (line 84)
- Impact: Type mismatches in error handling could cause runtime crashes. Response parsing from AI providers is not validated.
- Fix approach: Replace `any` with specific error types. Create discriminated unions for provider responses. Add schema validation on all AI API responses.

**TypeScript Not in Strict Mode:**
- Issue: `tsconfig.json` lacks `"strict": true`, enabling implicit `any`, loose property checks, and unchecked function parameters.
- Files: `tsconfig.json`
- Impact: Catches only syntax errors, not logic bugs. Adds risk to refactoring.
- Fix approach: Add `"strict": true` to `tsconfig.json` and fix resulting errors incrementally.

## Known Bugs

**Resume Extraction Edge Case — Scanned PDFs:**
- Symptoms: When a PDF is a scanned image with no embedded text, the extraction returns <50 characters; the API rejects it with error "Almost no text could be read". User is asked to paste text, but unclear how to recover.
- Files: `server.ts` lines 394-400, `src/components/FileUploader.tsx` lines 71-90
- Trigger: Upload a PDF created from a photograph or scan
- Workaround: User must manually extract text (via OCR tool) and paste as plain text

**API Key Visibility in localStorage:**
- Symptoms: API keys stored in plaintext in localStorage are readable by any script with access to the DOM or DevTools. XSS vulnerability would expose user credentials.
- Files: `src/App.tsx` lines 22, 31-32, 44, 98
- Trigger: User adds API key; any XSS attack or malicious browser extension gains access
- Workaround: None. User must revoke compromised keys manually.

## Security Considerations

**Bring-Your-Own-Key Storage in Browser:**
- Risk: API keys are persisted in localStorage and loaded on each page load. No encryption, no session timeout.
- Files: `src/App.tsx` (CONTEXT_STORAGE_KEY and API_KEY_STORAGE_KEY), `src/components/ApiKeySetup.tsx` lines 173-189
- Current mitigation: Key is not sent to any third party (only to AI provider on user's behalf); component disclaimers mention "saved in this browser only". Insufficient if browser is compromised.
- Recommendations: 
  1. Offer sessionStorage-only mode (lose key on page close).
  2. Add optional browser Credential Management API integration.
  3. Warn users explicitly about the localStorage risk in setup UI.

**User Input Sent Directly to AI Models:**
- Risk: Resume text and job descriptions are sent verbatim to AI providers without sanitization. If a prompt injection occurs, it could manipulate the AI's behavior.
- Files: `server.ts` lines 421-431, 465-477, 505-517
- Current mitigation: None. Prompts are constructed by concatenating user input.
- Recommendations:
  1. Add input length limits (resume: 50KB max, job description: 10KB max).
  2. Consider prompt escaping or templating to isolate user input from instructions.
  3. Log suspicious inputs (e.g., text containing "Ignore previous instructions").

**Resume Text Leakage via Error Messages:**
- Risk: If an AI API fails, the error might be logged/displayed with the full resume text still in the prompt.
- Files: `server.ts` (error handlers), `src/sections/ResumeAudit.tsx` line 150, `src/sections/InterviewPrep.tsx` line 95
- Current mitigation: Error messages are generic ("Could not reach the model"); full prompts are not returned.
- Recommendations:
  1. Redact user input from error messages.
  2. Log errors to a server-side audit trail, not back to the client.

**No Rate Limiting on API Calls:**
- Risk: A malicious user or bot could spam requests, exhausting user's AI provider quota or causing high bills.
- Files: `server.ts` (all `/api/` endpoints)
- Current mitigation: Express receives requests without throttling. Provider SDKs may have their own quotas, but no in-app defense.
- Recommendations:
  1. Add per-session rate limiting (e.g., max 10 requests/minute).
  2. Implement API quota tracking and user-facing warnings.

## Performance Bottlenecks

**Large Dependency Bundle for Dynamic Imports:**
- Problem: jsPDF (~370KB) and docx (~370KB) are dynamically imported on export button click. Initial page load is fast, but export triggers multi-second download delay.
- Files: `src/lib/exportQA.ts` lines 38, `src/sections/ResumeAudit.tsx`, `src/sections/InterviewPrep.tsx`
- Cause: Libraries are feature-rich but overkill for the formatting needed. No tree-shaking.
- Improvement path:
  1. Benchmark actual usage. If users rarely export, current approach is acceptable.
  2. If exports are frequent, consider lighter alternatives (e.g., html2pdf for PDF, turndown for DOCX->HTML).
  3. Preload libraries during idle time if exports are common.

**Resume Extraction for Large Files:**
- Problem: Mammoth and unpdf run in the browser on base64-encoded files. A 5MB resume takes several seconds to parse and extract.
- Files: `src/components/FileUploader.tsx` lines 71-90, `server.ts` lines 297-333
- Cause: Base64 encoding bloats the request by ~33%; PDF parsing is CPU-intensive.
- Improvement path:
  1. Send binary file data instead of base64 to reduce payload.
  2. Add a progress indicator while parsing.
  3. If parsing >3 seconds frequently, move parsing to a Web Worker.

**Provider Model Discovery Cached for Only 10 Minutes:**
- Problem: On every key verification or after 10 minutes, the app re-queries the provider's model list. For users with low quota, this burns API calls.
- Files: `providers.ts` lines 202-206, 220-221
- Cause: TTL of 10 minutes is arbitrary; no user control over refresh frequency.
- Improvement path:
  1. Extend TTL to 1 hour or longer.
  2. Add manual "refresh model list" button with confirmation.
  3. Cache model list per-key hash, not globally.

## Fragile Areas

**Provider Detection Logic:**
- Files: `providers.ts` lines 45-52, 223-276
- Why fragile: Key format detection relies on prefix matching (sk-ant-, AIza, sk-). If a provider changes key format, or if a user miscopies a key, the detection fails silently and tries all providers in order. A key that is valid for one provider but malformed for another will consume quota as it's tested against each.
- Safe modification: Add unit tests for key format detection. Log which provider is being tested as a user-facing debug hint.
- Test coverage: No tests for edge cases (partial keys, typos, future formats).

**Markdown Rendering from AI Output:**
- Files: `src/lib/renderMarkdown.tsx`, `src/sections/ResumeAudit.tsx` lines 36-72
- Why fragile: Parser assumes AI follows [[Section]] markers and uses a regex-based section splitter. If the AI returns malformed markers or ignores the format, the entire report is crammed into "Callback Score" tab, and users see unstructured output.
- Safe modification: Add validation that all 13 expected sections are present before assuming success. Add a "fallback" tab for unparseable output.
- Test coverage: No tests for malformed AI output (missing markers, extra whitespace, different casing).

**Error Message Extraction from SDK Responses:**
- Files: `providers.ts` lines 396-436
- Why fragile: Tries to parse error messages from JSON envelopes returned by SDKs. Different SDKs use different structures; the code tries multiple fields (`error.message`, `error.code`, `parsed?.error?.message`). If a new provider returns an unexpected shape, error messages are cryptic.
- Safe modification: Add a providers-specific error parser for each SDK.
- Test coverage: No tests for various error responses from Google, OpenAI, Anthropic.

**Scoring Table Seeding:**
- Files: `src/sections/InterviewPrep.tsx` lines 93, 51
- Why fragile: Interview scoring table is initialized with 8 blank rows named "Interview question #1", etc., then replaced with real questions if generation succeeds. If generation fails mid-way or the client reconnects, question names become stale. Renaming a question doesn't re-seed the table.
- Safe modification: Sync scoreRows with pairs whenever pairs change. Use question text as key, not array index.
- Test coverage: No tests for state misalignment between pairs and scoreRows.

## Scaling Limits

**In-Memory Provider Resolution Cache:**
- Current capacity: 100s of users on a single server instance (cache holds SHA256 hashes of API keys; minimal memory per entry)
- Limit: If deployed across multiple servers without a shared cache, each server re-queries the provider's model list independently, multiplying API calls.
- Scaling path:
  1. For single-server deployments, current in-memory cache is fine.
  2. For multi-server, migrate cache to Redis with a 1-hour TTL.

**No Database (Single-Server Deployment):**
- Current capacity: Stateless HTTP. Can scale horizontally with a load balancer, but no persistent state.
- Limit: If users expect to log back in and see previous audits/scores, no storage exists.
- Scaling path: Add optional SQLite for local dev, PostgreSQL for production. Store audit history per user (identified by session or email).

## Dependencies at Risk

**Unmaintained or Slow-Release Libraries:**
- Risk: `mammoth@1.12.1` (docx text extraction) has not been updated since 2023. If Microsoft changes the .docx format, no fix is available.
- Impact: DOCX files generated by newest Microsoft Office versions may not parse.
- Migration plan: Monitor mammoth GitHub issues. If abandoned, migrate to `docx-parser` or a commercial library.

**jsPDF Complexity:**
- Risk: jsPDF has known issues with text measurement and font encoding. If custom fonts or international characters are needed, switching to a lighter PDF library (e.g., `pdfkit` or `html2pdf`) may be necessary.
- Impact: Export quality issues for non-ASCII resumes or unusual formatting.
- Migration plan: Track reported issues. Pre-screen exported PDFs for visual correctness.

**Google Gemini API Instability:**
- Risk: Google's GenAI API (`@google/genai`) is in beta (v2.x). API changes can break the app with no warning.
- Impact: Sudden failures for users whose key resolves to Gemini.
- Migration plan: Maintain fallback to Claude or GPT. Test Google models in CI/CD.

## Missing Critical Features

**No Audit Log:**
- Problem: No record of which audits were run, when, or what the results were. If a user wants to re-run an audit weeks later, they must re-upload and re-analyze.
- Blocks: Can't offer users a "history" or "compare versions" feature.

**No User Sessions:**
- Problem: All state is client-side or ephemeral. If a browser crashes mid-analysis, all progress is lost. No way to share results.
- Blocks: Can't offer users "save this analysis" or "send results to email".

**No Structured Resume Database:**
- Problem: Resume text extraction is lossy (formatting, structure ignored). Can't offer skills-based matching or "see jobs that match your resume" features.
- Blocks: Can't build resume-to-job recommendation engine.

## Test Coverage Gaps

**Provider Detection:**
- What's not tested: Key format edge cases, partial keys, unknown formats, timeouts during model list retrieval, SDK auth errors, and fallback to next provider.
- Files: `providers.ts`
- Risk: Provider detection is the gateway to all AI calls. A bug here breaks the entire app for affected users.
- Priority: High

**Resume Text Extraction:**
- What's not tested: Mammoth/unpdf parsing of corrupted PDFs, non-UTF8 text encodings, mixed formats (e.g., PDF with embedded images), and 5MB file handling.
- Files: `server.ts` lines 297-333
- Risk: Extraction silently fails or returns garbage, invalidating all downstream scores.
- Priority: High

**AI Response Parsing:**
- What's not tested: Malformed JSON in interview Q&A, missing schema fields, duplicate questions, and AI refusals (Anthropic only).
- Files: `server.ts` lines 479-490, `src/sections/InterviewPrep.tsx` lines 86-93
- Risk: If parsing fails, user sees generic error instead of actionable feedback.
- Priority: High

**Markdown Rendering:**
- What's not tested: Nested lists, code blocks, links, HTML-like tags in AI output, and missing section markers.
- Files: `src/lib/renderMarkdown.tsx`
- Risk: AI output with unexpected formatting is rendered incorrectly, confusing users.
- Priority: Medium

**Export Functions:**
- What's not tested: Special characters in filenames, PDF/DOCX corruption, memory cleanup after large exports, and browser compatibility.
- Files: `src/lib/exportQA.ts`, `src/sections/ResumeAudit.tsx`, `src/sections/InterviewPrep.tsx`
- Risk: Exports fail silently or are corrupted. Blob/URL cleanup leaks memory.
- Priority: Medium

**Error Handling:**
- What's not tested: Network timeouts, partial responses, invalid JSON, SDK errors with missing fields, and cascading failures (e.g., provider rejected, retry on fallback also fails).
- Files: `server.ts` (all endpoints), `src/components/FileUploader.tsx`, `src/sections/*.tsx`
- Risk: Generic "try again" messages hide real problems. Users retry endlessly.
- Priority: Medium

---

*Concerns audit: 2026-08-26*
