import { del, get as getBlob, head, list, put } from '@vercel/blob';
import type { FileMeta } from '../file-meta';
import type { MetaStore, ObjectStore, StoredObject } from './types';

const SIDECAR_SUFFIX = '.meta.json';
// All blobs in this store are created with private access — the URL is a stable
// identifier but is not anonymously fetchable. Reads go through the SDK with the
// BLOB_READ_WRITE_TOKEN. Switching to a public store would require putting blobs
// with access: 'public' and is incompatible with private stores.
const BLOB_ACCESS = 'private' as const;

function parseUploadedAt(pathname: string): number {
  const filename = pathname.split('/').pop() ?? pathname;
  const match = /^(\d{10,16})-/.exec(filename);
  return match ? Number(match[1]) : 0;
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

export class VercelBlobObjectStore implements ObjectStore {
  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const blob = await put(key, body, {
      access: BLOB_ACCESS,
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
    const result = await getBlob(key, { access: BLOB_ACCESS });
    if (!result || !result.stream) {
      throw Object.assign(new Error(`blob not found: ${key}`), { code: 'ENOENT' });
    }
    return streamToBuffer(result.stream);
  }

  async delete(key: string): Promise<void> {
    await del(key);
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
    try {
      await head(key);
      return true;
    } catch {
      return false;
    }
  }
}

export class VercelBlobMetaStore implements MetaStore {
  async put(key: string, meta: FileMeta): Promise<void> {
    await put(key + SIDECAR_SUFFIX, JSON.stringify(meta), {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
      contentType: 'application/json',
      allowOverwrite: true,
    });
  }

  // TODO: when sidecar reads become a hot path, migrate MetaStore to Vercel KV /
  // Upstash Redis. Today this does one authenticated SDK fetch per get.
  async get(key: string): Promise<FileMeta | null> {
    try {
      const result = await getBlob(key + SIDECAR_SUFFIX, { access: BLOB_ACCESS });
      if (!result || !result.stream) return null;
      const buf = await streamToBuffer(result.stream);
      return JSON.parse(buf.toString('utf8')) as FileMeta;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await del(key + SIDECAR_SUFFIX);
    } catch {
      // swallow: sidecar may not exist; ObjectStore.delete is the source of truth
    }
  }
}
