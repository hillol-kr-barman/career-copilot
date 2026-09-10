import type { RecordingSession, Speaker, TranscriptSegment } from "../types";
import { formatElapsed } from "./formatTime";
import { groupIntoTurns } from "./transcriptTurns";

/**
 * LIVE-14's plain-text export formatter. Pure — touches no browser global —
 * so `scripts/check-tag-track.ts` can assert it under Node. Builds a string
 * for `src/lib/download.ts`'s existing `downloadText` to hand to the
 * browser; this module does not add a fourth `download*` helper.
 *
 * Declares its own two-entry speaker-label map rather than importing
 * `SPEAKER_LABEL` from `src/components/SpeakerBanner.tsx` — that file is a
 * `.tsx` component, and importing it here would pull React into a
 * Node-importable pure module that `scripts/check-tag-track.ts` needs to
 * load without a DOM shim.
 */
const SPEAKER_EXPORT_LABEL: Record<Speaker, string> = {
  candidate: "Candidate",
  interviewer: "Interviewer",
};

/** Marks a turn label whose speaker was corrected (LIVE-13) — see doc comment on `formatTranscriptText` for why this is load-bearing. */
const CORRECTED_LABEL_SUFFIX = " (corrected)";

/**
 * Formats a take's transcript as plain text for LIVE-14's export:
 * - A header naming the take's local start time, its duration
 *   (`formatElapsed`), the segment count, and one line stating the
 *   transcript was produced in this browser with no upload and no API key
 *   — the export's own copy of LIVE-10's claim, which must be true of the
 *   file it sits in.
 * - A blank line, then one line per turn from `groupIntoTurns`:
 *   `[mm:ss] Speaker: text`, where `mm:ss` is `formatElapsed(turn.startMs)`
 *   and `text` is the member segments' `text` trimmed and joined with a
 *   single space.
 * - A turn whose `corrected` flag is true carries `CORRECTED_LABEL_SUFFIX`
 *   on its label. The downloaded tag-track sidecar keeps what was actually
 *   pressed (D-49, D-54); a plain-text file that silently presented a
 *   corrected label as the recorded one would make the two artefacts
 *   disagree without saying so.
 * - Zero segments: the header, then one line stating no transcript segments
 *   were produced for this take. Never an empty string, never a throw.
 * - Lines joined with `\n`, ending with a single trailing newline. No
 *   carriage returns — `downloadText` writes UTF-8 and the file is read on
 *   the operator's own machine.
 */
export function formatTranscriptText(take: RecordingSession, segments: TranscriptSegment[]): string {
  const startedAtLocal = new Date(take.startedAt).toLocaleString();
  const segmentCount = segments.length;

  const lines: string[] = [
    `Live Interview transcript — started ${startedAtLocal}, duration ${formatElapsed(take.durationMs)}, ${segmentCount} segment${segmentCount === 1 ? "" : "s"}.`,
    "Transcribed entirely in this browser — no upload, no API key.",
    "",
  ];

  if (segmentCount === 0) {
    lines.push("No transcript segments were produced for this take.");
  } else {
    for (const turn of groupIntoTurns(segments)) {
      const label = SPEAKER_EXPORT_LABEL[turn.speaker] + (turn.corrected ? CORRECTED_LABEL_SUFFIX : "");
      const text = turn.segments
        .map((segment) => segment.text.trim())
        .filter((trimmed) => trimmed.length > 0)
        .join(" ");
      lines.push(`[${formatElapsed(turn.startMs)}] ${label}: ${text}`);
    }
  }

  return lines.join("\n") + "\n";
}
