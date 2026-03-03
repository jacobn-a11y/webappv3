import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

export function sanitizeFileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function markdownToPlainLines(markdown: string): Array<{ text: string; level: 0 | 1 | 2 | 3 }> {
  return markdown
    .split(/\r?\n/)
    .map((raw) => {
      if (raw.trim().length === 0) {
        return { text: "", level: 0 as const };
      }
      if (raw.startsWith("### ")) {
        return { text: raw.slice(4).trim(), level: 3 as const };
      }
      if (raw.startsWith("## ")) {
        return { text: raw.slice(3).trim(), level: 2 as const };
      }
      if (raw.startsWith("# ")) {
        return { text: raw.slice(2).trim(), level: 1 as const };
      }
      return {
        text: raw
          .replace(/\*\*(.*?)\*\*/g, "$1")
          .replace(/\*(.*?)\*/g, "$1")
          .replace(/`(.*?)`/g, "$1")
          .replace(/^[-*+]\s+/, "- ")
          .replace(/^>\s+/, "")
          .replace(/\[(.*?)\]\((.*?)\)/g, "$1"),
        level: 0 as const,
      };
    });
}

function wrapText(text: string, maxWidth: number, font: any, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0] ?? "";

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }

  lines.push(current);
  return lines;
}

export async function markdownToPdfBuffer(title: string, markdown: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const width = 612;
  const height = 792;
  let page = pdfDoc.addPage([width, height]);
  let y = height - margin;

  const drawLine = (text: string, opts?: { level?: 0 | 1 | 2 | 3 }) => {
    const level = opts?.level ?? 0;
    const size = level === 1 ? 20 : level === 2 ? 16 : level === 3 ? 13 : 11;
    const activeFont = level > 0 ? boldFont : font;
    const lineHeight = size * 1.35;
    const maxWidth = width - margin * 2;

    const wrapped = wrapText(text, maxWidth, activeFont, size);
    for (const line of wrapped) {
      if (y < margin + lineHeight) {
        page = pdfDoc.addPage([width, height]);
        y = height - margin;
      }
      page.drawText(line, {
        x: margin,
        y,
        size,
        font: activeFont,
        color: rgb(0.08, 0.1, 0.16),
      });
      y -= lineHeight;
    }

    y -= level > 0 ? 6 : 2;
  };

  drawLine(title, { level: 1 });
  for (const line of markdownToPlainLines(markdown)) {
    if (line.text.length === 0) {
      y -= 8;
      continue;
    }
    drawLine(line.text, { level: line.level });
  }

  return pdfDoc.save();
}

export async function markdownToDocxBuffer(title: string, markdown: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(title)],
    }),
  ];

  for (const line of markdownToPlainLines(markdown)) {
    if (line.text.length === 0) {
      children.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }

    if (line.level === 1) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun(line.text)],
        })
      );
      continue;
    }

    if (line.level === 2) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(line.text)],
        })
      );
      continue;
    }

    if (line.level === 3) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun(line.text)],
        })
      );
      continue;
    }

    children.push(
      new Paragraph({
        children: [new TextRun(line.text)],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
