# File Review

**TL;DR.** `review_customer_files` is the second tool exposed to Claude (next to `notify_project_manager`). It only fires when the customer explicitly asks for a materials check. The handler walks `uploads/customers/<company>/`, extracts text from xlsx / pdf / txt / csv / md, reads image dimensions from the file header (no OCR), bundles the result with a slice of a vendor-neutral standards corpus, and returns one big text blob as the `tool_result`. The model then writes a bilingual customer-facing report with file-path citations as evidence.

This doc covers: the tool schema, the standards corpus layout, how scopes map to references, the content extractors, and how to extend any of them.

---

## 1. The tool

Defined in `lib/file-review.ts` as `fileReviewTool` and registered in `app/api/chat/route.ts` alongside `escalationTool`. Schema:

```ts
{
  name: 'review_customer_files',
  description: '客户明确要求检查、分析、审核已上传资料是否符合建站资料标准时调用。'
             + '只做资料标准检查，不用于普通问答或单纯上传确认。',
  input_schema: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: [
        'overall', 'preparation', 'brand_assets', 'homepage',
        'product_category', 'product_detail', 'about_us',
        'solutions', 'case_library', 'images',
      ], description: '客户要求检查的范围。没有明确限定时使用 overall。' },
      request: { type: 'string', description: '客户的原始检查请求或你对检查重点的简短概括。' },
    },
    required: ['scope', 'request'],
  },
}
```

Prompt sync point: rule #7 in `lib/prompt.ts` is what makes the model call this tool only when asked. See `docs/PROMPT_DESIGN.md` §5 (the verbatim rules) and §6 (sync requirements when changing enums).

---

## 2. Dispatch and handler

In `app/api/chat/route.ts`'s `onToolUse`:

```ts
if (toolUse.name === 'review_customer_files') {
  const input = toolUse.input as { scope?: string; request?: string };
  return await buildFileReviewContext({
    scope: input.scope ?? 'overall',
    request: input.request ?? userMessage.content,
  });
}
```

Whatever string `buildFileReviewContext` returns is fed back to Claude as the `tool_result`. The model never sees the raw filesystem; it sees only the structured blob we hand it.

`buildFileReviewContext` (in `lib/file-review.ts`) does, in order:

1. `getCustomerUploadDir(getCustomerCompany())` → the company folder.
2. `listFiles(companyDir)` → recursive walk, sorted, hidden files skipped, capped at `config.fileReview.maxFilesPerReview` (default 40). If the folder has more, the rest are dropped and an `omittedDirective` is appended telling the model to say so in the report.
3. For each file: `fs.statSync` for size, `mimeTypeFor()` for type, image-size detection if applicable (see §4), and `extractFile()` for text content (see §4). Extracted text is truncated to `config.fileReview.maxExtractCharsPerFile` (default 6000 chars) with a `[已截断…]` marker.
4. `readStandards(scope)` → the standards bundle (see §3).
5. Renders the whole thing as a single string with five sections: customer/folder header + output requirements + file inventory table + extracted content + standards corpus.

The output requirements section (`【输出要求】`) is the live contract the model writes to. It pins the status vocabulary, mandates file-path evidence, restricts `不可读` claims to files whose `Note` explicitly says so, and forbids exposing internal paths (scripts, source PDFs).

---

## 3. The standards corpus

Lives in `standards/customer-file-review/`. The pack is **vendor-neutral on purpose** — it's the same content a separate Codex skill (`skills/customer-file-standards/`) points at, and could be used by other agents in the future.

```
standards/customer-file-review/
├── workflow.md              high-level review workflow (always loaded)
├── status-definitions.md    the four allowed statuses (always loaded)
├── report-template.md       the bilingual report shape (always loaded)
├── references/
│   ├── 00-start-here.md     orientation, A/B project types
│   ├── 01-preparation-rules.md  general image + form rules
│   ├── 03-brand-assets.md
│   ├── 04-homepage.md
│   ├── 05-product-category.md
│   ├── 06-product-detail.md
│   ├── 07-about-us.md
│   ├── 08-solutions.md
│   └── 09-case-library.md
├── source-pdfs/             original PDFs the references were extracted from
├── scripts/inventory_customer_files.py  optional standalone inventory script
└── examples/mock-customer-folder/        fixture for offline review practice
```

There is intentionally no `02-*.md`. Don't invent one.

`referencesForScope(scope)` (in `lib/file-review.ts`) picks which `references/*.md` files get inlined into the tool_result:

| Scope | References loaded (in addition to start-here + preparation for non-`overall`) |
|---|---|
| `overall` | `00 / 01 / 03 / 04 / 05 / 06 / 07 / 08 / 09` |
| `preparation` | `01` |
| `brand_assets` | `03` |
| `homepage` | `04` |
| `product_category` | `05` |
| `product_detail` | `06` |
| `about_us` | `07` |
| `solutions` | `08` |
| `case_library` | `09` |
| `images` | `01 / 03 / 04 / 06` (image-bearing modules) |

Editing a reference file or the fixed trio takes effect on the next tool call — no server restart needed (the file is read on demand, unlike `loadKnowledge()` which caches).

---

## 4. Content extractors

Defined in `lib/file-review.ts`. Each extension is routed to one of six extractors.

| Extension | Extractor | Library | Notes |
|---|---|---|---|
| `txt`, `md`, `csv`, `text/*` | `readTextFile` | `fs.readFileSync(..., 'utf8')` | Raw bytes; long files are truncated to `maxExtractCharsPerFile` by the caller. |
| `xlsx`, `xls` | `readSpreadsheet` | `xlsx` (SheetJS) | Iterates up to 8 sheets, 80 rows each, joined with ` | `. Blank rows skipped. |
| `docx` | `readDocx` | `mammoth` (dynamic `import`) | Extracts plain text via `extractRawText`. Empty body returns `Note: Word document text extraction returned no text`. |
| `doc` | `readDoc` | `word-extractor` (dynamic `import`) | Parses the Word 97–2003 binary OLE format; pure JS, no native deps. Same empty-text note as `docx`. |
| `pdf` | `readPdf` | `pdf-parse@2.4.5` (loaded via dynamic `import`) | Best-effort; scanned / encrypted PDFs may return empty text, in which case the inventory `Note` says so and the model falls back to `需确认`. |
| `jpg / jpeg`, `png`, `webp`, `gif` | `detectImageSize` | hand-rolled header parsers | Reads first 64 bytes (or more for JPEG) to extract width × height. **No OCR, no pixel inspection**, by design. Failures produce `Note: image size unavailable: …`. |
| anything else | falls through | — | `Note: unsupported file content parser; mark content-dependent checks as 需确认`. |

The model sees both the inventory row (path, size, dimensions if any, note) and the extracted text block per file. When `extractedText` is empty, only the note is shown.

`pdf-parse` is the most likely failure point in production. Symptoms: `Note: PDF text extraction returned no text` or `Note: content extraction failed: …`. The smoke test in `docs/DEVELOPMENT.md` §4 explicitly checks PDF handling.

---

## 5. Output contract

The tool_result string is laid out as:

```
【客户资料检查上下文】
客户公司：东永盛
公司资料文件夹：uploads/customers/东永盛
客户请求：<original request>
检查范围：<scope>

[empty-folder directive if 0 files]
[omitted-files directive if listFiles > maxFilesPerReview]

【输出要求】
- 用客户可读的中英双语报告格式输出。
- 只使用这些状态：符合、缺失、需确认、可优化。
- 每个结论必须引用证据：优先使用【文件清单】中的精确文件路径；
  缺失项引用公司资料文件夹路径并说明"未发现"；
  可读内容引用具体文件路径和字段/短句。
- 如果证据不足、文件无法读取、图片内容无法 OCR 判断，标记为 需确认。
- 只有当文件 Note 明确写有 content extraction failed 或 no readable text extracted
  时，才说文件不可读；否则按【可读内容提取】中的文本判断。
- 不要暴露工具实现细节、脚本路径或源 PDF 路径。

【文件清单】
| Path | Type | Size | Image dimensions | Note |
|---|---|---:|---|---|
| `uploads/customers/东永盛/...` | image/png | 8 KB | 1x1 |  |
| ...

【可读内容提取】
### uploads/customers/东永盛/lily-review.txt
<text up to maxExtractCharsPerFile chars>

### uploads/customers/东永盛/lily-review.xlsx
Sheet: 资料
首页 | 主视觉文案 |
产品详情 | 型号A 参数 |

...

【资料标准】
## workflow.md
<content>
---
## status-definitions.md
<content>
---
## report-template.md
<content>
---
## references/00-start-here.md
<content>
... (scope-dependent)
```

The model is expected to use `report-template.md` as the structural template and `status-definitions.md` as the controlled vocabulary.

---

## 6. Tunables

In `lib/config.ts`:

```ts
fileReview: {
  standardsDir: './standards/customer-file-review',
  maxExtractCharsPerFile: 6000,
  maxFilesPerReview: 40,
},
```

- **`standardsDir`** — resolved with `path.resolve()`. Moving the corpus elsewhere is a one-line change.
- **`maxExtractCharsPerFile`** — chars per file inlined into the tool_result. Lower = cheaper review turns; risks truncating trailing xlsx rows.
- **`maxFilesPerReview`** — sorted file walk is capped here. When exceeded, the directive `还有 N 个文件未纳入本次上下文…` is appended so the model warns the customer.

There is no separate cap on the total tool_result size; in practice `maxExtractCharsPerFile × maxFilesPerReview` is the upper bound on extracted-text bytes (≈ 240 KB at defaults).

---

## 7. Extending

### Add a new scope (e.g. `certifications`)

1. `fileReviewTool.input_schema.properties.scope.enum` — add `'certifications'`.
2. `referencesForScope()` — map it to `['10-certifications.md']` (or whichever reference covers it).
3. If new, create `standards/customer-file-review/references/10-certifications.md` and follow the existing module's structure (required vs. recommended items, evidence requirements).
4. Optional: nudge in `lib/prompt.ts` rule #7's example list so the model picks the right scope.

### Support a new file type (e.g. `.docx`)

1. Add the mime to `config.upload.allowedMimeTypes` and the extension to `allowedExtensions`.
2. Mirror on the client: `ALLOWED_MIME` / `ALLOWED_EXTENSIONS` in `components/ChatWindow.tsx`.
3. Add a fallback mime in `mimeTypeFor()` in `lib/customer-files.ts`.
4. Add an extension-set constant and an `if (...) return readDocx(absPath)` branch in `extractFile()` in `lib/file-review.ts`. Implement `readDocx` similarly to `readPdf` / `readSpreadsheet`, returning `{ text?, note? }`.
5. Run the smoke test in `docs/DEVELOPMENT.md` §4 to confirm the new content shows up in `【可读内容提取】`.

### Tweak the output contract

Edit the `【输出要求】` block in `buildFileReviewContext()`. Keep statuses limited to the four in `status-definitions.md`; if you add a fifth, update both `status-definitions.md` and the output requirements in lockstep, or the model will use whichever it sees first.

---

## 8. The companion Codex skill

`skills/customer-file-standards/SKILL.md` and `skills/customer-file-standards/agents/openai.yaml` describe the same standards pack from the perspective of an out-of-band agent (e.g., a Codex / OpenAI agent reviewing a folder over a shell). This codebase doesn't load the skill at runtime — `review_customer_files` is its own implementation. They share only the `standards/customer-file-review/` corpus.

When the pack evolves, edit `standards/customer-file-review/*.md` and both surfaces stay correct. Don't duplicate workflow rules into the skill manifest.

---

## 9. Known limitations

- **No `tool_result` caching.** Every review re-walks the folder and re-extracts content. For a stable folder, an extract cache keyed by path+mtime would cut input tokens substantially.
- **One customer per server.** `getCustomerCompany()` returns the demo company; the review tool reads the same folder for every session. Multi-tenant needs a session→customer resolver.
- **PDF text extraction is best-effort.** Scanned PDFs return empty text. OCR is out of scope; the model is told to fall back to `需确认`.
- **Image content is never inspected.** Only dimensions. "Logo on white background, no watermark" claims must come from explicit customer assertion, never from the tool.
- **Truncation is unindicated to the model beyond a marker.** If a 50,000-char spreadsheet was needed to make a finding, the report might miss it; `maxExtractCharsPerFile` should be tuned based on actual customer-folder size.
- **No protection against path traversal in `getCustomerUploadDir`.** Today `company` is hardcoded so it's safe; if you ever take company from request input, sanitize before joining.

---

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — where `buildFileReviewContext` plugs into the tool-use loop
- [PROMPT_DESIGN.md](PROMPT_DESIGN.md) — rule #7 (the trigger) and the scope/code sync table
- [DEVELOPMENT.md](DEVELOPMENT.md) §3–§4 — upload and review smoke tests
- `standards/customer-file-review/workflow.md` — the customer-facing review workflow
- `skills/customer-file-standards/SKILL.md` — the companion Codex skill manifest
