import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { ToolSection } from "../components/ToolSection";
import { ConsentGate } from "../components/ConsentGate";
import { RoleToggle } from "../components/RoleToggle";
import { RecordingControls } from "../components/RecordingControls";
import { CrashRecoveryPrompt } from "../components/CrashRecoveryPrompt";
import { RecordingDownloads } from "../components/RecordingDownloads";
import { MicSetup } from "../components/MicSetup";
import {
  acquireMic,
  stopStream,
  describeCaptureError,
  listAudioInputs,
  CAPTURE_UNSUPPORTED_REASON,
  UNSUPPORTED_FORMAT_REASON,
} from "../lib/audioCapture";
import type { AudioInputDevice } from "../lib/audioCapture";
import { pickSupportedMimeType, startRecorder, audioElapsedMs, isRecordingFormatSupported } from "../lib/recorder";
import type { RecorderHandle } from "../lib/recorder";
import { createLevelMeter } from "../lib/levelMeter";
import type { LevelMeterHandle } from "../lib/levelMeter";
import { acquireWakeLock, releaseWakeLock, installWakeLockReacquire } from "../lib/wakeLock";
import {
  openRecordingDB,
  createSession,
  appendChunk,
  appendTagPress,
  markSessionStopped,
  assembleSessionBlob,
  listTagPresses,
  deriveSpans,
  findResumableSession,
  pruneOlderSessions,
  deleteSession,
  nextSeqFor,
  listStoppedSessions,
  updateSessionSize,
  closeRecoveredSession,
} from "../lib/recordingStore";
import type { ResumableSessionInfo } from "../lib/recordingStore";
import { downloadBlob, downloadJson } from "../lib/download";
import type { CaptureStatus, RecordingSession, Speaker, TagTrackSidecar } from "../types";
import type { RecordingWarning } from "../components/RecordingControls";

/** Copy from the UI-SPEC Copywriting Contract — a recovered session whose
 * chunks can't be read (restore threw, or nothing was actually stored). */
const RECOVERY_FAILED_COPY =
  "This recording couldn't be recovered — the saved data may be corrupted or incomplete. It has been discarded automatically.";

interface LiveInterviewProps {
  /**
   * Bumped by App.tsx's "Clear stored data" handler the moment
   * `deleteRecordingDB` actually confirms the database is gone (LIVE-09) —
   * never on a `"blocked"`/`"incomplete"` outcome, since the data (and this
   * list) genuinely is still there in that case. A no-op on first mount
   * (0 === 0), so it only fires on a real clear, never on initial render.
   */
  clearedAt?: number;
  /**
   * The mirror image of `clearedAt` (LIVE-09 follow-up): App.tsx's
   * `hasRecordings` — which gates whether "Clear stored data" is even
   * clickable — is set only once on mount (a direct `hasStoredRecordings()`
   * probe) and once inside the clear handler itself. Nothing told it a *new*
   * take had been written mid-session, so the first clear correctly emptied
   * everything and disabled the button, and it stayed disabled forever after
   * — even once a fresh take existed on disk — until a reload re-ran the
   * mount probe. Fired the moment a take is durably marked stopped, the
   * earliest point at which "a recording exists" is a fact App.tsx can trust
   * without re-opening the database itself.
   */
  onRecordingStored?: () => void;
}

/**
 * Tool 4 — records both people in the room through one in-room microphone
 * (D-21), a spacebar toggle marks who is speaking into a timestamped tag
 * track (D-23, D-27), and persists every chunk to IndexedDB as it arrives
 * (D-13). Audio never leaves this browser: nothing this section touches
 * makes a network call.
 */
export const LiveInterview: React.FC<LiveInterviewProps> = ({ clearedAt = 0, onRecordingStored }) => {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");
  const [formatUnsupported, setFormatUnsupported] = useState(false);
  // D-34: a fact about this take, never about the browser session — starts
  // false on every mount and is reset to false at every take boundary (the
  // stop path and every failed-acquisition path back to idle). No storage
  // write, no ref, nothing that outlives the take it was given for.
  const [hasConsented, setHasConsented] = useState(false);
  const [declaredSpeaker, setDeclaredSpeaker] = useState<Speaker>("candidate");

  // D-36: the operator's chosen input device. `undefined` means the system
  // default and is never persisted — deviceIds rotate per origin and a
  // stale one buys nothing on first use. inputDevices is refreshed once
  // permission is granted (see the micStream effect below); micFellBack
  // mirrors acquireMic's usedFallback so a silent substitution is never
  // possible (D-36).
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [inputDevices, setInputDevices] = useState<AudioInputDevice[]>([]);
  const [micFellBackToDefault, setMicFellBackToDefault] = useState(false);

  // D-37: per-side pre-flight cleared flags, owned here (not by MicSetup) so
  // they survive the panel unmounting between takes — once both are true,
  // later takes show a compact passed line instead of the full step.
  // Nothing about this is persisted beyond the page session (no storage
  // write, no localStorage) — it describes the room as it is right now.
  const [preflightCleared, setPreflightCleared] = useState<Record<Speaker, boolean>>({
    interviewer: false,
    candidate: false,
  });

  // D-25: the opening span belongs to the interviewer, so the current-speaker
  // surface (and the spacebar's first flip) starts there for every take.
  const [speaker, setSpeaker] = useState<Speaker>("interviewer");

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
  // disabled for this window so a role change can't outlive the recovered
  // session it was declared for.
  const [isResumingSession, setIsResumingSession] = useState(false);

  // D-14: a soft, dismissible notice when the platform refuses the screen
  // wake lock — the refusal never blocks or interrupts recording.
  const [wakeLockUnavailable, setWakeLockUnavailable] = useState(false);

  // WR-01: records that the visitor dismissed the soft wake-lock warning, so
  // a repeated failure does not keep re-raising it every time the tab regains
  // visibility. Reset to false at the start of each new/resumed recording.
  const wakeLockDismissedRef = useRef(false);

  // Keyed by `${sessionId}:audio` / `${sessionId}:sidecar` so an audio
  // download and a sidecar download of the same take never block each
  // other, and a second press of the same button is still ignored.
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  // D-31/LIVE-08: every stopped take, newest-first — the primary read path
  // for the download surface. Refetched on mount (after the crash-recovery
  // scan resolves), after every stop, and after every delete. Deliberately
  // separate from `session` (the take currently being recorded, if any):
  // one is live state, the other is a list of finished work.
  const [stoppedTakes, setStoppedTakes] = useState<RecordingSession[]>([]);
  // Keyed by sessionId — guards a second concurrent delete press on the
  // same take (D-32: a delete must never remove more than the one take it
  // names, and must never fire twice for it).
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});

  // The real remaining capability constraint after the in-room pivot —
  // computed once, it does not change over the component's lifetime.
  const [captureSupported] = useState(() => isRecordingFormatSupported());

  // This chain gates on browser capability only, never on resume, job
  // description or API key — Tool 4 needs no key at all.
  const lockedReason = !captureSupported
    ? CAPTURE_UNSUPPORTED_REASON
    : formatUnsupported
      ? UNSUPPORTED_FORMAT_REASON
      : null;

  // Closed and nulled on Stop and on unmount (CR-01): an open connection
  // makes indexedDB.deleteDatabase() queue on "blocked" instead of running,
  // so a live handle here silently defeats the "Clear stored data" promise
  // (D-12) even after the visitor believes the recording is over.
  const dbRef = useRef<IDBDatabase | null>(null);
  const recorderHandleRef = useRef<RecorderHandle | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
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
    seedSeq: number;
    tsOffsetMs: number;
    /** The speaker recovered from the crashed take's last press (D-25/D-26)
     * — carried into the resumed take's opening speaker instead of the
     * fresh-take default of "interviewer" (T-04-15-02). */
    initialSpeaker: Speaker;
  } | null>(null);

  // The most recent appendChunk promise (already .catch()-chained, so
  // awaiting it can never throw), reassigned on every chunk write.
  const pendingChunkWritesRef = useRef<Promise<unknown>>(Promise.resolve());

  // The level meter is observability only (T-04-13), created once the
  // stream exists, read from a rAF loop in RecordingControls, and never on
  // the critical path of the recording itself.
  const micMeterRef = useRef<LevelMeterHandle | null>(null);

  // D-22: clockOriginRef holds the performance.now() value captured once
  // when a take begins; pausedMsRef accumulates total time spent paused so
  // the clock can freeze and resume without drifting; tsOffsetMsRef carries
  // a resumed session's recovered offset. audioElapsedMs — the one function
  // both the chunk-append callback and the spacebar-press handler call — is
  // what keeps the audio file, the tag spans, and the on-screen timer from
  // ever disagreeing.
  const clockOriginRef = useRef(0);
  const pausedMsRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const tsOffsetMsRef = useRef(0);

  const clock = () => audioElapsedMs(clockOriginRef.current, pausedMsRef.current, tsOffsetMsRef.current);

  // Read by the wake-lock re-acquire predicate, which needs the latest
  // status inside a closure that isn't re-created on every status change.
  const statusRef = useRef<CaptureStatus>(status);
  statusRef.current = status;

  liveStreamRef.current = micStream;

  // Consent resolving unmounts the gate's own "Continue" button — focus
  // would otherwise be stranded on a node that no longer exists. Move it to
  // the CTA that takes its place, once that CTA exists to receive it.
  useEffect(() => {
    if (hasConsented) connectButtonRef.current?.focus();
  }, [hasConsented]);

  // StrictMode-safe teardown: acquisition happens behind a button click
  // rather than on mount, but if the section unmounts while a capture is
  // live, the stream must still be stopped so the browser's recording
  // indicator goes dark (Pattern 8).
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      stopStream(liveStreamRef.current);
      recorderHandleRef.current?.stopAll().catch(() => {});
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
      const takes = await listStoppedSessions();
      if (cancelled) return;
      setStoppedTakes(takes);
      setRecoveryScanning(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // LIVE-09: the take list (and anything else naming a take) must not go
  // stale the moment "Clear stored data" actually empties the database —
  // without this, stoppedTakes kept rendering takes that no longer existed
  // on disk until the page was reloaded and the mount-time scan above ran
  // again. clearedAtRef starts equal to the prop's initial value, so this
  // never fires on mount — only on a real, later bump from App.tsx, which
  // only happens once deleteRecordingDB has confirmed the database is gone.
  const clearedAtRef = useRef(clearedAt);
  useEffect(() => {
    if (clearedAt === clearedAtRef.current) return;
    clearedAtRef.current = clearedAt;
    setStoppedTakes([]);
    setRecoveryInfo(null);
    setRecoveryError("");
    setDeletingIds({});
    setDownloading({});
    // The completion line (session/elapsedMs) describes a specific
    // stopped take, kept only for RecordingControls' stopped-state text
    // (see findTake's doc comment) — it must not go on describing a take
    // that storage no longer holds. Left alone while a recording is still
    // active: that take's own data is what kept the delete from completing
    // in the first place, so status can never be "stopped" here anyway.
    if (status === "stopped") {
      setSession(null);
      setElapsedMs(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearedAt]);

  // A wall-clock timer independent of chunk delivery — dataavailable/
  // timeslice timing is not exact enough to double as an elapsed clock
  // (Common Pitfall 3). Only running while status === "recording" is what
  // makes the timer freeze on pause; the clock's pausedMs subtraction is
  // what makes resuming continue from where it froze rather than losing the
  // gap.
  useEffect(() => {
    if (status !== "recording" || !session) return;
    const id = window.setInterval(() => {
      setElapsedMs(clock());
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  // The level meter, created once the stream exists (armed state onward,
  // before the MediaRecorder starts) and torn down in cleanup. A
  // cancellation flag guards a StrictMode double-mount, matching Pattern 8 —
  // even though createLevelMeter is synchronous today, the guard costs
  // nothing and keeps this effect safe if that ever changes.
  useEffect(() => {
    if (!micStream) return;
    let cancelled = false;

    const meter = createLevelMeter(micStream);

    if (cancelled) {
      meter?.close();
      return;
    }

    micMeterRef.current = meter;

    return () => {
      cancelled = true;
      micMeterRef.current?.close();
      micMeterRef.current = null;
    };
  }, [micStream]);

  // D-36: the device list is only meaningful once permission has been
  // granted — before that every label the browser returns is blank. Runs
  // whenever micStream changes (a fresh connect or a device switch), which
  // is exactly when permission is known to be live.
  useEffect(() => {
    if (!micStream) return;
    let cancelled = false;
    listAudioInputs().then((devices) => {
      if (!cancelled) setInputDevices(devices);
    });
    return () => {
      cancelled = true;
    };
  }, [micStream]);

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

  /**
   * The spacebar tag track (D-23, D-27). Installed only while status is
   * `"recording"`, so the listener does not exist at all outside an active
   * take — this page is a single scroll with three other tools above Tool 4,
   * and an always-installed listener would eat the space key and the page's
   * scroll for all of them.
   */
  useEffect(() => {
    if (status !== "recording") return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const active = document.activeElement;
      const tag = (active?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (active instanceof HTMLElement && active.isContentEditable) return;
      // WR-02: a focused <button> (Pause/Resume/Stop in RecordingControls,
      // or the SpeakerBanner itself) already activates on Space per native
      // browser behavior. Preempting that here would swallow the button's
      // own activation. Bailing costs nothing for SpeakerBanner specifically
      // — it is itself a <button type="button" onClick={onFlip}>, so letting
      // the browser's native Space-activation fire its click still flips the
      // speaker; only the flip's origin changes, not whether it happens.
      if (tag === "BUTTON" || (active instanceof HTMLElement && active.getAttribute("role") === "button")) return;
      e.preventDefault();
      flipSpeaker();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, speaker, session]);

  /**
   * "Discard and start new": deletes the recovered session's record and all
   * of its chunks and tag presses, and clears the prompt. Used both for the
   * visitor's own two-step confirm and, internally, for a session that turns
   * out to be unreadable.
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
   * time), and the next sequence number — then restores the recorded
   * declaredSpeaker and clears the prompt so the visitor reconnects their
   * microphone from the normal idle state. A session with no readable
   * chunks, or one whose sequence lookup throws, is treated as unreadable:
   * shown the recovery-failed copy, discarded, and the tool falls through to
   * a normal fresh start rather than leaving a broken prompt on screen.
   */
  const handleResumeRecovery = async () => {
    if (!recoveryInfo) return;
    const { session: recovered, chunkCount, latestTsMs, lastSpeaker } = recoveryInfo;

    if (chunkCount === 0) {
      await deleteSession(recovered.sessionId);
      setRecoveryInfo(null);
      setRecoveryError(RECOVERY_FAILED_COPY);
      return;
    }

    try {
      const seedSeq = await nextSeqFor(recovered.sessionId);

      resumeSeedRef.current = {
        sessionId: recovered.sessionId,
        mimeType: recovered.mimeType,
        startedAt: recovered.startedAt,
        seedSeq,
        tsOffsetMs: latestTsMs,
        // D-25: no press at all means the crash happened before anyone was
        // ever marked, so the take is still on the opening default.
        initialSpeaker: lastSpeaker ?? "interviewer",
      };
      setIsResumingSession(true);
      setDeclaredSpeaker(recovered.declaredSpeaker);
      setRecoveryInfo(null);
    } catch {
      await deleteSession(recovered.sessionId);
      setRecoveryInfo(null);
      setRecoveryError(RECOVERY_FAILED_COPY);
    }
  };

  /**
   * "Keep as-is" (D-29, T-04-15-04): closes the recovered take at its last
   * durable chunk without resuming it, so the audio can be kept without
   * being continued. Clears the prompt regardless of outcome — a failed
   * close has nothing left worth resuming either — and surfaces the
   * existing recovery-failed copy rather than silently dropping the prompt
   * when the store reports nothing was actually saved (`closingMs === 0`).
   */
  const handleSaveAsIs = async () => {
    if (!recoveryInfo) return;
    const { sessionId } = recoveryInfo.session;
    const closingMs = await closeRecoveredSession(sessionId);
    setRecoveryInfo(null);
    if (closingMs === 0) {
      setRecoveryError(RECOVERY_FAILED_COPY);
      return;
    }
    const takes = await listStoppedSessions();
    setStoppedTakes(takes);
  };

  /**
   * Abandons a pending resume: nulls the resume seed as well as the flag that
   * locks the role toggle, and reports whether a seed was actually pending
   * when it was called. The recovered session record itself is untouched and
   * still carries status "recording", so the recovery prompt is offered
   * again on the next page load.
   */
  const abandonPendingResume = (): boolean => {
    const wasPending = resumeSeedRef.current !== null;
    resumeSeedRef.current = null;
    setIsResumingSession(false);
    return wasPending;
  };

  /**
   * LIVE-28: consent already resets at stop (D-34), so accepting it again is
   * the natural return to idle — no separate "record another" control is
   * needed. When accepted from the stopped state, this also clears the
   * finished take's live-state pointer (the take itself stays in
   * `stoppedTakes`, untouched) and resets the marked speaker back to the
   * D-25 default so the next take doesn't open on the previous take's last
   * press. `declaredSpeaker` is deliberately left alone — it describes the
   * operator, who hasn't changed.
   */
  const handleAcceptConsent = () => {
    if (status === "stopped") {
      setStatus("idle");
      setSession(null);
      setElapsedMs(0);
      setSpeaker("interviewer");
    }
    setHasConsented(true);
  };

  const handleConnect = async () => {
    setError("");
    setStatus("connecting");
    setMicFellBackToDefault(false);

    try {
      const { stream: mic, usedFallback } = await acquireMic(selectedDeviceId);

      if (cancelledRef.current) {
        stopStream(mic);
        return;
      }

      setMicStream(mic);
      setMicFellBackToDefault(usedFallback);
      setStatus("armed");
    } catch (err) {
      const seedWasPending = abandonPendingResume();
      setStatus("idle");
      // D-34: an aborted connect never happened as a take — the consent
      // standing for it must not survive to the next attempt.
      setHasConsented(false);
      setError(
        seedWasPending
          ? `${describeCaptureError(err)} Your unfinished recording is still saved — reload the page to try recovering it again.`
          : describeCaptureError(err)
      );
    }
  };

  /**
   * D-36: re-acquires the microphone with the newly chosen device while the
   * tool is armed but not yet recording — the control is disabled entirely
   * during an active recording (see MicSetup's `disabled` prop), so this
   * path is never reachable mid-take. The previous stream is stopped before
   * the new request so no microphone is ever left open across the switch;
   * `acquireMic` itself handles a disappeared device by falling back to the
   * system default and reporting it, never substituting silently.
   */
  const handleSelectDevice = async (deviceId: string | undefined) => {
    setSelectedDeviceId(deviceId);
    if (status !== "armed") return;

    setError("");
    const previousStream = micStream;
    stopStream(previousStream);

    try {
      const { stream: mic, usedFallback } = await acquireMic(deviceId);
      if (cancelledRef.current) {
        stopStream(mic);
        return;
      }
      setMicStream(mic);
      setMicFellBackToDefault(usedFallback);
    } catch (err) {
      // The old stream is already stopped and the new request failed —
      // there is no live microphone left to arm with, so fall all the way
      // back to idle rather than leaving the armed UI pointing at nothing.
      setMicStream(null);
      setStatus("idle");
      setHasConsented(false);
      setError(describeCaptureError(err));
    }
  };

  /** D-37: marks one side's pre-flight check cleared, the instant MicSetup's rolling sample first latches for that side. */
  const handlePreflightSideCleared = (side: Speaker) => {
    setPreflightCleared((prev) => ({ ...prev, [side]: true }));
  };

  /** D-37: the compact-view "run pre-flight again" control — resets both flags and reopens the full step. */
  const handlePreflightReset = () => {
    setPreflightCleared({ interviewer: false, candidate: false });
  };

  const handleBegin = async () => {
    if (!micStream) return;
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
        setError(describeCaptureError(err));
        return;
      }
    }

    let sessionId: string | null = null;

    try {
      // Opts out of the auto-close-on-versionchange every other connection
      // gets (see openRecordingDB) — this is the one handle this app
      // deliberately keeps open across awaits, and auto-closing it the
      // instant "Clear stored data" is clicked would silently cut off a
      // live take's storage mid-recording.
      const db = await openRecordingDB({ autoCloseOnVersionChange: false });
      // Tracked immediately, not after the awaited createSession below
      // (LIVE-09): a rejection between here and the old assignment point
      // used to leave this connection referenced by nothing, open forever
      // with no path left to close it (D-12).
      dbRef.current = db;

      // Mirrors handleConnect's unmount guard (WR-01): openRecordingDB is
      // the first await in this function, so the section may already have
      // unmounted by the time it resolves. Bail before wiring anything else
      // to a stream/db the unmount cleanup effect has already torn down.
      if (cancelledRef.current) {
        db.close();
        dbRef.current = null;
        return;
      }

      sessionId = resumeSeed?.sessionId ?? crypto.randomUUID();
      const seedSeq = resumeSeed?.seedSeq ?? 0;
      const tsOffsetMs = resumeSeed?.tsOffsetMs ?? 0;

      clockOriginRef.current = performance.now();
      pausedMsRef.current = 0;
      pauseStartRef.current = null;
      tsOffsetMsRef.current = tsOffsetMs;

      // WINDOWS #2: the session row is written — with durable ("strict")
      // IndexedDB durability, see createSession's doc comment — before the
      // recorder can produce a single chunk, not after. The recorder used to
      // start first, so a chunk write's transaction could exist entirely
      // independently of whether the session row it belongs to had actually
      // been created yet; findResumableSession only ever looks at that row,
      // so a reload landing in that window had real audio on disk with
      // nothing to point a recovery prompt at. Creating the row first closes
      // the window rather than narrowing it.
      const newSession = await createSession(db, {
        sessionId,
        startedAt: resumeSeed?.startedAt ?? Date.now(),
        clockOrigin: clockOriginRef.current,
        declaredSpeaker,
        mimeType,
      });

      // Second unmount guard (WR-01): createSession is a second await gap,
      // and by now it has durably written a "recording" session row with
      // zero chunks. If the section unmounted while that write was in
      // flight, the row must not be left behind — it would otherwise
      // survive to falsely trigger the crash-recovery prompt on next load.
      //
      // Only a row this call actually originated may be deleted. On a resume
      // `sessionId` is the RECOVERED take's id and createSession re-marked
      // that existing row "recording" rather than creating anything — so
      // deleting here would destroy the very audio crash recovery exists to
      // preserve. A resumed take's row is left exactly as recovery found it.
      if (cancelledRef.current) {
        if (!resumeSeed) await deleteSession(sessionId);
        db.close();
        dbRef.current = null;
        return;
      }

      const handle = startRecorder(micStream, mimeType, clock, (meta, blob) => {
        const adjusted = { ...meta, sessionId, seq: meta.seq + seedSeq };
        pendingChunkWritesRef.current = appendChunk(db, adjusted, blob).catch((chunkErr) => {
          setError(chunkErr instanceof Error ? chunkErr.message : "Failed to save a recording chunk.");
        });
      });
      // Same reasoning as dbRef.current above: tracked the moment it exists
      // so a later failure's catch can still stop it rather than leaving a
      // MediaRecorder running with no session behind it.
      recorderHandleRef.current = handle;

      resumeSeedRef.current = null;
      setIsResumingSession(false);
      setSession(newSession);
      // D-25/D-26: a fresh take always opens on the interviewer default; a
      // resumed take is the *same* take, so it carries forward whoever was
      // actually marked when the crash happened (T-04-15-02) — reopening on
      // the interviewer here would insert an unmade speaker change at the
      // seam. Two branches, not a shared default, because the two cases mean
      // different things.
      setSpeaker(resumeSeed ? resumeSeed.initialSpeaker : "interviewer");
      setElapsedMs(tsOffsetMs);
      setStatus("recording");

      // A wake-lock refusal is a soft warning, never a reason to stop or
      // fail to start a recording (D-14).
      const gotLock = await acquireWakeLock();
      setWakeLockUnavailable(!gotLock);
      wakeLockDismissedRef.current = false;
    } catch (err) {
      // Neither the connection nor the recorder may outlive a failed Begin
      // (D-12, CR-01) — after this catch returns, nothing else holds a
      // reference to close either one.
      recorderHandleRef.current?.stopAll().catch(() => {});
      recorderHandleRef.current = null;
      // WR-01: if createSession already durably wrote a "recording" row
      // before startRecorder threw, that row must not survive this failed
      // attempt — left behind, it falsely triggers the crash-recovery
      // prompt on the next load for what was actually a normal failure.
      //
      // Never on a resume, though: there `sessionId` names the recovered
      // take, whose chunks deleteSession would take with it. A resume that
      // fails to start must leave the crashed take exactly where it was, so
      // the operator can try again or save it as-is.
      if (dbRef.current && sessionId && !resumeSeed) {
        await deleteSession(sessionId);
      }
      dbRef.current?.close();
      dbRef.current = null;
      setError(err instanceof Error ? err.message : "Could not start recording.");
    }
  };

  /**
   * One key, two states, and no third state to get stuck in (D-23). Guarded
   * so a press does nothing unless a recording is actually active — a press
   * outside an active recording is not recorded at all. Writes through
   * `appendTagPress` with the **next** speaker as the record's value; a
   * failed write surfaces through the same error state a failed chunk write
   * uses, and must not stop the recording.
   */
  const flipSpeaker = () => {
    if (status !== "recording" || !dbRef.current || !session) return;
    const next: Speaker = speaker === "interviewer" ? "candidate" : "interviewer";
    setSpeaker(next);
    appendTagPress(dbRef.current, { sessionId: session.sessionId, tsMs: clock(), speaker: next }).catch(
      (err) => {
        setError(err instanceof Error ? err.message : "Failed to save a tag press.");
      }
    );
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

  /**
   * Releases everything handleStop must release regardless of whether the
   * storage write it guards succeeds: the MediaStream, the wake lock, and
   * the IndexedDB handle (CR-01, CR-02, D-12, D-33). Reads from
   * liveStreamRef rather than the micStream closure variable deliberately —
   * the ref always holds the current stream. Every operation here is
   * idempotent — stopStream on an already-stopped track is a no-op,
   * releaseWakeLock is documented safe to call repeatedly — so calling this
   * twice is harmless.
   */
  const teardownCapture = () => {
    stopStream(liveStreamRef.current);
    releaseWakeLock();
    dbRef.current?.close();
    dbRef.current = null;
    // Clearing the stream ref (not just stopping its tracks) is what
    // triggers the level-meter effect's cleanup — otherwise the meter's
    // AudioContext and RecordingControls' rAF loop would stay open after a
    // session has stopped.
    setMicStream(null);
    // D-34: the take this consent was given for just ended — the gate shows
    // again the moment the next Start is attempted, with nothing carried
    // forward.
    setHasConsented(false);
  };

  const handleStop = async () => {
    if (!recorderHandleRef.current || !session || !dbRef.current) return;
    setError("");
    const db = dbRef.current;
    try {
      await recorderHandleRef.current.stopAll();
      await pendingChunkWritesRef.current;

      const finalDuration = clock();

      // Hardware and status transition unconditionally, before the awaited
      // storage write below — a rejected markSessionStopped (quota
      // pressure, a blocked transaction, mid-session eviction) must never
      // leave the microphone or wake lock held, or the browser's recording
      // indicator lit after the visitor believes they stopped (CR-02).
      setWakeLockUnavailable(false);
      setElapsedMs(finalDuration);
      setStatus("stopped");

      await markSessionStopped(db, session.sessionId, finalDuration);
      setSession({ ...session, status: "stopped", durationMs: finalDuration });
      // LIVE-09 follow-up: this take is now durably on disk — tell App.tsx
      // so "Clear stored data" re-enables itself without waiting for a
      // reload to re-run its mount-time probe (see LiveInterviewProps doc).
      onRecordingStored?.();

      // Derives the finished take's byte total now that the session has
      // stopped (LIVE-08) — separate from a download click's own full blob
      // assembly. The download surface itself no longer reads this; it reads
      // the refetched take list below (D-31).
      const result = await assembleSessionBlob(session.sessionId, session.mimeType);

      // Records the finished take's total byte size once, so listing N takes
      // never reads N takes' worth of blobs, then refetches the list so the
      // take that just finished appears in it (D-31, LIVE-08).
      await updateSessionSize(db, session.sessionId, result.summary.totalBytes);
      const takes = await listStoppedSessions();
      setStoppedTakes(takes);
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
   * Finds one take's own record by id — from the refetched list, or from the
   * live `session` pointer for the moment right after Stop, before the list
   * refetch has resolved. Every download and delete needs a specific take's
   * own `mimeType`/`durationMs`/etc., not whichever take is currently being
   * recorded (D-31: several takes can be downloaded, and each pair must use
   * its own take's fields).
   */
  const findTake = (sessionId: string): RecordingSession | null =>
    stoppedTakes.find((t) => t.sessionId === sessionId) ?? (session?.sessionId === sessionId ? session : null);

  /**
   * Re-assembles one take's audio blob from storage and hands it to the
   * visitor (LIVE-08). Deliberately separate from the summary assembly in
   * handleStop — that call discards its blob once the summary is read, so
   * the download surface doesn't hold a full recording in memory before the
   * visitor has asked for it. Guarded against a second concurrent press of
   * the same button; a concurrent sidecar download, or a download of a
   * different take, is unaffected (each is keyed independently by
   * `${sessionId}:audio`/`${sessionId}:sidecar`).
   */
  const handleDownloadAudio = async (sessionId: string, filename: string) => {
    const key = `${sessionId}:audio`;
    if (downloading[key]) return;
    const take = findTake(sessionId);
    if (!take) return;
    setError("");
    setDownloading((prev) => ({ ...prev, [key]: true }));
    try {
      const result = await assembleSessionBlob(sessionId, take.mimeType);
      if (result.blob) {
        downloadBlob(filename, result.blob);
      } else {
        setError("Could not assemble the recording for download.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assemble the recording for download.");
    } finally {
      setDownloading((prev) => ({ ...prev, [key]: false }));
    }
  };

  /**
   * Reads one take's tag presses, derives spans against that take's stored
   * `durationMs` (D-29's boundary), and hands the result to `downloadJson`
   * as a `TagTrackSidecar` (D-30). Keyed independently of the audio download
   * so the two never block each other.
   */
  const handleDownloadSidecar = async (sessionId: string, filename: string) => {
    const key = `${sessionId}:sidecar`;
    if (downloading[key]) return;
    const take = findTake(sessionId);
    if (!take) return;
    setError("");
    setDownloading((prev) => ({ ...prev, [key]: true }));
    try {
      const presses = await listTagPresses(sessionId);
      const spans = deriveSpans(presses, take.durationMs);
      const sidecar: TagTrackSidecar = {
        sessionId,
        mimeType: take.mimeType,
        clockOrigin: take.clockOrigin,
        startedAt: take.startedAt,
        declaredSpeaker: take.declaredSpeaker,
        spans,
      };
      downloadJson(filename, sidecar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the tag-track sidecar.");
    } finally {
      setDownloading((prev) => ({ ...prev, [key]: false }));
    }
  };

  /**
   * Deletes one take and refetches the list (D-32). Guarded against a second
   * concurrent press for the same take id — a concurrent delete of a
   * different take is unaffected. If the deleted take is also the one the
   * completion line (`session`/`elapsedMs`, kept for
   * `RecordingControls`'s stopped-state text) refers to, that state is
   * cleared too, so nothing on screen still describes a take that no longer
   * exists.
   */
  const handleDeleteTake = async (sessionId: string) => {
    if (deletingIds[sessionId]) return;
    setDeletingIds((prev) => ({ ...prev, [sessionId]: true }));
    try {
      await deleteSession(sessionId);
      const takes = await listStoppedSessions();
      setStoppedTakes(takes);
      if (session?.sessionId === sessionId) {
        setSession(null);
        setElapsedMs(0);
      }
    } finally {
      setDeletingIds((prev) => ({ ...prev, [sessionId]: false }));
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

  return (
    <ToolSection
      id="tool-live-interview"
      step="Tool 4"
      title="Live Interview"
      subtitle="Record both people in the room through one microphone — nothing leaves this browser"
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
            pressCount={recoveryInfo.pressCount}
            onResume={handleResumeRecovery}
            onSaveAsIs={handleSaveAsIs}
            onDiscard={handleDiscardRecovery}
          />
        ) : null}

        {recoveryError && (
          <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{recoveryError}</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* D-24 declaration stays reachable while the consent gate shows, so
            the operator can set their side before consenting (D-34). */}
        <RoleToggle
          declaredSpeaker={declaredSpeaker}
          onDeclaredSpeakerChange={setDeclaredSpeaker}
          disabled={isResumingSession || (status !== "idle" && status !== "armed")}
        />

        {/* D-34: re-asked before every take, wrapping only the acquisition
            and recording controls — never the download surface below, so a
            re-ask can't hide a take that just finished (D-31). */}
        {!hasConsented ? (
          <ConsentGate onAccept={handleAcceptConsent} declaredSpeaker={declaredSpeaker} />
        ) : (
          <>
            {/* D-36: only meaningful once permission is granted and a stream
                exists — before Connect there is nothing to list or switch. */}
            {micStream && (
              <MicSetup
                devices={inputDevices}
                selectedDeviceId={selectedDeviceId}
                onSelectDevice={handleSelectDevice}
                fellBackToDefault={micFellBackToDefault}
                disabled={status === "recording" || status === "paused"}
                micMeterRef={micMeterRef}
                preflightCleared={preflightCleared}
                onPreflightSideCleared={handlePreflightSideCleared}
                onPreflightReset={handlePreflightReset}
              />
            )}
            <RecordingControls
              status={status}
              micStream={micStream}
              elapsedMs={elapsedMs}
              micMeterRef={micMeterRef}
              speaker={speaker}
              preflightCleared={preflightCleared}
              onConnect={handleConnect}
              onBegin={handleBegin}
              onPause={handlePause}
              onResume={handleResume}
              onStop={handleStop}
              onFlipSpeaker={flipSpeaker}
              connectButtonRef={connectButtonRef}
              warnings={warnings}
            />
          </>
        )}

        {/* D-31: every stopped take, newest-first — a sibling of the consent
            branch above so a re-ask can never hide a finished take's
            downloads (04-12's structural property, preserved here). */}
        <RecordingDownloads
          takes={stoppedTakes}
          downloading={downloading}
          deletingIds={deletingIds}
          hasActiveTake={status === "connecting" || status === "armed" || status === "recording" || status === "paused"}
          onDownloadAudio={handleDownloadAudio}
          onDownloadSidecar={handleDownloadSidecar}
          onDeleteTake={handleDeleteTake}
        />
      </div>
    </ToolSection>
  );
};
