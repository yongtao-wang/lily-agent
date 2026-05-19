# Development

**TL;DR.** `npm install && npm run dev` on port 3000. The 13 original acceptance criteria each have a copy-pasteable test below, plus a smoke test for the customer-file-review feature. Knobs live in `lib/config.ts`. When something looks wrong, check `logs/escalations.log`, the dev-server stderr, and the browser devtools Network → EventStream tab.

---

## 1. Setup

```bash
cd /Users/yongtao/Codes/lily-agent
npm install                    # ~15s, ~240 packages
cp .env.local.example .env.local
# edit .env.local: ANTHROPIC_API_KEY=sk-ant-...
npm run dev                    # http://localhost:3000
```

If `.env.local` already exists, double-check that the key isn't stale (revoke + rotate keys that were ever pasted in conversation transcripts).

Other npm scripts:

```bash
npm run typecheck              # tsc --noEmit, ~10s
npm run build                  # next build, ~30s
npm run start                  # production server (needs npm run build first)
```

---

## 2. Acceptance test table

The 13 ACs from spec §13, mapped to test recipes. Run the dev server before any of these.

| AC | What to verify | How |
|---|---|---|
| 1 | Page loads at localhost:3000 | `curl -sf http://localhost:3000/ \| head -c 200` returns HTML |
| 2 | DEMO MODE banner shows Gregarious Simulation Systems / 王总 | `curl -s http://localhost:3000/ \| grep -oE 'DEMO MODE\|Gregarious Simulation Systems\|王总'` |
| 3 | Opening message + 6 stage buttons + 跳过 | `curl -s http://localhost:3000/ \| grep -oE '资料收集\|首页设计\|跳过'` |
| 4 | Stage button → 小鹏 acks with stage talking points | Open browser, click `首页设计`, verify response references 图片素材 + 本周 |
| 5 | QA-style question → standard-flavored answer | Type "我想看你们给别人做的详情页参考"; verify 小鹏 redirects to placeholder or offers alternatives |
| 6 | Upload jpg + pdf lands on disk | See §3 upload test below |
| 7 | Reject >20MB and non-allowlist mime/extension | See §3 upload test below |
| 8 | 3-round dissatisfaction → tool call + handoff | See §4 escalation test below |
| 9 | Log block written with all fields | `cat logs/escalations.log` after AC #8 |
| 10 | Post-escalation: 小鹏 passive, no re-call | After AC #8, send another message; verify no second log entry, response stays in collect/forward mode |
| 11 | "我想找人聊" → immediate escalation | See §4 explicit-request test below |
| 12 | Model swap via config | Edit `lib/config.ts` model field, restart, send a message |
| 13 | Refresh resets session | Hard-refresh browser; verify new session opens fresh |

The file-review feature is not part of the original 13 ACs. Its smoke test lives in §4 "Materials review".

---

## 3. Upload endpoint tests

Heads-up: uploads no longer land in `uploads/{sessionId}/`. The route resolves `getCustomerKeyPrefix()` (currently `customers/gss`, derived from `config.demoCustomer.id`) and writes via the storage adapter — `uploads/customers/gss/` for the local-fs backend, or the same prefix in Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set. The returned `FileRef` includes `company` (displayName), `companyPath` (the key prefix), and `url` (blob URL when applicable).

### Valid PNG (AC #6)

```bash
# Minimal 1x1 transparent PNG
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc\x0f\x00\x00\x01\x01\x00\x05_\xe7\xa1\xd4\x00\x00\x00\x00IEND\xaeB`\x82' > /tmp/test.png

curl -sS -X POST http://localhost:3000/api/upload \
  -F "sessionId=test-upload" \
  -F "files=@/tmp/test.png;type=image/png"

# Verify
ls -la uploads/customers/gss/
```

Expected: JSON like `{"files":[{"filename":"test.png","path":"customers/gss/...","mimeType":"image/png","sizeBytes":68,"company":"Gregarious Simulation Systems","companyPath":"customers/gss"}]}`, file present in `uploads/customers/gss/`.

### Valid xlsx (file-review feature)

```bash
# A real xlsx or csv works the same way. Server validates either by mime OR extension.
curl -sS -X POST http://localhost:3000/api/upload \
  -F "sessionId=test-upload" \
  -F "files=@some-materials.xlsx;type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
```

Expected: HTTP 200; the file's extracted content becomes visible to the model when `review_customer_files` later fires.

### Oversize (AC #7)

```bash
dd if=/dev/zero of=/tmp/big.png bs=1m count=21 2>/dev/null
curl -sS -X POST http://localhost:3000/api/upload \
  -F "sessionId=test-oversize" \
  -F "files=@/tmp/big.png;type=image/png"
```

Expected: HTTP 413, body `{"error":"文件过大：big.png（21.0 MB，超过 20 MB）"}`.

### Bad mime (AC #7)

```bash
echo "fake" > /tmp/bad.zip
curl -sS -X POST http://localhost:3000/api/upload \
  -F "sessionId=test-mime" \
  -F "files=@/tmp/bad.zip;type=application/zip"
```

Expected: HTTP 415, body `{"error":"不支持的文件类型：bad.zip (application/zip)。仅支持 jpg / jpeg / png / webp / pdf / xlsx / xls / doc / docx / csv / txt / md"}`. The current allowlist (mime + extension) is in `config.upload`; client-side mirror lives in `components/ChatWindow.tsx`.

---

## 4. Chat endpoint tests

### Stage acknowledgement (AC #4)

```bash
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"test-stage","stageId":"homepage","userMessage":{"content":"我现在在「首页设计」阶段。"}}' \
  --max-time 60
```

Expected: SSE stream with `data: {"type":"text","delta":"..."}` events. The aggregated text should mention 图片素材 and 本周 (concepts from the homepage script). Ends with `data: {"type":"done"}`.

### Escalation via dissatisfaction (AC #8, #9, #10)

```bash
SESSION="test-esc-$(date +%s)"

# Round 1
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"stageId\":\"homepage\",\"userMessage\":{\"content\":\"颜色不行\"}}" \
  --max-time 60

# Round 2
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"userMessage\":{\"content\":\"还是不行\"}}" \
  --max-time 60

# Round 3 — should escalate
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"userMessage\":{\"content\":\"实在没法用\"}}" \
  --max-time 60

# Verify log
tail -40 logs/escalations.log

# Post-escalation message — should stay passive
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"userMessage\":{\"content\":\"那帮我换成蓝色的\"}}" \
  --max-time 60

# Verify log count didn't increase
grep -c "^\[" logs/escalations.log
```

Expected: round 3 stream contains a `data: {"type":"escalated"}` event, log gains one new block with `Reason: customer_dissatisfied`. The post-escalation message does not produce a second log entry.

### Explicit request (AC #11)

```bash
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"test-explicit","stageId":"homepage","userMessage":{"content":"我想找人聊，让你们项目经理联系我"}}' \
  --max-time 60

tail -30 logs/escalations.log
```

Expected: immediate escalation with `Reason: explicit_request`.

### Model swap (AC #12)

```bash
# Stop dev server first (Ctrl+C)
# Edit lib/config.ts:
#   model: 'claude-opus-4-7',  // was claude-sonnet-4-6
# Restart
npm run dev

# Send any message and watch the request in browser devtools or add a temporary
# console.log(config.model) inside route.ts to confirm.
```

### Refresh resets (AC #13)

In a browser: open localhost:3000, click a stage, send a message, then hard-refresh. The new page should show the opening greeting and the six stage buttons, with no carryover.

### Materials review (file-review feature)

Smoke test for `review_customer_files`. Make sure `uploads/customers/gss/` has at least one file (use the upload curl above or drop a file in via the UI).

```bash
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"test-review","userMessage":{"content":"请帮我整体检查一下我上传的资料"}}' \
  --max-time 90
```

Expected: SSE stream containing a bilingual report ("资料检查结果 / Materials Readiness Review") with a `模块 / Module` table that uses only the four allowed statuses (`符合 / 缺失 / 需确认 / 可优化`) and cites file paths like `uploads/customers/gss/...` as evidence. Ends with `{"type":"done"}`. No `escalated` event.

Negative test — make sure a pure upload turn does **not** trigger the tool:

```bash
SESSION="test-no-review-$(date +%s)"
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"userMessage\":{\"content\":\"我刚刚上传了产品资料，请收下。\"}}" \
  --max-time 60
```

Expected: 小鹏 acknowledges the upload (rule #6) but does **not** stream a full review. If she does, rule #7's negative clause has regressed — re-tighten the prompt before shipping.

Sub-scope test (any of `homepage`, `brand_assets`, `product_detail`, `product_category`, `about_us`, `solutions`, `case_library`, `preparation`, `images`):

```bash
curl -sN -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"test-scope","userMessage":{"content":"帮我看看首页相关的资料"}}' \
  --max-time 90
```

Expected: report focuses on homepage-related findings; reference Markdown bundled into the tool_result is just `04-homepage.md` (plus the always-loaded `00-start-here.md` / `01-preparation-rules.md`).

---

## 5. Where to look when things break

| Symptom | Check |
|---|---|
| Page loads but messages don't stream | Browser devtools → Network → click the `/api/chat` request → EventStream tab; look for error events or auth failures |
| Server-side errors (500s, hangs) | Terminal running `npm run dev`. Anthropic SDK errors print stack traces |
| Escalation didn't fire when expected | Add temporary `console.log` in `lib/claude.ts` at the `if (event.type === 'content_block_start')` branch to see if `tool_use` was emitted at all. If yes, check `onToolUse` handler in `app/api/chat/route.ts` |
| Wrong stage scripts in prompt | Add `console.log(systemPrompt)` in `app/api/chat/route.ts` before `streamChat` to inspect what's being sent |
| Upload silently fails | Server log will show the multipart parsing error. Common cause: wrong `Content-Type` header — let `curl -F` set it, don't override |
| Log file not created | First escalation creates `logs/` dir via `fs.mkdirSync(..., { recursive: true })`. If permissions are wrong, the error will surface in dev-server stderr |
| Page shows but stage buttons don't disappear | `hasChosenStage` state in `ChatWindow.tsx` — verify the click handler runs. Add `console.log` in `handleStageSelect` |

---

## 6. Tweaking knobs

Everything tunable lives in `lib/config.ts`. Common edits:

### Switch model

```ts
model: 'claude-opus-4-7',           // was 'claude-sonnet-4-6'
```

Restart dev server after edit.

### Change customer

```ts
demoCustomer: {
  company: '某某公司',
  contact: '李总',
},
```

### Adjust upload limits

```ts
upload: {
  allowedMimeTypes: [
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv', 'text/plain', 'text/markdown',
  ],
  allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'xlsx', 'xls', 'doc', 'docx', 'csv', 'txt', 'md'],
  maxSizeMB: 50,                    // was 20
  uploadDir: './uploads',
  companyRootDir: './uploads/customers',
},
```

If you broaden the allowlist, also update the `ALLOWED_MIME` and `ALLOWED_EXTENSIONS` constants in `components/ChatWindow.tsx` for the client-side validation, and add a server-side `mimeTypeFor()` case in `lib/customer-files.ts` if the new extension needs a non-default mime fallback.

### Change escalation log path

```ts
escalation: {
  logPath: '/var/log/xiaopeng/escalations.log',
  handoffMessage: '...',
},
```

The dir is auto-created on first write.

### Tune the file-review tool

```ts
fileReview: {
  standardsDir: './standards/customer-file-review',
  maxExtractCharsPerFile: 6000,    // chars of extracted text per file in tool_result
  maxFilesPerReview: 40,           // cap on files walked; older files (sort order) win
},
```

`standardsDir` is resolved with `path.resolve()` so a relative path is taken from the dev server's CWD. Lowering `maxExtractCharsPerFile` makes review turns cheaper but risks losing trailing rows of long xlsx sheets; raising `maxFilesPerReview` is what to do if a real customer folder has more than 40 files.

### Edit the handoff message

```ts
escalation: {
  handoffMessage: '已通知您的项目经理王经理（手机：xxx）。预计 1 小时内回电。',
}
```

Note: 小鹏 paraphrases this in her voice; she doesn't quote it verbatim.

---

## 7. Common modifications

### Add a new stage

1. `config.stages` (lib/config.ts) — add `{ id: 'newstage', label: '新阶段' }`.
2. `STAGE_ALIASES` (lib/knowledge.ts) — add `'7-新阶段': 'newstage', '新阶段': 'newstage'`.
3. Add a row in `话术库表` of the xlsx with `项目阶段: 7-新阶段`.
4. Optionally add QA rows in `问答表` with bare `新阶段`.
5. Restart server.

### Add a new behavior rule

Edit `lib/prompt.ts`. Add a numbered item to the `【行为约束】` block. Keep it grounded — name the trigger condition, name the constraint. Don't say "use judgment".

### Add a new escalation reason

1. `escalationTool.input_schema.properties.reason.enum` (lib/escalation.ts) — add the new enum value.
2. Rule #4 in `lib/prompt.ts` — add a bullet describing when to use it.
3. Optionally adjust the log format in `notifyProjectManager` if the new reason needs special fields.

### Add a new file-review scope

1. `fileReviewTool.input_schema.properties.scope.enum` (lib/file-review.ts) — add the new value.
2. `referencesForScope()` in the same file — map the new scope to the right reference Markdown(s) under `standards/customer-file-review/references/`.
3. If it's a brand-new module, add the corresponding `references/<n>-<name>.md` file. Keep the numbering convention; `02` is intentionally absent.
4. Optionally nudge the model in `lib/prompt.ts` rule #7's example list.
5. Restart server.

Test with a curl that names the new scope's domain (e.g., "请帮我检查证书相关资料") and check the streamed report stays scoped.

### Tighten or relax post-escalation behavior

Edit the `escalatedBlock` in `lib/prompt.ts`. Current text says "你只做：共情回应、信息收集、补充提问". If you want 小鹏 to e.g. still answer simple factual questions, soften the language. Test with the AC #10 recipe.

---

## 8. Known issues / non-issues

- **Next.js 14.2.15** has a 2025-12-11 security advisory. Build works fine; upgrade to Next 15 when you want — see `docs/ARCHITECTURE.md` §6.
- **`@anthropic-ai/sdk@0.32.1`** is older than current. Predates `DocumentBlockParam`, so PDFs go through as text markers rather than native document blocks. Acceptable per spec; bump the SDK if you want PDF content visible to the model.
- **No prompt caching** — each request resends ~3100 system-prompt tokens. See `docs/PROMPT_DESIGN.md` §10 for the `cache_control` upgrade. File-review turns are extra-heavy because the tool_result is 15–40 K tokens and is not cached either.
- **No session TTL.** `lib/session.ts` `Map` accumulates orphaned sessions indefinitely. Fine for demo; add LRU eviction before production.
- **No HMR for knowledge files.** Edit `csr.md` or the xlsx → restart server. The `loadKnowledge()` module cache doesn't watch files. The file-review tool's standards corpus is **not** cached — Markdown edits under `standards/customer-file-review/` take effect on the next tool call without a restart.
- **`pdf-parse@2.4.5` is best-effort.** Some PDFs (scanned, password-protected, weirdly encoded) return no text. The review tool surfaces this as `Note: PDF text extraction returned no text` in the inventory, and the model is instructed to fall back to `需确认` rather than fabricate. If real customers send PDFs that fail often, evaluate `pdfjs-dist` or an OCR step.
- **Single-customer demo.** `getCustomerId()` returns `config.demoCustomer.id` — all uploads land under one shared `customers/gss/` storage prefix, and `review_customer_files` reads the same prefix for every session. Multi-customer deployment requires a per-session customer identity and a real `getCustomerId(sessionId)` implementation.

---

## See also

- [AGENTS.md](../AGENTS.md) — project orientation
- [ARCHITECTURE.md](ARCHITECTURE.md) — what each file does
- [PROMPT_DESIGN.md](PROMPT_DESIGN.md) — system prompt structure
- [ESCALATION.md](ESCALATION.md) — escalation tool flow and log format
- [FILE_REVIEW.md](FILE_REVIEW.md) — review tool, standards corpus, content extractors
- [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md) — xlsx structure
