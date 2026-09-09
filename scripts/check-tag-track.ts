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
import { deriveSpans, sortTakesNewestFirst, normaliseSessionRecord } from "../src/lib/recordingStore";
import { audioElapsedMs } from "../src/lib/recorder";
import type { TagPress, RecordingSession } from "../src/types";

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

console.log("check-tag-track: all assertions passed");
