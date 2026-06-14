export function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) output[key] = String(item);
  return output;
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function publishEntries(value: unknown): readonly { readonly source: string; readonly target: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const source = "source" in item ? String(item.source) : "";
    const target = "target" in item ? String(item.target) : "";
    return source && target ? [{ source, target }] : [];
  });
}
