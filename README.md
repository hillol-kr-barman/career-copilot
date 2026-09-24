# Career Copilot

Four tools over one resume: whether it reads as AI-written, your odds of a callback for a specific job, the questions you'll be asked — and live, evidence-backed feedback on a real interview.

Built with React 19, Express and TypeScript. Runs on the visitor's own AI key; the deployment holds no key of its own.

---

## Table of contents

- [Why it exists](#why-it-exists)
- [The trust model](#the-trust-model)
- [The four tools](#the-four-tools)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Deployment](#deployment)
- [Verification](#verification)
- [Tech stack](#tech-stack)
- [Attribution](#attribution)

---

## Why it exists

Interview feedback is usually either absent or unfalsifiable. A candidate hears "you weren't quite the right fit" and learns nothing; a practice tool tells them they sounded confident and they learn less. Career Copilot is built on the opposite premise: **every claim it makes should be checkable against something you can read.**

That shows up concretely. A coverage verdict cites a verbatim quote, and the quote is verified against the stored transcript before it renders — one that cannot be located is downgraded rather than shown. A resume-consistency finding that lacks both a spoken quote and the resume line it contradicts is dropped on the server, not merely hidden in the UI.

Originally built for **QIBA**, a collaboration of alumni.

---

## The trust model

These are architectural commitments, enforced in code rather than promised in copy.

**Bring your own key.** The app ships with no API key. Paste one from Google Gemini, OpenAI, or Anthropic and the server identifies the engine from the key, asks that provider which models the key can actually reach, and picks the best fast one. There is no model dropdown and no hardcoded model ID, so a retired or restricted model cannot break the app. Your key stays in your browser, goes only to your provider, and is never stored server-side.

**Audio never leaves the browser.** Live Interview transcribes with Whisper compiled to WebAssembly, running in a worker on your machine. The model is vendored into `public/models/` at build time from a **pinned commit** rather than fetched from a third-party CDN at runtime, so the "no upload" claim is literally true and the supply chain is a fixed SHA rather than a moving branch pointer.

**Delivery is never scored.** The feedback document judges *what was said and how completely it answered the question* — never accent, fluency, pace, filler words, or confidence. Scoring delivery would discriminate against non-native and disabled candidates, so it is stripped **inside the route handler**, between the model response and the HTTP response, where no client can skip it. When a remark is removed, the response says so rather than silently shortening.

**Recording requires consent.** Live Interview is gated behind a two-party consent notice that is re-taken before every take, and the interface states that consent law varies by jurisdiction.

---

## The four tools

### 1. Resume AI detection — fully offline

Scores a resume for likely AI authorship using a **local statistical model**: no API key, no external call, nothing leaves the server. It combines five weighted linguistic signals — AI-hallmark phrasing, transition-word density, punctuation variety, sentence-length burstiness, and average sentence length.

It is deliberately framed as a heuristic, not proof: careful human writing scores high and plain LLM writing scores low, so it is a reason to look closer rather than a verdict.

> Optional: run a local [fast-detect-gpt](https://github.com/baoguangsheng/fast-detect-gpt) server and set `FAST_DETECT_GPT_URL`; the app calls that instead.

### 2. Resume audit

Scores a resume against a pasted job description, leading with the three things that matter:

- **Callback likelihood** — an explicit percentage with the reasoning behind it
- **What's working** — the specific phrasing that lands for this role, quoted back
- **What to fix** — prioritised changes, each anchored to a location and a concrete edit

A fuller report follows: JD review with mandatory requirements highlighted, resume review, scorecard, rewrite, strengthening, change comparison, cover letter, iteration tracking, and readiness analysis.

### 3. Interview preparation

Generates eight tailored questions, each paired with a model answer written in your voice and grounded in what your resume actually says — STAR-structured, 120–200 words, speakable in about ninety seconds. Where the resume genuinely lacks the experience being probed, the answer coaches an honest bridge from adjacent experience rather than inventing anything.

Exports to PDF, DOCX or plain text. An optional interviewer scoring ledger records STAR and competency scores and can compile an executive assessment report.

### 4. Live interview

Records a real, in-room interview and returns a feedback document.

**Capture.** One device on the table records both people through a single microphone. The current speaker is marked live with a spacebar toggle, producing a timestamped tag track. Takes survive a mid-recording reload, and every take is kept and listed rather than overwritten.

**Transcription.** Whisper runs in-browser to produce a speaker-attributed transcript at sentence granularity with absolute timestamps. Speaker boundaries are correctable by clicking a line.

**The feedback document.** Each substantive question is decomposed into its discrete sub-asks — a multi-part question becomes several — and each sub-ask is judged `ADDRESSED`, `PARTIAL`, `NOT_ADDRESSED` or `DEFLECTED`. Greetings and logistics produce no exchange at all.

The document opens with **what went unanswered**, because that is the part no other tool surfaces. Per-exchange detail collapses beneath it, and every verified quote is one click from the transcript line it came from. Exports to PDF, DOCX or plain text, carrying the same section order and the same empty-state honesty it has on screen.

---

## Quick start

**Prerequisites:** Node.js ≥ 22

```bash
git clone https://github.com/hillol-kr-barman/career-copilot.git
cd career-copilot
npm install
npm run dev
```

The app runs at <http://localhost:3000>. Open it and paste a key from
[Google AI Studio](https://aistudio.google.com/app/apikey),
[OpenAI](https://platform.openai.com/api-keys), or
[Anthropic](https://console.anthropic.com/settings/keys).

> **Live Interview needs the Whisper assets.** `npm run dev` does not fetch them. Run `npm run fetch:model` once (~188 MB, idempotent) to populate `public/models/` and `public/ort/`. Without it the first three tools work and transcription fails to load.

> **Microphone access requires a secure context.** `localhost` counts, so development works. Any other origin must be HTTPS or the browser will not grant the microphone — see [Deployment](#deployment).

---

## Configuration

Copy `.env.example` to `.env` if you need it. No AI key is required to run the app — visitors bring their own.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the server binds on |
| `NODE_ENV` | `development` | `production` enables the CSP and serves `dist/` instead of Vite middleware |
| `TRUST_PROXY_HOPS` | `1` in production, `0` otherwise | Proxy hops in front of the app. Without it the rate limiter buckets every visitor together behind a proxy's IP |
| `FAST_DETECT_GPT_URL` | unset | Optional. When set, resumes submitted to `/api/ai-detect` are forwarded **verbatim** to that host — leave unset unless you run it yourself |

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Express + Vite middleware with HMR |
| `npm run build` | Vite client bundle + esbuild server bundle into `dist/`. Runs `fetch:model` first via `prebuild` |
| `npm start` | Run the production build (`node dist/server.cjs`) |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm run check` | Run the assertion suite (see [Verification](#verification)) |
| `npm run fetch:model` | Vendor the pinned Whisper + ONNX runtime into `public/` |
| `npm run clean` | Remove `dist/` |

---

## Architecture

A **single Express server** runs Vite in middleware mode during development and serves the built SPA in production. It is the only network boundary: the browser talks to it, and it talks to whichever AI provider owns the visitor's key.

### API surface

| Route | Purpose |
|---|---|
| `POST /api/ai/identify` | Identify provider and best reachable model from a key |
| `POST /api/resume/extract` | Real text extraction from PDF (`unpdf`) and DOCX (`mammoth`) |
| `POST /api/ai-detect` | Local statistical AI detection — no external call |
| `POST /api/resume/analyze` | Resume audit against a job description |
| `POST /api/interview/questions` | Tailored question and answer set |
| `POST /api/interview/evaluate` | Executive assessment from scoring-ledger input |
| `POST /api/interview/transcript/structure` | Decompose a transcript into exchanges and sub-asks |
| `POST /api/interview/live-feedback` | Judge sub-ask coverage; applies the delivery screen |
| `GET /healthz` | Health check, outside the rate limiter |

### Design decisions worth knowing

**Two LLM calls, not one.** Structuring a transcript and judging it are separate concerns with separate schemas. Splitting them lets a failed judgement retry without re-extracting, and keeps each schema small enough to validate strictly.

**Schemas are a request, not a guarantee.** Every model response passes post-parse validation that drops non-conforming entries, and the judgement call's `exchangeIndex` set must be exactly `0..n-1` or the response is rejected — correlation is never inferred from array order.

**Panels stay mounted.** Switching steps hides a panel rather than unmounting it. Live Interview holds an open `MediaStream`, a wake lock, a Whisper worker and an IndexedDB handle; unmounting it would end a recording mid-interview.

**Client-side storage is versioned and additive.** Recordings, transcripts and feedback documents live in IndexedDB behind explicit schema versions. Every stored record is validated on read and degrades to absent rather than throwing.

---

## Project structure

```
server.ts                      Express: extraction, AI routes, local detector, CSP
providers.ts                   Provider detection, model discovery, unified generate()
detector.ts                    Offline statistical AI-detection model
scripts/
  fetch-model.mjs              Vendors the pinned Whisper + ONNX runtime into public/
  check-tag-track.ts           Assertion suite (npm run check)
src/
  App.tsx                      Step rail, theme, shared context, stored-data controls
  types.ts                     Shared types across client and server
  components/                  20 components — inputs, capture controls, transcript,
                               feedback document, scoring ledger, exports
  sections/                    One per tool: AiDetection, ResumeAudit,
                               InterviewPrep, LiveInterview
  lib/                         24 modules — audio capture and resampling, recorder,
                               IndexedDB stores, transcript algebra, quote matching,
                               delivery screen, rollups, exports, theme
  workers/whisper.worker.ts    In-browser transcription worker
public/
  models/                      Pinned Whisper ONNX snapshot (gitignored, fetched)
  ort/                         onnxruntime-web WASM runtime (gitignored, fetched)
```

---

## Deployment

`render.yaml` is a committed [Render blueprint](https://render.com/docs/blueprint-spec). In the Render dashboard: **New → Blueprint → select this repo**. It configures the build and start commands, `NODE_ENV`, `NODE_VERSION`, `TRUST_PROXY_HOPS` and the health check, so none of it can drift from version control.

Two things to expect:

- **Builds are slow.** `prebuild` pulls ~188 MB of Whisper weights before Vite starts, and `dist/` lands around 519 MB.
- **The free plan sleeps** after 15 minutes of inactivity; the next visitor waits roughly a minute. `starter` removes that with no config change.

### Self-hosting

The server expects to sit **behind a TLS-terminating proxy** — `upgradeInsecureRequests` is deliberately disabled so proxied assets are not rewritten, and `TRUST_PROXY_HOPS` tells the rate limiter how many hops to trust.

**HTTPS is not optional.** `getUserMedia` only works in a secure context, so on plain HTTP the first three tools work and Live Interview cannot record at all. A dynamic-DNS hostname alone (DuckDNS and similar) does **not** satisfy this — pair it with a certificate, e.g. Caddy using a DNS-01 challenge, which also avoids needing port 80 open.

---

## Verification

`npm run check` runs an assertion suite over the pure logic that the product's honesty claims rest on — quote matching and normalisation, the delivery screen's field paths and withheld-remark disclosure, gap and rollup derivation, score-row parity with the scoring ledger, and export section order, empty states and encoding.

Both `npm run lint` and `npm run check` must exit 0 before a change lands.

Behaviour that genuinely needs a browser — microphone capture, model loading, scroll-and-highlight, export rendering — is verified manually rather than asserted, and tracked as explicit debt rather than assumed to pass.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS v4, lucide-react |
| Backend | Express 4, Vite 6 (middleware in dev, static in prod) |
| AI providers | `@google/genai`, `openai`, `@anthropic-ai/sdk` — model resolved at runtime |
| Transcription | `@huggingface/transformers` + onnxruntime-web, Whisper base ONNX (q8, WASM) |
| Documents | `unpdf`, `mammoth` (in) · `jspdf`, `docx` (out) |
| Security | `helmet` CSP, `express-rate-limit` |
| Tooling | esbuild, tsx, TypeScript |

---

## Attribution

Built by **Hillol Kr Barman** for QIBA, a collaboration of alumni.

Guidance only — not a hiring decision, and not career or legal advice.
