import React, { useEffect, useId, useState } from "react";
import {
  KeyRound,
  Eye,
  EyeOff,
  ExternalLink,
  Check,
  ChevronDown,
  ChevronUp,
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
  /**
   * Whether an unset key should unfold the full provider walkthrough on its
   * own. False while the hero owns the first screen — 415px of provider cards
   * above the fold was the reason the page opened on plumbing.
   */
  autoExpand?: boolean;
}

const PROVIDERS = [
  {
    name: "Google Gemini",
    prefix: "AIza…",
    href: "https://aistudio.google.com/app/apikey",
  },
  {
    name: "OpenAI",
    prefix: "sk-…",
    href: "https://platform.openai.com/api-keys",
  },
  {
    name: "Anthropic Claude",
    prefix: "sk-ant-…",
    href: "https://console.anthropic.com/settings/keys",
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
  autoExpand = true,
}) => {
  const [showKey, setShowKey] = useState(false);
  /**
   * null means "follow the automatic rule below"; true or false is the reader's
   * own choice and outranks it.
   *
   * A plain boolean could not express this: on a step that needs a key, the
   * automatic rule forced the panel open, so pressing the header changed the
   * flag and nothing else — the panel could not be closed at all.
   */
  const [override, setOverride] = useState<boolean | null>(null);
  // Shared by the header strip and the Collapse button, so both announce
  // that they control the same region.
  const panelId = useId();

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

  // Volunteer the full setup when there is genuinely no key, or when one failed
  // and the person needs to reach the field to fix it. `autoExpand` lets the
  // caller suppress the first case while something more important owns the
  // screen; a failure still always opens, because that one needs acting on.
  const autoOpen = status === "failed" || (status === "empty" && autoExpand);
  const open = override ?? autoOpen;

  useEffect(() => {
    setOverride(null);
  }, [status]);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOverride(!open)}
        aria-controls={panelId}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 text-left"
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

        {(connected || !open) && (
          <span className="flex shrink-0 items-center gap-1 text-[15px] text-accent">
            {connected ? "Change" : "Connect"}
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        )}
      </button>

      {/* Animating to a fixed max-height needs a magic number that is wrong the
          moment the content changes; animating grid-template-rows from 0fr to
          1fr lets the browser interpolate to the content's own height. The
          inner wrapper owns the overflow clip, because the grid row is what
          shrinks and the child has to be cropped by it.

          The panel stays mounted when closed so a half-typed key survives a
          collapse, and `inert` keeps its fields out of the tab order and the
          accessibility tree while they are hidden. */}
      <div id={panelId} className="disclosure" data-open={open} inert={!open}>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-5 pt-5">
            {!connected && (
              <>
                <p className="measure text-[15px] leading-relaxed text-ink-soft">
                  Bring a key from any of these three. The provider and best available model are
                  worked out for you.
                </p>

                {/* One column per provider: the name, the shape its key takes,
                  and where to get one. The prefix is the load-bearing detail —
                  it is how you tell which provider a key already in your
                  clipboard belongs to. Hairline dividers come from a 1px grid
                  gap over a ruled background rather than per-cell borders, so
                  no edge doubles up where two cells meet. */}
                <ul className="grid gap-px overflow-hidden rounded-control border border-rule bg-rule sm:grid-cols-3">
                  {PROVIDERS.map((provider) => (
                    <li key={provider.name} className="flex flex-col gap-2 bg-ground p-4">
                      <p className="text-[15px] font-medium text-ink">{provider.name}</p>
                      <p className="font-mono text-sm text-ink-soft">{provider.prefix}</p>
                      <a
                        href={provider.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[15px] text-accent underline-offset-4 hover:underline"
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
              <div className="relative">
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

            {/* Closing row. The header strip already toggles the panel, but
                once it is open the header has scrolled away above the provider
                columns and the key field — so the way out is off-screen just
                when it is wanted. This puts it at the point the reader
                finishes. */}
            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-rule pt-4">
              {connected ? (
                <button
                  type="button"
                  onClick={() => onApiKeyChange("")}
                  className="text-[15px] text-ink-soft transition-colors hover:text-mark"
                >
                  Remove this key from the browser
                </button>
              ) : (
                // Keeps Collapse hard right whether or not its partner is there.
                <span aria-hidden="true" />
              )}

              <button
                type="button"
                onClick={() => setOverride(false)}
                aria-controls={panelId}
                aria-expanded={open}
                className="inline-flex items-center gap-1.5 text-[15px] text-ink-soft transition-colors hover:text-accent"
              >
                <ChevronUp className="h-4 w-4" />
                Collapse
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
