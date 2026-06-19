export function exactNamingLookupKey(name: string): string {
  return name;
}

export function normalizedNamingLookupKey(name: string): string {
  return name.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase();
}

export function normalizedNamingToken(token: string): string {
  return normalizedNamingLookupKey(token);
}
