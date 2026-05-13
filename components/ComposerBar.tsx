'use client';

import { useRef, useState } from 'react';

export interface PendingFile {
  file: File;
  preview?: string;
}

interface ComposerProps {
  onSend: (text: string, files: File[]) => Promise<void> | void;
  disabled?: boolean;
  allowedMimeTypes: string[];
  maxSizeMB: number;
}

export default function ComposerBar({ onSend, disabled, allowedMimeTypes, maxSizeMB }: ComposerProps) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validate = (file: File): string | null => {
    if (!allowedMimeTypes.includes(file.type)) {
      return `不支持的文件类型：${file.name}（${file.type || '未知'}）。仅支持 jpg / png / webp / pdf`;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `文件过大：${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB，超过 ${maxSizeMB} MB）`;
    }
    return null;
  };

  const handleFiles = (filesList: FileList | null) => {
    if (!filesList) return;
    const next: PendingFile[] = [];
    for (const file of Array.from(filesList)) {
      const err = validate(file);
      if (err) {
        setError(err);
        return;
      }
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      next.push({ file, preview });
    }
    setError(null);
    setPending((prev) => [...prev, ...next]);
  };

  const removeFile = (idx: number) => {
    setPending((prev) => {
      const copy = [...prev];
      const [removed] = copy.splice(idx, 1);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed && pending.length === 0) return;
    if (disabled) return;
    const files = pending.map((p) => p.file);
    pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    setPending([]);
    setText('');
    setError(null);
    await onSend(trimmed, files);
  };

  return (
    <div className="border-t border-gray-200 bg-white px-3 py-2.5">
      {error && (
        <div className="mb-2 px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded-md flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">×</button>
        </div>
      )}
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((p, i) => (
            <div key={i} className="flex items-center gap-2 bg-gray-100 rounded-md px-2 py-1 text-xs">
              {p.preview ? (
                <img src={p.preview} alt={p.file.name} className="w-8 h-8 object-cover rounded" />
              ) : (
                <span>📄</span>
              )}
              <span className="max-w-[160px] truncate">{p.file.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="text-gray-500 hover:text-red-600 ml-1"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="shrink-0 w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-lg disabled:opacity-50"
          title="上传图片或 PDF"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={allowedMimeTypes.join(',')}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={disabled ? 'Lily 正在回复…' : '输入消息，Enter 发送，Shift+Enter 换行'}
          className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:outline-none focus:border-lily-500 max-h-32"
          style={{ minHeight: '40px' }}
        />
        <button
          onClick={() => void submit()}
          disabled={disabled || (!text.trim() && pending.length === 0)}
          className="shrink-0 h-10 px-4 rounded-lg bg-lily-600 text-white font-medium hover:bg-lily-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          发送
        </button>
      </div>
    </div>
  );
}
