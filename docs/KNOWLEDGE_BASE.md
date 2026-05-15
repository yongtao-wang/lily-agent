# Knowledge Base

**TL;DR.** Two files in `knowledge/`. `csr.md` is Lily's persona, loaded verbatim. `客服阶段话术库.xlsx` has three sheets; only two are used (`话术库表` and `问答表`). The two used sheets format the project stage differently (`1-资料收集` vs bare `首页设计`) — handled by `STAGE_ALIASES` in `lib/knowledge.ts`. Knowledge is read once per server process and cached in module scope, so edits require a restart.

---

## 1. Files

```
knowledge/
├── csr.md                       Persona archive (~2600 chars, ~1500 tokens)
└── 客服阶段话术库.xlsx          3 sheets, 2 used
```

Source-of-truth originals live at `/Users/yongtao/Desktop/csr.md` and `/Users/yongtao/Desktop/客服阶段话术库.xlsx`. The files in `knowledge/` are copies; if the originals get updated, copy them across:

```bash
cp /Users/yongtao/Desktop/csr.md /Users/yongtao/Codes/lily-agent/knowledge/csr.md
cp "/Users/yongtao/Desktop/客服阶段话术库.xlsx" "/Users/yongtao/Codes/lily-agent/knowledge/客服阶段话术库.xlsx"
```

---

## 2. `csr.md` — the persona

Plain markdown. Loaded as a UTF-8 string and injected verbatim into the system prompt by `buildSystemPrompt()`. No parsing; the model reads it as markdown.

Sections in the current file (don't quote them in code — they may change):

- 基础身份 — identity, role, service areas
- 人格设定 — keywords, tone, sample sentences (positive and anti-examples)
- 专业能力设定 — SEO / GEO / 出海增长 / AI 时代 knowledge tags
- 角色背景故事 — backstory
- 能力边界 — what Lily won't do
- 标准开场白 — opening lines (for reference; we don't use them directly — the React client has its own opening)
- 典型回复风格 — sample Q&A pairs

If you edit this file, the new persona applies on the next `npm run dev` start.

---

## 3. `客服阶段话术库.xlsx` — three sheets

Read with the `xlsx` package (SheetJS). `loadKnowledge()` in `lib/knowledge.ts` opens the workbook and iterates two of the three sheets. The third is intentionally skipped.

### Sheet `项目沟通档案表` — IGNORED

Columns: `项目编号 / 交付等级 / 客户名称 / 项目启动日期 / 通知人 / 当前阶段 / 沟通记录 / 当前阶段话术`

This is PM's project-tracking spreadsheet — internal CRM data, not customer-facing content. The MVP spec (§2) explicitly excludes it. `loadKnowledge()` does not read this sheet.

### Sheet `话术库表` — stage scripts

Columns: `话术编号 / 项目阶段 / 需发类目 / 开场话术 / 父记录`

Stage format: **prefixed**, e.g. `1-资料收集`, `2-首页设计`, `3-SEO与结构`, `4-页面制作`, `5-测试修改`, `6-上线交付`.

Each row is one stage's standard talking points. Currently 6 rows (one per stage). Loaded into the `Script[]` shape:

```ts
type Script = {
  stageId: string;       // normalized: "homepage"
  stageName: string;     // human label: "首页设计"
  category: string;      // 需发类目 — what artifact to send
  content: string;       // 开场话术 — the full script body
};
```

Used in `prompt.ts` filtered by current `stageId` — see `docs/PROMPT_DESIGN.md` §3.

### Sheet `问答表` — QA pairs

Columns: `问答编号 / 项目阶段 / 场景分类 / 触发情况 / 客户原话 / 标准回复 / 后续动作`

Stage format: **bare**, e.g. `首页设计`, `资料收集` (NO number prefix).

Each row is one historical Q&A pair from real customer interactions. Currently ~11 usable rows after filtering. Loaded into the `QAEntry[]` shape:

```ts
type QAEntry = {
  stageId: string;       // normalized: "homepage"
  stageName: string;     // human label: "首页设计"
  scenario: string;      // 场景分类 — e.g. "客户提问类"
  trigger: string;       // 触发情况 — when this Q is asked
  question: string;      // 客户原话 — the customer's actual question
  answer: string;        // 标准回复 — the canonical answer
  followUp: string;      // 后续动作 — what PM does next
};
```

Used in `prompt.ts` **unfiltered** — all entries are dumped with their stage label. See `docs/PROMPT_DESIGN.md` §4 for why.

---

## 4. Stage alias table

The two sheets use different stage formats, so `lib/knowledge.ts` exports a unified normalizer:

```ts
const STAGE_ALIASES: Record<string, string> = {
  '1-资料收集': 'collection', '资料收集': 'collection',
  '2-首页设计': 'homepage',   '首页设计': 'homepage',
  '3-SEO与结构': 'seo',       'SEO与结构': 'seo', 'SEO': 'seo', 'SEO 与结构': 'seo',
  '4-页面制作': 'pages',      '页面制作': 'pages',
  '5-测试修改': 'testing',    '测试修改': 'testing',
  '6-上线交付': 'launch',     '上线交付': 'launch',
};

export function normalizeStage(input: unknown): { id: string; name: string } | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const id = STAGE_ALIASES[trimmed];
  if (!id) return undefined;
  const name = trimmed.replace(/^\d+-/, '');
  return { id, name };
}
```

The canonical stage IDs (`collection`, `homepage`, `seo`, `pages`, `testing`, `launch`) match `config.stages` in `lib/config.ts`. **If you add a new stage you must update all of:**

1. `STAGE_ALIASES` in `lib/knowledge.ts` (both prefixed and bare forms)
2. `config.stages` in `lib/config.ts` (id + label)
3. The xlsx — add a row in `话术库表` with the new stage
4. Optionally a row in `问答表` with a sample question

---

## 5. Loading & caching

```ts
let cache: KnowledgeBase | undefined;

export function loadKnowledge(): KnowledgeBase {
  if (cache) return cache;
  // ... reads csr.md and xlsx
  cache = { persona, scripts, qa };
  return cache;
}
```

Module-scope variable. First call reads disk; subsequent calls within the same process return the cached object.

**Implication**: editing `csr.md` or the xlsx mid-dev requires `Ctrl+C` and `npm run dev` again. The Next.js HMR does not invalidate the module cache for server-only files reliably.

In production, the cache survives until the Node process restarts. Fine for a stable knowledge base; if you need hot-reload, expose an admin endpoint that resets `cache = undefined`.

---

## 6. Adding new QA entries

1. Open `knowledge/客服阶段话术库.xlsx` in Excel / Numbers / Sheets.
2. Switch to the `问答表` tab.
3. Add a row. Required columns:
   - `项目阶段` — bare format (`首页设计`, not `2-首页设计`)
   - `客户原话` — the customer's question
   - `标准回复` — the canonical answer
4. `问答编号`, `场景分类`, `触发情况`, `后续动作` are optional but useful for human readers.
5. Save the xlsx.
6. Restart `npm run dev`.

The new entry will appear in the unfiltered QA dump on the next chat request. Because Claude picks by relevance, the question will surface whenever the customer asks something semantically similar.

---

## 7. Quirks to know

- **Cells with leading whitespace** are tolerated by `normalizeStage` (it calls `.trim()`).
- **Empty rows** are skipped. A row with no `客户原话` or no `标准回复` is silently dropped.
- **Sheet name collisions**: if a future xlsx version renames sheets (e.g. `Sheet1` instead of `问答表`), the loader returns empty arrays silently. There's no error log for this — you'll just see the QA block read "（暂无历史问答样本。）".
- **`项目沟通档案表` sheet is never read.** If you want some data from it (e.g. real customer name instead of hardcoded), copy fields into `config.demoCustomer` manually.

---

## See also

- [PROMPT_DESIGN.md](PROMPT_DESIGN.md) — how the loaded knowledge gets injected into the system prompt
- [ARCHITECTURE.md](ARCHITECTURE.md) §"Per-file purpose" — where `loadKnowledge()` is called
- [DEVELOPMENT.md](DEVELOPMENT.md) — restart workflow when knowledge changes
