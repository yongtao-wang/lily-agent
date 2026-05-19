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
  buf: Buffer,
  originalName: string,
  uploadedAt: number,
): Promise<FileMeta> {
  const ext = getExtension(originalName);
  const mimeType = mimeTypeFor(originalName, '');

  let imageWidth: number | null = null;
  let imageHeight: number | null = null;
  let imageNote: string | undefined;
  if (IMAGE_EXTENSIONS.has(ext)) {
    const dims = detectImageSize(buf);
    imageWidth = dims.width ?? null;
    imageHeight = dims.height ?? null;
    imageNote = dims.note;
  }

  const extract = await extractFile(buf, originalName, mimeType);
  const combinedNote = [imageNote, extract.note].filter(Boolean).join('; ') || undefined;
  const { status, note } = classify(ext, { text: extract.text, note: combinedNote });

  return {
    originalName,
    mimeType,
    sizeBytes: buf.byteLength,
    uploadedAt,
    status,
    note,
    imageWidth,
    imageHeight,
  };
}

export function parseDiskFilename(filename: string): { uploadedAt: number; originalName: string } {
  const match = /^(\d{10,16})-(.+)$/.exec(filename);
  if (match) {
    return { uploadedAt: Number(match[1]), originalName: match[2] };
  }
  return { uploadedAt: 0, originalName: filename };
}
