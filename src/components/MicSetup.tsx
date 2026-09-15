import React, { useEffect, useRef, useState } from "react";
import { Mic, CheckCircle2, SkipForward, RotateCcw, AlertTriangle, RefreshCw } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import { DEVICE_FALLBACK_NOTICE } from "../lib/audioCapture";
import type { AudioInputDevice } from "../lib/audioCapture";
import {
  evaluatePreflightSample,
  PREFLIGHT_FLOOR_RMS,
  PREFLIGHT_SUSTAIN_MS,
} from "../lib/levelMeter";
import type { LevelMeterHandle, PreflightSampleState } from "../lib/levelMeter";
import type { Speaker } from "../types";

/** The `<select>` value standing in for "no explicit device id" (system default). */
const SYSTEM_DEFAULT_VALUE = "__system_default__";

/** Interval the pre-flight samples the shared level meter at (D-37) — short
 * enough to feel live, unlike the half-second silence-watchdog cadence, and
 * passed into `evaluatePreflightSample` as the sample interval so the
 * sustained duration is measured rather than counted in ticks. */
const PREFLIGHT_SAMPLE_INTERVAL_MS = 50;

/** Interviewer first, matching D-25's opening-span default elsewhere in this tool. */
const SIDE_ORDER: Speaker[] = ["interviewer", "candidate"];

const SIDE_PROMPT: Record<Speaker, string> = {
  interviewer: "the interviewer",
  candidate: "the candidate",
};

const freshSampleState = (): PreflightSampleState => ({ peakLevel: 0, sustainedMs: 0, cleared: false });

/**
 * D-44's pre-flight model warm-up state, owned by `LiveInterview` for the
 * same reason `preflightCleared` is — this panel unmounts between takes, and
 * the parent is what needs to remember whether the model already loaded.
 * `device` is a display string, not a branching value: `05-07-ENGINE-FIX-SUMMARY.md`
 * fixed the worker to a single device (`"wasm"`), so this only ever reads
 * "CPU" today, but the field stays general rather than baking in a value that
 * would silently go stale if a future engine change widened it again.
 */
export interface ModelStatus {
  phase: "idle" | "loading" | "ready" | "failed";
  loadedBytes: number;
  totalBytes: number;
  device?: string;
  message?: string;
}

export interface MicSetupProps {
  /** Every audio-input device the browser currently reports (D-36) — empty until permission is granted. */
  devices: AudioInputDevice[];
  /** `undefined` means the system default and is never persisted (D-36). */
  selectedDeviceId: string | undefined;
  onSelectDevice: (deviceId: string | undefined) => void;
  /** True once the chosen device could not be honoured and the live stream fell back to the system default. */
  fellBackToDefault: boolean;
  /** Disabled whenever a recording is active — a change here must be impossible, not merely discouraged. */
  disabled: boolean;
  /** The section component's existing level-meter handle for the armed stream (T-04-14-05) — the pre-flight reads it and creates no analysis graph of its own. */
  micMeterRef: React.RefObject<LevelMeterHandle | null>;
  /** Per-side cleared flags, owned by the section component so they survive this panel unmounting between takes (D-37). */
  preflightCleared: Record<Speaker, boolean>;
  /** Called the moment a side's rolling sample first latches cleared. */
  onPreflightSideCleared: (side: Speaker) => void;
  /** Re-run control for the already-passed compact view: resets both flags and reopens the full step. */
  onPreflightReset: () => void;
  /** D-44's model warm-up state — loaded/loading/failed, owned by the section component. */
  modelStatus: ModelStatus;
  /** Retries the warm-up after a failed load. */
  onRetryModel: () => void;
}

/**
 * Hosts the D-36 input-device picker and the D-37 both-voices pre-flight —
 * one panel rather than two, since the pre-flight drives the same level
 * meter the picker's chosen device feeds. Wrapped in the existing
 * `CollapsibleSection` so a collapsed override still shows on the header via
 * `badge`.
 */
export const MicSetup: React.FC<MicSetupProps> = ({
  devices,
  selectedDeviceId,
  onSelectDevice,
  fellBackToDefault,
  disabled,
  micMeterRef,
  preflightCleared,
  onPreflightSideCleared,
  onPreflightReset,
  modelStatus,
  onRetryModel,
}) => {
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId);
  // Only an actual override is worth surfacing on the collapsed header — the
  // system default is the unmarked case and needs no badge.
  const deviceBadge = selectedDeviceId ? (selectedDevice?.label ?? null) : null;
  // The model badge does the same job the device-override badge already
  // does — a collapsed panel must still show a still-loading model, since
  // that is the one state on this panel with something actually happening
  // in the background.
  const modelBadge = modelStatus.phase === "loading" ? "Model loading" : null;
  const badge = [deviceBadge, modelBadge].filter((value): value is string => Boolean(value)).join(" · ") || null;

  const bothCleared = preflightCleared.interviewer && preflightCleared.candidate;

  // Local to this mount — resets whenever the panel unmounts and remounts
  // (a fresh Connect), which is exactly the "does the pre-flight repeat per
  // take" behaviour D-37 calls for. Only the two cleared flags above outlive
  // a remount, and those live in the section component.
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sideStates, setSideStates] = useState<Record<Speaker, PreflightSampleState>>({
    interviewer: freshSampleState(),
    candidate: freshSampleState(),
  });
  const [skipped, setSkipped] = useState(false);
  const notifiedRef = useRef<Record<Speaker, boolean>>({ interviewer: false, candidate: false });

  const activeSide = SIDE_ORDER[currentIndex];

  // The sampling loop: reads the shared meter on an interval, never on an
  // animation frame, and stops the instant recording starts, the operator
  // skips, or both sides are already cleared. Constructs nothing — no
  // recorder, no storage call, no second AudioContext (T-04-14-02, T-04-14-05).
  useEffect(() => {
    if (disabled || skipped || bothCleared) return;
    const id = window.setInterval(() => {
      const level = micMeterRef.current ? micMeterRef.current.read() : 0;
      setSideStates((prev) => ({
        ...prev,
        [activeSide]: evaluatePreflightSample(
          prev[activeSide],
          level,
          PREFLIGHT_SAMPLE_INTERVAL_MS,
          PREFLIGHT_FLOOR_RMS,
          PREFLIGHT_SUSTAIN_MS
        ),
      }));
    }, PREFLIGHT_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [disabled, skipped, bothCleared, activeSide, micMeterRef]);

  // Notifies the section component the instant either side's rolling state
  // first latches cleared — a plain effect rather than a call from inside
  // the setState updater above, so the parent update is never chained off a
  // functional-update body that React may invoke more than once.
  useEffect(() => {
    (Object.keys(sideStates) as Speaker[]).forEach((side) => {
      if (sideStates[side].cleared && !notifiedRef.current[side]) {
        notifiedRef.current[side] = true;
        onPreflightSideCleared(side);
      }
    });
  }, [sideStates, onPreflightSideCleared]);

  const handleRerun = () => {
    onPreflightReset();
    setCurrentIndex(0);
    setSideStates({ interviewer: freshSampleState(), candidate: freshSampleState() });
    notifiedRef.current = { interviewer: false, candidate: false };
    setSkipped(false);
  };

  return (
    <CollapsibleSection
      icon={<Mic className="w-3.5 h-3.5" />}
      title="Microphone setup"
      subtitle="Choose the input device and check both voices can be heard"
      badge={badge}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="mic-device-select"
            className="text-[10px] font-bold uppercase tracking-wider text-[#6b7685]"
          >
            Input device
          </label>
          <select
            id="mic-device-select"
            value={selectedDeviceId ?? SYSTEM_DEFAULT_VALUE}
            disabled={disabled}
            onChange={(e) =>
              onSelectDevice(e.target.value === SYSTEM_DEFAULT_VALUE ? undefined : e.target.value)
            }
            className="w-full bg-[#161a1e] border border-[rgba(255,255,255,0.07)] rounded-[6px] px-3 py-2.5 text-sm text-[#eef0f3] disabled:opacity-50"
          >
            <option value={SYSTEM_DEFAULT_VALUE}>System default</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[#6b7685] leading-relaxed">
            Place the device on the table between both people, angled toward whoever sits
            farther away — a laptop's built-in microphone array favors the person closest to it.
          </p>
          {fellBackToDefault && (
            <p className="text-xs text-amber-400 leading-relaxed">{DEVICE_FALLBACK_NOTICE}</p>
          )}
          {disabled && (
            <p className="text-xs text-[#6b7685] leading-relaxed">
              Locked while recording — stop to change the input device.
            </p>
          )}
        </div>

        <div className="border-t border-[rgba(255,255,255,0.07)] pt-4 flex flex-col gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#6b7685]">
            Both-voices check
          </span>

          {bothCleared ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Both sides cleared this session
              </span>
              <button
                type="button"
                onClick={handleRerun}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9aa3b0] hover:text-[#eef0f3] disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Run pre-flight again
              </button>
            </div>
          ) : skipped ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-[#6b7685] leading-relaxed">
                Skipped for now — a too-quiet side won't be caught until Phase 5.
              </p>
              <button
                type="button"
                onClick={() => setSkipped(false)}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9aa3b0] hover:text-[#eef0f3] disabled:opacity-50 shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Run pre-flight
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[#9aa3b0] leading-relaxed">
                Ask {SIDE_PROMPT[activeSide]} to say a sentence out loud.
              </p>

              {SIDE_ORDER.slice(0, currentIndex + 1).map((side) => (
                <PreflightSideRow key={side} side={side} state={sideStates[side]} isActive={side === activeSide} />
              ))}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                {currentIndex < SIDE_ORDER.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setCurrentIndex(currentIndex + 1)}
                    disabled={disabled}
                    className="text-xs font-semibold text-[#00d4dc] hover:opacity-80 disabled:opacity-50"
                  >
                    Continue: test {SIDE_PROMPT[SIDE_ORDER[currentIndex + 1]]} →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentIndex(0);
                      setSideStates({ interviewer: freshSampleState(), candidate: freshSampleState() });
                      notifiedRef.current = { interviewer: false, candidate: false };
                    }}
                    disabled={disabled}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9aa3b0] hover:text-[#eef0f3] disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Start over from the first side
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSkipped(true)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6b7685] hover:text-[#9aa3b0] disabled:opacity-50"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  Skip — a too-quiet side won't be caught until Phase 5
                </button>
              </div>

              {currentIndex === SIDE_ORDER.length - 1 && !bothCleared && (
                <p className="text-xs text-amber-400 leading-relaxed">
                  {!preflightCleared.interviewer && !preflightCleared.candidate
                    ? "Neither side has cleared yet — move the device closer to whoever is speaking, or choose a different microphone above."
                    : `${preflightCleared.interviewer ? "The candidate" : "The interviewer"} hasn't cleared yet — move the device toward that side, or choose a different microphone above.`}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[rgba(255,255,255,0.07)] pt-4 flex flex-col gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#6b7685]">
            Transcription model
          </span>
          <ModelStatusRow status={modelStatus} onRetry={onRetryModel} />
        </div>
      </div>
    </CollapsibleSection>
  );
};

interface ModelStatusRowProps {
  status: ModelStatus;
  onRetry: () => void;
}

/**
 * D-44's model-ready row: the pre-flight now doubles as the model warm-up,
 * so its state gets the same visibility as the both-voices check above it.
 * loading/ready/failed each get distinct copy — see the plan's own
 * requirement that Begin must never read as gated on this row, which is why
 * none of these three states renders a disabling control, only information
 * and (in the failed case) a retry.
 */
const ModelStatusRow: React.FC<ModelStatusRowProps> = ({ status, onRetry }) => {
  const pct = status.totalBytes > 0 ? Math.round((status.loadedBytes / status.totalBytes) * 100) : 0;
  // 05-07-ENGINE-FIX-SUMMARY.md: the worker only ever reports "wasm" — this
  // stays a general mapping rather than a hardcoded "CPU" string so a future,
  // re-measured device change doesn't need this file touched too.
  const deviceLabel = status.device === "wasm" ? "CPU" : status.device === "webgpu" ? "GPU" : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        {status.phase === "loading" && (
          <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin text-[#00d4dc]" />
        )}
        {status.phase === "ready" && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />}
        {status.phase === "failed" && <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />}
        <span
          className={
            status.phase === "ready"
              ? "text-emerald-500"
              : status.phase === "failed"
                ? "text-red-400"
                : "text-[#9aa3b0]"
          }
        >
          {status.phase === "loading" && `Downloading the transcription model — ${pct}%`}
          {status.phase === "ready" &&
            (deviceLabel
              ? `Transcription model loaded, running on this machine's ${deviceLabel}`
              : "Transcription model loaded")}
          {status.phase === "failed" && "Transcription model failed to load"}
          {status.phase === "idle" && "Preparing the transcription model…"}
        </span>
      </div>

      {status.phase === "loading" && (
        <>
          <div className="relative w-full bg-[#161a1e] h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#00d4dc] transition-all duration-150 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-[#6b7685] leading-relaxed">
            Recording can start before this finishes — spoken audio is held and transcribed as
            soon as the model is ready.
          </p>
        </>
      )}

      {status.phase === "failed" && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-[#6b7685] leading-relaxed">
            {status.message ?? "The transcription model could not be loaded."} The recording
            itself will still work and the audio will still be saved.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9aa3b0] hover:text-[#eef0f3] shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
};

interface PreflightSideRowProps {
  side: Speaker;
  state: PreflightSampleState;
  isActive: boolean;
}

/** One side's live level bar against the marked floor, plus its cleared/not-yet chip. */
const PreflightSideRow: React.FC<PreflightSideRowProps> = ({ side, state, isActive }) => {
  const pct = Math.round(Math.min(1, state.peakLevel) * 100);
  const floorPct = Math.round(PREFLIGHT_FLOOR_RMS * 100);
  const label = side === "interviewer" ? "Interviewer" : "Candidate";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${isActive ? "text-[#eef0f3]" : "text-[#6b7685]"}`}>
          {label}
        </span>
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
            state.cleared ? "text-emerald-500" : "text-[#6b7685]"
          }`}
        >
          {state.cleared ? (
            <>
              <CheckCircle2 className="w-3 h-3" /> Cleared
            </>
          ) : (
            "Not yet"
          )}
        </span>
      </div>
      <div className="relative w-full bg-[#161a1e] h-2 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-150 rounded-full ${
            state.cleared ? "bg-emerald-500" : "bg-[#00d4dc]"
          }`}
          style={{ width: `${pct}%` }}
        />
        {/* The audible floor, marked on the same bar the level fills — the pre-flight's whole point is showing this level clears it. */}
        <div className="absolute top-0 bottom-0 w-px bg-[#eef0f3]/40" style={{ left: `${floorPct}%` }} />
      </div>
    </div>
  );
};
