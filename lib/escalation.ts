import fs from 'node:fs';
import path from 'node:path';
import { config, getStageLabel } from './config';
import type { ChatMessage, FileRef } from './session';

export const escalationTool = {
  name: 'notify_project_manager',
  description:
    '当判定无法独立解决客户问题时调用，会通知项目经理介入。调用后你仍可与客户继续对话，但不再尝试独立解决问题。',
  input_schema: {
    type: 'object' as const,
    properties: {
      reason: {
        type: 'string',
        enum: [
          'customer_dissatisfied',
          'out_of_scope',
          'commercial',
          'explicit_request',
          'unresolved_after_3_rounds',
        ],
        description: '触发升级的原因类别',
      },
      summary: {
        type: 'string',
        description: '用一段话总结：客户在问什么、目前进展、为何需要 PM 介入',
      },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
      },
    },
    required: ['reason', 'summary', 'urgency'],
  },
};

export interface EscalationInput {
  sessionId: string;
  stageId?: string;
  reason: string;
  summary: string;
  urgency: string;
  recentMessages: ChatMessage[];
  files: FileRef[];
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? line : prefix + line))
    .join('\n');
}

export function notifyProjectManager(input: EscalationInput): { ok: true } {
  const logPath = path.resolve(config.escalation.logPath);
  const dir = path.dirname(logPath);
  fs.mkdirSync(dir, { recursive: true });

  const stageName = getStageLabel(input.stageId);
  const stageLine = input.stageId
    ? `${stageName} (${input.stageId})`
    : '未明确';

  const recentLines = input.recentMessages
    .map((m) => {
      const role = m.role === 'user' ? 'user     ' : 'assistant';
      const content = (m.content || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return `  [${role}] ${content}`;
    })
    .join('\n') || '  （无）';

  const fileLines = input.files.length
    ? input.files.map((f) => `  - ${f.path}`).join('\n')
    : '  （无）';

  const summary = indent(input.summary.trim(), '            ');

  const block = [
    '═══════════════════════════════════════════════════════════════',
    `[${formatTimestamp(new Date())}] ESCALATION`,
    '─────────────────────────────────────────────────────────────',
    `Session:    ${input.sessionId}`,
    `Customer:   ${config.demoCustomer.displayName} / ${config.demoCustomer.contact}`,
    `Stage:      ${stageLine}`,
    `Reason:     ${input.reason}`,
    `Urgency:    ${input.urgency}`,
    `Summary:    ${summary}`,
    '',
    'Recent Messages (last 6):',
    recentLines,
    '',
    'Files in this session:',
    fileLines,
    '═══════════════════════════════════════════════════════════════',
    '',
    '',
  ].join('\n');

  fs.appendFileSync(logPath, block, 'utf8');
  return { ok: true };
}
