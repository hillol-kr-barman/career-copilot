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
import { detectAiStatistically } from "./detector";
import { screenDeliveryProse, SCREENED_FIELD_PATHS } from "./src/lib/deliveryScreen";

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

/**
 * Floor on text handed to the detector. Every signal it uses is a density or a
 * variance, and none of them mean anything on one sentence: the old 50-character
 * floor let an 11-word input through, where a single connector reads as 10 per
 * 100 words and saturates a signal outright. 400 characters is roughly a short
 * paragraph — still small, but enough for the statistics to be about the writing
 * rather than about the sample size.
 */
const MIN_DETECT_CHARS = 400;

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

/**
 * Structured-output contract for the Structure call (LIVE-15). Deliberately
 * carries NO millisecond or timestamp field — those are resolved client-side
 * by `src/lib/quoteMatcher.ts` (Pattern 2), never model-supplied.
 */
const STRUCTURE_SCHEMA = {
  type: "object",
  properties: {
    exchanges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          exchangeIndex: { type: "integer", description: "0-based index, dense from 0 over this response's own exchanges." },
          questionText: { type: "string", description: "Verbatim span copied from the transcript — never a paraphrase." },
          questionIntent: { type: "string", description: "One short sentence on what the interviewer was probing for." },
          answerText: { type: "string", description: "Verbatim span copied from the transcript — never a paraphrase." },
          subAsks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "The discrete thing a complete answer must cover." },
                source: { type: "string", description: "Either \"asked\" or \"implied_by_jd\"." },
              },
              required: ["text", "source"],
              additionalProperties: false,
            },
          },
        },
        required: ["exchangeIndex", "questionText", "questionIntent", "answerText", "subAsks"],
        additionalProperties: false,
      },
    },
  },
  required: ["exchanges"],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;

/**
 * Structured-output contract for the Assess call (LIVE-16/17/18/19, D-73).
 * `exchangeIndex` is required so the response can be correlated back to
 * Structure's exact exchanges by index rather than by trusting array order
 * (Pitfall 1). The per-exchange `score` object asks the model for only the
 * seven raw ScoreRow input fields — the two per-row averages further down
 * this tool's scoring ledger already derives from those seven on every edit
 * (`InterviewScoringTable.tsx`), and asking the model to author them here
 * would let a Tool-4-sourced row silently disagree with a manually-edited
 * one once Phase 7 wires the ledger. Neither of those two derived fields is
 * requested anywhere in this schema.
 */
const LIVE_FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    exchanges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          exchangeIndex: { type: "integer", description: "Must match one of Structure's own exchangeIndex values exactly." },
          subAsks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "Must match the sub-ask's own text from Structure's output." },
                coverage: {
                  type: "string",
                  description:
                    "One of exactly: ADDRESSED, PARTIAL, NOT_ADDRESSED, DEFLECTED. A verdict of ADDRESSED requires a verbatim quote from the candidate's own words as evidenceQuote.",
                },
                evidenceQuote: {
                  type: "string",
                  description: "Verbatim quote from the candidate's own words. Empty string when coverage is NOT_ADDRESSED or DEFLECTED.",
                },
                assessment: { type: "string", description: "One sentence on how well this sub-ask was covered." },
                whatAGoodAnswerWouldHaveIncluded: {
                  type: "string",
                  description: "One or two sentences on what a strong answer to this specific sub-ask would have covered.",
                },
              },
              required: ["text", "coverage", "evidenceQuote", "assessment", "whatAGoodAnswerWouldHaveIncluded"],
              additionalProperties: false,
            },
          },
          starApplicable: {
            type: "boolean",
            description:
              "False for a purely technical or motivational question where a STAR (Situation/Task/Action/Result) read would be a grade against a rubric that never applied to this question.",
          },
          starNote: {
            type: "string",
            description: "The per-exchange STAR completeness read. Empty string when starApplicable is false.",
          },
          score: {
            type: "object",
            description:
              "The seven raw ScoreRow input fields on the existing 0-1 scale. The two per-row averages further down this tool's ledger are computed from these seven and are never requested here.",
            properties: {
              s: { type: "number", description: "Situation, 0 to 1." },
              tE: { type: "number", description: "Task/Environment, 0 to 1." },
              a: { type: "number", description: "Action, 0 to 1." },
              rT: { type: "number", description: "Result/Technique, 0 to 1." },
              cS: { type: "number", description: "Communication Style, 0 to 1." },
              aE: { type: "number", description: "Adaptability/Expertise, 0 to 1." },
              rA: { type: "number", description: "Analytical Reasoning, 0 to 1." },
            },
            required: ["s", "tE", "a", "rT", "cS", "aE", "rA"],
            additionalProperties: false,
          },
        },
        required: ["exchangeIndex", "subAsks", "starApplicable", "starNote", "score"],
        additionalProperties: false,
      },
    },
    strengths: {
      type: "string",
      description: "A session-level summary of what the candidate did well across the whole interview.",
    },
    priorityImprovements: {
      type: "string",
      description: "A session-level summary of the highest-priority things to improve.",
    },
    resumeConsistency: {
      type: "array",
      description:
        "Claims the candidate made that may not square with their resume, framed as something to reconcile rather than a discrepancy proven — the transcript is machine-generated and may have misheard the very detail in dispute.",
      items: {
        type: "object",
        properties: {
          spokenQuote: { type: "string", description: "Verbatim quote from the candidate's own words." },
          resumeLine: { type: "string", description: "The specific resume line this spoken claim may not square with." },
          note: { type: "string", description: "One sentence framing what should be reconciled." },
        },
        required: ["spokenQuote", "resumeLine", "note"],
        additionalProperties: false,
      },
    },
    jdCoverage: {
      type: "array",
      description: "Specific requirements drawn from the job description, and whether anything the candidate said evidenced them.",
      items: {
        type: "object",
        properties: {
          requirement: { type: "string", description: "A specific requirement drawn from the job description." },
          evidenced: { type: "boolean", description: "Whether anything the candidate said evidenced this requirement." },
        },
        required: ["requirement", "evidenced"],
        additionalProperties: false,
      },
    },
  },
  required: ["exchanges", "strengths", "priorityImprovements", "resumeConsistency", "jdCoverage"],
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
// Phase 6 — the two-call feedback pipeline (LIVE-15/16). Structure extracts
// exchanges and their sub-asks from the raw transcript; Assess judges each
// sub-ask against the four-value verdict set. Neither call is ever asked for
// a millisecond or a segment id — every time reference is resolved
// client-side by src/lib/quoteMatcher.ts (Pattern 2).
// ---------------------------------------------------------------------------

const DEFAULT_TRANSCRIPT_STRUCTURE_PROMPT = `
You are analysing a two-party job interview transcript to structure it for assessment.

Read the transcript and identify each place the interviewer asked something a candidate
can actually be judged on. Greetings, scheduling, logistics, and closing pleasantries
("we'll be in touch", "any questions for us?") are NOT substantive questions — produce no
exchange for them. If the interviewer interrupts an answer with a clarification, that
clarification is part of the SAME exchange it interrupted — do not open a new one for it.

For each substantive exchange:
- Copy "questionText" and "answerText" as VERBATIM spans lifted directly out of the
  transcript — never paraphrase them. They are matched against the transcript afterwards,
  and a span that cannot be matched is treated as unverified, so accuracy here matters more
  than tidiness.
- Write a short "questionIntent" describing what the interviewer was really probing for.
- Decompose the question into its discrete sub-asks — the separate things a complete answer
  would need to cover. A multi-part question ("tell me about a time X: what happened, what
  you changed, what you'd do differently") must decompose into multiple sub-asks, not one.
- Mark each sub-ask's "source" as "asked" when the interviewer said it outright, or
  "implied_by_jd" when the job description implies a candidate should address it even
  though the interviewer's words did not name it directly.

You must NEVER comment on, score, or imply anything about HOW the candidate spoke —
not their accent, fluency, pace, filler words, or confidence. Judge only what substantive
content was asked and said. This instruction applies to every text field you produce.
`;

const DEFAULT_LIVE_FEEDBACK_PROMPT = `
You are judging how thoroughly a candidate answered each already-extracted interview
exchange. For every sub-ask of every exchange, decide its coverage:
- "ADDRESSED": the candidate substantively answered this specific sub-ask.
- "PARTIAL": the candidate touched on it but left it incomplete or vague.
- "NOT_ADDRESSED": the candidate never spoke to this sub-ask at all.
- "DEFLECTED": the candidate avoided this sub-ask rather than simply omitting it — a
  vague, unrelated, or evasive response counts as deflection, not partial coverage. This
  includes a sub-ask the interviewer re-asked as a direct follow-up after an earlier
  non-answer: a second consecutive non-answer to the same underlying sub-ask, even when
  the interviewer phrased the follow-up differently, is deflection, not a fresh partial
  attempt.

For any sub-ask you mark ADDRESSED or PARTIAL, you MUST provide "evidenceQuote" — a
VERBATIM quote lifted directly from the candidate's own words in the exchange's
answerText, proving the coverage you assigned. Never paraphrase the quote. If you cannot
find a genuine verbatim quote supporting your verdict, do not claim ADDRESSED or PARTIAL —
this quote is verified against the transcript afterwards, and a fabricated one is treated
as no evidence at all.

Write a one-sentence "assessment" of how well this sub-ask was covered, and a
"whatAGoodAnswerWouldHaveIncluded" note on what a strong answer to this specific sub-ask
would have covered.

For each exchange, set "starApplicable" to false when the question is purely technical or
motivational and a STAR (Situation/Task/Action/Result) read would be a grade against a
rubric that never applied to this question — otherwise true. When "starApplicable" is
true, write a "starNote" giving the per-exchange STAR completeness read; when false, leave
"starNote" as an empty string.

For each exchange, also provide "score" — the candidate's performance on seven
dimensions, each a 0 to 1 value on the same scale this tool's scoring ledger already
uses: "s" (Situation), "tE" (Task/Environment), "a" (Action), "rT" (Result/Technique),
"cS" (Communication Style), "aE" (Adaptability/Expertise), "rA" (Analytical Reasoning).
Score every exchange even when "starApplicable" is false — "cS", "aE" and "rA" still
apply to a purely technical or motivational question.

At the end of your response, write session-level "strengths" and "priorityImprovements"
summarising the interview as a whole.

List "resumeConsistency" findings only where you can quote BOTH sides: a verbatim
"spokenQuote" from the candidate's own words, and the specific "resumeLine" it may not
square with. Frame each "note" as something to reconcile, not a discrepancy proven — the
transcript is machine-generated and may have misheard the very detail in dispute. If you
cannot quote both sides, do not report the finding at all.

List "jdCoverage" findings for specific requirements drawn from the job description,
stating in "evidenced" whether anything the candidate said evidenced that requirement.

You must NEVER comment on, score, or imply anything about HOW the candidate spoke — not
their accent, fluency, pace, filler words, or confidence. Judge only substantive content.
This instruction applies to every text field you produce.
`;

/**
 * Walks exactly the dotted paths named in `src/lib/deliveryScreen.ts`'s
 * `SCREENED_FIELD_PATHS` — a leaf segment is screened in place with
 * `screenDeliveryProse`; a segment ending in `[]` means "descend into every
 * element of this array." Driving the walk off the paths list itself, rather
 * than a parallel hand-written set of field accesses, means the fields
 * actually screened here can never silently drift from the fields
 * `scripts/check-tag-track.ts`'s schema-correspondence guard checks against.
 * Returns the summed `withheldCount` across every screened field.
 */
function applyDeliveryScreen(root: Record<string, any>, paths: readonly string[]): number {
  let total = 0;
  for (const path of paths) {
    const segments = path.split(".");
    const walk = (nodes: any[], segIndex: number) => {
      if (segIndex >= segments.length) return;
      const segment = segments[segIndex];
      const isArraySegment = segment.endsWith("[]");
      const key = isArraySegment ? segment.slice(0, -2) : segment;
      const isLeaf = segIndex === segments.length - 1;
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const value = node[key];
        if (isArraySegment) {
          if (Array.isArray(value)) walk(value, segIndex + 1);
        } else if (isLeaf) {
          if (typeof value === "string") {
            const result = screenDeliveryProse(value);
            total += result.withheldCount;
            node[key] = result.text;
          }
        } else if (value && typeof value === "object") {
          walk([value], segIndex + 1);
        }
      }
    };
    walk([root], 0);
  }
  return total;
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

  // Managed hosts (Render, Railway, Fly, Heroku) assign the port and expect the
  // process to bind whatever they put in $PORT — a hardcoded port fails their
  // health check with "no open ports detected". 3000 stays the local default.
  const PORT = Number(process.env.PORT) || 3000;

  const isProduction = process.env.NODE_ENV === "production";

  /**
   * Behind a managed host the app sees the proxy's IP on every request, not the
   * caller's. Without this, express-rate-limit buckets every visitor together —
   * the 5/min identify limit would be shared by the whole cohort — and v8
   * refuses to start when it detects an X-Forwarded-For header it was not told
   * to trust.
   *
   * Set to the number of proxy hops in front of the app. Render, Railway and
   * Fly all terminate at one. Never enable this off a trusted proxy: the header
   * is caller-controlled, so a spoofed X-Forwarded-For would defeat rate
   * limiting entirely.
   */
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? (isProduction ? 1 : 0));
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);

  app.disable("x-powered-by");

  /**
   * Health check, deliberately mounted before the /api/ rate limiter.
   *
   * Managed hosts poll this every few seconds. Behind the limiter those polls
   * would eat the caller's budget and, once the service was busy, start
   * returning 429 — which the host reads as unhealthy and responds to by
   * restarting the very service that was merely under load.
   */
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });

  // The API key lives in localStorage, so any XSS hands it over — a CSP that
  // forbids inline script is the control that matters here.
  //
  // It is applied in production only. Vite's dev server injects an inline
  // React-refresh preamble into index.html, and `script-src 'self'` blocks it,
  // which kills the app before it boots and leaves a white screen. The
  // production bundle contains no inline script at all — every entry is an
  // external `src=` — so the strict policy costs nothing where it counts, and
  // the dev-only gap is a local machine serving its own code.
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              // 'wasm-unsafe-eval' permits WebAssembly compilation and
              // instantiation only — it does NOT re-enable eval() or
              // new Function(), so the no-inline-script control that actually
              // protects the localStorage API key is unchanged. Needed by the
              // Phase 5 in-browser Whisper transcriber (onnxruntime-web/WASM).
              scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'self'"],
              // Not present in helmet's defaults, so it would otherwise fall
              // back to defaultSrc. Named explicitly so a later change is a
              // one-line, reviewable diff. The Phase 5 transcription worker
              // and its AudioWorklet module are both same-origin bundle
              // chunks emitted by Vite, so 'self' is sufficient — no CDN,
              // no blob: (see server.ts's Phase 5 CSP comment history).
              workerSrc: ["'self'"],
              // Deliberately dropped from helmet's defaults: this server is
              // commonly run on plain http behind a TLS-terminating proxy, and
              // upgrading same-origin asset requests to https there breaks
              // every asset. HSTS below is the right tool for that job.
              upgradeInsecureRequests: null,
            },
          }
        : false,
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

      // The schema is a request, not a guarantee. An item missing `question` or
      // `answer` renders as a blank card and throws inside the PDF exporter
      // (`doc.splitTextToSize(undefined)`), so drop malformed items here rather
      // than letting the client assume the shape held.
      const raw = data?.pairs;
      const pairs = (Array.isArray(raw) ? raw : []).filter(
        (p: any) =>
          p &&
          typeof p.question === "string" &&
          p.question.trim() &&
          typeof p.answer === "string" &&
          p.answer.trim()
      );

      if (pairs.length === 0) {
        return res.status(502).json({ error: "The model returned no usable questions. Try again." });
      }

      res.json({ pairs, modelUsed: model, provider });
    } catch (error: any) {
      console.error("Error in /api/interview/questions:", error);
      fail(res, error, "An unexpected error occurred during interview question generation.");
    }
  });

  // 2a. Live Interview — Structure Stage (LIVE-15, D-62's first call)
  //
  // Decomposes a raw transcript into substantive exchanges and their
  // sub-asks. No timestamp field is requested — the client resolves every
  // time reference by matching questionText/answerText against stored
  // segments (Pattern 2). Long-interview overflow is deliberately not
  // special-cased here (Pitfall 5): describeProviderError already surfaces
  // the provider's own message for that failure.
  //
  // Delivery-screen decision for this route's only model-authored prose
  // field, stated explicitly rather than left unstated: `questionIntent` is
  // NOT screened. It describes what the interviewer was probing for — a
  // remark about the question, not about the candidate — the same reasoning
  // `src/lib/deliveryScreen.ts`'s SCREENED_FIELD_PATHS comment gives for
  // excluding it from the Assess response's screened paths.
  app.post("/api/interview/transcript/structure", async (req, res) => {
    try {
      const { transcriptText, jobDescription, resumeText, appliedPosition, customPrompt, apiKey } = req.body;

      if (!transcriptText || typeof transcriptText !== "string" || !transcriptText.trim()) {
        return res.status(400).json({ error: "A transcript is required." });
      }

      const activePrompt = (customPrompt && customPrompt.trim()) || DEFAULT_TRANSCRIPT_STRUCTURE_PROMPT;

      const promptPayload = `
Applied Position:
${appliedPosition || "Not specified — infer the target role from the job description."}

Job Description:
${jobDescription || "Not provided."}

Candidate Resume:
${resumeText || "Not provided."}

Interview Transcript (turn-grouped, [mm:ss] Speaker: text):
${transcriptText}

Instructions:
${activePrompt}
`;

      const { data, provider, model } = await generateJSON<{ exchanges?: unknown }>({
        apiKey,
        system: "You are an expert interview transcript analyst.",
        prompt: promptPayload,
        schema: STRUCTURE_SCHEMA,
      });

      // The schema is a request, not a guarantee (server.ts:546-558's
      // precedent, generalised here): drop any exchange missing a
      // non-empty questionText or whose subAsks is not a non-empty array,
      // drop any sub-ask missing non-empty text, coerce source to
      // "implied_by_jd" only when it is exactly that literal string and to
      // "asked" otherwise, then renumber exchangeIndex densely from 0 over
      // the surviving exchanges so the Assess call's correlation domain is
      // exactly 0..n-1.
      const rawExchanges = data?.exchanges;
      const survivors = (Array.isArray(rawExchanges) ? rawExchanges : [])
        .filter(
          (e: any) =>
            e &&
            typeof e.questionText === "string" &&
            e.questionText.trim() &&
            typeof e.answerText === "string" &&
            Array.isArray(e.subAsks) &&
            e.subAsks.length > 0
        )
        .map((e: any) => {
          const subAsks = (e.subAsks as any[])
            .filter((s) => s && typeof s.text === "string" && s.text.trim())
            .map((s) => ({
              text: s.text,
              source: s.source === "implied_by_jd" ? "implied_by_jd" : "asked",
            }));
          return {
            questionText: e.questionText,
            questionIntent: typeof e.questionIntent === "string" ? e.questionIntent : "",
            answerText: e.answerText,
            subAsks,
          };
        })
        .filter((e) => e.subAsks.length > 0);

      const exchanges = survivors.map((e, i) => ({ ...e, exchangeIndex: i }));

      if (exchanges.length === 0) {
        return res.status(502).json({
          error: "The model found no substantive questions in this transcript. Try again.",
        });
      }

      res.json({ exchanges, modelUsed: model, provider });
    } catch (error: any) {
      console.error("Error in /api/interview/transcript/structure:", error);
      fail(res, error, "An unexpected error occurred while structuring the transcript.");
    }
  });

  // 2b. Live Interview — Assess Stage (LIVE-16, D-62's second call)
  //
  // Judges Structure's own exchanges. Receives only the exchanges, not the
  // raw transcript again (RESEARCH.md open question 2 — token-cheaper, and
  // Structure already extracted the answer text). No evidence quote is
  // trusted at face value: the client independently verifies every
  // evidenceQuote against the stored transcript (D-66) and downgrades a
  // verdict it cannot verify.
  app.post("/api/interview/live-feedback", async (req, res) => {
    try {
      const { exchanges, jobDescription, resumeText, appliedPosition, customPrompt, apiKey } = req.body;

      if (!Array.isArray(exchanges) || exchanges.length === 0) {
        return res.status(400).json({ error: "At least one exchange is required." });
      }

      const activePrompt = (customPrompt && customPrompt.trim()) || DEFAULT_LIVE_FEEDBACK_PROMPT;

      const promptPayload = `
Applied Position:
${appliedPosition || "Not specified — infer the target role from the job description."}

Job Description:
${jobDescription || "Not provided."}

Candidate Resume:
${resumeText || "Not provided."}

Extracted Exchanges (JSON):
${JSON.stringify(exchanges, null, 2)}

Instructions:
${activePrompt}
`;

      const { data, provider, model } = await generateJSON<{
        exchanges?: unknown;
        strengths?: unknown;
        priorityImprovements?: unknown;
        resumeConsistency?: unknown;
        jdCoverage?: unknown;
      }>({
        apiKey,
        system: "You are an expert interview assessor judging content only, never delivery.",
        prompt: promptPayload,
        schema: LIVE_FEEDBACK_SCHEMA,
      });

      // The schema is a request, not a guarantee. An exchange missing a real
      // index can't be matched back to a question (Pitfall 1); an unusable
      // score would corrupt the ledger average it's not even wired to yet
      // (Phase 7); and an unevidenced resumeConsistency item is exactly the
      // unsupported accusation about a person D-69 forbids ever reaching the
      // client. Every item below is dropped or coerced to a safe default
      // here rather than trusted at face value.
      const validCoverage = new Set(["ADDRESSED", "PARTIAL", "NOT_ADDRESSED", "DEFLECTED"]);

      const clampUnitOrNull = (raw: unknown): number | null => {
        const n = typeof raw === "number" ? raw : Number(raw);
        return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
      };

      // An exchange's score object is coerced as a whole: if any of the
      // seven fields is missing or unusable, the exchange gets no score at
      // all rather than a mix of real numbers and silently-defaulted zeros.
      const coerceScore = (
        raw: any
      ): { s: number; tE: number; a: number; rT: number; cS: number; aE: number; rA: number } | undefined => {
        if (!raw || typeof raw !== "object") return undefined;
        const s = clampUnitOrNull(raw.s);
        const tE = clampUnitOrNull(raw.tE);
        const a = clampUnitOrNull(raw.a);
        const rT = clampUnitOrNull(raw.rT);
        const cS = clampUnitOrNull(raw.cS);
        const aE = clampUnitOrNull(raw.aE);
        const rA = clampUnitOrNull(raw.rA);
        if (s === null || tE === null || a === null || rT === null || cS === null || aE === null || rA === null) {
          return undefined;
        }
        return { s, tE, a, rT, cS, aE, rA };
      };

      const rawExchanges = data?.exchanges;
      const judged = (Array.isArray(rawExchanges) ? rawExchanges : [])
        .filter((e: any) => e && Number.isInteger(e.exchangeIndex) && Array.isArray(e.subAsks) && e.subAsks.length > 0)
        .map((e: any) => ({
          exchangeIndex: e.exchangeIndex,
          subAsks: (e.subAsks as any[])
            .filter((s) => s && typeof s.text === "string" && s.text.trim())
            .map((s) => ({
              text: s.text,
              coverage: validCoverage.has(s.coverage) ? s.coverage : "PARTIAL",
              evidenceQuote: typeof s.evidenceQuote === "string" ? s.evidenceQuote : "",
              assessment: typeof s.assessment === "string" ? s.assessment : "",
              whatAGoodAnswerWouldHaveIncluded:
                typeof s.whatAGoodAnswerWouldHaveIncluded === "string" ? s.whatAGoodAnswerWouldHaveIncluded : "",
            })),
          starApplicable: e.starApplicable === true,
          starNote: typeof e.starNote === "string" ? e.starNote : "",
          score: coerceScore(e.score),
        }))
        .filter((e) => e.subAsks.length > 0);

      // Pitfall 1: array position alone is not a safe correlation key.
      // Every integer in 0..exchanges.length-1 must appear exactly once.
      const indices = judged.map((e) => e.exchangeIndex).sort((a, b) => a - b);
      const expected = Array.from({ length: exchanges.length }, (_, i) => i);
      const correlationHolds =
        indices.length === expected.length && indices.every((v, i) => v === expected[i]);

      if (!correlationHolds) {
        return res.status(502).json({
          error: "The judgement could not be matched back to the questions. Try judging again.",
        });
      }

      // D-69: reported only when both the spoken side and the resume side
      // are present — never in prose alone.
      const rawResumeConsistency = data?.resumeConsistency;
      const resumeConsistency = (Array.isArray(rawResumeConsistency) ? rawResumeConsistency : [])
        .filter(
          (r: any) =>
            r &&
            typeof r.spokenQuote === "string" &&
            r.spokenQuote.trim() &&
            typeof r.resumeLine === "string" &&
            r.resumeLine.trim()
        )
        .map((r: any) => ({
          spokenQuote: r.spokenQuote,
          resumeLine: r.resumeLine,
          note: typeof r.note === "string" ? r.note : "",
        }));

      const rawJdCoverage = data?.jdCoverage;
      const jdCoverage = (Array.isArray(rawJdCoverage) ? rawJdCoverage : [])
        .filter((j: any) => j && typeof j.requirement === "string" && j.requirement.trim())
        .map((j: any) => ({
          requirement: j.requirement,
          evidenced: j.evidenced === true,
        }));

      const strengths = typeof data?.strengths === "string" ? data.strengths : "";
      const priorityImprovements = typeof data?.priorityImprovements === "string" ? data.priorityImprovements : "";

      // D-67/D-68/T-06-03: the delivery-scoring screen runs here, inside the
      // route handler, over exactly SCREENED_FIELD_PATHS — not in the
      // rendering component. The client is not the boundary: LIVE-21 is a
      // fairness requirement named in REQUIREMENTS.md's Out of Scope table,
      // not a UX preference, so a direct POST to this route from outside the
      // app must get the same treatment as a call from the app. Walking
      // SCREENED_FIELD_PATHS itself (rather than a parallel, hand-written
      // list of field accesses) means the paths actually screened here can
      // never silently drift from the paths scripts/check-tag-track.ts
      // asserts against.
      const screenedPayload = { exchanges: judged, resumeConsistency, strengths, priorityImprovements };
      const withheldRemarkCount = applyDeliveryScreen(screenedPayload, SCREENED_FIELD_PATHS);

      res.json({
        exchanges: screenedPayload.exchanges,
        strengths: screenedPayload.strengths,
        priorityImprovements: screenedPayload.priorityImprovements,
        resumeConsistency: screenedPayload.resumeConsistency,
        jdCoverage,
        withheldRemarkCount,
        modelUsed: model,
        provider,
      });
    } catch (error: any) {
      console.error("Error in /api/interview/live-feedback:", error);
      fail(res, error, "An unexpected error occurred while judging the interview.");
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
      if (rawInput.trim().length < MIN_DETECT_CHARS) {
        return res.status(400).json({
          error: `Text too short — please provide at least ${MIN_DETECT_CHARS} characters (roughly a paragraph). Below that the result says more about the sample size than the writing.`,
        });
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
        // Parse only after checking `ok`: an error page from this host is HTML,
        // and `.json()` on it surfaces "Unexpected token '<'" to the user.
        if (!localRes.ok) {
          throw new Error(`Local fast-detect-gpt returned HTTP ${localRes.status}.`);
        }
        let localData: { probability?: number; criterion?: number; error?: string };
        try {
          localData = await localRes.json() as typeof localData;
        } catch {
          throw new Error("Local fast-detect-gpt returned a malformed response.");
        }
        if (localData.error) throw new Error(localData.error);
        return res.json({
          aiProbability: Math.round((localData.probability ?? 0) * 100),
          criterion: localData.criterion ?? null,
          engine: "fast-detect-gpt (local)",
        });
      }

      // Option 2: Local statistical AI text detection — no external API, works offline.
      // Combines multiple linguistic signals known to differ between human and AI writing.
      const { score, signals, words } = detectAiStatistically(text);

      const breakdown = Object.entries(signals)
        .map(([k, v]) => `${k}:${v.toFixed(2)}`)
        .join(" ");
      console.log(`[ai-detect] ${words}w ${breakdown} → ${score.toFixed(2)}`);

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
    // onnxruntime-web resolves its WASM backend by dynamically import()ing a
    // proxy module under `env.backends.onnx.wasm.wasmPaths` ("/ort/"). Those
    // artifacts live in `public/ort/`, and Vite's dev pipeline refuses to load
    // a /public file that source code imports ("should not be imported from
    // source code ... can only be referenced via HTML tags") — so in dev the
    // import fails and the transcriber never initialises, while a production
    // build works because `public/` is copied as-is and served statically.
    //
    // Serving /ort from express BEFORE Vite's middleware keeps those requests
    // out of the module graph entirely, so dev and production resolve the same
    // "/ort/" path against the same self-hosted files. This is deliberately
    // mounted inside the dev branch only: in production the express.static
    // below already serves them out of dist/.
    //
    // The explicit Content-Type matters: express's mime table does not map
    // `.mjs`, and a module script served as application/octet-stream is
    // rejected by the browser's strict MIME check for imports.
    app.use(
      "/ort",
      express.static(path.join(publicDir, "ort"), {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".mjs")) {
            res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          }
        },
      })
    );

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
    console.log(
      `Server running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || "development"} mode` +
        (trustProxyHops > 0 ? ` (trusting ${trustProxyHops} proxy hop)` : "")
    );
  });
}

startServer();
