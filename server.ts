import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import fs from "fs";

// Initialize Gemini client dynamically or of custom credentials
function getGeminiClient(clientApiKey?: string): GoogleGenAI {
  const apiKey = (clientApiKey && clientApiKey.trim()) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("Warning: GEMINI_API_KEY is not defined. AI features may fail unless provided by the user.");
  }
  return new GoogleGenAI({
    apiKey: apiKey || "dummy-key-to-prevent-immediate-crash",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      }
    }
  });
}

// Default prompts definitions
const DEFAULT_RESUME_PROMPT = `
You are an expert ATS (Applicant Tracking System) reviewer and recruiters' coach.
Check if the resume satisfies the Job Description. Highlight the match and mismatch, assign an ATS score from 0-100%, and generate a detailed report.
Please format the output of the analysis into the following exact sections with dividers:

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
Give an honest review of the candidate's resume, highlighting key skills, gaps, and weaknesses.

[[ATS Score]]
Assign an expert estimated ATS Score (0% to 100%) and explain the scoring criteria based on keywords, seniority, and domain relevance.

[[JD Scorecard]]
Review the core pillars of the JD (e.g. Technical Skills, Leadership, Communication) and score them.

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
You are an advanced interview coach. Based on the provided Job Description and Candidate Resume, generate 5-8 tailored and highly challenging interview questions.
Ensure they target:
1. Candidate's core skills mismatch or experience gaps
2. Demanding technical scenarios mentioned in the Job Description
3. STAR format behavioral questions to extract concrete accomplishments.
Provide specific guidance or criteria of a great response for each question.
`;

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "20mb" }));

  // Simple directory structure checks
  const publicDir = path.join(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // API Config / Status
  app.get("/api/config", (req, res) => {
    res.json({
      hasApiKey: !!process.env.GEMINI_API_KEY,
      defaultModel: "gemini-3.5-flash",
    });
  });

  // 1. Analyze Resume Endpoint
  app.post("/api/resume/analyze", async (req, res) => {
    try {
      const { jobDescription, resumeText, customPrompt, promptNotes, apiKey, model } = req.body;
      
      if (!jobDescription || !resumeText) {
        return res.status(400).json({ error: "Job description and resume text are required." });
      }

      const activePrompt = (customPrompt && customPrompt.trim()) || DEFAULT_RESUME_PROMPT;
      const combinedNotesMsg = promptNotes ? `\n\nUser Context/Notes:\n${promptNotes}` : "";
      const activeModel = model || "gemini-3.5-flash";

      const promptPayload = `
Job Description:
${jobDescription}

Candidate Resume:
${resumeText}
${combinedNotesMsg}

Instructions & Requested format is as follows:
${activePrompt}
`;

      const ai = getGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: promptPayload,
        config: {
          systemInstruction: "You are an elite talent coach, helping candidates match resumes with Job Descriptions, specializing in ATS optimizations.",
          temperature: 0.2,
        },
      });

      res.json({
        report: response.text || "No report content generated by the model.",
        modelUsed: activeModel,
      });
    } catch (error: any) {
      console.error("Error in /api/resume/analyze:", error);
      res.status(500).json({ error: error?.message || "An unexpected error occurred during AI analysis." });
    }
  });

  // 2. Generate Interview Questions Endpoint
  app.post("/api/interview/questions", async (req, res) => {
    try {
      const { jobDescription, resumeText, customPrompt, apiKey, model } = req.body;

      if (!jobDescription || !resumeText) {
        return res.status(400).json({ error: "Job description and resume text are required." });
      }

      const activePrompt = (customPrompt && customPrompt.trim()) || DEFAULT_INTERVIEW_PROMPT;
      const activeModel = model || "gemini-3.5-flash";

      const promptPayload = `
Job Description:
${jobDescription}

Candidate Resume:
${resumeText}

Instructions of evaluation guidelines to follow:
${activePrompt}
`;

      const ai = getGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: promptPayload,
        config: {
          systemInstruction: "You are an expert interview simulator and executive technical coach.",
          temperature: 0.3,
        },
      });

      res.json({
        report: response.text || "No interview questions generated by the model.",
        modelUsed: activeModel,
      });
    } catch (error: any) {
      console.error("Error in /api/interview/questions:", error);
      res.status(500).json({ error: error?.message || "An unexpected error occurred during interview question generation." });
    }
  });

  // 3. Interview Evaluation Endpoint
  app.post("/api/interview/evaluate", async (req, res) => {
    try {
      const { scoringTable, metricTable, questionSimulationReport, customPrompt, apiKey, model } = req.body;

      const activePrompt = (customPrompt && customPrompt.trim()) || DEFAULT_EVALUATION_PROMPT;
      const activeModel = model || "gemini-3.5-flash";

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

      const ai = getGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: promptPayload,
        config: {
          systemInstruction: "You are an expert HR decision support engine and leadership psychometric analyzer.",
          temperature: 0.2,
        },
      });

      res.json({
        report: response.text || "No evaluation report generated by the model.",
        modelUsed: activeModel,
      });
    } catch (error: any) {
      console.error("Error in /api/interview/evaluate:", error);
      res.status(500).json({ error: error?.message || "An unexpected error occurred during interview evaluation." });
    }
  });

  // 4. AI Content Detection Endpoint
  // Uses ZeroGPT's public detection API (free, no key required).
  // Fast-DetectGPT (https://github.com/baoguangsheng/fast-detect-gpt) has no public API
  // and requires local PyTorch + 2-8B parameter models to run. If you have a local
  // fast-detect-gpt server running (python scripts/local_infer.py --api), set
  // FAST_DETECT_GPT_URL=http://localhost:8765/detect in .env and it will be used instead.
  app.post("/api/ai-detect", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "Text is required." });
      }
      if (text.trim().length < 50) {
        return res.status(400).json({ error: "Text too short — please provide at least 50 characters for reliable detection." });
      }

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
      res.status(500).json({ error: error?.message || "AI detection service unavailable. Try again later." });
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
