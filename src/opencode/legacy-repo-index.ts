import path from "node:path";
import type { LegacyEvidenceFact, LegacyRepoIndexResult } from "./legacy-types.js";
import { evidenceFact, firstMatch, readLegacySourceFiles, uniqueSorted } from "./legacy-scanner.js";

const HTTP_METHODS: Readonly<Record<string, string>> = {
  GetMapping: "GET",
  PostMapping: "POST",
  PutMapping: "PUT",
  PatchMapping: "PATCH",
  DeleteMapping: "DELETE",
};

function markerFact(file: string, line: string): LegacyEvidenceFact | undefined {
  const name = path.basename(file);
  if (!["package.json", "pom.xml", "build.gradle"].includes(name) && !file.endsWith("Mapper.xml")) return undefined;
  return evidenceFact({ kind: "project_marker", file, line: 1, symbol: name, text: line || name });
}

function frameworkFacts(file: string, content: string): readonly LegacyEvidenceFact[] {
  const facts: LegacyEvidenceFact[] = [];
  const frameworks = [
    ["react", /"react"\s*:/],
    ["redux-saga", /"redux-saga"\s*:/],
    ["axios", /"axios"\s*:/],
    ["maven", /<project>/],
    ["mybatis", /<mapper\s+namespace=/],
  ] as const;
  for (const [name, pattern] of frameworks) {
    if (pattern.test(content)) facts.push(evidenceFact({ kind: "framework", file, line: 1, symbol: name, text: name }));
  }
  return facts;
}

function factsFromLine(file: string, line: string, lineNumber: number): readonly LegacyEvidenceFact[] {
  const facts: LegacyEvidenceFact[] = [];
  const component = firstMatch(line, /export function\s+([A-Z][A-Za-z0-9_]*)/);
  if (component && /jsx|tsx|<button/.test(`${file}${line}`)) facts.push(evidenceFact({ kind: "react_component", file, line: lineNumber, symbol: component, text: line }));
  const button = line.match(/<button[^>]*onClick=\{([^}]+)\}[^>]*>([^<]+)<\/button>/);
  if (button?.[1] && button[2]) facts.push(evidenceFact({ kind: "ui_event", file, line: lineNumber, symbol: button[1], text: line, path: button[2].trim() }));
  const handler = line.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*\(\)\s*=>\s*dispatch\(([A-Za-z_$][\w$]*)\(/);
  if (handler?.[1]) facts.push(evidenceFact({ kind: "event_handler", file, line: lineNumber, symbol: handler[1], text: line, path: handler[2] }));
  const action = line.match(/export const\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/);
  if (action?.[1]) facts.push(evidenceFact({ kind: "redux_action", file, line: lineNumber, symbol: action[1], text: line }));
  const creator = line.match(/export const\s+([a-z][A-Za-z0-9_]*)\s*=\s*\(\)\s*=>\s*\(\{\s*type:\s*([A-Z][A-Z0-9_]*)/);
  if (creator?.[1]) facts.push(evidenceFact({ kind: "action_creator", file, line: lineNumber, symbol: creator[1], text: line, path: creator[2] }));
  const watcher = line.match(/takeEvery\(([^,]+),\s*([A-Za-z_$][\w$]*)\)/);
  if (watcher?.[1] && watcher[2]) facts.push(evidenceFact({ kind: "saga_watcher", file, line: lineNumber, symbol: watcher[1].trim(), text: line, path: watcher[2] }));
  const worker = firstMatch(line, /function\*\s+([A-Za-z_$][\w$]*)/);
  if (worker) facts.push(evidenceFact({ kind: "saga_worker", file, line: lineNumber, symbol: worker, text: line }));
  const api = line.match(/export const\s+([A-Za-z_$][\w$]*)\s*=.*axios\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/);
  if (api?.[1] && api[2] && api[3]) facts.push(evidenceFact({ kind: "api_client", file, line: lineNumber, symbol: api[1], text: line, method: api[2].toUpperCase(), path: api[3] }));
  const rfc = firstMatch(line, /["'](Z_[A-Z0-9_]+)["']/);
  if (rfc) facts.push(evidenceFact({ kind: "rfc_call", file, line: lineNumber, symbol: rfc, text: line }));
  return facts;
}

function xmlMapperFacts(file: string, lines: readonly string[], content: string): readonly LegacyEvidenceFact[] {
  if (!file.endsWith(".xml")) return [];
  const facts: LegacyEvidenceFact[] = [];
  const blocks = content.matchAll(/<(select|insert|update|delete)\s+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/g);
  for (const block of blocks) {
    const operation = block[1];
    const mapperId = block[2];
    const body = block[3] ?? "";
    if (!operation || !mapperId) continue;
    const line = lines.findIndex((value) => value.includes(`id="${mapperId}"`) || value.includes(`id='${mapperId}'`)) + 1;
    const tables = [...body.matchAll(/\b(?:INTO|FROM|UPDATE|JOIN)\s+([A-Z][A-Z0-9_]*)\b/g)].flatMap((match) => match[1] ? [match[1]] : []);
    facts.push(evidenceFact({ kind: "mybatis_mapper", file, line: line > 0 ? line : 1, symbol: mapperId, text: body, operation, tables }));
  }
  return facts;
}

function javaFacts(file: string, lines: readonly string[]): readonly LegacyEvidenceFact[] {
  const facts: LegacyEvidenceFact[] = [];
  let route: { readonly method: string; readonly path: string; readonly line: number; readonly text: string } | undefined;
  let className = "";
  for (const [index, line] of lines.entries()) {
    const classMatch = firstMatch(line, /class\s+([A-Za-z_$][\w$]*)/);
    if (classMatch) className = classMatch;
    for (const [annotation, method] of Object.entries(HTTP_METHODS)) {
      const routePath = firstMatch(line, new RegExp(`@${annotation}\\(["']([^"']+)["']\\)`));
      if (routePath) route = { method, path: routePath, line: index + 1, text: line };
    }
    const methodName = firstMatch(line, /public\s+[A-Za-z_$][\w$<>]*\s+([A-Za-z_$][\w$]*)\(/);
    if (methodName && route) facts.push(evidenceFact({ kind: "backend_route", file, line: route.line, symbol: methodName, text: `${route.text} ${line}`, method: route.method, path: route.path }));
    if (methodName && className.endsWith("Service")) facts.push(evidenceFact({ kind: "service_method", file, line: index + 1, symbol: `${className}.${methodName}`, text: line }));
    const mapperCall = firstMatch(line, /orderMapper\.([A-Za-z_$][\w$]*)\(/);
    if (mapperCall) facts.push(evidenceFact({ kind: "mapper_call", file, line: index + 1, symbol: mapperCall, text: line }));
  }
  return facts;
}

export async function createLegacyRepoIndex(root: string, input: Record<string, unknown>): Promise<LegacyRepoIndexResult> {
  const sources = await readLegacySourceFiles(root, input);
  const facts: LegacyEvidenceFact[] = [];
  const markers: LegacyEvidenceFact[] = [];
  for (const source of sources) {
    const marker = markerFact(source.path, source.lines[0] ?? source.path);
    if (marker) markers.push(marker);
    facts.push(...frameworkFacts(source.path, source.content));
    facts.push(...xmlMapperFacts(source.path, source.lines, source.content));
    for (const [index, line] of source.lines.entries()) facts.push(...factsFromLine(source.path, line, index + 1));
    if (source.path.endsWith(".java")) facts.push(...javaFacts(source.path, source.lines));
  }
  const detectedFrameworks = uniqueSorted(facts.filter((fact) => fact.kind === "framework" && fact.symbol).flatMap((fact) => fact.symbol ? [fact.symbol] : []));
  const inventoryMarkdown = ["# Repository Inventory", "## Detected Frameworks", ...detectedFrameworks.map((item) => `- ${item}`), "## Verified Facts", ...facts.slice(0, 40).map((fact) => `- ${fact.id}`)].join("\n");
  return {
    root: ".",
    scannedFiles: sources.length,
    detectedFrameworks,
    projectMarkers: markers,
    facts,
    inventoryMarkdown,
    recommendedCommands: [
      "fd --type f --hidden --exclude .git --exclude node_modules --exclude dist",
      "rg --json --line-number --column 'onClick|takeEvery|axios\\.|@PostMapping|<insert|Z_' .",
      "ast-grep run --lang ts -p 'axios.$METHOD($PATH, $$$ARGS)' src",
      "jq -c '.facts[] | select(.confidence==\"verified\")' .analysis/index/repo_index.json",
      "mdq --output json 'code' .analysis/trace/traceability_matrix.md",
    ],
  };
}
