export const QUALITY_PROFILE_IDS = ["quick", "standard", "strict"] as const;

export type QualityProfileId = (typeof QUALITY_PROFILE_IDS)[number];
export type QualityProfileDecision = "allow" | "warn" | "block" | "fail";

export interface QualityProfileToolCall {
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly reason: string;
  readonly advisory: boolean;
}

export interface QualityProfileDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
}

export interface QualityProfile {
  readonly id: QualityProfileId;
  readonly requiredChecks: readonly string[];
  readonly optionalChecks: readonly string[];
  readonly maxMissingEvidence: number;
  readonly runDiagnosticsAdvisory: boolean;
  readonly evidenceFreshness: {
    readonly staleEvidence: Extract<QualityProfileDecision, "warn" | "fail">;
  };
  readonly contextBudget: {
    readonly splitRequired: Extract<QualityProfileDecision, "allow" | "block">;
  };
  readonly diagnosticCommand: QualityProfileToolCall;
  readonly nextToolCalls: readonly QualityProfileToolCall[];
}

export type QualityProfileResolution =
  | {
      readonly valid: true;
      readonly profile: QualityProfile;
      readonly diagnostics: readonly QualityProfileDiagnostic[];
      readonly nextToolCalls: readonly QualityProfileToolCall[];
    }
  | {
      readonly valid: false;
      readonly profileId: string;
      readonly diagnostics: readonly QualityProfileDiagnostic[];
      readonly nextToolCalls: readonly QualityProfileToolCall[];
    };

const RUN_DIAGNOSTICS_CALL: QualityProfileToolCall = {
  tool: "run_diagnostics",
  input: { commands: ["npm run build", "npm test"] },
  reason: "Run advisory local diagnostics as build/test evidence when safe tooling is enabled.",
  advisory: true,
};

const PROFILE_TABLE = {
  quick: {
    id: "quick",
    requiredChecks: ["evidence_gate"],
    optionalChecks: ["run_diagnostics", "workflow_sot_audit", "context_budget_simulation"],
    maxMissingEvidence: 1,
    runDiagnosticsAdvisory: true,
    evidenceFreshness: { staleEvidence: "warn" },
    contextBudget: { splitRequired: "allow" },
    diagnosticCommand: RUN_DIAGNOSTICS_CALL,
    nextToolCalls: [
      { tool: "evidence_gate", input: { profileId: "quick" }, reason: "Check minimal required evidence before accepting quick feedback.", advisory: false },
      RUN_DIAGNOSTICS_CALL,
    ],
  },
  standard: {
    id: "standard",
    requiredChecks: ["build", "test", "evidence_gate", "workflow_sot_audit", "context_budget_simulation"],
    optionalChecks: ["run_diagnostics", "tool_call_conformance_probe", "small_model_replay", "claim_evidence_check"],
    maxMissingEvidence: 0,
    runDiagnosticsAdvisory: true,
    evidenceFreshness: { staleEvidence: "warn" },
    contextBudget: { splitRequired: "block" },
    diagnosticCommand: RUN_DIAGNOSTICS_CALL,
    nextToolCalls: [
      { tool: "context_budget_simulation", input: { profileId: "standard" }, reason: "Confirm packets fit before worker dispatch.", advisory: false },
      { tool: "evidence_gate", input: { profileId: "standard" }, reason: "Gate build, test, workflow SOT, and context-budget evidence.", advisory: false },
      RUN_DIAGNOSTICS_CALL,
    ],
  },
  strict: {
    id: "strict",
    requiredChecks: [
      "build",
      "test",
      "evidence_gate",
      "workflow_sot_audit",
      "tool_call_conformance_probe",
      "context_budget_simulation",
      "small_model_replay",
      "claim_evidence_check",
    ],
    optionalChecks: ["run_diagnostics"],
    maxMissingEvidence: 0,
    runDiagnosticsAdvisory: true,
    evidenceFreshness: { staleEvidence: "fail" },
    contextBudget: { splitRequired: "block" },
    diagnosticCommand: RUN_DIAGNOSTICS_CALL,
    nextToolCalls: [
      { tool: "tool_call_conformance_probe", input: { profileId: "strict" }, reason: "Verify model tool-call shape against exposed Tiny-Chu tools.", advisory: false },
      { tool: "context_budget_simulation", input: { profileId: "strict" }, reason: "Block worker dispatch until packets fit the strict context budget.", advisory: false },
      { tool: "small_model_replay", input: { profileId: "strict" }, reason: "Replay deterministic small-model failure fixtures before completion.", advisory: false },
      { tool: "claim_evidence_check", input: { profileId: "strict" }, reason: "Reject unsupported final claims before evidence_gate passes.", advisory: false },
      { tool: "evidence_gate", input: { profileId: "strict" }, reason: "Gate strict evidence, freshness, replay, and claim checks.", advisory: false },
      RUN_DIAGNOSTICS_CALL,
    ],
  },
} as const satisfies Readonly<Record<QualityProfileId, QualityProfile>>;

export const QUALITY_PROFILES: readonly QualityProfile[] = [
  PROFILE_TABLE.quick,
  PROFILE_TABLE.standard,
  PROFILE_TABLE.strict,
];

export function isQualityProfileId(value: string): value is QualityProfileId {
  switch (value) {
    case "quick":
    case "standard":
    case "strict":
      return true;
    default:
      return false;
  }
}

function profileId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function resolveQualityProfile(input: Record<string, unknown>): QualityProfileResolution {
  const id = profileId(input.profileId) ?? "standard";
  if (isQualityProfileId(id)) return { valid: true, profile: PROFILE_TABLE[id], diagnostics: [], nextToolCalls: PROFILE_TABLE[id].nextToolCalls };
  return {
    valid: false,
    profileId: id,
    diagnostics: [{ code: "unknown_quality_profile", severity: "error", message: `Unknown quality profile: ${id}. Expected quick, standard, or strict.` }],
    nextToolCalls: [
      {
        tool: "orchestration_profile",
        input: { profileId: "standard" },
        reason: "Resolve a supported quality profile before re-running evidence_gate.",
        advisory: false,
      },
    ],
  };
}
