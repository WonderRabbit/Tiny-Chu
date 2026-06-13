import { bounded } from "./extension-scan.js";
import type { UxLayoutCatalogResult, UxRationaleTraceResult, UxValidationMatrixResult } from "./ux-reverse-analysis.js";

export interface UxReverseReportResult {
  readonly artifactType: "ux_reverse_analysis";
  readonly markdown: string;
  readonly evidenceRefs: readonly string[];
  readonly figmaExportPlan: {
    readonly fileKey?: string;
    readonly nodeId?: string;
    readonly mappingKeys: readonly string[];
    readonly status: "adapter_ready_only";
  };
}

function optionalCatalog(input: Record<string, unknown>): UxLayoutCatalogResult | undefined {
  return typeof input.catalog === "object" && input.catalog !== null ? input.catalog as UxLayoutCatalogResult : undefined;
}

function optionalRationale(input: Record<string, unknown>): UxRationaleTraceResult | undefined {
  return typeof input.rationale === "object" && input.rationale !== null ? input.rationale as UxRationaleTraceResult : undefined;
}

function optionalValidation(input: Record<string, unknown>): UxValidationMatrixResult | undefined {
  return typeof input.validation === "object" && input.validation !== null ? input.validation as UxValidationMatrixResult : undefined;
}

function omittedLine(label: string, total: number, shown: number): string {
  return `Omitted ${label}: ${Math.max(0, total - shown)}`;
}

export function createUxReverseReport(input: Record<string, unknown>): UxReverseReportResult {
  const catalog = optionalCatalog(input);
  const rationale = optionalRationale(input);
  const validation = optionalValidation(input);
  const evidenceRefs = bounded([...(catalog?.evidenceRefs ?? []), ...(rationale?.evidenceRefs ?? []), ...(validation?.evidenceRefs ?? [])], input.maxEvidenceRefs, 80);
  const screens = catalog?.screens.join(", ") || "Unknown";
  const elements = catalog?.elements ?? [];
  const rationales = rationale?.rationales ?? [];
  const fields = validation?.fields ?? [];
  const shownElements = bounded(elements, input.maxElements, 80);
  const shownRationales = bounded(rationales, input.maxRationales, 80);
  const shownFields = bounded(fields, input.maxValidationRules, 80);
  const elementRows = shownElements.map((item) => `| ${item.screenId} | ${item.area} | ${item.label} | ${item.name} | ${item.position.order} | ${item.evidenceRefs.join(", ")} |`).join("\n");
  const existenceRows = shownRationales.map((item) => `| ${item.elementName} | ${item.existenceRationale.status} | ${item.existenceRationale.reason} | ${item.existenceRationale.evidenceRefs.join(", ")} |`).join("\n");
  const positionRows = shownRationales.map((item) => `| ${item.elementName} | ${item.positionRationale.status} | ${item.positionRationale.reason} | ${item.positionRationale.evidenceRefs.join(", ")} |`).join("\n");
  const validationRows = shownFields.map((item) => `| ${item.elementName} | ${item.valueKind} | ${item.clientRules.map((rule) => rule.kind).join(", ") || "Unknown"} | ${item.serverRules.map((rule) => rule.kind).join(", ") || "Unknown"} | ${item.messageEvidence.map((message) => message.key).join(", ") || "Unknown"} |`).join("\n");
  const messages = [...new Set((validation?.fields ?? []).flatMap((item) => item.messageEvidence.map((message) => `${message.key}: ${message.evidenceRef}`)))];
  const unknowns = [...(catalog?.unknowns ?? []), ...(rationale?.unknowns ?? []), ...(validation?.unknowns ?? []), ...(validation?.fields ?? []).flatMap((item) => item.unknowns)];
  return {
    artifactType: "ux_reverse_analysis",
    markdown: [
      "# UX Reverse Analysis",
      "## Screen Summary",
      `Screens: ${screens}`,
      "## Layout Inventory",
      "| Screen | Area | Label | Name | Source Order | Evidence |",
      "| --- | --- | --- | --- | --- | --- |",
      elementRows,
      omittedLine("Layout Inventory", elements.length, shownElements.length),
      "## Layout Truth",
      "Layout truth is stored as `.tiny/ux/layout-truth.json` and verified before reuse. evidenceRefs are listed below.",
      "## Existence Rationale",
      "| Element | Status | Reason | Evidence |",
      "| --- | --- | --- | --- |",
      existenceRows,
      omittedLine("Rationale Rows", rationales.length, shownRationales.length),
      "## Position Rationale",
      "| Element | Status | Reason | Evidence |",
      "| --- | --- | --- | --- |",
      positionRows,
      omittedLine("Rationale Rows", rationales.length, shownRationales.length),
      "## Validation Matrix",
      "| Element | Value Kind | Client Rules | Server Rules | Messages |",
      "| --- | --- | --- | --- | --- |",
      validationRows,
      omittedLine("Validation Rows", fields.length, shownFields.length),
      "## Messages",
      ...(messages.length > 0 ? messages.map((message) => `- ${message}`) : ["- Unknown"]),
      "## Unknowns",
      ...(unknowns.length > 0 ? unknowns.map((unknown) => `- ${unknown}`) : ["- None"]),
      "## Evidence",
      ...evidenceRefs.map((ref) => `- ${ref}`),
    ].filter((line) => line !== "").join("\n"),
    evidenceRefs,
    figmaExportPlan: { mappingKeys: ["fileKey", "nodeId", "figmaNodeName", "truthId", "component", "variables"], status: "adapter_ready_only" },
  };
}
