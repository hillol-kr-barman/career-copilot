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
import type { TagPress, RecordingSession, AudioChunkMeta } from "../src/types";

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

  // A well-formed record normalises successfully with every field intact.
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

console.log("check-tag-track: all assertions passed");
