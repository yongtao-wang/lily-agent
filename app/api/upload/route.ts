import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/lib/config';
import { appendFiles, type FileRef } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, '_').slice(0, 120);
}

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

  const baseDir = path.resolve(config.upload.uploadDir, sessionId);
  fs.mkdirSync(baseDir, { recursive: true });

  const maxBytes = config.upload.maxSizeMB * 1024 * 1024;
  const allowed = new Set(config.upload.allowedMimeTypes);
  const saved: FileRef[] = [];

  for (const entry of fileEntries) {
    if (!(entry instanceof File)) continue;
    if (!allowed.has(entry.type)) {
      return NextResponse.json(
        { error: `不支持的文件类型：${entry.name} (${entry.type || '未知'})` },
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

    saved.push({
      filename: entry.name,
      path: path.relative(process.cwd(), absPath),
      mimeType: entry.type,
      sizeBytes: entry.size,
    });
  }

  appendFiles(sessionId, saved);

  return NextResponse.json({ files: saved });
}
