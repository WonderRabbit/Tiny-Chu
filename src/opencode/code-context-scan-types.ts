export type CodeContextTagKind = "NOTE" | "WARN" | "ANCHOR" | "TODO" | "REASON";
export type CodeContextSourcePrefix = "TC" | "MX";
export type CodeContextEvidenceKind = "navigation_hint";
export type CodeContextFindingCode = "missing_reason" | "unknown_tag";

export interface CodeContextReason {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface CodeContextItem {
  readonly path: string;
  readonly line: number;
  readonly prefix: "TC";
  readonly sourcePrefix: CodeContextSourcePrefix;
  readonly kind: CodeContextTagKind;
  readonly text: string;
  readonly evidenceKind: CodeContextEvidenceKind;
  readonly reason?: CodeContextReason;
}

export interface CodeContextFinding {
  readonly code: CodeContextFindingCode;
  readonly path: string;
  readonly line: number;
  readonly message: string;
  readonly evidenceKind: CodeContextEvidenceKind;
}

export interface CodeContextScanResult {
  readonly evidenceKind: CodeContextEvidenceKind;
  readonly root: string;
  readonly items: readonly CodeContextItem[];
  readonly findings: readonly CodeContextFinding[];
  readonly scannedFiles: number;
  readonly skippedPaths: readonly string[];
}
