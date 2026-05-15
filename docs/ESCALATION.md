# Escalation

**TL;DR.** When 小鹏 decides she can't handle an issue, she calls a `notify_project_manager` tool. The server runs `notifyProjectManager()` in `lib/escalation.ts`, which appends a structured block to `./logs/escalations.log`. The session is flagged `escalated=true` so subsequent system prompts include a "you're already escalated, stop trying to solve" directive. This is the V1 path; V2 swaps the log write for a real webhook (WeChat Work / Slack / email). All upstream pieces (tool schema, prompt rule, session flag) stay the same across that swap.

---

## 1. The tool definition

From `lib/escalation.ts`:

```ts
export const escalationTool = {
  name: 'notify_project_manager',
  description:
    '当判定无法独立解决客户问题时调用，会通知项目经理介入。调用后你仍可与客户继续对话，' +
    '但不再尝试独立解决问题。',
  input_schema: {
    type: 'object',
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
      urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    required: ['reason', 'summary', 'urgency'],
  },
};
```

Three constraints baked in:

- **`reason` is an enum, not free text.** The five values are stable for downstream filtering / routing. If you add a value, also update `docs/PROMPT_DESIGN.md` §6 and rule #4 wording in `lib/prompt.ts`.
- **`summary` is required.** 小鹏 must write a paragraph explaining context. Without it the log is useless.
- **`urgency` is Claude's judgment.** Three levels; observed in the wild: `medium` for explicit requests, `high` for sustained dissatisfaction.

---

## 2. Round-trip flow

```
Claude       route.ts                escalation.ts            log file
  │             │                        │                      │
  │── tool_use ▶│                        │                      │
  │ {reason,    │                        │                      │
  │  summary,   │── notifyProjectManager ▶                      │
  │  urgency}   │   ({sessionId,         │── fs.appendFileSync ▶│
  │             │     stageId, ...})     │   (structured block) │
  │             │◀────── { ok: true } ───│                      │
  │             │ markEscalated(...)     │                      │
  │             │ send {type:"escalated"}│                      │ ──▶ client SSE
  │             │                        │                      │
  │◀── tool_result ───────────────────────────────────────────────
  │   "已通知项目经理，请继续以"已升级、等待 PM"的口径与客户对话。"
  │
  │── text deltas ▶                                              │ ──▶ client SSE
  │ (handoff message in 小鹏's voice)                            │
  │                                                              │
```

What the client sees: only `text` deltas (and one `escalated` marker event). The raw `tool_use` block is intentionally hidden — the customer should never see "tool: notify_project_manager, reason: customer_dissatisfied". The customer sees a natural-language handoff message.

Spec §9 mandates this hide-the-tool-use behavior.

---

## 3. Log format

Each escalation appends one block to `./logs/escalations.log`. Real example from the verification tests:

```
═══════════════════════════════════════════════════════════════
[2026-05-11 23:54:13] ESCALATION
─────────────────────────────────────────────────────────────
Session:    sess-esc
Customer:   东永盛 / 王总
Stage:      首页设计 (homepage)
Reason:     customer_dissatisfied
Urgency:    high
Summary:    客户王总（东永盛）对首页设计稿持续不满，反馈颜色暗沉、整体杂乱、配色不对，
            经多轮沟通后情绪升级，表示"根本做不好"，需要PM介入安抚并推进设计方向确认。

Recent Messages (last 6):
  [user     ] 颜色太暗沉了，不行
  [assistant] 收到您的反馈。 关于颜色风格，我们可以针对性调整。请问您倾向于哪个方向？...
  [user     ] 我觉得整体很杂乱，配色也不对
  [assistant] 理解您的感受。 为了让设计师能精准调整，麻烦您帮我确认几点：...
  [user     ] 还是不行，你们这个根本做不好

Files in this session:
  （无）
═══════════════════════════════════════════════════════════════

```

Field-by-field:

| Field | Source | Notes |
|---|---|---|
| Timestamp | `formatTimestamp(new Date())` in escalation.ts | Local time, second precision |
| Session | `sessionId` | UUID-ish (`nanoid()` from `page.tsx`) — useful to join with `uploads/{sessionId}/` |
| Customer | `config.demoCustomer.company / contact` | Hardcoded; change in `lib/config.ts` |
| Stage | `getStageLabel(stageId)` | "未明确" if `stageId` is undefined |
| Reason | Tool input `reason` enum | One of the five values from §1 |
| Urgency | Tool input `urgency` enum | low/medium/high |
| Summary | Tool input `summary` | Claude's narrative, often 1–2 sentences |
| Recent Messages | `getRecentMessages(sessionId, 6)` | Last 6 turns, text only, no markdown |
| Files | `session.files` | Relative paths to `uploads/`, or "（无）" |

The block is human-readable (designed for PM to skim) AND machine-parseable (the `═══` separator and `[timestamp] ESCALATION` header make grep/awk straightforward).

---

## 4. The session escalated flag

Set by `markEscalated(sessionId)` in `lib/session.ts`. Read by `buildSystemPrompt({..., escalated})` in `lib/prompt.ts`. When `true`, appends this directive to the system prompt:

```
═══════════════════════════════
【当前状态】本会话已升级给项目经理。你只做：共情回应、信息收集、补充提问、提醒"PM 会主动联系"。
不要再尝试独立解决问题，也不要重复调用 notify_project_manager。
```

This directive is **load-bearing**. Without it, the model often:

1. Keeps trying to solve the issue → defeats the point of escalation.
2. Re-fires the tool on every subsequent angry message → pollutes the log.

Verified in AC #10: post-escalation, the customer said "帮我换成蓝色的", 小鹏 recorded the request as info to forward, did not re-call the tool, did not try to execute the change herself.

The flag has no expiration. Once set, it stays set for the life of the session. Browser refresh starts a fresh session (new `nanoid()`), so the customer gets clean-slate 小鹏 — but on the same logical session id, escalation persists.

---

## 5. V2 swap: real notifications

Spec §16 calls out webhook delivery as the V2 path. **Only `notifyProjectManager()` in `lib/escalation.ts` needs to change.** Everything else stays.

Sketch:

```ts
// lib/escalation.ts (V2)
export async function notifyProjectManager(input: EscalationInput): Promise<{ ok: true }> {
  const payload = {
    timestamp: new Date().toISOString(),
    customer: config.demoCustomer,
    stage: { id: input.stageId, name: getStageLabel(input.stageId) },
    reason: input.reason,
    urgency: input.urgency,
    summary: input.summary,
    recentMessages: input.recentMessages,
    files: input.files,
  };

  // WeChat Work bot example:
  await fetch(process.env.WECHAT_WORK_WEBHOOK!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: formatForWechat(payload) },
    }),
  });

  // Keep the file write as a backup / audit trail
  fs.appendFileSync(config.escalation.logPath, formatBlock(payload), 'utf8');

  return { ok: true };
}
```

Things that DON'T change:
- The tool schema (`escalationTool`).
- The prompt rule #4 wording.
- The session flag flow.
- The route handler in `app/api/chat/route.ts` (it just calls `notifyProjectManager`).
- The signal sent to the client (`{type: 'escalated'}` SSE event).

So the swap is one file, ~20 lines of changes. The seam is intentional.

---

## 6. What's NOT in the log

By design:

- **File contents.** Only paths are recorded; the PM clicks into `uploads/{sessionId}/` to view actual files. Avoids inflating the log with base64 blobs.
- **The full conversation.** Only the last 6 turns. The full history lives in `session.messages` (in-memory) — if you need it, query the session directly via a future admin endpoint.
- **Raw tool_use JSON.** It's redundant with the parsed fields. If you need it for debugging, add a `console.log(toolUse.input)` in `route.ts`.
- **Customer IP / user agent / browser.** No tracking. Demo is anonymous; V2 with auth would add identity to the log naturally.

---

## 7. Testing the escalation flow

```bash
# Make sure server is running on :3000 with a valid ANTHROPIC_API_KEY

SESSION="test-$(date +%s)"

# Round 1: complaint
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"stageId\":\"homepage\",\"userMessage\":{\"content\":\"颜色不行\"}}" \
  --max-time 60

# Round 2: still unhappy
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"userMessage\":{\"content\":\"还是不行\"}}" \
  --max-time 60

# Round 3: should escalate
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"userMessage\":{\"content\":\"实在没法用，你们做不好\"}}" \
  --max-time 60

# Verify
tail -40 logs/escalations.log
```

Or for an immediate escalation:

```bash
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"test-immediate","stageId":"homepage","userMessage":{"content":"让你们项目经理联系我"}}' \
  --max-time 60
```

Expected: a `{type:"escalated"}` event in the SSE stream, a new block in `logs/escalations.log` with `Reason: explicit_request`, and a handoff message in 小鹏's voice.

---

## See also

- [PROMPT_DESIGN.md](PROMPT_DESIGN.md) §6 — rule #4 wording that triggers tool calls
- [ARCHITECTURE.md](ARCHITECTURE.md) §4 — the tool-use loop inside `streamChat`
- [DEVELOPMENT.md](DEVELOPMENT.md) — full test recipe table
