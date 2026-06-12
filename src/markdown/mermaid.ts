export type MermaidDiagnosticCode = "non_normalized_fence" | "unclosed_fence" | "empty_block" | "syntax_error";

export interface MermaidDiagnostic {
  readonly code: MermaidDiagnosticCode;
  readonly line: number;
  readonly message: string;
}

export interface MermaidBlock {
  readonly startLine: number;
  readonly endLine?: number;
  readonly content: string;
}

export interface MermaidCheckResult {
  readonly valid: boolean;
  readonly diagnostics: readonly MermaidDiagnostic[];
  readonly blocks: readonly MermaidBlock[];
}

export interface MermaidFixResult extends MermaidCheckResult {
  readonly markdown: string;
}

function isMermaidFence(info: string): boolean {
  return info.toLowerCase().startsWith("mermaid");
}

function normalizedFenceLine(line: string): string | undefined {
  const match = /^```\s*([A-Za-z][^\s`]*)?.*$/.exec(line);
  if (!match) return undefined;
  const info = match[1] ?? "";
  return isMermaidFence(info) ? "```mermaid" : line;
}

function syntaxDiagnostic(content: string, line: number): MermaidDiagnostic | undefined {
  const lines = content.split("\n");
  const brokenIndex = lines.findIndex((item) => /(?:-->|---|==>|-.->|~~>|-{1,2}>>?)\s*$/.test(item.trim()));
  if (brokenIndex >= 0) {
    return { code: "syntax_error", line: line + brokenIndex + 1, message: "Mermaid connector is missing a target node." };
  }
  const firstLine = lines.find((item) => item.trim() !== "")?.trim() ?? "";
  if (!/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/.test(firstLine)) {
    return { code: "syntax_error", line, message: "Mermaid block does not start with a recognized diagram declaration." };
  }
  return undefined;
}

export function normalizeMermaidMarkdown(markdown: string): string {
  const source = markdown.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const lines = source === "" ? [] : source.split("\n");
  const normalized: string[] = [];
  let openMermaidFence = false;
  for (const line of lines) {
    const fenceLine = normalizedFenceLine(line);
    if (fenceLine === "```mermaid") {
      openMermaidFence = true;
      normalized.push(fenceLine);
      continue;
    }
    if (openMermaidFence && line.trim() === "```") {
      openMermaidFence = false;
      normalized.push("```");
      continue;
    }
    normalized.push(line);
  }
  if (openMermaidFence) normalized.push("```");
  return `${normalized.join("\n").replace(/\n*$/, "")}\n`;
}

export function checkMermaidMarkdown(markdown: string): MermaidCheckResult {
  const lines = markdown.split(/\r?\n/);
  const diagnostics: MermaidDiagnostic[] = [];
  const blocks: MermaidBlock[] = [];
  let current: { startLine: number; content: string[] } | undefined;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fence = /^```\s*([^\s`]*)?.*$/.exec(line);
    if (!current && fence) {
      const info = fence[1] ?? "";
      if (isMermaidFence(info)) {
        if (line.trim() !== "```mermaid") {
          diagnostics.push({ code: "non_normalized_fence", line: lineNumber, message: "Use a lowercase ```mermaid fence with no attributes." });
        }
        current = { startLine: lineNumber, content: [] };
      }
      return;
    }
    if (current && line.trim() === "```") {
      const content = current.content.join("\n").trim();
      if (content === "") {
        diagnostics.push({ code: "empty_block", line: current.startLine, message: "Mermaid block is empty." });
      } else {
        const syntax = syntaxDiagnostic(content, current.startLine);
        if (syntax) diagnostics.push(syntax);
      }
      blocks.push({ startLine: current.startLine, endLine: lineNumber, content });
      current = undefined;
      return;
    }
    if (current) current.content.push(line);
  });

  if (current) {
    diagnostics.push({ code: "unclosed_fence", line: current.startLine, message: "Mermaid fence is missing a closing ``` line." });
    blocks.push({ startLine: current.startLine, content: current.content.join("\n").trim() });
  }

  return { valid: diagnostics.length === 0, diagnostics, blocks };
}

export function fixMermaidMarkdown(markdown: string): MermaidFixResult {
  const fixed = normalizeMermaidMarkdown(markdown);
  const result = checkMermaidMarkdown(fixed);
  return { ...result, markdown: fixed };
}
