import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import {
  getCustomerDisplayName,
  getCustomerId,
  getCustomerKeyPrefix,
  isAllowedUpload,
  mimeTypeFor,
  sanitizeFilename,
  supportedUploadLabel,
} from '@/lib/customer-files';
import { appendFiles, type FileRef } from '@/lib/session';
import { computeFileMeta } from '@/lib/file-meta';
import { getMetaStore, getObjectStore } from '@/lib/storage';
import { logFileEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    const e = err as Error;
    logFileEvent('upload', 'warn', 'form_parse_failed', { message: e.message });
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const sessionId = form.get('sessionId');
  if (typeof sessionId !== 'string' || !sessionId) {
    logFileEvent('upload', 'warn', 'session_id_missing');
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const fileEntries = form.getAll('files');
  if (fileEntries.length === 0) {
    logFileEvent('upload', 'warn', 'no_files', { sessionId });
    return NextResponse.json({ error: 'no files' }, { status: 400 });
  }

  const customerId = getCustomerId();
  const displayName = getCustomerDisplayName();
  const prefix = getCustomerKeyPrefix(customerId);
  const objectStore = getObjectStore();
  const metaStore = getMetaStore();

  const maxBytes = config.upload.maxSizeMB * 1024 * 1024;
  const allowed = new Set(config.upload.allowedMimeTypes);
  const saved: FileRef[] = [];

  for (const entry of fileEntries) {
    if (!(entry instanceof File)) continue;
    if (!allowed.has(entry.type) && !isAllowedUpload(entry.name, entry.type)) {
      logFileEvent('upload', 'warn', 'unsupported_type', {
        sessionId,
        filename: entry.name,
        mimeType: entry.type || null,
        sizeBytes: entry.size,
      });
      return NextResponse.json(
        { error: `不支持的文件类型：${entry.name} (${entry.type || '未知'})。仅支持 ${supportedUploadLabel()}` },
        { status: 415 },
      );
    }
    if (entry.size > maxBytes) {
      logFileEvent('upload', 'warn', 'oversize', {
        sessionId,
        filename: entry.name,
        mimeType: entry.type || null,
        sizeBytes: entry.size,
        maxSizeMB: config.upload.maxSizeMB,
      });
      return NextResponse.json(
        { error: `文件过大：${entry.name}（${(entry.size / 1024 / 1024).toFixed(1)} MB，超过 ${config.upload.maxSizeMB} MB）` },
        { status: 413 },
      );
    }

    const safe = sanitizeFilename(entry.name);
    const ts = Date.now();
    const diskName = `${ts}-${safe}`;
    const key = `${prefix}/${diskName}`;
    const contentType = mimeTypeFor(entry.name, entry.type);

    let buf: Buffer;
    try {
      buf = Buffer.from(await entry.arrayBuffer());
    } catch (err) {
      const e = err as Error;
      logFileEvent('upload', 'error', 'arraybuffer_failed', {
        sessionId,
        customerId,
        filename: entry.name,
        sizeBytes: entry.size,
        message: e.message,
      });
      throw err;
    }

    let stored;
    try {
      stored = await objectStore.put(key, buf, contentType);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      logFileEvent('upload', 'error', 'put_failed', {
        sessionId,
        customerId,
        filename: entry.name,
        diskName,
        sizeBytes: entry.size,
        code: e.code,
        message: e.message,
      });
      throw err;
    }

    try {
      const meta = await computeFileMeta(buf, entry.name, ts);
      await metaStore.put(key, meta);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      logFileEvent('upload', 'error', 'meta_put_failed', {
        sessionId,
        customerId,
        filename: entry.name,
        diskName,
        sizeBytes: entry.size,
        code: e.code,
        message: e.message,
      });
      throw err;
    }

    saved.push({
      filename: entry.name,
      path: stored.key,
      url: stored.url,
      mimeType: contentType,
      sizeBytes: entry.size,
      company: displayName,
      companyPath: prefix,
    });
  }

  appendFiles(sessionId, saved);

  return NextResponse.json({ files: saved });
}
