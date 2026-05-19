import Anthropic from '@anthropic-ai/sdk';
import { config } from './config';
import type { ChatMessage, FileRef } from './session';
import { getObjectStore } from './storage';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type UserContentBlock =
  | Anthropic.Messages.TextBlockParam
  | Anthropic.Messages.ImageBlockParam
  | Anthropic.Messages.ToolResultBlockParam;

type AssistantContentBlock =
  | Anthropic.Messages.TextBlockParam
  | Anthropic.Messages.ToolUseBlockParam;

async function attachmentsToBlocks(files: FileRef[]): Promise<UserContentBlock[]> {
  const store = getObjectStore();
  const blocks: UserContentBlock[] = [];
  for (const f of files) {
    if (f.mimeType.startsWith('image/')) {
      try {
        const buf = await store.get(f.path);
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
            data: buf.toString('base64'),
          },
        });
      } catch {
        blocks.push({ type: 'text', text: `[客户上传文件（未找到）: ${f.filename}]` });
      }
    } else {
      const companyNote = f.companyPath ? `，公司资料文件夹：${f.companyPath}` : '';
      blocks.push({
        type: 'text',
        text: `[客户上传文件: ${f.filename}（${f.mimeType}，${(f.sizeBytes / 1024).toFixed(0)} KB${companyNote}）— 文件已落盘。客户明确要求资料检查时，应调用 review_customer_files 工具，不要仅凭文件名判断。]`,
      });
    }
  }
  return blocks;
}

async function chatMessagesToParams(messages: ChatMessage[]): Promise<Anthropic.Messages.MessageParam[]> {
  return Promise.all(
    messages.map(async (m) => {
      if (m.role === 'assistant') {
        return { role: 'assistant' as const, content: m.content };
      }
      const blocks: UserContentBlock[] = [];
      if (m.attachments?.length) {
        blocks.push(...(await attachmentsToBlocks(m.attachments)));
      }
      if (m.content) {
        blocks.push({ type: 'text', text: m.content });
      }
      if (blocks.length === 0) {
        blocks.push({ type: 'text', text: '(空消息)' });
      }
      return { role: 'user' as const, content: blocks };
    }),
  );
}

export interface ToolUseRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface StreamChatArgs {
  system: string;
  messages: ChatMessage[];
  tools?: Anthropic.Messages.Tool[];
  onText: (delta: string) => void;
  onToolUse?: (toolUse: ToolUseRecord) => Promise<string> | string;
  maxIterations?: number;
}

export async function streamChat(args: StreamChatArgs): Promise<{
  finalText: string;
  toolUses: ToolUseRecord[];
}> {
  const {
    system,
    messages,
    tools,
    onText,
    onToolUse,
    maxIterations = 4,
  } = args;

  const workingMessages: Anthropic.Messages.MessageParam[] = await chatMessagesToParams(messages);

  let aggregateText = '';
  const allToolUses: ToolUseRecord[] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    const stream = client.messages.stream({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system,
      messages: workingMessages,
      ...(tools && tools.length ? { tools } : {}),
    });

    const toolUsesThisTurn: Array<{
      id: string;
      name: string;
      jsonAcc: string;
    }> = [];
    const assistantBlocks: AssistantContentBlock[] = [];

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          toolUsesThisTurn.push({ id: block.id, name: block.name, jsonAcc: '' });
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          onText(delta.text);
        } else if (delta.type === 'input_json_delta') {
          const last = toolUsesThisTurn[toolUsesThisTurn.length - 1];
          if (last) last.jsonAcc += delta.partial_json;
        }
      }
    }

    const finalMessage = await stream.finalMessage();

    // Build assistant content blocks for the working history
    for (const block of finalMessage.content) {
      if (block.type === 'text') {
        assistantBlocks.push({ type: 'text', text: block.text });
        aggregateText += block.text;
      } else if (block.type === 'tool_use') {
        assistantBlocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
        allToolUses.push({
          id: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    if (finalMessage.stop_reason !== 'tool_use') {
      break;
    }

    // Tool use loop: run each tool, push results, continue
    workingMessages.push({ role: 'assistant', content: assistantBlocks });

    const toolResults: UserContentBlock[] = [];
    for (const block of finalMessage.content) {
      if (block.type !== 'tool_use') continue;
      let resultText = 'ok';
      if (onToolUse) {
        try {
          resultText = await onToolUse({
            id: block.id,
            name: block.name,
            input: (block.input as Record<string, unknown>) ?? {},
          });
        } catch (err) {
          resultText = `error: ${(err as Error).message}`;
        }
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: resultText,
      });
    }
    workingMessages.push({ role: 'user', content: toolResults });
  }

  return { finalText: aggregateText, toolUses: allToolUses };
}
