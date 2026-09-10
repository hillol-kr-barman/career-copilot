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
import type { TagPress, RecordingSession, AudioChunkMeta, TagSpan, TranscriptSegment } from "../src/types";

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

console.log("check-tag-track: all assertions passed");
