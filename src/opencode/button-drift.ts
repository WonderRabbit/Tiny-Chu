function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [item] : []) : [];
}

function records(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const row = record(item);
    return row ? [row] : [];
  }) : [];
}

function driftRows(value: unknown): readonly Record<string, unknown>[] {
  const row = record(value);
  return row ? [row] : records(value);
}

function rowKey(row: Record<string, unknown>, index: number): string {
  for (const key of ["buttonId", "button", "label"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return `row:${index}`;
}

function textField(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function sortedStrings(row: Record<string, unknown>, keys: readonly string[]): readonly string[] {
  for (const key of keys) {
    const values = strings(row[key]);
    if (values.length > 0) return [...values].sort();
  }
  return [];
}

function addTextDrift(blockers: string[], id: string, planned: Record<string, unknown>, observed: Record<string, unknown>, label: string, keys: readonly string[]): void {
  const expected = textField(planned, keys);
  const actual = textField(observed, keys);
  if (expected === undefined || expected.trim() === "") return;
  if (actual === undefined || actual.trim() === "") {
    blockers.push(`${label} missing for ${id}: expected ${expected}`);
    return;
  }
  if (expected !== actual) blockers.push(`${label} mismatch for ${id}: expected ${expected}, got ${actual}`);
}

function addListDrift(blockers: string[], id: string, planned: Record<string, unknown>, observed: Record<string, unknown>, label: string, keys: readonly string[]): void {
  const expected = sortedStrings(planned, keys);
  const actual = sortedStrings(observed, keys);
  if (expected.length > 0 && actual.join("\n") !== expected.join("\n")) blockers.push(`${label} mismatch for ${id}`);
}

export function aggregationDriftCheck(input: Record<string, unknown>): Record<string, unknown> {
  const plannedRows = driftRows(input.planned);
  const observedRows = driftRows(input.observed);
  const previousRows = records(record(input.previous)?.rows);
  const currentRows = records(record(input.current)?.rows);
  const currentByButton = new Map(currentRows.flatMap((row) => typeof row.buttonId === "string" ? [[row.buttonId, row]] : []));
  const blockers: string[] = [];
  if (plannedRows.length > 0 || observedRows.length > 0) {
    const observedByButton = new Map(observedRows.map((row, index) => [rowKey(row, index), row]));
    const plannedKeys = new Set<string>();
    plannedRows.forEach((planned, index) => {
      const id = rowKey(planned, index);
      plannedKeys.add(id);
      const observed = observedByButton.get(id);
      if (!observed) {
        blockers.push(`missing observed row for ${id}`);
        return;
      }
      compareSemanticRow(blockers, id, planned, observed);
    });
    observedRows.forEach((observed, index) => {
      const id = rowKey(observed, index);
      if (!plannedKeys.has(id)) blockers.push(`unexpected observed row for ${id}`);
    });
  }
  for (const prior of previousRows) {
    if (typeof prior.buttonId !== "string") continue;
    const current = currentByButton.get(prior.buttonId);
    if (prior.confidence === "Verified" && (!current || current.confidence !== "Verified")) blockers.push(`Verified edge dropped for ${prior.buttonId}`);
    if (current) compareSemanticRow(blockers, prior.buttonId, prior, current);
  }
  return { status: blockers.length > 0 ? "blocker" : "pass", blockers, warnings: [] };
}

function compareSemanticRow(blockers: string[], id: string, expected: Record<string, unknown>, actual: Record<string, unknown>): void {
  addTextDrift(blockers, id, expected, actual, "button", ["button"]);
  addTextDrift(blockers, id, expected, actual, "label", ["label"]);
  addTextDrift(blockers, id, expected, actual, "handler", ["handler"]);
  addTextDrift(blockers, id, expected, actual, "endpoint", ["endpoint", "api"]);
  addTextDrift(blockers, id, expected, actual, "mapper", ["mapper", "mapperSql"]);
  addTextDrift(blockers, id, expected, actual, "rfc", ["rfc", "rfcFunction"]);
  addTextDrift(blockers, id, expected, actual, "confidence", ["confidence", "status"]);
  addListDrift(blockers, id, expected, actual, "evidence refs", ["evidenceRefs", "evidence"]);
  addListDrift(blockers, id, expected, actual, "unknown gaps", ["unknowns", "gaps"]);
}
