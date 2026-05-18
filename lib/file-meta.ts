import fs from 'node:fs';
import path from 'node:path';
import {
  detectImageSize,
  extractFile,
  IMAGE_EXTENSIONS,
} from './file-review';
import { getExtension, mimeTypeFor } from './customer-files';

export type FileStatus = 'ok' | 'image' | 'empty' | 'failed' | 'unsupported';

export interface FileMeta {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
  status: FileStatus;
  note: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

function sidecarPath(absPath: string): string {
  return `${absPath}.meta.json`;
}

function classify(
  ext: string,
  extract: { text?: string; note?: string },
): { status: FileStatus; note: string | null } {
  const note = extract.note ?? null;
  if (IMAGE_EXTENSIONS.has(ext)) {
    if (note && note.startsWith('image size unavailable')) {
      return { status: 'failed', note };
    }
    return { status: 'image', note };
  }
  if (note) {
    if (note.startsWith('content extraction failed')) return { status: 'failed', note };
    if (note.startsWith('unsupported file content parser')) return { status: 'unsupported', note };
    if (
      note.startsWith('spreadsheet has no readable cells') ||
      note.startsWith('PDF text extraction returned no text') ||
      note.startsWith('Word document text extraction returned no text')
    ) {
      return { status: 'empty', note };
    }
  }
  const text = extract.text ?? '';
  if (!text.trim()) return { status: 'empty', note };
  return { status: 'ok', note };
}

export async function computeFileMeta(
  absPath: string,
  originalName: string,
  uploadedAt: number,
): Promise<FileMeta> {
  const stat = fs.statSync(absPath);
  const ext = getExtension(absPath);
  const mimeType = mimeTypeFor(originalName, '');

  let imageWidth: number | null = null;
  let imageHeight: number | null = null;
  let imageNote: string | undefined;
  if (IMAGE_EXTENSIONS.has(ext)) {
    const dims = detectImageSize(absPath);
    imageWidth = dims.width ?? null;
    imageHeight = dims.height ?? null;
    imageNote = dims.note;
  }

  const extract = await extractFile(absPath, mimeType);
  const combinedNote = [imageNote, extract.note].filter(Boolean).join('; ') || undefined;
  const { status, note } = classify(ext, { text: extract.text, note: combinedNote });

  return {
    originalName,
    mimeType,
    sizeBytes: stat.size,
    uploadedAt,
    status,
    note,
    imageWidth,
    imageHeight,
  };
}

export function writeSidecar(absPath: string, meta: FileMeta): void {
  fs.writeFileSync(sidecarPath(absPath), JSON.stringify(meta, null, 2), 'utf8');
}

export function readSidecar(absPath: string): FileMeta | null {
  const sp = sidecarPath(absPath);
  if (!fs.existsSync(sp)) return null;
  try {
    return JSON.parse(fs.readFileSync(sp, 'utf8')) as FileMeta;
  } catch {
    return null;
  }
}

export function deleteSidecar(absPath: string): void {
  const sp = sidecarPath(absPath);
  try {
    fs.unlinkSync(sp);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export function isSidecar(filename: string): boolean {
  return filename.endsWith('.meta.json');
}

export function parseDiskFilename(filename: string): { uploadedAt: number; originalName: string } {
  const match = /^(\d{10,16})-(.+)$/.exec(filename);
  if (match) {
    return { uploadedAt: Number(match[1]), originalName: match[2] };
  }
  return { uploadedAt: 0, originalName: filename };
}

export function sidecarFilePath(absPath: string): string {
  return sidecarPath(absPath);
}
