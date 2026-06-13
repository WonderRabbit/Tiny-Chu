import { readLegacySourceFiles, uniqueSorted } from "./legacy-scanner.js";

export type EvidenceStatus = "Verified" | "Inferred" | "Unknown" | "Needs Verification";

export interface ScanFact {
  readonly kind: string;
  readonly symbol: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly status: EvidenceStatus;
}

export function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function bounded<T>(items: readonly T[], value: unknown, fallback: number): readonly T[] {
  return items.slice(0, positiveInteger(value, fallback));
}

export function textInput(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

export function lineFact(kind: string, symbol: string, file: string, line: number, text: string, status: EvidenceStatus = "Verified"): ScanFact {
  return { kind, symbol, file, line, text: text.trim(), status };
}

export async function scanFacts(root: string, input: Record<string, unknown>, maxFilesFallback = 80): Promise<readonly ScanFact[]> {
  const sources = await readLegacySourceFiles(root, { ...input, maxFiles: positiveInteger(input.maxFiles, maxFilesFallback) });
  const facts: ScanFact[] = [];
  for (const source of sources) {
    for (const [index, line] of source.lines.entries()) {
      const lineNumber = index + 1;
      const endpoint = line.match(/axios\.(get|post|put|patch|delete)\(['"]([^'"]+)['"][^)]*(?:\{([^}]*)\})?/);
      if (endpoint?.[1] && endpoint[2]) facts.push(lineFact("api_client", `${endpoint[1].toUpperCase()} ${endpoint[2]}`, source.path, lineNumber, line));
      const route = line.match(/router\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]\)\.handler\(([^)]+)\)/);
      if (route?.[1] && route[2]) facts.push(lineFact("backend_route", `${route[1].toUpperCase()} ${route[2]}`, source.path, lineNumber, line));
      for (const field of line.matchAll(/\b(?:private|public)\s+(?:String|Long|Integer|int|long|boolean|Boolean)\s+([A-Za-z_$][\w$]*)\b/g)) {
        if (field[1]) facts.push(lineFact("dto_field", field[1], source.path, lineNumber, line));
      }
      for (const param of line.matchAll(/#\{([A-Za-z_$][\w$]*)\}/g)) {
        if (param[1]) facts.push(lineFact("mapper_param", param[1], source.path, lineNumber, line));
      }
      for (const key of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*:/g)) {
        if (key[1]) facts.push(lineFact("payload_key", key[1], source.path, lineNumber, line, "Inferred"));
      }
      const selector = line.match(/export const\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*[^;]*state\./);
      if (selector?.[1]) facts.push(lineFact("selector", selector[1], source.path, lineNumber, line));
      const reducer = line.match(/function\s+([A-Za-z_$][\w$]*Reducer)\b/);
      if (reducer?.[1]) facts.push(lineFact("reducer", reducer[1], source.path, lineNumber, line));
      const action = line.match(/case\s+['"]([A-Z][A-Z0-9_]+)['"]|type:\s*['"]([A-Z][A-Z0-9_]+)['"]/);
      const actionSymbol = action?.[1] ?? action?.[2];
      if (actionSymbol) facts.push(lineFact("redux_write", actionSymbol, source.path, lineNumber, line));
      if (/yield\s+select\(/.test(line)) facts.push(lineFact("redux_read", "select", source.path, lineNumber, line));
      if (/disabled=\{|visible|can[A-Z]|ORDER_ADMIN|principal|interceptors\.request|role|permission/i.test(line)) facts.push(lineFact("auth_condition", line.trim(), source.path, lineNumber, line, /principal|ORDER_ADMIN/.test(line) ? "Verified" : "Needs Verification"));
      if (/catch\s*\(|ctx\.fail|\.catch\(|finally\b/.test(line)) facts.push(lineFact("error_handler", line.trim(), source.path, lineNumber, line));
      if (/@Transactional|commit\(|rollback\(/.test(line)) facts.push(lineFact("transaction", line.trim(), source.path, lineNumber, line));
      const rfc = line.match(/\bJCoUtil\.(?:call|execute)\(['"]([^'"]+)['"]/);
      if (rfc?.[1]) facts.push(lineFact("rfc_param", rfc[1], source.path, lineNumber, line));
    }
  }
  const sorted = facts.sort((left, right) => `${left.file}:${left.line}:${left.kind}`.localeCompare(`${right.file}:${right.line}:${right.kind}`));
  return bounded(sorted, input.maxFacts, maxFilesFallback * 20);
}

export function fieldNames(facts: readonly ScanFact[]): readonly string[] {
  return uniqueSorted(facts.filter((fact) => ["payload_key", "dto_field", "mapper_param"].includes(fact.kind)).map((fact) => fact.symbol));
}
