import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { config } from './config';
import {
  getCustomerDisplayName,
  getCustomerKeyPrefix,
  getExtension,
  mimeTypeFor,
} from './customer-files';
import { logFileEvent } from './log';
import { getObjectStore, getStorageBackend } from './storage';

export const fileReviewTool = {
  name: 'review_customer_files',
  description:
    '客户明确要求检查、分析、审核已上传资料是否符合建站资料标准时调用。只做资料标准检查，不用于普通问答或单纯上传确认。',
  input_schema: {
    type: 'object' as const,
    properties: {
      scope: {
        type: 'string',
        enum: [
          'overall',
          'preparation',
          'brand_assets',
          'homepage',
          'product_category',
          'product_detail',
          'about_us',
          'solutions',
          'case_library',
          'images',
        ],
        description: '客户要求检查的范围。没有明确限定时使用 overall。',
      },
      request: {
        type: 'string',
        description: '客户的原始检查请求或你对检查重点的简短概括。',
      },
    },
    required: ['scope', 'request'],
  },
};

interface InventoryItem {
  path: string;
  type: string;
  sizeBytes: number;
  imageWidth?: number;
  imageHeight?: number;
  note?: string;
  extractedText?: string;
}

export interface ExtractResult {
  text?: string;
  note?: string;
}

export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
export const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv']);
export const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls']);
export const WORD_EXTENSIONS = new Set(['docx', 'doc']);

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[已截断，原文 ${text.length} 字符]`;
}

function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function readJpegSize(buf: Buffer): { width?: number; height?: number; note?: string } {
  let offset = 2; // skip SOI marker 0xff 0xd8
  while (offset < buf.length) {
    while (offset < buf.length && buf[offset] !== 0xff) offset++;
    while (offset < buf.length && buf[offset] === 0xff) offset++;
    if (offset >= buf.length) return { note: 'image size unavailable: JPEG marker not found' };
    const code = buf[offset++];
    if (code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc) {
      if (offset + 7 > buf.length) return { note: 'image size unavailable: JPEG segment truncated' };
      return {
        width: buf.readUInt16BE(offset + 5),
        height: buf.readUInt16BE(offset + 3),
      };
    }
    if (code === 0xd8 || code === 0xd9) continue;
    if (offset + 2 > buf.length) return { note: 'image size unavailable: JPEG segment truncated' };
    const segLen = buf.readUInt16BE(offset);
    offset += segLen;
  }
  return { note: 'image size unavailable: JPEG marker not found' };
}

function readWebpSize(header: Buffer): { width?: number; height?: number; note?: string } {
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WEBP') {
    return { note: 'image size unavailable: invalid WebP header' };
  }
  const chunk = header.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && header.length >= 30) {
    return {
      width: 1 + header.readUIntLE(24, 3),
      height: 1 + header.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ' && header.length >= 30) {
    return {
      width: header.readUInt16LE(26) & 0x3fff,
      height: header.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && header.length >= 25) {
    const b0 = header[21];
    const b1 = header[22];
    const b2 = header[23];
    const b3 = header[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return { note: 'image size unavailable: unsupported WebP variant' };
}

export function detectImageSize(buf: Buffer): { width?: number; height?: number; note?: string } {
  try {
    const header = buf.subarray(0, 64);
    if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (header.toString('ascii', 0, 6) === 'GIF87a' || header.toString('ascii', 0, 6) === 'GIF89a') {
      return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
    }
    if (header[0] === 0xff && header[1] === 0xd8) {
      return readJpegSize(buf);
    }
    if (header.toString('ascii', 0, 4) === 'RIFF') {
      return readWebpSize(header);
    }
  } catch (err) {
    return { note: `image size unavailable: ${(err as Error).message}` };
  }
  return { note: 'image size unavailable: unknown image format' };
}

function readTextFile(buf: Buffer): ExtractResult {
  return { text: buf.toString('utf8') };
}

function readSpreadsheet(buf: Buffer): ExtractResult {
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 8)) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });
    const rendered = rows
      .slice(0, 80)
      .map((row) => row.map((cell) => String(cell).trim()).filter(Boolean).join(' | '))
      .filter(Boolean)
      .join('\n');
    if (rendered) {
      parts.push(`Sheet: ${sheetName}\n${rendered}`);
    }
  }
  return {
    text: parts.join('\n\n'),
    note: parts.length ? undefined : 'spreadsheet has no readable cells',
  };
}

async function readDocx(buf: Buffer): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return {
    text: value,
    note: value.trim() ? undefined : 'Word document text extraction returned no text',
  };
}

async function readDoc(buf: Buffer): Promise<ExtractResult> {
  const WordExtractor = (await import('word-extractor')).default;
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buf);
  const text = doc.getBody();
  return {
    text,
    note: text.trim() ? undefined : 'Word document text extraction returned no text',
  };
}

async function readPdf(buf: Buffer): Promise<ExtractResult> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return {
      text: result.text,
      note: result.text.trim() ? undefined : 'PDF text extraction returned no text',
    };
  } finally {
    await parser.destroy();
  }
}

export async function extractFile(buf: Buffer, filename: string, mimeType: string): Promise<ExtractResult> {
  const ext = getExtension(filename);
  try {
    if (SPREADSHEET_EXTENSIONS.has(ext)) return readSpreadsheet(buf);
    if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/')) return readTextFile(buf);
    if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return await readDocx(buf);
    }
    if (ext === 'doc' || mimeType === 'application/msword') return await readDoc(buf);
    if (ext === 'pdf' || mimeType === 'application/pdf') return await readPdf(buf);
    if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) {
      return { note: 'image content not OCR parsed; dimensions are listed in inventory' };
    }
    return { note: 'unsupported file content parser; mark content-dependent checks as 需确认' };
  } catch (err) {
    return { note: `content extraction failed: ${(err as Error).message}` };
  }
}

function referencesForScope(scope: string): string[] {
  const base = ['00-start-here.md', '01-preparation-rules.md'];
  const scoped: Record<string, string[]> = {
    preparation: ['01-preparation-rules.md'],
    brand_assets: ['03-brand-assets.md'],
    homepage: ['04-homepage.md'],
    product_category: ['05-product-category.md'],
    product_detail: ['06-product-detail.md'],
    about_us: ['07-about-us.md'],
    solutions: ['08-solutions.md'],
    case_library: ['09-case-library.md'],
    images: ['01-preparation-rules.md', '03-brand-assets.md', '04-homepage.md', '06-product-detail.md'],
    overall: [
      '00-start-here.md',
      '01-preparation-rules.md',
      '03-brand-assets.md',
      '04-homepage.md',
      '05-product-category.md',
      '06-product-detail.md',
      '07-about-us.md',
      '08-solutions.md',
      '09-case-library.md',
    ],
  };
  return Array.from(new Set(scope === 'overall' ? scoped.overall : [...base, ...(scoped[scope] ?? scoped.overall)]));
}

function readStandards(scope: string): string {
  const standardsDir = path.resolve(config.fileReview.standardsDir);
  const fixedFiles = ['workflow.md', 'status-definitions.md', 'report-template.md'];
  const blocks = fixedFiles.map((filename) => {
    const abs = path.join(standardsDir, filename);
    return `## ${filename}\n${fs.readFileSync(abs, 'utf8')}`;
  });
  for (const filename of referencesForScope(scope)) {
    const abs = path.join(standardsDir, 'references', filename);
    blocks.push(`## references/${filename}\n${fs.readFileSync(abs, 'utf8')}`);
  }
  return blocks.join('\n\n---\n\n');
}

function formatInventory(items: InventoryItem[]): string {
  if (!items.length) return '（无文件）';
  return [
    '| Path | Type | Size | Image dimensions | Note |',
    '|---|---|---:|---|---|',
    ...items.map((item) => {
      const dimensions =
        item.imageWidth !== undefined && item.imageHeight !== undefined
          ? `${item.imageWidth}x${item.imageHeight}`
          : '';
      return `| \`${item.path}\` | ${item.type} | ${fileSizeLabel(item.sizeBytes)} | ${dimensions} | ${item.note ?? ''} |`;
    }),
  ].join('\n');
}

function formatExtracts(items: InventoryItem[]): string {
  const blocks = items.map((item) => {
    const text = item.extractedText?.trim();
    const note = item.note ? `\nNote: ${item.note}` : '';
    if (!text) {
      return `### ${item.path}${note || '\nNote: no readable text extracted'}`;
    }
    return `### ${item.path}${note}\n${text}`;
  });
  return blocks.length ? blocks.join('\n\n') : '（无可提取内容）';
}

export interface BuildFileReviewContextInput {
  scope: string;
  request: string;
}

export async function buildFileReviewContext(input: BuildFileReviewContextInput): Promise<string> {
  const companyName = getCustomerDisplayName();
  const prefix = getCustomerKeyPrefix();
  const store = getObjectStore();
  const backend = getStorageBackend();
  let allObjects;
  try {
    allObjects = await store.list(prefix);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    logFileEvent('files', 'error', 'list_failed', {
      caller: 'review',
      prefix,
      backend,
      scope: input.scope,
      code: e.code,
      message: e.message,
    });
    throw err;
  }
  logFileEvent('files', 'warn', 'list_ok', {
    caller: 'review',
    prefix,
    backend,
    count: allObjects.length,
    scope: input.scope,
  });
  const objects = allObjects.slice(0, config.fileReview.maxFilesPerReview);
  const omittedCount = Math.max(0, allObjects.length - objects.length);
  const inventory: InventoryItem[] = [];

  for (const obj of objects) {
    const filename = obj.key.split('/').pop() ?? obj.key;
    const mimeType = mimeTypeFor(filename, '');
    // Citation prefers blob URL when present (vercel-blob backend), falls back to key (local-fs).
    const citation = obj.url ?? obj.key;
    const item: InventoryItem = {
      path: citation,
      type: mimeType,
      sizeBytes: obj.sizeBytes,
    };

    let buf: Buffer;
    try {
      buf = await store.get(obj.key);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      logFileEvent('files', 'error', 'get_failed', {
        caller: 'review',
        key: obj.key,
        backend,
        code: e.code,
        message: e.message,
      });
      item.note = `content extraction failed: ${e.message}`;
      inventory.push(item);
      continue;
    }

    if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(getExtension(filename))) {
      const dimensions = detectImageSize(buf);
      item.imageWidth = dimensions.width;
      item.imageHeight = dimensions.height;
      item.note = dimensions.note;
    }

    const extract = await extractFile(buf, filename, mimeType);
    item.extractedText = extract.text
      ? truncate(extract.text, config.fileReview.maxExtractCharsPerFile)
      : undefined;
    item.note = [item.note, extract.note].filter(Boolean).join('; ') || undefined;
    inventory.push(item);
  }

  const standards = readStandards(input.scope);
  const emptyDirective = objects.length
    ? ''
    : '\n\n【空文件夹处理】当前公司文件夹没有可检查文件。请直接告诉客户暂未收到可检查资料，并请客户先上传资料；不要编造检查结论。';
  const omittedDirective = omittedCount
    ? `\n\n【文件数量限制】还有 ${omittedCount} 个文件未纳入本次上下文。请在报告中说明本次只检查了前 ${objects.length} 个文件。`
    : '';

  return `【客户资料检查上下文】
客户公司：${companyName}
公司资料目录前缀：${prefix}
客户请求：${input.request}
检查范围：${input.scope}

${emptyDirective}${omittedDirective}

【输出要求】
- 用客户可读的中英双语报告格式输出。
- 只使用这些状态：符合、缺失、需确认、可优化。
- 每个结论必须引用证据：优先使用【文件清单】中的精确文件路径；缺失项引用公司资料文件夹路径并说明"未发现"；可读内容引用具体文件路径和字段/短句。
- 如果证据不足、文件无法读取、图片内容无法 OCR 判断，标记为 需确认。
- 只有当文件 Note 明确写有 content extraction failed 或 no readable text extracted 时，才说文件不可读；否则按【可读内容提取】中的文本判断。
- 不要暴露工具实现细节、脚本路径或源 PDF 路径。

【文件清单】
${formatInventory(inventory)}

【可读内容提取】
${formatExtracts(inventory)}

【资料标准】
${standards}`;
}
