import { del, list, put } from '@vercel/blob';
import type { FileMeta } from '../file-meta';
import type { MetaStore, ObjectStore, StoredObject } from './types';

const SIDECAR_SUFFIX = '.meta.json';

function parseUploadedAt(pathname: string): number {
  const filename = pathname.split('/').pop() ?? pathname;
  const match = /^(\d{10,16})-/.exec(filename);
  return match ? Number(match[1]) : 0;
}

async function findUrlForKey(key: string): Promise<string | null> {
  const { blobs } = await list({ prefix: key, limit: 5 });
  const exact = blobs.find((b) => b.pathname === key);
  return exact?.url ?? null;
}

export class VercelBlobObjectStore implements ObjectStore {
  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const blob = await put(key, body, {
      access: 'public',
      addRandomSuffix: false,
      contentType,
      allowOverwrite: true,
    });
    return {
      key: blob.pathname,
      url: blob.url,
      sizeBytes: body.byteLength,
      uploadedAt: parseUploadedAt(blob.pathname) || Date.now(),
    };
  }

  async get(key: string): Promise<Buffer> {
    const url = await findUrlForKey(key);
    if (!url) throw Object.assign(new Error(`blob not found: ${key}`), { code: 'ENOENT' });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`blob fetch ${res.status}: ${key}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const url = await findUrlForKey(key);
    if (!url) return;
    await del(url);
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) {
        if (b.pathname.endsWith(SIDECAR_SUFFIX)) continue;
        out.push({
          key: b.pathname,
          url: b.url,
          sizeBytes: b.size,
          uploadedAt: parseUploadedAt(b.pathname) || new Date(b.uploadedAt).getTime(),
        });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  async exists(key: string): Promise<boolean> {
    return (await findUrlForKey(key)) !== null;
  }
}

export class VercelBlobMetaStore implements MetaStore {
  async put(key: string, meta: FileMeta): Promise<void> {
    await put(key + SIDECAR_SUFFIX, JSON.stringify(meta), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
      allowOverwrite: true,
    });
  }

  // TODO: when sidecar reads become a hot path, migrate MetaStore to Vercel KV /
  // Upstash Redis. Today this does one list() call to recover the URL per get.
  async get(key: string): Promise<FileMeta | null> {
    const url = await findUrlForKey(key + SIDECAR_SUFFIX);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    try {
      return (await res.json()) as FileMeta;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const url = await findUrlForKey(key + SIDECAR_SUFFIX);
    if (!url) return;
    await del(url);
  }
}
