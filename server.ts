import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { generate, generateJSON, resolveProvider } from "./providers";

dotenv.config();

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB — matches what the uploader advertises

/**
 * Ceiling on text handed to the local detector. `detectAiStatistically` is
 * fully synchronous — full-text replaces, a Set over every word, and 50-odd
 * regex scans over the whole string — so its cost is charged directly to the
 * event loop. An 18MB body blocked it for 566ms; 50k characters is far more
 * than any real resume and keeps that in the low single-digit milliseconds.
 */
const MAX_DETECT_CHARS = 50_000;

// Base64 inflates by 4/3. Rejecting on the encoded length first means an
// oversized payload never gets decoded into a second full-size Buffer.
const MAX_BASE64_CHARS = Math.ceil(MAX_UPLOAD_BYTES * 1.37);

// This platform is bring-your-own-key and provider-agnostic: the engine and
// model are derived from the visitor's own key at request time (see
// providers.ts). There is no server-side key and no hardcoded model, so a
// model being retired can't break the app and nothing here bills the operator.

// Default prompts definitions
//
// Section order matters: the first three sections are the headline answers the
// product promises (callback likelihood, what works, what to fix). The eight
// that follow are the full-depth report.
const DEFAULT_RESUME_PROMPT = `
You are an expert ATS (Applicant Tracking System) reviewer and recruiters' coach.
Check if the resume satisfies the Job Description. Highlight the match and mismatch, and generate a detailed report.
Please format the output into the following exact sections, each introduced by its marker on its own line, in this exact order:

[[Callback Score]]
State a single callback likelihood as a percentage (0% to 100%) on the first line, in the exact form "Callback Likelihood: NN%".
This is the probability that a recruiter screening for THIS job description would invite THIS candidate to a first conversation.
Then explain the scoring in terms of keyword coverage, seniority fit, and domain relevance. Be honest — do not inflate the number to be encouraging.

[[What's Working]]
List the specific things this resume does well, as concrete bullet points.
Quote the actual phrasing from the resume that is working, and say why it lands for this job description.
Only list genuine strengths. If the resume is weak, say so plainly rather than padding this section.

[[What to Fix]]
List the changes that would most raise the callback score, in priority order.
For EVERY item you must anchor the fix to a location, using the exact form:
"Where: <section name or the quoted line from the resume>"
then on the next line:
"Fix: <the specific change to make>"
Be concrete. "Add more metrics" is useless; "Where: Senior Consultant bullet 2 / Fix: replace 'improved efficiency' with the actual % and timeframe" is useful.

[[JD Review]]
Provide a critical review of the job description.
If there are mandatory minimum qualifications or required licenses, please select the key text of those absolute requirements precisely and wrap them exactly in [[MMR_START]] and [[MMR_END]] lines so they can be styled in red on the UI.
Example:
[[MMR_START]]
Mandatory Minimum Requirements:
- At least 5 years of commercial React experience
- CISSP certification or similar security license
[[MMR_END]]

[[Resume Review]]
Give an honest, holistic read of the candidate's resume covering structure, tone, and positioning.

[[JD Scorecard]]
Review the core pillars of the JD (e.g. Technical Skills, Leadership, Communication) and score them individually.

[[Resume Rewrite]]
Suggest specific text blocks on how to rewrite or rephrase the professional summaries, work experience, to elevate the tone.

[[Strengthening]]
List actionable certifications, key phrases, or project details to add to strengthen the profile.

[[Change Comparison]]
A side-by-side comparison of current phrasing versus recommended phrasing.

[[Cover Letter]]
Draft a highly tailored, compelling, professional cover letter linking the resume highlights directly to the JD's unique needs.

[[Interview Preparation]]
Produce 3-5 hyper-specific behavioral questions based on resume gaps and high-priority requirements.

[[Iteration Tracking]]
Suggest dynamic guidelines for tracking multiple candidate versions.

[[Readiness Analysis]]
Briefly conclude on general readiness and provide immediate guidance.
`;

const DEFAULT_INTERVIEW_PROMPT = `
You are an advanced interview coach preparing THIS candidate for THIS specific role.

First, read the resume and identify the candidate's educational qualifications yourself —
degrees, institutions, certifications, and graduation dates. Do not ask for them; they are
in the resume. If the resume genuinely contains no education section, note that as a gap
rather than inventing one.

Then generate 8 tailored, challenging interview questions, each paired with a strong model
answer written in the candidate's own voice ("I ...").

Ensure the set covers:
1. The candidate's core skill mismatches or experience gaps versus the job description
2. Demanding technical scenarios named in the job description
3. STAR-format behavioural questions that surface concrete accomplishments
4. At least one question that draws on the educational background you identified in the resume

Every model answer must:
- Be grounded in the candidate's ACTUAL resume content — never invent employers, dates, or achievements that are not present
- Follow STAR structure (Situation, Task, Action, Result) for behavioural questions
- Be 120-200 words, speakable aloud in about 90 seconds
- Where the resume genuinely lacks the experience being asked about, coach the candidate to bridge honestly from adjacent experience rather than fabricating
`;

/**
 * Structured-output contract for the interview Q&A set.
 *
 * `additionalProperties: false` and exhaustive `required` lists are mandatory
 * for OpenAI strict mode and Anthropic; providers.ts strips them for Google,
 * whose schema dialect rejects unknown keys.
 */
const QA_SCHEMA = {
  type: "object",
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string", description: "The interview question." },
          answer: {
            type: "string",
            description: "A model answer in the candidate's voice, grounded in their resume.",
          },
          category: {
            type: "string",
            description: "One of: Behavioural, Technical, Gap Probe, Education, Motivation",
          },
          rationale: {
            type: "string",
            description: "One sentence on why an interviewer for this role would ask this.",
          },
        },
        required: ["question", "answer", "category", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["pairs"],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;

const DEFAULT_EVALUATION_PROMPT = `
You are an expert Talent Acquisition Assessor. Match the given question-by-question scoring and summary metrics against the job description and interview transcripts.
Write a structured Candidate Evaluation Report containing:
1. Executive Summary with overall suitability rating (e.g., Strongly Recommend, Hire, No Hire).
2. Key Strengths observed based on STAR ratings (STAR average) and Competency averages.
3. Priority Gaps and Areas of Concern.
4. Actionable onboarding advice or next-stage discussion items.
Ensure a clear, objective, professional tone.
`;

// ---------------------------------------------------------------------------
// Local statistical AI text detector
// Combines 6 linguistic signals. Each returns a score in [0, 1] where 1 = more AI-like.
// Weights are tuned empirically for resume/professional text.
// ---------------------------------------------------------------------------
function detectAiStatistically(text: string): number {

  // ── helpers ──────────────────────────────────────────────────────────────
  const sentences = text
    .replace(/([.?!])\s+/g, "$1\n")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 5);

  const words = text.toLowerCase().match(/\b[a-z']+\b/g) ?? [];
  const totalWords = words.length || 1;

  // ── Signal 1: Burstiness (sentence-length coefficient of variation) ──────
  // Human writing is more "bursty" (varied). AI tends to be uniform.
  // Low CoV → more AI-like.
  let burstScore = 0.5;
  if (sentences.length >= 3) {
    const lens = sentences.map(s => s.split(/\s+/).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
    const cv = Math.sqrt(variance) / (mean || 1);
    // cv > 0.6 → human-like; cv < 0.25 → AI-like
    burstScore = Math.max(0, Math.min(1, 1 - (cv / 0.6)));
  }

  // ── Signal 2: Vocabulary richness (type-token ratio) ────────────────────
  // AI can be unusually rich (diverse vocab) or repetitive. We compare to
  // a typical human TTR of ~0.55 for 200-word samples. Very high TTR is AI-like.
  const uniqueWords = new Set(words).size;
  const ttr = uniqueWords / totalWords;
  // ttr > 0.72 is suspiciously high; scale linearly
  const ttrScore = Math.max(0, Math.min(1, (ttr - 0.45) / 0.35));

  // ── Signal 3: AI hallmark phrases ───────────────────────────────────────
  // Phrases disproportionately common in LLM output.
  const aiPhrases = [
    /\bI am an AI\b/i,
    /\bas an AI( language model)?\b/i,
    /\bit(?:'s| is) worth noting\b/i,
    /\bit(?:'s| is) important to (note|mention|highlight|emphasize)\b/i,
    /\bin (today's|the modern) (world|landscape|era)\b/i,
    /\bfeel free to\b/i,
    /\bcertainly[,!]/i,
    /\bof course[,!]/i,
    /\bAbsolutely[,!]/i,
    /\bI(?:'d| would) be happy to\b/i,
    /\bIn conclusion[,]/i,
    /\bIn summary[,]/i,
    /\bTo summarize[,]/i,
    /\bFirstly[,]/i,
    /\bSecondly[,]/i,
    /\bLastly[,]/i,
    /\bFurthermore[,]/i,
    /\bMoreover[,]/i,
    /\bAdditionally[,]/i,
    /\bNevertheless[,]/i,
    /\bNotwithstanding\b/i,
    /\bdelve into\b/i,
    /\bfoster (a|an|the)?\s*(culture|environment|sense)\b/i,
    /\bleverage (your|our|my|the|their)?\s*\w+/i,
    /\btailored (to|for)\b/i,
    /\bseamlessly\b/i,
    /\brobust (solution|framework|approach|system)\b/i,
    /\bcomprehensive (overview|guide|approach|solution)\b/i,
    /\bstate-of-the-art\b/i,
    /\bcutting-edge\b/i,
    /\bparadigm\b/i,
    /\bemphasize\b/i,
    /\bunderscores?\b/i,
  ];
  const phraseHits = aiPhrases.filter(p => p.test(text)).length;
  const phraseScore = Math.min(1, phraseHits / 5);

  // ── Signal 4: Transition word density ───────────────────────────────────
  // AI tends to over-use formal connectors.
  const transitions = [
    "however", "therefore", "furthermore", "moreover", "additionally",
    "consequently", "subsequently", "nevertheless", "nonetheless",
    "in addition", "as a result", "on the other hand", "in contrast",
    "for instance", "for example", "in particular", "specifically",
    "notably", "importantly", "significantly",
  ];
  let transitionCount = 0;
  const lowerText = text.toLowerCase();
  for (const t of transitions) transitionCount += (lowerText.match(new RegExp(`\\b${t}\\b`, "g")) ?? []).length;
  const transitionDensity = transitionCount / (totalWords / 100); // per 100 words
  const transitionScore = Math.min(1, transitionDensity / 4);     // 4+ per 100 = fully AI-like

  // ── Signal 5: Average sentence length ───────────────────────────────────
  // AI often writes slightly longer, well-formed sentences (18-26 words).
  // Very short (<12) or very long (>35) are more human-like extremes.
  let sentLenScore = 0.3;
  if (sentences.length > 0) {
    const avgLen = words.length / sentences.length;
    // Peak AI range: 18-28 words/sentence
    sentLenScore = avgLen >= 16 && avgLen <= 30
      ? Math.min(1, (avgLen - 10) / 20)
      : 0.2;
  }

  // ── Signal 6: Punctuation uniformity ────────────────────────────────────
  // AI text rarely uses em-dashes, ellipses, or parenthetical asides.
  const humanPunct = (text.match(/[—–…()/]/g) ?? []).length;
  const humanPunctDensity = humanPunct / (totalWords / 100);
  const punctScore = Math.max(0, 1 - humanPunctDensity / 3); // 3+ per 100 → human-like

  // ── Weighted combination ─────────────────────────────────────────────────
  const weights = {
    burst: 0.20,
    ttr: 0.10,
    phrase: 0.30,
    transition: 0.20,
    sentLen: 0.10,
    punct: 0.10,
  };

  const composite =
    burstScore      * weights.burst +
    ttrScore        * weights.ttr +
    phraseScore     * weights.phrase +
    transitionScore * weights.transition +
    sentLenScore    * weights.sentLen +
    punctScore      * weights.punct;

  console.log(`[ai-detect] scores — burst:${burstScore.toFixed(2)} ttr:${ttrScore.toFixed(2)} phrase:${phraseScore.toFixed(2)} transition:${transitionScore.toFixed(2)} sentLen:${sentLenScore.toFixed(2)} punct:${punctScore.toFixed(2)} → composite:${composite.toFixed(2)}`);

  return Math.max(0, Math.min(1, composite));
}

// ---------------------------------------------------------------------------
// Resume text extraction
// Real extraction only. If a format cannot be read, this reports failure rather
// than substituting placeholder text — a fabricated resume would silently
// invalidate every score the rest of the app produces.
// ---------------------------------------------------------------------------
async function extractResumeText(fileName: string, buffer: Buffer): Promise<string> {
  // `.pop()` on a name with no dot returns the whole name, and a trailing space
  // ("resume.PDF ") produces the suffix "pdf " — both reported an unsupported
  // file type for a file that was fine.
  const dot = fileName.lastIndexOf(".");
  const suffix = dot === -1 ? "" : fileName.slice(dot + 1).trim().toLowerCase();

  if (!suffix) {
    const err: any = new Error(
      "That file has no extension, so its format can't be determined. Rename it with a .pdf, .docx, .txt, .md or .csv extension."
    );
    err.statusCode = 415;
    throw err;
  }

  switch (suffix) {
    case "txt":
    case "csv":
    case "md":
      return buffer.toString("utf8");

    case "pdf": {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join("\n") : text;
    }

    case "docx": {
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }

    case "doc": {
      const err: any = new Error(
        "Legacy .doc files can't be read. Please re-save as .docx or .pdf and upload again."
      );
      err.statusCode = 415;
      throw err;
    }

    default: {
      const err: any = new Error(
        `Unsupported file type ".${suffix}". Upload a PDF, DOCX, TXT, MD or CSV file.`
      );
      err.statusCode = 415;
      throw err;
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // No CSP source in this app is remote, and the API key lives in localStorage
  // — any XSS hands it over, so the CSP is worth having. `contentSecurityPolicy`
  // is configured rather than defaulted because Vite's dev client needs inline
  // styles and a websocket back to the dev server.
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", ...(process.env.NODE_ENV !== "production" ? ["ws:"] : [])],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
        },
      },
      // The app serves its own assets only; COEP breaks the Vite dev client.
      crossOriginEmbedderPolicy: false,
    })
  );

  // 8MB accommodates a 5MB upload after base64 inflation and nothing more.
  app.use(express.json({ limit: "8mb" }));

  // Body-parser rejections (oversized or malformed JSON) never reach a route
  // handler, so without this they fall to Express's default handler and return
  // an HTML error page. Every client here calls `res.json()` on the response,
  // which would surface "Unexpected token '<'" instead of the real reason.
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!err) return next();
    if (err.type === "entity.too.large") {
      return res.status(413).json({
        error: `That upload is too large — the limit is ${MAX_UPLOAD_BYTES / 1048576}MB.`,
      });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Malformed request body." });
    }
    return next(err);
  });

  /**
   * Rate limiting.
   *
   * Two routes here are unauthenticated by design: `/api/ai-detect` never calls
   * a model, and `/api/ai/identify` answers a precise question about an
   * arbitrary secret. Without a limit, `identify` is a key-validation oracle
   * anyone can triage scraped keys through, and the unbounded resolution cache
   * behind it is anonymously fillable.
   */
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Wait a minute and try again." },
  });

  const identifyLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many key checks. Wait a minute and try again." },
  });

  app.use("/api/", apiLimiter);

  // Simple directory structure checks
  const publicDir = path.join(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // Shared error responder so every route reports auth/format failures with the
  // right status instead of collapsing everything into a 500.
  // `statusCode` is what our own errors carry; the OpenAI and Anthropic SDKs
  // put it on `.status`. Reading only the former reported every rate limit and
  // rejected key as a 500 — a server bug rather than something the user can act on.
  const fail = (res: express.Response, error: any, fallbackMsg: string) => {
    const status = error?.statusCode ?? error?.status ?? 500;
    res.status(typeof status === "number" && status >= 400 && status < 600 ? status : 500)
      .json({ error: error?.message || fallbackMsg });
  };

  // API Config / Status. Deliberately says nothing about keys or models: this
  // deployment holds no key, and the model is resolved per-key at request time.
  app.get("/api/config", (_req, res) => {
    res.json({ bringYourOwnKey: true });
  });

  // Identify which engine and model a key resolves to, so the UI can confirm
  // the key works and show what it connected to — without a model picker.
  app.post("/api/ai/identify", identifyLimiter, async (req, res) => {
    try {
      const { apiKey } = req.body;
      const info = await resolveProvider(apiKey);
      // Only what the UI renders. The full ProviderInfo includes the ranked
      // alternates, which tells an untrusted caller exactly which models an
      // arbitrary key can reach.
      res.json({
        provider: info.provider,
        providerLabel: info.providerLabel,
        model: info.model,
      });
    } catch (error: any) {
      // Expected for a mistyped key — log at info level, not as an error.
      console.log("Key identification failed:", error?.message);
      fail(res, error, "Could not verify that API key.");
    }
  });

  // 0. Resume Extraction Endpoint
  app.post("/api/resume/extract", async (req, res) => {
    try {
      const { fileName, dataBase64 } = req.body;

      if (!fileName || !dataBase64) {
        return res.status(400).json({ error: "fileName and dataBase64 are required." });
      }

      if (typeof dataBase64 !== "string") {
        return res.status(400).json({ error: "dataBase64 must be a string." });
      }

      // Check the encoded length first: decoding an oversized payload allocates
      // a second full-size Buffer before the limit below could reject it.
      if (dataBase64.length > MAX_BASE64_CHARS) {
        return res.status(413).json({
          error: `That file is larger than the ${MAX_UPLOAD_BYTES / 1048576}MB limit.`,
        });
      }

      // Buffer.from silently discards non-base64 characters, so garbage decodes
      // to a short Buffer and reaches the PDF/DOCX parsers as nonsense.
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64.replace(/\s/g, ""))) {
        return res.status(400).json({ error: "That upload was not valid base64. Try again." });
      }

      const buffer = Buffer.from(dataBase64, "base64");
      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        return res.status(413).json({
          error: `File is ${(buffer.byteLength / 1048576).toFixed(1)}MB — the limit is 5MB.`,
        });
      }

      const rawText = await extractResumeText(fileName, buffer);
      const text = rawText.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

      // A PDF of scanned images extracts to nothing. Say so, rather than
      // handing an empty resume to the model.
      if (text.length < 50) {
        return res.status(422).json({
          error:
            "Almost no text could be read from that file. If it's a scanned image or screenshot, paste your resume text directly instead.",
        });
      }

      res.json({ text, fileName, chars: text.length });
    } catch (error: any) {
      console.error("Error in /api/resume/extract:", error);
      fail(res, error, "Could not read that file. Try a different format or paste the text directly.");
    }
  });

  // 1. Analyze Resume Endpoint
  app.post("/api/resume/analyze", async (req, res) => {
    try {
      const { jobDescription, resumeText, customPrompt, promptNotes, apiKey } = req.body;

      if (!jobDescription || !resumeText) {
        return res.status(400).json({ error: "Job description and resume text are required." });
      }

      const activePrompt = (customPrompt && customPrompt.trim()) || DEFAULT_RESUME_PROMPT;
      const combinedNotesMsg = promptNotes ? `\n\nUser Context/Notes:\n${promptNotes}` : "";

      const promptPayload = `
Job Description:
${jobDescription}

Candidate Resume:
${resumeText}
${combinedNotesMsg}

Instructions & Requested format is as follows:
${activePrompt}
`;

      const { text, provider, model } = await generate({
        apiKey,
        system:
          "You are an elite talent coach, helping candidates match resumes with Job Descriptions, specializing in ATS optimizations.",
        prompt: promptPayload,
      });

      res.json({
        report: text || "No report content generated by the model.",
        modelUsed: model,
        provider,
      });
    } catch (error: any) {
      console.error("Error in /api/resume/analyze:", error);
      fail(res, error, "An unexpected error occurred during AI analysis.");
    }
  });

  // 2. Generate Interview Questions + Model Answers Endpoint
  //
  // Returns structured JSON so the client can render Q&A pairs and export them
  // to PDF/DOCX without re-parsing prose.
  app.post("/api/interview/questions", async (req, res) => {
    try {
      const { jobDescription, resumeText, appliedPosition, customPrompt, apiKey } = req.body;

      if (!jobDescription || !resumeText) {
        return res.status(400).json({ error: "Job description and resume text are required." });
      }

      const activePrompt = (customPrompt && customPrompt.trim()) || DEFAULT_INTERVIEW_PROMPT;

      const promptPayload = `
Applied Position:
${appliedPosition || "Not specified — infer the target role from the job description."}

Job Description:
${jobDescription}

Candidate Resume:
${resumeText}

Instructions of evaluation guidelines to follow:
${activePrompt}
`;

      const { data, provider, model } = await generateJSON<{ pairs?: unknown }>({
        apiKey,
        system: "You are an expert interview simulator and executive technical coach.",
        prompt: promptPayload,
        schema: QA_SCHEMA,
      });

      const pairs = data?.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0) {
        return res.status(502).json({ error: "The model returned no questions. Try again." });
      }

      res.json({ pairs, modelUsed: model, provider });
    } catch (error: any) {
      console.error("Error in /api/interview/questions:", error);
      fail(res, error, "An unexpected error occurred during interview question generation.");
    }
  });

  // 3. Interview Evaluation Endpoint (interviewer-side scoring ledger)
  app.post("/api/interview/evaluate", async (req, res) => {
    try {
      const { scoringTable, metricTable, questionSimulationReport, customPrompt, apiKey } = req.body;

      const activePrompt = (customPrompt && customPrompt.trim()) || DEFAULT_EVALUATION_PROMPT;

      const promptPayload = `
Interview Scorecard Metrics:
${JSON.stringify(metricTable || [], null, 2)}

Question and Category Scores:
${JSON.stringify(scoringTable || [], null, 2)}

Original Questions Context:
${questionSimulationReport || "Not provided."}

Instructions of report format is as follows:
${activePrompt}
`;

      const { text, provider, model } = await generate({
        apiKey,
        system:
          "You are an expert HR decision support engine and leadership psychometric analyzer.",
        prompt: promptPayload,
      });

      res.json({
        report: text || "No evaluation report generated by the model.",
        modelUsed: model,
        provider,
      });
    } catch (error: any) {
      console.error("Error in /api/interview/evaluate:", error);
      fail(res, error, "An unexpected error occurred during interview evaluation.");
    }
  });

  // 4. AI Content Detection Endpoint
  // Runs entirely locally — no API key, no external call. Fast-DetectGPT
  // (https://github.com/baoguangsheng/fast-detect-gpt) has no public API and
  // requires local PyTorch + 2-8B parameter models to run. If you have a local
  // fast-detect-gpt server running (python scripts/local_infer.py --api), set
  // FAST_DETECT_GPT_URL=http://localhost:8765/detect in .env and it will be used instead.
  app.post("/api/ai-detect", async (req, res) => {
    try {
      const { text: rawInput } = req.body;
      if (typeof rawInput !== "string" || !rawInput.trim()) {
        return res.status(400).json({ error: "Text is required." });
      }
      if (rawInput.trim().length < 50) {
        return res.status(400).json({ error: "Text too short — please provide at least 50 characters for reliable detection." });
      }

      // Bounded before any scanning happens. This route takes no API key, so
      // nothing else limits how much work a caller can ask for per request.
      const text = rawInput.slice(0, MAX_DETECT_CHARS);

      // Option 1: local fast-detect-gpt server (user-configured)
      const localFastDetectUrl = process.env.FAST_DETECT_GPT_URL;
      if (localFastDetectUrl) {
        const localRes = await fetch(localFastDetectUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(30000),
        });
        const localData = await localRes.json() as { probability?: number; criterion?: number; error?: string };
        if (!localRes.ok) throw new Error(localData.error || "Local fast-detect-gpt error.");
        return res.json({
          aiProbability: Math.round((localData.probability ?? 0) * 100),
          criterion: localData.criterion ?? null,
          engine: "fast-detect-gpt (local)",
        });
      }

      // Option 2: Local statistical AI text detection — no external API, works offline.
      // Combines multiple linguistic signals known to differ between human and AI writing.
      const score = detectAiStatistically(text);

      return res.json({
        aiProbability: Math.round(score * 100),
        engine: "Local Statistical Detector",
      });

    } catch (error: any) {
      console.error("Error in /api/ai-detect:", error);
      fail(res, error, "AI detection service unavailable. Try again later.");
    }
  });

  // Vite development integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer();
