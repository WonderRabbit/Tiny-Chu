import { nestedRecord, nestedRecords, recordInput, stringField } from "./legacy-input.js";

export interface TraceabilityMatrixRow {
  readonly feature: string;
  readonly uiPage: string;
  readonly uiEvent: string;
  readonly feHandler: string;
  readonly reduxAction: string;
  readonly saga: string;
  readonly api: string;
  readonly backendEntry: string;
  readonly service: string;
  readonly mapperSql: string;
  readonly rfcFunction: string;
  readonly evidence: readonly string[];
  readonly confidence: string;
  readonly gap: string;
  readonly verificationMethod: string;
  readonly status: "complete" | "partial" | "unmatched";
}

export interface TraceabilityMatrixResult {
  readonly rows: readonly TraceabilityMatrixRow[];
  readonly markdown: string;
}

function symbolFrom(record: Record<string, unknown>, key: string): string {
  return stringField(nestedRecord(record, key), "symbol", "Unknown");
}

function linkEvidence(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [item] : []) : [];
}

function firstTraceRow(input: Record<string, unknown>): Record<string, unknown> {
  const uiTrace = recordInput(input.uiTrace);
  return nestedRecords(uiTrace, "rows")[0] ?? {};
}

function statusFor(values: readonly string[]): "complete" | "partial" | "unmatched" {
  if (values.every((value) => value !== "Unknown" && value !== "")) return "complete";
  if (values.some((value) => value !== "Unknown" && value !== "")) return "partial";
  return "unmatched";
}

function markdown(rows: readonly TraceabilityMatrixRow[]): string {
  const header = "| Feature | UI Event | API | BE Entry | Mapper SQL | RFC Function | Confidence | Gap |";
  const separator = "| --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = rows.map((row) => `| ${row.feature} | ${row.uiEvent} | ${row.api} | ${row.backendEntry} | ${row.mapperSql} | ${row.rfcFunction} | ${row.confidence} | ${row.gap} |`);
  return [header, separator, ...body].join("\n");
}

export function createTraceabilityMatrix(input: Record<string, unknown>): TraceabilityMatrixResult {
  const feature = stringField(input, "feature", "Unknown feature");
  const uiRow = firstTraceRow(input);
  const apiTrace = recordInput(input.apiTrace);
  const endpoint = nestedRecord(apiTrace, "endpoint");
  const integration = nestedRecord(apiTrace, "integration");
  const dbCatalog = nestedRecords(recordInput(input.integrationCatalog), "dbCatalog");
  const rfcCatalog = nestedRecords(recordInput(input.integrationCatalog), "rfcCatalog");
  const api = `${stringField(endpoint, "method", "Unknown")} ${stringField(endpoint, "path", "Unknown")}`;
  const mapperSql = stringField(integration, "mapperId", stringField(dbCatalog[0] ?? {}, "mapperId", "Unknown"));
  const rfcFunction = stringField(integration, "rfcFunction", stringField(rfcCatalog[0] ?? {}, "functionName", "Unknown"));
  const fields = [
    symbolFrom(uiRow, "eventHandler"),
    symbolFrom(uiRow, "reduxAction"),
    symbolFrom(uiRow, "sagaWorker"),
    api,
    symbolFrom(apiTrace, "backendEntry"),
    symbolFrom(apiTrace, "service"),
    mapperSql,
    rfcFunction,
  ];
  const status = statusFor(fields);
  const gap = status === "complete" ? "" : `Missing evidence for ${fields.filter((value) => value === "Unknown" || value === "").length} link(s), including backend or integration where applicable`;
  const rows: TraceabilityMatrixRow[] = [{
    feature,
    uiPage: stringField(nestedRecord(uiRow, "uiElement"), "file", "Unknown"),
    uiEvent: stringField(nestedRecord(uiRow, "uiElement"), "label", feature),
    feHandler: symbolFrom(uiRow, "eventHandler"),
    reduxAction: symbolFrom(uiRow, "reduxAction"),
    saga: symbolFrom(uiRow, "sagaWorker"),
    api,
    backendEntry: symbolFrom(apiTrace, "backendEntry"),
    service: symbolFrom(apiTrace, "service"),
    mapperSql,
    rfcFunction,
    evidence: [...linkEvidence(uiRow, "evidence"), ...linkEvidence(integration, "evidence"), ...linkEvidence(endpoint, "evidence")],
    confidence: status === "complete" ? "verified" : "needs_verification",
    gap,
    verificationMethod: "Run legacy_repo_index, ui_action_trace, api_backend_trace, integration_catalog, then evidence_qa.",
    status,
  }];
  return { rows, markdown: markdown(rows) };
}
