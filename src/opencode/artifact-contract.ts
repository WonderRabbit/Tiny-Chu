import { checkMermaidMarkdown, type MermaidDiagnostic } from "../markdown/mermaid.js";

export const ARTIFACT_TYPES = ["as_is", "ui_definition", "sequence_diagram", "flowchart", "user_story", "test_case", "erd"] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export type ArtifactDiagnosticCode =
  | "unknown_artifact_type"
  | "missing_evidence_refs"
  | "missing_required_section"
  | "missing_citation"
  | "mermaid_missing"
  | "mermaid_syntax_error";

export interface ArtifactContract {
  readonly type: ArtifactType;
  readonly title: string;
  readonly requiredSections: readonly string[];
  readonly requiresMermaid: boolean;
  readonly acceptedMermaidDeclarations: readonly string[];
  readonly validationRules: readonly string[];
}

export interface ArtifactDiagnostic {
  readonly code: ArtifactDiagnosticCode;
  readonly message: string;
  readonly line?: number;
}

export interface ArtifactCheckResult {
  readonly valid: boolean;
  readonly artifactType?: ArtifactType;
  readonly diagnostics: readonly ArtifactDiagnostic[];
  readonly mermaidDiagnostics: readonly MermaidDiagnostic[];
}

export interface ArtifactCheckInput {
  readonly artifactType: string;
  readonly markdown: string;
  readonly evidenceRefs?: readonly string[];
}

export const ARTIFACT_CONTRACTS: readonly ArtifactContract[] = [
  {
    type: "as_is",
    title: "AS-IS analysis",
    requiredSections: ["Evidence", "Current Behavior", "Risks"],
    requiresMermaid: false,
    acceptedMermaidDeclarations: [],
    validationRules: ["Every non-trivial claim cites a file path, line, command transcript, or evidence ref."],
  },
  {
    type: "ui_definition",
    title: "UI definition",
    requiredSections: ["Screens", "States", "Interactions", "Evidence"],
    requiresMermaid: false,
    acceptedMermaidDeclarations: [],
    validationRules: ["Define observable UI states and source evidence before design synthesis."],
  },
  {
    type: "sequence_diagram",
    title: "Sequence diagram",
    requiredSections: [],
    requiresMermaid: true,
    acceptedMermaidDeclarations: ["sequenceDiagram"],
    validationRules: ["Use a valid fenced Mermaid sequenceDiagram block and cite the source workflow."],
  },
  {
    type: "flowchart",
    title: "Flowchart",
    requiredSections: [],
    requiresMermaid: true,
    acceptedMermaidDeclarations: ["flowchart", "graph"],
    validationRules: ["Use a valid fenced Mermaid flowchart or graph block and cite decision evidence."],
  },
  {
    type: "user_story",
    title: "User stories",
    requiredSections: ["Stories", "Acceptance Criteria", "Evidence"],
    requiresMermaid: false,
    acceptedMermaidDeclarations: [],
    validationRules: ["Tie every story and acceptance criterion back to source evidence or an explicit uncertainty."],
  },
  {
    type: "test_case",
    title: "Test cases",
    requiredSections: ["Test Cases", "Expected Results", "Evidence"],
    requiresMermaid: false,
    acceptedMermaidDeclarations: [],
    validationRules: ["Each test case names preconditions, action, expected result, and evidence source."],
  },
  {
    type: "erd",
    title: "ERD",
    requiredSections: [],
    requiresMermaid: true,
    acceptedMermaidDeclarations: ["erDiagram"],
    validationRules: ["Use a valid fenced Mermaid erDiagram block and cite schema/source evidence."],
  },
];

function artifactType(value: string): ArtifactType | undefined {
  return ARTIFACT_TYPES.find((type) => type === value);
}

function contractFor(type: ArtifactType): ArtifactContract {
  return ARTIFACT_CONTRACTS.find((contract) => contract.type === type) ?? ARTIFACT_CONTRACTS[0];
}

function missingSections(markdown: string, sections: readonly string[]): readonly string[] {
  return sections.filter((section) => !new RegExp(`^#{1,6}\\s+${section}\\b`, "im").test(markdown));
}

function hasInlineCitation(markdown: string): boolean {
  return /(?:^|\s)(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs|md|json|yml|yaml):\d+\b/.test(markdown)
    || /\bevidenceRefs?\b/i.test(markdown)
    || /\b(?:rg|fd|ast-grep|jq|yq|mdq|mmdc):\/\//.test(markdown);
}

function mermaidDeclaration(content: string): string {
  return content.split("\n").find((line) => line.trim() !== "")?.trim().split(/\s+/)[0] ?? "";
}

export function checkArtifactMarkdown(input: ArtifactCheckInput): ArtifactCheckResult {
  const type = artifactType(input.artifactType);
  if (!type) {
    return {
      valid: false,
      diagnostics: [{ code: "unknown_artifact_type", message: `Unknown artifact type: ${input.artifactType}` }],
      mermaidDiagnostics: [],
    };
  }

  const contract = contractFor(type);
  const evidenceRefs = input.evidenceRefs ?? [];
  const diagnostics: ArtifactDiagnostic[] = [];
  if (evidenceRefs.length === 0) {
    diagnostics.push({ code: "missing_evidence_refs", message: "Artifact must include at least one evidence reference." });
  }

  const absentSections = missingSections(input.markdown, contract.requiredSections);
  if (absentSections.length > 0) {
    diagnostics.push({ code: "missing_required_section", message: `Missing required section(s): ${absentSections.join(", ")}.` });
  } else if (evidenceRefs.length > 0 && !hasInlineCitation(input.markdown)) {
    diagnostics.push({ code: "missing_citation", message: "Artifact body must cite file lines, command evidence, or evidenceRefs." });
  }

  const mermaid = checkMermaidMarkdown(input.markdown);
  if (contract.requiresMermaid) {
    if (mermaid.blocks.length === 0) {
      diagnostics.push({ code: "mermaid_missing", message: "Artifact requires a Mermaid block." });
    }
    const invalidDeclaration = mermaid.blocks.find((block) => !contract.acceptedMermaidDeclarations.includes(mermaidDeclaration(block.content)));
    if (invalidDeclaration) {
      diagnostics.push({ code: "mermaid_syntax_error", message: `Mermaid declaration is not valid for ${type}.`, line: invalidDeclaration.startLine });
    }
  }
  if (mermaid.diagnostics.length > 0) {
    diagnostics.push({ code: "mermaid_syntax_error", message: "Mermaid diagnostics must be resolved.", line: mermaid.diagnostics[0]?.line });
  }

  return { valid: diagnostics.length === 0, artifactType: type, diagnostics, mermaidDiagnostics: mermaid.diagnostics };
}
