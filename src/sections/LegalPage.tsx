import React from "react";
import { ArrowLeft } from "lucide-react";
import { CTA_QUIET } from "../lib/ui";

/**
 * Privacy and terms, on one page.
 *
 * Kept together deliberately: split across two pages, a reader has to visit
 * both to learn one thing — what happens to their resume and their API key.
 * The sticky index beside them does the work the split would have done.
 *
 * The privacy half describes what this build actually does. Every claim here
 * is traceable to code: localStorage keys written in App.tsx, the
 * `live_interview_recordings` IndexedDB store in recordingStore.ts, the
 * server-side proxying in server.ts, and the local-only detector behind
 * /api/ai-detect. If that behaviour changes, this page has to change with it.
 */
const SECTIONS = [
  { id: "privacy", label: "Privacy" },
  { id: "terms", label: "Terms" },
];

const scrollToSection = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

export const LegalPage: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <main className="mx-auto w-full max-w-[1120px] flex-1 px-6 py-12 md:py-16">
    <button type="button" onClick={onBack} className={`${CTA_QUIET} -ml-1 mb-10`}>
      <ArrowLeft className="cta-arrow-back h-4 w-4" />
      Back to Career Copilot
    </button>

    <p className="label mb-3">Privacy and terms</p>
    <h1 className="display max-w-[20ch] text-[30px] md:text-[42px]">
      What happens to your resume, and what this tool promises.
    </h1>

    <div className="mt-12 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
      {/* Sticky index. Hidden below lg, where it would just be a second list
          the reader has to scroll past to reach the thing it points at. */}
      <nav aria-label="On this page" className="hidden lg:block">
        <div className="sticky top-24 flex flex-col gap-2">
          <p className="label mb-1">On this page</p>
          {/* Buttons rather than anchors on purpose. An href would change the
              hash, and the hash is the app's route — an in-page jump would read
              as "leave this page". These scroll directly, so the route stays
              put. The trade is that a section is not deep-linkable; the page is
              short enough that landing at its top costs a reader nothing. */}
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
              className="text-left text-[15px] text-ink-soft transition-colors hover:text-accent"
            >
              {section.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="measure flex flex-col gap-12">
        <section
          id="privacy"
          aria-labelledby="privacy-title"
          className="flex scroll-mt-24 flex-col gap-4"
        >
          <h2 id="privacy-title" className="text-[22px]">
            Privacy
          </h2>

          <h3 className="mt-2 text-[17px]">What is stored, and where</h3>
          <p className="leading-relaxed text-ink-soft">
            Your resume, the job description, the position you entered and your API key are kept in
            this browser's local storage. Any interview recordings and transcripts are kept in this
            browser's IndexedDB. None of it is uploaded, and none of it is kept on the server. Clear
            it at any time with <span className="text-ink">Clear stored data</span> at the foot of
            the page — that removes every one of those items, including the recordings.
          </p>

          <h3 className="mt-2 text-[17px]">Your API key</h3>
          <p className="leading-relaxed text-ink-soft">
            The key you paste is stored in this browser and sent to this app's server for one
            purpose: to make each AI request to your chosen provider on your behalf. It is not
            logged, not written to disk and not retained after the request completes. The provider
            you bring the key from — Google, OpenAI or Anthropic — receives the content of those
            requests and handles it under their own terms, which are worth reading, because they and
            not this tool decide how that content is used.
          </p>

          <h3 className="mt-2 text-[17px]">The AI check</h3>
          <p className="leading-relaxed text-ink-soft">
            The AI-detection step runs entirely on this app's server with no model call and no
            outbound request. Your resume text is analysed for the result and not stored.
          </p>

          <h3 className="mt-2 text-[17px]">Recording other people</h3>
          <p className="leading-relaxed text-ink-soft">
            The live interview step records through your microphone and keeps the audio in this
            browser only. Recording consent law differs by country and state, and some places
            require everyone present to agree, not only you. You are responsible for telling
            everyone in the room that they are being recorded, every time, and for checking what
            applies where you are.
          </p>

          <h3 className="mt-2 text-[17px]">Shared computers</h3>
          <p className="leading-relaxed text-ink-soft">
            Because everything is kept in the browser, anyone else using the same browser profile
            can reach it. On a shared or public machine, clear your stored data before you walk
            away.
          </p>
        </section>

        <section
          id="terms"
          aria-labelledby="terms-title"
          className="flex scroll-mt-24 flex-col gap-4"
        >
          <h2 id="terms-title" className="text-[22px]">
            Terms
          </h2>

          <h3 className="mt-2 text-[17px]">What this tool is</h3>
          <p className="leading-relaxed text-ink-soft">
            Career Copilot is guidance, not a hiring decision, and not career, legal or employment
            advice. Scores, callback estimates and generated answers are produced by a language
            model and can be wrong, out of date or confidently mistaken. Read them as a prompt to
            look closer at your own document, never as a verdict on it. Nothing here is a prediction
            of whether you will get a job.
          </p>

          <h3 className="mt-2 text-[17px]">Costs are yours</h3>
          <p className="leading-relaxed text-ink-soft">
            Every AI request runs on the key you supply, so any usage charges from your provider are
            yours. This tool does not meter, cap or bill for that usage.
          </p>

          <h3 className="mt-2 text-[17px]">No warranty</h3>
          <p className="leading-relaxed text-ink-soft">
            The tool is provided as is, without warranty of any kind. It may be unavailable, may
            lose data held in your browser, and may produce inaccurate output. To the extent the law
            allows, the author is not liable for any loss arising from its use — including a missed
            opportunity, a lost recording or a decision taken on the strength of its output.
          </p>

          <h3 className="mt-2 text-[17px]">Fair use</h3>
          <p className="leading-relaxed text-ink-soft">
            Use it for your own applications and your own practice. Do not use it to misrepresent
            someone else's experience, to record people who have not agreed to it, or in any way
            that breaks the terms of the AI provider whose key you are using.
          </p>
        </section>

        <p className="border-t border-rule pt-6 text-sm leading-relaxed text-ink-muted">
          This page describes how this build behaves and is written in plain language rather than by
          a lawyer. If you are putting Career Copilot in front of people beyond yourself, have it
          reviewed against the rules that apply where they are.
        </p>
      </div>
    </div>
  </main>
);
