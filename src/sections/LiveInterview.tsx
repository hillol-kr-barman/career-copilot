import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Headphones, RefreshCw } from "lucide-react";
import { ToolSection } from "../components/ToolSection";
import { ConsentGate } from "../components/ConsentGate";
import { RoleToggle } from "../components/RoleToggle";
import { RecordingControls } from "../components/RecordingControls";
import { CrashRecoveryPrompt } from "../components/CrashRecoveryPrompt";
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
import { createLevelMeter, NEAR_SILENCE_RMS, SILENCE_GRACE_MS, SILENCE_WATCHDOG_MS } from "../lib/levelMeter";
import type { LevelMeterHandle } from "../lib/levelMeter";
import { acquireWakeLock, releaseWakeLock, installWakeLockReacquire } from "../lib/wakeLock";
import {
  openRecordingDB,
  createSession,
  appendChunk,
  markSessionStopped,
  assembleBlob,
  findResumableSession,
  pruneOlderSessions,
  deleteSession,
  nextSeqFor,
} from "../lib/recordingStore";
import type { ResumableSessionInfo } from "../lib/recordingStore";
import { downloadBlob } from "../lib/download";
import type { CaptureStatus, RecordingSession, StreamRole, UserRole } from "../types";
import type { RecordingWarning } from "../components/RecordingControls";

/** Copy from the UI-SPEC Copywriting Contract — a recovered session whose
 * chunks can't be read (restore threw, or nothing was actually stored). */
const RECOVERY_FAILED_COPY =
  "This recording couldn't be recovered — the saved data may be corrupted or incomplete. It has been discarded automatically.";

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

  // Crash recovery (LIVE-06, D-13): findResumableSession scans on mount,
  // before any gate renders. recoveryScanning covers the (expected-instant)
  // window while that scan is in flight; recoveryInfo holds the newest
  // unfinished session once found; recoveryError surfaces the recovery-
  // failed copy for a session that turned out to be unreadable.
  const [recoveryInfo, setRecoveryInfo] = useState<ResumableSessionInfo | null>(null);
  const [recoveryScanning, setRecoveryScanning] = useState(true);
  const [recoveryError, setRecoveryError] = useState("");
  // True from the moment "Resume this session" is clicked until the next
  // "Begin recording" actually consumes resumeSeedRef — the role toggle is
  // disabled for this window so a role change can't flip which physical
  // stream the recovered chunks' sequence numbers apply to.
  const [isResumingSession, setIsResumingSession] = useState(false);

  // D-14: a soft, dismissible notice when the platform refuses the screen
  // wake lock — the refusal never blocks or interrupts recording.
  const [wakeLockUnavailable, setWakeLockUnavailable] = useState(false);

  // Silence watchdog: fifteen continuous seconds of near-silence on the tab
  // stream, after a five-second grace period, raises this — cleared
  // automatically once the level rises again. Never pauses or stops the
  // recording itself.
  const [tabSilent, setTabSilent] = useState(false);

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

  // Populated by handleResumeRecovery, consumed once by the next
  // handleBegin: carries the recovered session's identity forward so the
  // next recording continues the same session instead of starting a new
  // one, and continues sequence numbering / chunk timestamps rather than
  // restarting either at zero.
  const resumeSeedRef = useRef<{
    sessionId: string;
    mimeType: string;
    startedAt: number;
    seedSeq: Partial<Record<StreamRole, number>>;
    tsOffsetMs: number;
  } | null>(null);

  // Level meters are observability only (T-04-13) — created once both streams
  // exist, read from a rAF loop in RecordingControls, and never on the
  // critical path of the recording itself.
  const micMeterRef = useRef<LevelMeterHandle | null>(null);
  const tabMeterRef = useRef<LevelMeterHandle | null>(null);

  // D-03: elapsedMs is derived from clockOrigin, the same performance.now()
  // origin the recorder pair timestamps every chunk against — never from
  // summed timeslice intervals. pausedMsRef accumulates total time spent
  // paused so the timer can freeze and resume without drifting.
  const pausedMsRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);

  // Read by the wake-lock re-acquire predicate and the silence-watchdog
  // interval, both of which need the latest status inside a closure that
  // isn't re-created on every status change.
  const statusRef = useRef<CaptureStatus>(status);
  statusRef.current = status;

  // Tracks how long the tab stream has been continuously near-silent, for
  // the silence watchdog below. Reset whenever the level rises again or a
  // recording is not actively in progress.
  const silenceStartRef = useRef<number | null>(null);

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
      releaseWakeLock();
    };
  }, []);

  // Crash-recovery scan: runs once on mount, before any gate renders,
  // including the consent gate. When a session is found, every older
  // unfinished session is pruned in the same pass — storage can hold more
  // than one (crash twice, there are two) — so exactly one prompt is ever
  // shown, naming the newest.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await findResumableSession();
      if (cancelled) return;
      if (found) {
        await pruneOlderSessions(found.session.sessionId);
        if (cancelled) return;
        setRecoveryInfo(found);
      }
      setRecoveryScanning(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A wall-clock timer independent of chunk delivery — dataavailable/
  // timeslice timing is not exact enough to double as an elapsed clock
  // (Common Pitfall 3). Only running while status === "recording" is what
  // makes the timer freeze on pause; pausedMsRef.current is subtracted so
  // resuming continues from where it froze rather than losing the gap.
  useEffect(() => {
    if (status !== "recording" || !session) return;
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - session.clockOrigin - pausedMsRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, session]);

  // Two level meters, created once both streams exist (armed state onward,
  // before any MediaRecorder starts) and torn down in cleanup. A
  // cancellation flag guards a StrictMode double-mount, matching Pattern 8 —
  // even though createLevelMeter is synchronous today, the guard costs
  // nothing and keeps this effect safe if that ever changes.
  useEffect(() => {
    if (!micStream || !tabStream) return;
    let cancelled = false;

    const micMeter = createLevelMeter(micStream);
    const tabMeter = createLevelMeter(tabStream);

    if (cancelled) {
      micMeter?.close();
      tabMeter?.close();
      return;
    }

    micMeterRef.current = micMeter;
    tabMeterRef.current = tabMeter;

    return () => {
      cancelled = true;
      micMeterRef.current?.close();
      tabMeterRef.current?.close();
      micMeterRef.current = null;
      tabMeterRef.current = null;
    };
  }, [micStream, tabStream]);

  // Browsers auto-release the wake lock whenever the tab is hidden (D-14) —
  // re-request it whenever the tab regains visibility while a recording
  // (recording or paused) is still active. Installed only for the lifetime
  // of an active recording and removed the moment it ends.
  const isActiveRecording = status === "recording" || status === "paused";
  useEffect(() => {
    if (!isActiveRecording) return;
    const remove = installWakeLockReacquire(
      () => statusRef.current === "recording" || statusRef.current === "paused"
    );
    return remove;
  }, [isActiveRecording]);

  // Silence watchdog: ignores the first SILENCE_GRACE_MS after recording
  // starts, then raises tabSilent once the tab stream's level has stayed
  // below NEAR_SILENCE_RMS continuously for SILENCE_WATCHDOG_MS. Clears
  // itself the moment the level rises again — never touches recording state.
  useEffect(() => {
    if (status !== "recording" || !session) {
      silenceStartRef.current = null;
      setTabSilent(false);
      return;
    }

    const id = window.setInterval(() => {
      const sinceStart = performance.now() - session.clockOrigin - pausedMsRef.current;
      if (sinceStart < SILENCE_GRACE_MS) return;

      const level = tabMeterRef.current?.read();
      if (level === undefined) return; // no meter to watch — never blocks recording

      if (level < NEAR_SILENCE_RMS) {
        if (silenceStartRef.current === null) silenceStartRef.current = performance.now();
        if (performance.now() - silenceStartRef.current >= SILENCE_WATCHDOG_MS) {
          setTabSilent(true);
        }
      } else {
        silenceStartRef.current = null;
        setTabSilent(false);
      }
    }, 500);

    return () => window.clearInterval(id);
  }, [status, session]);

  /**
   * "Discard and start new": deletes the recovered session's record and all
   * of its chunks, and clears the prompt. Used both for the visitor's own
   * two-step confirm and, internally, for a session that turns out to be
   * unreadable.
   */
  const handleDiscardRecovery = async () => {
    if (!recoveryInfo) return;
    await deleteSession(recoveryInfo.session.sessionId);
    setRecoveryInfo(null);
  };

  /**
   * "Resume this session": seeds resumeSeedRef with everything the next
   * handleBegin needs to continue the same session — its id, mimeType,
   * original start time (so a second crash still shows the true relative
   * time), and each stream's next sequence number — then restores the
   * recorded userRole and clears the prompt so the visitor reconnects their
   * microphone and share from the normal idle state. A session with no
   * readable chunks, or one whose sequence lookup throws, is treated as
   * unreadable: shown the recovery-failed copy, discarded, and the tool
   * falls through to a normal fresh start rather than leaving a broken
   * prompt on screen.
   */
  const handleResumeRecovery = async () => {
    if (!recoveryInfo) return;
    const { session: recovered, chunkCounts, latestTsMs } = recoveryInfo;
    const totalChunks = (chunkCounts.candidate ?? 0) + (chunkCounts.interviewer ?? 0);

    if (totalChunks === 0) {
      await deleteSession(recovered.sessionId);
      setRecoveryInfo(null);
      setRecoveryError(RECOVERY_FAILED_COPY);
      return;
    }

    try {
      const [candidateSeq, interviewerSeq] = await Promise.all([
        nextSeqFor(recovered.sessionId, "candidate"),
        nextSeqFor(recovered.sessionId, "interviewer"),
      ]);

      resumeSeedRef.current = {
        sessionId: recovered.sessionId,
        mimeType: recovered.mimeType,
        startedAt: recovered.startedAt,
        seedSeq: { candidate: candidateSeq, interviewer: interviewerSeq },
        tsOffsetMs: latestTsMs,
      };
      setIsResumingSession(true);
      setRole(recovered.userRole);
      setRecoveryInfo(null);
    } catch {
      await deleteSession(recovered.sessionId);
      setRecoveryInfo(null);
      setRecoveryError(RECOVERY_FAILED_COPY);
    }
  };

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

    // A resumed session reuses its recovered mimeType rather than
    // re-negotiating one — mixing mimeTypes within one assembled download
    // would risk a codec mismatch the player can't reconcile.
    const resumeSeed = resumeSeedRef.current;

    let mimeType: string;
    if (resumeSeed) {
      mimeType = resumeSeed.mimeType;
    } else {
      try {
        mimeType = pickSupportedMimeType();
      } catch (err) {
        setFormatUnsupported(true);
        setError(describeCaptureError(err, "display"));
        return;
      }
    }

    try {
      const db = await openRecordingDB();
      const sessionId = resumeSeed?.sessionId ?? crypto.randomUUID();
      const roleMap = resolveStreamRoles(role);

      // Resuming continues sequence numbering and chunk timestamps from
      // where the recovered session left off (LIVE-06) rather than
      // restarting either at zero — startRecorderPair always counts from 0
      // per instance, so the offset is applied here, per physical stream,
      // as each chunk arrives.
      const seedSeq = resumeSeed
        ? {
            mic: resumeSeed.seedSeq[roleMap.mic] ?? 0,
            tab: resumeSeed.seedSeq[roleMap.tab] ?? 0,
          }
        : { mic: 0, tab: 0 };
      const tsOffsetMs = resumeSeed?.tsOffsetMs ?? 0;

      const handle = startRecorderPair(
        micStream,
        tabStream,
        roleMap,
        (meta, blob) => {
          const seqOffset = meta.streamRole === roleMap.mic ? seedSeq.mic : seedSeq.tab;
          const adjusted = { ...meta, sessionId, seq: meta.seq + seqOffset, tsMs: meta.tsMs + tsOffsetMs };
          appendChunk(db, adjusted, blob).catch((chunkErr) => {
            setError(
              chunkErr instanceof Error ? chunkErr.message : "Failed to save a recording chunk."
            );
          });
        },
        mimeType
      );

      const newSession = await createSession(db, {
        sessionId,
        startedAt: resumeSeed?.startedAt ?? Date.now(),
        clockOrigin: handle.clockOrigin,
        userRole: role,
        mimeType,
      });

      dbRef.current = db;
      recorderHandleRef.current = handle;
      pausedMsRef.current = resumeSeed ? -tsOffsetMs : 0;
      pauseStartRef.current = null;
      resumeSeedRef.current = null;
      setIsResumingSession(false);
      setSession(newSession);
      setElapsedMs(resumeSeed ? tsOffsetMs : 0);
      setStatus("recording");

      // A wake-lock refusal is a soft warning, never a reason to stop or
      // fail to start a recording (D-14).
      const gotLock = await acquireWakeLock();
      setWakeLockUnavailable(!gotLock);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start recording.");
    }
  };

  const handlePause = () => {
    if (!recorderHandleRef.current || status !== "recording") return;
    recorderHandleRef.current.pause();
    pauseStartRef.current = performance.now();
    setStatus("paused");
  };

  const handleResume = () => {
    if (!recorderHandleRef.current || status !== "paused") return;
    if (pauseStartRef.current !== null) {
      pausedMsRef.current += performance.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    recorderHandleRef.current.resume();
    setStatus("recording");
  };

  const handleStop = async () => {
    if (!recorderHandleRef.current || !session || !dbRef.current) return;
    setError("");
    try {
      await recorderHandleRef.current.stopAll();
      const finalDuration = performance.now() - session.clockOrigin - pausedMsRef.current;
      await markSessionStopped(dbRef.current, session.sessionId, finalDuration);
      stopStream(micStream);
      stopStream(tabStream);
      releaseWakeLock();
      // Clearing the stream refs (not just stopping their tracks) is what
      // triggers the level-meter effect's cleanup — otherwise the meters'
      // AudioContexts and RecordingControls' rAF loop would stay open after
      // a session has stopped.
      setMicStream(null);
      setTabStream(null);
      setWakeLockUnavailable(false);
      setTabSilent(false);
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

  const warnings: RecordingWarning[] = [];
  if (wakeLockUnavailable) {
    warnings.push({
      id: "wake-lock",
      message:
        "Your screen may sleep during a long call — keep this tab active and your device plugged in.",
      onDismiss: () => setWakeLockUnavailable(false),
    });
  }
  if (tabSilent) {
    warnings.push({
      id: "silence-watchdog",
      message:
        "The interviewer's tab audio has been silent for over 15 seconds. Check that 'Share audio' is still enabled and that the other person isn't muted.",
    });
  }

  return (
    <ToolSection
      id="tool-live-interview"
      step="Tool 4"
      title="Live Interview"
      subtitle="Record a remote interview as two clean audio tracks — nothing leaves this browser"
      lockedReason={lockedReason}
    >
      <div className="flex flex-col gap-5">
        {/* Crash-recovery slot renders above everything else in the tool
            body, including the consent gate (LIVE-06, D-13) — this state
            can appear with no user action at all, on a page load after a
            crash. */}
        {recoveryScanning ? (
          <div className="flex items-center gap-2.5 text-xs text-[#9aa3b0] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] px-4 py-4">
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            <span>Checking for an unfinished recording…</span>
          </div>
        ) : recoveryInfo ? (
          <CrashRecoveryPrompt
            session={recoveryInfo.session}
            capturedDurationMs={recoveryInfo.latestTsMs}
            chunkCounts={recoveryInfo.chunkCounts}
            onResume={handleResumeRecovery}
            onDiscard={handleDiscardRecovery}
          />
        ) : null}

        {recoveryError && (
          <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{recoveryError}</span>
          </div>
        )}

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
              disabled={isResumingSession || (status !== "idle" && status !== "armed")}
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

            <RecordingControls
              status={status}
              micStream={micStream}
              tabStream={tabStream}
              micRole={resolveStreamRoles(role).mic}
              tabRole={resolveStreamRoles(role).tab}
              elapsedMs={elapsedMs}
              tabAudioMissing={tabAudioMissing}
              acknowledgedSilentTab={acknowledgedSilentTab}
              micMeterRef={micMeterRef}
              tabMeterRef={tabMeterRef}
              onConnect={handleConnect}
              onBegin={handleBegin}
              onPause={handlePause}
              onResume={handleResume}
              onStop={handleStop}
              onReshare={handleShareAgain}
              onAcknowledgeSilentTab={() => setAcknowledgedSilentTab(true)}
              connectButtonRef={connectButtonRef}
              warnings={warnings}
            />

            {status === "stopped" && (
              <div className="flex flex-col gap-4 border-t border-[rgba(255,255,255,0.07)] pt-5">
                <div>
                  <h3 className="text-sm font-semibold text-[#eef0f3]">
                    Download your recording
                  </h3>
                  <p className="text-xs text-[#6b7685] mt-1">
                    Two separate audio files — one per speaker. Nothing was uploaded; these come
                    straight from this browser's storage.
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
