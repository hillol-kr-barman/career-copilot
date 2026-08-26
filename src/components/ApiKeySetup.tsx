import React, { useState } from "react";
import {
  KeyRound,
  Eye,
  EyeOff,
  ExternalLink,
  CheckCircle2,
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
    linkText: "aistudio.google.com",
    note: "Generous free tier — the easiest place to start.",
  },
  {
    name: "OpenAI",
    prefix: "sk-…",
    href: "https://platform.openai.com/api-keys",
    linkText: "platform.openai.com",
    note: "Pay-as-you-go; requires billing set up.",
  },
  {
    name: "Anthropic Claude",
    prefix: "sk-ant-…",
    href: "https://console.anthropic.com/settings/keys",
    linkText: "console.anthropic.com",
    note: "Pay-as-you-go; strong at long-form writing.",
  },
];

/**
 * Bring-your-own-key setup.
 *
 * There is no model picker by design: the engine is identified from the key's
 * format and the specific model is discovered from that provider's API, so the
 * user pastes one key and nothing else.
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
  const open = expanded || !connected;

  const statusLine = isVerifying
    ? "Checking your key and finding the best available model…"
    : providerInfo
      ? `Connected to ${providerInfo.providerLabel} · ${providerInfo.model} · your key, your quota`
      : "Paste a key from Google, OpenAI, or Anthropic — the platform works out the rest.";

  return (
    <section
      id="api-key-setup"
      className={`w-full rounded-[10px] border p-5 md:p-6 flex flex-col gap-5 transition-all duration-500 ${
        connected
          ? "bg-[#161a1e] border-[rgba(255,255,255,0.07)]"
          : "bg-[#161a1e] border-[rgba(0,212,220,0.25)]"
      }`}
    >
      <button
        type="button"
        onClick={() => connected && setExpanded(!expanded)}
        className={`flex items-center gap-4 text-left w-full ${connected ? "cursor-pointer" : "cursor-default"}`}
      >
        <div
          className={`p-3 rounded-[8px] shrink-0 border ${
            connected
              ? "bg-[rgba(16,185,129,0.08)] border-[rgba(16,185,129,0.25)] text-emerald-500"
              : "bg-[rgba(0,212,220,0.08)] border-[rgba(0,212,220,0.25)] text-[#00d4dc]"
          }`}
        >
          {isVerifying ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : connected ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <KeyRound className="w-5 h-5" />
          )}
        </div>

        <div className="flex-1">
          <h2 className="text-sm font-semibold text-[#eef0f3] tracking-tight flex items-center gap-2">
            {connected ? "Your AI is connected" : "Connect your own AI to get started"}
            <span
              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-[4px] uppercase tracking-wider ${
                connected
                  ? "bg-[rgba(16,185,129,0.12)] text-emerald-500"
                  : "bg-[rgba(0,212,220,0.12)] text-[#00d4dc]"
              }`}
            >
              {connected ? "Ready" : "Required"}
            </span>
          </h2>
          <p className="text-xs text-[#6b7685] mt-0.5">{statusLine}</p>
        </div>

        {connected && (
          <ChevronDown
            className={`w-4 h-4 text-[#6b7685] shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-5 border-t border-[rgba(255,255,255,0.07)] pt-5">
          {!connected && (
            <>
              <p className="text-xs text-[#9aa3b0] leading-relaxed">
                This platform already knows how to audit resumes and coach interviews — it just
                needs an AI to think with. Bring a key from any of these three and it will detect
                which one you used and pick the best model your key can reach. You are never asked
                to choose a model.
              </p>

              <ul className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {PROVIDERS.map((p) => (
                  <li
                    key={p.name}
                    className="flex flex-col gap-2 bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-semibold text-[#eef0f3]">{p.name}</p>
                      <span className="text-[10px] font-mono text-[#6b7685]">{p.prefix}</span>
                    </div>
                    <p className="text-[11px] text-[#6b7685] leading-relaxed">{p.note}</p>
                    <a
                      href={p.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#00d4dc] hover:underline mt-auto pt-1"
                    >
                      Create a key
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="api_key_input"
              className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7685]"
            >
              Your API key
            </label>
            <div className="relative">
              <input
                id="api_key_input"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder="AIza… / sk-… / sk-ant-…"
                spellCheck={false}
                autoComplete="off"
                className="w-full p-2.5 pr-10 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs font-mono text-[#eef0f3] focus:outline-none focus:ring-1 focus:ring-[#00d4dc] focus:border-[#00d4dc] placeholder:text-[#6b7685]"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6b7685] hover:text-[#9aa3b0] transition-colors"
                title={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-[#6b7685] leading-relaxed">
              Saved in this browser only. Sent to this app's server solely to make each AI call on
              your behalf — never logged or stored there.
            </p>
          </div>

          {verifyError && (
            <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-start gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{verifyError}</span>
            </div>
          )}

          {connected && (
            <button
              type="button"
              onClick={() => onApiKeyChange("")}
              className="self-start text-[11px] font-semibold text-[#6b7685] hover:text-red-400 transition-colors"
            >
              Remove key from this browser
            </button>
          )}
        </div>
      )}
    </section>
  );
};
