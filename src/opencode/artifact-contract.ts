import { readFile } from "node:fs/promises";
import { checkMermaidMarkdown, type MermaidDiagnostic } from "../markdown/mermaid.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import { resolvePathInsideRoot } from "../state/path-safety.js";

export const ARTIFACT_TYPES = ["as_is", "ui_definition", "sequence_diagram", "flowchart", "user_story", "test_case", "erd", "ux_reverse_analysis"] as const;

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

export interface ArtifactFormatTemplateResult {
  readonly valid: boolean;
  readonly artifactType?: ArtifactType;
  readonly source?: "builtin" | "file";
  readonly templatePath?: string;
  readonly title?: string;
  readonly requiredSections: readonly string[];
  readonly requiresMermaid: boolean;
  readonly acceptedMermaidDeclarations: readonly string[];
  readonly validationRules: readonly string[];
  readonly templateMarkdown: string;
  readonly diagnostics: readonly ArtifactDiagnostic[];
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
  {
    type: "ux_reverse_analysis",
    title: "UX reverse analysis",
    requiredSections: ["Screen Summary", "Layout Inventory", "Layout Truth", "Existence Rationale", "Position Rationale", "Validation Matrix", "Messages", "Unknowns", "Evidence"],
    requiresMermaid: false,
    acceptedMermaidDeclarations: [],
    validationRules: [
      "Explain layout existence and position only from source or layout-truth evidence; keep unsupported reasons Unknown or Needs Verification.",
      "Treat stale/missing layout truth as review targets and never present source-order-only or convention-only position rationale as Verified.",
    ],
  },
];

function artifactType(value: string): ArtifactType | undefined {
  return ARTIFACT_TYPES.find((type) => type === value);
}

function contractFor(type: ArtifactType): ArtifactContract {
  return ARTIFACT_CONTRACTS.find((contract) => contract.type === type) ?? ARTIFACT_CONTRACTS[0];
}

function renderTemplate(contract: ArtifactContract): string {
  const sections = contract.requiredSections.length > 0
    ? contract.requiredSections.map((section) => `## ${section}\n\n- Cite evidenceRefs here.\n`).join("\n")
    : `## Evidence\n\n- Cite evidenceRefs here.\n\n\`\`\`mermaid\n${contract.acceptedMermaidDeclarations[0] ?? "flowchart"}\n%% Replace with evidence-backed diagram.\n\`\`\`\n`;
  return [`# ${contract.title}`, "", sections.trim(), "", "## Validation Rules", ...contract.validationRules.map((rule) => `- ${rule}`), ""].join("\n");
}

export async function createArtifactFormatTemplate(root: string | undefined, input: Record<string, unknown>): Promise<ArtifactFormatTemplateResult> {
  const rawType = typeof input.artifactType === "string" ? input.artifactType : "";
  const type = artifactType(rawType);
  if (!type) {
    return {
      valid: false,
      requiredSections: [],
      requiresMermaid: false,
      acceptedMermaidDeclarations: [],
      validationRules: [],
      templateMarkdown: "",
      diagnostics: [{ code: "unknown_artifact_type", message: `Unknown artifact type: ${rawType}` }],
    };
  }
  const configuredRoot = resolveTinyChuPaths(root).root;
  const relativeTemplate = `.tiny/artifacts/templates/${type}.md`;
  const absolute = resolvePathInsideRoot(configuredRoot, relativeTemplate);
  const contract = contractFor(type);
  if (absolute) {
    const fileTemplate = await readFile(absolute, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (fileTemplate !== undefined) {
      return {
        valid: true,
        artifactType: type,
        source: "file",
        templatePath: relativeTemplate,
        title: contract.title,
        requiredSections: contract.requiredSections,
        requiresMermaid: contract.requiresMermaid,
        acceptedMermaidDeclarations: contract.acceptedMermaidDeclarations,
        validationRules: contract.validationRules,
        templateMarkdown: fileTemplate,
        diagnostics: [],
      };
    }
  }
  return {
    valid: true,
    artifactType: type,
    source: "builtin",
    templatePath: `.tiny/artifacts/templates/${type}.md`,
    title: contract.title,
    requiredSections: contract.requiredSections,
    requiresMermaid: contract.requiresMermaid,
    acceptedMermaidDeclarations: contract.acceptedMermaidDeclarations,
    validationRules: contract.validationRules,
    templateMarkdown: renderTemplate(contract),
    diagnostics: [],
  };
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
