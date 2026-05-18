'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type FileStatus = 'ok' | 'image' | 'empty' | 'failed' | 'unsupported';

interface FileRow {
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
  status: FileStatus;
  note: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

interface FilesDrawerProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  version: number;
  onChanged: () => void;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatRelativeTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function typeIcon(mimeType: string, status: FileStatus): string {
  if (status === 'image' || mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf') return '📕';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return '📘';
  }
  if (mimeType.startsWith('text/')) return '📝';
  return '📄';
}

const STATUS_BADGE: Record<FileStatus, { label: string; className: string }> = {
  ok: { label: '可解析', className: 'bg-green-100 text-green-700 border-green-200' },
  image: { label: '图片', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  empty: { label: '无内容', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  failed: { label: '解析失败', className: 'bg-red-100 text-red-700 border-red-200' },
  unsupported: { label: '未支持', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

export default function FilesDrawer({
  open,
  onClose,
  sessionId,
  version,
  onChanged,
}: FilesDrawerProps) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyFilenames, setBusyFilenames] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/files', { cache: 'no-store' });
      if (!res.ok) throw new Error(`服务器错误 ${res.status}`);
      const data = (await res.json()) as { files: FileRow[] };
      setFiles(data.files);
    } catch (err) {
      setError((err as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchFiles();
      setSelected(new Set());
      setRowErrors({});
    }
  }, [open, version, fetchFiles]);

  const allSelected = useMemo(
    () => files.length > 0 && files.every((f) => selected.has(f.filename)),
    [files, selected],
  );

  const toggleOne = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(files.map((f) => f.filename)));
  };

  const exitMultiSelect = () => {
    setMultiSelect(false);
    setSelected(new Set());
  };

  const performDelete = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    setBusyFilenames((prev) => {
      const next = new Set(prev);
      filenames.forEach((f) => next.add(f));
      return next;
    });
    setRowErrors({});
    try {
      const res = await fetch('/api/files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames, sessionId }),
      });
      const data = (await res.json()) as {
        deleted?: string[];
        errors?: Array<{ filename: string; reason: string }>;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || `删除失败 (${res.status})`);
        return;
      }
      const deleted = new Set(data.deleted ?? []);
      setFiles((prev) => prev.filter((f) => !deleted.has(f.filename)));
      setSelected((prev) => {
        const next = new Set(prev);
        deleted.forEach((d) => next.delete(d));
        return next;
      });
      if (data.errors && data.errors.length) {
        const map: Record<string, string> = {};
        for (const e of data.errors) map[e.filename] = e.reason;
        setRowErrors(map);
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message || '删除失败');
    } finally {
      setBusyFilenames((prev) => {
        const next = new Set(prev);
        filenames.forEach((f) => next.delete(f));
        return next;
      });
    }
  };

  const handleDeleteOne = async (row: FileRow) => {
    const ok = window.confirm(`删除「${row.originalName}」？此操作不可撤销。`);
    if (!ok) return;
    await performDelete([row.filename]);
  };

  const handleBulkDelete = async () => {
    const list = Array.from(selected);
    if (list.length === 0) return;
    const ok = window.confirm(`删除选中的 ${list.length} 个文件？此操作不可撤销。`);
    if (!ok) return;
    await performDelete(list);
    if (selected.size === list.length) exitMultiSelect();
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-30 sm:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-full sm:w-96 bg-white shadow-2xl transform transition-transform duration-200 ease-out flex flex-col ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <header className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-gray-900">我上传的文件</div>
            <div className="text-xs text-gray-500 mt-0.5">
              共 {files.length} 个文件
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2"
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => void fetchFiles()}
            disabled={loading}
            className="text-gray-700 hover:text-brand-600 disabled:opacity-50"
          >
            {loading ? '加载中…' : '刷新'}
          </button>
          <div className="flex-1" />
          {!multiSelect ? (
            <button
              type="button"
              onClick={() => setMultiSelect(true)}
              disabled={files.length === 0}
              className="text-gray-700 hover:text-brand-600 disabled:opacity-50"
            >
              选择
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleAll}
                className="text-gray-700 hover:text-brand-600"
              >
                {allSelected ? '全不选' : '全选'}
              </button>
              <button
                type="button"
                onClick={exitMultiSelect}
                className="text-gray-500 hover:text-gray-700"
              >
                取消
              </button>
            </>
          )}
        </div>

        {error && (
          <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && files.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">加载中…</div>
          ) : files.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              还没有上传文件。
              <br />
              在下方对话框中可以附加 PDF / Word / xlsx / 图片等资料。
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {files.map((row) => {
                const badge = STATUS_BADGE[row.status];
                const busy = busyFilenames.has(row.filename);
                const isSelected = selected.has(row.filename);
                const rowError = rowErrors[row.filename];
                return (
                  <li
                    key={row.filename}
                    className={`px-4 py-3 flex items-start gap-3 ${
                      busy ? 'opacity-50' : ''
                    } ${isSelected ? 'bg-brand-50' : ''}`}
                  >
                    {multiSelect && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(row.filename)}
                        className="mt-1 accent-brand-600"
                      />
                    )}
                    <div className="text-xl leading-none mt-0.5">
                      {typeIcon(row.mimeType, row.status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 truncate" title={row.originalName}>
                        {row.originalName}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                        <span>{formatSize(row.sizeBytes)}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(row.uploadedAt)}</span>
                        {row.imageWidth && row.imageHeight && (
                          <>
                            <span>·</span>
                            <span>
                              {row.imageWidth} × {row.imageHeight}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          title={row.note ?? undefined}
                          className={`inline-block text-[11px] px-1.5 py-0.5 rounded border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        {row.note && row.status !== 'image' && (
                          <span className="text-[11px] text-gray-400 truncate" title={row.note}>
                            {row.note}
                          </span>
                        )}
                      </div>
                      {rowError && (
                        <div className="mt-1 text-[11px] text-red-600">删除失败：{rowError}</div>
                      )}
                    </div>
                    {!multiSelect && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteOne(row)}
                        disabled={busy}
                        className="text-gray-400 hover:text-red-600 text-lg leading-none p-1 disabled:opacity-50"
                        aria-label={`删除 ${row.originalName}`}
                        title="删除"
                      >
                        🗑
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {multiSelect && (
          <footer className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-3">
            <div className="text-sm text-gray-700">已选 {selected.size} 项</div>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void handleBulkDelete()}
              disabled={selected.size === 0}
              className="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white disabled:opacity-40 hover:bg-red-700"
            >
              删除选中 ({selected.size})
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
