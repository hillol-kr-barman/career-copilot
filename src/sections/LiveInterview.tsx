import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Headphones, RefreshCw } from "lucide-react";
import { ToolSection } from "../components/ToolSection";
import { ConsentGate } from "../components/ConsentGate";
import { RoleToggle } from "../components/RoleToggle";
import { RecordingControls } from "../components/RecordingControls";
import { CrashRecoveryPrompt } from "../components/CrashRecoveryPrompt";
import { RecordingDownloads } from "../components/RecordingDownloads";
import {
  acquireMic,
  acquireTabAudio,
  stopStream,
  isTabAudioLikelySupported,
  describeCaptureError,
  TAB_AUDIO_UNSUPPORTED_REASON,
  UNSUPPORTED_FORMAT_REASON,
} from "../lib/audioCapture";
import {
  pickSupportedMimeType,
  resolveStreamRoles,
  startRecorderPair,
  TIMESLICE_MS,
} from "../lib/recorderPair";
import type { RecorderPairHandle } from "../lib/recorderPair";
import { createLevelMeter, NEAR_SILENCE_RMS, SILENCE_GRACE_MS, SILENCE_WATCHDOG_MS } from "../lib/levelMeter";
import type { LevelMeterHandle } from "../lib/levelMeter";
import { acquireWakeLock, releaseWakeLock, installWakeLockReacquire } from "../lib/wakeLock";
import {
  openRecordingDB,
  createSession,
  appendChunk,
  markSessionStopped,
  assembleStreamBlob,
  findResumableSession,
  pruneOlderSessions,
  deleteSession,
  nextSeqFor,
} from "../lib/recordingStore";
import type { ResumableSessionInfo } from "../lib/recordingStore";
import { downloadBlob } from "../lib/download";
import type {
  AudioChunkMeta,
  CaptureStatus,
  RecordingSession,
  StreamRole,
  StreamSummary,
  UserRole,
} from "../types";
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

  // WR-01: records that the visitor dismissed the soft wake-lock warning, so
  // a repeated failure does not keep re-raising it every time the tab regains
  // visibility. Reset to false at the start of each new/resumed recording.
  const wakeLockDismissedRef = useRef(false);

  // Silence watchdog: fifteen continuous seconds of near-silence on the tab
  // stream, after a five-second grace period, raises this — cleared
  // automatically once the level rises again. Never pauses or stops the
  // recording itself.
  const [tabSilent, setTabSilent] = useState(false);

  // LIVE-07, D-15: set by the tab track's native `ended` event while a
  // recording is active. A single boolean slot — never an array — so a
  // revoke, re-share, revoke cycle replaces the banner rather than stacking
  // a second one. Never stops the microphone recorder or the session.
  const [shareRevoked, setShareRevoked] = useState(false);

  // LIVE-08 download surface (plan 04-06): both streams' summaries and
  // unreadable-chunk counts, derived once via assembleStreamBlob at the
  // moment the session stops. interviewerNearSilent is true only when the
  // interviewer stream produced bytes but never rose above the near-silence
  // threshold for the whole session — tracked live in tabEverAudibleRef
  // below, independent of the (grace-period-gated) silence-watchdog banner.
  const [candidateSummary, setCandidateSummary] = useState<StreamSummary | null>(null);
  const [interviewerSummary, setInterviewerSummary] = useState<StreamSummary | null>(null);
  const [candidateUnreadableCount, setCandidateUnreadableCount] = useState(0);
  const [interviewerUnreadableCount, setInterviewerUnreadableCount] = useState(0);
  const [interviewerNearSilent, setInterviewerNearSilent] = useState(false);
  const [downloadingRoles, setDownloadingRoles] = useState<Partial<Record<StreamRole, boolean>>>(
    {}
  );

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

  // Closed and nulled on Stop and on unmount (CR-01): an open connection
  // makes indexedDB.deleteDatabase() queue on "blocked" instead of running,
  // so a live handle here silently defeats the "Clear stored data" promise
  // (D-12) even after the visitor believes the recording is over.
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

  // The ad-hoc MediaRecorder created by handleReshareTabAfterRevoke, when a
  // revoked tab share is re-shared mid-recording — distinct from the tab
  // recorder inside recorderHandleRef (created once, by startRecorderPair,
  // for the original tab stream). Null whenever no re-share has happened
  // yet this session.
  const reshareTabRecorderRef = useRef<MediaRecorder | null>(null);

  // CR-04: the outgoing tab recorder's stop-flush promise, set by
  // attachTabEndedListener's ended handler and awaited by
  // handleReshareTabAfterRevoke before it reads a sequence number — so a
  // reshare can never claim a seq the outgoing recorder's final write is
  // still in flight for. Null whenever no revoke has happened yet.
  const tabFlushDoneRef = useRef<Promise<void> | null>(null);

  // CR-04: the most recent appendChunk promise (already .catch()-chained,
  // so awaiting it can never throw), reassigned on every chunk write from
  // either recorder source. handleReshareTabAfterRevoke awaits this after
  // tabFlushDoneRef so the outgoing recorder's write has actually committed
  // before the reshare reads nextSeqFor.
  const pendingChunkWritesRef = useRef<Promise<unknown>>(Promise.resolve());

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

  // CR-03: carries the resumed session's tsOffsetMs out of handleBegin so
  // handleReshareTabAfterRevoke's ad-hoc recorder can apply the same resume
  // offset the normal onChunk callback already applies in handleBegin — one
  // timestamp convention across both recorder sources, whether or not the
  // session was resumed. Zero for a fresh (non-resumed) session.
  const tsOffsetMsRef = useRef(0);

  // Accumulates ONLY genuinely paused wall-clock time, unlike pausedMsRef —
  // that ref is overloaded, seeded to -tsOffsetMs for a resumed session so
  // the elapsed timer can carry the recovered offset, and subtracting it
  // from a stored timestamp would double-count that offset. Subtracted once,
  // at display time in handleStop, from the assembled summaries' durationMs;
  // stored chunk tsMs never carries a pause adjustment.
  const pausedSpanMsRef = useRef(0);

  // Read by the wake-lock re-acquire predicate and the silence-watchdog
  // interval, both of which need the latest status inside a closure that
  // isn't re-created on every status change.
  const statusRef = useRef<CaptureStatus>(status);
  statusRef.current = status;

  // Tracks how long the tab stream has been continuously near-silent, for
  // the silence watchdog below. Reset whenever the level rises again or a
  // recording is not actively in progress.
  const silenceStartRef = useRef<number | null>(null);

  // Whether the interviewer (tab) stream was ever read above the
  // near-silence threshold at any point this recording — reset at the start
  // of each new/resumed recording (handleBegin). Read at stop time to derive
  // interviewerNearSilent for the download surface (LIVE-08). Independent of
  // the grace-period-gated silence-watchdog banner above: this flag has no
  // grace period, since it must reflect the whole session's history, not
  // just a live warning.
  const tabEverAudibleRef = useRef(false);

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
      if (reshareTabRecorderRef.current && reshareTabRecorderRef.current.state !== "inactive") {
        reshareTabRecorderRef.current.stop();
      }
      releaseWakeLock();
      dbRef.current?.close();
      dbRef.current = null;
    };
  }, []);

  // D-16: warns the visitor before an accidental reload or tab close costs
  // them an in-progress interview. Installed only while status is
  // "recording" or "paused" — an idle tool must never block a reload.
  // e.returnValue = "" is what Chrome requires to show its native dialog.
  useEffect(() => {
    if (status !== "recording" && status !== "paused") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

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
      () => statusRef.current === "recording" || statusRef.current === "paused",
      (gotLock) => {
        if (gotLock) {
          setWakeLockUnavailable(false);
          wakeLockDismissedRef.current = false;
        } else if (!wakeLockDismissedRef.current) {
          setWakeLockUnavailable(true);
        }
      }
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
      const level = tabMeterRef.current?.read();

      // Feeds the download surface's mostly-silent badge (LIVE-08) — tracked
      // independently of the grace period below, since it must reflect
      // whether the stream was ever audible across the whole session.
      if (level !== undefined && level >= NEAR_SILENCE_RMS) {
        tabEverAudibleRef.current = true;
      }

      const sinceStart = performance.now() - session.clockOrigin - pausedMsRef.current;
      if (sinceStart < SILENCE_GRACE_MS) return;

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

  /**
   * Stops whichever `MediaRecorder` is currently producing the interviewer
   * stream's chunks — the original one created inside `startRecorderPair`,
   * or the ad-hoc one created by `handleReshareTabAfterRevoke` after a
   * re-share — so a revoke always stops the right recorder no matter how
   * many times the tab has been re-shared this session. Resolves once that
   * recorder has flushed its final chunk (CR-04).
   */
  const stopActiveTabRecorder = (): Promise<void> => {
    if (reshareTabRecorderRef.current) {
      const recorder = reshareTabRecorderRef.current;
      if (recorder.state === "inactive") return Promise.resolve();
      return new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    return recorderHandleRef.current?.stopTab() ?? Promise.resolve();
  };

  /**
   * Attaches the native `ended` event to every track of a tab stream — the
   * only reliable signal that the visitor clicked Chrome's stop-sharing bar
   * or the browser revoked the source (Pattern 6, RESEARCH.md): a manual
   * `track.stop()` call never dispatches it, so it can't be confused with
   * this app's own teardown. Guarded so a revoke arriving outside an active
   * recording — e.g. after the visitor already pressed Stop — never raises
   * the banner (D-15).
   */
  const attachTabEndedListener = (stream: MediaStream) => {
    const handleEnded = () => {
      if (statusRef.current !== "recording" && statusRef.current !== "paused") return;
      // Stays synchronous: this is a native event listener, and the
      // statusRef guard above must run before any await point. The flush
      // promise is stored for handleReshareTabAfterRevoke to await later
      // (CR-04).
      tabFlushDoneRef.current = stopActiveTabRecorder();
      setShareRevoked(true);
    };
    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", handleEnded, { once: true });
    });
  };

  /**
   * "Share tab audio again" on the revoked-share banner: re-invokes
   * `getDisplayMedia`, and — since a recording is always active whenever
   * this banner can be showing — starts a fresh tab-audio `MediaRecorder`
   * appending into the same session, with sequence numbers continuing from
   * `nextSeqFor` rather than restarting at zero. Re-attaches the `ended`
   * listener to the new tracks so a second revoke still raises the banner.
   */
  const handleReshareTabAfterRevoke = async () => {
    setError("");
    try {
      const tabResult = await acquireTabAudio();

      if (cancelledRef.current) {
        stopStream(tabResult.stream);
        return;
      }

      attachTabEndedListener(tabResult.stream);
      stopStream(tabStream);
      setTabStream(tabResult.stream);
      setTabAudioMissing(!tabResult.hasAudio);
      setShareRevoked(false);

      const db = dbRef.current;
      if (db && session && (statusRef.current === "recording" || statusRef.current === "paused")) {
        const roleMap = resolveStreamRoles(role);
        const tabRole = roleMap.tab;

        // CR-04: the outgoing recorder's stop event guarantees its final
        // dataavailable has already dispatched, and awaiting the write
        // promise guarantees that chunk's transaction has committed — only
        // once both have settled can nextSeqFor be trusted not to collide
        // with an in-flight put().
        if (tabFlushDoneRef.current) {
          await tabFlushDoneRef.current;
          tabFlushDoneRef.current = null;
        }
        await pendingChunkWritesRef.current;

        let seq = await nextSeqFor(session.sessionId, tabRole);

        const recorder = new MediaRecorder(tabResult.stream, { mimeType: session.mimeType });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            const meta: AudioChunkMeta = {
              sessionId: session.sessionId,
              streamRole: tabRole,
              seq: seq++,
              // CR-03: same convention as the normal per-chunk path (raw
              // wall-clock since clockOrigin, plus the resumed session's
              // offset) — never pause-adjusted, so a resumed-then-reshared
              // session stays on one continuous timeline.
              tsMs: performance.now() - session.clockOrigin + tsOffsetMsRef.current,
              size: e.data.size,
              mimeType: session.mimeType,
            };
            pendingChunkWritesRef.current = appendChunk(db, meta, e.data).catch((chunkErr) => {
              setError(
                chunkErr instanceof Error ? chunkErr.message : "Failed to save a recording chunk."
              );
            });
          }
        };
        recorder.start(TIMESLICE_MS);
        reshareTabRecorderRef.current = recorder;
      }
    } catch (err) {
      setError(describeCaptureError(err, "display"));
    }
  };

  /**
   * Abandons a pending resume: nulls the resume seed as well as the flag that
   * locks the role toggle, and reports whether a seed was actually pending
   * when it was called. Clearing the seed is deliberate — unlocking the
   * toggle while a seed is still pending would let the visitor flip roles and
   * then have the next Begin apply recovered sequence numbers to the wrong
   * physical stream, which is the exact mislabelling the lock exists to
   * prevent (WR-02). The recovered session record itself is untouched and
   * still carries status "recording", so the recovery prompt is offered
   * again on the next page load.
   */
  const abandonPendingResume = (): boolean => {
    const wasPending = resumeSeedRef.current !== null;
    resumeSeedRef.current = null;
    setIsResumingSession(false);
    return wasPending;
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
      const seedWasPending = abandonPendingResume();
      setStatus("idle");
      setError(
        seedWasPending
          ? `${describeCaptureError(err, "mic")} Your unfinished recording is still saved — reload the page to try recovering it again.`
          : describeCaptureError(err, "mic")
      );
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

      attachTabEndedListener(tab);
      setMicStream(mic);
      setTabStream(tab);
      setTabAudioMissing(!tabResult.hasAudio);
      setStatus("armed");
    } catch (err) {
      stopStream(mic);
      stopStream(tab);
      const seedWasPending = abandonPendingResume();
      setStatus("idle");
      setError(
        seedWasPending
          ? `${describeCaptureError(err, "display")} Your unfinished recording is still saved — reload the page to try recovering it again.`
          : describeCaptureError(err, "display")
      );
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

      attachTabEndedListener(tabResult.stream);
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

    // Fresh recording (or a resumed one continuing forward): the download
    // surface's per-session state must not leak from a previous recording,
    // and the near-silence flag starts unset for the new/resumed span.
    tabEverAudibleRef.current = false;
    setCandidateSummary(null);
    setInterviewerSummary(null);
    setCandidateUnreadableCount(0);
    setInterviewerUnreadableCount(0);
    setInterviewerNearSilent(false);

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
          pendingChunkWritesRef.current = appendChunk(db, adjusted, blob).catch((chunkErr) => {
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
      tsOffsetMsRef.current = tsOffsetMs;
      pausedSpanMsRef.current = 0;
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
      wakeLockDismissedRef.current = false;
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
      const pauseSpanMs = performance.now() - pauseStartRef.current;
      pausedMsRef.current += pauseSpanMs;
      pausedSpanMsRef.current += pauseSpanMs;
      pauseStartRef.current = null;
    }
    recorderHandleRef.current.resume();
    setStatus("recording");
  };

  /**
   * Releases everything handleStop must release regardless of whether the
   * storage write it guards succeeds: both MediaStreams, the wake lock, and
   * the IndexedDB handle (CR-01, CR-02, D-12). Reads from liveStreamsRef
   * rather than the micStream/tabStream closure variables deliberately — the
   * ref always holds the current pair. Every operation here is idempotent —
   * stopStream on an already-stopped track is a no-op, releaseWakeLock is
   * documented safe to call repeatedly — so calling this twice is harmless.
   */
  const teardownCapture = () => {
    stopStream(liveStreamsRef.current.mic);
    stopStream(liveStreamsRef.current.tab);
    releaseWakeLock();
    dbRef.current?.close();
    dbRef.current = null;
    // Clearing the stream refs (not just stopping their tracks) is what
    // triggers the level-meter effect's cleanup — otherwise the meters'
    // AudioContexts and RecordingControls' rAF loop would stay open after
    // a session has stopped.
    setMicStream(null);
    setTabStream(null);
  };

  const handleStop = async () => {
    if (!recorderHandleRef.current || !session || !dbRef.current) return;
    setError("");
    const db = dbRef.current;
    try {
      // If a revoke-and-reshare happened this session, the ad-hoc tab
      // recorder it created is separate from the pair recorderHandleRef
      // manages — both must flush their final chunk before the session is
      // marked stopped.
      const reshareTabDone =
        reshareTabRecorderRef.current && reshareTabRecorderRef.current.state !== "inactive"
          ? new Promise<void>((resolve) => {
              reshareTabRecorderRef.current!.addEventListener("stop", () => resolve(), {
                once: true,
              });
              reshareTabRecorderRef.current!.stop();
            })
          : Promise.resolve();

      await Promise.all([recorderHandleRef.current.stopAll(), reshareTabDone]);
      reshareTabRecorderRef.current = null;

      const finalDuration = performance.now() - session.clockOrigin - pausedMsRef.current;

      // Hardware and status transition unconditionally, before the awaited
      // storage write below — a rejected markSessionStopped (quota
      // pressure, a blocked transaction, mid-session eviction) must never
      // leave the microphone, tab share, or wake lock held, or the browser's
      // recording indicator lit after the visitor believes they stopped
      // (CR-02).
      setWakeLockUnavailable(false);
      setTabSilent(false);
      setShareRevoked(false);
      setElapsedMs(finalDuration);
      setStatus("stopped");

      await markSessionStopped(db, session.sessionId, finalDuration);

      // Derive both stream summaries now that the session has stopped
      // (LIVE-08) — this is what populates the download surface, and is
      // separate from the full blob assembly a download click performs.
      const [candidateResult, interviewerResult] = await Promise.all([
        assembleStreamBlob(session.sessionId, "candidate", session.mimeType),
        assembleStreamBlob(session.sessionId, "interviewer", session.mimeType),
      ]);
      // Stored tsMs is raw wall-clock (never pause-adjusted) so Phase 5 can
      // merge the two streams by time; the download surface instead shows a
      // pause-excluded duration so it agrees with the "Recording complete"
      // line above it, which is derived from finalDuration (also
      // pause-excluded). This derivation point is the only place pause is
      // subtracted from a duration — no stored chunk record is ever rewritten.
      setCandidateSummary({
        ...candidateResult.summary,
        durationMs: Math.max(0, candidateResult.summary.durationMs - pausedSpanMsRef.current),
      });
      setInterviewerSummary({
        ...interviewerResult.summary,
        durationMs: Math.max(0, interviewerResult.summary.durationMs - pausedSpanMsRef.current),
      });
      setCandidateUnreadableCount(candidateResult.unreadableCount);
      setInterviewerUnreadableCount(interviewerResult.unreadableCount);
      setInterviewerNearSilent(
        interviewerResult.summary.chunkCount > 0 && !tabEverAudibleRef.current
      );
    } catch (err) {
      // Hardware and status are already released by this point (the
      // transition above runs before the awaited write, and teardownCapture
      // runs in finally below regardless) — this reports a storage failure
      // and nothing more.
      setError(err instanceof Error ? err.message : "Could not stop recording cleanly.");
    } finally {
      teardownCapture();
    }
  };

  /**
   * Re-assembles one stream's blob from storage and hands it to the visitor
   * (LIVE-08). Deliberately separate from the summary assembly in
   * handleStop — that call discards its blob once the summary is read, so a
   * stopped session's download surface doesn't hold two full recordings in
   * memory before the visitor has asked for either. Guarded against a second
   * concurrent press of the same button; the other stream's button is
   * unaffected (each assembly opens its own storage read). The filename
   * comes from RecordingDownloads, which owns the role-to-filename mapping.
   */
  const handleDownloadStream = async (targetRole: StreamRole, filename: string) => {
    if (!session || downloadingRoles[targetRole]) return;
    setError("");
    setDownloadingRoles((prev) => ({ ...prev, [targetRole]: true }));
    try {
      const result = await assembleStreamBlob(session.sessionId, targetRole, session.mimeType);
      if (result.blob) {
        downloadBlob(filename, result.blob);
      } else {
        setError("Could not assemble the recording for download.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not assemble the recording for download."
      );
    } finally {
      setDownloadingRoles((prev) => ({ ...prev, [targetRole]: false }));
    }
  };

  const warnings: RecordingWarning[] = [];
  if (wakeLockUnavailable) {
    warnings.push({
      id: "wake-lock",
      message:
        "Your screen may sleep during a long call — keep this tab active and your device plugged in.",
      onDismiss: () => {
        setWakeLockUnavailable(false);
        wakeLockDismissedRef.current = true;
      },
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
              shareRevoked={shareRevoked}
              onReshareTab={handleReshareTabAfterRevoke}
            />

            {status === "stopped" && session && candidateSummary && interviewerSummary && (
              <RecordingDownloads
                candidateSummary={candidateSummary}
                interviewerSummary={interviewerSummary}
                interviewerNearSilent={interviewerNearSilent}
                candidateUnreadableCount={candidateUnreadableCount}
                interviewerUnreadableCount={interviewerUnreadableCount}
                downloadingRoles={downloadingRoles}
                mimeType={session.mimeType}
                onDownload={handleDownloadStream}
              />
            )}
          </>
        )}
      </div>
    </ToolSection>
  );
};
