import path from 'node:path';
import { config } from './config';

export function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/[/\\:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'customer';
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, '_').slice(0, 120) || 'file';
}

export function getCustomerId(): string {
  return config.demoCustomer.id;
}

export function getCustomerDisplayName(): string {
  return config.demoCustomer.displayName;
}

// id is permanent — changing config.demoCustomer.id orphans every blob ever
// uploaded for this customer. To rename for UI purposes, change displayName instead.
export function getCustomerKeyPrefix(id = getCustomerId()): string {
  return `customers/${sanitizePathSegment(id)}`;
}

// Deprecated aliases — kept for one release while routes are migrated to the storage abstraction.
export const getCustomerCompany = getCustomerDisplayName;
export function getCustomerUploadDir(id = getCustomerId()): string {
  return path.resolve(config.upload.companyRootDir, sanitizePathSegment(id));
}

export function getRelativePath(absPath: string): string {
  return path.relative(process.cwd(), absPath);
}

export function getExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
  return ext;
}

export function isAllowedUpload(filename: string, mimeType: string): boolean {
  const ext = getExtension(filename);
  return (
    config.upload.allowedMimeTypes.includes(mimeType) ||
    Boolean(ext && config.upload.allowedExtensions.includes(ext))
  );
}

export function mimeTypeFor(filename: string, suppliedType: string): string {
  if (suppliedType) return suppliedType;
  switch (getExtension(filename)) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':
      return 'application/msword';
    case 'csv':
      return 'text/csv';
    case 'md':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

export function supportedUploadLabel(): string {
  return config.upload.allowedExtensions.join(' / ');
}
