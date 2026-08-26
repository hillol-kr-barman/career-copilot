import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/**
 * Multi-provider AI layer.
 *
 * The platform never hardcodes a model. It identifies the provider from the
 * shape of the user's API key, asks that provider which models the key can
 * actually reach, and picks the best fast one. That means a model being
 * retired or restricted can't break the app the way a hardcoded ID can.
 */

export type ProviderId = "google" | "openai" | "anthropic";

export interface ProviderInfo {
  provider: ProviderId;
  providerLabel: string;
  /** The chosen model — the highest-ranked one the key can reach. */
  model: string;
  /**
   * Next-best models on the same key, in rank order. Used to route around a
   * model that is temporarily overloaded rather than failing the request.
   */
  alternates: string[];
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
};

export function providerLabel(provider: ProviderId): string {
  return PROVIDER_LABELS[provider];
}

/**
 * Identify the provider from the key's prefix.
 *
 * Order matters: Anthropic keys begin `sk-ant-`, which also matches OpenAI's
 * broader `sk-` prefix, so Anthropic must be tested first.
 */
export function detectProvider(apiKey: string): ProviderId | null {
  const key = apiKey.trim();
  if (!key) return null;
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("AIza")) return "google";
  if (key.startsWith("sk-")) return "openai";
  return null;
}

function authError(message: string): Error {
  const err: any = new Error(message);
  err.statusCode = 401;
  return err;
}

// ── Model discovery ────────────────────────────────────────────────────────

/**
 * Read the family version out of a model id.
 *
 * This deliberately anchors on the family prefix and takes only the first one
 * or two number groups. Taking the largest number in the string instead is
 * wrong: "gemini-2.5-computer-use-preview-10-2025" would read as version 2025
 * and outrank every real model.
 *
 *   gemini-3.6-flash                 -> 3.6
 *   gemini-2.5-computer-use-…-2025   -> 2.5
 *   gpt-4.1-mini                     -> 4.1
 *   claude-opus-4-8                  -> 4.8
 *   claude-sonnet-5                  -> 5
 */
function familyVersion(id: string, pattern: RegExp): number {
  const m = id.match(pattern);
  if (!m) return 0;
  const major = Number(m[1]);
  if (!Number.isFinite(major)) return 0;
  const minor = m[2] !== undefined ? Number(m[2]) : 0;
  // Defensive clamp: a "minor" above 99 is not a version, it's a date or a
  // parameter count that leaked through the pattern. Fall back to the major
  // rather than letting it dwarf every other score.
  if (!Number.isFinite(minor) || minor > 99) return major;
  return major + minor / 10;
}

/**
 * Stable releases beat previews at the same version, but a newer preview still
 * beats an older stable — the penalty is smaller than one version step (10).
 */
function stabilityBonus(id: string): number {
  return /preview|-exp|experimental|-rc\d|beta|alpha/i.test(id) ? -8 : 0;
}

/**
 * Tier weights sit *below* one version step (10) on purpose.
 *
 * A tier gap wider than a version step inverts the ranking: with flash=30 and
 * pro=15, `gemini-1.5-flash` outranked `gemini-2.5-pro`, so any Flash beat any
 * Pro up to two generations newer — including when that Pro was the only
 * capable model on the key. Version is the dominant signal; tier only breaks
 * ties within a generation.
 */
const TIER_FAST = 6;
const TIER_STANDARD = 3;
const TIER_WEAK = 1;

/**
 * A dated snapshot ranks below its floating alias, but this is only a tiebreak
 * — it must stay below the tier gap so it can't reorder tiers.
 */
const DATED_PENALTY = -1;

/**
 * Rolling aliases (`gemini-flash-latest`) carry no version digits, so they
 * scored 0 and ranked last — the exact opposite of what this module is for.
 * They always resolve to the current stable release of their variant, which is
 * the most retirement-proof choice a key can make, so they get a synthetic
 * version above any concrete one.
 */
const LATEST_ALIAS_VERSION = 90;

async function listGoogleModels(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`,
    { signal: AbortSignal.timeout(20000) }
  );

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw authError("That Google API key was rejected. Check it and try again.");
  }
  if (!res.ok) throw new Error(`Google model list failed (HTTP ${res.status}).`);

  const data = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };

  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean);
}

function scoreGoogle(id: string): number {
  if (!/^gemini/i.test(id)) return -Infinity;

  // Specialised variants share the `gemini-` prefix but can't do this job.
  if (
    /embedding|aqa|imagen|veo|tts|audio|image|vision|computer-use|robotics|thinking-exp|learnlm/i.test(
      id
    )
  ) {
    return -Infinity;
  }

  // General-purpose text models are `gemini-<ver>-flash|pro`, or a bare
  // `gemini-<ver>`. Anything else with the prefix is a specialised variant we
  // haven't named above — skip it rather than risk picking it.
  const isGeneralPurpose = /-(flash|pro)\b/i.test(id) || /^gemini-\d+(\.\d+)?$/i.test(id);
  if (!isGeneralPurpose) return -Infinity;

  // Flash is the fast tier; lite is faster but noticeably weaker for this work.
  const tier = /flash-lite/i.test(id) ? TIER_WEAK : /flash/i.test(id) ? TIER_FAST : TIER_STANDARD;

  // `gemini-flash-latest` / `gemini-pro-latest` have no version digits.
  const version = /-latest$/i.test(id)
    ? LATEST_ALIAS_VERSION
    : familyVersion(id, /gemini-(\d+)(?:\.(\d+))?/i);

  return version * 10 + tier + stabilityBonus(id);
}

async function listOpenAIModels(apiKey: string): Promise<string[]> {
  const client = new OpenAI({ apiKey, timeout: 20000 });
  try {
    const page = await client.models.list();
    return page.data.map((m) => m.id);
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      throw authError("That OpenAI API key was rejected. Check it and try again.");
    }
    throw err;
  }
}

function scoreOpenAI(id: string): number {
  if (/embedding|whisper|tts|dall-e|moderation|audio|realtime|image|transcribe|search|davinci|babbage|guardrail/i.test(id)) {
    return -Infinity;
  }
  if (!/^(gpt|o\d|chatgpt)/i.test(id)) return -Infinity;
  // Dated snapshots (gpt-4o-2024-08-06) rank below their floating alias.
  const dated = /-\d{4}-\d{2}-\d{2}$/.test(id) ? DATED_PENALTY : 0;
  // Nano is materially weaker than mini, so they no longer share a tier.
  const tier = /nano/i.test(id) ? TIER_WEAK : /mini/i.test(id) ? TIER_FAST : TIER_STANDARD;

  const version = /-latest$/i.test(id)
    ? LATEST_ALIAS_VERSION
    : familyVersion(id, /(?:gpt|o)-?(\d+)(?:\.(\d+))?/i);

  return version * 10 + tier + dated + stabilityBonus(id);
}

async function listAnthropicModels(apiKey: string): Promise<string[]> {
  const client = new Anthropic({ apiKey, timeout: 20000 });
  try {
    const page = await client.models.list();
    return page.data.map((m) => m.id);
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      throw authError("That Anthropic API key was rejected. Check it and try again.");
    }
    throw err;
  }
}

function scoreAnthropic(id: string): number {
  if (!/^claude/i.test(id)) return -Infinity;
  // Sonnet is the quality/speed sweet spot for this workload; Haiku is the
  // cheap fallback; Opus is reserved for when it's all the key can reach.
  const tier = /sonnet/i.test(id) ? TIER_FAST : /haiku/i.test(id) ? TIER_STANDARD : TIER_WEAK;
  const isDated = /-\d{8}$/.test(id);

  // Strip the release date before reading the version. Anthropic ids are shaped
  // `claude-<tier>-<major>-<date>`, and the minor-version group accepts `-` as a
  // separator, so the 8-digit date was captured as the minor version:
  // `claude-sonnet-4-20250514` read as version 2025055.4 and outranked every
  // genuinely newer model. The `(?![\d])` guard is a second line of defence for
  // any dated shape this strip doesn't catch.
  const undated = isDated ? id.replace(/-\d{8}$/, "") : id;
  const version = familyVersion(undated, /claude-(?:[a-z]+-)*?(\d+)(?:[-.](\d{1,2}))?(?![\d])/i);

  return version * 10 + tier + (isDated ? DATED_PENALTY : 0) + stabilityBonus(id);
}

const SCORERS: Record<ProviderId, (id: string) => number> = {
  google: scoreGoogle,
  openai: scoreOpenAI,
  anthropic: scoreAnthropic,
};

const LISTERS: Record<ProviderId, (apiKey: string) => Promise<string[]>> = {
  google: listGoogleModels,
  openai: listOpenAIModels,
  anthropic: listAnthropicModels,
};

// ── Resolution + cache ─────────────────────────────────────────────────────

interface CacheEntry {
  info: ProviderInfo;
  expiresAt: number;
}

const RESOLUTION_TTL_MS = 10 * 60 * 1000;
const resolutionCache = new Map<string, CacheEntry>();

function cacheKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Detect the provider and choose a model, hitting the provider's list-models
 * endpoint. Cached per key for 10 minutes so ordinary requests don't pay for
 * a discovery round trip every time.
 */
export async function resolveProvider(apiKey?: string): Promise<ProviderInfo> {
  const key = apiKey?.trim();
  if (!key) {
    throw authError("No API key provided. Add your own key to power this tool.");
  }

  const cached = resolutionCache.get(cacheKey(key));
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  const detected = detectProvider(key);

  /**
   * Prefix matching is only a fast path — key formats change, and a key that
   * matches nothing known is not necessarily invalid. When the prefix is
   * recognised we ask that provider and no other, so a well-formed key is
   * never sent anywhere it doesn't belong. Only an unrecognised key is probed
   * against each provider in turn, stopping at the first one that accepts it.
   */
  const candidates: ProviderId[] = detected
    ? [detected]
    : ["google", "openai", "anthropic"];

  let lastError: any = null;

  for (const provider of candidates) {
    let ids: string[];
    try {
      ids = await LISTERS[provider](key);
    } catch (err: any) {
      lastError = err;
      continue; // Wrong provider (or a bad key) — try the next candidate.
    }

    const score = SCORERS[provider];
    const ranked = ids
      .map((id) => ({ id, score: score(id) }))
      .filter((m) => m.score > -Infinity)
      // Ties must not be broken by the provider's list order, or the pick
      // silently flips between equal-scoring models (gpt-5-mini / gpt-5-nano)
      // depending on how the API happened to order its response. Shorter id
      // first: the base model rather than a longer specialised variant.
      .sort(
        (a, b) =>
          b.score - a.score || a.id.length - b.id.length || a.id.localeCompare(b.id)
      );

    if (ranked.length === 0) {
      lastError = authError(
        `That ${PROVIDER_LABELS[provider]} key works, but it can't reach any text model this tool can use.`
      );
      continue;
    }

    const info: ProviderInfo = {
      provider,
      providerLabel: PROVIDER_LABELS[provider],
      model: ranked[0].id,
      alternates: ranked.slice(1, 4).map((m) => m.id),
    };

    resolutionCache.set(cacheKey(key), { info, expiresAt: Date.now() + RESOLUTION_TTL_MS });
    return info;
  }

  if (detected) throw lastError ?? authError("That API key was rejected.");

  throw authError(
    "That key wasn't accepted by Google, OpenAI, or Anthropic. Check that you copied all of it, and that it's an API key rather than a project or client ID."
  );
}

// ── Generation ─────────────────────────────────────────────────────────────

export interface GenerateOptions {
  apiKey: string;
  system: string;
  prompt: string;
  /** JSON Schema. When present, the provider is asked for structured output. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  provider: ProviderId;
  model: string;
}

/**
 * Google's schema dialect rejects keys it doesn't know, including the
 * `additionalProperties` that OpenAI strict mode and Anthropic both require.
 * Strip them for Google only.
 */
function stripForGoogle(schema: any): any {
  if (Array.isArray(schema)) return schema.map(stripForGoogle);
  if (schema && typeof schema === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === "additionalProperties") continue;
      out[k] = stripForGoogle(v);
    }
    return out;
  }
  return schema;
}

async function generateGoogle(opts: GenerateOptions, model: string): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey: opts.apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });

  const response = await ai.models.generateContent({
    model,
    contents: opts.prompt,
    config: {
      systemInstruction: opts.system,
      temperature: 0.2,
      ...(opts.schema
        ? {
            responseMimeType: "application/json",
            responseSchema: stripForGoogle(opts.schema),
          }
        : {}),
    },
  });

  return response.text ?? "";
}

async function generateOpenAI(opts: GenerateOptions, model: string): Promise<string> {
  const client = new OpenAI({ apiKey: opts.apiKey, timeout: 120000 });

  // Temperature is deliberately omitted: current reasoning models reject any
  // non-default value, and the failure is a hard 400 rather than a warning.
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
    ...(opts.schema
      ? {
          response_format: {
            type: "json_schema" as const,
            json_schema: { name: "result", schema: opts.schema, strict: true },
          },
        }
      : {}),
  });

  return response.choices[0]?.message?.content ?? "";
}

async function generateAnthropic(opts: GenerateOptions, model: string): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 120000 });

  // No `temperature`: it was removed on current Claude models and sending it
  // returns a 400. Steering happens through the system prompt instead.
  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    ...(opts.schema
      ? { output_config: { format: { type: "json_schema" as const, schema: opts.schema } } }
      : {}),
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The model declined this request. Try rephrasing the job description or resume."
    );
  }

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Turn a provider error into something a candidate can read.
 *
 * SDK error messages are often a raw JSON envelope — Google's, for example, is
 * the literal string `{"error":{"code":503,"message":"...","status":"..."}}`.
 * Dumping that into the UI is not an error message, it's a stack trace.
 */
function describeProviderError(err: any, providerName: string): { message: string; status: number } {
  const raw = typeof err?.message === "string" ? err.message : "";

  // Pull the human sentence out of a JSON envelope if there is one.
  let inner = raw;
  let code: number | undefined = err?.status ?? err?.statusCode;
  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      const e = parsed?.error ?? parsed;
      if (typeof e?.message === "string") inner = e.message;
      if (typeof e?.code === "number") code = e.code;
    } catch {
      /* not JSON after all — keep the raw text */
    }
  }

  const blob = `${inner} ${raw}`.toLowerCase();

  if (code === 503 || /unavailable|overloaded|high demand/.test(blob)) {
    return {
      status: 503,
      message: `${providerName} is busy right now and every model your key can reach is returning "high demand". This is temporary — wait a moment and try again.`,
    };
  }
  if (code === 429 || /rate limit|quota|resource_exhausted/.test(blob)) {
    return {
      status: 429,
      message: `Your ${providerName} key has hit its rate limit or quota. Wait a minute, or check your usage limits in the provider console.`,
    };
  }
  if (code === 401 || code === 403) {
    return {
      status: 401,
      message: `${providerName} rejected your API key. Check that it's still valid and has access to text models.`,
    };
  }

  return { status: 502, message: inner || `${providerName} returned an unexpected error.` };
}

/** Errors worth retrying on a different model — the model is busy, not broken. */
function isTransient(err: any): boolean {
  const code = err?.status ?? err?.statusCode;
  const blob = `${err?.message ?? ""}`.toLowerCase();
  return (
    code === 503 ||
    code === 429 ||
    code === 500 ||
    /unavailable|overloaded|high demand|internal error|try again/.test(blob)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a prompt against whichever provider the user's key belongs to.
 *
 * A newly released model can be heavily loaded and answer 503 while older
 * models on the same key are fine, so a transient failure falls through to the
 * next-best model rather than failing the user's request.
 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const { provider, providerLabel: label, model, alternates } = await resolveProvider(opts.apiKey);

  const run = (m: string) =>
    provider === "google"
      ? generateGoogle(opts, m)
      : provider === "openai"
        ? generateOpenAI(opts, m)
        : generateAnthropic(opts, m);

  const chain = [model, ...alternates];
  let lastError: any = null;

  for (let i = 0; i < chain.length; i++) {
    try {
      const text = await run(chain[i]);
      return { text, provider, model: chain[i] };
    } catch (err: any) {
      lastError = err;
      if (!isTransient(err)) break; // A real failure — don't burn the user's quota retrying.
      console.log(`[ai] ${chain[i]} unavailable, trying next model…`);
      await sleep(400);
    }
  }

  const { message, status } = describeProviderError(lastError, label);
  const wrapped: any = new Error(message);
  wrapped.statusCode = status;
  throw wrapped;
}

/** Same as `generate`, but parses the response as JSON against `schema`. */
export async function generateJSON<T>(
  opts: GenerateOptions & { schema: Record<string, unknown> }
): Promise<{ data: T; provider: ProviderId; model: string }> {
  const { text, provider, model } = await generate(opts);

  // Some providers wrap JSON in a ```json fence even when asked not to.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");

  try {
    return { data: JSON.parse(cleaned) as T, provider, model };
  } catch {
    const err: any = new Error(
      "The model returned malformed data. Try again — if it keeps happening, your key may be routed to a model that can't produce structured output."
    );
    err.statusCode = 502;
    throw err;
  }
}
