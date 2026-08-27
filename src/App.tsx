import React, { useState, useEffect } from "react";
import prismHero from "./assets/images/prism_hero_1781065935616.png";
import { ApiKeySetup } from "./components/ApiKeySetup";
import { SharedInputs } from "./components/SharedInputs";
import { AiDetection } from "./sections/AiDetection";
import { ResumeAudit } from "./sections/ResumeAudit";
import { InterviewPrep } from "./sections/InterviewPrep";
import { ProviderInfo, SharedContext } from "./types";

const CONTEXT_STORAGE_KEY = "cc_shared_context";
const API_KEY_STORAGE_KEY = "user_ai_api_key";

const EMPTY_CONTEXT: SharedContext = {
  resumeText: "",
  resumeFileName: "",
  jobDescription: "",
  appliedPosition: "",
};

const loadContext = (): SharedContext => {
  try {
    const stored = localStorage.getItem(CONTEXT_STORAGE_KEY);
    return stored ? { ...EMPTY_CONTEXT, ...JSON.parse(stored) } : EMPTY_CONTEXT;
  } catch {
    return EMPTY_CONTEXT;
  }
};

/** Read the key, falling back to the Gemini-only key name used before v2. */
const loadApiKey = (): string =>
  localStorage.getItem(API_KEY_STORAGE_KEY) ||
  localStorage.getItem("user_gemini_api_key") ||
  "";

export default function App() {
  const [context, setContext] = useState<SharedContext>(loadContext);
  const [apiKey, setApiKey] = useState<string>(loadApiKey);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  // Keep the session on disk so a refresh doesn't cost the user their resume.
  useEffect(() => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(context));
  }, [context]);

  /**
   * Identify the engine and model behind the current key.
   *
   * Debounced because this fires as the user types or pastes, and aborted on
   * change so a slow earlier check can't overwrite a newer result.
   */
  useEffect(() => {
    const key = apiKey.trim();
    setVerifyError("");

    if (!key) {
      setProviderInfo(null);
      setIsVerifying(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsVerifying(true);
      fetch("/api/ai/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not verify that key.");
          setProviderInfo(data as ProviderInfo);
        })
        .catch((err: any) => {
          if (err?.name === "AbortError") return;
          setProviderInfo(null);
          setVerifyError(err?.message || "Could not verify that key.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsVerifying(false);
        });
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiKey]);

  const updateContext = (patch: Partial<SharedContext>) =>
    setContext((prev) => ({ ...prev, ...patch }));

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    localStorage.setItem(API_KEY_STORAGE_KEY, val);
  };

  return (
    <div className="flex flex-col min-h-screen text-[#eef0f3] selection:bg-[#00d4dc] selection:text-[#0a0c0d]">
      {/* Header — sticky. The translucent bar is the chrome itself rather than a
          card inside it, so page content passing underneath reads as behind the
          bar instead of colliding with a second border. */}
      <header className="sticky top-0 z-50 w-full border-b border-[rgba(255,255,255,0.07)] bg-[#0e1012]/85 backdrop-blur-md supports-[backdrop-filter]:bg-[#0e1012]/70">
        <div className="w-full max-w-5xl mx-auto px-4">
          <div className="flex items-center justify-between gap-4 h-14">
            <a href="#top" className="flex items-center gap-2 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-[#00d4dc] animate-pulse" />
              <span className="font-display font-semibold text-xs md:text-sm tracking-widest text-[#eef0f3] uppercase">
                CAREER COPILOT
              </span>
            </a>

            <nav className="flex items-center gap-0.5 md:gap-1">
              <a
                href="#tool-ai-detection"
                className="px-2 md:px-3 py-2 rounded-[5px] text-[11px] md:text-xs font-semibold tracking-wide text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128] transition-all"
              >
                AI Detection
              </a>
              <a
                href="#tool-resume-audit"
                className="px-2 md:px-3 py-2 rounded-[5px] text-[11px] md:text-xs font-semibold tracking-wide text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128] transition-all"
              >
                Resume Audit
              </a>
              <a
                href="#tool-interview-prep"
                className="px-2 md:px-3 py-2 rounded-[5px] text-[11px] md:text-xs font-semibold tracking-wide text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128] transition-all"
              >
                Interview Prep
              </a>
            </nav>
          </div>
        </div>
      </header>

      <main
        id="top"
        className="flex-1 w-full max-w-5xl mx-auto px-4 pt-4 pb-8 md:pt-6 md:pb-10 flex flex-col gap-6"
      >
        {/* Hero */}
        <div className="relative overflow-hidden rounded-[10px] bg-[#161a1e] border border-[rgba(255,255,255,0.07)]">
          <div className="absolute inset-0 z-0 opacity-5">
            <img
              src={prismHero}
              alt=""
              aria-hidden="true"
              className="w-full h-full object-cover scale-105 blur-sm"
            />
          </div>
          <div className="relative z-10 px-6 py-8 md:px-10 md:py-10 flex flex-col gap-4">
            <p className="text-[10px] md:text-xs font-semibold uppercase tracking-widest text-[#00d4dc] bg-[rgba(0,212,220,0.08)] border border-[rgba(0,212,220,0.25)] px-3.5 py-1.5 rounded-[4px] w-fit">
              ✦ Powered by your own AI key
            </p>
            <h1 className="text-3xl md:text-5xl font-light font-display tracking-tight leading-none text-[#eef0f3] max-w-3xl">
              Resume and <span className="font-medium text-[#00d4dc]">Interview Tool</span>
            </h1>
            <p className="text-xs md:text-sm text-[#9aa3b0] max-w-2xl leading-relaxed font-sans">
              Add your resume once. Check whether it reads as AI-written, score your odds of a
              callback against a specific job description, and walk into the interview with
              questions and answers already prepared.
            </p>
          </div>
        </div>

        <ApiKeySetup
          apiKey={apiKey}
          onApiKeyChange={handleApiKeyChange}
          providerInfo={providerInfo}
          isVerifying={isVerifying}
          verifyError={verifyError}
        />

        <SharedInputs context={context} onChange={updateContext} />

        <AiDetection resumeText={context.resumeText} />

        <ResumeAudit context={context} apiKey={apiKey} />

        <InterviewPrep context={context} apiKey={apiKey} />
      </main>

      <footer className="w-full mt-auto border-t border-[rgba(255,255,255,0.07)] bg-[#0e1012]">
        <div className="w-full max-w-5xl mx-auto px-4 py-10 flex flex-col gap-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
            <div className="flex flex-col gap-2.5 max-w-md">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#00d4dc]" />
                <span className="font-display font-semibold text-xs tracking-widest text-[#eef0f3] uppercase">
                  Career Copilot
                </span>
              </div>
              <p className="text-xs text-[#6b7685] leading-relaxed">
                Three tools over one resume: check whether it reads as AI-written, score your odds
                of a callback against a job description, and prepare for the interview.
              </p>
              <p className="text-[11px] text-[#6b7685] leading-relaxed">
                Bring your own AI key — it stays in your browser, is sent only to your chosen
                provider, and is never stored on the server.
              </p>
            </div>

            <div className="flex flex-col gap-2 md:text-right shrink-0">
              <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
                Built by
              </span>
              <span className="text-xs text-[#9aa3b0] font-medium">Hillol Kr Barman</span>
              <span className="text-[11px] text-[#6b7685]">
                Made for QIBA · a collaboration of alumni
              </span>
            </div>
          </div>

          <div className="border-t border-[rgba(255,255,255,0.07)] pt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span className="text-[10px] tracking-widest text-[#6b7685] uppercase">
              © {new Date().getFullYear()} Career Copilot
            </span>
            <span className="text-[10px] text-[#6b7685]">
              Guidance only — not a hiring decision, and not career or legal advice.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
