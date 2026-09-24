import React, { useState } from "react";
import {
  KeyRound,
  Eye,
  EyeOff,
  ExternalLink,
  Check,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { ProviderInfo } from "../types";

interface ApiKeySetupProps {
  apiKey: string;
  onApiKeyChange: (val: string) => void;
  providerInfo: ProviderInfo | null;
  isVerifying: boolean;
  verifyError: string;
}

const PROVIDERS = [
  {
    name: "Google Gemini",
    prefix: "AIza…",
    href: "https://aistudio.google.com/app/apikey",
    note: "Generous free tier, the easiest place to start.",
  },
  {
    name: "OpenAI",
    prefix: "sk-…",
    href: "https://platform.openai.com/api-keys",
    note: "Pay as you go, needs billing set up.",
  },
  {
    name: "Anthropic Claude",
    prefix: "sk-ant-…",
    href: "https://console.anthropic.com/settings/keys",
    note: "Pay as you go, strong at long-form writing.",
  },
];

/**
 * Bring-your-own-key setup, as a strip above the workflow rather than a step
 * in it: it is plumbing the tools need, not a stage of the work.
 *
 * There is no model picker by design — the engine is identified from the key's
 * format and the model discovered from that provider's API, so the user pastes
 * one key and nothing else.
 */
export const ApiKeySetup: React.FC<ApiKeySetupProps> = ({
  apiKey,
  onApiKeyChange,
  providerInfo,
  isVerifying,
  verifyError,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const connected = Boolean(providerInfo);

  /*
   * Four states, not two.
   *
   * A stored key sits unverified for the first ~600ms of every page load,
   * while the debounced identify call is still waiting to fire. Deriving the
   * strip from `connected` alone put that moment in the "no key" branch, so
   * every load flashed a warning over copy telling the user to connect a key
   * they had already connected.
   */
  const status: "empty" | "pending" | "failed" | "connected" = connected
    ? "connected"
    : !apiKey.trim()
      ? "empty"
      : verifyError
        ? "failed"
        : "pending";

  // Volunteer the full setup only when there is genuinely no key, or when one
  // failed and the person needs to reach the field to fix it.
  const open = expanded || status === "empty" || status === "failed";

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={() => connected && setExpanded(!expanded)}
        aria-expanded={connected ? expanded : undefined}
        className={`flex w-full items-center gap-3 text-left ${
          connected ? "cursor-pointer" : "cursor-default"
        }`}
      >
        {status === "connected" ? (
          <Check className="h-4 w-4 shrink-0 text-good" />
        ) : status === "failed" ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-mark" />
        ) : status === "pending" || isVerifying ? (
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-accent" />
        ) : (
          <KeyRound className="h-4 w-4 shrink-0 text-ink-muted" />
        )}

        <span className="flex-1 text-[15px] text-ink-soft">
          {status === "connected" ? (
            <>
              Running on <span className="font-medium text-ink">{providerInfo!.providerLabel}</span>{" "}
              using <span className="font-mono text-sm text-ink">{providerInfo!.model}</span>, on
              your own quota.
            </>
          ) : status === "failed" ? (
            <span className="text-mark">{verifyError}</span>
          ) : status === "pending" ? (
            "Checking your key and finding the best model it can reach…"
          ) : (
            "Connect an AI key to run the audit, the interview prep and live feedback."
          )}
        </span>

        {connected && (
          <span className="flex shrink-0 items-center gap-1 text-[15px] text-accent">
            Change
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-5">
          {!connected && (
            <>
              <p className="measure text-[15px] leading-relaxed text-ink-soft">
                Bring a key from any of these three. The provider and best available model are
                worked out for you.
              </p>

              <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-3">
                {PROVIDERS.map((p) => (
                  <li key={p.name} className="flex flex-col gap-1">
                    <p className="text-[15px] font-medium text-ink">{p.name}</p>
                    <p className="text-sm leading-relaxed text-ink-soft measure">{p.note}</p>
                    <a
                      href={p.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 inline-flex items-center gap-1 text-[15px] text-accent hover:underline underline-offset-4"
                    >
                      Create a key
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="api_key_input" className="text-[15px] font-medium text-ink">
              Your API key
            </label>
            <div className="relative max-w-lg">
              <input
                id="api_key_input"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder="AIza… or sk-… or sk-ant-…"
                spellCheck={false}
                autoComplete="off"
                aria-describedby="api_key_help"
                className="w-full rounded-control border border-rule bg-surface px-3.5 py-3 pr-11 font-mono text-[15px] text-ink outline-none transition-colors placeholder:text-ink-muted placeholder:font-sans hover:border-rule-strong focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted transition-colors hover:text-ink"
                aria-label={showKey ? "Hide the key" : "Show the key"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p id="api_key_help" className="measure text-sm leading-relaxed text-ink-muted">
              Saved in this browser only. Sent to the server purely to make each AI call, never
              logged or stored there.
            </p>
          </div>

          {/* The failure is already stated in the strip above, next to the
              warning icon — repeating it here just doubled the same sentence. */}

          {connected && (
            <button
              type="button"
              onClick={() => onApiKeyChange("")}
              className="self-start text-[15px] text-ink-soft transition-colors hover:text-mark"
            >
              Remove this key from the browser
            </button>
          )}
        </div>
      )}
    </div>
  );
};
