import React, { useState, useEffect } from "react";
import { ArrowDown, Github, Linkedin } from "lucide-react";
import { flushSync } from "react-dom";
import { ApiKeySetup } from "./components/ApiKeySetup";
import { LogoMark } from "./components/LogoMark";
import { Wordmark } from "./components/Wordmark";
import { SharedInputs } from "./components/SharedInputs";
import { StepFooter } from "./components/StepFooter";
import { ThemeToggle } from "./components/ThemeToggle";
import { LegalPage } from "./sections/LegalPage";
import { CTA } from "./lib/ui";
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

/** Steps that cannot run without an API key. 01 intake and 02's local detector can. */
const KEY_DEPENDENT_STEPS: readonly StepId[] = ["audit", "prep", "live"];

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

type Route = "app" | "legal";

const NAV_LINKS: { route: Route; label: string }[] = [
  { route: "app", label: "Home" },
  { route: "legal", label: "Privacy & terms" },
];

const LEGAL_HASH = "#privacy-terms";

/**
 * The hash carries the route and nothing else.
 *
 * An earlier version also let the legal page's own section ids (#privacy,
 * #terms) count as "on the legal page", so its index could be plain anchors.
 * That raced: an in-page anchor click fires popstate and hashchange in an order
 * the two listeners could interleave, and the app-route branch would clear the
 * hash mid-flight and throw the reader back to the tool. The index now scrolls
 * directly instead, which keeps this a single unambiguous value.
 */
const loadRoute = (): Route => (window.location.hash === LEGAL_HASH ? "legal" : "app");

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
  const [scrolled, setScrolled] = useState(false);
  // Two views, routed on the hash. A router dependency would be the usual
  // answer, but this app has exactly one alternate page — the hash keeps the
  // legal page linkable and back-button-able without adding one.
  const [route, setRoute] = useState<Route>(loadRoute);
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

  // Passive, because this listener never calls preventDefault and the browser
  // should not have to wait on it before scrolling. Read once on mount too: a
  // reload can restore a scroll position, and the bar would otherwise sit
  // borderless over content until the reader happened to scroll again.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Writing the hash keeps the legal page shareable and gives the back button
  // something to return to; listening for hashchange keeps the view correct
  // when the reader uses that button rather than the on-page links.
  useEffect(() => {
    if (route === "legal") {
      if (window.location.hash !== LEGAL_HASH) {
        window.history.pushState(null, "", LEGAL_HASH);
        window.scrollTo(0, 0);
      }
      return;
    }
    if (window.location.hash) {
      window.history.pushState(null, "", window.location.pathname + window.location.search);
    }
  }, [route]);

  useEffect(() => {
    const onHashChange = () => setRoute(loadRoute());
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, []);

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

  /**
   * Flip the theme as a circle opening from the button that was pressed.
   *
   * The View Transitions API snapshots the page before and after the state
   * change; the animation below then wipes the *new* snapshot in over the old
   * one along an expanding circle, so the whole page appears to be repainted by
   * the spreading edge rather than cross-fading in place.
   *
   * `flushSync` matters: startViewTransition has to observe the DOM already in
   * its new state when its callback returns, and React would otherwise batch
   * the setState until after the snapshot was taken, producing a transition
   * from the old theme to the old theme.
   *
   * Falls back to an instant switch where the API is missing (Firefox at time
   * of writing) or where the reader has asked for reduced motion — in both
   * cases the theme still changes, just without the reveal.
   */
  const toggleTheme = (event: React.MouseEvent<HTMLButtonElement>) => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || typeof document.startViewTransition !== "function") {
      setTheme(next);
      return;
    }

    // Radiate from the middle of the button that was pressed.
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Layout viewport, not window.innerWidth — the latter counts the scrollbar
    // gutter, which would skew the proportions below.
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;

    /*
     * Everything below is a proportion, not a pixel measurement.
     *
     * `::view-transition-new(root)` is `width: 100%; height: auto` inside a
     * group that is `width: auto`, so it shrink-to-fits the snapshot's
     * intrinsic size — and that size is in *device* pixels. On a 2x display the
     * clip-path's coordinate space is twice the CSS viewport, so a CSS-pixel
     * origin lands at roughly half the intended offset: a button at the top
     * right of a 1281px viewport drew its circle from 1159px into a 2562px box,
     * which reads as top centre. Percentages resolve against whatever that box
     * turns out to be, so they place the origin correctly at any pixel ratio.
     *
     * A percentage radius on circle() resolves against
     * sqrt(w² + h²) / sqrt(2) of the reference box. Both the corner distance
     * and that reference are computed here in CSS pixels; their ratio is what
     * carries over, and a ratio is scale-invariant.
     */
    const cornerDistance = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
    const radiusReference = Math.hypot(width, height) / Math.SQRT2;

    const root = document.documentElement;
    root.style.setProperty("--vt-x", `${(x / width) * 100}%`);
    root.style.setProperty("--vt-y", `${(y / height) * 100}%`);
    // A whisker over, so no fractional-pixel corner survives the sweep.
    root.style.setProperty("--vt-r", `${(cornerDistance / radiusReference) * 100.5}%`);

    const transition = document.startViewTransition(() => {
      flushSync(() => setTheme(next));
    });

    // Leave the properties in place until the sweep is over — clearing them
    // mid-animation would drop the circle back to its centred fallback.
    void transition.finished
      .catch(() => {})
      .finally(() => {
        root.style.removeProperty("--vt-x");
        root.style.removeProperty("--vt-y");
        root.style.removeProperty("--vt-r");
      });
  };

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
  // The hero orients a first-time visitor. Once a resume is loaded there is
  // nothing left to orient — it would just be a wall in front of the work.
  // Shown on step 01 for everyone. Gating this on an empty resume hid it
  // permanently from anyone with a document already stored.
  const showHero = activeStep === "details";

  /** Carry the reader from the hero down to the first step. */
  const scrollToWorkflow = () => {
    document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
      <header
        /* The rule is there to separate the bar from content passing beneath
           it, so it only earns its place once content is actually passing.
           `border-transparent` at rest rather than no border at all: dropping
           the border outright would shift the whole page up by a pixel the
           moment it appeared. The translucency and blur are held back for the
           same reason — at the top of the page there is nothing behind the bar
           to see through to. */
        className={`sticky top-0 z-50 border-b transition-colors duration-200 ${
          scrolled ? "border-rule bg-ground/80 backdrop-blur-md" : "border-transparent bg-ground"
        }`}
      >
        <div className="mx-auto w-full max-w-[1120px] px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setRoute("app")}
              className="rounded-control"
              aria-label="Career Copilot — back to the tool"
            >
              <Wordmark />
            </button>

            <nav className="flex items-center gap-1 sm:gap-2">
              {NAV_LINKS.map((link) => {
                const active = route === link.route;
                return (
                  <button
                    key={link.route}
                    type="button"
                    onClick={() => setRoute(link.route)}
                    aria-current={active ? "page" : undefined}
                    className={`relative rounded-control px-2.5 py-2 text-[13px] transition-colors sm:px-3 ${
                      active ? "text-accent" : "text-ink-soft hover:text-accent"
                    }`}
                  >
                    {link.label}
                    {/* A positioned rule rather than a border or an inset
                        shadow: both follow the control's 5px radius and curve
                        up at the ends into a smile. This also lets the rule sit
                        under the label's own width rather than the button's
                        padded box, and adds no height when it appears. */}
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-2.5 bottom-0.5 h-0.5 rounded-full bg-accent sm:inset-x-3"
                      />
                    )}
                  </button>
                );
              })}

              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </nav>
          </div>
        </div>
      </header>

      {route === "legal" ? (
        <LegalPage onBack={() => setRoute("app")} />
      ) : (
        <>
          {/* Masthead, hero, rail, panels and footer all use the same container —
          one max width, one padding, so one left edge. Three different edges on
          one screen was the original complaint. */}
          <main className="mx-auto w-full max-w-[1120px] flex-1 px-6">
            {/* The hero is the first thing in <main>, ahead of the rail and ahead
            of the connection strip. It shows on step 01 for everyone, not only
            for a visitor with no resume: gating it on an empty resume meant the
            owner — who always has one stored — could never see it at all. On
            steps 02-05 it is gone, because by then you are mid-task and a
            product statement is just a wall in front of the work. */}
            {/* The hero carries the page's h1, but it only renders on step 01 —
            on every other step the outline would start at h2 with no h1 above
            it. This keeps exactly one h1 present either way, announced to a
            screen reader and invisible to everyone else. */}
            {!showHero && <h1 className="sr-only">Career Copilot</h1>}

            {showHero && (
              /* A full viewport, less the sticky masthead it sits under. `svh`
                 rather than `vh` because mobile browsers measure `vh` against
                 the viewport with the URL bar retracted, which pushes the call
                 to action below the fold on the one screen where it matters
                 most. Centred vertically, and still `min-h` so a long headline
                 or a narrow screen can grow past it rather than clip. */
              <section className="flex min-h-[calc(100svh-3.5rem)] flex-col justify-center border-b border-rule py-16">
                <p className="label mb-4">Set for your next interview?</p>
                <h1 className="display max-w-[19ch] text-[34px] leading-tight md:text-[52px]">
                  Four <span className="highlight"> checks </span>,<br></br>over one resume,{" "}
                  <span className="highlight">
                    {" "}
                    <br></br>before the interview.
                  </span>
                </h1>
                <p className="measure mt-5 text-base leading-relaxed text-ink-soft">
                  Add your resume once. Find out whether it reads as AI-written, score your odds of
                  a callback against a specific job, prepare the answers you will be asked for, and
                  record a practice run — all on an AI key you bring yourself, which never leaves
                  your browser.
                </p>
                {/* Scrolls rather than jumps: with the hero occupying the whole
                    viewport the work below is entirely out of sight, and a hard
                    jump gives no sense that there is a page under the fold. */}
                {/* self-start: the hero is a flex column, so without it the button
                    stretches the full width of the section. */}
                <button
                  type="button"
                  onClick={scrollToWorkflow}
                  className={`${CTA} mt-8 self-start`}
                >
                  Get Started
                  <ArrowDown className="cta-arrow-down h-4 w-4" />
                </button>
              </section>
            )}

            <div id="workflow" className="scroll-mt-16">
              <StepRail
                steps={steps}
                activeId={activeStep}
                onSelect={(id) => setActiveStep(id as StepId)}
              />
            </div>

            {/* Connection strip — plumbing the tools need, not a step in the work,
            and so placed under the rail rather than above it. As the first
            child of <main> it was the first thing every visitor saw, which is
            how the page came to open on a credential form. */}
            <div className="border-b border-rule py-5">
              <ApiKeySetup
                apiKey={apiKey}
                onApiKeyChange={handleApiKeyChange}
                providerInfo={providerInfo}
                isVerifying={isVerifying}
                verifyError={verifyError}
                /* Unfold the provider walkthrough only on a step that actually
               needs a key. Steps 01 and 02 run without one — the AI check is
               local — so on those it stays a single quiet line. */
                autoExpand={KEY_DEPENDENT_STEPS.includes(activeStep)}
              />
            </div>

            <div className="py-12 md:py-16">
              <Panel id="details" activeStep={activeStep}>
                <SharedInputs context={context} onChange={updateContext} />
                <StepFooter
                  steps={steps}
                  currentId="details"
                  onSelect={(id) => setActiveStep(id as StepId)}
                />
              </Panel>

              <Panel id="detection" activeStep={activeStep}>
                <AiDetection resumeText={context.resumeText} />
                <StepFooter
                  steps={steps}
                  currentId="detection"
                  onSelect={(id) => setActiveStep(id as StepId)}
                />
              </Panel>

              <Panel id="audit" activeStep={activeStep}>
                <ResumeAudit context={context} apiKey={apiKey} />
                <StepFooter
                  steps={steps}
                  currentId="audit"
                  onSelect={(id) => setActiveStep(id as StepId)}
                />
              </Panel>

              <Panel id="prep" activeStep={activeStep}>
                <InterviewPrep context={context} apiKey={apiKey} />
                <StepFooter
                  steps={steps}
                  currentId="prep"
                  onSelect={(id) => setActiveStep(id as StepId)}
                />
              </Panel>

              <Panel id="live" activeStep={activeStep}>
                <LiveInterview
                  context={context}
                  apiKey={apiKey}
                  clearedAt={clearedAt}
                  onRecordingStored={() => setHasRecordings(true)}
                />
                <StepFooter
                  steps={steps}
                  currentId="live"
                  onSelect={(id) => setActiveStep(id as StepId)}
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
        </>
      )}

      {/* ── Colophon ─────────────────────────────────────────────────────
          One plate, not two. The privacy line, the byline and the copyright
          were three separate tiers saying closely related things; merged, the
          foot of the page is a single row a reader takes in at once. */}
      <footer className="border-t border-rule">
        <div className="mx-auto w-full max-w-[1120px] px-6 py-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <LogoMark className="mt-0.5 h-5 w-6 shrink-0 text-accent" />
              <div className="measure flex flex-col gap-1 text-sm text-ink-muted">
                <span className="text-ink-soft">
                  Career Copilot — built by Hillol Kr Barman for QIBA, a collaboration of alumni.
                </span>
                <span>
                  Your key stays in this browser, goes only to your provider, and never touches the
                  server. Guidance only — not a hiring decision, not career or legal advice.
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-5 text-sm">
              <a
                href="https://www.linkedin.com/in/hillolbarman/"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-ink-soft transition-colors hover:text-accent"
              >
                <Linkedin className="h-4 w-4" />
                LinkedIn
              </a>
              <a
                href="https://github.com/hillol-kr-barman"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-ink-soft transition-colors hover:text-accent"
              >
                <Github className="h-4 w-4" />
                GitHub
              </a>
              <button
                type="button"
                onClick={() => setRoute("legal")}
                className="text-ink-soft transition-colors hover:text-accent"
              >
                Privacy &amp; terms
              </button>
            </div>
          </div>

          <p className="mt-7 border-t border-rule pt-5 font-mono text-xs text-ink-muted">
            © {new Date().getFullYear()} Career Copilot
          </p>
        </div>
      </footer>
    </div>
  );
}
