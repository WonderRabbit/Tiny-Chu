import { checkMermaidMarkdown } from "../markdown/mermaid.js";
import { nestedRecords, recordInput, stringField } from "./legacy-input.js";

export interface TraceDiagramRenderResult {
  readonly artifactType: "flowchart" | "sequence_diagram" | "erd";
  readonly markdown: string;
  readonly valid: boolean;
  readonly diagnostics: readonly string[];
  readonly verificationCommands: readonly string[];
}

function diagramType(value: unknown): "flowchart" | "sequence_diagram" | "erd" {
  return value === "sequence_diagram" || value === "erd" ? value : "flowchart";
}

function cleanNode(value: string, fallback: string): string {
  const source = value === "" || value === "Unknown" ? fallback : value;
  return source.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function label(row: Record<string, unknown>, key: string, fallback: string): string {
  return stringField(row, key, fallback).replace(/"/g, "'");
}

function flowchart(rows: readonly Record<string, unknown>[]): string {
  const lines = ["```mermaid", "flowchart TD"];
  for (const [index, row] of rows.entries()) {
    const prefix = `R${index + 1}`;
    const ui = cleanNode(label(row, "uiEvent", "UI"), `${prefix}_UI`);
    const api = cleanNode(label(row, "api", "API"), `${prefix}_API`);
    const backend = cleanNode(label(row, "backendEntry", "Backend"), `${prefix}_Backend`);
    const integration = cleanNode(label(row, "mapperSql", label(row, "rfcFunction", "Integration")), `${prefix}_Integration`);
    lines.push(`  ${ui}["${label(row, "uiEvent", "Unknown UI")}"] --> ${api}["${label(row, "api", "Unknown API")}"]`);
    lines.push(`  ${api} --> ${backend}["${label(row, "backendEntry", "Unknown backend")}"]`);
    const connector = stringField(row, "status") === "complete" ? "-->" : "-. Needs verification .->";
    lines.push(`  ${backend} ${connector} ${integration}["${label(row, "mapperSql", label(row, "rfcFunction", "Unknown integration"))}"]`);
    const gap = stringField(row, "gap");
    if (gap !== "") lines.push(`  ${prefix}_Gap["${gap.replace(/"/g, "'")}"]`);
  }
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

function sequence(rows: readonly Record<string, unknown>[]): string {
  const lines = ["```mermaid", "sequenceDiagram", "  participant UI", "  participant API", "  participant Backend", "  participant Integration"];
  for (const row of rows) {
    lines.push(`  UI->>API: ${label(row, "api", "Unknown API")}`);
    lines.push(`  API->>Backend: ${label(row, "backendEntry", "Unknown backend")}`);
    lines.push(`  Backend->>Integration: ${label(row, "mapperSql", label(row, "rfcFunction", "Unknown integration"))}`);
    const gap = stringField(row, "gap");
    if (gap !== "") lines.push(`  Note over Backend,Integration: ${gap.replace(/:/g, " -")}`);
  }
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

export function createTraceDiagramRender(input: Record<string, unknown>): TraceDiagramRenderResult {
  const type = diagramType(input.artifactType);
  const rows = nestedRecords(recordInput(input.matrix), "rows");
  const markdown = type === "sequence_diagram" ? sequence(rows) : type === "erd" ? "```mermaid\nerDiagram\n  TRACE_ROW {\n    string feature\n  }\n```\n" : flowchart(rows);
  const checked = checkMermaidMarkdown(markdown);
  return {
    artifactType: type,
    markdown,
    valid: checked.valid,
    diagnostics: checked.diagnostics.map((item) => item.message),
    verificationCommands: ["mermaid_check markdown=<rendered>", "mmdc -i <diagram>.mmd -o <diagram>.svg"],
  };
}
