'use client';

import ReactMarkdown from 'react-markdown';
import type { UIMessage } from './ChatWindow';

export default function MessageBubble({
  message,
  isStreaming,
}: {
  message: UIMessage;
  isStreaming?: boolean;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} my-2`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-lily-600 text-white flex items-center justify-center text-sm font-semibold mr-2 shrink-0">
          L
        </div>
      )}
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 shadow-sm whitespace-pre-wrap break-words text-[15px] leading-relaxed ${
          isUser
            ? 'bg-lily-600 text-white rounded-br-sm'
            : message.error
              ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
              : 'bg-white text-gray-900 border border-gray-200 rounded-bl-sm'
        }`}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments.map((a, i) => (
              <AttachmentPreview key={i} filename={a.filename} mimeType={a.mimeType} />
            ))}
          </div>
        )}

        {message.content ? (
          isUser ? (
            <div>{message.content}</div>
          ) : (
            <div className="markdown-body">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )
        ) : isStreaming ? (
          <div className="py-1">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AttachmentPreview({ filename, mimeType }: { filename: string; mimeType: string }) {
  const isImage = mimeType.startsWith('image/');
  return (
    <div className="flex items-center gap-2 bg-black/10 rounded-md px-2 py-1 text-xs">
      <span>{isImage ? '🖼️' : '📄'}</span>
      <span className="max-w-[180px] truncate">{filename}</span>
    </div>
  );
}
