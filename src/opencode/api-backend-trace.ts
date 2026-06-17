import { createLegacyRepoIndex } from "./legacy-repo-index.js";
import type { LegacyEvidenceFact, LegacySymbolLink, LegacyUnknownLink } from "./legacy-types.js";
import { unknownLink } from "./legacy-types.js";
import { legacyTextInput } from "./legacy-scanner.js";

export interface ApiBackendTraceResult {
  readonly status: "matched" | "unmatched_endpoint";
  readonly endpoint: {
    readonly method: string;
    readonly path: string;
    readonly evidence: readonly string[];
  };
  readonly backendEntry: LegacySymbolLink | LegacyUnknownLink;
  readonly service: LegacySymbolLink | LegacyUnknownLink;
  readonly integration: {
    readonly mapperId?: string;
    readonly rfcFunction?: string;
    readonly evidence: readonly string[];
  };
  readonly missingEvidence: readonly string[];
}

function link(fact: LegacyEvidenceFact): LegacySymbolLink {
  return { symbol: fact.symbol ?? "Unknown", file: fact.file, line: fact.line, confidence: fact.confidence };
}

export async function createApiBackendTrace(root: string, input: Record<string, unknown>): Promise<ApiBackendTraceResult> {
  const method = legacyTextInput(input.method, "GET").toUpperCase();
  const targetPath = legacyTextInput(input.path, "");
  const index = await createLegacyRepoIndex(root, input);
  const api = index.facts.find((fact) => fact.kind === "api_client" && fact.method === method && fact.path === targetPath);
  const route = index.facts.find((fact) => fact.kind === "backend_route" && fact.method === method && fact.path === targetPath);
  const service = route ? index.facts.find((fact) => fact.kind === "service_method" && fact.symbol?.endsWith(`.${route.symbol ?? ""}`)) : undefined;
  const mapper = service ? index.facts.find((fact) => fact.kind === "mapper_call" && fact.file === service.file) : undefined;
  const rfc = service ? index.facts.find((fact) => fact.kind === "rfc_call" && fact.file === service.file) : undefined;
  const missingIntegration = [
    ...(mapper ? [] : ["No mapper call evidence linked to matched service"]),
    ...(rfc ? [] : ["No RFC call evidence linked to matched service"]),
  ];
  const evidence = [api, route].flatMap((fact) => fact ? [fact.id] : []);
  if (!route) {
    return {
      status: "unmatched_endpoint",
      endpoint: { method, path: targetPath, evidence },
      backendEntry: unknownLink(),
      service: unknownLink(),
      integration: { evidence: [] },
      missingEvidence: [`No backend route matched ${method} ${targetPath}`],
    };
  }
  return {
    status: "matched",
    endpoint: { method, path: targetPath, evidence },
    backendEntry: link(route),
    service: service ? link(service) : unknownLink(),
    integration: {
      ...(mapper?.symbol ? { mapperId: mapper.symbol } : {}),
      ...(rfc?.symbol ? { rfcFunction: rfc.symbol } : {}),
      evidence: [mapper, rfc].flatMap((fact) => fact ? [fact.id] : []),
    },
    missingEvidence: service ? missingIntegration : ["No service method evidence linked to backend route"],
  };
}
