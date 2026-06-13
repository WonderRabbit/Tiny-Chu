import { createHash } from "node:crypto";
import { scanFacts, bounded, positiveInteger, type EvidenceStatus } from "./extension-scan.js";
import { readLegacySourceFiles } from "./legacy-scanner.js";
import { controlCandidates } from "./ux-jsx-controls.js";

export type UxElementArea = "search_condition" | "result_field" | "action_control" | "message" | "unknown";
export type UxValueKind = "text" | "enum" | "date" | "number" | "boolean" | "unknown";

export interface UxLayoutPosition {
  readonly order: number;
  readonly sourceOrder: number;
  readonly layoutHint: string;
}

export interface UxLayoutElement {
  readonly id: string;
  readonly screenId: string;
  readonly area: UxElementArea;
  readonly kind: string;
  readonly name: string;
  readonly label: string;
  readonly valueKind: UxValueKind;
  readonly position: UxLayoutPosition;
  readonly options: readonly string[];
  readonly clientHints: readonly string[];
  readonly source: string;
  readonly line: number;
  readonly text: string;
  readonly evidenceRefs: readonly string[];
  readonly sourceFingerprint: string;
}

export interface UxLayoutCatalogResult {
  readonly artifactType: "ux_reverse_analysis";
  readonly screens: readonly string[];
  readonly elements: readonly UxLayoutElement[];
  readonly unknowns: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly recommendedCommands: readonly string[];
}

export interface UxRationaleText {
  readonly status: EvidenceStatus;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface LayoutTruthRecord {
  readonly truthId: string;
  readonly screenId: string;
  readonly elementId: string;
  readonly elementName: string;
  readonly area: UxElementArea;
  readonly existenceRationale: UxRationaleText;
  readonly positionRationale: UxRationaleText;
  readonly validationRationale: UxRationaleText;
  readonly messageRationale: UxRationaleText;
  readonly sourceFingerprint: string;
  readonly evidenceRefs: readonly string[];
  readonly lifecycle: "candidate" | "verified" | "stale" | "needs_review" | "superseded" | "rejected";
  readonly version: number;
}

export interface UxRationaleTraceResult {
  readonly rationales: readonly LayoutTruthRecord[];
  readonly unknowns: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface UxValidationRule {
  readonly kind: string;
  readonly detail: string;
  readonly status: EvidenceStatus;
  readonly evidenceRefs: readonly string[];
}

export interface UxMessageEvidence {
  readonly key: string;
  readonly text: string;
  readonly evidenceRef: string;
}

export interface UxValidationField {
  readonly elementName: string;
  readonly valueKind: UxValueKind;
  readonly clientRules: readonly UxValidationRule[];
  readonly serverRules: readonly UxValidationRule[];
  readonly messageEvidence: readonly UxMessageEvidence[];
  readonly unknowns: readonly string[];
}

export interface UxValidationMatrixResult {
  readonly fields: readonly UxValidationField[];
  readonly unknowns: readonly string[];
  readonly evidenceRefs: readonly string[];
}

function evidenceRef(file: string, line: number): string {
  return `${file}:${line}`;
}

export function uxSourceFingerprint(file: string, line: number, text: string): string {
  return createHash("sha256").update(`${file}:${line}:${text.trim()}`).digest("hex").slice(0, 16);
}

function screenId(file: string, content: string): string {
  return content.match(/data-screen=["']([^"']+)["']/)?.[1] ?? content.match(/\bfunction\s+([A-Z][\w$]*)/)?.[1] ?? file.replace(/\.[^.]+$/, "");
}

function attr(line: string, name: string): string | undefined {
  return line.match(new RegExp(`${name}=["']([^"']+)["']`))?.[1];
}

function label(line: string, fallback: string): string {
  return line.match(/<label[^>]*>\s*([^<]+)/)?.[1]?.trim() ?? attr(line, "label") ?? attr(line, "headerName") ?? attr(line, "title") ?? fallback;
}

function nameFrom(line: string, fallback: string): string {
  return attr(line, "name") ?? attr(line, "field") ?? attr(line, "dataIndex") ?? attr(line, "accessor") ?? fallback;
}

function valueKind(name: string, line: string): UxValueKind {
  if (/DatePicker|type=["']date["']|date$/i.test(`${name} ${line}`)) return "date";
  if (/<select|option value=|status|type=["']radio["']/i.test(`${name} ${line}`)) return "enum";
  if (/amount|count|total|qty|price|number|type=["']number["']/i.test(`${name} ${line}`)) return "number";
  if (/checked|enabled|disabled|boolean/i.test(`${name} ${line}`)) return "boolean";
  return name === "" ? "unknown" : "text";
}

function options(line: string): readonly string[] {
  return [...line.matchAll(/<option[^>]*value=["']([^"']+)["']/g)].map((match) => match[1] ?? "").filter((item) => item !== "");
}

function hints(line: string, opts: readonly string[]): readonly string[] {
  const values: string[] = [];
  if (/\brequired\b/.test(line)) values.push("required");
  const max = line.match(/maxLength=\{?(\d+)/)?.[1];
  if (max) values.push(`maxLength:${max}`);
  if (/type=["']date["']|DatePicker/.test(line)) values.push("date");
  if (opts.length > 0) values.push(`options:${opts.join("|")}`);
  return values;
}

function element(idPrefix: string, area: UxElementArea, kind: string, source: { readonly path: string; readonly content: string }, line: string, lineNumber: number, order: number, nameOverride?: string, labelOverride?: string, parseLine = line): UxLayoutElement {
  const name = nameOverride ?? nameFrom(parseLine, kind);
  const optionValues = options(parseLine);
  const ref = evidenceRef(source.path, lineNumber);
  return {
    id: `${idPrefix}:${area}:${name}:${lineNumber}`,
    screenId: screenId(source.path, source.content),
    area,
    kind,
    name,
    label: labelOverride ?? label(parseLine, name),
    valueKind: valueKind(name, parseLine),
    position: { order, sourceOrder: lineNumber, layoutHint: `${area} source order ${order}` },
    options: optionValues,
    clientHints: hints(parseLine, optionValues),
    source: source.path,
    line: lineNumber,
    text: line.trim(),
    evidenceRefs: [ref],
    sourceFingerprint: uxSourceFingerprint(source.path, lineNumber, line),
  };
}

function isUiSource(file: string): boolean {
  return /\.(?:jsx?|tsx?)$/.test(file);
}

export async function createUiLayoutCatalog(root: string, input: Record<string, unknown>): Promise<UxLayoutCatalogResult> {
  const sources = await readLegacySourceFiles(root, { ...input, maxFiles: positiveInteger(input.maxFiles, 80) });
  const elements: UxLayoutElement[] = [];
  for (const source of sources) {
    const counts: Record<UxElementArea, number> = { search_condition: 0, result_field: 0, action_control: 0, message: 0, unknown: 0 };
    const uiSource = isUiSource(source.path);
    for (const [index, line] of source.lines.entries()) {
      const lineNumber = index + 1;
      for (const column of uiSource ? line.matchAll(/\{\s*field:\s*['"]([^'"]+)['"][^}]*headerName:\s*['"]([^'"]+)['"]/g) : []) {
        counts.result_field += 1;
        elements.push(element(source.path, "result_field", "grid_column", source, line, lineNumber, counts.result_field, column[1], column[2]));
      }
      for (const control of uiSource ? controlCandidates(line) : []) {
        counts.search_condition += 1;
        elements.push(element(source.path, "search_condition", control.kind, source, line, lineNumber, counts.search_condition, undefined, control.label, control.fragment));
      }
      if (uiSource && /<button\b/.test(line)) {
        counts.action_control += 1;
        elements.push(element(source.path, "action_control", "button", source, line, lineNumber, counts.action_control, attr(line, "onClick") ?? "button", line.replace(/.*<button[^>]*>([^<]+)<.*/, "$1")));
      } else if (/^[A-Za-z0-9_.-]+\s*=/.test(line) || /\b(message|toast|alert)\b/i.test(line)) {
        counts.message += 1;
        const key = line.match(/^([A-Za-z0-9_.-]+)\s*=/)?.[1] ?? "message";
        elements.push(element(source.path, "message", "message", source, line, lineNumber, counts.message, key, key));
      }
    }
  }
  const limited = bounded(elements, input.maxElements, 120);
  return {
    artifactType: "ux_reverse_analysis",
    screens: [...new Set(limited.map((item) => item.screenId))].sort(),
    elements: limited,
    unknowns: limited.length === 0 ? ["No source-code-first UI elements found"] : [],
    evidenceRefs: bounded(limited.flatMap((item) => item.evidenceRefs), input.maxEvidenceRefs, 80),
    recommendedCommands: ["rg --json '<input|<select|DataGrid|headerName|message' <screen-path>", "context_digest targetPath=<screen> query=<field>"],
  };
}

function sameNameFacts(name: string, facts: readonly { readonly kind: string; readonly symbol: string; readonly file: string; readonly line: number; readonly status: EvidenceStatus }[]): readonly UxValidationRule[] {
  return facts.filter((fact) => fact.symbol === name && ["payload_key", "dto_field", "mapper_param"].includes(fact.kind)).map((fact) => ({ kind: fact.kind, detail: `${fact.symbol} in ${fact.file}`, status: fact.kind === "payload_key" ? "Inferred" : fact.status, evidenceRefs: [evidenceRef(fact.file, fact.line)] }));
}

export async function createUxRationaleTrace(root: string, input: Record<string, unknown>): Promise<UxRationaleTraceResult> {
  const catalog = (input.catalog && typeof input.catalog === "object" ? input.catalog : await createUiLayoutCatalog(root, input)) as UxLayoutCatalogResult;
  const facts = await scanFacts(root, input, 120);
  const rationales = catalog.elements.filter((item) => item.area === "search_condition" || item.area === "result_field").map((item) => {
    const links = sameNameFacts(item.name, facts);
    const evidenceRefs = bounded([...item.evidenceRefs, ...links.flatMap((link) => link.evidenceRefs)], input.maxEvidenceRefs, 12);
    const verified = links.some((link) => link.kind === "dto_field" || link.kind === "mapper_param");
    const positionStatus = verified ? "Inferred" as const : "Needs Verification" as const;
    return {
      truthId: `layout:${item.screenId}:${item.area}:${item.name}`,
      screenId: item.screenId,
      elementId: item.id,
      elementName: item.name,
      area: item.area,
      existenceRationale: { status: verified ? "Verified" as const : "Needs Verification" as const, reason: verified ? `${item.name} is declared in UI and cross-checked with DTO/mapper evidence.` : `${item.name} is declared in UI but has no DTO/mapper evidence yet.`, evidenceRefs },
      positionRationale: { status: positionStatus, reason: verified ? `${item.name} position is inferred from source order ${item.position.order} in ${item.area} plus cross-layer field evidence; no live layout snapshot was used.` : `${item.name} source order ${item.position.order} is UI-only evidence and needs layout truth verification.`, evidenceRefs: item.evidenceRefs },
      validationRationale: { status: item.clientHints.length > 0 || links.length > 0 ? "Inferred" as const : "Unknown" as const, reason: item.clientHints.length > 0 ? `Client hints: ${item.clientHints.join(", ")}.` : "No deterministic client validation hint found.", evidenceRefs },
      messageRationale: { status: catalog.elements.some((other) => other.area === "message") ? "Inferred" as const : "Unknown" as const, reason: "Message evidence is linked conservatively from screen-level message keys.", evidenceRefs: catalog.elements.filter((other) => other.area === "message").flatMap((other) => other.evidenceRefs) },
      sourceFingerprint: item.sourceFingerprint,
      evidenceRefs,
      lifecycle: verified ? "verified" as const : "needs_review" as const,
      version: 1,
    };
  });
  return { rationales: bounded(rationales, input.maxRationales, 80), unknowns: rationales.length === 0 ? ["No rationale candidates produced"] : [], evidenceRefs: bounded(rationales.flatMap((item) => item.evidenceRefs), input.maxEvidenceRefs, 80) };
}

export async function createUxValidationMatrix(root: string, input: Record<string, unknown>): Promise<UxValidationMatrixResult> {
  const catalog = (input.catalog && typeof input.catalog === "object" ? input.catalog : await createUiLayoutCatalog(root, input)) as UxLayoutCatalogResult;
  const facts = await scanFacts(root, input, 120);
  const messages = catalog.elements.filter((item) => item.area === "message").map((item) => ({ key: item.name, text: item.text, evidenceRef: item.evidenceRefs[0] ?? `${item.source}:${item.line}` }));
  const fields = catalog.elements.filter((item) => item.area === "search_condition").map((item) => {
    const clientRules = item.clientHints.map((hint) => ({ kind: hint.startsWith("options:") ? "options" : hint.split(":")[0] ?? "hint", detail: hint, status: "Verified" as const, evidenceRefs: item.evidenceRefs }));
    const serverRules = sameNameFacts(item.name, facts).filter((rule) => rule.kind !== "payload_key");
    return { elementName: item.name, valueKind: item.valueKind, clientRules, serverRules, messageEvidence: messages, unknowns: serverRules.length === 0 ? [`No server validation evidence for ${item.name}`] : [] };
  });
  return { fields: bounded(fields, input.maxValidationRules, 80), unknowns: fields.length === 0 ? ["No validation fields found"] : [], evidenceRefs: bounded([...fields.flatMap((item) => item.clientRules.flatMap((rule) => rule.evidenceRefs)), ...fields.flatMap((item) => item.serverRules.flatMap((rule) => rule.evidenceRefs)), ...messages.map((item) => item.evidenceRef)], input.maxEvidenceRefs, 80) };
}
