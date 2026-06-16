import type { WikiChunkRecord, WikiDocumentRef, WikiWarning } from "./wiki-types.js";

export const DEFAULT_MAX_CHUNK_CHARS = 2000;
export const MIN_MAX_CHUNK_CHARS = 200;
export const MAX_MAX_CHUNK_CHARS = 8000;

type NormalizedChunkLimit = {
  readonly value: number;
  readonly warnings: readonly WikiWarning[];
};

type MarkdownSection = {
  readonly startLine: number;
  readonly text: string;
  readonly headingPath: readonly string[];
};

type RawChunk = {
  readonly startLine: number;
  readonly endLine: number;
  readonly headingPath: readonly string[];
  readonly text: string;
};

export type ChunkMarkdownDocumentInput = {
  readonly document: WikiDocumentRef;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly text: string;
  readonly maxChunkChars?: number;
};

export type ChunkMarkdownDocumentResult = {
  readonly chunks: readonly WikiChunkRecord[];
  readonly warnings: readonly WikiWarning[];
};

export function normalizeMaxChunkChars(maxChunkChars: number | undefined): NormalizedChunkLimit {
  if (maxChunkChars === undefined || !Number.isFinite(maxChunkChars)) return { value: DEFAULT_MAX_CHUNK_CHARS, warnings: [] };
  const requested = Math.floor(maxChunkChars);
  if (requested > MAX_MAX_CHUNK_CHARS) {
    return {
      value: MAX_MAX_CHUNK_CHARS,
      warnings: [{
        code: "max_chunk_chars_clamped",
        message: `maxChunkChars must be at most ${MAX_MAX_CHUNK_CHARS}; using ${MAX_MAX_CHUNK_CHARS}.`,
        requestedValue: requested,
        appliedValue: MAX_MAX_CHUNK_CHARS,
      }],
    };
  }
  if (requested >= MIN_MAX_CHUNK_CHARS) return { value: requested, warnings: [] };
  return {
    value: MIN_MAX_CHUNK_CHARS,
    warnings: [{
      code: "max_chunk_chars_clamped",
      message: `maxChunkChars must be at least ${MIN_MAX_CHUNK_CHARS}; using ${MIN_MAX_CHUNK_CHARS}.`,
      requestedValue: requested,
      appliedValue: MIN_MAX_CHUNK_CHARS,
    }],
  };
}

export function estimateWikiTokens(text: string): number {
  const length = Array.from(text.trim()).length;
  return length === 0 ? 0 : Math.max(1, Math.ceil(length / 4));
}

export function chunkMarkdownDocument(input: ChunkMarkdownDocumentInput): ChunkMarkdownDocumentResult {
  const limit = normalizeMaxChunkChars(input.maxChunkChars);
  if (input.text.trim().length === 0) {
    return {
      chunks: [],
      warnings: [...limit.warnings, {
        code: "empty_document",
        message: "Wiki document is empty.",
        documentId: input.document.id,
        sourcePath: input.sourcePath,
      }],
    };
  }

  const sections = splitMarkdownSections(input.text);
  const rawChunks = sections.flatMap((section) => splitSection(section, limit.value));
  const chunks = rawChunks.map((chunk, index): WikiChunkRecord => {
    const ordinal = index + 1;
    return {
      id: `${input.document.id}#${ordinal}`,
      documentId: input.document.id,
      sourcePath: input.sourcePath,
      sourceHash: input.sourceHash,
      freshness: input.document.freshness,
      ordinal,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      headingPath: chunk.headingPath,
      text: chunk.text,
      tokenEstimate: estimateWikiTokens(chunk.text),
    };
  });

  return {
    chunks,
    warnings: limit.warnings.map((warning) => ({ ...warning, documentId: input.document.id, sourcePath: input.sourcePath })),
  };
}

function splitMarkdownSections(text: string): readonly MarkdownSection[] {
  const lines = text.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  const headingStack: string[] = [];
  let currentStart = 0;
  let currentHeadingPath: readonly string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = parseHeading(lines[index]);
    if (!heading) continue;
    if (currentStart < index) {
      sections.push(sectionFromLines(lines, currentStart, index - 1, currentHeadingPath));
    }
    headingStack.length = Math.min(headingStack.length, heading.level - 1);
    headingStack.push(heading.title);
    currentStart = index;
    currentHeadingPath = [...headingStack];
  }

  if (currentStart < lines.length) {
    sections.push(sectionFromLines(lines, currentStart, lines.length - 1, currentHeadingPath));
  }
  return sections;
}

function parseHeading(line: string): { readonly level: number; readonly title: string } | undefined {
  const match = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
  if (!match) return undefined;
  return { level: match[1].length, title: match[2].trim() };
}

function sectionFromLines(lines: readonly string[], start: number, end: number, headingPath: readonly string[]): MarkdownSection {
  return {
    startLine: start + 1,
    text: lines.slice(start, end + 1).join("\n"),
    headingPath,
  };
}

function splitSection(section: MarkdownSection, maxChunkChars: number): readonly RawChunk[] {
  if (section.text.length <= maxChunkChars) {
    const lineOffsets = collectLineOffsets(section.text);
    return [{
      startLine: section.startLine,
      endLine: lineNumberForOffset(lineOffsets, section.startLine, lastContentOffset(section.text, 0, section.text.length)),
      headingPath: section.headingPath,
      text: trimTrailingNewlines(section.text),
    }];
  }

  const chunks: RawChunk[] = [];
  const lineOffsets = collectLineOffsets(section.text);
  let startOffset = 0;
  while (startOffset < section.text.length) {
    const endOffsetExclusive = chooseBoundary(section.text, startOffset, maxChunkChars);
    const chunkText = trimTrailingNewlines(section.text.slice(startOffset, endOffsetExclusive));
    if (chunkText.length > 0) {
      chunks.push({
        startLine: lineNumberForOffset(lineOffsets, section.startLine, startOffset),
        endLine: lineNumberForOffset(lineOffsets, section.startLine, lastContentOffset(section.text, startOffset, endOffsetExclusive)),
        headingPath: section.headingPath,
        text: chunkText,
      });
    }
    startOffset = Math.max(endOffsetExclusive, startOffset + 1);
  }
  return chunks;
}

function chooseBoundary(text: string, startOffset: number, maxChunkChars: number): number {
  const hardLimit = Math.min(text.length, startOffset + maxChunkChars);
  if (hardLimit === text.length) return text.length;
  const paragraph = text.lastIndexOf("\n\n", hardLimit);
  if (paragraph > startOffset) return paragraph + 2;
  const newline = text.lastIndexOf("\n", hardLimit);
  if (newline > startOffset) return newline + 1;
  return hardLimit;
}

function collectLineOffsets(text: string): readonly number[] {
  const offsets: number[] = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function lineNumberForOffset(offsets: readonly number[], sectionStartLine: number, offset: number): number {
  let lineIndex = 0;
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] > offset) break;
    lineIndex = index;
  }
  return sectionStartLine + lineIndex;
}

function lastContentOffset(text: string, startOffset: number, endOffsetExclusive: number): number {
  let offset = Math.max(startOffset, endOffsetExclusive - 1);
  while (offset > startOffset && text[offset] === "\n") {
    offset -= 1;
  }
  return offset;
}

function trimTrailingNewlines(text: string): string {
  return text.replace(/\n+$/u, "");
}
