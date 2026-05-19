import type { FileMeta } from '../file-meta';

export interface StoredObject {
  key: string;
  url?: string;
  sizeBytes: number;
  uploadedAt: number;
}

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
  exists(key: string): Promise<boolean>;
}

// MetaStore has no list() by design — sidecars are always looked up alongside an
// ObjectStore key. The absence of list() is what makes a future swap to KV / Postgres
// drop-in: replace the adapter, leave the routes alone. Add list() only if a
// metadata-only enumeration use case appears.
export interface MetaStore {
  put(key: string, meta: FileMeta): Promise<void>;
  get(key: string): Promise<FileMeta | null>;
  delete(key: string): Promise<void>;
}
