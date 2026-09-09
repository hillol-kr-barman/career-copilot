import React, { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  Circle,
  Square,
  PauseCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  X,
} from "lucide-react";
import type { CaptureStatus, Speaker } from "../types";
import type { LevelMeterHandle } from "../lib/levelMeter";
import { SpeakerBanner, SPEAKER_LABEL } from "./SpeakerBanner";

/** A soft, non-blocking notice — currently only the wake-lock-unavailable warning. */
export interface RecordingWarning {
  id: string;
  message: string;
  /** Present only for dismissible notices (e.g. the wake-lock warning). */
  onDismiss?: () => void;
}

/**
 * LIVE-05: a standing fact about recording, not a condition that has arisen
 * — rendered as a quiet persistent line during an active take, never folded
 * into the dismissible `warnings` array above. Names both consequences of
 * the same cause (an unfocused/hidden window) because they share one remedy:
 * a hidden tab drops the screen wake lock (D-14), and a window that has lost
 * OS focus stops delivering keyboard events at all, so the spacebar tag
 * track (D-23) goes silent too. The second half is a browser/OS boundary no
 * client code can work around (LIVE-27, 04-RESEARCH.md Pattern 5) — saying
 * it plainly, once, is the whole mitigation.
 */
export const TAB_FOCUS_ADVISORY =
  "Keep this tab visible and this window focused while recording. A hidden tab loses the screen wake lock, and an unfocused window won't receive spacebar presses — the speaker mark will be missed.";

const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/** The four stream-health states from the Copywriting Contract — icon + text always paired, never color alone. */
type ChipState = "healthy" | "missing" | "waiting" | "silent";

const CHIP_LABEL: Record<ChipState, string> = {
  healthy: "Receiving audio",
  missing: "No audio detected",
  silent: "Silent — check this",
  waiting: "Waiting for signal…",
};

const CHIP_CLASSES: Record<ChipState, string> = {
  healthy: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  missing: "text-red-500 bg-red-500/10 border-red-500/15",
  silent: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  waiting: "text-[#9aa3b0] bg-[#161a1e] border-[rgba(255,255,255,0.07)]",
};

const BAR_FILL: Record<ChipState, string> = {
  healthy: "bg-emerald-500",
  missing: "bg-red-500",
  silent: "bg-amber-500",
  waiting: "bg-[#6b7685]",
};

const CHIP_ICON: Record<ChipState, React.ComponentType<{ className?: string }>> = {
  healthy: CheckCircle2,
  missing: XCircle,
  silent: AlertTriangle,
  waiting: Loader2,
};

export interface RecordingControlsProps {
  status: CaptureStatus;
  micStream: MediaStream | null;
  elapsedMs: number;
  micMeterRef: React.RefObject<LevelMeterHandle | null>;
  /** Who the tag track currently attributes speech to — flips on a spacebar press or a click here. */
  speaker: Speaker;
  /** D-37's per-side pre-flight cleared flags — informs the readiness line above Begin; never blocks it. */
  preflightCleared: Record<Speaker, boolean>;
  onConnect: () => void;
  onBegin: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  /** Flips the current speaker — reachable by keyboard (Space) or by clicking/tapping this surface. */
  onFlipSpeaker: () => void;
  /** Receives focus once the consent gate resolves (plan 04-02's focus-management contract). */
  connectButtonRef?: React.RefObject<HTMLButtonElement | null>;
  /** Soft, non-blocking notices — currently only the wake-lock-unavailable warning. */
  warnings: RecordingWarning[];
}

/**
 * The capture state machine surface: connect/begin/pause/resume/stop CTAs,
 * the elapsed timer, the recording-state pill, the one live level-meter row,
 * and the current-speaker surface the spacebar flips. Presentational only —
 * it renders session state passed down from `LiveInterview`, it does not own
 * any of it. The level meter itself is created in `LiveInterview.tsx`; this
 * component only reads it every animation frame and draws the bar width.
 */
export const RecordingControls: React.FC<RecordingControlsProps> = ({
  status,
  micStream,
  elapsedMs,
  micMeterRef,
  speaker,
  preflightCleared,
  onConnect,
  onBegin,
  onPause,
  onResume,
  onStop,
  onFlipSpeaker,
  connectButtonRef,
  warnings,
}) => {
  const [micLevel, setMicLevel] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const streamReady = Boolean(micStream);

  useEffect(() => {
    if (!streamReady) {
      setMicLevel(null);
      return;
    }

    const tick = () => {
      setMicLevel(micMeterRef.current ? micMeterRef.current.read() : null);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [streamReady, micMeterRef]);

  const micTrackLive = micStream?.getAudioTracks()[0]?.readyState === "live";
  const micHasMeter = micMeterRef.current !== null;

  // A track's own readyState always wins over the meter — a stream can end
  // (device unplugged) after its AnalyserNode was already created, and a
  // meter reading a dead track's silence would otherwise stay "healthy"
  // forever instead of ever surfacing the ended state. Backstop: if
  // createLevelMeter returned null for the stream (T-04-13), the bar is
  // dropped and the chip falls back to the track's live/ended state instead
  // of RMS — a metering failure never blocks or misrepresents the recording.
  const micChipState: ChipState = !micTrackLive
    ? "missing"
    : !micHasMeter
      ? "healthy"
      : micLevel === null
        ? "waiting"
        : "healthy";

  // Only discrete health-state transitions are announced — never the
  // continuous level, which would be unusable noise announced every frame.
  const [announcement, setAnnouncement] = useState("");
  const prevMicStateRef = useRef<ChipState | null>(null);

  useEffect(() => {
    if (prevMicStateRef.current !== null && prevMicStateRef.current !== micChipState) {
      setAnnouncement(`Microphone: ${CHIP_LABEL[micChipState]}`);
    }
    prevMicStateRef.current = micChipState;
  }, [micChipState]);

  // The speaker banner's own discrete transitions route through this same
  // polite announcer rather than a second live region — only the change
  // itself is announced, never a continuous value.
  const prevSpeakerRef = useRef<Speaker | null>(null);

  useEffect(() => {
    if (prevSpeakerRef.current !== null && prevSpeakerRef.current !== speaker) {
      setAnnouncement(`Now speaking: ${SPEAKER_LABEL[speaker]}`);
    }
    prevSpeakerRef.current = speaker;
  }, [speaker]);

  const showMeter = streamReady && (status === "armed" || status === "recording" || status === "paused");

  // D-37: informs, never blocks — Begin stays enabled in every case below.
  // A warning about the room is not a permission.
  const preflightReadinessLine = preflightCleared.interviewer && preflightCleared.candidate
    ? "Pre-flight: both sides cleared."
    : preflightCleared.interviewer || preflightCleared.candidate
      ? `Pre-flight: ${preflightCleared.interviewer ? SPEAKER_LABEL.candidate : SPEAKER_LABEL.interviewer} hasn't cleared yet.`
      : "Pre-flight: not checked yet.";

  return (
    <div className="flex flex-col gap-4">
      {/* Discrete stream-health announcer — never wraps the level bar itself. */}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {warnings.length > 0 && (
        <div aria-live="polite" className="flex flex-col gap-2">
          {warnings.map((warning) => (
            <div
              key={warning.id}
              className="flex items-start gap-2.5 bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4"
            >
              <div className="p-1.5 rounded-[6px] shrink-0 border bg-amber-500/10 border-amber-500/20 text-amber-400">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <p className="text-xs text-[#9aa3b0] leading-relaxed flex-1">{warning.message}</p>
              {warning.onDismiss && (
                <button
                  type="button"
                  onClick={warning.onDismiss}
                  aria-label="Dismiss notice"
                  className="text-[#6b7685] hover:text-[#eef0f3] shrink-0 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {status === "idle" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-[#eef0f3]">No recording yet</h3>
          <p className="text-xs text-[#9aa3b0] leading-relaxed">
            Record both people in the room through one microphone. Nothing leaves this browser.
            Accept the notice below to begin.
          </p>
          <button
            ref={connectButtonRef}
            onClick={onConnect}
            className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50 mt-2"
          >
            <span>Connect microphone</span>
          </button>
        </div>
      )}

      {status === "connecting" && (
        <button
          disabled
          className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Connecting to microphone…</span>
        </button>
      )}

      {showMeter && <MeterRow state={micChipState} level={micLevel} hasMeter={micHasMeter} />}

      {status === "armed" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[#9aa3b0] text-center leading-relaxed">{preflightReadinessLine}</p>
          <button
            onClick={onBegin}
            className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50"
          >
            <Circle className="w-4 h-4" />
            <span>Begin recording</span>
          </button>
        </div>
      )}

      {(status === "recording" || status === "paused") && (
        <div className="flex flex-col items-center gap-4">
          {/* D-38: the band sits directly above the elapsed-timer block so
              the two largest elements on the page are together. Reachable
              by keyboard via Space (installed in LiveInterview.tsx) and by
              click/tap here for anyone not at the keyboard or using
              assistive technology. Disabled while paused — dimmed, not
              removed, so the operator can see who was marked when they
              paused. */}
          <SpeakerBanner
            speaker={speaker}
            onFlip={onFlipSpeaker}
            disabled={status !== "recording"}
          />

          {/* Quiet and persistent, not a warning: this is a standing fact
              about recording, never a dismissible notice about something
              that has already gone wrong (contrast the `warnings` block
              above, which only ever names conditions that have arisen). */}
          <p className="text-[11px] text-[#6b7685] text-center leading-relaxed -mt-1">{TAB_FOCUS_ADVISORY}</p>

          <div className="w-full bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2">
            <span className="text-4xl font-extrabold font-mono text-[#eef0f3] tracking-tight">
              {formatElapsed(elapsedMs)}
            </span>
            {status === "recording" ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-500">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Recording
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                <PauseCircle className="w-3.5 h-3.5" />
                Paused
              </span>
            )}
          </div>

          <div className="w-full grid grid-cols-2 gap-3">
            {status === "recording" ? (
              <button
                onClick={onPause}
                className="inline-flex items-center justify-center gap-2 bg-[#1c2128] hover:bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.07)] text-[#eef0f3] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all"
              >
                <PauseCircle className="w-4 h-4" />
                <span>Pause</span>
              </button>
            ) : (
              <button
                onClick={onResume}
                className="inline-flex items-center justify-center gap-2 bg-[#1c2128] hover:bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.07)] text-[#eef0f3] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all"
              >
                <Circle className="w-4 h-4" />
                <span>Resume</span>
              </button>
            )}
            <button
              onClick={onStop}
              className="inline-flex items-center justify-center gap-2 bg-red-500 hover:opacity-90 text-white font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all"
            >
              <Square className="w-4 h-4" />
              <span>Stop recording</span>
            </button>
          </div>
        </div>
      )}

      {status === "stopped" && (
        <div className="text-center py-1">
          <p className="text-sm font-semibold text-[#eef0f3]">
            Recording complete — {formatElapsed(elapsedMs)}
          </p>
        </div>
      )}
    </div>
  );
};

interface MeterRowProps {
  state: ChipState;
  level: number | null;
  hasMeter: boolean;
}

/** The one microphone row: status chip plus level bar, carrying both people's voices. */
const MeterRow: React.FC<MeterRowProps> = ({ state, level, hasMeter }) => {
  const Icon = CHIP_ICON[state];
  const pct = hasMeter && level !== null ? Math.round(level * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#6b7685]">
          ROOM MICROPHONE
        </span>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] border text-[10px] font-semibold shrink-0 ${CHIP_CLASSES[state]}`}
        >
          <Icon className={`w-3 h-3 ${state === "waiting" ? "animate-spin" : ""}`} />
          {CHIP_LABEL[state]}
        </span>
      </div>
      {hasMeter && (
        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Microphone audio level"
          className="w-full bg-[#161a1e] h-2 rounded-full overflow-hidden"
        >
          <div
            className={`h-full transition-all duration-150 rounded-full ${BAR_FILL[state]}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
};
