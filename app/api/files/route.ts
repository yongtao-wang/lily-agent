import { NextRequest, NextResponse } from 'next/server';
import {
  getCustomerDisplayName,
  getCustomerKeyPrefix,
} from '@/lib/customer-files';
import {
  computeFileMeta,
  parseDiskFilename,
  type FileMeta,
} from '@/lib/file-meta';
import { getMetaStore, getObjectStore, getStorageBackend } from '@/lib/storage';
import { removeFiles } from '@/lib/session';
import { logFileEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FileRow extends FileMeta {
  filename: string; // disk-style basename (timestamp-prefixed)
  key: string; // canonical storage key
  url?: string; // blob URL when backend provides one
}

export async function GET() {
  const company = getCustomerDisplayName();
  const prefix = getCustomerKeyPrefix();
  const objectStore = getObjectStore();
  const metaStore = getMetaStore();

  let objects;
  try {
    objects = await objectStore.list(prefix);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    logFileEvent('files', 'error', 'list_failed', {
      caller: 'drawer',
      prefix,
      backend: getStorageBackend(),
      code: e.code,
      message: e.message,
    });
    return NextResponse.json({ files: [], company }, { status: 200 });
  }

  logFileEvent('files', 'warn', 'list_ok', {
    caller: 'drawer',
    prefix,
    backend: getStorageBackend(),
    count: objects.length,
  });

  const rows: FileRow[] = [];
  for (const obj of objects) {
    const diskName = obj.key.split('/').pop() ?? obj.key;
    let meta = await metaStore.get(obj.key);
    if (!meta) {
      const { uploadedAt, originalName } = parseDiskFilename(diskName);
      let buf: Buffer;
      try {
        buf = await objectStore.get(obj.key);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        logFileEvent('files', 'error', 'get_failed', {
          caller: 'drawer',
          key: obj.key,
          backend: getStorageBackend(),
          code: e.code,
          message: e.message,
        });
        continue;
      }
      try {
        meta = await computeFileMeta(buf, originalName, uploadedAt || obj.uploadedAt);
        await metaStore.put(obj.key, meta);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        logFileEvent('files', 'error', 'list_sidecar_synthesis_failed', {
          key: obj.key,
          diskName,
          filename: originalName,
          code: e.code,
          message: e.message,
        });
        continue;
      }
    }
    rows.push({ filename: diskName, key: obj.key, url: obj.url, ...meta });
  }

  rows.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return NextResponse.json({ files: rows, company });
}

interface DeleteBody {
  filenames?: unknown;
  sessionId?: unknown;
}

function isUnsafe(name: string): boolean {
  if (!name || typeof name !== 'string') return true;
  if (name.includes('/') || name.includes('\\')) return true;
  if (name.includes('..')) return true;
  if (name.startsWith('.')) return true;
  return false;
}

export async function DELETE(req: NextRequest) {
  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  const filenames = Array.isArray(body.filenames) ? body.filenames : [];
  if (filenames.length === 0) {
    return NextResponse.json({ error: 'filenames required' }, { status: 400 });
  }
  for (const name of filenames) {
    if (isUnsafe(String(name))) {
      logFileEvent('files', 'warn', 'delete_path_traversal', {
        sessionId,
        filename: String(name),
      });
      return NextResponse.json(
        { error: `unsafe filename: ${String(name)}` },
        { status: 400 },
      );
    }
  }

  const prefix = getCustomerKeyPrefix();
  const objectStore = getObjectStore();
  const metaStore = getMetaStore();

  const deleted: string[] = [];
  const errors: Array<{ filename: string; reason: string }> = [];

  for (const raw of filenames as string[]) {
    const key = `${prefix}/${raw}`;
    try {
      await objectStore.delete(key);
      await metaStore.delete(key);
      deleted.push(raw);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      logFileEvent('files', 'error', 'delete_failed', {
        sessionId,
        key,
        filename: raw,
        code: e.code,
        message: e.message,
      });
      errors.push({ filename: raw, reason: e.code ?? e.message });
    }
  }

  if (sessionId && deleted.length) {
    removeFiles(sessionId, deleted);
  }

  return NextResponse.json({ deleted, errors });
}
