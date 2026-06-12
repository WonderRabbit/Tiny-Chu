import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTinyInfiPaths } from "../state/paths.js";
import { readJsonFile, writeJsonAtomic } from "../state/file-store.js";

export interface WikiDocumentRef {
  id: string;
  path: string;
  canonical: boolean;
  tags: string[];
  freshness: "manual" | "on-merge" | "generated";
}

export interface WikiIndex {
  documents: WikiDocumentRef[];
}

export interface WikiBundle {
  refs: WikiDocumentRef[];
  text: string;
}

export class WikiBundler {
  readonly root?: string;

  constructor(root?: string) {
    this.root = root;
  }

  async readIndex(): Promise<WikiIndex> {
    return readJsonFile<WikiIndex>(resolveTinyInfiPaths(this.root).wikiIndexFile, { documents: [] });
  }

  async writeIndex(index: WikiIndex): Promise<void> {
    await writeJsonAtomic(resolveTinyInfiPaths(this.root).wikiIndexFile, index);
  }

  async upsertDocument(ref: WikiDocumentRef): Promise<WikiIndex> {
    const index = await this.readIndex();
    const next = index.documents.filter((doc) => doc.id !== ref.id);
    next.push(ref);
    next.sort((a, b) => a.id.localeCompare(b.id));
    const updated = { documents: next };
    await this.writeIndex(updated);
    return updated;
  }

  async bundle(idsOrTags: string[] = []): Promise<WikiBundle> {
    const index = await this.readIndex();
    const selected = idsOrTags.length === 0
      ? index.documents.filter((doc) => doc.canonical)
      : index.documents.filter((doc) => idsOrTags.includes(doc.id) || doc.tags.some((tag) => idsOrTags.includes(tag)));
    const root = resolveTinyInfiPaths(this.root).root;
    const chunks = await Promise.all(selected.map(async (doc) => {
      const content = await readFile(path.resolve(root, doc.path), "utf8");
      return `---\nwiki: ${doc.id}\npath: ${doc.path}\ntags: ${doc.tags.join(",")}\n---\n${content.trim()}\n`;
    }));
    return { refs: selected, text: chunks.join("\n") };
  }
}
