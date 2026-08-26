# Code Review — Career Copilot

**Date:** 2026-08-26
**Reviewed at commit:** `f58c137`
**Method:** Full read of every source file, plus executable proofs run against the real
scoring/regex logic. Findings marked **PROVED** were demonstrated by running code, not
inferred. Findings marked **INSPECTION** are reasoned from reading the source.

---

## How to use this file

This is the authoritative starting point for remediation work. It was produced
immediately before GSD onboarding, so `/gsd-map-codebase` did **not** inform it and
`.planning/codebase/CONCERNS.md` will not contain these findings.

When you run `/gsd-new-project` (or `/gsd-plan-phase`), point it at this file so the
roadmap includes the fixes. The **Top 3** section below is the intended first phase.

> Provenance note: several of the Critical/High findings are in `providers.ts`, which was
> written in the same session that produced this review. The multi-provider ranking layer
> was validated end-to-end against a real **Google** key only. The Anthropic and OpenAI
> scorers were never run against real model lists — which is exactly where C-1 lives.
> Treat the ranking layer as the least-trustworthy code in the repo.

---

## What the project is

Express + React 19 + Vite. One page, three tools:

1. **Resume AI Detection** — local statistical detector, no API key, no external call
2. **Resume Audit** — LLM, returns 13 `[[Section]]`-delimited tabs, headline callback %
3. **Interview Prep** — LLM with structured JSON output, 8 Q&A pairs, PDF/DOCX export

Bring-your-own-key and provider-agnostic: `providers.ts` detects the vendor from the key,
discovers models via each vendor's list-models endpoint, ranks them, and dispatches
generation through one unified `generate()` with failover to lower-ranked models.

---

## CRITICAL

### C-1 — `scoreAnthropic` reads the release date as a minor version
`providers.ts:180` (regex), `providers.ts:76-83` (`familyVersion`) · **PROVED**

The minor-version group `(?:[-.](\d+))?` accepts `-` as a separator. On IDs shaped
`claude-<tier>-<major>-<date>` the entire 8-digit date is captured as the minor:

```
familyVersion("claude-sonnet-4-20250514")    -> 2025055.4
familyVersion("claude-sonnet-4-5-20250929")  -> 4.5
```

Observed ranking on a realistic Anthropic `/v1/models` list:

| score | model |
|---|---|
| **20250581** | `claude-sonnet-4-20250514` ← chosen |
| **20250561** | `claude-opus-4-20250514` ← alternate #1 |
| 72 | `claude-sonnet-4-5-20250929` |
| 62 | `claude-haiku-4-5-20251001` |
| 52 | `claude-opus-4-5-20251101` |
| 48 | `claude-opus-4-1-20250805` |

Older IDs escape by accident (`claude-3-opus-20240229` → 3, because `-opus` isn't digits),
so the bug fires *only* on the current naming scheme. The ranking is systematically
inverted toward Claude 4.0, not merely noisy.

**Knock-on failure:** `generateAnthropic` (`providers.ts:372`) sends
`output_config.format = {type:"json_schema"}`. Structured outputs are only supported from
the Sonnet 4.5 / Opus 4.5 generation onward. Because C-1 pins Anthropic keys to
`claude-sonnet-4-20250514`, `/api/interview/questions` hard-`400`s. A 400 is not transient
(`isTransient`, `providers.ts:439`), so `generate()` breaks out of the failover chain on
the first model and never reaches the correctly-ranked alternates. **Interview Prep is
broken for every Anthropic user, and the failover designed to survive this is bypassed.**

**Fix:** bound the minor to 1–2 digits and reject a following digit:

```ts
/claude-(?:[a-z]+-)*?(\d+)(?:[-.](\d{1,2}))?(?![\d])/i
```

Better still, strip a trailing `-\d{8}` before calling `familyVersion` — `scoreAnthropic`
already detects that pattern one line above for its `dated` penalty. Add a defensive
clamp in `familyVersion`: `if (minor > 99) return major;`.

---

## HIGH

### H-1 — Raw SDK errors reach the browser; `fail()` reads the wrong status field
`providers.ts:271`, `server.ts:349-352`, `server.ts:362-372` · **PROVED + INSPECTION**

Two compounding bugs:
- `providers.ts:271` throws `lastError` untouched, bypassing `describeProviderError`.
- `fail()` reads `error?.statusCode ?? 500`, but OpenAI/Anthropic `APIError` carries
  `.status`, never `.statusCode`.

OpenAI builds `APIError.message` as `` `${status} ${error.message}` `` (confirmed in
`node_modules/openai/core/error.js:20-30`). So a valid-but-rate-limited OpenAI key returns
**HTTP 500** with:

```
429 Rate limit reached for gpt-4o in organization org-XXXXXXXXXXXX on requests per min...
```

Wrong status, and it discloses the caller's **OpenAI organization ID and quota
configuration** to the browser and into `console.log` at `server.ts:369`.

**Fix:** `error?.statusCode ?? error?.status ?? 500` in `fail()`; run `lastError` through
`describeProviderError` before throwing in `resolveProvider`.

### H-2 — `/api/ai-detect` is unauthenticated, unmetered, 20 MB, and blocks the event loop
`server.ts:339`, `server.ts:543-584`, `server.ts:162-289` · **PROVED**

`detectAiStatistically` on an 18 MB body blocked the Node event loop for **566 ms** in one
synchronous call — full-text `.replace`, a `.match` over the whole string, a `Set` over
every word, 33 regex `.test`s, and 20 freshly-constructed global regexes each scanning the
entire input. The only guard is a 50-character *floor*; there is no ceiling.

No API key is required (the route never calls a model) and there is **no rate limiting
anywhere in the app**. A few concurrent 18 MB POSTs pin the process.

**Fix:** `text.slice(0, 50_000)` before scoring; drop `express.json` to ~8 MB; add
`express-rate-limit` across `/api/*`.

### H-3 — `/api/ai/identify` is an open API-key validation oracle
`server.ts:362-372`, `providers.ts:214-276` · **INSPECTION**

Unauthenticated and unthrottled, it answers a precise question about an arbitrary secret:
is this key live, which vendor owns it, and which models it can reach (the full
`ProviderInfo`, alternates included). Anyone with a list of scraped keys can triage them
through this deployment, from the operator's IP. With H-1 it also reveals the owning org.

**Fix:** hard per-IP rate limit (~5/min); return only `{provider, providerLabel, model}`.

### H-4 — Unrecognised keys are broadcast to all three vendors; Google key travels in the URL
`providers.ts:232-234`, `providers.ts:94-97` · **INSPECTION**

When `detectProvider` returns `null` the probe loop tries google → openai → anthropic, so a
secret that isn't an AI key at all (an AWS key, a DB password pasted in error) is sent to
three unrelated third parties. This is a documented decision (`providers.ts:225-231`), not
an accident — but it is still an unexpected exfiltration path.

Separately `listGoogleModels` sends `?key=<apiKey>`. Query strings land in proxy, CDN, and
OS network logs in a way headers do not. Google supports `x-goog-api-key`.

**Fix:** move to the header. Either drop the probe (an unrecognised prefix is
overwhelmingly a typo) or warn before probing.

### H-5 — `resolutionCache` never evicts
`providers.ts:202-203`, `providers.ts:220-221`, `providers.ts:267` · **PROVED**

200,000 distinct keys → `map.size = 200000`, **68 MB heap**, every entry already expired.
Line 221 checks `expiresAt > Date.now()` and falls through on a miss but never `.delete()`s,
and nothing sweeps. Growth is bounded only by the number of distinct strings ever seen.
With H-3 this is anonymously reachable: ~340 bytes per distinct key, forever.

**Fix:** delete on expired read; bound the map (LRU or size cap). An `.unref()`ed
`setInterval` sweep also works.

### H-6 — Google tier weights exceed one version step
`providers.ts:133-134` · **PROVED**

```
55  gemini-2.5-flash     <- chosen
45  gemini-1.5-flash
40  gemini-2.5-pro
37  gemini-3-pro-preview
30  gemini-flash-latest
15  gemini-pro-latest
```

`gemini-1.5-flash` (45) outranks `gemini-2.5-pro` (40) and `gemini-3-pro-preview` (37).
flash=30 vs pro=15 is a 15-point gap against a 10-point version step, so any Flash beats
any Pro up to two generations newer — including when that Pro is the only capable model on
the key. This is the same arithmetic error the `stabilityBonus` comment
(`providers.ts:87-88`) explicitly guards against but never applies to tiers.

Also: `gemini-flash-latest` / `gemini-pro-latest` score 30 and 15 because `familyVersion`
returns 0 with no digits. These are Google's future-proof rolling aliases — precisely what
the module header (`providers.ts:9-12`) claims the design prefers — and they rank near the
bottom.

**Fix:** narrow tier deltas below the version step (flash=6, pro=3, flash-lite=1); give
`-latest` aliases a synthetic high version.

---

## MEDIUM

### M-1 — `describeProviderError` lets a nested JSON `code` override the real HTTP status
`providers.ts:400-412` · **PROVED**

```js
describeProviderError({status:503, message:'{"error":{"code":400,"message":"API key not valid…"}}'}, "Google Gemini")
// -> { status: 502, message: 'API key not valid. Please pass a valid API key.' }
```

`code` is seeded from `err.status` then unconditionally overwritten. Google's actual
bad-key shape carries `code: 400`, so it never reaches the 401 branch and surfaces as a
generic 502 — the UI says "unexpected error" instead of "check your key".

**Fix:** `if (code === undefined && typeof e?.code === "number") code = e.code;` and strip a
leading `^\d{3}\s` from `inner`.

### M-2 — `isTransient` matches the substring "try again" regardless of status
`providers.ts:439-448` · **PROVED**

`isTransient({status:401, message:"Invalid API key, please try again."})` → `true`. The app
then walks all four models with 400 ms sleeps, burning ~1.6 s and four calls on a key that
cannot work. The comment at `providers.ts:478` describes behaviour the code lacks.

**Fix:** short-circuit before the blob test —
`if ([400,401,403,404].includes(code)) return false;`

### M-3 — Callback percentage takes the first `%` in the section, not the labelled one
`src/sections/ResumeAudit.tsx:75-82` · **PROVED**

```
"Only 15% of the required keywords appear.\nCallback Likelihood: 72%"  -> 15   (expected 72)
"Score on a 0-100% scale: 72%"                                        -> 100  (expected 72)
```

`/(\d{1,3})\s*%/` is unanchored. This is the product's single most prominent number — it
drives both the figure and the red/amber/green bar — and it fails silently.

**Fix:** `content.match(/Callback\s+Likelihood\s*:\s*(\d{1,3})\s*%/i)`, loose regex as
fallback only.

### M-4 — `parseSections` matches markers by exact string equality
`src/sections/ResumeAudit.tsx:37-51` · **PROVED**

If the model emits `[[What’s Working]]` (U+2019), the marker and its whole body get
appended to the *previous* tab and the real tab reads "The model did not return this
section." `What's Working` is the only one of the 13 tab names containing an apostrophe,
typographic-apostrophe substitution is routine LLM behaviour, and it is a headline tab.

**Fix:** normalise before comparing — `stripped.replace(/[’‘]/g, "'")` — and match
case-insensitively.

### M-5 — No per-item validation of model-returned QA pairs
`server.ts:486-491`, `src/sections/InterviewPrep.tsx:89` · **INSPECTION**

Server checks only `Array.isArray(pairs) && pairs.length > 0`; client does an unchecked
`const generated: QAPair[] = data.pairs`. With `strict` off, TS won't flag it. `pairs:[null]`
yields blank cards, `scoreRows` seeded from `undefined`, and
`doc.splitTextToSize(undefined)` throwing in `exportQA.ts:71`.

**Fix:** filter server-side to items with non-empty string `question` and `answer`; 502 if
none survive.

### M-6 — Upload limit enforced after the payload is parsed and decoded
`server.ts:12`, `server.ts:339`, `server.ts:383-388` · **PROVED**

A 20 MB base64 body decodes to a 15 MB Buffer in 5 ms — allocated in full *before* the
5 MB check rejects it, on top of the 20 MB string Express already buffered. ~55 MB of
transient allocation per rejected request, unthrottled.

Also: `Buffer.from("!!!!not base64 at all????", "base64")` returns 10 bytes silently, so
malformed base64 reaches `getDocumentProxy`/`mammoth` as garbage.

**No path traversal exists** — `extractResumeText` only does `fileName.split(".").pop()` and
the server never touches the filesystem with the supplied name. Two lesser parsing bugs:
`"resume.PDF "` (trailing space) → suffix `"pdf "` → "Unsupported file type";
`"resume"` (no dot) → error reads `Unsupported file type ".resume"`.

**Fix:** reject on `dataBase64.length > MAX_UPLOAD_BYTES * 1.37` before decoding; trim the
suffix; handle the no-dot case.

### M-7 — No timeout on the Google generation path
`providers.ts:313-335` · **INSPECTION**

`generateOpenAI` and `generateAnthropic` both pass `timeout: 120000`; `GoogleGenAI` gets
none and no `AbortSignal`. (Contrast `listGoogleModels`, which correctly uses
`AbortSignal.timeout(20000)`.) A stalled connection holds the handler, the client fetch,
and the spinner open indefinitely — there is no client-side timeout on any of the three
tool fetches either.

**Fix:** `httpOptions: { timeout: 120000 }`; add `AbortController` to the client fetches.

### M-8 — The local detector flags ordinary human resumes
`server.ts:162-289` · **PROVED**

A hand-written bullet-style resume using standard corporate verbs scores **55% "Mixed
signals"**: `phraseScore 0.80` (hits on `Emphasize`, `Leveraged`, `tailored to`,
`underscores`), `ttrScore 1.00` (bullet lists never repeat words, so they structurally max
out vocabulary richness), `punctScore 1.00`. Five phrase hits saturate the heaviest signal
(weight 0.30) outright. Three of the 33 hallmark patterns are standard resume vocabulary —
the exact register the tool is aimed at.

A 61-character input (just over the 50-char floor) scores **58%**, with `transitionScore`
saturated because one connector in ten words is 10 per 100.

Comment/code mismatches in the same function: `server.ts:256` says "Peak AI range: 18-28
words/sentence" but the code tests `>= 16 && <= 30`; `server.ts:252` says "Very short (<12)
or very long (>35)" but the flat 0.2 applies to everything outside 16–30.

**Fix:** drop generic resume vocabulary from `aiPhrases`; raise the floor to ~400
characters; invert or drop `ttrScore` for bullet-structured text.

### M-9 — Prompt injection via resume and job-description content
`server.ts:421-431`, `server.ts:465-477`, `server.ts:505-517` · **INSPECTION**

Untrusted text is concatenated with no delimiters or escaping, and the user instructions
sit *after* the resume, so injected content is closer to the top and unfenced. Because the
app parses `[[Section]]` markers (`ResumeAudit.tsx:44`), injected marker syntax directly
controls UI tab contents.

Matters most in the interviewer-facing ledger flow (`/api/interview/evaluate`), where the
assessed candidate's content is being judged — an adversarial setting. (Self-injection on
one's own audit is only self-harm.)

**Fix:** wrap untrusted blocks in `<resume>…</resume>` delimiters; strip `[[…]]` from user
text server-side; state in the system prompt that tagged content is data, never
instructions.

### M-10 — Stale-response race in `FileUploader`
`src/components/FileUploader.tsx:53-91` · **INSPECTION**

`handleFile` has no request sequencing and no `AbortController`. Drop a large PDF then
immediately a small TXT: the TXT resolves first, then the PDF overwrites shared context
while `selectedFile` may show either name. The resume the user sees named and the one sent
to the model can disagree, and the wrong one is persisted to `localStorage`.

**Fix:** `useRef` request counter, ignore non-latest responses; abort the previous fetch.

---

## LOW

- **L-1** `tsconfig.json:2-26` — no `strict`, `strictNullChecks`, `noUnusedLocals`, or
  `include`. `npm run lint` passing proves much less than it appears; M-5's unsound
  assertion typechecks silently. **INSPECTION**
- **L-2** `providers.ts:248-251` — ranking ties broken by API list order. `gpt-5-mini` and
  `gpt-5-nano` both score 80; V8's stable sort means the winner is whoever OpenAI lists
  first, so the pick can silently flip to the weaker model. Add a deterministic tiebreak.
  **PROVED**
- **L-3** `providers.ts:157-158` — same tier-vs-version arithmetic error as H-6:
  `gpt-4o-mini` (70) outranks `gpt-5` (65). Top pick is usually still fine, but the
  failover chain is ordered badly. **PROVED**
- **L-4** `server.ts:562-563` — `.json()` is called before checking `.ok`, so a non-JSON
  error page from `FAST_DETECT_GPT_URL` throws a `SyntaxError` and surfaces
  `"Unexpected token '<'…"` to the user. **Not a user-reachable SSRF** — the URL is
  operator-controlled via `.env` and never influenced by request data. Worth noting that
  when set, every resume is forwarded verbatim to that host. **INSPECTION**
- **L-5** `src/components/FileUploader.tsx:14-21` — docstring claims text formats are read
  in the browser. False: every format is base64'd and POSTed. Reading `.txt`/`.md`/`.csv`
  locally would remove a round-trip and stop plaintext resumes leaving the browser.
  **INSPECTION**
- **L-6** `.env` holds `GEMINI_API_KEY=` and `APP_URL=`; neither is read anywhere (only
  `FAST_DETECT_GPT_URL` and `NODE_ENV` are). A live key in an unused file is pure
  liability. `.gitignore` correctly covers `.env*` and it is untracked. Also
  `InterviewScoringTable.tsx:3` imports `MetricRow` unused. **INSPECTION**
- **L-7** `server.ts:335-339`, `server.ts:601` — no `helmet`, no CSP, no
  `app.disable("x-powered-by")`. CORS is *correctly* absent. But with no CSP, any XSS hands
  over the API key in `localStorage` (`App.tsx:98`). Binding `0.0.0.0` exposes the
  unauthenticated key oracle (H-3) to the LAN. **INSPECTION**
- **L-8** `src/lib/renderMarkdown.tsx:13` — single-asterisk rule mangles arithmetic:
  `"Scaled 5 * 3 * 2 servers"` renders as italic. Cosmetic. **PROVED**

---

## Verified clean — do not re-litigate

- **`renderMarkdown.tsx` is XSS-safe.** Proved: `<img src=x onerror=alert(1)>` tokenises to
  a single text node; every branch pushes a string or a React element with the match as
  `children`. No `dangerouslySetInnerHTML` anywhere in the codebase.
- **Absent CORS is correct**, not an omission — no middleware means same-origin only, the
  right call for a key-handling app. Cross-origin key theft is not possible.
- **No path traversal** in the upload path (see M-6).
- **`FAST_DETECT_GPT_URL` is not a user-reachable SSRF** (see L-4).
- **React is clean.** No effect-dependency bugs; the debounced identify effect
  (`App.tsx:53-91`) correctly aborts on change *and* guards `setIsVerifying` against the
  aborted path; all inputs are properly controlled.
- Cache is keyed by SHA-256 of the key, not the key itself. `stripForGoogle` correctly
  handles the real Google/OpenAI/Anthropic schema-dialect divergence.
  `generateJSON`'s fence-stripping is a genuine necessity, handled cleanly.
- The refuse-to-fabricate-a-resume decision (`server.ts:291-296`) is correct and important:
  substituting placeholder text would silently poison every downstream score.

---

## Overall assessment

The provider abstraction is the right architecture and the surrounding hygiene is better
than typical for this size. The weakness is concentrated in one place: **the ranking layer
is the least-tested and most consequential code in the repo, and it is wrong.** Everything
downstream — which model runs, what the failover chain contains, whether structured output
works at all — depends on three small scoring functions that were never run against real
model lists. The module header promises that "a model being retired can't break the app the
way a hardcoded ID can"; in practice the scorer pins Anthropic keys to a May-2025 model and
ranks Google's `-latest` aliases near the bottom.

The second theme: **the server is written as if it were behind something.** No rate
limiting on any route, and two routes are unauthenticated by design. That combination turns
several individually-minor issues (unbounded cache, 20 MB body limit, synchronous detector)
into a coherent denial-of-service and key-oracle story.

---

## Top 3 — suggested first phase

1. **C-1, the `scoreAnthropic` date-as-minor regex.** One character plus a `\d{1,2}` bound.
   Currently selects a worse model for every Anthropic user and breaks Interview Prep
   entirely for them. Highest impact-to-effort in the review by a wide margin.
2. **H-1, `.status` vs `.statusCode` plus the raw rethrow at `providers.ts:271`.** Two
   lines. Stops the OpenAI org-ID leak and fixes wrong-status responses that make every
   provider failure look like a server bug.
3. **Rate limiting on `/api/*` plus cache eviction (H-5).** One change defuses H-2, H-3,
   H-5, and M-6 together.

**Queue immediately after:** H-6 / L-3 (rebalance tier weights below the version step in all
three scorers) and M-3 (anchor the callback-percentage regex on its label).

---

## Suggested phase grouping for the roadmap

| Phase | Contents | Rationale |
|---|---|---|
| 1 — Model selection correctness | C-1, H-6, L-2, L-3 | All one subsystem (`providers.ts` scoring); all proved; C-1 is a live user-facing break |
| 2 — Error handling & disclosure | H-1, M-1, M-2, M-7 | All the `describeProviderError` / failover path; fixes an information leak |
| 3 — Abuse resistance | H-2, H-3, H-5, M-6, L-7 | Rate limiting, cache eviction, body limits, headers — one coherent hardening pass |
| 4 — Output parsing robustness | M-3, M-4, M-5 | The model-output → UI boundary; M-3 is the most visible number in the product |
| 5 — Detector quality | M-8 | Standalone; needs judgement on thresholds, not just a code fix |
| 6 — Hardening & hygiene | H-4, M-9, M-10, L-1, L-4, L-5, L-6, L-8 | Lower urgency; L-1 (`strict`) may surface further work |
