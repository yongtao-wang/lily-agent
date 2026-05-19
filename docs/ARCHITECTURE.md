# Architecture

**TL;DR.** Next.js 14 App Router. Two API routes (`/api/chat` for SSE streaming, `/api/upload` for files). Eight `lib/` modules with clear single responsibilities. Server holds canonical session state in an in-memory `Map`; the client mirrors it for display. Every chat request rebuilds the system prompt from cached knowledge and a fresh stage/escalation snapshot. Claude has two tools available — `notify_project_manager` (escalation log writer) and `review_customer_files` (on-demand inventory + content extraction + standards bundle).

---

## 1. Request flow

```
┌────────┐                                                          ┌───────────────┐
│Browser │                                                          │Anthropic API  │
└───┬────┘                                                          └───────▲───────┘
    │                                                                       │
    │  POST /api/chat                                                       │
    │  { sessionId, stageId?, userMessage:{content,attachments?} }          │
    │                                                                       │
    ▼                                                                       │
┌────────────────────────────────────────────────────────────────────┐      │
│ app/api/chat/route.ts                                              │      │
│   1. appendMessage(session, user msg)                              │      │
│   2. kb = loadKnowledge()           (cached after first call)      │      │
│   3. systemPrompt = buildSystemPrompt({kb, stageId, escalated})    │      │
│   4. streamChat(...)                                               │      │
└──┬─────────────────────────────────────────────────────────────────┘      │
   │                                                                        │
   ▼                                                                        │
┌────────────────────────────────────────────────────────────────────┐      │
│ lib/claude.ts :: streamChat                                        │      │
│   for iter in 0..maxIterations:                                    │      │
│     stream = client.messages.stream({system, messages, tools})  ───┼──────┘
│     forward text_delta → onText (→ SSE → client)                   │
│     if stop_reason === 'tool_use':                                 │
│       for each tool_use:  await onToolUse(...) → tool_result       │
│       push assistant+tool_result into workingMessages              │
│       continue loop                                                │
│     else: break                                                    │
└──┬─────────────────────────────────────────────────────────────────┘
   │  on tool_use 'notify_project_manager':
   ▼
┌────────────────────────────────────────────────────────────────────┐
│ lib/escalation.ts :: notifyProjectManager                          │
│   fs.appendFileSync(logs/escalations.log, formatted block)         │
│   returns "ok" → fed back to Claude as tool_result                 │
└────────────────────────────────────────────────────────────────────┘
   │
   │  on tool_use 'review_customer_files':
   ▼
┌────────────────────────────────────────────────────────────────────┐
│ lib/file-review.ts :: buildFileReviewContext                       │
│   listFiles(uploads/customers/<company>/)                          │
│   for each file: detectImageSize / readSpreadsheet / readPdf /     │
│                  readTextFile (truncated to maxExtractCharsPerFile)│
│   readStandards(scope)  ← workflow + status defs + report template │
│                          + referencesForScope(scope) from          │
│                          standards/customer-file-review/           │
│   returns one big text blob → fed back to Claude as tool_result    │
└────────────────────────────────────────────────────────────────────┘
   │
   ▼
back to route.ts:
   (escalation path only) markEscalated(sessionId)
   append final assistant message
   send {type:"done"}
```

Upload flow is the same shape but simpler: `app/api/upload/route.ts` parses multipart form data, validates each entry against `config.upload.allowedMimeTypes` **or** `config.upload.allowedExtensions` (via `isAllowedUpload()`) and size against `maxSizeMB`, writes files to `./uploads/customers/<company>/{timestamp}-{safeFilename}` (the company comes from `config.demoCustomer.company`, sanitized as a single path segment), and appends the resulting `FileRef[]` to the session. Each `FileRef` carries `company` and `companyPath` so the chat path can mention the folder in the attachment marker and the review tool can find it later.

---

## 2. Per-file purpose

### `lib/`

| File | Purpose | Imports from | Used by |
|---|---|---|---|
| `config.ts` | Single source of truth for tunables: model, max tokens, customer info, stages, upload allowlist (mime + ext), per-company upload root, escalation paths, placeholder design link, handoff message, `fileReview` knobs (`standardsDir`, `maxExtractCharsPerFile`, `maxFilesPerReview`). Exports `config` object + `StageId` type + `getStageLabel(id)`. | — | all other lib files, `app/page.tsx`, both API routes |
| `knowledge.ts` | Reads `csr.md` + xlsx once per server process, caches result. Exports `loadKnowledge(): KnowledgeBase` and `normalizeStage()` helper. Skips `项目沟通档案表` sheet by design. | `xlsx`, `node:fs`, `node:path` | `app/api/chat/route.ts`, indirectly `prompt.ts` |
| `prompt.ts` | Assembles the system prompt per request. Filters scripts by `stageId`. Emits the post-escalation directive when `escalated` is true. The behavior-rules block embeds rule #7 (file-review trigger conditions); see `docs/PROMPT_DESIGN.md`. | `config.ts`, knowledge types | `app/api/chat/route.ts` |
| `claude.ts` | Anthropic SDK wrapper. `streamChat` handles the streaming + multi-iteration tool-use loop. Converts session messages to `MessageParam[]` and inlines image attachments as base64 image blocks; non-image attachments become a text marker that includes the company folder so the model can recognize the review target. | `@anthropic-ai/sdk`, `config.ts`, session types, `node:fs`, `node:path` | `app/api/chat/route.ts` |
| `escalation.ts` | Tool schema (`escalationTool`, name `notify_project_manager`) + `notifyProjectManager()` that writes the structured log block. | `config.ts`, session types, `node:fs`, `node:path` | `app/api/chat/route.ts` |
| `customer-files.ts` | Pure helpers shared by `/api/upload` and `file-review.ts`: `sanitizePathSegment`, `sanitizeFilename`, `getCustomerCompany`, `getCustomerUploadDir`, `getRelativePath`, `getExtension`, `isAllowedUpload`, `mimeTypeFor`, `supportedUploadLabel`. No I/O, no side effects. | `config.ts`, `node:path` | `app/api/upload/route.ts`, `file-review.ts` |
| `file-review.ts` | Tool schema (`fileReviewTool`, name `review_customer_files`) + `buildFileReviewContext({scope, request})`. Walks the customer's upload folder, extracts content per file type (image dimensions via header-parse, text/csv/md raw, xlsx via SheetJS, docx via `mammoth`, doc via `word-extractor`, pdf via `pdf-parse`), bundles with the standards corpus slice for the requested scope, and returns a single string for the tool_result. Enforces `maxFilesPerReview` and `maxExtractCharsPerFile` caps. Also exports `extractFile` + the per-format extension sets for reuse by `lib/file-meta.ts` (upload-time sidecar) and `app/api/files/route.ts` (drawer GET). | `xlsx`, `mammoth`, `word-extractor`, `pdf-parse`, `config.ts`, `customer-files.ts`, `node:fs`, `node:path` | `app/api/chat/route.ts`, `lib/file-meta.ts` |
| `session.ts` | In-memory `Map<sessionId, Session>` with the CRUD helpers `getOrCreateSession`, `appendMessage`, `appendFiles`, `setStage`, `markEscalated`, `getRecentMessages`. Defines `ChatMessage`, `FileRef` (with optional `company` / `companyPath` for the per-company upload tree), `Session` types. | — | both API routes, `claude.ts` (via type import), `escalation.ts` (via type import) |

### `app/`

| File | Purpose |
|---|---|
| `layout.tsx` | Minimal HTML shell, `lang="zh-CN"`, imports `globals.css`. |
| `page.tsx` | Server component. Generates a fresh `sessionId = nanoid()` on every render (enforces AC #13 — refresh resets). Passes config-derived stage list and customer info to `<ChatWindow>`. |
| `globals.css` | Tailwind directives + chat-bubble custom classes + typing-dot keyframes. |
| `api/chat/route.ts` | POST handler. Sets `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`. Builds a `ReadableStream` that pumps SSE-formatted JSON events. Registers both tools (`escalationTool`, `fileReviewTool`). `onToolUse` dispatches by name: `review_customer_files` → `buildFileReviewContext(input)`; `notify_project_manager` → log + `markEscalated()` + emit `escalated` event. Appends user + final assistant messages to session. |
| `api/upload/route.ts` | POST handler using `request.formData()`. Resolves the company folder via `getCustomerUploadDir(getCustomerCompany())` and `fs.mkdirSync(..., { recursive: true })`. Validates each entry with `isAllowedUpload(name, type)` (mime OR extension match) and size against `config.upload.maxSizeMB`. Returns 415/413 with Chinese error messages on rejection. Writes to `./uploads/customers/<company>/{timestamp}-{safeFilename}` and stamps each `FileRef` with `company` + `companyPath`. |

### `components/`

| File | Purpose |
|---|---|
| `ChatWindow.tsx` | Client orchestrator. Holds `messages[]`, `stageId`, `hasChosenStage`, `isStreaming`, `streamingMsgId`. Calls `/api/upload` first if there are pending files, then `/api/chat` with the new message. Parses SSE deltas and accumulates into the assistant message in state. |
| `MessageBubble.tsx` | Role-based bubble styling. Renders user content as plain text, assistant content via `react-markdown`. Shows attachment chips (image icon vs PDF icon) and a typing-dot animation when the bubble is empty + streaming. |
| `ComposerBar.tsx` | File picker (📎), textarea (Enter to send, Shift+Enter newline, respects IME composition), send button. Client-side validates files against `ALLOWED_MIME` **or** `ALLOWED_EXTENSIONS` and `MAX_SIZE_MB` before submitting; shows a red error banner on failure. Includes a one-line hint underneath telling the customer which extensions are accepted and that file review only runs when explicitly asked. |
| `StageSelector.tsx` | Renders six stage buttons + a "跳过" (skip) button. Disappears after first selection (controlled by parent's `hasChosenStage`). |
| `DemoBanner.tsx` | Yellow top bar showing `🧪 DEMO MODE · 客户：<displayName> · 对接人：<contact>`. |

---

## 3. Data flow invariants

These are load-bearing assumptions. Breaking them silently breaks behavior.

1. **Server is authoritative for session state.** The client posts only the latest user turn to `/api/chat`; the server holds the full history keyed by `sessionId`. Don't accept the full message array from the client — it would let a malicious client rewrite history.

2. **Persona and KB are read once per server process.** `loadKnowledge()` caches into a module-scope variable. The first call reads `csr.md` and the xlsx; subsequent calls return the cached object. Edits to those files require `npm run dev` restart.

3. **Every Anthropic call includes the full system prompt.** No prompt caching is configured. The persona file (~1500 tokens), stage scripts, full QA bank, behavior rules — all re-sent every turn. See `docs/PROMPT_DESIGN.md` §"Cost" for an estimate and the suggested upgrade path.

4. **The tool-use round trip is collapsed in session history.** Inside `streamChat`, multiple model iterations may happen for one user turn (model emits tool_use → server runs tool → model continues). Only the final aggregated text gets appended to `session.messages` by `route.ts`. This keeps the model's view of conversation history clean — it sees `user → assistant → user → assistant`, not `user → tool_use → tool_result → assistant → user → ...`. The cost: the large `review_customer_files` tool_result (inventory + extracted text + standards, often 20–40 KB) is **not retained** for the next turn; if the customer asks a follow-up question, the model has only its own assistant text to work from. This is intentional — re-running the tool is cheaper than keeping a giant blob in every subsequent request.

5. **Browser refresh = new session.** `page.tsx` is server-rendered and calls `nanoid()` on every render. Refresh produces a new sessionId, orphaning the old one in the server's `Map` (it persists in memory but is unreachable). The acceptance test for AC #13 depends on this.

6. **Session escalated flag is one-way.** Once `markEscalated()` runs, the post-escalation directive is appended on every subsequent system prompt build for that sessionId. There is no `unmarkEscalated()`. Reset by starting a new session.

---

## 4. The tool-use loop in detail

Why this loop is non-trivial: Anthropic's streaming protocol can emit `content_block_start { type: 'tool_use' }` mid-stream, followed by `input_json_delta` events that accumulate the tool's input. The model finishes its turn with `stop_reason: 'tool_use'`. To get a natural follow-up reply, we must:

1. Collect the tool calls.
2. Run each tool handler.
3. Build `tool_result` content blocks.
4. Call the model again with `[...originalHistory, {assistant: [tool_use blocks]}, {user: [tool_result blocks]}]`.
5. Stream that second response back.
6. If THAT response also stops on `tool_use`, loop again (capped by `maxIterations` to prevent runaway loops).

Implementation lives in `lib/claude.ts`. The `route.ts` handler only sees text deltas via `onText` and tool calls via `onToolUse(...)` — the loop is opaque from above.

Why we don't stream the tool_use block to the client: the spec (§9) wants the client to see only the natural language. The escalation event is signaled separately as `data: {"type":"escalated"}` so the UI could show a badge if it wanted. There is **no** parallel `file_reviewed` event — the file-review tool is opaque to the client; the only visible signal is the bilingual report that 小鹏 then streams as normal text.

---

## 5. What's intentionally simple

These are demo-scope decisions, all called out in the spec §16 as V2 swap points:

| Today | V2 swap (one file changes) |
|---|---|
| In-memory `Map` session store | Redis / SQLite — only `lib/session.ts` needs a different implementation |
| `fs.appendFileSync` log | Webhook POST to WeChat Work / Slack / email — only `notifyProjectManager` in `lib/escalation.ts` changes |
| No session GC | Add `lastActiveAt`, prune on access — same file |
| No auth, customer hardcoded | URL token / OAuth — touch `page.tsx`, `config.ts`, and `getCustomerCompany()` in `customer-files.ts` (currently returns the demo company) |
| Knowledge from local files | DB / Notion / multi-xlsx merge — `lib/knowledge.ts` |
| Local-disk uploads under `uploads/customers/<company>/` | S3 / OSS / company-scoped bucket — `customer-files.ts` paths + the file walker in `file-review.ts` |
| Synchronous content extraction (xlsx + pdf-parse on the request thread) | Background indexer + cached extracts keyed by file hash — `file-review.ts` `extractFile()` becomes a cache lookup |

The tool schema, prompt structure, and route handlers stay identical across all of these swaps. That's the value of the layering.

---

## 6. Known issues / non-issues

- **Next.js 14.2.15** has a security advisory ([2025-12-11](https://nextjs.org/blog/security-update-2025-12-11)). Build works, but a Next 15 upgrade is a 5-minute exercise. No code change required beyond `npx @next/codemod@latest upgrade latest` (cookies/headers/params became async — we don't use any).
- **`@anthropic-ai/sdk@0.32.1`** predates `DocumentBlockParam`. Non-image uploads are passed to Claude as text markers like `[客户上传文件: report.pdf (application/pdf, 240 KB, 公司资料文件夹：uploads/customers/<id>) — 文件已落盘。…]` (see `attachmentsToBlocks` in `lib/claude.ts`). The original spec's "PDFs stored, not parsed" rule still holds in the chat path; PDF / xlsx / text content is only ever extracted on demand inside `review_customer_files`. Bumping the SDK lets you pass PDFs as `{type: 'document', source: {type: 'base64', ...}}` — one block in `lib/claude.ts` to change.
- **No prompt caching.** Every request resends ~3000 tokens of system prompt. See `docs/PROMPT_DESIGN.md` for the `cache_control` upgrade.
- **No session TTL.** Old sessions sit in memory forever. Fine for demo; add a prune step before production.

---

## See also

- [PROMPT_DESIGN.md](PROMPT_DESIGN.md) — what the system prompt actually says and why
- [ESCALATION.md](ESCALATION.md) — escalation tool schema, log format, swap path
- [FILE_REVIEW.md](FILE_REVIEW.md) — review tool, standards corpus, content extractors
- [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md) — xlsx structure and stage mapping
