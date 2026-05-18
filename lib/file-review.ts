import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { config } from './config';
import {
  getCustomerCompany,
  getCustomerUploadDir,
  getExtension,
  getRelativePath,
  mimeTypeFor,
} from './customer-files';

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

function readJpegSize(absPath: string): { width?: number; height?: number; note?: string } {
  const fd = fs.openSync(absPath, 'r');
  try {
    const marker = Buffer.alloc(2);
    fs.readSync(fd, marker, 0, 2, null);
    while (true) {
      const start = Buffer.alloc(1);
      if (fs.readSync(fd, start, 0, 1, null) !== 1) {
        return { note: 'image size unavailable: JPEG marker not found' };
      }
      if (start[0] !== 0xff) continue;

      const code = Buffer.alloc(1);
      fs.readSync(fd, code, 0, 1, null);
      while (code[0] === 0xff) {
        fs.readSync(fd, code, 0, 1, null);
      }
      if (code[0] >= 0xc0 && code[0] <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(code[0])) {
        const size = Buffer.alloc(7);
        fs.readSync(fd, size, 0, 7, null);
        return { width: size.readUInt16BE(5), height: size.readUInt16BE(3) };
      }
      if ([0xd8, 0xd9].includes(code[0])) continue;

      const len = Buffer.alloc(2);
      if (fs.readSync(fd, len, 0, 2, null) !== 2) {
        return { note: 'image size unavailable: JPEG segment truncated' };
      }
      fs.readSync(fd, Buffer.alloc(0), 0, 0, null);
      const segmentLength = len.readUInt16BE(0);
      fs.readSync(fd, Buffer.alloc(segmentLength - 2), 0, segmentLength - 2, null);
    }
  } finally {
    fs.closeSync(fd);
  }
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

export function detectImageSize(absPath: string): { width?: number; height?: number; note?: string } {
  try {
    const header = fs.readFileSync(absPath).subarray(0, 64);
    if (header.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) {
      return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
    }
    if (header.toString('ascii', 0, 6) === 'GIF87a' || header.toString('ascii', 0, 6) === 'GIF89a') {
      return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
    }
    if (header[0] === 0xff && header[1] === 0xd8) {
      return readJpegSize(absPath);
    }
    if (header.toString('ascii', 0, 4) === 'RIFF') {
      return readWebpSize(header);
    }
  } catch (err) {
    return { note: `image size unavailable: ${(err as Error).message}` };
  }
  return { note: 'image size unavailable: unknown image format' };
}

function readTextFile(absPath: string): ExtractResult {
  const text = fs.readFileSync(absPath, 'utf8');
  return { text };
}

function readSpreadsheet(absPath: string): ExtractResult {
  const workbook = XLSX.readFile(absPath, { cellDates: false });
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

async function readDocx(absPath: string): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ path: absPath });
  return {
    text: value,
    note: value.trim() ? undefined : 'Word document text extraction returned no text',
  };
}

async function readDoc(absPath: string): Promise<ExtractResult> {
  const WordExtractor = (await import('word-extractor')).default;
  const extractor = new WordExtractor();
  const doc = await extractor.extract(absPath);
  const text = doc.getBody();
  return {
    text,
    note: text.trim() ? undefined : 'Word document text extraction returned no text',
  };
}

async function readPdf(absPath: string): Promise<ExtractResult> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(absPath)) });
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

export async function extractFile(absPath: string, mimeType: string): Promise<ExtractResult> {
  const ext = getExtension(absPath);
  try {
    if (SPREADSHEET_EXTENSIONS.has(ext)) return readSpreadsheet(absPath);
    if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/')) return readTextFile(absPath);
    if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return await readDocx(absPath);
    }
    if (ext === 'doc' || mimeType === 'application/msword') return await readDoc(absPath);
    if (ext === 'pdf' || mimeType === 'application/pdf') return await readPdf(absPath);
    if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) {
      return { note: 'image content not OCR parsed; dimensions are listed in inventory' };
    }
    return { note: 'unsupported file content parser; mark content-dependent checks as 需确认' };
  } catch (err) {
    return { note: `content extraction failed: ${(err as Error).message}` };
  }
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.localeCompare(b));
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
  const company = getCustomerCompany();
  const companyDir = getCustomerUploadDir(company);
  const files = listFiles(companyDir).slice(0, config.fileReview.maxFilesPerReview);
  const omittedCount = Math.max(0, listFiles(companyDir).length - files.length);
  const inventory: InventoryItem[] = [];

  for (const absPath of files) {
    const stat = fs.statSync(absPath);
    const relative = getRelativePath(absPath);
    const mimeType = mimeTypeFor(absPath, '');
    const item: InventoryItem = {
      path: relative,
      type: mimeType,
      sizeBytes: stat.size,
    };

    if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(getExtension(absPath))) {
      const dimensions = detectImageSize(absPath);
      item.imageWidth = dimensions.width;
      item.imageHeight = dimensions.height;
      item.note = dimensions.note;
    }

    const extract = await extractFile(absPath, mimeType);
    item.extractedText = extract.text
      ? truncate(extract.text, config.fileReview.maxExtractCharsPerFile)
      : undefined;
    item.note = [item.note, extract.note].filter(Boolean).join('; ') || undefined;
    inventory.push(item);
  }

  const standards = readStandards(input.scope);
  const emptyDirective = files.length
    ? ''
    : '\n\n【空文件夹处理】当前公司文件夹没有可检查文件。请直接告诉客户暂未收到可检查资料，并请客户先上传资料；不要编造检查结论。';
  const omittedDirective = omittedCount
    ? `\n\n【文件数量限制】还有 ${omittedCount} 个文件未纳入本次上下文。请在报告中说明本次只检查了前 ${files.length} 个文件。`
    : '';

  return `【客户资料检查上下文】
客户公司：${company}
公司资料文件夹：${getRelativePath(companyDir)}
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
