import React, { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { ApiKeySetup } from "./components/ApiKeySetup";
import { LogoMark } from "./components/LogoMark";
import { Wordmark } from "./components/Wordmark";
import { SharedInputs } from "./components/SharedInputs";
import { StepRail, Step } from "./components/StepRail";
import { StoredDataNotice } from "./components/StoredDataNotice";
import type { ClearOutcome } from "./components/StoredDataNotice";
import { AiDetection } from "./sections/AiDetection";
import { ResumeAudit } from "./sections/ResumeAudit";
import { InterviewPrep } from "./sections/InterviewPrep";
import { LiveInterview } from "./sections/LiveInterview";
import { deleteRecordingDB, hasStoredRecordings } from "./lib/recordingStore";
import { toolReadiness } from "./lib/readiness";
import { applyTheme, forgetTheme, loadTheme, storeTheme, Theme } from "./lib/theme";
import { ProviderInfo, SharedContext } from "./types";

const CONTEXT_STORAGE_KEY = "cc_shared_context";
const API_KEY_STORAGE_KEY = "user_ai_api_key";
const STEP_STORAGE_KEY = "cc_active_step";

const EMPTY_CONTEXT: SharedContext = {
  resumeText: "",
  resumeFileName: "",
  jobDescription: "",
  appliedPosition: "",
};

const STEP_IDS = ["details", "detection", "audit", "prep", "live"] as const;
type StepId = (typeof STEP_IDS)[number];

/**
 * One step's panel. Every step stays mounted and is hidden rather than
 * unmounted.
 *
 * This is not an optimisation. Live Interview holds an open MediaStream, a
 * wake lock, a Whisper worker and an IndexedDB handle for the take in
 * progress — unmounting it to switch tabs would end someone's recording
 * mid-interview. Resume Audit and Interview Prep hold generated reports that
 * cost an API call, and losing those on a tab change would be its own bug.
 *
 * Declared at module scope, not inside App. A component defined inside the
 * render body is a brand-new type on every render, so React unmounts and
 * remounts its whole subtree on each keystroke — which would throw away the
 * very state this wrapper exists to protect.
 */
const Panel: React.FC<{
  id: StepId;
  activeStep: StepId;
  children: React.ReactNode;
}> = ({ id, activeStep, children }) => (
  <div
    id={`steppanel-${id}`}
    role="tabpanel"
    aria-labelledby={`steptab-${id}`}
    hidden={activeStep !== id}
  >
    {children}
  </div>
);

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
  localStorage.getItem(API_KEY_STORAGE_KEY) || localStorage.getItem("user_gemini_api_key") || "";

/** Come back to the step you were on, not to the top of the workflow. */
const loadStep = (): StepId => {
  try {
    const stored = localStorage.getItem(STEP_STORAGE_KEY);
    return STEP_IDS.includes(stored as StepId) ? (stored as StepId) : "details";
  } catch {
    return "details";
  }
};

export default function App() {
  const [context, setContext] = useState<SharedContext>(loadContext);
  const [apiKey, setApiKey] = useState<string>(loadApiKey);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [activeStep, setActiveStep] = useState<StepId>(loadStep);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  // Set from the one-time mount probe below, from LiveInterview's
  // onRecordingStored the moment a new take is durably written (LIVE-09
  // follow-up — the mirror of clearedAt below), and to false by
  // handleClearStoredData once a delete actually confirms the database is
  // gone. Without the onRecordingStored write, this stayed false forever
  // after the first successful clear — nothing else ever set it back to
  // true — silently disabling "Clear stored data" for every take recorded
  // afterward until the next full reload re-ran the mount probe.
  const [hasRecordings, setHasRecordings] = useState(false);
  // LIVE-09: bumped only once a clear has actually emptied the recordings
  // database, so LiveInterview's take list (D-31) can drop its own stale
  // reads of it without a full page reload. Never bumped on an "incomplete"
  // outcome — the data (and that list) genuinely is still there then.
  const [clearedAt, setClearedAt] = useState(0);

  // Keep the session on disk so a refresh doesn't cost the user their resume.
  useEffect(() => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(context));
  }, [context]);

  useEffect(() => {
    localStorage.setItem(STEP_STORAGE_KEY, activeStep);
  }, [activeStep]);

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
  }, [theme]);

  // Probe once on mount so the stored-data notice can name recordings
  // alongside the resume, job description and API key (D-12).
  useEffect(() => {
    hasStoredRecordings().then(setHasRecordings);
  }, []);

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

  /**
   * An empty value REMOVES the entry rather than storing "".
   *
   * `setItem(key, "")` left the name behind holding an empty string, so
   * "Remove this key from the browser" did not actually remove anything — and
   * because `loadApiKey` reads `getItem(...) || getItem(legacy) || ""`, an
   * empty string is falsy and fell straight through to the pre-v2
   * `user_gemini_api_key`. On a browser that still held one, removing the
   * current key resurrected the old one on the next load, which is the
   * opposite of what the control promises. The legacy name is cleared here
   * too, for the same reason `handleClearStoredData` clears it.
   */
  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    if (val) {
      localStorage.setItem(API_KEY_STORAGE_KEY, val);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
      localStorage.removeItem("user_gemini_api_key");
    }
  };

  /**
   * Remove everything this browser holds for the app.
   *
   * Named explicitly rather than clearing localStorage wholesale: on a shared
   * origin (localhost during development, or a domain hosting more than this
   * app) `localStorage.clear()` would take other applications' data with it.
   *
   * Includes two names this version no longer writes but earlier ones did.
   * `user_gemini_api_key` is still read by `loadApiKey` as a fallback, so
   * leaving it would resurrect the key on the next load and make the button
   * look broken; `selected_gemini_model` is dead residue that nothing reads,
   * and clearing "everything" ought to mean it.
   *
   * The `live_interview_recordings` IndexedDB database is named for the same
   * reason (D-12): explicit deletion by name, never a bulk clear.
   */
  const handleClearStoredData = async (): Promise<ClearOutcome> => {
    for (const key of [
      CONTEXT_STORAGE_KEY,
      API_KEY_STORAGE_KEY,
      STEP_STORAGE_KEY,
      "user_gemini_api_key",
      "selected_gemini_model",
    ]) {
      localStorage.removeItem(key);
    }
    forgetTheme();
    const deleteOutcome = await deleteRecordingDB();
    // Report what is actually on disk, not what was requested: a "blocked"
    // or "error" outcome means the database is still there, so re-probe
    // rather than assuming the delete took (LIVE-09).
    const stillPresent = deleteOutcome === "deleted" ? false : await hasStoredRecordings();
    setHasRecordings(stillPresent);
    if (!stillPresent) {
      // Tells LiveInterview's take list the database is actually gone, so
      // it empties immediately instead of rendering takes that no longer
      // exist until the next full reload (LIVE-09).
      setClearedAt(Date.now());
    }
    // The localStorage side genuinely was cleared even when the database
    // was not — this reset always runs, in both outcomes.
    setContext(EMPTY_CONTEXT);
    setApiKey("");
    setProviderInfo(null);
    setVerifyError("");
    setActiveStep("details");
    return stillPresent ? "incomplete" : "cleared";
  };

  const readiness = toolReadiness(context, apiKey);

  const steps: Step[] = [
    { id: "details", label: "Your details" },
    { id: "detection", label: "AI check", lockedReason: readiness.detection },
    { id: "audit", label: "Resume audit", lockedReason: readiness.audit },
    { id: "prep", label: "Interview prep", lockedReason: readiness.prep },
    // Live Interview records in the browser and needs no shared context, so
    // it is never gated here — its own capability check lives inside it.
    { id: "live", label: "Live interview" },
  ];

  return (
    // relative + z-10 lifts the content above the fixed grid layer painted
    // on body::before.
    <div className="relative z-10 flex min-h-screen flex-col">
      {/* ── Masthead ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-rule bg-ground/80 backdrop-blur-md">
        <div className="mx-auto w-full max-w-[1120px] px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <Wordmark />

            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-control border border-rule p-2 text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-6">
        {/* Connection strip — plumbing the tools need, not a step in the work. */}
        <div className="border-b border-rule py-5">
          <ApiKeySetup
            apiKey={apiKey}
            onApiKeyChange={handleApiKeyChange}
            providerInfo={providerInfo}
            isVerifying={isVerifying}
            verifyError={verifyError}
          />
        </div>

        <StepRail
          steps={steps}
          activeId={activeStep}
          onSelect={(id) => setActiveStep(id as StepId)}
        />

        {/* The left inset is the margin column the "NN — NAME" labels hang in,
            the way the reference sets its sections. It collapses below md,
            where there is no room for two columns. */}
        <div className="py-12 md:py-16 md:pl-44">
          <Panel id="details" activeStep={activeStep}>
            <SharedInputs context={context} onChange={updateContext} />
          </Panel>

          <Panel id="detection" activeStep={activeStep}>
            <AiDetection resumeText={context.resumeText} />
          </Panel>

          <Panel id="audit" activeStep={activeStep}>
            <ResumeAudit context={context} apiKey={apiKey} />
          </Panel>

          <Panel id="prep" activeStep={activeStep}>
            <InterviewPrep context={context} apiKey={apiKey} />
          </Panel>

          <Panel id="live" activeStep={activeStep}>
            <LiveInterview
              context={context}
              apiKey={apiKey}
              clearedAt={clearedAt}
              onRecordingStored={() => setHasRecordings(true)}
            />
          </Panel>
        </div>

        <div className="border-t border-rule py-6">
          <StoredDataNotice
            hasResume={Boolean(context.resumeText.trim())}
            hasJobDescription={Boolean(context.jobDescription.trim())}
            hasApiKey={Boolean(apiKey.trim())}
            hasRecordings={hasRecordings}
            onClear={handleClearStoredData}
          />
        </div>
      </main>

      {/* ── Colophon ─────────────────────────────────────────────────────
          Set a step below body size throughout: this is the plate at the foot
          of the page, not part of the work on it. */}
      <footer className="border-t border-rule">
        <div className="mx-auto w-full max-w-[1120px] px-6 py-9">
          <div className="flex flex-col gap-6 md:flex-row md:justify-between">
            <p className="measure text-sm leading-relaxed text-ink-muted">
              Your key stays in this browser, goes only to your provider, and never touches the
              server.
            </p>

            <div className="flex shrink-0 items-start gap-3 text-sm text-ink-muted md:flex-row-reverse md:text-right">
              <LogoMark className="mt-0.5 h-5 w-6 shrink-0 text-accent" />
              <div className="flex flex-col gap-0.5">
                <span className="text-ink-soft">Hillol Kr Barman</span>
                <span>Made for QIBA, a collaboration of alumni</span>
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-2 border-t border-rule pt-5 font-mono text-xs text-ink-muted sm:flex-row sm:justify-between">
            <span>© {new Date().getFullYear()} Career Copilot</span>
            <span>Guidance only — not a hiring decision, not career or legal advice.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
