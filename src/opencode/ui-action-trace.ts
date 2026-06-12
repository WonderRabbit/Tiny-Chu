import { createLegacyRepoIndex } from "./legacy-repo-index.js";
import type { LegacyEvidenceFact, LegacyRepoIndexResult, LegacySymbolLink, LegacyUnknownLink } from "./legacy-types.js";
import { unknownLink } from "./legacy-types.js";
import { textInput } from "./legacy-scanner.js";

export interface UiActionTraceRow {
  readonly uiElement: LegacySymbolLink & { readonly label: string };
  readonly eventHandler: LegacySymbolLink | LegacyUnknownLink;
  readonly reduxAction: LegacySymbolLink | LegacyUnknownLink;
  readonly sagaWatcher: LegacySymbolLink | LegacyUnknownLink;
  readonly sagaWorker: LegacySymbolLink | LegacyUnknownLink;
  readonly apiClient: (LegacySymbolLink & { readonly method?: string; readonly path?: string }) | LegacyUnknownLink;
  readonly evidence: readonly string[];
  readonly confidence: "verified" | "needs_verification";
}

export interface UiActionTraceResult {
  readonly rows: readonly UiActionTraceRow[];
  readonly unknowns: readonly string[];
}

function link(fact: LegacyEvidenceFact): LegacySymbolLink {
  return { symbol: fact.symbol ?? "Unknown", file: fact.file, line: fact.line, confidence: fact.confidence };
}

function findFact(index: LegacyRepoIndexResult, kind: string, symbol?: string): LegacyEvidenceFact | undefined {
  return index.facts.find((fact) => fact.kind === kind && (!symbol || fact.symbol === symbol || fact.path === symbol || fact.text.includes(symbol)));
}

function findExactFact(index: LegacyRepoIndexResult, kind: string, symbol?: string): LegacyEvidenceFact | undefined {
  return index.facts.find((fact) => fact.kind === kind && (!symbol || fact.symbol === symbol));
}

function apiLink(fact: LegacyEvidenceFact | undefined): (LegacySymbolLink & { readonly method?: string; readonly path?: string }) | LegacyUnknownLink {
  if (!fact) return unknownLink();
  return { ...link(fact), ...(fact.method ? { method: fact.method } : {}), ...(fact.path ? { path: fact.path } : {}) };
}

function traceRow(index: LegacyRepoIndexResult, label: string): UiActionTraceRow | undefined {
  const event = index.facts.find((fact) => fact.kind === "ui_event" && (!label || fact.path === label));
  if (!event) return undefined;
  const handler = findFact(index, "event_handler", event.symbol);
  const actionCreator = handler?.path ? findFact(index, "action_creator", handler.path) : undefined;
  const reduxAction = actionCreator?.path ? findFact(index, "redux_action", actionCreator.path) : undefined;
  const sagaWatcher = reduxAction?.symbol ? findFact(index, "saga_watcher", reduxAction.symbol) : undefined;
  const sagaWorker = sagaWatcher?.path ? findExactFact(index, "saga_worker", sagaWatcher.path) : undefined;
  const exactApiClient = sagaWorker ? index.facts.find((fact) => fact.kind === "api_client" && sagaWorker.text.includes(fact.symbol ?? "")) : undefined;
  const apiClient = exactApiClient ?? (sagaWorker ? index.facts.find((fact) => fact.kind === "api_client") : undefined);
  const linked = [event, handler, reduxAction, sagaWatcher, sagaWorker, apiClient].flatMap((fact) => fact ? [fact.id] : []);
  const complete = Boolean(handler && reduxAction && sagaWatcher && sagaWorker && apiClient);
  return {
    uiElement: { ...link(event), label: event.path ?? event.symbol ?? label },
    eventHandler: handler ? link(handler) : unknownLink(),
    reduxAction: reduxAction ? link(reduxAction) : unknownLink(),
    sagaWatcher: sagaWatcher ? link(sagaWatcher) : unknownLink(),
    sagaWorker: sagaWorker ? link(sagaWorker) : unknownLink(),
    apiClient: apiLink(apiClient),
    evidence: linked,
    confidence: complete ? "verified" : "needs_verification",
  };
}

export async function createUiActionTrace(root: string, input: Record<string, unknown>): Promise<UiActionTraceResult> {
  const index = await createLegacyRepoIndex(root, input);
  const label = textInput(input.label, "");
  const row = traceRow(index, label);
  return {
    rows: row ? [row] : [],
    unknowns: row ? [] : [`UI event not found: ${label || "unspecified"}`],
  };
}
