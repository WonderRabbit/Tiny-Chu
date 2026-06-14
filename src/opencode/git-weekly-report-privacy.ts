import { createHash } from "node:crypto";

export interface RedactionCounts {
  readonly emails: number;
  readonly secrets: number;
  readonly patchLines: number;
}

export const EMPTY_REDACTION_COUNTS: RedactionCounts = { emails: 0, secrets: 0, patchLines: 0 };

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_PATTERN = /[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*/gi;

export function emailIdentityHash(email: string): string {
  return `sha256:${createHash("sha256").update(email.toLowerCase()).digest("hex")}`;
}

export function cleanText(value: string): string {
  return value
    .replace(SECRET_PATTERN, "[redacted-secret]")
    .replace(EMAIL_PATTERN, "[redacted-email]");
}

export function mergeRedactionCounts(left: RedactionCounts, right: RedactionCounts): RedactionCounts {
  return {
    emails: left.emails + right.emails,
    secrets: left.secrets + right.secrets,
    patchLines: left.patchLines + right.patchLines,
  };
}

export function redactPatch(raw: string): { readonly patch: string; readonly counts: RedactionCounts } {
  let emails = 0;
  let secrets = 0;
  let patchLines = 0;
  const lines = raw.split(/\r?\n/).map((line) => {
    emails += line.match(EMAIL_PATTERN)?.length ?? 0;
    secrets += line.match(SECRET_PATTERN)?.length ?? 0;
    if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) {
      patchLines += 1;
      return `${line[0]}[redacted-patch-content]`;
    }
    return cleanText(line);
  });
  return { patch: lines.join("\n").slice(0, 6000), counts: { emails, secrets, patchLines } };
}
