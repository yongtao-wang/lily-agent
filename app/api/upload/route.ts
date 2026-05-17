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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const sessionId = form.get('sessionId');
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const fileEntries = form.getAll('files');
  if (fileEntries.length === 0) {
    return NextResponse.json({ error: 'no files' }, { status: 400 });
  }

  const company = getCustomerCompany();
  const baseDir = getCustomerUploadDir(company);
  fs.mkdirSync(baseDir, { recursive: true });

  const maxBytes = config.upload.maxSizeMB * 1024 * 1024;
  const allowed = new Set(config.upload.allowedMimeTypes);
  const saved: FileRef[] = [];

  for (const entry of fileEntries) {
    if (!(entry instanceof File)) continue;
    if (!allowed.has(entry.type) && !isAllowedUpload(entry.name, entry.type)) {
      return NextResponse.json(
        { error: `不支持的文件类型：${entry.name} (${entry.type || '未知'})。仅支持 ${supportedUploadLabel()}` },
        { status: 415 },
      );
    }
    if (entry.size > maxBytes) {
      return NextResponse.json(
        { error: `文件过大：${entry.name}（${(entry.size / 1024 / 1024).toFixed(1)} MB，超过 ${config.upload.maxSizeMB} MB）` },
        { status: 413 },
      );
    }

    const safe = sanitizeFilename(entry.name);
    const ts = Date.now();
    const filename = `${ts}-${safe}`;
    const absPath = path.join(baseDir, filename);
    const buf = Buffer.from(await entry.arrayBuffer());
    fs.writeFileSync(absPath, buf);

    const meta = await computeFileMeta(absPath, entry.name, ts);
    writeSidecar(absPath, meta);

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
