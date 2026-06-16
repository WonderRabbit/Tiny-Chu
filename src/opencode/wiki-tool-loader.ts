type WikiToolModule = {
  readonly createWikiSearch: (root: string | undefined, input: Record<string, unknown>) => Promise<unknown> | unknown;
  readonly createWikiContext: (root: string | undefined, input: Record<string, unknown>) => Promise<unknown> | unknown;
};

function isWikiToolModule(value: unknown): value is WikiToolModule {
  if (typeof value !== "object" || value === null) return false;
  const search = Object.getOwnPropertyDescriptor(value, "createWikiSearch")?.value;
  const context = Object.getOwnPropertyDescriptor(value, "createWikiContext")?.value;
  return typeof search === "function" && typeof context === "function";
}

export async function wikiToolModule(): Promise<WikiToolModule> {
  const loaded: unknown = await import("../wiki/" + "wiki-tools.js");
  if (isWikiToolModule(loaded)) return loaded;
  throw new TypeError("Wiki search module does not expose createWikiSearch/createWikiContext.");
}
