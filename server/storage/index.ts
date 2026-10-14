import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { env } from "../env";

/**
 * File storage abstraction. Local disk for development / single-server hosting; private
 * Vercel Blob storage when deployed to Vercel. Files are never publicly addressable — they
 * are only streamed back through authorised routes.
 */
export interface Storage {
  readonly kind: "local" | "blob";
  put(userId: string, data: Buffer, ext: string, contentType?: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  /** Stream for serving downloads without buffering (keeps large files under platform response limits). */
  stream(key: string): Promise<ReadableStream<Uint8Array>>;
  remove(key: string): Promise<void>;
}

/** Storage keys always live under the owning user's prefix; used to validate client-uploaded keys. */
export const userPrefix = (userId: string) => `uploads/${userId}/`;

class LocalStorage implements Storage {
  readonly kind = "local" as const;
  constructor(private root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(userId: string, data: Buffer, ext: string): Promise<string> {
    const safeExt = ext.replace(/[^a-z0-9.]/gi, "").slice(0, 10);
    const key = `${userPrefix(userId)}${randomUUID()}${safeExt}`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: "wx" });
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async stream(key: string): Promise<ReadableStream<Uint8Array>> {
    const { createReadStream } = await import("node:fs");
    return Readable.toWeb(createReadStream(this.resolve(key))) as ReadableStream<Uint8Array>;
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

/** Private Vercel Blob store. Auth comes from BLOB_READ_WRITE_TOKEN or Vercel OIDC automatically. */
class BlobStorage implements Storage {
  readonly kind = "blob" as const;

  async put(userId: string, data: Buffer, ext: string, contentType?: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    const safeExt = ext.replace(/[^a-z0-9.]/gi, "").slice(0, 10);
    const result = await put(`${userPrefix(userId)}${randomUUID()}${safeExt}`, data, {
      access: "private",
      addRandomSuffix: false,
      contentType,
    });
    return result.pathname;
  }

  private async open(key: string) {
    const { get } = await import("@vercel/blob");
    const result = await get(key, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) throw new Error("File not found in storage");
    return result.stream as ReadableStream<Uint8Array>;
  }

  async get(key: string): Promise<Buffer> {
    return Buffer.from(await new Response(await this.open(key)).arrayBuffer());
  }

  async stream(key: string): Promise<ReadableStream<Uint8Array>> {
    return this.open(key);
  }

  async remove(key: string): Promise<void> {
    const { del } = await import("@vercel/blob");
    await del(key);
  }
}

let storage: Storage | null = null;

export function getStorage(): Storage {
  if (!storage) storage = env.STORAGE_DRIVER === "blob" ? new BlobStorage() : new LocalStorage(path.resolve(env.UPLOAD_DIR));
  return storage;
}

export function setStorage(s: Storage): void {
  storage = s;
}
