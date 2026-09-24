/**
 * Dependency-free assertion script for the tag-track behaviour block in
 * 04-11-PLAN.md. Run with the already-installed `tsx`:
 *
 *   node_modules/.bin/tsx scripts/check-tag-track.ts
 *
 * This is a verification gate, not a test suite — the project's first real
 * tests are Phase 7 (LIVE-25) and this script does not pre-empt them. It
 * imports nothing that touches a browser global at module load: `deriveSpans`
 * is pure, and `audioElapsedMs` is asserted algebraically rather than by
 * calling `performance.now()`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  deriveSpans,
  sortTakesNewestFirst,
  normaliseSessionRecord,
  recoveredEndMs,
  summariseChunks,
  shouldDeleteAudio,
} from "../src/lib/recordingStore";
import {
  audioElapsedMs,
  pickSupportedMimeType,
  isRecordingFormatSupported,
  extensionForMimeType,
} from "../src/lib/recorder";
import {
  evaluatePreflightSample,
  computeRmsLevel,
  PREFLIGHT_FLOOR_RMS,
  PREFLIGHT_SUSTAIN_MS,
} from "../src/lib/levelMeter";
import type { PreflightSampleState } from "../src/lib/levelMeter";
import { describeCaptureError, UNSUPPORTED_FORMAT_REASON } from "../src/lib/audioCapture";
import { downsampleTo16k, peakFrameRms, sliceByTime, TARGET_SAMPLE_RATE } from "../src/lib/audioResample";
import {
  SPAN_FLOOR_MS,
  MAX_WINDOW_MS,
  WINDOW_OVERLAP_MS,
  SILENCE_FRAME_MS,
  SILENCE_FLOOR_RMS,
  mergeSubFloorSpans,
  subdivideSpan,
  planWindows,
  eligibleWindows,
  dropSeamDuplicates,
} from "../src/lib/windowCutting";
import { effectiveSpeaker, groupIntoTurns, moveTurnBoundary } from "../src/lib/transcriptTurns";
import { formatTranscriptText } from "../src/lib/transcriptText";
import { formatElapsed } from "../src/lib/formatTime";
import { normalizeForMatch, findQuoteInSegments, fingerprintSegments } from "../src/lib/quoteMatcher";
import {
  screenDeliveryProse,
  splitSentences,
  DELIVERY_TERMS,
  SCREENED_FIELD_PATHS,
  WITHHELD_REMARK_MARKER,
} from "../src/lib/deliveryScreen";
import {
  deriveSilentGaps,
  deriveMissedFollowUps,
  deriveJdCoverage,
  deriveScoreRow,
  filterEvidencedResumeFindings,
} from "../src/lib/feedbackRollups";
import { feedbackToPlainText } from "../src/lib/exportFeedback";
import type { FeedbackExportMeta } from "../src/lib/exportFeedback";
import type {
  TagPress,
  RecordingSession,
  AudioChunkMeta,
  TagSpan,
  TranscriptSegment,
  Coverage,
  SubAsk,
  SubAskSource,
  Exchange,
  FeedbackDocument,
} from "../src/types";

// audioElapsedMs(clockOrigin, pausedMs, offsetMs) === performance.now() - clockOrigin - pausedMs + offsetMs.
// Asserted algebraically: with clockOrigin === performance.now() at call time
// (approximated by capturing "now" immediately before the call) the result
// must equal -pausedMs + offsetMs, within a small scheduling tolerance.
{
  const now = performance.now();
  const result = audioElapsedMs(now, 5000, 200);
  const expected = -5000 + 200;
  assert.ok(
    Math.abs(result - expected) < 50,
    `audioElapsedMs(now, 5000, 200) should be ~${expected}, got ${result}`
  );
}

// Pause time is fully excluded: a larger pausedMs must reduce the result by
// exactly that much (net of tiny scheduling drift between the two calls).
{
  const origin = performance.now() - 100000; // pretend the take started 100s ago
  const a = audioElapsedMs(origin, 0);
  const b = audioElapsedMs(origin, 30000);
  assert.ok(
    Math.abs(a - b - 30000) < 50,
    `audioElapsedMs should shrink by exactly the paused span, got a=${a} b=${b}`
  );
}

// deriveSpans([], 60000) returns exactly one span, the opening interviewer
// default, needing zero presses (D-25).
{
  const spans = deriveSpans([], 60000);
  assert.deepEqual(spans, [{ startMs: 0, endMs: 60000, speaker: "interviewer" }]);
}

// Three spans, no gap, no overlap, from two presses.
{
  const presses: TagPress[] = [
    { sessionId: "s1", tsMs: 10000, speaker: "candidate" },
    { sessionId: "s1", tsMs: 25000, speaker: "interviewer" },
  ];
  const spans = deriveSpans(presses, 40000);
  assert.deepEqual(spans, [
    { startMs: 0, endMs: 10000, speaker: "interviewer" },
    { startMs: 10000, endMs: 25000, speaker: "candidate" },
    { startMs: 25000, endMs: 40000, speaker: "interviewer" },
  ]);
}

// Unsorted input is sorted by tsMs before pairing.
{
  const presses: TagPress[] = [
    { sessionId: "s1", tsMs: 25000, speaker: "interviewer" },
    { sessionId: "s1", tsMs: 10000, speaker: "candidate" },
  ];
  const spans = deriveSpans(presses, 40000);
  assert.deepEqual(spans, [
    { startMs: 0, endMs: 10000, speaker: "interviewer" },
    { startMs: 10000, endMs: 25000, speaker: "candidate" },
    { startMs: 25000, endMs: 40000, speaker: "interviewer" },
  ]);
}

// Every returned span list starts at 0 and its last span ends exactly at
// finalAudioElapsedMs.
{
  const presses: TagPress[] = [{ sessionId: "s1", tsMs: 5000, speaker: "candidate" }];
  const spans = deriveSpans(presses, 20000);
  assert.equal(spans[0].startMs, 0);
  assert.equal(spans[spans.length - 1].endMs, 20000);
}

// Two presses in the same millisecond produce no zero-length or duplicated
// span, and adjacent same-speaker spans are merged.
{
  const presses: TagPress[] = [
    { sessionId: "s1", tsMs: 5000, speaker: "candidate" },
    { sessionId: "s1", tsMs: 5000, speaker: "interviewer" },
  ];
  const spans = deriveSpans(presses, 10000);
  for (const span of spans) {
    assert.ok(span.endMs > span.startMs, `span ${JSON.stringify(span)} must not be zero-length`);
  }
  // Strictly increasing and still partitions the recording end to end.
  for (let i = 1; i < spans.length; i++) {
    assert.equal(spans[i].startMs, spans[i - 1].endMs, "spans must be contiguous with no gap");
  }
  assert.equal(spans[0].startMs, 0);
  assert.equal(spans[spans.length - 1].endMs, 10000);
  assert.deepEqual(spans, [{ startMs: 0, endMs: 10000, speaker: "interviewer" }]);
}

// listTagPresses' validation discipline is exercised indirectly through
// deriveSpans' contract above (listTagPresses itself requires a live
// IndexedDB and cannot run under Node) — deriveSpans is what this script can
// assert without a browser.

const baseSession: RecordingSession = {
  sessionId: "base",
  startedAt: 1000,
  clockOrigin: 0,
  declaredSpeaker: "interviewer",
  mimeType: "audio/webm",
  status: "stopped",
  durationMs: 5000,
  sizeBytes: 100,
};

// sortTakesNewestFirst orders sessions by startedAt descending.
{
  const older: RecordingSession = { ...baseSession, sessionId: "a", startedAt: 1000 };
  const newer: RecordingSession = { ...baseSession, sessionId: "b", startedAt: 2000 };
  const sorted = sortTakesNewestFirst([older, newer]);
  assert.deepEqual(sorted.map((s) => s.sessionId), ["b", "a"], "newest startedAt must sort first");
}

// sortTakesNewestFirst is stable for two sessions sharing the same startedAt.
{
  const first: RecordingSession = { ...baseSession, sessionId: "first", startedAt: 1000 };
  const second: RecordingSession = { ...baseSession, sessionId: "second", startedAt: 1000 };
  const sorted = sortTakesNewestFirst([first, second]);
  assert.deepEqual(
    sorted.map((s) => s.sessionId),
    ["first", "second"],
    "equal startedAt must preserve input order (stable sort)"
  );
}

// sortTakesNewestFirst does not mutate the array passed to it.
{
  const a: RecordingSession = { ...baseSession, sessionId: "a", startedAt: 1000 };
  const b: RecordingSession = { ...baseSession, sessionId: "b", startedAt: 2000 };
  const original = [a, b];
  const originalOrder = original.map((s) => s.sessionId);
  sortTakesNewestFirst(original);
  assert.deepEqual(original.map((s) => s.sessionId), originalOrder, "input array must not be mutated");
}

// normaliseSessionRecord defaults sizeBytes to 0 when the field is absent.
{
  const raw = {
    sessionId: "s1",
    startedAt: 1000,
    clockOrigin: 0,
    declaredSpeaker: "candidate",
    mimeType: "audio/webm",
    status: "stopped",
    durationMs: 5000,
  };
  const normalised = normaliseSessionRecord(raw);
  assert.ok(normalised, "a record with no sizeBytes field must still normalise");
  assert.equal(normalised?.sizeBytes, 0);
}

// normaliseSessionRecord defaults sizeBytes to 0 when present but not a number.
{
  const raw = {
    sessionId: "s1",
    startedAt: 1000,
    clockOrigin: 0,
    declaredSpeaker: "candidate",
    mimeType: "audio/webm",
    status: "stopped",
    durationMs: 5000,
    sizeBytes: "not-a-number",
  };
  const normalised = normaliseSessionRecord(raw);
  assert.ok(normalised, "a record with a non-number sizeBytes must still normalise");
  assert.equal(normalised?.sizeBytes, 0);
}

// computeRmsLevel (LIVE-04): zero-length input returns 0.
{
  const result = computeRmsLevel(new Float32Array(0));
  assert.equal(result, 0, "an empty buffer must return 0");
}

// computeRmsLevel returns the true RMS of a known in-range buffer: [0.3, 0.4]
// has RMS sqrt((0.09 + 0.16) / 2) = sqrt(0.125), well under the clamp.
{
  const samples = new Float32Array([0.3, 0.4]);
  const result = computeRmsLevel(samples);
  const expected = Math.sqrt(0.125);
  assert.ok(
    Math.abs(result - expected) < 1e-6,
    `expected RMS of [0.3, 0.4] to be ~${expected}, got ${result}`
  );
}

// computeRmsLevel clamps to 1 for out-of-range samples whose true RMS
// exceeds 1.
{
  const samples = new Float32Array([5, 5, 5, 5]);
  const result = computeRmsLevel(samples);
  assert.equal(result, 1, "an out-of-range buffer must clamp to 1, not return its true (>1) RMS");
}

// computeRmsLevel of a DC-offset buffer of all-same-magnitude samples
// returns that magnitude exactly.
{
  const samples = new Float32Array([0.25, 0.25, 0.25, 0.25]);
  const result = computeRmsLevel(samples);
  assert.equal(result, 0.25, "a constant-magnitude buffer's RMS must equal that magnitude");
}

// computeRmsLevel does not mutate its input.
{
  const samples = new Float32Array([0.1, 0.5, 0.9]);
  const copy = Float32Array.from(samples);
  computeRmsLevel(samples);
  assert.deepEqual(Array.from(samples), Array.from(copy), "computeRmsLevel must not mutate its input buffer");
}

// pickSupportedMimeType / isRecordingFormatSupported (LIVE-26, D-05): these
// read MediaRecorder and navigator.mediaDevices.getUserMedia, neither of
// which exists under Node, so each block stubs globalThis and restores the
// originals immediately after so no stub leaks into a later block.
{
  const originalMediaRecorder = (globalThis as any).MediaRecorder;
  const originalNavigator = (globalThis as any).navigator;
  // `navigator` is defined as a getter-only accessor on the Node global
  // object, so a plain assignment throws — it must be redefined instead.
  const setNavigator = (value: unknown) =>
    Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });

  // pickSupportedMimeType returns the FIRST supported candidate in
  // MIME_CANDIDATES order (["audio/webm;codecs=opus", "audio/webm",
  // "audio/ogg;codecs=opus"]), not merely any supported one.
  (globalThis as any).MediaRecorder = {
    isTypeSupported: (type: string) => type === "audio/webm" || type === "audio/ogg;codecs=opus",
  };
  {
    const result = pickSupportedMimeType();
    assert.equal(
      result,
      "audio/webm",
      "pickSupportedMimeType must return the first supported candidate in declared order, not any supported one"
    );
  }

  // pickSupportedMimeType throws when no candidate is supported.
  (globalThis as any).MediaRecorder = { isTypeSupported: () => false };
  assert.throws(
    () => pickSupportedMimeType(),
    /No supported audio recording format/,
    "pickSupportedMimeType must throw when no candidate is supported"
  );

  // isRecordingFormatSupported is false when MediaRecorder is undefined,
  // decided on capability probes alone (D-05: browser-family-agnostic).
  delete (globalThis as any).MediaRecorder;
  setNavigator({ mediaDevices: { getUserMedia: () => {} } });
  assert.equal(
    isRecordingFormatSupported(),
    false,
    "isRecordingFormatSupported must be false when MediaRecorder is undefined"
  );

  // false when getUserMedia is missing, even with MediaRecorder present and
  // capable.
  (globalThis as any).MediaRecorder = { isTypeSupported: () => true };
  setNavigator({ mediaDevices: {} });
  assert.equal(
    isRecordingFormatSupported(),
    false,
    "isRecordingFormatSupported must be false when getUserMedia is missing"
  );

  // false when no candidate type is supported, even with both globals
  // present.
  (globalThis as any).MediaRecorder = { isTypeSupported: () => false };
  setNavigator({ mediaDevices: { getUserMedia: () => {} } });
  assert.equal(
    isRecordingFormatSupported(),
    false,
    "isRecordingFormatSupported must be false when no candidate MIME type is supported"
  );

  // true when MediaRecorder exists, getUserMedia exists, and a candidate is
  // supported — capability probes alone decide it, with no user-agent check.
  (globalThis as any).MediaRecorder = { isTypeSupported: () => true };
  setNavigator({ mediaDevices: { getUserMedia: () => {} } });
  assert.equal(
    isRecordingFormatSupported(),
    true,
    "isRecordingFormatSupported must be true when every capability probe passes"
  );

  if (originalMediaRecorder === undefined) delete (globalThis as any).MediaRecorder;
  else (globalThis as any).MediaRecorder = originalMediaRecorder;
  setNavigator(originalNavigator);
}

// extensionForMimeType (LIVE-08): mirrors the MIME negotiation in this same
// file, now exported and importable under Node (moved out of the .tsx
// component that could not be imported here).
{
  assert.equal(extensionForMimeType("audio/ogg"), "ogg");
  assert.equal(extensionForMimeType("audio/webm"), "webm");
  assert.equal(
    extensionForMimeType("audio/webm;codecs=opus"),
    "webm",
    "the codec-suffixed webm form pickSupportedMimeType actually produces must map to webm"
  );
  assert.equal(
    extensionForMimeType("audio/ogg;codecs=opus"),
    "ogg",
    "the codec-suffixed ogg form pickSupportedMimeType actually produces must map to ogg"
  );
}

// describeCaptureError (LIVE-26): each documented branch of the Copywriting
// Contract, asserted against the exported constants rather than hardcoded
// copy where an export exists.
{
  // NotAllowedError maps to the blocked-microphone copy. This string is not
  // exported as a constant by audioCapture.ts, so it is duplicated here
  // verbatim rather than hardcoding an approximation.
  const blocked = describeCaptureError(new DOMException("denied", "NotAllowedError"));
  assert.equal(
    blocked,
    "Microphone access was blocked. Click the camera/mic icon in your browser's address bar, allow microphone access, then try again."
  );

  // NotSupportedError maps to UNSUPPORTED_FORMAT_REASON.
  assert.equal(describeCaptureError(new DOMException("nope", "NotSupportedError")), UNSUPPORTED_FORMAT_REASON);

  // A plain Error whose message matches /supported audio recording format/
  // also maps to UNSUPPORTED_FORMAT_REASON — this is the bridge to
  // pickSupportedMimeType's thrown message.
  assert.equal(
    describeCaptureError(new Error("No supported audio recording format in this browser.")),
    UNSUPPORTED_FORMAT_REASON
  );

  // Any other Error passes its own message through unchanged.
  assert.equal(describeCaptureError(new Error("some other failure")), "some other failure");

  // A non-Error value returns the generic fallback string.
  assert.equal(describeCaptureError("not an error at all"), "Something went wrong connecting the microphone.");
}

// 04-14: evaluatePreflightSample (D-37) — the pre-flight's pure, latching
// sample evaluator. Uses PREFLIGHT_FLOOR_RMS / PREFLIGHT_SUSTAIN_MS directly
// so this stays coupled to whatever the constants are actually set to.
const FRESH_STATE: PreflightSampleState = { peakLevel: 0, sustainedMs: 0, cleared: false };
const SAMPLE_MS = 50;

// A level below the floor returns a state whose sustained duration is 0.
{
  const result = evaluatePreflightSample(
    FRESH_STATE,
    PREFLIGHT_FLOOR_RMS - 0.01,
    SAMPLE_MS,
    PREFLIGHT_FLOOR_RMS,
    PREFLIGHT_SUSTAIN_MS
  );
  assert.equal(result.sustainedMs, 0, "a below-floor sample must reset sustainedMs to 0");
  assert.equal(result.cleared, false);
}

// Consecutive levels at or above the floor accumulate the sustained
// duration by the sample interval each time.
{
  const first = evaluatePreflightSample(
    FRESH_STATE,
    PREFLIGHT_FLOOR_RMS,
    SAMPLE_MS,
    PREFLIGHT_FLOOR_RMS,
    PREFLIGHT_SUSTAIN_MS
  );
  assert.equal(first.sustainedMs, SAMPLE_MS);
  const second = evaluatePreflightSample(
    first,
    PREFLIGHT_FLOOR_RMS,
    SAMPLE_MS,
    PREFLIGHT_FLOOR_RMS,
    PREFLIGHT_SUSTAIN_MS
  );
  assert.equal(second.sustainedMs, SAMPLE_MS * 2, "sustainedMs must accumulate by sampleMs each call");
  assert.equal(second.cleared, false, "must not clear before reaching the sustain threshold");
}

// Once the sustained duration reaches the sustain threshold, the returned
// state is cleared.
{
  let state = FRESH_STATE;
  const steps = Math.ceil(PREFLIGHT_SUSTAIN_MS / SAMPLE_MS);
  for (let i = 0; i < steps; i++) {
    state = evaluatePreflightSample(state, PREFLIGHT_FLOOR_RMS, SAMPLE_MS, PREFLIGHT_FLOOR_RMS, PREFLIGHT_SUSTAIN_MS);
  }
  assert.ok(state.sustainedMs >= PREFLIGHT_SUSTAIN_MS);
  assert.equal(state.cleared, true, "reaching the sustain threshold must clear the state");
}

// A cleared state stays cleared on a subsequent below-floor sample — the
// result latches, so a person who spoke and then stopped has still passed.
{
  const cleared: PreflightSampleState = { peakLevel: 0.5, sustainedMs: PREFLIGHT_SUSTAIN_MS, cleared: true };
  const afterSilence = evaluatePreflightSample(
    cleared,
    0,
    SAMPLE_MS,
    PREFLIGHT_FLOOR_RMS,
    PREFLIGHT_SUSTAIN_MS
  );
  assert.equal(afterSilence.cleared, true, "a cleared state must latch through a later below-floor sample");
}

// The peak level in the returned state is the maximum of the previous peak
// and the current level, and never decreases.
{
  const withPeak: PreflightSampleState = { peakLevel: 0.4, sustainedMs: 0, cleared: false };
  const higher = evaluatePreflightSample(withPeak, 0.7, SAMPLE_MS, PREFLIGHT_FLOOR_RMS, PREFLIGHT_SUSTAIN_MS);
  assert.equal(higher.peakLevel, 0.7, "peakLevel must rise to a higher observed level");
  const lower = evaluatePreflightSample(higher, 0.1, SAMPLE_MS, PREFLIGHT_FLOOR_RMS, PREFLIGHT_SUSTAIN_MS);
  assert.equal(lower.peakLevel, 0.7, "peakLevel must never decrease on a lower observed level");
}

// The function mutates neither its input state nor any module-level value;
// calling it twice with the same arguments returns equal results.
{
  const input: PreflightSampleState = { peakLevel: 0.2, sustainedMs: 100, cleared: false };
  const inputCopy = { ...input };
  const a = evaluatePreflightSample(input, PREFLIGHT_FLOOR_RMS, SAMPLE_MS, PREFLIGHT_FLOOR_RMS, PREFLIGHT_SUSTAIN_MS);
  const b = evaluatePreflightSample(input, PREFLIGHT_FLOOR_RMS, SAMPLE_MS, PREFLIGHT_FLOOR_RMS, PREFLIGHT_SUSTAIN_MS);
  assert.deepEqual(input, inputCopy, "evaluatePreflightSample must not mutate its input state");
  assert.deepEqual(a, b, "calling evaluatePreflightSample twice with the same arguments must return equal results");
}

// normaliseSessionRecord rejects each malformed shape its actual guards
// check for, returning null rather than a partially-trusted record.
{
  const validRaw = {
    sessionId: "s1",
    startedAt: 1000,
    clockOrigin: 0,
    declaredSpeaker: "candidate",
    mimeType: "audio/webm",
    status: "stopped",
    durationMs: 5000,
    sizeBytes: 100,
  };

  // null and undefined are rejected.
  assert.equal(normaliseSessionRecord(null), null, "null must be rejected");
  assert.equal(normaliseSessionRecord(undefined), null, "undefined must be rejected");

  // A non-object value is rejected.
  assert.equal(normaliseSessionRecord("not an object"), null, "a non-object value must be rejected");
  assert.equal(normaliseSessionRecord(42), null, "a number must be rejected");

  // A missing or non-string sessionId is rejected.
  assert.equal(
    normaliseSessionRecord({ ...validRaw, sessionId: undefined }),
    null,
    "a missing sessionId must be rejected"
  );
  assert.equal(
    normaliseSessionRecord({ ...validRaw, sessionId: 123 }),
    null,
    "a non-string sessionId must be rejected"
  );
  assert.equal(
    normaliseSessionRecord({ ...validRaw, sessionId: "" }),
    null,
    "an empty-string sessionId must be rejected"
  );

  // A missing or non-number clockOrigin is rejected.
  assert.equal(
    normaliseSessionRecord({ ...validRaw, clockOrigin: undefined }),
    null,
    "a missing clockOrigin must be rejected"
  );
  assert.equal(
    normaliseSessionRecord({ ...validRaw, clockOrigin: "0" }),
    null,
    "a non-number clockOrigin must be rejected"
  );

  // A missing, non-string, or empty mimeType is rejected.
  assert.equal(
    normaliseSessionRecord({ ...validRaw, mimeType: undefined }),
    null,
    "a missing mimeType must be rejected"
  );
  assert.equal(
    normaliseSessionRecord({ ...validRaw, mimeType: "" }),
    null,
    "an empty-string mimeType must be rejected"
  );

  // A missing or non-string declaredSpeaker is rejected (note: an
  // out-of-vocabulary but present string, e.g. "moderator", is NOT rejected —
  // it is normalised to "candidate", asserted separately below).
  assert.equal(
    normaliseSessionRecord({ ...validRaw, declaredSpeaker: undefined }),
    null,
    "a missing declaredSpeaker must be rejected"
  );
  assert.equal(
    normaliseSessionRecord({ ...validRaw, declaredSpeaker: 1 }),
    null,
    "a non-string declaredSpeaker must be rejected"
  );

  // A well-formed record normalises successfully with every field intact,
  // including the v3 (05-02) fields defaulted for a record that carries
  // none of them.
  const normalised = normaliseSessionRecord(validRaw);
  assert.ok(normalised, "a valid record must normalise, not return null");
  assert.deepEqual(normalised, {
    sessionId: "s1",
    startedAt: 1000,
    clockOrigin: 0,
    declaredSpeaker: "candidate",
    mimeType: "audio/webm",
    status: "stopped",
    durationMs: 5000,
    sizeBytes: 100,
    transcriptStatus: "none",
    keepAudio: true,
    audioDeleted: false,
  });

  // An out-of-vocabulary declaredSpeaker is present and a string, so it is
  // not rejected — it is normalised to "candidate" per the guard's actual
  // documented behaviour, not treated as invalid.
  const withUnknownSpeaker = normaliseSessionRecord({ ...validRaw, declaredSpeaker: "moderator" });
  assert.ok(withUnknownSpeaker, "an out-of-vocabulary but present declaredSpeaker must not be rejected");
  assert.equal(withUnknownSpeaker?.declaredSpeaker, "candidate");
}

// 04-15: recoveredEndMs (D-29) — the closing boundary as a pure function.

// recoveredEndMs returns 0 for an empty chunk list.
{
  assert.equal(recoveredEndMs([]), 0);
}

// recoveredEndMs returns the largest chunk timestamp regardless of the
// list's order.
{
  const result = recoveredEndMs([{ tsMs: 5000 }, { tsMs: 20000 }, { tsMs: 10000 }]);
  assert.equal(result, 20000, "recoveredEndMs must return the largest timestamp regardless of input order");
}

// recoveredEndMs ignores a chunk whose timestamp is not a number rather than
// returning a non-numeric result or letting it win a comparison it has no
// claim to.
{
  const result = recoveredEndMs([
    { tsMs: 5000 },
    { tsMs: "not-a-number" as unknown as number },
    { tsMs: 15000 },
  ]);
  assert.equal(result, 15000, "a non-numeric tsMs must be ignored, not crash or poison the result");
  assert.equal(typeof result, "number");
}

// summariseChunks reports a duration equal to the largest readable chunk
// timestamp, with no timeslice added (04-11's flagged assumption, resolved).
{
  const chunks: AudioChunkMeta[] = [
    { sessionId: "s1", seq: 0, tsMs: 5000, size: 10, mimeType: "audio/webm" },
    { sessionId: "s1", seq: 1, tsMs: 20000, size: 10, mimeType: "audio/webm" },
  ];
  const summary = summariseChunks(chunks, 2);
  assert.equal(summary.durationMs, 20000, "summariseChunks must report the largest tsMs with no timeslice added");
}

// summariseChunks reports a 0 duration when no chunk is readable.
{
  const summary = summariseChunks([], 3);
  assert.equal(summary.durationMs, 0);
  assert.equal(summary.chunkCount, 3);
  assert.equal(summary.readableCount, 0);
}

// deriveSpans closed at the value recoveredEndMs returns produces a final
// span whose end equals that value exactly — the key link between the D-29
// boundary and the sidecar's final endMs.
{
  const chunks = [{ tsMs: 5000 }, { tsMs: 20000 }];
  const boundary = recoveredEndMs(chunks);
  const presses: TagPress[] = [{ sessionId: "s1", tsMs: 8000, speaker: "candidate" }];
  const spans = deriveSpans(presses, boundary);
  assert.equal(spans[spans.length - 1].endMs, boundary, "the final span must close at exactly the recoveredEndMs boundary");
}

// deriveSpans drops a press landing at or after the closing boundary, so no
// span in the result begins — or ends — past the end of the recording.
{
  const boundary = 20000;
  const presses: TagPress[] = [
    { sessionId: "s1", tsMs: 8000, speaker: "candidate" },
    { sessionId: "s1", tsMs: 20500, speaker: "interviewer" }, // landed after the boundary
  ];
  const spans = deriveSpans(presses, boundary);
  for (const span of spans) {
    assert.ok(span.startMs < boundary, `span ${JSON.stringify(span)} must not begin at or after the closing boundary`);
    assert.ok(span.endMs <= boundary, `span ${JSON.stringify(span)} must not end past the closing boundary`);
  }
  assert.equal(spans[spans.length - 1].endMs, boundary);
  assert.equal(spans[spans.length - 1].speaker, "candidate", "the out-of-range press must not have moved the current speaker");
}

// 05-02 (LIVE-12): downsampleTo16k — the D-39 tap's decimation formula.

// A 48kHz constant-valued buffer downsamples to a third the length with the
// same constant value.
{
  const input = new Float32Array(300).fill(0.42);
  const result = downsampleTo16k(input, 48000);
  assert.equal(result.length, 100, "a 48kHz buffer must downsample to a third the length at 16kHz");
  for (const sample of result) {
    assert.ok(Math.abs(sample - 0.42) < 1e-6, "a constant-valued buffer's downsampled samples must equal the constant");
  }
}

// Already at 16000: the input is returned unchanged.
{
  const input = new Float32Array([0.1, 0.2, 0.3]);
  const result = downsampleTo16k(input, TARGET_SAMPLE_RATE);
  assert.equal(result, input, "downsampleTo16k must return the same input reference when already at 16000");
}

// Empty input at a different rate returns an empty Float32Array.
{
  const result = downsampleTo16k(new Float32Array(0), 48000);
  assert.equal(result.length, 0, "downsampleTo16k must return empty for an empty input");
}

// peakFrameRms (LIVE-12/D-47's energy gate): silence returns 0.
{
  const samples = new Float32Array(1600).fill(0); // 100ms of silence at 16kHz
  const result = peakFrameRms(samples, TARGET_SAMPLE_RATE, SILENCE_FRAME_MS);
  assert.equal(result, 0, "peakFrameRms of pure silence must be 0");
}

// peakFrameRms returns 0 for an empty input.
{
  assert.equal(peakFrameRms(new Float32Array(0), TARGET_SAMPLE_RATE, SILENCE_FRAME_MS), 0);
}

// peakFrameRms returns the loud frame's level, not the average, for a
// buffer that is silent except one 100ms burst.
{
  const sampleRate = TARGET_SAMPLE_RATE;
  const frameSamples = Math.round((SILENCE_FRAME_MS / 1000) * sampleRate);
  const totalFrames = 10;
  const samples = new Float32Array(frameSamples * totalFrames).fill(0);
  // Burst in the middle frame at full amplitude.
  const burstStart = frameSamples * 5;
  samples.fill(1, burstStart, burstStart + frameSamples);
  const result = peakFrameRms(samples, sampleRate, SILENCE_FRAME_MS);
  assert.ok(
    Math.abs(result - 1) < 1e-6,
    `peakFrameRms must return the loud frame's own level (~1), not the average across all frames, got ${result}`
  );
}

// Task 1 (T-05-12): the energy gate's whole contract in three cases — a
// buffer of pure silence, a buffer of room-tone-level noise (still under the
// floor), and a buffer that is silent except for one 200ms speech-level
// burst. The gate must clear the third and reject the first two; this is
// exactly why the measurement is a per-frame peak and not a mean.
{
  const silence = new Float32Array(TARGET_SAMPLE_RATE).fill(0); // 1s of pure silence
  const peak = peakFrameRms(silence, TARGET_SAMPLE_RATE, SILENCE_FRAME_MS);
  assert.ok(peak < SILENCE_FLOOR_RMS, `pure silence must score below SILENCE_FLOOR_RMS, got ${peak}`);
}

{
  // Low-amplitude pseudo-random noise (deterministic LCG, no external RNG
  // dependency) — realistic room tone, not literal zero, but still well
  // under the floor.
  const roomTone = new Float32Array(TARGET_SAMPLE_RATE);
  let seed = 42;
  for (let i = 0; i < roomTone.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    roomTone[i] = (seed / 0x7fffffff - 0.5) * 0.01; // amplitude ~0.005, well under the 0.012 floor
  }
  const peak = peakFrameRms(roomTone, TARGET_SAMPLE_RATE, SILENCE_FRAME_MS);
  assert.ok(peak < SILENCE_FLOOR_RMS, `room-tone-level noise must score below SILENCE_FLOOR_RMS, got ${peak}`);
}

{
  // Silent except for a 200ms speech-level burst — must clear the floor
  // because peakFrameRms is a maximum over frames, not an average.
  const samples = new Float32Array(TARGET_SAMPLE_RATE * 2).fill(0); // 2s
  const burstSamples = Math.round((200 / 1000) * TARGET_SAMPLE_RATE);
  const burstStart = TARGET_SAMPLE_RATE; // 1s in
  samples.fill(0.3, burstStart, burstStart + burstSamples); // speech-level amplitude
  const peak = peakFrameRms(samples, TARGET_SAMPLE_RATE, SILENCE_FRAME_MS);
  assert.ok(
    peak >= SILENCE_FLOOR_RMS,
    `a 200ms speech-level burst inside otherwise-silent audio must score at or above SILENCE_FLOOR_RMS, got ${peak}`
  );
}

// sliceByTime returns exact boundaries.
{
  const sampleRate = TARGET_SAMPLE_RATE;
  const pcm = new Float32Array(sampleRate * 2); // 2 seconds
  for (let i = 0; i < pcm.length; i++) pcm[i] = i;
  const slice = sliceByTime(pcm, 0, 500, 1000, sampleRate);
  assert.equal(slice.length, sampleRate / 2, "a 500ms slice at 16kHz must contain 8000 samples");
  assert.equal(slice[0], pcm[sampleRate / 2], "the slice must start at the exact sample index for 500ms");
}

// sliceByTime clamps a range that starts before the buffer's own start.
{
  const sampleRate = TARGET_SAMPLE_RATE;
  const pcm = new Float32Array(sampleRate); // 1 second, starting at absolute 1000ms
  const slice = sliceByTime(pcm, 1000, 500, 1500, sampleRate);
  assert.equal(slice.length, sampleRate / 2, "a range starting before the buffer must clamp to the buffer's own start");
}

// sliceByTime returns empty for an out-of-range request.
{
  const sampleRate = TARGET_SAMPLE_RATE;
  const pcm = new Float32Array(sampleRate);
  const slice = sliceByTime(pcm, 0, 5000, 6000, sampleRate);
  assert.equal(slice.length, 0, "a range entirely outside the buffer must return an empty Float32Array");
}

// mergeSubFloorSpans (D-47): a 500ms interviewer span between two long
// candidate spans erases and leaves one continuous candidate span.
{
  const spans: TagSpan[] = [
    { startMs: 0, endMs: 5000, speaker: "candidate" },
    { startMs: 5000, endMs: 5500, speaker: "interviewer" },
    { startMs: 5500, endMs: 12000, speaker: "candidate" },
  ];
  const result = mergeSubFloorSpans(spans, SPAN_FLOOR_MS);
  assert.deepEqual(result, [{ startMs: 0, endMs: 12000, speaker: "candidate" }]);
}

// mergeSubFloorSpans folds two consecutive sub-floor spans into the same
// neighbour — both absorbed into the preceding kept span, which extends
// past both of them.
{
  const spans: TagSpan[] = [
    { startMs: 0, endMs: 5000, speaker: "candidate" },
    { startMs: 5000, endMs: 5400, speaker: "interviewer" },
    { startMs: 5400, endMs: 5700, speaker: "candidate" },
    { startMs: 5700, endMs: 12000, speaker: "interviewer" },
  ];
  const result = mergeSubFloorSpans(spans, SPAN_FLOOR_MS);
  assert.deepEqual(result, [
    { startMs: 0, endMs: 5700, speaker: "candidate" },
    { startMs: 5700, endMs: 12000, speaker: "interviewer" },
  ]);
}

// mergeSubFloorSpans folds a leading sub-floor span forward, keeping the
// following speaker.
{
  const spans: TagSpan[] = [
    { startMs: 0, endMs: 300, speaker: "interviewer" },
    { startMs: 300, endMs: 12000, speaker: "candidate" },
  ];
  const result = mergeSubFloorSpans(spans, SPAN_FLOOR_MS);
  assert.deepEqual(result, [{ startMs: 0, endMs: 12000, speaker: "candidate" }]);
}

// mergeSubFloorSpans, when every span is sub-floor, returns one span for
// the whole range carrying the first span's speaker.
{
  const spans: TagSpan[] = [
    { startMs: 0, endMs: 500, speaker: "interviewer" },
    { startMs: 500, endMs: 900, speaker: "candidate" },
  ];
  const result = mergeSubFloorSpans(spans, SPAN_FLOOR_MS);
  assert.deepEqual(result, [{ startMs: 0, endMs: 900, speaker: "interviewer" }]);
}

// mergeSubFloorSpans always returns a contiguous partition covering exactly
// the input range, for an arbitrary mix of kept and sub-floor spans.
{
  const spans: TagSpan[] = [
    { startMs: 0, endMs: 200, speaker: "interviewer" }, // leading sub-floor
    { startMs: 200, endMs: 8000, speaker: "candidate" }, // kept
    { startMs: 8000, endMs: 8300, speaker: "interviewer" }, // sub-floor
    { startMs: 8300, endMs: 8600, speaker: "candidate" }, // sub-floor, consecutive
    { startMs: 8600, endMs: 15000, speaker: "interviewer" }, // kept
  ];
  const result = mergeSubFloorSpans(spans, SPAN_FLOOR_MS);
  assert.equal(result[0].startMs, 0);
  assert.equal(result[result.length - 1].endMs, 15000);
  for (let i = 1; i < result.length; i++) {
    assert.equal(result[i].startMs, result[i - 1].endMs, "merged spans must be contiguous with no gap");
  }
}

// subdivideSpan returns exactly one window for any span at or under
// MAX_WINDOW_MS. Derived from the constant rather than a literal duration:
// MAX_WINDOW_MS is the latency knob and is expected to be retuned, and an
// assertion hardcoding "20s is one window" only tests the contract while the
// constant happens to exceed 20s.
{
  for (const endMs of [MAX_WINDOW_MS, MAX_WINDOW_MS - 1]) {
    const span: TagSpan = { startMs: 0, endMs, speaker: "candidate" };
    const windows = subdivideSpan(span, MAX_WINDOW_MS, WINDOW_OVERLAP_MS);
    assert.deepEqual(
      windows,
      [{ startMs: 0, endMs, speaker: "candidate" }],
      `a ${endMs}ms span (<= MAX_WINDOW_MS ${MAX_WINDOW_MS}) must yield exactly one window`
    );
  }
}

// subdivideSpan on a 70s span returns windows none longer than
// MAX_WINDOW_MS, all carrying the parent span's speaker, and emits no
// trailing window shorter than the overlap.
{
  const span: TagSpan = { startMs: 0, endMs: 70000, speaker: "interviewer" };
  const windows = subdivideSpan(span, MAX_WINDOW_MS, WINDOW_OVERLAP_MS);
  assert.ok(windows.length > 1, "a 70s span must be subdivided into more than one window");
  for (const window of windows) {
    assert.ok(window.endMs - window.startMs <= MAX_WINDOW_MS, `window ${JSON.stringify(window)} must not exceed MAX_WINDOW_MS`);
    assert.equal(window.speaker, "interviewer", "every sub-window must carry the parent span's speaker");
  }
  const last = windows[windows.length - 1];
  assert.ok(
    last.endMs - last.startMs >= WINDOW_OVERLAP_MS,
    "the trailing window must not be shorter than the overlap"
  );
  assert.equal(last.endMs, 70000, "the last window must be clamped to the span's own end");
}

// planWindows returns windows in ascending startMs order, each window's
// speaker matching the merged span it came from.
{
  const spans: TagSpan[] = [
    { startMs: 0, endMs: 5000, speaker: "interviewer" },
    { startMs: 5000, endMs: 40000, speaker: "candidate" },
  ];
  const windows = planWindows(spans, SPAN_FLOOR_MS, MAX_WINDOW_MS, WINDOW_OVERLAP_MS);
  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i].startMs >= windows[i - 1].startMs, "planWindows must return windows in ascending startMs order");
  }
  for (const window of windows) {
    const parent = spans.find((s) => window.startMs >= s.startMs && window.startMs < s.endMs);
    assert.ok(parent, `window ${JSON.stringify(window)} must fall inside one of the input spans`);
    assert.equal(window.speaker, parent?.speaker, "a window's speaker must match the span it came from");
  }
}

// Composition (Task 2, T-05-13): `subdivideSpan` + `dropSeamDuplicates`,
// applied exactly the way `transcriptionSession.ts`'s dispatch/result loop
// composes them — one `dropSeamDuplicates` call per sub-window's own chunk
// list, against the running written-end high-water mark for the span — must
// turn a 70s span's overlapping sub-windows into a strictly increasing,
// non-overlapping sequence of chunk ranges covering the span exactly once.
//
// Chunk boundaries are drawn from one absolute 1s grid shared by every
// window (rather than a per-window cursor), so two overlapping windows that
// both cover the same underlying second of audio report IDENTICAL chunk
// boundaries for it — the only way to prove "exactly once" mathematically,
// since `dropSeamDuplicates` decides keep/drop by midpoint and never trims a
// kept item's own boundaries.
{
  const span: TagSpan = { startMs: 0, endMs: 70000, speaker: "candidate" };
  const windows = subdivideSpan(span, MAX_WINDOW_MS, WINDOW_OVERLAP_MS);
  assert.ok(windows.length > 1, "a 70s span must be subdivided into more than one sub-window for this composition to be meaningful");

  const GRID_MS = 1000;
  const gridChunks: { startMs: number; endMs: number }[] = [];
  for (let t = span.startMs; t < span.endMs; t += GRID_MS) {
    gridChunks.push({ startMs: t, endMs: Math.min(t + GRID_MS, span.endMs) });
  }
  const chunksForWindow = (window: { startMs: number; endMs: number }) =>
    gridChunks.filter((c) => c.startMs >= window.startMs && c.endMs <= window.endMs);

  let writtenEndMs = 0;
  const accepted: { startMs: number; endMs: number }[] = [];
  for (const window of windows) {
    const chunks = chunksForWindow(window);
    const kept = dropSeamDuplicates(chunks, writtenEndMs);
    accepted.push(...kept);
    const coveredThroughMs = kept.reduce((max, c) => Math.max(max, c.endMs), window.endMs);
    writtenEndMs = Math.max(writtenEndMs, coveredThroughMs);
  }

  assert.deepEqual(
    accepted,
    gridChunks,
    "the composed dispatch/dedupe loop must reconstruct the span's full grid exactly once, with no gap and no duplicate"
  );
  for (let i = 1; i < accepted.length; i++) {
    assert.equal(
      accepted[i].startMs,
      accepted[i - 1].endMs,
      `accepted coverage must be strictly contiguous — gap or overlap between ${JSON.stringify(accepted[i - 1])} and ${JSON.stringify(accepted[i])}`
    );
  }
  assert.equal(accepted[0].startMs, span.startMs, "coverage must start exactly at the span's own start");
  assert.equal(accepted[accepted.length - 1].endMs, span.endMs, "coverage must end exactly at the span's own end");
}

// Regression: `dispatchWindowsUpTo` (transcriptionSession.ts) must never
// silently skip audio while a span is still open. The bug this guards
// against: deduping dispatched windows on `startMs` alone burned that key
// on a tiny, still-growing sliver the first tick any part of a span
// settled, then permanently skipped the correctly-sized final window that
// later shared the same `startMs` — losing up to 92% of a take's audio (see
// 05-03-SUMMARY.md). This simulates the real tick loop — one call to
// `eligibleWindows` per second plus one final call, keyed by
// `${startMs}:${endMs}` exactly as `transcriptionSession.ts` does — over a
// 60s take with two spacebar switches, and asserts the union of dispatched
// windows covers the whole timeline with no gaps, and that every real span's
// speaker actually reaches the worker.
{
  const presses: TagPress[] = [
    { sessionId: "s", tsMs: 20000, speaker: "candidate" },
    { sessionId: "s", tsMs: 35000, speaker: "interviewer" },
  ];
  const TICK_MS = 1000;
  const TAKE_END_MS = 60000;
  const dispatched = new Set<string>();
  const sent: { startMs: number; endMs: number; speaker: string }[] = [];

  function tick(boundaryMs: number, final: boolean) {
    const spans = deriveSpans(presses, boundaryMs);
    const windows = eligibleWindows(spans, SPAN_FLOOR_MS, MAX_WINDOW_MS, WINDOW_OVERLAP_MS, final);
    for (const w of windows) {
      const key = `${w.startMs}:${w.endMs}`;
      if (dispatched.has(key)) continue;
      dispatched.add(key);
      sent.push({ startMs: w.startMs, endMs: w.endMs, speaker: w.speaker });
    }
  }

  for (let now = TICK_MS; now <= TAKE_END_MS; now += TICK_MS) {
    tick(Math.max(0, now - SPAN_FLOOR_MS), false);
  }
  tick(TAKE_END_MS, true); // finish()'s final dispatch — nothing left to grow

  // D-46: no dispatched window may span two speakers — every window must
  // fall entirely inside one real span and carry that span's speaker.
  const fullSpans = deriveSpans(presses, TAKE_END_MS);
  for (const w of sent) {
    const parent = fullSpans.find((s) => w.startMs >= s.startMs && w.startMs < s.endMs);
    assert.ok(parent, `dispatched window ${JSON.stringify(w)} must fall inside a real span`);
    assert.ok(
      w.endMs <= (parent as TagSpan).endMs,
      `dispatched window ${JSON.stringify(w)} must not extend past its span's end`
    );
    assert.equal(w.speaker, parent?.speaker, "a dispatched window's speaker must match the span it came from");
  }

  // Coverage: the union of dispatched windows must cover the entire take
  // with no gap — a gap here is exactly the silently-skipped-audio bug.
  const bySort = [...sent].sort((a, b) => a.startMs - b.startMs);
  let coveredThroughMs = 0;
  for (const w of bySort) {
    assert.ok(
      w.startMs <= coveredThroughMs,
      `gap in dispatched coverage before ${w.startMs}ms (covered through ${coveredThroughMs}ms) — audio silently skipped`
    );
    coveredThroughMs = Math.max(coveredThroughMs, w.endMs);
  }
  assert.equal(
    coveredThroughMs,
    TAKE_END_MS,
    `dispatched windows must cover the full ${TAKE_END_MS}ms take; only covered through ${coveredThroughMs}ms`
  );

  // Every real span's speaker must have actually reached the worker at
  // least once — the original bug labelled one speaker and dropped the
  // other's sentences entirely.
  for (const span of fullSpans) {
    const covered = sent.some(
      (w) => w.speaker === span.speaker && w.startMs < span.endMs && w.endMs > span.startMs
    );
    assert.ok(covered, `span ${JSON.stringify(span)} never produced a dispatched window`);
  }
}

// G-05-1: the final flush must CLAMP the trailing window to what is actually
// buffered, never skip it.
//
// `finish()` clears the tick interval and closes the tap BEFORE its final
// dispatch, and the boundary it passes is the recorder's clock — always a
// little ahead of the buffered end, because the worklet only posts whole
// 4096-frame blocks and discards its partial accumulator on close. A guard
// that reads "not yet buffered, retry on a later tick" is therefore false on
// the final flush: there is no later tick, and up to MAX_WINDOW_MS of the
// take's last words was dropped instead of truncated.
//
// This models the buffer the coverage simulation above deliberately does not:
// that harness assumes every planned window is dispatchable, which is exactly
// the assumption this bug lived underneath.
{
  const TAKE_END_MS = 30000;
  const TICK_MS = 1000; // mirrors transcriptionSession.ts's live tick cadence
  // The buffer lags the recorder clock — one worklet block (4096 frames at
  // 16 kHz = 256ms) plus capture latency, rounded to a realistic 300ms.
  const BUFFER_LAG_MS = 300;
  const bufferEndMs = TAKE_END_MS - BUFFER_LAG_MS;

  const dispatchedKeys = new Set<string>();
  const sent: { startMs: number; endMs: number }[] = [];

  // Mirrors dispatchWindowsUpTo's guard, including the clamp under test.
  function dispatch(boundaryMs: number, final: boolean) {
    const spans = deriveSpans([], boundaryMs);
    for (const w of eligibleWindows(spans, SPAN_FLOOR_MS, MAX_WINDOW_MS, WINDOW_OVERLAP_MS, final)) {
      const key = `${w.startMs}:${w.endMs}`;
      if (dispatchedKeys.has(key)) continue;
      let endMs = w.endMs;
      if (endMs > bufferEndMs) {
        if (!final) continue;
        endMs = bufferEndMs;
        if (endMs <= w.startMs) continue;
      }
      dispatchedKeys.add(key);
      sent.push({ startMs: w.startMs, endMs });
    }
  }

  for (let now = TICK_MS; now <= TAKE_END_MS; now += TICK_MS) {
    dispatch(Math.max(0, now - SPAN_FLOOR_MS), false);
  }
  dispatch(TAKE_END_MS, true);

  assert.ok(sent.length > 0, "the final flush must dispatch at least one window");

  const lastEndMs = Math.max(...sent.map((w) => w.endMs));
  assert.equal(
    lastEndMs,
    bufferEndMs,
    `the final flush must clamp its trailing window to the buffered end (${bufferEndMs}ms), not skip it — ` +
      `dispatch reached only ${lastEndMs}ms, so the take's last ${bufferEndMs - lastEndMs}ms of speech was dropped (G-05-1)`
  );

  // No window may claim coverage past audio that exists — the clamp must
  // truncate, never extend.
  for (const w of sent) {
    assert.ok(
      w.endMs <= bufferEndMs,
      `dispatched window ${JSON.stringify(w)} claims audio past the buffered end (${bufferEndMs}ms)`
    );
  }

  // And the coverage between the start and the clamped end must still be gapless.
  const sorted = [...sent].sort((a, b) => a.startMs - b.startMs);
  let through = 0;
  for (const w of sorted) {
    assert.ok(w.startMs <= through, `gap in final-flush coverage before ${w.startMs}ms (covered through ${through}ms)`);
    through = Math.max(through, w.endMs);
  }
}

// dropSeamDuplicates drops an item wholly inside the overlap and keeps one
// whose midpoint clears it.
{
  const items = [
    { startMs: 0, endMs: 1000 }, // midpoint 500, wholly inside a previousEndMs of 2000
    { startMs: 1500, endMs: 3000 }, // midpoint 2250, clears previousEndMs of 2000
  ];
  const result = dropSeamDuplicates(items, 2000);
  assert.deepEqual(result, [{ startMs: 1500, endMs: 3000 }]);
}

// 05-02 (LIVE-12/LIVE-13): transcriptTurns.ts and transcriptText.ts.

function makeSegment(overrides: Partial<TranscriptSegment> & { seq: number }): TranscriptSegment {
  return {
    sessionId: "s1",
    startMs: overrides.seq * 1000,
    endMs: overrides.seq * 1000 + 900,
    speaker: "candidate",
    text: `segment ${overrides.seq}`,
    windowStartMs: 0,
    ...overrides,
  };
}

// effectiveSpeaker: resolvedSpeaker ?? speaker.
{
  const unresolved = makeSegment({ seq: 0, speaker: "candidate" });
  assert.equal(effectiveSpeaker(unresolved), "candidate");
  const resolved = makeSegment({ seq: 1, speaker: "candidate", resolvedSpeaker: "interviewer" });
  assert.equal(effectiveSpeaker(resolved), "interviewer");
}

// groupIntoTurns: empty input returns an empty array.
{
  assert.deepEqual(groupIntoTurns([]), []);
}

// groupIntoTurns groups consecutive same-speaker segments into one turn.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, speaker: "candidate" }),
    makeSegment({ seq: 1, speaker: "candidate" }),
  ];
  const turns = groupIntoTurns(segments);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].segments.length, 2);
}

// groupIntoTurns splits on a speaker change.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, speaker: "interviewer" }),
    makeSegment({ seq: 1, speaker: "candidate" }),
  ];
  const turns = groupIntoTurns(segments);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].speaker, "interviewer");
  assert.equal(turns[1].speaker, "candidate");
}

// groupIntoTurns respects a resolvedSpeaker override when grouping — a
// segment overridden to match its neighbour joins that neighbour's turn.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, speaker: "interviewer" }),
    makeSegment({ seq: 1, speaker: "candidate", resolvedSpeaker: "interviewer" }),
    makeSegment({ seq: 2, speaker: "candidate" }),
  ];
  const turns = groupIntoTurns(segments);
  assert.equal(turns.length, 2, "an override that matches the neighbour must merge into that neighbour's turn");
  assert.equal(turns[0].segments.length, 2);
}

// groupIntoTurns sets corrected only when a member carries an override.
{
  const uncorrected = groupIntoTurns([makeSegment({ seq: 0, speaker: "candidate" })]);
  assert.equal(uncorrected[0].corrected, false);
  const corrected = groupIntoTurns([makeSegment({ seq: 0, speaker: "candidate", resolvedSpeaker: "interviewer" })]);
  assert.equal(corrected[0].corrected, true);
}

// moveTurnBoundary: empty input returns an empty array.
{
  assert.deepEqual(moveTurnBoundary([], 0), []);
}

// moveTurnBoundary flips a lone segment to the other speaker.
{
  const segments: TranscriptSegment[] = [makeSegment({ seq: 0, speaker: "candidate" })];
  const result = moveTurnBoundary(segments, 0);
  assert.equal(result[0].resolvedSpeaker, "interviewer");
  assert.equal(result[0].speaker, "candidate", "the original speaker field must never be rewritten");
}

// moveTurnBoundary moves only the leading segments when the target is
// mid-turn.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, speaker: "interviewer" }),
    makeSegment({ seq: 1, speaker: "candidate" }),
    makeSegment({ seq: 2, speaker: "candidate" }),
    makeSegment({ seq: 3, speaker: "candidate" }),
  ];
  const result = moveTurnBoundary(segments, 3);
  const bySeq = new Map(result.map((s) => [s.seq, s]));
  assert.equal(bySeq.get(0)?.resolvedSpeaker, undefined, "the prior turn must be untouched");
  assert.equal(bySeq.get(1)?.resolvedSpeaker, "interviewer", "leading candidate segments must move to the previous speaker");
  assert.equal(bySeq.get(2)?.resolvedSpeaker, "interviewer");
  assert.equal(bySeq.get(3)?.resolvedSpeaker, undefined, "the target segment and after must be untouched");
}

// moveTurnBoundary merges a whole turn when the target is the turn's first
// segment.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, speaker: "interviewer" }),
    makeSegment({ seq: 1, speaker: "candidate" }),
    makeSegment({ seq: 2, speaker: "candidate" }),
  ];
  const result = moveTurnBoundary(segments, 1);
  const bySeq = new Map(result.map((s) => [s.seq, s]));
  assert.equal(bySeq.get(1)?.resolvedSpeaker, "interviewer", "the whole run must merge into the previous turn");
  assert.equal(bySeq.get(2)?.resolvedSpeaker, "interviewer");
  assert.equal(bySeq.get(0)?.resolvedSpeaker, undefined);
}

// moveTurnBoundary is a no-op for an unknown targetSeq.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, speaker: "interviewer" }),
    makeSegment({ seq: 1, speaker: "candidate" }),
  ];
  const result = moveTurnBoundary(segments, 999);
  assert.deepEqual(result, segments, "an unknown targetSeq must be a no-op");
}

// moveTurnBoundary leaves every speaker field untouched and does not mutate
// the array (or its segment objects) it was given.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, speaker: "interviewer" }),
    makeSegment({ seq: 1, speaker: "candidate" }),
    makeSegment({ seq: 2, speaker: "candidate" }),
  ];
  const originalCopy = segments.map((s) => ({ ...s }));
  moveTurnBoundary(segments, 1);
  assert.deepEqual(segments, originalCopy, "moveTurnBoundary must not mutate its input array or its segments");
  for (const segment of segments) {
    assert.equal(segment.resolvedSpeaker, undefined, "the input segments' own resolvedSpeaker must be untouched");
  }
}

// formatTranscriptText on zero segments returns a non-empty string
// containing the no-segments line.
{
  const take: RecordingSession = {
    sessionId: "s1",
    startedAt: Date.now(),
    clockOrigin: 0,
    declaredSpeaker: "interviewer",
    mimeType: "audio/webm",
    status: "stopped",
    durationMs: 0,
  };
  const result = formatTranscriptText(take, []);
  assert.ok(result.length > 0, "formatTranscriptText must never return an empty string");
  assert.ok(
    result.includes("No transcript segments were produced for this take."),
    "the zero-segment case must state that no segments were produced"
  );
}

// formatTranscriptText marks a corrected turn's label.
{
  const take: RecordingSession = {
    sessionId: "s1",
    startedAt: Date.now(),
    clockOrigin: 0,
    declaredSpeaker: "interviewer",
    mimeType: "audio/webm",
    status: "stopped",
    durationMs: 5000,
  };
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, speaker: "candidate", resolvedSpeaker: "interviewer", text: "hello there" }),
  ];
  const result = formatTranscriptText(take, segments);
  assert.ok(result.includes("(corrected)"), "a corrected turn's label must carry a correction marker");
}

// formatTranscriptText preserves a non-ASCII string byte-identically.
{
  const take: RecordingSession = {
    sessionId: "s1",
    startedAt: Date.now(),
    clockOrigin: 0,
    declaredSpeaker: "interviewer",
    mimeType: "audio/webm",
    status: "stopped",
    durationMs: 5000,
  };
  const nonAsciiText = "café résumé — 日本語 — naïve";
  const segments: TranscriptSegment[] = [makeSegment({ seq: 0, speaker: "candidate", text: nonAsciiText })];
  const result = formatTranscriptText(take, segments);
  assert.ok(result.includes(nonAsciiText), "non-ASCII transcript text must round-trip byte-identically into the export");
}

// formatTranscriptText ends with exactly one trailing newline, no carriage
// returns, for both the zero-segment and populated cases.
{
  const take: RecordingSession = {
    sessionId: "s1",
    startedAt: Date.now(),
    clockOrigin: 0,
    declaredSpeaker: "interviewer",
    mimeType: "audio/webm",
    status: "stopped",
    durationMs: 5000,
  };
  const empty = formatTranscriptText(take, []);
  assert.ok(empty.endsWith("\n") && !empty.endsWith("\n\n"), "must end with exactly one trailing newline");
  assert.ok(!empty.includes("\r"), "must contain no carriage returns");

  const populated = formatTranscriptText(take, [makeSegment({ seq: 0, speaker: "candidate", text: "hi" })]);
  assert.ok(populated.endsWith("\n") && !populated.endsWith("\n\n"), "must end with exactly one trailing newline");
  assert.ok(!populated.includes("\r"), "must contain no carriage returns");
}

// shouldDeleteAudio's full D-53 truth table (05-05 Task 3, checkpoint
// decision "strict-five"). A take must satisfy ALL FIVE conditions before
// its audio is deleted; every row below that satisfies fewer than five is
// asserted `false` — these KEEP rows are the ones that actually protect a
// real interview recording, and are asserted here deliberately, not just
// the one row that deletes.
{
  // The base fixture for every row below: everything the deletion row
  // requires, so each negative row below is a single-field mutation away
  // from the one true row — isolating exactly which condition it is
  // testing.
  const retentionBase: RecordingSession = {
    ...baseSession,
    sessionId: "retention",
    status: "stopped",
    transcriptStatus: "complete",
    keepAudio: false,
    audioDeleted: false,
  };

  // The only true row: opted out, stopped, complete transcript, not already
  // deleted, at least one segment.
  assert.equal(
    shouldDeleteAudio(retentionBase, 3),
    true,
    "opted-out + stopped + complete + not-deleted + segments>0 must delete"
  );

  // keepAudio: true (opted in) — the D-55 opt-in overrides everything else.
  assert.equal(
    shouldDeleteAudio({ ...retentionBase, keepAudio: true }, 3),
    false,
    "an opted-in take must keep its audio even with a complete transcript"
  );

  // keepAudio absent (pre-v3 record passed directly, bypassing
  // normaliseSessionRecord's default) — strict equality against `false`
  // means "not explicitly false" must keep, exactly like "explicitly true".
  {
    const { keepAudio: _drop, ...withoutKeepAudio } = retentionBase;
    assert.equal(
      shouldDeleteAudio(withoutKeepAudio as RecordingSession, 3),
      false,
      "an absent keepAudio field must keep — strict equality against false, not falsiness"
    );
  }

  // status: "recording" — a take that is not yet stopped is never a
  // deletion candidate, regardless of what transcriptStatus claims.
  assert.equal(
    shouldDeleteAudio({ ...retentionBase, status: "recording" }, 3),
    false,
    "a take still recording must keep its audio"
  );

  // transcriptStatus: "running" — the worker is still draining a backlog.
  assert.equal(
    shouldDeleteAudio({ ...retentionBase, transcriptStatus: "running" }, 3),
    false,
    "a still-running transcriptStatus must keep the audio"
  );

  // transcriptStatus: "incomplete" — an errored window, a dropped backlog,
  // or a crash-recovered take (closeRecoveredSession's own write).
  assert.equal(
    shouldDeleteAudio({ ...retentionBase, transcriptStatus: "incomplete" }, 3),
    false,
    "an incomplete transcriptStatus must keep the audio"
  );

  // transcriptStatus: "none" — the pre-v3 default; a take that predates
  // transcription entirely.
  assert.equal(
    shouldDeleteAudio({ ...retentionBase, transcriptStatus: "none" }, 3),
    false,
    "a transcriptStatus of \"none\" must keep the audio"
  );

  // segmentCount: 0 — a transcript marked complete but holding nothing is
  // the one case a status flag alone cannot catch; the audio is the only
  // surviving record of the take.
  assert.equal(
    shouldDeleteAudio(retentionBase, 0),
    false,
    "a complete transcript with zero segments must keep the audio"
  );

  // audioDeleted: true — a take whose audio is already gone is not deleted
  // a second time.
  assert.equal(
    shouldDeleteAudio({ ...retentionBase, audioDeleted: true }, 3),
    false,
    "a take already marked audioDeleted must not be deleted again"
  );

  // The composition that actually protects an existing pre-v3 take:
  // normaliseSessionRecord applied to a bare pre-v3 record (no
  // transcriptStatus/keepAudio/audioDeleted fields at all — every field this
  // phase introduced is absent) must default keepAudio to true, and passing
  // that normalised record into shouldDeleteAudio must return false.
  {
    const barePreV3Raw = {
      sessionId: "pre-v3",
      startedAt: 1000,
      clockOrigin: 0,
      declaredSpeaker: "interviewer",
      mimeType: "audio/webm",
      status: "stopped",
      durationMs: 5000,
    };
    const normalised = normaliseSessionRecord(barePreV3Raw);
    assert.ok(normalised, "a bare pre-v3 record must still normalise");
    assert.equal(
      shouldDeleteAudio(normalised as RecordingSession, 3),
      false,
      "normaliseSessionRecord(bare pre-v3 record) -> shouldDeleteAudio must return false — this composition is what protects an existing take across the v3 upgrade"
    );
  }
}

// 05-07 engine-fix regression guard: the dtype src/workers/whisper.worker.ts
// requests and the ONNX filename suffix scripts/fetch-model.mjs downloads
// must name the SAME quantization. A mismatch is a hard 404 at runtime with
// `env.allowRemoteModels = false` — exactly the class of error
// 05-01-PLAN.md's own key_links warned about, and exactly what broke this
// engine the first time (q4f16 worker + a runtime that couldn't run it
// correctly). Static text analysis, not an import of either module — the
// worker file casts the ambient `self` global in a way that throws under
// plain Node, and fetch-model.mjs's own module-scope code performs real file
// I/O; neither is safe to import from a pure assertion script.
{
  // @huggingface/transformers' own dtype -> ONNX filename-suffix mapping
  // (DEFAULT_DTYPE_SUFFIX_MAPPING in its utils/dtypes.js), duplicated here
  // deliberately: this script's whole point is to catch a *drift* between
  // the two files below, so it must not import either of them to check
  // itself against.
  const DTYPE_SUFFIX: Record<string, string> = {
    fp32: "",
    fp16: "_fp16",
    q8: "_quantized",
    int8: "_int8",
    uint8: "_uint8",
    q4: "_q4",
    q4f16: "_q4f16",
    bnb4: "_bnb4",
  };

  const workerPath = fileURLToPath(new URL("../src/workers/whisper.worker.ts", import.meta.url));
  const fetchModelPath = fileURLToPath(new URL("./fetch-model.mjs", import.meta.url));
  const workerSrc = readFileSync(workerPath, "utf8");
  const fetchModelSrc = readFileSync(fetchModelPath, "utf8");

  const dtypeMatch = workerSrc.match(/export const MODEL_DTYPE = "([a-z0-9]+)";/);
  assert.ok(
    dtypeMatch,
    "src/workers/whisper.worker.ts must declare `export const MODEL_DTYPE = \"...\";` as a quoted string literal"
  );
  const dtype = dtypeMatch![1];
  const expectedSuffix = DTYPE_SUFFIX[dtype];
  assert.ok(
    expectedSuffix !== undefined,
    `whisper.worker.ts's MODEL_DTYPE ("${dtype}") is not a recognised @huggingface/transformers dtype — update DTYPE_SUFFIX in this guard if a new dtype was intentionally introduced`
  );

  const onnxPathMatches = [...fetchModelSrc.matchAll(/path:\s*"onnx\/(encoder_model|decoder_model_merged)([a-z0-9_]*)\.onnx"/g)];
  assert.ok(
    onnxPathMatches.length >= 2,
    "scripts/fetch-model.mjs must declare both onnx/encoder_model*.onnx and onnx/decoder_model_merged*.onnx entries in ONNX_FILES"
  );
  for (const match of onnxPathMatches) {
    const [, base, actualSuffix] = match;
    assert.equal(
      actualSuffix,
      expectedSuffix,
      `dtype/filename mismatch: whisper.worker.ts requests MODEL_DTYPE "${dtype}" (expects filename suffix "${expectedSuffix || "(none)"}"), ` +
        `but scripts/fetch-model.mjs downloads "${base}${actualSuffix}.onnx". With env.allowRemoteModels = false this is a hard 404 at runtime, not a silent CDN fallback.`
    );
  }
}

// Phase 6 (LIVE-16 Wave 0 gate): src/lib/quoteMatcher.ts — the shared
// evidence-verification primitive for D-66, D-60, Pattern 2's exchange
// boundary resolution, and D-69. `makeSegment` above already produces
// well-formed TranscriptSegment fixtures; these blocks give it real text.

// 1. Normalisation: lowercase, curly-quote folding (both single and
// double), en/em dash folding, whitespace-run collapsing, and trim — all
// five exercised in a single input.
{
  const input = "  The Manager’s “plan” – for Q3 — is   ready.  ";
  const result = normalizeForMatch(input);
  assert.equal(result, `the manager's "plan" - for q3 - is ready.`);
}

// 2. Verbatim match (LIVE-16 happy path): a quote taken verbatim from one
// segment matches and resolves that segment's seq and startMs.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, text: "I led the migration to Kubernetes last year." }),
    makeSegment({ seq: 1, text: "It cut our deploy time in half." }),
  ];
  const result = findQuoteInSegments("I led the migration to Kubernetes last year.", segments);
  assert.equal(result.matched, true);
  assert.equal(result.segmentSeq, 0);
  assert.equal(result.startMs, segments[0].startMs);
}

// 3. Punctuation and case tolerance (D-66): the same quote in different
// case, with curly quotes, and a trailing full stop still matches and
// resolves the same segment.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, text: "We shipped it on the team’s deadline" }),
  ];
  const result = findQuoteInSegments("WE SHIPPED IT ON THE TEAM’S DEADLINE.", segments);
  assert.equal(result.matched, true);
  assert.equal(result.segmentSeq, 0);
}

// 4. Adjacency (LIVE-16 adjacency): a quote spanning two segments matches
// and resolves to the segment its first character falls in, in both
// directions.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, text: "The rollout broke because of a config" }),
    makeSegment({ seq: 1, text: "drift between staging and prod." }),
  ];
  // Begins in segment 0, tail lands in segment 1 — resolves to 0.
  const spanning = findQuoteInSegments("config drift between staging", segments);
  assert.equal(spanning.matched, true);
  assert.equal(spanning.segmentSeq, 0, "a quote whose first character falls in segment 0 must resolve to segment 0 even when its tail extends into segment 1");

  // Begins in segment 1 entirely — resolves to 1, not 0 (the converse).
  const secondOnly = findQuoteInSegments("drift between staging and prod", segments);
  assert.equal(secondOnly.matched, true);
  assert.equal(secondOnly.segmentSeq, 1, "a quote that begins in segment 1 must resolve to segment 1, not segment 0");
}

// 5. Empty and degenerate input (LIVE-16 empty): each returns matched:false,
// never throws, and never returns a segmentSeq. A single-segment array with
// a matching quote still resolves.
{
  const segments: TranscriptSegment[] = [makeSegment({ seq: 0, text: "one lonely segment here" })];

  assert.deepEqual(findQuoteInSegments("", segments), { matched: false });
  assert.deepEqual(findQuoteInSegments("   ", segments), { matched: false });
  assert.deepEqual(findQuoteInSegments("anything", []), { matched: false });
  assert.deepEqual(findQuoteInSegments("...", segments), { matched: false }, "pure punctuation must not match");

  const singleSegmentMatch = findQuoteInSegments("lonely segment", segments);
  assert.equal(singleSegmentMatch.matched, true);
  assert.equal(singleSegmentMatch.segmentSeq, 0);
}

// 6. No-match is a hard miss, not a near-match (D-66): a quote differing by
// one whole word returns matched:false — pins "a miss downgrades rather
// than fuzzily accepting."
{
  const segments: TranscriptSegment[] = [makeSegment({ seq: 0, text: "I owned the entire migration end to end" })];
  const result = findQuoteInSegments("I owned the entire rollout end to end", segments);
  assert.equal(result.matched, false, "a one-word difference must be a hard miss, not a fuzzy accept");
}

// 7. Ordering determinism (LIVE-16 ordering): the identical normalized
// phrase present in two segments resolves to the earlier one by
// startMs/seq, is stable across repeated calls, holds when the input array
// is reversed (proving the internal sort), and never mutates its input.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, text: "we hit the deadline" }),
    makeSegment({ seq: 1, text: "unrelated filler here" }),
    makeSegment({ seq: 2, text: "we hit the deadline" }),
  ];
  const first = findQuoteInSegments("we hit the deadline", segments);
  assert.equal(first.matched, true);
  assert.equal(first.segmentSeq, 0, "a phrase present in two segments must resolve to the earlier one");

  const second = findQuoteInSegments("we hit the deadline", segments);
  assert.deepEqual(second, first, "calling findQuoteInSegments twice on the same input must return an identical result");

  const reversed = [...segments].reverse();
  const originalOrder = reversed.map((s) => s.seq);
  const fromReversed = findQuoteInSegments("we hit the deadline", reversed);
  assert.equal(fromReversed.segmentSeq, 0, "the result must not depend on input array order — this proves the internal sort");
  assert.deepEqual(reversed.map((s) => s.seq), originalOrder, "the input array must not be mutated");
}

// 8. Fingerprint (staleness input for D-51/D-71): stable across two calls,
// identical for the same segments in a different array order, and
// different when one segment's resolvedSpeaker changes.
{
  const segments: TranscriptSegment[] = [
    makeSegment({ seq: 0, text: "first segment", speaker: "interviewer" }),
    makeSegment({ seq: 1, text: "second segment", speaker: "candidate" }),
  ];

  const a = fingerprintSegments(segments);
  const b = fingerprintSegments(segments);
  assert.equal(a, b, "fingerprintSegments must be stable across two calls on the same input");

  const reordered = [...segments].reverse();
  assert.equal(
    fingerprintSegments(reordered),
    a,
    "fingerprintSegments must be identical for the same segments passed in a different array order"
  );

  const withCorrection = segments.map((s) =>
    s.seq === 1 ? { ...s, resolvedSpeaker: "interviewer" as const } : s
  );
  assert.notEqual(
    fingerprintSegments(withCorrection),
    a,
    "fingerprintSegments must change when a segment's resolvedSpeaker changes"
  );
}

// Phase 6 (LIVE-21, T-06-03): src/lib/deliveryScreen.ts — the server-side
// D-67/D-68 delivery-scoring screen enforced inside the live-feedback route
// handler, so a client calling the route directly gets the same treatment
// as the app.

// 1. A field whose only sentence names a prohibited dimension returns just
// the marker, and withheldCount 1.
{
  const result = screenDeliveryProse("The candidate spoke with a strong accent.");
  assert.equal(result.text, WITHHELD_REMARK_MARKER);
  assert.equal(result.withheldCount, 1);
}

// 2. A field of three sentences where the middle one names a prohibited
// dimension returns the first and third sentences joined, with the marker
// appended once, and withheldCount 1 — the surviving neighbours are
// preserved, not silently reworded.
{
  const result = screenDeliveryProse(
    "The candidate covered the rollback plan well. Their pace was a bit rushed honestly. They also named the monitoring gap."
  );
  assert.equal(result.withheldCount, 1);
  assert.ok(result.text.includes("The candidate covered the rollback plan well."));
  assert.ok(result.text.includes("They also named the monitoring gap."));
  assert.ok(!result.text.includes("pace"), "the offending sentence must not survive");
  assert.equal(
    result.text.split(WITHHELD_REMARK_MARKER).length - 1,
    1,
    "the marker must appear exactly once even though only one sentence was dropped"
  );
}

// 3. A field with two offending sentences returns withheldCount 2, with the
// marker appended once, not twice.
{
  const result = screenDeliveryProse("They seemed nervous throughout. Filler words were everywhere honestly.");
  assert.equal(result.withheldCount, 2);
  assert.equal(
    result.text.split(WITHHELD_REMARK_MARKER).length - 1,
    1,
    "two withheld sentences must still produce exactly one marker"
  );
}

// 4. A field with no offending sentence is returned byte-identical
// (including its original whitespace), with withheldCount 0 and no marker.
{
  const clean = "  Solid, specific technical answer with real depth.  ";
  const result = screenDeliveryProse(clean);
  assert.equal(result.text, clean);
  assert.equal(result.withheldCount, 0);
  assert.ok(!result.text.includes(WITHHELD_REMARK_MARKER));
}

// 5. Empty, whitespace-only, and no-terminal-punctuation input are each
// handled without throwing, and withhold nothing.
{
  assert.doesNotThrow(() => screenDeliveryProse(""));
  assert.doesNotThrow(() => screenDeliveryProse("   "));
  assert.doesNotThrow(() => screenDeliveryProse("no terminal punctuation here"));
  assert.equal(screenDeliveryProse("").withheldCount, 0);
  assert.equal(screenDeliveryProse("   ").withheldCount, 0);
  assert.equal(screenDeliveryProse("no terminal punctuation here").withheldCount, 0);
}

// 6. Word-boundary matching only: "paceable", "confidential" and
// "accentuate" must not trip "pace", "confident" and "accent".
{
  assert.equal(screenDeliveryProse("This design is paceable enough.").withheldCount, 0);
  assert.equal(screenDeliveryProse("This document is confidential material.").withheldCount, 0);
  assert.equal(screenDeliveryProse("This will accentuate the point.").withheldCount, 0);
}

// 7. Case-insensitive matching: a sentence opening with "Confident
// delivery…" trips just as "confident delivery…" does.
{
  const upper = screenDeliveryProse("Confident delivery of the plan.");
  const lower = screenDeliveryProse("confident delivery of the plan.");
  assert.equal(upper.withheldCount, 1);
  assert.equal(lower.withheldCount, 1);
}

// 8. When every sentence is dropped, the result is the marker alone, never
// an empty string — an empty field would be exactly the silent edit D-32
// and D-68 forbid.
{
  const result = screenDeliveryProse("Accent was noticeable. Nervous energy throughout.");
  assert.equal(result.text, WITHHELD_REMARK_MARKER);
  assert.notEqual(result.text, "");
  assert.equal(result.withheldCount, 2);
}

// 9. splitSentences: no terminal punctuation returns the whole trimmed
// string as a single element; empty/whitespace-only return [].
{
  assert.deepEqual(splitSentences("no terminal punctuation here"), ["no terminal punctuation here"]);
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences("   "), []);
  assert.deepEqual(splitSentences("One. Two. Three."), ["One.", "Two.", "Three."]);
}

// 10. DELIVERY_TERMS carries, at minimum, the five dimensions LIVE-21 names
// plus the two RESEARCH-flagged terms.
{
  for (const term of ["accent", "fluency", "articulate", "filler", "pace", "confidence", "nervousness"]) {
    assert.ok(DELIVERY_TERMS.includes(term), `DELIVERY_TERMS must include "${term}"`);
  }
}

// 11. SCREENED_FIELD_PATHS itself: exactly 6 entries, none of which is the
// candidate's or the resume's own quoted words (RESEARCH Pitfall 2).
{
  assert.equal(SCREENED_FIELD_PATHS.length, 6);
  for (const forbidden of ["evidenceQuote", "questionText", "answerText", "spokenQuote", "resumeLine"]) {
    assert.ok(
      !SCREENED_FIELD_PATHS.some((p) => p.endsWith(forbidden)),
      `SCREENED_FIELD_PATHS must not screen "${forbidden}" — it is transcript-derived or quoted source material, not model commentary`
    );
  }
}

// 12. Schema-correspondence guard (RESEARCH Pitfall 2): every free-text
// (`type: "string"`) property declared in server.ts's LIVE_FEEDBACK_SCHEMA
// must be either the leaf of a SCREENED_FIELD_PATHS entry, or explicitly
// excluded below with a one-line reason. This is static text analysis over
// server.ts's source, not an import of it — server.ts performs real I/O
// (starts an Express server, calls dotenv.config()) at module scope, which
// is not safe to trigger from this assertion script.
{
  // Explicitly excluded free-text fields, each with the reason it is not
  // screened. Adding a new free-text field to LIVE_FEEDBACK_SCHEMA that is
  // in neither this list nor SCREENED_FIELD_PATHS fails this guard — that
  // failure is the point: it means nobody decided whether the new field can
  // carry a delivery remark.
  const excludedStringFields: Record<string, string> = {
    text: "the sub-ask's own text — structural, not a remark about the candidate",
    source: "the asked/implied_by_jd tag — structural",
    coverage: "the verdict enum value itself — structural",
    evidenceQuote: "the candidate's own verbatim words — screening it would delete their own sentence",
    questionText: "a verbatim transcript span of the interviewer's question — transcript-derived, not model commentary",
    questionIntent: "a description of what the interviewer was probing for, not a remark about the candidate",
    answerText: "a verbatim transcript span of the candidate's answer — transcript-derived, not model commentary",
    requirement: "a JD requirement string — structural, not a remark about the candidate",
    spokenQuote: "the candidate's own verbatim words — the same reason evidenceQuote is excluded",
    resumeLine: "the resume's own words — quoted source material, not model commentary",
  };

  const serverPath = fileURLToPath(new URL("../server.ts", import.meta.url));
  const serverSrc = readFileSync(serverPath, "utf8");

  const schemaStart = serverSrc.indexOf("const LIVE_FEEDBACK_SCHEMA");
  assert.ok(schemaStart !== -1, "server.ts must declare `const LIVE_FEEDBACK_SCHEMA`");
  const closeMarker = "as const satisfies Record<string, unknown>;";
  const schemaEnd = serverSrc.indexOf(closeMarker, schemaStart);
  assert.ok(
    schemaEnd !== -1,
    "LIVE_FEEDBACK_SCHEMA must close with this file's own `as const satisfies Record<string, unknown>;` convention"
  );
  const schemaSrc = serverSrc.slice(schemaStart, schemaEnd);

  const screenedLeaves = new Set(SCREENED_FIELD_PATHS.map((p) => p.split(".").pop()));

  const stringPropertyPattern = /(\w+):\s*\{\s*type:\s*"string"/g;
  const uncoveredFields: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = stringPropertyPattern.exec(schemaSrc)) !== null) {
    const fieldName = match[1];
    if (!screenedLeaves.has(fieldName) && !(fieldName in excludedStringFields)) {
      uncoveredFields.push(fieldName);
    }
  }

  assert.deepEqual(
    uncoveredFields,
    [],
    `A new free-text field was added to LIVE_FEEDBACK_SCHEMA (${uncoveredFields.join(", ")}) without deciding whether it is screened for delivery commentary — a delivery remark can now slip through in a field nobody checked. Add it to SCREENED_FIELD_PATHS in src/lib/deliveryScreen.ts, or to excludedStringFields above with a one-line reason.`
  );
}

// Phase 6 (LIVE-17/18 Wave 0 gate): src/lib/feedbackRollups.ts — D-58's
// silent-gaps/missed-follow-ups derivation, LIVE-19's JD-coverage set
// difference, the D-69 resume-evidence gate, and the D-73 ScoreRow
// derivation. `makeSegment` above (05-02's fixture helper) is reused for the
// quote fixtures below, per this task's own action text.

function makeSubAsk(
  overrides: Partial<SubAsk> & { text: string; source: SubAskSource; coverage: Coverage }
): SubAsk {
  return {
    evidenceQuote: "",
    quoteUnverified: false,
    assessment: "",
    whatAGoodAnswerWouldHaveIncluded: "",
    ...overrides,
  };
}

function makeExchange(overrides: Partial<Exchange> & { exchangeIndex: number; subAsks: SubAsk[] }): Exchange {
  return {
    questionText: `Question ${overrides.exchangeIndex}`,
    questionIntent: "",
    answerText: "",
    starApplicable: false,
    starNote: "",
    ...overrides,
  };
}

// One fixture rich enough to exercise every case at once: three exchanges
// declared out of exchangeIndex order (proving the internal sort), each
// carrying a mix of asked/implied sub-asks across all four Coverage values,
// a jdCoverage array with both evidenced and un-evidenced entries, and a
// resumeConsistency array with one verbatim-matching finding, one finding
// whose quote matches nothing, and one finding with an empty resumeLine.
const feedbackExchangeZero = makeExchange({
  exchangeIndex: 0,
  questionText: "Q-zero",
  subAsks: [
    makeSubAsk({ text: "asked-addressed-0", source: "asked", coverage: "ADDRESSED" }),
    makeSubAsk({ text: "asked-partial-0", source: "asked", coverage: "PARTIAL" }),
    makeSubAsk({ text: "implied-addressed-0", source: "implied_by_jd", coverage: "ADDRESSED" }),
    makeSubAsk({ text: "implied-notaddressed-0", source: "implied_by_jd", coverage: "NOT_ADDRESSED" }),
  ],
});

const feedbackExchangeOne = makeExchange({
  exchangeIndex: 1,
  questionText: "Q-one",
  subAsks: [
    makeSubAsk({ text: "asked-notaddressed-1", source: "asked", coverage: "NOT_ADDRESSED" }),
    makeSubAsk({ text: "asked-deflected-1", source: "asked", coverage: "DEFLECTED" }),
    makeSubAsk({ text: "implied-partial-1", source: "implied_by_jd", coverage: "PARTIAL" }),
  ],
});

const feedbackExchangeTwo = makeExchange({
  exchangeIndex: 2,
  questionText: "Q-two",
  subAsks: [
    makeSubAsk({ text: "asked-addressed-2", source: "asked", coverage: "ADDRESSED" }),
    makeSubAsk({ text: "implied-deflected-2", source: "implied_by_jd", coverage: "DEFLECTED" }),
  ],
});

const feedbackFixtureSegments: TranscriptSegment[] = [
  makeSegment({ seq: 900, text: "I led the payments team for two years." }),
];

const feedbackFixtureDoc: FeedbackDocument = {
  sessionId: "fixture",
  generatedAt: 0,
  transcriptFingerprint: fingerprintSegments(feedbackFixtureSegments),
  // Deliberately out of exchangeIndex order, to prove the internal sort.
  exchanges: [feedbackExchangeTwo, feedbackExchangeZero, feedbackExchangeOne],
  resumeConsistency: [
    {
      spokenQuote: "I led the payments team for two years.",
      resumeLine: "Led payments team for three years",
      note: "duration to reconcile",
    },
    {
      spokenQuote: "nothing like this was ever said",
      resumeLine: "Led payments team for three years",
      note: "unverifiable — must be dropped",
    },
    {
      spokenQuote: "I led the payments team for two years.",
      resumeLine: "",
      note: "no resume line — must be dropped",
    },
  ],
  jdCoverage: [
    { requirement: "Kubernetes", evidenced: false },
    { requirement: "On-call rotations", evidenced: true },
    { requirement: "Terraform", evidenced: false },
  ],
  strengths: "",
  priorityImprovements: "",
  withheldRemarkCount: 0,
};

// 1. Content and ordering: deriveSilentGaps/deriveMissedFollowUps return
// exactly the expected sub-asks, in exchangeIndex-then-position order, even
// though the fixture's own exchanges array is out of order (LIVE-17/18
// ordering).
{
  const gaps = deriveSilentGaps(feedbackFixtureDoc);
  assert.deepEqual(
    gaps.map((g) => g.subAskText),
    ["asked-partial-0", "asked-notaddressed-1", "asked-deflected-1"],
    "deriveSilentGaps must return the unaddressed asked sub-asks in exchangeIndex-then-position order"
  );
  assert.deepEqual(gaps.map((g) => g.exchangeIndex), [0, 1, 1]);

  const followUps = deriveMissedFollowUps(feedbackFixtureDoc);
  assert.deepEqual(
    followUps.map((f) => f.subAskText),
    ["implied-notaddressed-0", "implied-partial-1", "implied-deflected-2"],
    "deriveMissedFollowUps must return the unaddressed implied sub-asks in the same order discipline"
  );
  assert.deepEqual(followUps.map((f) => f.exchangeIndex), [0, 1, 2]);
}

// 2. Partition (LIVE-17 adjacency): the intersection of the sub-ask texts
// returned by deriveSilentGaps and deriveMissedFollowUps over the same
// document is empty — asserted as a computed set intersection, not by
// inspection, so a future change to either predicate trips it.
{
  const gapTexts = new Set(deriveSilentGaps(feedbackFixtureDoc).map((g) => g.subAskText));
  const followUpTexts = new Set(deriveMissedFollowUps(feedbackFixtureDoc).map((f) => f.subAskText));
  const intersection = [...gapTexts].filter((text) => followUpTexts.has(text));
  assert.deepEqual(
    intersection,
    [],
    "deriveSilentGaps and deriveMissedFollowUps must never share a sub-ask across the same document"
  );
}

// 3. Empty (LIVE-17 empty, LIVE-18 empty): a document whose every asked
// sub-ask is ADDRESSED returns [] from deriveSilentGaps; a document with no
// implied sub-asks at all returns [] from deriveMissedFollowUps; a document
// with zero exchanges returns [] from both. [] is a real answer the UI
// renders a sentence for, not an error state.
{
  const allAskedAddressed: FeedbackDocument = {
    ...feedbackFixtureDoc,
    exchanges: [
      makeExchange({
        exchangeIndex: 0,
        subAsks: [makeSubAsk({ text: "only-asked", source: "asked", coverage: "ADDRESSED" })],
      }),
    ],
  };
  assert.deepEqual(
    deriveSilentGaps(allAskedAddressed),
    [],
    "a document whose every asked sub-ask is ADDRESSED must return [] from deriveSilentGaps"
  );

  const noImplied: FeedbackDocument = {
    ...feedbackFixtureDoc,
    exchanges: [
      makeExchange({
        exchangeIndex: 0,
        subAsks: [makeSubAsk({ text: "only-asked-2", source: "asked", coverage: "NOT_ADDRESSED" })],
      }),
    ],
  };
  assert.deepEqual(
    deriveMissedFollowUps(noImplied),
    [],
    "a document with no implied sub-asks at all must return [] from deriveMissedFollowUps"
  );

  const zeroExchanges: FeedbackDocument = { ...feedbackFixtureDoc, exchanges: [] };
  assert.deepEqual(deriveSilentGaps(zeroExchanges), []);
  assert.deepEqual(deriveMissedFollowUps(zeroExchanges), []);
}

// 4. Ordering determinism and input immutability (LIVE-17/18 ordering):
// holds when the input exchanges array is shuffled, is deeply equal across
// two consecutive calls, and never mutates the input document's exchanges
// array order.
{
  const shuffled: FeedbackDocument = {
    ...feedbackFixtureDoc,
    exchanges: [feedbackExchangeOne, feedbackExchangeTwo, feedbackExchangeZero],
  };
  const first = deriveSilentGaps(shuffled);
  const second = deriveSilentGaps(shuffled);
  assert.deepEqual(first, second, "two calls on the same input must produce deeply equal output");
  assert.deepEqual(
    first.map((g) => g.exchangeIndex),
    [0, 1, 1],
    "ordering must hold regardless of the input exchanges array's own order"
  );

  const beforeOrder = shuffled.exchanges.map((e) => e.exchangeIndex);
  deriveSilentGaps(shuffled);
  deriveMissedFollowUps(shuffled);
  assert.deepEqual(
    shuffled.exchanges.map((e) => e.exchangeIndex),
    beforeOrder,
    "the input document's exchanges array order must be unchanged after the call"
  );
}

// 5. D-69 gate (LIVE-19): filterEvidencedResumeFindings returns exactly the
// one finding whose spoken quote matches, with spokenSegmentSeq and
// spokenStartMs populated from the matching segment; the unmatched finding
// and the empty-resumeLine finding are both absent.
{
  const filtered = filterEvidencedResumeFindings(feedbackFixtureDoc.resumeConsistency, feedbackFixtureSegments);
  assert.equal(filtered.length, 1, "exactly one finding — the verbatim-matching one — must survive the D-69 gate");
  assert.equal(filtered[0].spokenQuote, "I led the payments team for two years.");
  assert.equal(filtered[0].spokenSegmentSeq, 900);
  assert.equal(filtered[0].spokenStartMs, feedbackFixtureSegments[0].startMs);
}

// 6. deriveJdCoverage (LIVE-19): returns only un-evidenced requirements,
// preserving order; [] when everything is evidenced or the array is empty.
{
  const uncovered = deriveJdCoverage(feedbackFixtureDoc);
  assert.deepEqual(
    uncovered.map((item) => item.requirement),
    ["Kubernetes", "Terraform"],
    "deriveJdCoverage must return only un-evidenced requirements, preserving their original order"
  );
  assert.deepEqual(deriveJdCoverage({ ...feedbackFixtureDoc, jdCoverage: [] }), []);
  assert.deepEqual(
    deriveJdCoverage({ ...feedbackFixtureDoc, jdCoverage: [{ requirement: "X", evidenced: true }] }),
    [],
    "a jdCoverage array with everything evidenced must return []"
  );
}

// 7. D-73 derivation: the worked example from Task 1's behaviour block
// returns starRating 0.63 and competencyRating 0.5; a raw object missing one
// field returns null; a raw object with a NaN field returns null.
{
  const scoreRow = deriveScoreRow("Worked example", { s: 1, tE: 0.5, a: 0.75, rT: 0.25, cS: 1, aE: 0.5, rA: 0 });
  assert.ok(scoreRow, "a fully-populated raw score object must derive a ScoreRow, not null");
  assert.equal(scoreRow?.starRating, 0.63);
  assert.equal(scoreRow?.competencyRating, 0.5);

  assert.equal(
    deriveScoreRow("Missing field", { s: 1, tE: 0.5, a: 0.75, cS: 1, aE: 0.5, rA: 0 }),
    null,
    "a raw object missing one field must return null, not substitute zero"
  );
  assert.equal(
    deriveScoreRow("NaN field", { s: 1, tE: 0.5, a: 0.75, rT: Number.NaN, cS: 1, aE: 0.5, rA: 0 }),
    null,
    "a raw object with a NaN field must return null"
  );
}

// 8. Formula parity guard (D-73): src/lib/feedbackRollups.ts's starRating
// and competencyRating expressions must stay byte-equivalent (modulo
// whitespace) to InterviewScoringTable.tsx's own — the same static
// text-analysis technique the dtype/filename drift guard above uses,
// because InterviewScoringTable.tsx is a React component that cannot be
// loaded under plain Node.
{
  const rollupsPath = fileURLToPath(new URL("../src/lib/feedbackRollups.ts", import.meta.url));
  const scoringTablePath = fileURLToPath(new URL("../src/components/InterviewScoringTable.tsx", import.meta.url));
  const rollupsSrc = readFileSync(rollupsPath, "utf8");
  const scoringTableSrc = readFileSync(scoringTablePath, "utf8");

  const extractExpression = (src: string, assignedName: string): string => {
    const assignIdx = src.indexOf(`${assignedName} = Number(`);
    assert.ok(assignIdx !== -1, `expected to find "${assignedName} = Number(" in the source`);
    const closeIdx = src.indexOf(";", assignIdx);
    assert.ok(closeIdx !== -1, `expected a terminating ";" after "${assignedName} = Number("`);
    const numberCallIdx = src.indexOf("Number(", assignIdx);
    return src.slice(numberCallIdx, closeIdx).replace(/\s+/g, " ").trim();
  };

  const rollupsStar = extractExpression(rollupsSrc, "starRating");
  const scoringStar = extractExpression(scoringTableSrc, "targetRow.starRating");
  assert.equal(
    rollupsStar,
    scoringStar,
    "the Tool 4 derivation's starRating expression has drifted from the ledger's own formula (InterviewScoringTable.tsx) — a Tool-4-sourced row will silently disagree with a manually-edited one once Phase 7 wires the ledger"
  );

  const rollupsCompetency = extractExpression(rollupsSrc, "competencyRating");
  const scoringCompetency = extractExpression(scoringTableSrc, "targetRow.competencyRating");
  assert.equal(
    rollupsCompetency,
    scoringCompetency,
    "the Tool 4 derivation's competencyRating expression has drifted from the ledger's own formula (InterviewScoringTable.tsx) — a Tool-4-sourced row will silently disagree with a manually-edited one once Phase 7 wires the ledger"
  );
}

// Phase 6 Task 6-06-2 (LIVE-20): src/lib/exportFeedback.ts's feedbackToPlainText.
// Pure and synchronous, so it is asserted directly under Node with the same
// feedbackFixtureDoc/makeExchange/makeSubAsk fixtures the feedbackRollups
// block above declares at module scope.

const feedbackExportMetaFixture: FeedbackExportMeta = {
  appliedPosition: "Senior Backend Engineer",
  startedAt: 1_700_000_000_000,
  generatedAt: 1_700_000_060_000,
};

// 1. Section order (LIVE-20, D-58): the six section headings appear at
// strictly increasing indices, silent gaps first — computed, not a
// hardcoded whole-file string comparison.
{
  const text = feedbackToPlainText(feedbackFixtureDoc, feedbackExportMetaFixture);
  const headings = [
    "Silent gaps",
    "Missed follow-ups",
    "Resume consistency",
    "JD coverage",
    "Strengths & priority improvements",
    "Exchange-by-exchange detail",
  ];
  const indices = headings.map((heading) => text.indexOf(heading));
  indices.forEach((idx, i) => {
    assert.notEqual(idx, -1, `feedbackToPlainText must include the "${headings[i]}" heading`);
  });
  for (let i = 1; i < indices.length; i++) {
    assert.ok(
      indices[i] > indices[i - 1],
      `feedbackToPlainText must render D-58's six sections in fixed order — "${headings[i]}" must come after "${headings[i - 1]}"`
    );
  }
}

// 2. Empty document (LIVE-20 empty): zero exchanges, zero resume findings,
// zero JD items still returns a non-empty, non-whitespace string carrying
// the header, the content-only claim line, and the no-substantive-questions
// sentence — never an empty string, never a throw.
{
  const emptyDoc: FeedbackDocument = {
    sessionId: "empty-fixture",
    generatedAt: 0,
    transcriptFingerprint: "",
    exchanges: [],
    resumeConsistency: [],
    jdCoverage: [],
    strengths: "",
    priorityImprovements: "",
    withheldRemarkCount: 0,
  };
  const text = feedbackToPlainText(emptyDoc, feedbackExportMetaFixture);
  assert.ok(text.trim().length > 0, "a zero-exchange document must still produce a non-empty, non-whitespace string");
  assert.ok(text.includes("Live Interview Feedback"), "the header must name the document even when it is empty");
  assert.ok(
    text.includes("does not score accent, fluency, pace, filler words, or confidence"),
    "the content-only claim line must be present even on an empty document"
  );
  assert.ok(
    text.includes("No substantive questions were found in this take."),
    "a zero-exchange document must state that no substantive questions were found"
  );
}

// 3. Empty sections (LIVE-20 empty): a document with exchanges but no
// silent gaps still contains the Silent gaps heading and its empty-state
// sentence — a heading is never omitted because its list is empty.
{
  const docNoGaps: FeedbackDocument = {
    ...feedbackFixtureDoc,
    exchanges: [
      makeExchange({
        exchangeIndex: 0,
        subAsks: [makeSubAsk({ text: "only-asked", source: "asked", coverage: "ADDRESSED" })],
      }),
    ],
  };
  const text = feedbackToPlainText(docNoGaps, feedbackExportMetaFixture);
  assert.ok(text.includes("Silent gaps"), "the Silent gaps heading must never be omitted, even when its list is empty");
  assert.ok(
    text.includes("Every sub-ask the interviewer asked was addressed."),
    "an empty Silent gaps section must still state its empty-state sentence, matching the screen's wording"
  );
}

// 4. Unverified evidence: a sub-ask with quoteUnverified true produces the
// no-quotable-evidence statement, and its own (unverifiable) quote text
// never appears in the export.
{
  const unverifiedSubAsk = makeSubAsk({
    text: "unverified-sub-ask",
    source: "asked",
    coverage: "PARTIAL",
    evidenceQuote: "something that was never actually said",
    quoteUnverified: true,
  });
  const docUnverified: FeedbackDocument = {
    ...feedbackFixtureDoc,
    exchanges: [makeExchange({ exchangeIndex: 0, subAsks: [unverifiedSubAsk] })],
  };
  const text = feedbackToPlainText(docUnverified, feedbackExportMetaFixture);
  assert.ok(
    text.includes("No quotable evidence for this was found in the transcript."),
    "an unverified sub-ask must export the same no-quotable-evidence statement the screen shows"
  );
  assert.ok(
    !text.includes(unverifiedSubAsk.evidenceQuote),
    "an unverified sub-ask's own unverifiable quote text must never appear in the export"
  );
}

// 5. Timestamp prefix (RESEARCH Pattern 4): a verified sub-ask's quoted
// line carries a bracketed mm:ss prefix matching
// formatElapsed(evidenceStartMs).
{
  const verifiedSubAsk = makeSubAsk({
    text: "verified-sub-ask",
    source: "asked",
    coverage: "ADDRESSED",
    evidenceQuote: "I led the migration end to end.",
    evidenceSegmentSeq: 5,
    evidenceStartMs: 187_000,
    quoteUnverified: false,
  });
  const docVerified: FeedbackDocument = {
    ...feedbackFixtureDoc,
    exchanges: [makeExchange({ exchangeIndex: 0, subAsks: [verifiedSubAsk] })],
  };
  const text = feedbackToPlainText(docVerified, feedbackExportMetaFixture);
  const expectedLine = `[${formatElapsed(187_000)}] "I led the migration end to end."`;
  assert.ok(
    text.includes(expectedLine),
    `a verified sub-ask's quoted line must carry a [${formatElapsed(187_000)}] prefix matching formatElapsed(evidenceStartMs)`
  );
}

// 6. Withheld disclosure (D-68): a document with withheldRemarkCount above
// zero produces a line naming that count; a document with zero produces no
// such line.
{
  const docWithheld: FeedbackDocument = { ...feedbackFixtureDoc, withheldRemarkCount: 2 };
  const textWithheld = feedbackToPlainText(docWithheld, feedbackExportMetaFixture);
  assert.ok(
    textWithheld.includes("2 remarks about delivery were withheld from this record"),
    "a document with withheldRemarkCount above zero must produce a line naming that count"
  );

  const docNoWithheld: FeedbackDocument = { ...feedbackFixtureDoc, withheldRemarkCount: 0 };
  const textNoWithheld = feedbackToPlainText(docNoWithheld, feedbackExportMetaFixture);
  assert.ok(
    !textNoWithheld.includes("withheld from this record"),
    "a document with zero withheld remarks must produce no withheld-remark disclosure line"
  );
}

// 7. Line endings: the output contains no carriage return, and ends with
// exactly one trailing newline, matching formatTranscriptText's own
// convention.
{
  const text = feedbackToPlainText(feedbackFixtureDoc, feedbackExportMetaFixture);
  assert.ok(!text.includes("\r"), "feedbackToPlainText must never emit a carriage return");
  assert.ok(
    text.endsWith("\n") && !text.endsWith("\n\n"),
    "feedbackToPlainText must end with exactly one trailing newline"
  );
}

// 8. Purity: calling feedbackToPlainText twice on the same document returns
// identical strings, and the input document is never mutated.
{
  const beforeCall = structuredClone(feedbackFixtureDoc);
  const first = feedbackToPlainText(feedbackFixtureDoc, feedbackExportMetaFixture);
  const second = feedbackToPlainText(feedbackFixtureDoc, feedbackExportMetaFixture);
  assert.equal(first, second, "calling feedbackToPlainText twice on the same document must return identical strings");
  assert.deepEqual(
    feedbackFixtureDoc,
    beforeCall,
    "feedbackToPlainText must never mutate its input document"
  );
}

console.log("check-tag-track: all assertions passed");
