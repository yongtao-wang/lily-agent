/**
 * Pluggable file + metadata storage layer.
 *
 * Backends are selected at startup by env var, with auto-detection:
 *   - STORAGE_BACKEND=vercel-blob | local-fs (explicit override)
 *   - Otherwise: vercel-blob when BLOB_READ_WRITE_TOKEN is present, else local-fs
 *
 * To add another backend (e.g. Cloudflare R2, AWS S3, Supabase Storage):
 *   1. Implement ObjectStore (+ MetaStore) in a new file under lib/storage/<name>.ts.
 *   2. Add the case in createStore() below.
 *   3. Add the matching STORAGE_BACKEND value to the type union.
 *
 * Sidecar metadata is currently stored in the same backend as the file content
 * (one blob/file per file + one blob/file per sidecar). For higher-throughput or
 * queryable metadata, MetaStore should be reimplemented against a KV store
 * (Vercel KV / Upstash Redis) or a SQL database — the MetaStore interface
 * intentionally has no list() so that swap is mechanical (replace one adapter,
 * no route changes required). See lib/storage/types.ts.
 */
import type { MetaStore, ObjectStore } from './types';
import { LocalFsMetaStore, LocalFsObjectStore } from './local-fs';
import { VercelBlobMetaStore, VercelBlobObjectStore } from './vercel-blob';

type Backend = 'vercel-blob' | 'local-fs';

function resolveBackend(): Backend {
  const explicit = process.env.STORAGE_BACKEND;
  if (explicit === 'vercel-blob' || explicit === 'local-fs') return explicit;
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'vercel-blob';
  return 'local-fs';
}

let objectStore: ObjectStore | null = null;
let metaStore: MetaStore | null = null;

function createStores(): { object: ObjectStore; meta: MetaStore } {
  const backend = resolveBackend();
  switch (backend) {
    case 'vercel-blob':
      return { object: new VercelBlobObjectStore(), meta: new VercelBlobMetaStore() };
    case 'local-fs':
      return { object: new LocalFsObjectStore(), meta: new LocalFsMetaStore() };
  }
}

export function getObjectStore(): ObjectStore {
  if (!objectStore) {
    const stores = createStores();
    objectStore = stores.object;
    metaStore = metaStore ?? stores.meta;
  }
  return objectStore;
}

export function getMetaStore(): MetaStore {
  if (!metaStore) {
    const stores = createStores();
    metaStore = stores.meta;
    objectStore = objectStore ?? stores.object;
  }
  return metaStore;
}

export function getStorageBackend(): Backend {
  return resolveBackend();
}
