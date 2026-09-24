import type { Coverage, FeedbackDocument, JdCoverageItem, ResumeConsistencyFinding, SubAsk, Exchange } from "../types";
import { formatElapsed } from "./formatTime";
import { downloadBlob } from "./download";
import { deriveSilentGaps, deriveMissedFollowUps, deriveJdCoverage, deriveScoreRow } from "./feedbackRollups";

/**
 * PDF, DOCX and plain-text export for the LIVE-20 feedback document.
 *
 * jsPDF and docx together weigh ~740 kB — more than the rest of the app. Both
 * are pulled in with dynamic import() so they are only fetched when a user
 * actually clicks an export button, keeping the initial page load small
 * (`exportQA.ts`'s own precedent, unchanged here). This module adds no
 * fourth `download*` helper — `downloadBlob` covers the DOCX blob and the
 * caller hands `feedbackToPlainText`'s string straight to `downloadText` —
 * and no format/templating library; the three formats are built with the
 * same two dependencies `exportQA.ts` already uses.
 *
 * The transcript itself is never included in any of the three exports —
 * `formatTranscriptText` already ships it as LIVE-14's own separate
 * download, and duplicating it here would double every file for no new
 * information.
 *
 * A caller passing `FeedbackDocument.resumeConsistency` to any exporter here
 * is expected to have already run it through `feedbackRollups.ts`'s
 * `filterEvidencedResumeFindings` (D-69) — this module has no access to the
 * live transcript segments that gate requires, so it renders whatever
 * `resumeConsistency` array it is handed, exactly as `feedbackRollups.ts`'s
 * other three derivations (`deriveSilentGaps`, `deriveMissedFollowUps`,
 * `deriveJdCoverage`) are called directly below so the export and the screen
 * can never derive different sets for those three sections.
 */

export interface FeedbackExportMeta {
  appliedPosition: string;
  /** The analysed take's own `RecordingSession.startedAt`. */
  startedAt: number;
  /** `FeedbackDocument.generatedAt` — when Assess actually finished. */
  generatedAt: number;
}

const documentTitle = (meta: FeedbackExportMeta): string =>
  meta.appliedPosition
    ? `Live Interview Feedback — ${meta.appliedPosition}`
    : "Live Interview Feedback";

/**
 * Not fully private, unlike `exportQA.ts`'s pair: the plain-text export
 * button in `LiveInterviewFeedback.tsx` needs the same stem `downloadText`'s
 * filename uses, so `feedbackToPlainText`'s caller can build
 * `${fileStem(meta)}-feedback.txt` without a second, independently-drifting
 * slugify implementation.
 */
export const fileStem = (meta: FeedbackExportMeta): string => {
  const slug = (meta.appliedPosition || "live-interview-feedback")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "live-interview-feedback";
};

/** D-67 layer 3: the claim lives inside the file it ships in, matching `formatTranscriptText`'s own LIVE-10 discipline. */
const CONTENT_ONLY_CLAIM =
  "This document judges what was said and does not score accent, fluency, pace, filler words, or confidence.";

/** Matches `LiveInterviewFeedback.tsx`'s own zero-exchange sentence verbatim. */
const NO_SUBSTANTIVE_QUESTIONS_LINE = "No substantive questions were found in this take.";

/** Matches `ExchangeDetail.tsx`'s `SubAskRow` unverified-evidence sentence verbatim (D-66). */
const NO_QUOTABLE_EVIDENCE_LINE = "No quotable evidence for this was found in the transcript.";

/**
 * D-59's glyph-to-verdict mapping, declared locally rather than imported from
 * `ExchangeDetail.tsx` — that file is a `.tsx` component, and importing it
 * here would pull React into a module `feedbackToPlainText` must stay
 * loadable under plain Node without (the same reasoning `transcriptText.ts`
 * gives for declaring its own `SPEAKER_EXPORT_LABEL` instead of importing
 * `SpeakerBanner.tsx`'s `SPEAKER_LABEL`).
 */
const COVERAGE_LABEL: Record<Coverage, string> = {
  ADDRESSED: "Addressed",
  PARTIAL: "Partial",
  NOT_ADDRESSED: "Not addressed",
  DEFLECTED: "Deflected",
};

const COVERAGE_GLYPH: Record<Coverage, string> = {
  ADDRESSED: "●",
  PARTIAL: "◐",
  NOT_ADDRESSED: "○",
  DEFLECTED: "◒",
};

/**
 * One line of the section model `buildSections` returns. `indent` marks a
 * nested sub-ask/detail row — the PDF writer offsets both the text origin
 * and the wrap width for it (never spaces prefixed into the text, which
 * would break `splitTextToSize`), and the DOCX writer gives it a paragraph
 * indent. `isExchangeHeader` marks only the one line naming an exchange's own
 * question (Section 6) — the PDF writer reserves extra room before it so an
 * exchange's card never starts on the last line of a page.
 */
interface DocLine {
  text: string;
  indent?: boolean;
  isExchangeHeader?: boolean;
}

interface DocSection {
  heading: string;
  lines: DocLine[];
}

/** A verified quote's `[mm:ss] "text"` line, or the D-66 no-evidence sentence, or `null` when there is genuinely nothing to say (an empty, still-unverified sub-ask). */
function evidenceLine(subAsk: SubAsk): string | null {
  const hasQuote = subAsk.evidenceQuote.trim().length > 0;
  if (hasQuote && !subAsk.quoteUnverified) {
    return `[${formatElapsed(subAsk.evidenceStartMs ?? 0)}] "${subAsk.evidenceQuote}"`;
  }
  if (subAsk.quoteUnverified) {
    return NO_QUOTABLE_EVIDENCE_LINE;
  }
  return null;
}

/** Sections 1 and 2 (D-58): the shared row shape `SilentGap`/`MissedFollowUp` both carry, rendered exactly as `SubAskRollupList` renders them on screen — coverage glyph plus word, the question, the sub-ask text — with no evidence quote (neither type carries one). */
function rollupLines(
  items: { questionText: string; subAskText: string; coverage: Coverage }[],
  emptyText: string
): DocLine[] {
  if (items.length === 0) return [{ text: emptyText }];
  const lines: DocLine[] = [];
  for (const item of items) {
    lines.push({ text: `${COVERAGE_GLYPH[item.coverage]} ${COVERAGE_LABEL[item.coverage]} — ${item.questionText}` });
    lines.push({ text: item.subAskText, indent: true });
  }
  return lines;
}

/** Section 3 (D-58, D-69): every finding here is assumed already gated by `filterEvidencedResumeFindings` — see the module doc-comment. Both sides are shown, matching the screen's "Said" / "Resume says" pairing. */
function resumeConsistencyLines(findings: ResumeConsistencyFinding[]): DocLine[] {
  if (findings.length === 0) return [{ text: "Nothing said contradicted the resume." }];
  const lines: DocLine[] = [];
  for (const finding of findings) {
    lines.push({ text: `Said: [${formatElapsed(finding.spokenStartMs ?? 0)}] "${finding.spokenQuote}"` });
    lines.push({ text: `Resume says: "${finding.resumeLine}"`, indent: true });
    if (finding.note.trim()) lines.push({ text: finding.note, indent: true });
  }
  return lines;
}

/** Section 4 (D-58, LIVE-19). */
function jdCoverageLines(items: JdCoverageItem[]): DocLine[] {
  if (items.length === 0) {
    return [{ text: "Every requirement drawn from the job description was evidenced." }];
  }
  return items.map((item) => ({ text: `— ${item.requirement}` }));
}

/** Section 5 (D-58, D-68): the withheld-remark disclosure, then strengths and priority improvements as their own labelled sub-rows — two prose fields folded into one D-58 section, matching the screen's single `<section>` wrapping both `<h4>`s. */
function strengthsSectionLines(doc: FeedbackDocument): DocLine[] {
  const lines: DocLine[] = [];
  if (doc.withheldRemarkCount > 0) {
    lines.push({
      text: `${doc.withheldRemarkCount} remark${doc.withheldRemarkCount === 1 ? "" : "s"} about delivery ${
        doc.withheldRemarkCount === 1 ? "was" : "were"
      } withheld from this record — this tool judges content only.`,
    });
  }
  lines.push({ text: "Strengths:" });
  if (doc.strengths.trim()) lines.push({ text: doc.strengths, indent: true });
  lines.push({ text: "Priority improvements:" });
  if (doc.priorityImprovements.trim()) lines.push({ text: doc.priorityImprovements, indent: true });
  return lines;
}

/** Section 6 (D-58, last): one exchange's full card — question, intent, every sub-ask with its verdict/evidence, then the D-73 STAR read only when `starApplicable` is true AND `deriveScoreRow` actually returns a row (never a row of zeros). */
function exchangeLines(exchange: Exchange): DocLine[] {
  const lines: DocLine[] = [];
  lines.push({ text: `${exchange.exchangeIndex + 1}. ${exchange.questionText}`, isExchangeHeader: true });

  if (exchange.questionIntent.trim()) {
    lines.push({ text: exchange.questionIntent, indent: true });
  }

  for (const subAsk of exchange.subAsks) {
    const opportunityLabel =
      subAsk.source === "implied_by_jd" ? " (an opportunity the job description implies)" : "";
    lines.push({
      text: `${COVERAGE_GLYPH[subAsk.coverage]} ${COVERAGE_LABEL[subAsk.coverage]}${opportunityLabel} — ${subAsk.text}`,
      indent: true,
    });
    if (subAsk.assessment.trim()) {
      lines.push({ text: subAsk.assessment, indent: true });
    }
    if (subAsk.whatAGoodAnswerWouldHaveIncluded.trim()) {
      lines.push({
        text: `A good answer would have included: ${subAsk.whatAGoodAnswerWouldHaveIncluded}`,
        indent: true,
      });
    }
    const quoteLine = evidenceLine(subAsk);
    if (quoteLine) lines.push({ text: quoteLine, indent: true });
  }

  if (exchange.starApplicable) {
    const scoreRow = deriveScoreRow(exchange.questionText, exchange.scoreRow);
    if (scoreRow) {
      lines.push({
        text: `STAR completeness — Situation ${scoreRow.s}, Task ${scoreRow.tE}, Action ${scoreRow.a}, Result ${scoreRow.rT} (rating ${scoreRow.starRating})`,
        indent: true,
      });
      if (exchange.starNote.trim()) lines.push({ text: exchange.starNote, indent: true });
    }
  }

  return lines;
}

/**
 * D-58's six ordered sections, built once and consumed by all three
 * exporters so the three formats can never drift apart in content or order.
 * Only called once `doc.exchanges.length > 0` — the zero-exchange case is
 * handled by each exporter directly, matching the screen's own branch.
 */
function buildSections(doc: FeedbackDocument): DocSection[] {
  return [
    { heading: "Silent gaps", lines: rollupLines(deriveSilentGaps(doc), "Every sub-ask the interviewer asked was addressed.") },
    {
      heading: "Missed follow-ups",
      lines: rollupLines(deriveMissedFollowUps(doc), "No follow-up implied by the job description was missed."),
    },
    { heading: "Resume consistency", lines: resumeConsistencyLines(doc.resumeConsistency) },
    { heading: "JD coverage", lines: jdCoverageLines(deriveJdCoverage(doc)) },
    { heading: "Strengths & priority improvements", lines: strengthsSectionLines(doc) },
    { heading: "Exchange-by-exchange detail", lines: doc.exchanges.flatMap(exchangeLines) },
  ];
}

const metaLine = (meta: FeedbackExportMeta): string =>
  `Take started ${new Date(meta.startedAt).toLocaleString()} · generated ${new Date(meta.generatedAt).toLocaleString()}`;

/**
 * PDF export.
 *
 * jsPDF has no flow layout, so this tracks the cursor by hand — the same
 * `ensureRoom`/`writeBlock` pair `exportQA.ts` uses, reproduced here with one
 * addition: `writeBlock` takes an `indent` option that offsets both the text
 * origin and the wrap width, used for every nested (sub-ask/detail) row.
 */
export const exportFeedbackToPDF = async (doc: FeedbackDocument, meta: FeedbackExportMeta) => {
  const { jsPDF } = await import("jspdf");

  const pdf = new jsPDF({ unit: "pt", format: "a4" });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - margin;
  const subAskIndent = 18;

  let y = margin;

  const ensureRoom = (needed: number) => {
    if (y + needed > bottomLimit) {
      pdf.addPage();
      y = margin;
    }
  };

  const writeBlock = (
    text: string,
    opts: {
      size: number;
      style?: "normal" | "bold" | "italic";
      gapAfter: number;
      color?: [number, number, number];
      indent?: number;
    }
  ) => {
    pdf.setFontSize(opts.size);
    pdf.setFont("helvetica", opts.style ?? "normal");
    const [r, g, b] = opts.color ?? [17, 17, 17];
    pdf.setTextColor(r, g, b);

    const lines = pdf.splitTextToSize(text, maxWidth - (opts.indent ?? 0)) as string[];
    const lineHeight = opts.size * 1.45;

    for (const line of lines) {
      ensureRoom(lineHeight);
      pdf.text(line, margin + (opts.indent ?? 0), y);
      y += lineHeight;
    }
    y += opts.gapAfter;
  };

  writeBlock(documentTitle(meta), { size: 20, style: "bold", gapAfter: 6 });
  writeBlock(metaLine(meta), { size: 10, gapAfter: 4, color: [110, 110, 110] });
  writeBlock(CONTENT_ONLY_CLAIM, { size: 9, style: "italic", gapAfter: 20, color: [110, 110, 110] });

  if (doc.exchanges.length === 0) {
    writeBlock(NO_SUBSTANTIVE_QUESTIONS_LINE, { size: 11, gapAfter: 0 });
    pdf.save(`${fileStem(meta)}-feedback.pdf`);
    return;
  }

  for (const section of buildSections(doc)) {
    ensureRoom(40);
    writeBlock(section.heading, { size: 14, style: "bold", gapAfter: 8 });
    for (const line of section.lines) {
      if (line.isExchangeHeader) ensureRoom(60);
      if (line.indent) {
        writeBlock(line.text, { size: 10.5, gapAfter: 4, indent: subAskIndent, color: [60, 60, 60] });
      } else {
        writeBlock(line.text, { size: 11, style: "bold", gapAfter: 4 });
      }
    }
    y += 10;
  }

  pdf.save(`${fileStem(meta)}-feedback.pdf`);
};

/** DOCX export — real Word XML via the `docx` package, not an HTML rename. */
export const exportFeedbackToDOCX = async (doc: FeedbackDocument, meta: FeedbackExportMeta) => {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = await import("docx");

  const subAskIndentTwips = 360; // ~0.25in

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ text: documentTitle(meta), heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [new TextRun({ text: metaLine(meta), italics: true, color: "6E6E6E" })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: CONTENT_ONLY_CLAIM, italics: true, size: 18, color: "6E6E6E" })],
      spacing: { after: 320 },
    }),
  ];

  if (doc.exchanges.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: NO_SUBSTANTIVE_QUESTIONS_LINE })] }));
  } else {
    for (const section of buildSections(doc)) {
      children.push(
        new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 100 } })
      );
      for (const line of section.lines) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line.text, bold: !line.indent })],
            indent: line.indent ? { left: subAskIndentTwips } : undefined,
            spacing: { after: 120 },
          })
        );
      }
    }
  }

  const built = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(built);
  downloadBlob(`${fileStem(meta)}-feedback.docx`, blob);
};

/**
 * Plain-text export. Synchronous, pure, no browser global, no dynamic
 * import — importable under plain Node so `scripts/check-tag-track.ts` can
 * assert it directly, the same discipline `qaToPlainText`/
 * `formatTranscriptText` already follow. Ends with a single trailing
 * newline and no carriage returns.
 */
export function feedbackToPlainText(doc: FeedbackDocument, meta: FeedbackExportMeta): string {
  const lines: string[] = [documentTitle(meta), metaLine(meta), CONTENT_ONLY_CLAIM];

  if (doc.exchanges.length === 0) {
    lines.push("", NO_SUBSTANTIVE_QUESTIONS_LINE);
    return lines.join("\n") + "\n";
  }

  for (const section of buildSections(doc)) {
    lines.push("", section.heading);
    for (const line of section.lines) {
      lines.push(line.indent ? `  ${line.text}` : line.text);
    }
  }

  return lines.join("\n") + "\n";
}
