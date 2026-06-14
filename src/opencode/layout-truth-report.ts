import { type LayoutTruthRecord } from "./ux-reverse-analysis.js";
import { layoutTruthMarkdownPath, relativeToRoot } from "./layout-truth-paths.js";

interface LayoutTruthVerification {
  readonly verified: readonly LayoutTruthRecord[];
  readonly stale: readonly LayoutTruthRecord[];
  readonly missing: readonly LayoutTruthRecord[];
  readonly reviewTargets: readonly LayoutTruthRecord[];
}

export interface RenderedLayoutTruthReport {
  readonly markdownPath: string;
  readonly markdownPathRelative: string;
  readonly markdown: string;
  readonly evidenceRefs: readonly string[];
}

function uniqueRefs(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))].sort();
}

function commandText(value: string): string {
  return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function reportText(value: string): string {
  return commandText(value).replace(/\|/g, "\\|");
}

function powershellQuote(value: string): string {
  return `'${commandText(value).replace(/'/g, "''")}'`;
}

export function renderLayoutTruthReport(root: string, filePath: string, verification: LayoutTruthVerification, records: readonly LayoutTruthRecord[]): RenderedLayoutTruthReport {
  const markdownPath = layoutTruthMarkdownPath(root);
  const evidenceRefs = records.flatMap((record) => record.evidenceRefs);
  const reviewTargets = verification.reviewTargets.length > 0 ? verification.reviewTargets.map((record) => `- ${reportText(record.elementName)}: ${record.lifecycle}`) : ["- None"];
  const staleCommands = verification.stale.length > 0 ? verification.stale.map((record) => `- ${reportText(record.elementName)}: rg -n -- ${powershellQuote(record.elementName)} ${uniqueRefs(record.evidenceRefs.map((ref) => ref.replace(/:\d+$/, ""))).map(powershellQuote).join(" ")}`) : ["- None"];
  const markdown = [
    "# Layout Truth",
    "",
    `Source: ${relativeToRoot(root, filePath)}`,
    `Verified: ${verification.verified.length}`,
    `Stale: ${verification.stale.length}`,
    `Unknown/Missing: ${verification.missing.length}`,
    "",
    "| Truth ID | Element | Lifecycle | Existence | Position | Evidence |",
    "| --- | --- | --- | --- | --- | --- |",
    ...records.map((record) => `| ${reportText(record.truthId)} | ${reportText(record.elementName)} | ${record.lifecycle} | ${record.existenceRationale.status} | ${record.positionRationale.status} | ${reportText(record.evidenceRefs.join(", "))} |`),
    "",
    "## Review Targets",
    ...reviewTargets,
    "## Stale Evidence Commands",
    ...staleCommands,
    "## Rule Candidates",
    ...records.map((record) => `- ${reportText(record.elementName)}: existence=${record.existenceRationale.status}; position=${record.positionRationale.status}; validation=${record.validationRationale.status}; message=${record.messageRationale.status}`),
  ].join("\n");
  return { markdownPath, markdownPathRelative: relativeToRoot(root, markdownPath), markdown, evidenceRefs };
}
