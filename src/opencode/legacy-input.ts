export function recordInput(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

export function recordsInput(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordInput(item);
    return Object.keys(record).length > 0 ? [record] : [];
  });
}

export function stringField(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

export function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

export function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return recordInput(record[key]);
}

export function nestedRecords(record: Record<string, unknown>, key: string): readonly Record<string, unknown>[] {
  return recordsInput(record[key]);
}
