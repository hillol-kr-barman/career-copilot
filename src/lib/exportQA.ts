import type { Paragraph as ParagraphType } from "docx";
import { QAPair } from "../types";
import { downloadBlob } from "./download";

/**
 * PDF and DOCX generation.
 *
 * jsPDF and docx together weigh ~740 kB — more than the rest of the app. Both
 * are pulled in with dynamic import() so they are only fetched when a user
 * actually clicks an export button, keeping the initial page load small.
 */

interface ExportMeta {
  appliedPosition: string;
}

const documentTitle = (meta: ExportMeta) =>
  meta.appliedPosition
    ? `Interview Preparation — ${meta.appliedPosition}`
    : "Interview Preparation";

const fileStem = (meta: ExportMeta) => {
  const slug = (meta.appliedPosition || "interview-prep")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "interview-prep";
};

/**
 * PDF export.
 *
 * jsPDF has no flow layout, so this tracks the cursor by hand: every line is
 * measured and a page break is inserted before any line that would cross the
 * bottom margin.
 */
export const exportQAtoPDF = async (pairs: QAPair[], meta: ExportMeta) => {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - margin;

  let y = margin;

  const ensureRoom = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
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
    }
  ) => {
    doc.setFontSize(opts.size);
    doc.setFont("helvetica", opts.style ?? "normal");
    const [r, g, b] = opts.color ?? [17, 17, 17];
    doc.setTextColor(r, g, b);

    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    const lineHeight = opts.size * 1.45;

    for (const line of lines) {
      ensureRoom(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += opts.gapAfter;
  };

  writeBlock(documentTitle(meta), { size: 20, style: "bold", gapAfter: 6 });
  writeBlock(
    `${pairs.length} question${pairs.length === 1 ? "" : "s"} · generated ${new Date().toLocaleDateString()}`,
    { size: 10, gapAfter: 22, color: [110, 110, 110] }
  );

  pairs.forEach((pair, i) => {
    ensureRoom(60);
    writeBlock(`${i + 1}. ${pair.question}`, { size: 12, style: "bold", gapAfter: 8 });

    if (pair.category) {
      writeBlock(`[${pair.category}] ${pair.rationale ?? ""}`.trim(), {
        size: 9,
        style: "italic",
        gapAfter: 8,
        color: [120, 120, 120],
      });
    }

    writeBlock(pair.answer, { size: 11, gapAfter: 22, color: [40, 40, 40] });
  });

  doc.save(`${fileStem(meta)}-qa.pdf`);
};

/** DOCX export — real Word XML via the `docx` package, not an HTML rename. */
export const exportQAtoDOCX = async (pairs: QAPair[], meta: ExportMeta) => {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = await import("docx");

  const children: ParagraphType[] = [
    new Paragraph({
      text: documentTitle(meta),
      heading: HeadingLevel.HEADING_1,
    }),
  ];

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${pairs.length} question${pairs.length === 1 ? "" : "s"} · generated ${new Date().toLocaleDateString()}`,
          italics: true,
          color: "6E6E6E",
        }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 320 },
    })
  );

  pairs.forEach((pair, i) => {
    children.push(
      new Paragraph({
        text: `${i + 1}. ${pair.question}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 100 },
      })
    );

    if (pair.category || pair.rationale) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `[${pair.category}] ${pair.rationale ?? ""}`.trim(),
              italics: true,
              size: 18,
              color: "787878",
            }),
          ],
          spacing: { after: 120 },
        })
      );
    }

    children.push(
      new Paragraph({
        children: [new TextRun({ text: pair.answer })],
        spacing: { after: 200 },
      })
    );
  });

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(`${fileStem(meta)}-qa.docx`, blob);
};

/** Plain-text fallback, used for the TXT download. */
export const qaToPlainText = (pairs: QAPair[], meta: ExportMeta): string => {
  const lines: string[] = [documentTitle(meta), ""];

  pairs.forEach((pair, i) => {
    lines.push(`${i + 1}. ${pair.question}`);
    if (pair.category) lines.push(`   [${pair.category}] ${pair.rationale ?? ""}`.trimEnd());
    lines.push("", pair.answer, "");
  });

  return lines.join("\n");
};
