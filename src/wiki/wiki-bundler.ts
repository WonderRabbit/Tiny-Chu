import { readFile } from "node:fs/promises";
import { resolveTinyChuPaths } from "../state/paths.js";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import { readJsonFile, writeJsonAtomic } from "../state/file-store.js";
import { withTinyStateLock } from "../state/lock-store.js";
import { renderWikiContext } from "./wiki-context.js";
import { searchWiki } from "./wiki-search.js";
import { resolveWikiIndexReadPath, resolveWikiIndexWritePath } from "./wiki-storage.js";
import type { WikiBundle, WikiContextInput, WikiContextResult, WikiDocumentRef, WikiIndex, WikiSearchInput, WikiSearchResult } from "./wiki-types.js";

export type { WikiBundle, WikiContextInput, WikiContextResult, WikiDocumentRef, WikiIndex, WikiSearchInput, WikiSearchResult } from "./wiki-types.js";

export class WikiBundler {
  readonly root?: string;

  constructor(root?: string) {
    this.root = root;
  }

  async readIndex(): Promise<WikiIndex> {
    const indexPath = await resolveWikiIndexReadPath(this.root);
    if (!indexPath.exists) return { documents: [] };
    return readJsonFile<WikiIndex>(indexPath.file, { documents: [] });
  }

  async writeIndex(index: WikiIndex): Promise<void> {
    await withTinyStateLock(this.root, "wiki-index.lock", async (lock) => {
      await lock.assertActive();
      await this.writeIndexUnlocked(index);
    });
  }

  async upsertDocument(ref: WikiDocumentRef): Promise<WikiIndex> {
    return withTinyStateLock(this.root, "wiki-index.lock", async (lock) => {
      const index = await this.readIndex();
      const next = index.documents.filter((doc) => doc.id !== ref.id);
      next.push(ref);
      next.sort((a, b) => a.id.localeCompare(b.id));
      const updated = { documents: next };
      await lock.assertActive();
      await this.writeIndexUnlocked(updated);
      return updated;
    });
  }

  async search(input: WikiSearchInput = {}): Promise<WikiSearchResult> {
    return searchWiki(this.root, input);
  }

  async context(input: WikiContextInput): Promise<WikiContextResult> {
    return renderWikiContext(this.root, input);
  }

  async bundle(idsOrTags: string[] = []): Promise<WikiBundle> {
    const index = await this.readIndex();
    const selected = idsOrTags.length === 0
      ? index.documents.filter((doc) => doc.canonical)
      : index.documents.filter((doc) => idsOrTags.includes(doc.id) || doc.tags.some((tag) => idsOrTags.includes(tag)));
    const root = resolveTinyChuPaths(this.root).root;
    const chunks = await Promise.all(selected.map(async (doc) => {
      const file = await resolveExistingPathInsideRoot(root, doc.path);
      if (!file) throw new Error(`Wiki document path is outside configured root: ${doc.path}`);
      const content = await readFile(file, "utf8");
      return `---\nwiki: ${doc.id}\npath: ${doc.path}\ntags: ${doc.tags.join(",")}\n---\n${content.trim()}\n`;
    }));
    return { refs: selected, text: chunks.join("\n") };
  }

  private async writeIndexUnlocked(index: WikiIndex): Promise<void> {
    await writeJsonAtomic(await resolveWikiIndexWritePath(this.root), index);
  }
}
