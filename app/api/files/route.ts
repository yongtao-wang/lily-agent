import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import {
  getCustomerCompany,
  getCustomerUploadDir,
} from '@/lib/customer-files';
import {
  computeFileMeta,
  isSidecar,
  parseDiskFilename,
  readSidecar,
  writeSidecar,
  deleteSidecar,
  type FileMeta,
} from '@/lib/file-meta';
import { removeFiles } from '@/lib/session';
import { logFileEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FileRow extends FileMeta {
  filename: string;
}

export async function GET() {
  const company = getCustomerCompany();
  const baseDir = getCustomerUploadDir(company);
  if (!fs.existsSync(baseDir)) {
    return NextResponse.json({ files: [], company });
  }

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const rows: FileRow[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    if (isSidecar(entry.name)) continue;

    const absPath = path.join(baseDir, entry.name);
    let meta = readSidecar(absPath);
    if (!meta) {
      const { uploadedAt, originalName } = parseDiskFilename(entry.name);
      const stat = fs.statSync(absPath);
      try {
        meta = await computeFileMeta(
          absPath,
          originalName,
          uploadedAt || stat.mtimeMs,
        );
        writeSidecar(absPath, meta);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        logFileEvent('files', 'error', 'list_sidecar_synthesis_failed', {
          company,
          diskName: entry.name,
          filename: originalName,
          code: e.code,
          message: e.message,
        });
        continue;
      }
    }
    rows.push({ filename: entry.name, ...meta });
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

  const company = getCustomerCompany();
  const baseDir = getCustomerUploadDir(company);
  const baseResolved = path.resolve(baseDir) + path.sep;

  const deleted: string[] = [];
  const errors: Array<{ filename: string; reason: string }> = [];

  for (const raw of filenames as string[]) {
    const absPath = path.resolve(baseDir, raw);
    if (!(absPath + path.sep).startsWith(baseResolved) && absPath !== path.resolve(baseDir)) {
      logFileEvent('files', 'warn', 'delete_path_traversal', {
        sessionId,
        filename: raw,
        message: 'path escapes company folder',
      });
      errors.push({ filename: raw, reason: 'path escapes company folder' });
      continue;
    }
    try {
      fs.unlinkSync(absPath);
      deleteSidecar(absPath);
      deleted.push(raw);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      logFileEvent('files', 'error', 'delete_failed', {
        sessionId,
        company,
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
