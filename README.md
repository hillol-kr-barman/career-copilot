# Career Copilot

An AI-powered career assistant that screens your resume for AI-generated content, scores your odds of a callback against a specific job description, and prepares a tailored interview question-and-answer set you can download — built with React 19 and Express.

**Bring your own key, any provider.** This app ships with no API key of its own. Paste a key from **Google Gemini, OpenAI, or Anthropic** and the platform works out the rest: it identifies the engine from the key, asks that provider which models the key can actually reach, and picks the best fast one. There is no model dropdown and no hardcoded model ID, so a model being retired or restricted can't break the app. The prompts stay on the server — users get a tool that already knows how to do the job, without having to instruct a model themselves.

## Demo

> Note: these screenshots predate the single-page redesign and show the older tabbed layout.

<img width="1447" height="661" alt="image" src="https://github.com/user-attachments/assets/4963fd96-a6fb-4b79-a92b-149499bc43bb" />

<img width="1412" height="709" alt="image" src="https://github.com/user-attachments/assets/d41a3a70-dd49-413d-96e1-dc6abbf96507" />

<img width="1394" height="660" alt="image" src="https://github.com/user-attachments/assets/0c615e90-6c19-4ec5-a694-729fc9768599" />

## How it's laid out

Everything lives on one page, in order:

1. **Connect your AI** — paste a key from any supported provider; the engine and model are detected for you
2. **Your details** — resume (uploaded or pasted), job description, and the position applied for. **Entered once and shared by all three tools.** Your education is read out of the resume rather than asked for again.
3. **Tool 1 — Resume AI Detection**
4. **Tool 2 — Resume Audit**
5. **Tool 3 — Interview Preparation**

Each tool stays locked, with a plain-language reason, until the inputs it needs are present.

## Features

### 🔍 Tool 1 — Resume AI Detection
Scores your resume for likely AI authorship. Runs **entirely offline** using a local statistical model — no API key, no external call — combining six linguistic signals: sentence-length burstiness, vocabulary richness (type-token ratio), AI-hallmark phrasing (e.g. "it's worth noting", "delve into"), transition-word density, average sentence length, and punctuation variety.

If you run a local [fast-detect-gpt](https://github.com/baoguangsheng/fast-detect-gpt) server, set `FAST_DETECT_GPT_URL` in `.env` and the app will call that instead.

### 📄 Tool 2 — Resume Audit
Scores your resume against the pasted job description. The report leads with the three things that matter:

- **Callback Score** — an explicit "Callback Likelihood: NN%" with the reasoning behind it, surfaced as a headline readout
- **What's Working** — the specific phrasing in your resume that lands for this role, quoted back to you
- **What to Fix** — prioritised changes, each anchored to a location (`Where:` the exact section or line, `Fix:` the specific change)

The full report follows in ten further tabs: JD Review (with mandatory minimum requirements auto-highlighted in red), Resume Review, JD Scorecard, Resume Rewrite, Strengthening, Change Comparison, Cover Letter, Interview Preparation, Iteration Tracking, and Readiness Analysis.

### 🎤 Tool 3 — Interview Preparation
Generates 8 tailored interview questions, each paired with a **model answer written in your voice** and grounded in what your resume actually says. Questions are built from the job description, your resume, the position you applied for, and the educational background the model reads out of your resume.

- Answers follow STAR structure, run 120–200 words, and are speakable in about 90 seconds
- Where your resume genuinely lacks the experience being probed, the answer coaches you to bridge honestly from adjacent experience rather than inventing anything
- Download the full set as **PDF**, **DOCX**, or plain text

Below it, an optional **interviewer scoring ledger** (collapsed by default) lets you score practice answers on STAR criteria (Situation, Task/Environment, Action, Result/Technique) and core competencies (Communication Style, Adaptability/Expertise, Analytical Reasoning). It auto-averages each row, reports STAR/competency/overall aggregates separately, and can compile an **Executive Assessment Report** from the scores via your AI.

## How it works

- `server.ts` is a single Express server that:
  - runs Vite in middleware mode during development, and serves the built SPA in production
  - exposes `/api/resume/extract`, which pulls **real text** out of uploaded PDF (via `unpdf`) and DOCX (via `mammoth`) files
  - exposes `/api/resume/analyze`, `/api/interview/questions`, and `/api/interview/evaluate`, each of which builds a prompt from your inputs and dispatches it through `providers.ts` to whichever AI provider owns your key
  - exposes `/api/ai-detect`, which runs entirely locally
  - exposes `/api/ai/identify`, which reports the engine and model a key resolves to
- **`providers.ts` is the multi-provider layer.** It detects the engine from the key's prefix (`AIza…` Google, `sk-ant-…` Anthropic, `sk-…` OpenAI), and falls back to probing each provider in turn when the prefix isn't recognised — key formats change, and an unrecognised key isn't necessarily an invalid one. It then calls that provider's list-models endpoint and ranks what comes back, preferring current, general-purpose, fast models. Resolution is cached per key for 10 minutes.
- **Every AI call requires a user-supplied key.** There is no server-side key fallback — requests without one are rejected with a `401` rather than silently billing the operator.
- The key is stored in `localStorage`, and sent to the server only to make each AI call on the user's behalf. It is never logged or persisted server-side. No model is stored — it is resolved from the key each time.
- `/api/interview/questions` uses each provider's structured-output mode (Gemini `responseSchema`, OpenAI `json_schema` strict mode, Anthropic `output_config.format`), so questions and answers arrive as typed JSON rather than prose that has to be re-parsed.
- **File uploads:** PDF, DOCX, TXT, MD and CSV are parsed for real, up to 5MB. Legacy `.doc` and unreadable files (e.g. scanned images with no text layer) are rejected with a clear message — the app never substitutes placeholder text, because a fabricated resume would silently invalidate every score downstream.
- **Export libraries are lazy-loaded.** `jspdf` and `docx` together weigh ~740 kB and are fetched only when an export button is clicked, keeping the initial bundle at ~76 kB gzipped.

## Getting Started

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```
2. (Optional) Copy `.env.example` to `.env`. The only variable the server reads is `FAST_DETECT_GPT_URL`; no AI key is needed to run the app.
   ```bash
   cp .env.example .env
   ```
3. Run the app in development mode:
   ```bash
   npm run dev
   ```
   The app runs at `http://localhost:3000`.
4. Open the app and paste an API key from [Google AI Studio](https://aistudio.google.com/app/apikey), [OpenAI](https://platform.openai.com/api-keys), or [Anthropic](https://console.anthropic.com/settings/keys).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (Express + Vite middleware, HMR enabled) |
| `npm run build` | Build the client bundle with Vite and bundle the server with esbuild into `dist/server.cjs` |
| `npm start` | Run the production build (`node dist/server.cjs`) |
| `npm run clean` | Remove the `dist/` directory |
| `npm run lint` | Type-check the project with `tsc --noEmit` |

## Project Structure

```
server.ts                          Express: extraction + AI routes + local AI detector
providers.ts                       Provider detection, model discovery, unified generate()
src/
  App.tsx                          Page shell: header, hero, and the three tool sections
  types.ts                         Shared TypeScript types (SharedContext, QAPair, ScoreRow, ...)
  components/
    ApiKeySetup.tsx                Bring-your-own-key setup and detected-engine readout
    SharedInputs.tsx               The single place resume / JD / position are entered
    FileUploader.tsx               Drag-and-drop upload with real server-side text extraction
    ToolSection.tsx                Shared chrome and locked-state handling for each tool
    InterviewScoringTable.tsx      Editable STAR/competency scoring ledger with sliders
  sections/
    AiDetection.tsx                Tool 1
    ResumeAudit.tsx                Tool 2
    InterviewPrep.tsx              Tool 3
  lib/
    download.ts                    Blob download helper (revokes its object URLs)
    exportQA.ts                    Lazy-loaded PDF and DOCX generation
```

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, lucide-react icons
- **Backend:** Express, Vite (middleware mode in dev, static serving in prod)
- **AI:** Google Gemini (`@google/genai`), OpenAI (`openai`), Anthropic (`@anthropic-ai/sdk`) — model chosen at runtime from what the key can reach
- **Document handling:** `unpdf` (PDF in), `mammoth` (DOCX in), `jspdf` (PDF out), `docx` (DOCX out)
- **Tooling:** esbuild (server bundling), tsx (dev server runner), TypeScript
