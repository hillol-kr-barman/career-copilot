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
} from "lucide-react";
import type { CaptureStatus, StreamRole } from "../types";
import type { LevelMeterHandle } from "../lib/levelMeter";

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
  tabStream: MediaStream | null;
  micRole: StreamRole;
  tabRole: StreamRole;
  elapsedMs: number;
  tabAudioMissing: boolean;
  acknowledgedSilentTab: boolean;
  micMeterRef: React.RefObject<LevelMeterHandle | null>;
  tabMeterRef: React.RefObject<LevelMeterHandle | null>;
  onConnect: () => void;
  onBegin: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReshare: () => void;
  onAcknowledgeSilentTab: () => void;
  /** Receives focus once the consent gate resolves (plan 04-02's focus-management contract). */
  connectButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

/**
 * The capture state machine surface: connect/begin/pause/resume/stop CTAs,
 * the elapsed timer, the recording-state pill, and the two live level-meter
 * rows. Presentational only — it renders session state passed down from
 * `LiveInterview`, it does not own any of it. The level meters themselves are
 * created in `LiveInterview.tsx`; this component only reads them every
 * animation frame and draws the bar width.
 */
export const RecordingControls: React.FC<RecordingControlsProps> = ({
  status,
  micStream,
  tabStream,
  micRole,
  tabRole,
  elapsedMs,
  tabAudioMissing,
  acknowledgedSilentTab,
  micMeterRef,
  tabMeterRef,
  onConnect,
  onBegin,
  onPause,
  onResume,
  onStop,
  onReshare,
  onAcknowledgeSilentTab,
  connectButtonRef,
}) => {
  const [micLevel, setMicLevel] = useState<number | null>(null);
  const [tabLevel, setTabLevel] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const streamsReady = Boolean(micStream && tabStream);

  useEffect(() => {
    if (!streamsReady) {
      setMicLevel(null);
      setTabLevel(null);
      return;
    }

    const tick = () => {
      setMicLevel(micMeterRef.current ? micMeterRef.current.read() : null);
      setTabLevel(tabMeterRef.current ? tabMeterRef.current.read() : null);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [streamsReady, micMeterRef, tabMeterRef]);

  const micTrackLive = micStream?.getAudioTracks()[0]?.readyState === "live";
  const tabTrackLive = tabStream?.getAudioTracks()[0]?.readyState === "live";
  const micHasMeter = micMeterRef.current !== null;
  const tabHasMeter = tabMeterRef.current !== null;

  // Backstop: if createLevelMeter returned null for a stream (T-04-13), the
  // bar is dropped and the chip falls back to the track's live/ended state
  // instead of RMS — a metering failure never blocks or misrepresents the
  // recording.
  const micChipState: ChipState = !micHasMeter
    ? micTrackLive
      ? "healthy"
      : "missing"
    : micLevel === null
      ? "waiting"
      : "healthy";

  const tabChipState: ChipState = tabAudioMissing
    ? "missing"
    : !tabHasMeter
      ? tabTrackLive
        ? "healthy"
        : "missing"
      : tabLevel === null
        ? "waiting"
        : "healthy";

  // Only discrete health-state transitions are announced — never the
  // continuous level, which would be unusable noise announced every frame.
  const [announcement, setAnnouncement] = useState("");
  const prevMicStateRef = useRef<ChipState | null>(null);
  const prevTabStateRef = useRef<ChipState | null>(null);

  useEffect(() => {
    if (prevMicStateRef.current !== null && prevMicStateRef.current !== micChipState) {
      setAnnouncement(`${micRole} microphone: ${CHIP_LABEL[micChipState]}`);
    }
    prevMicStateRef.current = micChipState;
  }, [micChipState, micRole]);

  useEffect(() => {
    if (prevTabStateRef.current !== null && prevTabStateRef.current !== tabChipState) {
      setAnnouncement(`${tabRole} tab audio: ${CHIP_LABEL[tabChipState]}`);
    }
    prevTabStateRef.current = tabChipState;
  }, [tabChipState, tabRole]);

  const showMeters =
    streamsReady && (status === "armed" || status === "recording" || status === "paused");

  return (
    <div className="flex flex-col gap-4">
      {/* Discrete stream-health announcer — never wraps the level bars themselves. */}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {status === "idle" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-[#eef0f3]">No recording yet</h3>
          <p className="text-xs text-[#9aa3b0] leading-relaxed">
            Record a remote interview as two clean audio tracks — one for you, one for the other
            side. Nothing leaves this browser. Accept the notice below to begin.
          </p>
          <button
            ref={connectButtonRef}
            onClick={onConnect}
            className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50 mt-2"
          >
            <span>Connect microphone &amp; screen</span>
          </button>
        </div>
      )}

      {status === "connecting" && (
        <button
          disabled
          className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Connecting to microphone and screen…</span>
        </button>
      )}

      {showMeters && (
        <div className="flex flex-col gap-4">
          <MeterRow
            roleLabel={micRole}
            source="MIC"
            state={micChipState}
            level={micLevel}
            hasMeter={micHasMeter}
          />
          <MeterRow
            roleLabel={tabRole}
            source="TAB AUDIO"
            state={tabChipState}
            level={tabLevel}
            hasMeter={tabHasMeter}
          />
        </div>
      )}

      {status === "armed" && (
        <div className="flex flex-col gap-3">
          {tabAudioMissing && !acknowledgedSilentTab && (
            <div className="w-full flex items-start gap-2.5 text-xs text-red-500 bg-red-500/10 border border-red-500/15 rounded-[6px] px-4 py-4">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-3 flex-1">
                <span>
                  You shared without ticking 'Share tab audio' — the interviewer's side won't be
                  recorded. Click 'Share again' and make sure the audio checkbox is ticked before
                  you confirm.
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={onReshare}
                    className="px-3 py-1.5 rounded-[5px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] text-xs font-semibold transition-all active:scale-95"
                  >
                    Share again
                  </button>
                  <button
                    onClick={onAcknowledgeSilentTab}
                    className="px-3 py-1.5 rounded-[5px] border border-[rgba(255,255,255,0.07)] bg-transparent text-[#9aa3b0] hover:text-[#eef0f3] text-xs font-medium transition-all active:scale-95"
                  >
                    Record anyway (interviewer audio will be silent)
                  </button>
                </div>
              </div>
            </div>
          )}
          <button
            onClick={onBegin}
            disabled={tabAudioMissing && !acknowledgedSilentTab}
            className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50"
          >
            <Circle className="w-4 h-4" />
            <span>Begin recording</span>
          </button>
        </div>
      )}

      {(status === "recording" || status === "paused") && (
        <div className="flex flex-col items-center gap-4">
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
  roleLabel: StreamRole;
  source: "MIC" | "TAB AUDIO";
  state: ChipState;
  level: number | null;
  hasMeter: boolean;
}

/** One stream row: role chip, status chip, level bar — the three always shown together. */
const MeterRow: React.FC<MeterRowProps> = ({ roleLabel, source, state, level, hasMeter }) => {
  const Icon = CHIP_ICON[state];
  const pct = hasMeter && level !== null ? Math.round(level * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#6b7685]">
          {roleLabel.toUpperCase()} · {source}
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
          aria-label={`${roleLabel} audio level`}
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
