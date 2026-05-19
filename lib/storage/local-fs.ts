import fs from 'node:fs';
import path from 'node:path';
import type { FileMeta } from '../file-meta';
import type { MetaStore, ObjectStore, StoredObject } from './types';

const SIDECAR_SUFFIX = '.meta.json';

function keyToPath(key: string): string {
  return path.resolve(process.cwd(), 'uploads', key);
}

function parseUploadedAt(filename: string): number {
  const match = /^(\d{10,16})-/.exec(filename);
  return match ? Number(match[1]) : 0;
}

export class LocalFsObjectStore implements ObjectStore {
  async put(key: string, body: Buffer): Promise<StoredObject> {
    const absPath = keyToPath(key);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, body);
    return {
      key,
      sizeBytes: body.byteLength,
      uploadedAt: parseUploadedAt(path.basename(key)) || Date.now(),
    };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFileSync(keyToPath(key));
  }

  async delete(key: string): Promise<void> {
    try {
      fs.unlinkSync(keyToPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const absDir = keyToPath(prefix);
    if (!fs.existsSync(absDir)) return [];
    const out: StoredObject[] = [];
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name.endsWith(SIDECAR_SUFFIX)) continue;
      const absPath = path.join(absDir, entry.name);
      const stat = fs.statSync(absPath);
      const key = `${prefix}/${entry.name}`;
      out.push({
        key,
        sizeBytes: stat.size,
        uploadedAt: parseUploadedAt(entry.name) || stat.mtimeMs,
      });
    }
    return out;
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(keyToPath(key));
  }
}

export class LocalFsMetaStore implements MetaStore {
  async put(key: string, meta: FileMeta): Promise<void> {
    const sidecarPath = keyToPath(key) + SIDECAR_SUFFIX;
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, JSON.stringify(meta, null, 2), 'utf8');
  }

  async get(key: string): Promise<FileMeta | null> {
    const sidecarPath = keyToPath(key) + SIDECAR_SUFFIX;
    if (!fs.existsSync(sidecarPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as FileMeta;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const sidecarPath = keyToPath(key) + SIDECAR_SUFFIX;
    try {
      fs.unlinkSync(sidecarPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
