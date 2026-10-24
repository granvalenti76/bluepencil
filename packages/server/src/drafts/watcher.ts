import { relative } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { EventBus } from "../events.ts";
import type { IndexDb } from "../index-db/index.ts";
import type { DraftsRepo } from "./repo.ts";

/**
 * Watches the drafts folder: updates the index and sends `draft.changed`. Writes made by the
 * server itself are recognised by their hash (`noteSelfWrite`) and raise no events.
 */
export class DraftWatcher {
  private watcher: FSWatcher | null = null;
  private selfWrites = new Map<string, string>();

  private repo: DraftsRepo;
  private index: IndexDb;
  private bus: EventBus;

  constructor(repo: DraftsRepo, index: IndexDb, bus: EventBus) {
    this.repo = repo;
    this.index = index;
    this.bus = bus;
  }

  noteSelfWrite(path: string, hash: string) {
    this.selfWrites.set(path, hash);
  }

  async start(): Promise<void> {
    const root = await this.repo.root();
    const w = watch(root, {
      ignoreInitial: true,
      // Hidden folders and files (including .bluepencil and the temporary files of atomic
      // writes): look at the relative path, because the folder itself may sit in a path with
      // hidden parts.
      ignored: (p) =>
        relative(root, p)
          .split("/")
          .some((part) => part.startsWith(".")),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    });
    this.watcher = w;
    w.on("add", (p) => void this.handle(p, "add"));
    w.on("change", (p) => void this.handle(p, "change"));
    w.on("unlink", (p) => void this.handle(p, "unlink"));
    await new Promise<void>((resolve) => w.once("ready", () => resolve()));
  }

  private async handle(abs: string, change: "add" | "change" | "unlink") {
    if (!abs.endsWith(".md")) return;
    try {
      const path = await this.repo.relPath(abs);
      if (change === "unlink") {
        this.selfWrites.delete(path);
        this.index.remove(path);
        this.bus.emit({ type: "draft.changed", path, contentHash: null, change });
        return;
      }
      const file = await this.repo.read(path);
      if (this.selfWrites.get(path) === file.hash) return;
      this.index.upsert(path, file.text, file.mtimeMs);
      this.bus.emit({ type: "draft.changed", path, contentHash: file.hash, change });
    } catch {
      // File gone or invalid between the event and the read: the next event picks it up.
    }
  }

  async close() {
    await this.watcher?.close();
  }
}
