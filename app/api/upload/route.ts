import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/lib/config';
import {
  getCustomerCompany,
  getCustomerUploadDir,
  getRelativePath,
  isAllowedUpload,
  mimeTypeFor,
  sanitizeFilename,
  supportedUploadLabel,
} from '@/lib/customer-files';
import { appendFiles, type FileRef } from '@/lib/session';
import { computeFileMeta, writeSidecar } from '@/lib/file-meta';
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

  const company = getCustomerCompany();
  const baseDir = getCustomerUploadDir(company);
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    logFileEvent('upload', 'error', 'mkdir_failed', {
      sessionId,
      company,
      baseDir,
      code: e.code,
      message: e.message,
    });
    throw err;
  }

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
    const filename = `${ts}-${safe}`;
    const absPath = path.join(baseDir, filename);

    let buf: Buffer;
    try {
      buf = Buffer.from(await entry.arrayBuffer());
    } catch (err) {
      const e = err as Error;
      logFileEvent('upload', 'error', 'arraybuffer_failed', {
        sessionId,
        company,
        filename: entry.name,
        sizeBytes: entry.size,
        message: e.message,
      });
      throw err;
    }

    try {
      fs.writeFileSync(absPath, buf);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      logFileEvent('upload', 'error', 'writefile_failed', {
        sessionId,
        company,
        filename: entry.name,
        diskName: filename,
        sizeBytes: entry.size,
        code: e.code,
        message: e.message,
      });
      throw err;
    }

    try {
      const meta = await computeFileMeta(absPath, entry.name, ts);
      writeSidecar(absPath, meta);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      logFileEvent('upload', 'error', 'sidecar_failed', {
        sessionId,
        company,
        filename: entry.name,
        diskName: filename,
        sizeBytes: entry.size,
        code: e.code,
        message: e.message,
      });
      throw err;
    }

    saved.push({
      filename: entry.name,
      path: getRelativePath(absPath),
      mimeType: mimeTypeFor(entry.name, entry.type),
      sizeBytes: entry.size,
      company,
      companyPath: getRelativePath(baseDir),
    });
  }

  appendFiles(sessionId, saved);

  return NextResponse.json({ files: saved });
}
