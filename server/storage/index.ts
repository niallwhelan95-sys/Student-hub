import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../env";

/**
 * File storage abstraction. The local-disk implementation keeps files outside any
 * publicly served directory; they are only ever streamed back through authorised routes.
 * An S3-compatible adapter can implement the same interface for cloud deployments.
 */
export interface Storage {
  put(userId: string, data: Buffer, ext: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(userId: string, data: Buffer, ext: string): Promise<string> {
    const safeExt = ext.replace(/[^a-z0-9.]/gi, "").slice(0, 10);
    const key = `${userId}/${randomUUID()}${safeExt}`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: "wx" });
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

let storage: Storage | null = null;

export function getStorage(): Storage {
  if (!storage) storage = new LocalStorage(path.resolve(env.UPLOAD_DIR));
  return storage;
}

export function setStorage(s: Storage): void {
  storage = s;
}
