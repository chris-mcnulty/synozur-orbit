import path from "path";
import fs from "fs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Header,
  Footer,
  AlignmentType,
  HeadingLevel,
  UnderlineType,
  BorderStyle,
  WidthType,
  TableCell,
  TableRow,
  Table,
  PageNumber,
  NumberFormat,
  ShadingType,
  convertInchesToTwip,
  LevelFormat,
} from "docx";

const BRAND_COLOR = "810FFB";
const BODY_FONT = "Avenir Next LT Pro";
const BODY_SIZE = 22; // half-points (11pt)
const HEADING1_SIZE = 36; // 18pt
const HEADING2_SIZE = 28; // 14pt
const HEADING3_SIZE = 24; // 12pt
const MUTED_COLOR = "6B7280";
const DIVIDER_COLOR = "E5E7EB";

function logoBuffer(): Buffer | null {
  const logoPath = path.join(process.cwd(), "client", "public", "brand", "synozur-horizontal.png");
  try {
    return fs.readFileSync(logoPath);
  } catch {
    return null;
  }
}

function makeHeader(): Header {
  const logo = logoBuffer();
  const children: Paragraph[] = [];

  if (logo) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 80 },
        children: [
          new ImageRun({
            data: logo,
            transformation: { width: 120, height: 33 },
            type: "png",
          } as any),
        ],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_COLOR, space: 4 },
        },
      })
    );
  } else {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: "Synozur Orbit",
            font: BODY_FONT,
            size: 24,
            bold: true,
            color: BRAND_COLOR,
          }),
        ],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_COLOR, space: 4 },
        },
      })
    );
  }

  return new Header({ children });
}

function makeFooter(docTitle: string): Footer {
  const year = new Date().getFullYear();
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 2, color: DIVIDER_COLOR, space: 4 },
        },
        children: [
          new TextRun({
            text: `Synozur Orbit  |  synozur.com  |  © ${year} Synozur. All rights reserved.`,
            font: BODY_FONT,
            size: 16,
            color: MUTED_COLOR,
          }),
        ],
      }),
    ],
  });
}

interface RunSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function parseInline(text: string): RunSegment[] {
  const segments: RunSegment[] = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/gs;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index) });
    }
    if (match[2]) {
      segments.push({ text: match[2], bold: true, italic: true });
    } else if (match[3]) {
      segments.push({ text: match[3], bold: true });
    } else if (match[4]) {
      segments.push({ text: match[4], italic: true });
    } else if (match[5]) {
      segments.push({ text: match[5] });
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    segments.push({ text: text.slice(last) });
  }

  return segments.length > 0 ? segments : [{ text }];
}

function segmentsToRuns(segments: RunSegment[], extra?: Partial<Parameters<typeof TextRun>[0]>): TextRun[] {
  return segments.map(
    (s) =>
      new TextRun({
        text: s.text,
        font: BODY_FONT,
        size: BODY_SIZE,
        bold: s.bold,
        italics: s.italic,
        ...(extra || {}),
      })
  );
}

function headingParagraph(text: string, level: 1 | 2 | 3): Paragraph {
  const sizeMap = { 1: HEADING1_SIZE, 2: HEADING2_SIZE, 3: HEADING3_SIZE };
  const spaceAfter = { 1: 200, 2: 160, 3: 120 };
  const spaceBefore = { 1: 400, 2: 320, 3: 240 };

  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { before: spaceBefore[level], after: spaceAfter[level] },
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: sizeMap[level],
        bold: true,
        color: BRAND_COLOR,
      }),
    ],
  });
}

function bulletParagraph(text: string, depth = 0): Paragraph {
  const segs = parseInline(text);
  return new Paragraph({
    bullet: { level: depth },
    spacing: { after: 60 },
    indent: { left: convertInchesToTwip(0.25 + depth * 0.25) },
    children: segmentsToRuns(segs),
  });
}

function bodyParagraph(text: string): Paragraph {
  const segs = parseInline(text);
  return new Paragraph({
    spacing: { after: 120 },
    children: segmentsToRuns(segs),
  });
}

function hrParagraph(): Paragraph {
  return new Paragraph({
    spacing: { before: 160, after: 160 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 2, color: DIVIDER_COLOR, space: 4 },
    },
    children: [],
  });
}

export function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  const lines = markdown.split("\n");
  const paragraphs: Paragraph[] = [];
  let pendingLines: string[] = [];

  function flushPending() {
    if (pendingLines.length === 0) return;
    const combined = pendingLines.join(" ").trim();
    pendingLines = [];
    if (combined) paragraphs.push(bodyParagraph(combined));
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushPending();
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushPending();
      paragraphs.push(hrParagraph());
      continue;
    }

    // Standalone image line: ![alt](url). We can't embed the remote image
    // synchronously, so render the alt text as an italic caption instead of
    // dumping the raw Markdown into the document.
    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushPending();
      const caption = imageMatch[1].trim();
      if (caption) {
        paragraphs.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: caption, font: BODY_FONT, size: BODY_SIZE, italics: true, color: MUTED_COLOR })],
          }),
        );
      }
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushPending();
      paragraphs.push(headingParagraph(trimmed.slice(4).trim(), 3));
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushPending();
      paragraphs.push(headingParagraph(trimmed.slice(3).trim(), 2));
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushPending();
      paragraphs.push(headingParagraph(trimmed.slice(2).trim(), 1));
      continue;
    }

    const bulletMatch = trimmed.match(/^(-|\*|\d+\.) (.+)/);
    if (bulletMatch) {
      flushPending();
      const depth = Math.max(0, Math.floor((line.length - line.trimStart().length) / 2));
      paragraphs.push(bulletParagraph(bulletMatch[2], depth));
      continue;
    }

    pendingLines.push(trimmed);
  }

  flushPending();
  return paragraphs;
}

export async function buildBrandedDocx(title: string, markdown: string): Promise<Buffer> {
  const contentParagraphs = markdownToDocxParagraphs(markdown);

  const doc = new Document({
    creator: "Synozur Orbit",
    title,
    description: `${title} — generated by Synozur Orbit`,
    styles: {
      default: {
        document: {
          run: {
            font: BODY_FONT,
            size: BODY_SIZE,
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "orbit-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) } },
                run: { font: "Symbol" },
              },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: "\u25E6",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } },
                run: { font: "Courier New" },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.15),
              right: convertInchesToTwip(1.15),
            },
          },
        },
        headers: { default: makeHeader() },
        footers: { default: makeFooter(title) },
        children: contentParagraphs,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
