# 小鹏 AI 客服 Web Demo — Agent Guide

**TL;DR.** This is a single-page conversational AI customer-service web demo named "小鹏", written in Next.js 14 + TypeScript + Anthropic SDK. The customer chats 1:1 with 小鹏; 小鹏 answers from a knowledge base (persona file + scripts + QA bank), accepts file uploads into a per-company folder, and exposes two tools: `notify_project_manager` (writes a structured escalation log) and `review_customer_files` (audits uploaded materials against a standards corpus and returns a bilingual report). The demo is a precursor to a 企业微信 (WeChat Work) integration, so the session / escalation / knowledge / file-review layers are designed to be swap-friendly.

Read this file first. Cross-references at the bottom point into `docs/` for deep dives.

---

## 1. What this project does

The project simulates the "after-sales project delivery accompaniment" role currently performed by human project managers (PMs) at an overseas B2B marketing services company. The PM walks the customer through six delivery stages (资料收集 → 首页设计 → SEO与结构 → 页面制作 → 测试修改 → 上线交付) using a standard playbook. 小鹏 is the AI version of that first-line assistant.

What 小鹏 does:

- Greets the customer and asks (or accepts) the current project stage.
- Answers stage-specific questions using the existing playbook (`knowledge/客服阶段话术库.xlsx`) and persona file (`knowledge/csr.md`).
- Accepts file uploads (images, PDF, Word doc/docx, xlsx/xls, csv, txt, md) and acknowledges receipt; files land in `uploads/customers/<company>/` for future hand-off.
- Detects when she should not handle the issue herself (dissatisfaction, commercial questions, explicit "find me a human", out-of-scope, 3+ rounds unresolved) and calls a `notify_project_manager` tool.
- After the tool fires, continues chatting in a passive collect-and-empathize mode until the (simulated) PM takes over.
- When the customer explicitly asks to **check / audit / review** the uploaded materials, calls a `review_customer_files` tool. The handler builds a file inventory, extracts readable content (xlsx via SheetJS, pdf via `pdf-parse`, txt/md/csv as text, image dimensions only), bundles it with the relevant slice of the standards corpus under `standards/customer-file-review/`, and feeds the whole thing back as a tool_result. 小鹏 then writes a bilingual report citing exact file paths as evidence.

What 小鹏 does NOT do (intentional — see `lily-mvp-ticket.md` §3):

- No auth, no multi-account, no registration.
- No persistence across browser refresh. Each page load starts a fresh session.
- No PM admin UI. The escalation hand-off is a log file.
- No real notifications (email / WeChat Work / Lark) — that's the V2 swap point.
- No group chat, no `@小鹏` mentions.
- No image OCR or vision; images are stored and their dimensions read, but pixel content is never analyzed. PDF / xlsx / text content **is** extracted, but only on demand when the review tool fires.

---

## Demo customer values — single source of truth

The demo runs as a single customer whose identity lives in **`lib/config.ts::demoCustomer`**:

| Field | Purpose | Renameable? |
|---|---|---|
| `id` | Storage-key prefix (e.g. `customers/<id>/...`). Permanent — changing it orphans every uploaded blob. | No |
| `displayName` | What 小鹏 says, what the banner shows, what the bilingual report uses. | Yes (freely) |
| `contact` | How 小鹏 addresses the customer's point of contact (logs, escalation prose). | Yes (freely) |

In the docs below, `<id>` / `<displayName>` / `<contact>` are placeholders that mean "whatever `lib/config.ts::demoCustomer` says right now." Curl recipes use the literal values for copy-paste; everything else is abstracted so renames are a one-line config edit instead of a doc-wide find/replace.

---

## 2. Status

The original 13-AC MVP is feature-complete and verified; three escalations sit in `logs/escalations.log` from manual end-to-end testing. The customer-file-review feature was added on top and has been smoke-tested end-to-end against `uploads/customers/<id>/`. A file management drawer ("我上传的文件") was added on top of that, exposing the per-company upload folder in the chat UI with per-file extraction status badges and single + bulk delete; see §5 convention #10 for the sidecar invariant it relies on.

Stack: Next.js 14.2.15 (App Router), React 18, TypeScript 5, Tailwind 3, `@anthropic-ai/sdk@0.32.1`, `xlsx@0.18.5` (knowledge load + spreadsheet extraction), `pdf-parse@2.4.5` (PDF text extraction), `react-markdown@9`, `nanoid@5`.

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
│   │   ├── upload/route.ts       POST upload endpoint (mime + size validation, writes sidecar)
│   │   └── files/route.ts        GET list + DELETE remove for the files drawer
│   ├── layout.tsx                html shell, Chinese lang
│   ├── page.tsx                  server component, generates sessionId via nanoid
│   └── globals.css               tailwind directives + chat-bubble utilities
├── components/                   all client components
│   ├── ChatWindow.tsx            orchestrator, holds local message mirror + drawer state
│   ├── MessageBubble.tsx         role-based styling, markdown render, attachments
│   ├── ComposerBar.tsx           textarea + file picker + send
│   ├── StageSelector.tsx         6 stage buttons + skip, first turn only
│   ├── FilesDrawer.tsx           right-side drawer: list/badge/delete uploads on disk
│   └── DemoBanner.tsx            top yellow "DEMO MODE" bar
├── lib/                          server-side modules
│   ├── config.ts                 single source of truth for tunables
│   ├── knowledge.ts              loads csr.md + xlsx, caches in module scope
│   ├── prompt.ts                 assembles system prompt per request
│   ├── claude.ts                 Anthropic SDK wrapper, streaming + tool loop
│   ├── escalation.ts             notify_project_manager tool + log writer
│   ├── customer-files.ts         per-company upload paths, mime/ext helpers
│   ├── file-review.ts            review_customer_files tool + context builder; exports extractFile
│   ├── file-meta.ts              sidecar read/write/compute (shared by upload + files routes)
│   └── session.ts                in-memory Map<sessionId, Session>
├── knowledge/
│   ├── csr.md                    小鹏's persona archive
│   └── 客服阶段话术库.xlsx       scripts + QA library
├── standards/customer-file-review/   vendor-neutral standards corpus (workflow,
│                                     status defs, report template, 9 module refs,
│                                     source PDFs, an inventory script, examples)
├── skills/customer-file-standards/   Codex skill manifest pointing at the corpus
├── docs/                         agent-readable deep dives (see §6)
├── logs/escalations.log          runtime, structured PM-notification log
├── uploads/customers/<company>/  runtime, customer-uploaded files + <file>.meta.json sidecars
└── .env.local                    runtime, ANTHROPIC_API_KEY
```

---

## 5. Working-here conventions

Read these before touching code. They prevent the most common mistakes:

1. **All prompt logic lives in `lib/prompt.ts`.** Don't put behavior rules into `route.ts` or into the tool description. The prompt is the contract; spread it out and it becomes invisible.

2. **Tool schemas and prompt rules must stay in sync.** Two manual links, no compile-time check:
   - `lib/escalation.ts` `reason` enum (5 values) ↔ `lib/prompt.ts` rule #4 (5 bullets). Add a trigger → update both.
   - `lib/file-review.ts` `scope` enum (10 values) ↔ `lib/prompt.ts` rule #7 + the `referencesForScope()` map in the same file. Add a scope → update both, and add the matching reference under `standards/customer-file-review/references/` if it doesn't already exist.

3. **`lib/config.ts` is the single source of truth for tunables.** Model name, max tokens, customer info, stage list, upload allowlist (mime + extension), per-company upload root, escalation log path, placeholder design link, handoff message, and `fileReview` knobs (`standardsDir`, `maxExtractCharsPerFile`, `maxFilesPerReview`) — all live there. Don't hardcode any of these elsewhere. The client-side mirror in `components/ChatWindow.tsx` (`ALLOWED_MIME`, `ALLOWED_EXTENSIONS`, `MAX_SIZE_MB`) has to be edited alongside the server config; there is no automatic share.

4. **Session state is server-authoritative.** The client only sends the *latest* user message in each `/api/chat` POST. The server holds the canonical history keyed by `sessionId`. Don't add a "send full history" code path; that would break the trust model.

5. **The persona + KB are cached at module scope in `loadKnowledge()`.** Edits to `knowledge/csr.md` or the xlsx require a `npm run dev` restart to pick up.

6. **SDK pinned to `@anthropic-ai/sdk@0.32.1`.** This is older than current and predates native PDF document blocks. Non-image uploads are passed to Claude as text markers like `[客户上传文件: foo.pdf（application/pdf, 240 KB，公司资料文件夹：uploads/customers/<id>）— 文件已落盘。…]` (see `attachmentsToBlocks` in `lib/claude.ts`). Images still go through as native `image` blocks. When the model needs the actual content of a non-image file, it calls `review_customer_files`, which extracts on demand. If you bump the SDK, see `docs/ARCHITECTURE.md` for where to enable document blocks.

7. **The escalated session flag is one-way for the demo.** Once `session.escalated = true`, there is no "un-escalate". The post-escalation directive will be appended to every subsequent system prompt until session reset (browser refresh).

8. **No emojis in code or docs unless explicitly asked.** The persona's anti-examples (亲～哦 etc.) are the only emoji-adjacent content allowed. UI banner uses 🧪 only because the spec section 12 shows it.

9. **Comment-light code by design.** Yongtao's preference is "default to no comments" — only add a comment when the *why* is non-obvious. Don't add JSDoc blocks; this docs/ tree is the source of truth.

10. **Every uploaded file has a sidecar — keep them in lockstep.** For each file `F` in `uploads/customers/<company>/`, there must be a matching `F.meta.json` recording extraction status (`originalName`, `mimeType`, `sizeBytes`, `uploadedAt`, `status` ∈ `ok|image|empty|failed|unsupported`, `note`, `imageWidth`, `imageHeight`). The drawer's status badge comes straight from this sidecar — no per-request re-extraction. Three contracts to preserve when modifying upload, files, or extraction code:
    - `app/api/upload/route.ts` writes the sidecar **before** returning, via `computeFileMeta` + `writeSidecar` in `lib/file-meta.ts`.
    - `app/api/files/route.ts` GET synthesizes a sidecar on the fly for any file missing one (handles legacy / out-of-band drops); DELETE unlinks the file **and** its sidecar together.
    - `computeFileMeta` calls `extractFile` from `lib/file-review.ts` — the same function the review tool uses. If you add or change a status, update both the `FileStatus` union in `lib/file-meta.ts` **and** the `STATUS_BADGE` map + tooltip rendering in `components/FilesDrawer.tsx`. If you add a new extractor, route it through `extractFile` so the badge and the review report agree.

---

## 6. Where to read next

| If you're touching… | Read |
|---|---|
| Anything (orientation) | This file → `docs/ARCHITECTURE.md` |
| Prompt text, behavior rules, tool descriptions | `docs/PROMPT_DESIGN.md` |
| The xlsx, stage mapping, adding a new stage | `docs/KNOWLEDGE_BASE.md` |
| The escalation tool, log format, real-notification swap | `docs/ESCALATION.md` |
| The review tool, standards corpus, extending scopes / extractors | `docs/FILE_REVIEW.md` |
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
- [docs/FILE_REVIEW.md](docs/FILE_REVIEW.md) — the review tool, standards corpus, content extractors
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local dev recipes
