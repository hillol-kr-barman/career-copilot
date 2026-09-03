import React, { useEffect, useRef, useState } from "react";
import { RefreshCw, AlertTriangle, Circle, Square, Download, Headphones } from "lucide-react";
import { ToolSection } from "../components/ToolSection";
import { ConsentGate } from "../components/ConsentGate";
import { RoleToggle } from "../components/RoleToggle";
import {
  acquireMic,
  acquireTabAudio,
  stopStream,
  isTabAudioLikelySupported,
  describeCaptureError,
  TAB_AUDIO_UNSUPPORTED_REASON,
  UNSUPPORTED_FORMAT_REASON,
} from "../lib/audioCapture";
import { pickSupportedMimeType, resolveStreamRoles, startRecorderPair } from "../lib/recorderPair";
import type { RecorderPairHandle } from "../lib/recorderPair";
import {
  openRecordingDB,
  createSession,
  appendChunk,
  markSessionStopped,
  assembleBlob,
} from "../lib/recordingStore";
import { downloadBlob } from "../lib/download";
import type { CaptureStatus, RecordingSession, StreamRole, UserRole } from "../types";

/**
 * Session-scoped only (D-09) — one checkbox, once per browser session, not
 * once forever; this key is never written to any storage that outlives the
 * tab. A blocked `sessionStorage` (private browsing) degrades to false,
 * which simply re-asks; that is the correct conservative behaviour, not an
 * error state.
 */
const CONSENT_SESSION_KEY = "live_interview_consent_given";

const readStoredConsent = (): boolean => {
  try {
    return sessionStorage.getItem(CONSENT_SESSION_KEY) === "1";
  } catch {
    return false;
  }
};

const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/**
 * Tool 4 — records a remote interview as two independent, never-mixed audio
 * streams (D-02), persists every chunk to IndexedDB as it arrives (D-13),
 * and hands the visitor two downloadable files (D-19). Audio never leaves
 * this browser: nothing this section touches makes a network call.
 */
export const LiveInterview: React.FC = () => {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [tabStream, setTabStream] = useState<MediaStream | null>(null);
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");
  const [tabAudioMissing, setTabAudioMissing] = useState(false);
  const [acknowledgedSilentTab, setAcknowledgedSilentTab] = useState(false);
  const [formatUnsupported, setFormatUnsupported] = useState(false);
  const [hasConsented, setHasConsented] = useState(readStoredConsent);
  const [role, setRole] = useState<UserRole>("candidate");

  // UA-family capability gate (D-01, D-05) — computed once, it does not
  // change over the component's lifetime.
  const [tabAudioSupported] = useState(() => isTabAudioLikelySupported());

  // This chain gates on browser capability only, never on resume, job
  // description or API key — Tool 4 needs no key at all.
  const lockedReason = !tabAudioSupported
    ? TAB_AUDIO_UNSUPPORTED_REASON
    : formatUnsupported
      ? UNSUPPORTED_FORMAT_REASON
      : null;

  const dbRef = useRef<IDBDatabase | null>(null);
  const recorderHandleRef = useRef<RecorderPairHandle | null>(null);
  const liveStreamsRef = useRef<{ mic: MediaStream | null; tab: MediaStream | null }>({
    mic: null,
    tab: null,
  });
  const cancelledRef = useRef(false);
  const connectButtonRef = useRef<HTMLButtonElement | null>(null);

  liveStreamsRef.current = { mic: micStream, tab: tabStream };

  // Consent resolving unmounts the gate's own "Continue" button — focus
  // would otherwise be stranded on a node that no longer exists. Move it to
  // the CTA that takes its place, once that CTA exists to receive it.
  useEffect(() => {
    if (hasConsented) connectButtonRef.current?.focus();
  }, [hasConsented]);

  // StrictMode-safe teardown: acquisition happens behind a button click
  // rather than on mount, but if the section unmounts while a capture is
  // live, every track on both streams must still be stopped so the
  // browser's recording indicator goes dark (Pattern 8).
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      stopStream(liveStreamsRef.current.mic);
      stopStream(liveStreamsRef.current.tab);
      recorderHandleRef.current?.stopAll().catch(() => {});
    };
  }, []);

  // A wall-clock timer independent of chunk delivery — dataavailable/
  // timeslice timing is not exact enough to double as an elapsed clock.
  useEffect(() => {
    if (status !== "recording" || !session) return;
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - session.clockOrigin);
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, session]);

  const handleAcceptConsent = () => {
    try {
      sessionStorage.setItem(CONSENT_SESSION_KEY, "1");
    } catch {
      // Private-mode/blocked sessionStorage: consent still applies for the
      // rest of this render, it just won't survive a reload — re-asking is
      // the correct conservative fallback (see readStoredConsent above).
    }
    setHasConsented(true);
  };

  const handleConnect = async () => {
    setError("");
    setTabAudioMissing(false);
    setAcknowledgedSilentTab(false);
    setStatus("connecting");

    let mic: MediaStream | null = null;
    try {
      mic = await acquireMic();
    } catch (err) {
      setStatus("idle");
      setError(describeCaptureError(err, "mic"));
      return;
    }

    let tab: MediaStream | null = null;
    try {
      const tabResult = await acquireTabAudio();
      tab = tabResult.stream;

      if (cancelledRef.current) {
        stopStream(mic);
        stopStream(tab);
        return;
      }

      setMicStream(mic);
      setTabStream(tab);
      setTabAudioMissing(!tabResult.hasAudio);
      setStatus("armed");
    } catch (err) {
      stopStream(mic);
      stopStream(tab);
      setStatus("idle");
      setError(describeCaptureError(err, "display"));
    }
  };

  /**
   * Re-invoked from the tab-audio-missing banner: releases the previous,
   * silent tab stream and requests a fresh share, re-running the same
   * `getAudioTracks()` check (Pitfall 2 — the picker resolving is not proof
   * the audio checkbox was ticked).
   */
  const handleShareAgain = async () => {
    setError("");
    try {
      const tabResult = await acquireTabAudio();

      if (cancelledRef.current) {
        stopStream(tabResult.stream);
        return;
      }

      stopStream(tabStream);
      setTabStream(tabResult.stream);
      setTabAudioMissing(!tabResult.hasAudio);
      if (tabResult.hasAudio) setAcknowledgedSilentTab(false);
    } catch (err) {
      setError(describeCaptureError(err, "display"));
    }
  };

  const handleBegin = async () => {
    if (!micStream || !tabStream) return;
    setError("");

    let mimeType: string;
    try {
      mimeType = pickSupportedMimeType();
    } catch (err) {
      setFormatUnsupported(true);
      setError(describeCaptureError(err, "display"));
      return;
    }

    try {
      const db = await openRecordingDB();
      const sessionId = crypto.randomUUID();
      const roleMap = resolveStreamRoles(role);

      const handle = startRecorderPair(
        micStream,
        tabStream,
        roleMap,
        (meta, blob) => {
          appendChunk(db, { ...meta, sessionId }, blob).catch((chunkErr) => {
            setError(
              chunkErr instanceof Error ? chunkErr.message : "Failed to save a recording chunk."
            );
          });
        },
        mimeType
      );

      const newSession = await createSession(db, {
        sessionId,
        startedAt: Date.now(),
        clockOrigin: handle.clockOrigin,
        userRole: role,
        mimeType,
      });

      dbRef.current = db;
      recorderHandleRef.current = handle;
      setSession(newSession);
      setElapsedMs(0);
      setStatus("recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start recording.");
    }
  };

  const handleStop = async () => {
    if (!recorderHandleRef.current || !session || !dbRef.current) return;
    setError("");
    try {
      await recorderHandleRef.current.stopAll();
      const finalDuration = performance.now() - session.clockOrigin;
      await markSessionStopped(dbRef.current, session.sessionId, finalDuration);
      stopStream(micStream);
      stopStream(tabStream);
      setElapsedMs(finalDuration);
      setStatus("stopped");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop recording cleanly.");
    }
  };

  const handleDownload = async (role: StreamRole, filename: string) => {
    if (!dbRef.current || !session) return;
    setError("");
    try {
      const blob = await assembleBlob(dbRef.current, session.sessionId, role, session.mimeType);
      downloadBlob(filename, blob);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not assemble the recording for download."
      );
    }
  };

  return (
    <ToolSection
      id="tool-live-interview"
      step="Tool 4"
      title="Live Interview"
      subtitle="Record a remote interview as two clean audio tracks — nothing leaves this browser"
      lockedReason={lockedReason}
    >
      <div className="flex flex-col gap-5">
        {/* Crash-recovery slot (plan 04-05) renders above everything else,
            including the consent gate, once it exists. */}

        {!hasConsented ? (
          <ConsentGate onAccept={handleAcceptConsent} />
        ) : (
          <>
            {error && (
              <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2 font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <RoleToggle
              role={role}
              onRoleChange={setRole}
              disabled={status !== "idle" && status !== "armed"}
            />

            <div className="flex items-start gap-2.5 bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4">
              <div className="p-1.5 rounded-[6px] shrink-0 border bg-amber-500/10 border-amber-500/20 text-amber-400">
                <Headphones className="w-4 h-4" />
              </div>
              <p className="text-xs text-[#9aa3b0] leading-relaxed">
                Wear headphones during the call. Laptop speakers leak the interviewer's voice into
                your microphone, which blurs the separation between the two tracks — the entire
                point of recording two separate streams.
              </p>
            </div>

            {status === "idle" && (
              <button
                ref={connectButtonRef}
                onClick={handleConnect}
                className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50"
              >
                <span>Connect microphone &amp; screen</span>
              </button>
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

            {status === "armed" && (
              <div className="flex flex-col gap-3">
                {tabAudioMissing && !acknowledgedSilentTab && (
                  <div className="w-full flex items-start gap-2.5 text-xs text-red-500 bg-red-500/10 border border-red-500/15 rounded-[6px] px-4 py-4">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-3 flex-1">
                      <span>
                        You shared without ticking 'Share tab audio' — the interviewer's side
                        won't be recorded. Click 'Share again' and make sure the audio checkbox
                        is ticked before you confirm.
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={handleShareAgain}
                          className="px-3 py-1.5 rounded-[5px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] text-xs font-semibold transition-all active:scale-95"
                        >
                          Share again
                        </button>
                        <button
                          onClick={() => setAcknowledgedSilentTab(true)}
                          className="px-3 py-1.5 rounded-[5px] border border-[rgba(255,255,255,0.07)] bg-transparent text-[#9aa3b0] hover:text-[#eef0f3] text-xs font-medium transition-all active:scale-95"
                        >
                          Record anyway (interviewer audio will be silent)
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <button
                  onClick={handleBegin}
                  disabled={tabAudioMissing && !acknowledgedSilentTab}
                  className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50"
                >
                  <Circle className="w-4 h-4" />
                  <span>Begin recording</span>
                </button>
              </div>
            )}

            {(status === "recording" || status === "paused") && (
              <div className="flex flex-col items-center gap-3">
                <span className="text-4xl font-extrabold font-mono text-[#eef0f3] tracking-tight">
                  {formatElapsed(elapsedMs)}
                </span>
                <button
                  onClick={handleStop}
                  className="w-full inline-flex items-center justify-center gap-2.5 bg-red-500 hover:opacity-90 text-white font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all"
                >
                  <Square className="w-4 h-4" />
                  <span>Stop recording</span>
                </button>
              </div>
            )}

            {status === "stopped" && (
              <div className="flex flex-col gap-4 border-t border-[rgba(255,255,255,0.07)] pt-5">
                <div>
                  <h3 className="text-sm font-semibold text-[#eef0f3]">
                    Download your recording
                  </h3>
                  <p className="text-xs text-[#6b7685] mt-1">
                    Two separate audio files — one per speaker. Recording complete —{" "}
                    {formatElapsed(elapsedMs)}.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => handleDownload("candidate", "candidate-audio.webm")}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-[6px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] transition-all active:scale-[0.98] text-left"
                  >
                    <Download className="w-5 h-5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">Candidate audio</span>
                      <span className="block text-[11px] text-[#6b7685]">Your microphone</span>
                    </span>
                  </button>
                  <button
                    onClick={() => handleDownload("interviewer", "interviewer-audio.webm")}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-[6px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] transition-all active:scale-[0.98] text-left"
                  >
                    <Download className="w-5 h-5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">Interviewer audio</span>
                      <span className="block text-[11px] text-[#6b7685]">Tab audio</span>
                    </span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ToolSection>
  );
};
