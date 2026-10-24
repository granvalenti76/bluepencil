import { createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { lstat, readdir, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class PathError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {
  currentHash: string;
  constructor(currentHash: string) {
    super("The file changed on disk");
    this.currentHash = currentHash;
  }
}

export interface DraftFile {
  path: string;
  text: string;
  hash: string;
  mtimeMs: number;
}

export const INDEX_DIR = ".bluepencil";
/** The previous name (Editorial Desk): renamed at startup. */
export const LEGACY_INDEX_DIR = ".editorial-desk";

export const hashText = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Access to the `.md` files in the drafts folder: every path is resolved and checked to be inside
 * the folder (no `..`, no symbolic links that lead out). The files are the source of truth;
 * writes are atomic (temporary file + `rename`).
 */
export class DraftsRepo {
  readonly dir: string;
  private realRoot: Promise<string>;

  constructor(dir: string) {
    this.dir = dir;
    this.realRoot = realpath(dir);
  }

  /** Real path of the drafts folder. */
  root(): Promise<string> {
    return this.realRoot;
  }

  /** Validates a relative path and returns the absolute one. */
  async resolve(rel: string, opts: { mustExist?: boolean } = {}): Promise<string> {
    if (rel === "" || rel.includes("\0") || isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
      throw new PathError("Invalid path");
    }
    const parts = rel.split(/[\\/]/);
    if (parts.some((p) => p === ".." || p === "." || p === "" || p.startsWith("."))) {
      throw new PathError("Invalid path");
    }
    if (!rel.endsWith(".md")) throw new PathError("Sono ammessi solo file .md");

    const root = await this.realRoot;
    const abs = resolve(root, rel);
    if (!abs.startsWith(root + sep)) throw new PathError("Path outside the drafts folder");

    // A symbolic link must not lead outside: check the real path of the file
    // (or of the folder that will contain it).
    let real: string;
    try {
      real = await realpath(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      if (opts.mustExist) throw new NotFoundError(rel);
      real = join(await realpath(dirname(abs)).catch(() => root), basename(abs));
    }
    if (!real.startsWith(root + sep)) throw new PathError("Path outside the drafts folder");
    return abs;
  }

  /** Relative path (with "/") of an absolute file in the folder. */
  async relPath(abs: string): Promise<string> {
    return relative(await this.realRoot, abs)
      .split(sep)
      .join("/");
  }

  async read(rel: string): Promise<DraftFile> {
    const abs = await this.resolve(rel, { mustExist: true });
    const [text, st] = await Promise.all([readFile(abs, "utf8"), stat(abs)]);
    return { path: rel, text, hash: hashText(text), mtimeMs: st.mtimeMs };
  }

  /**
   * Writes only if the file on disk still has `baseHash` (`null` = the file must not exist).
   * Atomic: temporary file in the same folder, fsync, rename.
   */
  async write(rel: string, text: string, baseHash: string | null): Promise<DraftFile> {
    const abs = await this.resolve(rel);
    let current: string | null = null;
    try {
      current = hashText(await readFile(abs, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (baseHash === null) {
      if (current !== null) throw new ConflictError(current);
    } else {
      if (current === null) throw new NotFoundError(rel);
      if (current !== baseHash) throw new ConflictError(current);
    }

    const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(6).toString("hex")}.tmp`);
    const fd = openSync(tmp, "wx");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      await rename(tmp, abs);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    return { path: rel, text, hash: hashText(text), mtimeMs: (await stat(abs)).mtimeMs };
  }

  /** Recursive list of the `.md` files (relative paths), without hidden folders or symbolic links. */
  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else if (entry.isFile() && entry.name.endsWith(".md")) out.push(await this.relPath(abs));
      }
    };
    await walk(await this.realRoot);
    return out.sort();
  }

  async stat(rel: string) {
    return lstat(await this.resolve(rel, { mustExist: true }));
  }
}
