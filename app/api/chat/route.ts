import { NextRequest } from 'next/server';
import { loadKnowledge } from '@/lib/knowledge';
import { buildSystemPrompt } from '@/lib/prompt';
import { streamChat } from '@/lib/claude';
import { escalationTool, notifyProjectManager } from '@/lib/escalation';
import {
  appendMessage,
  getOrCreateSession,
  getRecentMessages,
  markEscalated,
  setStage,
  type FileRef,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  sessionId: string;
  stageId?: string;
  userMessage: {
    content: string;
    attachments?: FileRef[];
  };
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { sessionId, stageId, userMessage } = body;
  if (!sessionId || !userMessage || typeof userMessage.content !== 'string') {
    return new Response('Bad request', { status: 400 });
  }

  const session = getOrCreateSession(sessionId);
  if (stageId !== undefined) {
    setStage(sessionId, stageId || undefined);
  }

  appendMessage(sessionId, {
    role: 'user',
    content: userMessage.content,
    attachments: userMessage.attachments,
    createdAt: Date.now(),
  });

  const kb = loadKnowledge();
  const systemPrompt = buildSystemPrompt({
    kb,
    stageId: session.stageId,
    escalated: session.escalated,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      let assistantText = '';
      try {
        const result = await streamChat({
          system: systemPrompt,
          messages: session.messages,
          tools: [escalationTool as never],
          onText: (delta) => {
            assistantText += delta;
            send({ type: 'text', delta });
          },
          onToolUse: async (toolUse) => {
            if (toolUse.name !== 'notify_project_manager') {
              return 'unknown tool';
            }
            const input = toolUse.input as {
              reason?: string;
              summary?: string;
              urgency?: string;
            };
            const recent = getRecentMessages(sessionId, 6);
            notifyProjectManager({
              sessionId,
              stageId: session.stageId,
              reason: input.reason ?? 'unknown',
              summary: input.summary ?? '',
              urgency: input.urgency ?? 'medium',
              recentMessages: recent,
              files: session.files,
            });
            markEscalated(sessionId);
            send({ type: 'escalated' });
            return '已通知项目经理，请继续以"已升级、等待 PM"的口径与客户对话。';
          },
        });

        assistantText = result.finalText;
        appendMessage(sessionId, {
          role: 'assistant',
          content: assistantText,
          createdAt: Date.now(),
        });

        send({ type: 'done' });
      } catch (err) {
        const message = (err as Error).message || 'unknown error';
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
