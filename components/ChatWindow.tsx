'use client';

import { useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';
import ComposerBar from './ComposerBar';
import StageSelector from './StageSelector';

export interface AttachmentRef {
  filename: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: AttachmentRef[];
  error?: boolean;
}

interface ChatWindowProps {
  initialSessionId: string;
  stages: Array<{ id: string; label: string }>;
  customerCompany: string;
}

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE_MB = 20;

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function ChatWindow({
  initialSessionId,
  stages,
  customerCompany,
}: ChatWindowProps) {
  const [sessionId] = useState(initialSessionId);
  const [messages, setMessages] = useState<UIMessage[]>(() => [
    {
      id: uid(),
      role: 'assistant',
      content: `您好，我是 Lily，您在 **${customerCompany}** 项目的 AI 增长助手。\n\n我可以基于您当前的项目阶段，为您解答交付过程中的常见问题。请问您目前在哪个阶段？您可以选择下方按钮，或直接告诉我。`,
    },
  ]);
  const [hasChosenStage, setHasChosenStage] = useState(false);
  const [stageId, setStageId] = useState<string | undefined>(undefined);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const callChat = async (
    userContent: string,
    attachments: AttachmentRef[] | undefined,
    overrideStageId: string | undefined,
  ) => {
    const assistantId = uid();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);
    setStreamingMsgId(assistantId);
    setIsStreaming(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          stageId: overrideStageId,
          userMessage: {
            content: userContent,
            attachments,
          },
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`服务器错误 ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let aggregated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const json = trimmed.slice(5).trim();
          if (!json) continue;
          try {
            const evt = JSON.parse(json) as
              | { type: 'text'; delta: string }
              | { type: 'done' }
              | { type: 'escalated' }
              | { type: 'error'; message: string };
            if (evt.type === 'text') {
              aggregated += evt.delta;
              const snapshot = aggregated;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: snapshot } : m)),
              );
            } else if (evt.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `出错了：${evt.message}`, error: true }
                    : m,
                ),
              );
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      const message = (err as Error).message || '请求失败';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `出错了：${message}`, error: true }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
      setStreamingMsgId(null);
    }
  };

  const handleStageSelect = async (id: string | null, label: string) => {
    if (hasChosenStage || isStreaming) return;
    setHasChosenStage(true);
    const newStageId = id ?? undefined;
    setStageId(newStageId);
    const userText = id ? `我现在在「${label}」阶段。` : '暂不指定阶段，我直接描述问题。';
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: userText }]);
    await callChat(userText, undefined, newStageId);
  };

  const handleSend = async (text: string, files: File[]) => {
    if (isStreaming) return;

    let attachments: AttachmentRef[] | undefined;
    if (files.length > 0) {
      const form = new FormData();
      form.append('sessionId', sessionId);
      for (const f of files) form.append('files', f);
      try {
        const upRes = await fetch('/api/upload', { method: 'POST', body: form });
        const data = await upRes.json();
        if (!upRes.ok) {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'assistant', content: `文件上传失败：${data.error ?? upRes.status}`, error: true },
          ]);
          return;
        }
        attachments = data.files as AttachmentRef[];
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', content: `文件上传失败：${(err as Error).message}`, error: true },
        ]);
        return;
      }
    }

    const userContent = text || (attachments && attachments.length ? '（已上传文件）' : '');
    if (!userContent && !attachments) return;
    if (!hasChosenStage) setHasChosenStage(true);

    setMessages((prev) => [
      ...prev,
      { id: uid(), role: 'user', content: userContent, attachments },
    ]);
    await callChat(userContent, attachments, stageId);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          {messages.map((m, idx) => (
            <div key={m.id}>
              <MessageBubble
                message={m}
                isStreaming={m.id === streamingMsgId && isStreaming}
              />
              {idx === 0 && !hasChosenStage && (
                <StageSelector
                  stages={stages}
                  onSelect={handleStageSelect}
                  disabled={isStreaming}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="max-w-3xl w-full mx-auto">
        <ComposerBar
          onSend={handleSend}
          disabled={isStreaming}
          allowedMimeTypes={ALLOWED_MIME}
          maxSizeMB={MAX_SIZE_MB}
        />
      </div>
    </div>
  );
}
