# Lily AI 客服 Web Demo — Agent Guide

**TL;DR.** This is a single-page conversational AI customer-service web demo named "Lily", written in Next.js 14 + TypeScript + Anthropic SDK. The customer chats 1:1 with Lily; Lily answers from a knowledge base (persona file + scripts + QA bank); when she can't handle the issue she calls a tool that writes a structured escalation log. The demo is a precursor to a 企业微信 (WeChat Work) integration, so the session / escalation / knowledge layers are designed to be swap-friendly.

Read this file first. Cross-references at the bottom point into `docs/` for deep dives.

---

## 1. What this project does

The project simulates the "after-sales project delivery accompaniment" role currently performed by human project managers (PMs) at an overseas B2B marketing services company. The PM walks the customer through six delivery stages (资料收集 → 首页设计 → SEO与结构 → 页面制作 → 测试修改 → 上线交付) using a standard playbook. Lily is the AI version of that first-line assistant.

What Lily does:

- Greets the customer and asks (or accepts) the current project stage.
- Answers stage-specific questions using the existing playbook (`knowledge/客服阶段话术库.xlsx`) and persona file (`knowledge/csr.md`).
- Accepts file uploads (image / PDF) and acknowledges receipt; files are stored on disk for future hand-off.
- Detects when she should not handle the issue herself (dissatisfaction, commercial questions, explicit "find me a human", out-of-scope, 3+ rounds unresolved) and calls a `notify_project_manager` tool.
- After the tool fires, continues chatting in a passive collect-and-empathize mode until the (simulated) PM takes over.

What Lily does NOT do (intentional — see `lily-mvp-ticket.md` §3):

- No auth, no multi-account, no registration.
- No persistence across browser refresh. Each page load starts a fresh session.
- No PM admin UI. The escalation hand-off is a log file.
- No real notifications (email / WeChat Work / Lark) — that's the V2 swap point.
- No group chat, no `@Lily` mentions.
- No image OCR or vision; files are stored, not parsed.

---

## 2. Status

The MVP is feature-complete and all 13 acceptance criteria from the original spec are verified. Three real escalations are sitting in `logs/escalations.log` from manual end-to-end testing.

Stack: Next.js 14.2.15 (App Router), React 18, TypeScript 5, Tailwind 3, `@anthropic-ai/sdk@0.32.1`, `xlsx@0.18.5`, `react-markdown@9`, `nanoid@5`.

Model: `claude-sonnet-4-6` (configured in `lib/config.ts`, swap-friendly).

---

## 3. How to run

```bash
cd /Users/yongtao/Codes/lily-agent
npm install                    # first time only
cp .env.local.example .env.local
# edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...
npm run dev                    # http://localhost:3000
```

Then click through the six stage buttons or use the test recipes in `docs/DEVELOPMENT.md`.

---

## 4. Code map

```
lily-agent/
├── app/
│   ├── api/
│   │   ├── chat/route.ts         POST chat endpoint (SSE streaming + tool loop)
│   │   └── upload/route.ts       POST upload endpoint (mime + size validation)
│   ├── layout.tsx                html shell, Chinese lang
│   ├── page.tsx                  server component, generates sessionId via nanoid
│   └── globals.css               tailwind directives + chat-bubble utilities
├── components/                   all client components
│   ├── ChatWindow.tsx            orchestrator, holds local message mirror
│   ├── MessageBubble.tsx         role-based styling, markdown render, attachments
│   ├── ComposerBar.tsx           textarea + file picker + send
│   ├── StageSelector.tsx         6 stage buttons + skip, first turn only
│   └── DemoBanner.tsx            top yellow "DEMO MODE" bar
├── lib/                          server-side modules
│   ├── config.ts                 single source of truth for tunables
│   ├── knowledge.ts              loads csr.md + xlsx, caches in module scope
│   ├── prompt.ts                 assembles system prompt per request
│   ├── claude.ts                 Anthropic SDK wrapper, streaming + tool loop
│   ├── escalation.ts             tool definition + notifyProjectManager()
│   └── session.ts                in-memory Map<sessionId, Session>
├── knowledge/
│   ├── csr.md                    Lily's persona archive
│   └── 客服阶段话术库.xlsx       scripts + QA library
├── docs/                         agent-readable deep dives (see §6)
├── logs/escalations.log          runtime, structured PM-notification log
├── uploads/{sessionId}/          runtime, customer-uploaded files
└── .env.local                    runtime, ANTHROPIC_API_KEY
```

---

## 5. Working-here conventions

Read these before touching code. They prevent the most common mistakes:

1. **All prompt logic lives in `lib/prompt.ts`.** Don't put behavior rules into `route.ts` or into the tool description. The prompt is the contract; spread it out and it becomes invisible.

2. **`lib/escalation.ts` schema and `lib/prompt.ts` rule #4 must stay in sync.** The tool's `reason` enum has five values, and rule #4 has five trigger conditions. If you add a sixth trigger, you must update both. There is no auto-link.

3. **`lib/config.ts` is the single source of truth for tunables.** Model name, customer info, stage list, upload limits, escalation log path, placeholder design link, escalation handoff message — all live there. Don't hardcode any of these elsewhere.

4. **Session state is server-authoritative.** The client only sends the *latest* user message in each `/api/chat` POST. The server holds the canonical history keyed by `sessionId`. Don't add a "send full history" code path; that would break the trust model.

5. **The persona + KB are cached at module scope in `loadKnowledge()`.** Edits to `knowledge/csr.md` or the xlsx require a `npm run dev` restart to pick up.

6. **SDK pinned to `@anthropic-ai/sdk@0.32.1`.** This is older than current and predates native PDF document blocks. PDF uploads are passed to Claude as `[客户上传文件: filename.pdf]` text markers. Images go through as native `image` blocks. If you bump the SDK, see `docs/ARCHITECTURE.md` for where to enable document blocks.

7. **The escalated session flag is one-way for the demo.** Once `session.escalated = true`, there is no "un-escalate". The post-escalation directive will be appended to every subsequent system prompt until session reset (browser refresh).

8. **No emojis in code or docs unless explicitly asked.** The persona's anti-examples (亲～哦 etc.) are the only emoji-adjacent content allowed. UI banner uses 🧪 only because the spec section 12 shows it.

9. **Comment-light code by design.** Yongtao's preference is "default to no comments" — only add a comment when the *why* is non-obvious. Don't add JSDoc blocks; this docs/ tree is the source of truth.

---

## 6. Where to read next

| If you're touching… | Read |
|---|---|
| Anything (orientation) | This file → `docs/ARCHITECTURE.md` |
| Prompt text, behavior rules, tool description | `docs/PROMPT_DESIGN.md` |
| The xlsx, stage mapping, adding a new stage | `docs/KNOWLEDGE_BASE.md` |
| The escalation tool, log format, real-notification swap | `docs/ESCALATION.md` |
| Local testing, debugging, config knobs | `docs/DEVELOPMENT.md` |
| Setup for a human user | `README.md` |

The original spec lives at `/Users/yongtao/Desktop/lily-mvp-ticket.md` — sections 4–13 are the contract. Don't re-derive design decisions; check the spec first.

---

## 7. Reference materials

- `/Users/yongtao/Desktop/lily-mvp-ticket.md` — original ticket, the contract this project implements.
- `/Users/yongtao/Desktop/csr.md` — source of `knowledge/csr.md` (copied at project setup).
- `/Users/yongtao/Desktop/客服阶段话术库.xlsx` — source of `knowledge/客服阶段话术库.xlsx`.
- [Anthropic API docs](https://docs.claude.com/en/api/overview), [tool use docs](https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview).

---

## See also

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — request flow, per-file purpose, data invariants
- [docs/PROMPT_DESIGN.md](docs/PROMPT_DESIGN.md) — how the system prompt is layered and what each layer enforces
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local dev recipes
