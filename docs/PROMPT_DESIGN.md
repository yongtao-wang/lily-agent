# Prompt Design

**TL;DR.** The system prompt has three knowledge layers (persona / stage-filtered scripts / unfiltered QA bank) and seven behavior rules, plus a conditional post-escalation directive. Each layer enforces a different concern: voice (persona), stage-appropriate content (scripts), question-pattern matching (QA), and policy (rules). Two of the rules pair with model tools — rule #4 gates `notify_project_manager`, rule #7 gates `review_customer_files`. The structure was chosen because over-constraining any single layer made responses brittle in testing.

This is the "unique IP" of the project. Most of it is not visible from reading code comments — it's rationale.

---

## 1. Why a layered prompt, not a single template

A single mega-template would be either too rigid (小鹏 mechanically repeats PM scripts) or too vague (小鹏 improvises timelines and pricing she shouldn't). The three knowledge layers address different failure modes:

| Layer | Source | Filtered by stage? | Failure mode it prevents |
|---|---|---|---|
| Persona | `knowledge/csr.md`, ~1500 tokens | No | Generic-chatbot voice; "亲～哦" customer-service tropes |
| Stage scripts | `knowledge/客服阶段话术库.xlsx` `话术库表` | Yes | Made-up timelines / deliverables / process steps |
| QA bank | `knowledge/客服阶段话术库.xlsx` `问答表` | No | Missing the standard answer to a known question |

Then seven **behavior rules** sit on top and enforce policy (passivity, format, escalation, file handling, materials review) that's orthogonal to content.

---

## 2. The persona file

`knowledge/csr.md` is injected verbatim at the top of the system prompt via:

```ts
`你是 小鹏。以下是你的人设档案：

${kb.persona}
```

What's in it:

- **Identity & role**: "AI出海营销顾问 / 智能客户成功助手", serving B2B 出海营销.
- **Tone keywords**: 专业但不冰冷, 理性、有逻辑, 国际化表达, 高效率, 像"项目顾问"而不是"客服".
- **Anti-examples**: explicitly contrasts "亲亲您好呢～请问有什么可以帮助您的呀～" (banned) with "您好，我是 小鹏. 我可以协助您了解 SEO、AI 搜索曝光、独立站增长以及海外获客相关问题。" (correct).
- **Boundary statements**: 不夸大效果, 不承诺虚假排名, 不使用"7天上首页"类表达, 不替代人工专家决策, 遇到复杂项目会转接专家团队.

This is the **soft layer**. It shapes voice and stance but doesn't dictate what to say. We rely on the model's instruction following to honor it.

---

## 3. Stage-filtered scripts

```ts
const stageScripts = stageId
  ? kb.scripts.filter((s) => s.stageId === stageId)
  : [];
```

When the customer is in `homepage`, only the homepage row of `话术库表` enters the prompt — a ~50-line block from PM's actual playbook ("请您提供图片格式的素材… 我们争取本周提供首页设计稿…"). When in `collection`, only the collection script appears (素材收集包 talking points).

The filter narrows Claude's vocabulary to *this stage's actual deliverables, timelines, and expectations*. Verified in the end-to-end tests (AC #4): customer said "我在首页设计阶段" and 小鹏 came back with "图片格式素材 / 素材越充足效果越好 / 本周内输出首页设计稿" — those exact concepts come from the homepage script.

The block ends with a critical anti-copy directive:

```
— 注意：以上话术是 PM 内部参考稿，**禁止原样复读**；按 小鹏 人设和当前对话上下文改写后输出，
  禁用诸如 "@业务负责人" 这类指向 PM 内部协作的措辞。
```

So Claude gets PM's raw notes but is told to paraphrase in 小鹏's voice. That's the bridge between layer 1 (persona) and layer 2 (content).

---

## 4. Full QA bank (unfiltered)

Unlike scripts, the QA table is **never filtered by stage**:

```ts
const qaBlock = kb.qa.length
  ? kb.qa.map((q, i) => `[${i + 1}] 阶段：${q.stageName}｜场景：${q.scenario || '—'}
客户原话：${q.question}
标准回复：${q.answer}`).join('\n\n')
  : '（暂无历史问答样本。）';
```

All 11 QA entries are injected with their stage label, plus the instruction "按相关度自行挑选" (pick by relevance). Why no filter:

- Customers don't stay neatly inside their current stage. Someone in `homepage` might ask an SEO question or a future-phase question.
- Pre-filtering by stage would blind 小鹏 to relevant standard answers that happen to be tagged with another stage.
- At 11 entries the unfiltered dump costs ~1000 tokens, which is acceptable.

At scale (~50+ entries) this design breaks; see §"Drift risks" below.

---

## 5. Behavior rules 1–7 (verbatim)

These live at the bottom of the system prompt. They're peers, not hierarchical. Each pairs a condition with a dialog constraint.

```
1. 被动应答：除问候和阶段引导外，不主动开启新话题。
2. 简洁有条理：句子简短，必要时用编号或要点。不使用"亲～""哦"等口语客服套话。
3. 涉及设计稿/网站预览时，使用占位链接：${config.placeholderDesignLink}
4. **以下情况必须调用 notify_project_manager 工具升级：**
   - 客户表达不满、抱怨、明显不耐烦
   - 客户询问报价、合同、退款、范围变更
   - 客户明确要求"找人"/"联系项目经理"
   - 同一问题客户追问 3 轮以上仍未解决
   - 问题超出本知识库范围（不要编造）
5. 调用 notify_project_manager 后，**继续陪客户**——客户仍可提问、上传文件，但你不再尝试独立解决，
   只做信息收集、共情回应、和"已通知，请稍候"的衔接。给客户的回复中应包含这层意思：
   "${config.escalation.handoffMessage}"
6. 当客户上传文件，简要确认收到并说明会一并转交。
7. 资料标准检查：
   - 只有当客户明确要求"检查/分析/审核/判断资料是否符合标准"时，才调用 review_customer_files 工具。
   - 客户只是上传文件、补充文件、说明文件内容时，不要调用 review_customer_files；只确认收到。
   - 客户可要求整体检查，也可要求某个方面（例如 首页、产品详情页、图片、品牌素材）。
     调用工具时按客户要求选择最接近的 scope。
   - 工具返回资料清单、可读内容和标准后，按客户可读的双语报告输出，所有结论必须引用
     精确文件路径、文件夹路径、字段或短句作为证据；证据不足时标记"需确认"，不要编造。
```

What each enforces:

| Rule | Trigger | Behavior |
|---|---|---|
| 1 | Default state | Stay passive — no proactive topic-starting |
| 2 | Always | Concise structure, no service-speak |
| 3 | Mention of design/preview | Use `https://example.com/preview` placeholder |
| 4 | Five enum conditions | Must call `notify_project_manager` |
| 5 | After tool call | Embed the `handoffMessage` semantics in reply |
| 6 | File attachment present | Acknowledge + promise to forward |
| 7 | Explicit "check / audit / review materials" intent | Call `review_customer_files` with the right `scope`, then write a bilingual report with file-path evidence |

Note that rules #4 and #7 conditions are stated as **concrete trigger sentences**, not "use judgment". That's why the model fires `notify_project_manager` reliably on "我想找人聊" (verified in AC #8/#11) and fires `review_customer_files` reliably on "请帮我整体检查一下我上传的资料" (verified in the file-review smoke test) — without needing keyword matching in code.

Rule #7 also has an explicit **negative** clause ("客户只是上传文件、补充文件、说明文件内容时，不要调用"). Without it, the model tended to fire the review tool on every upload turn, which is expensive and unhelpful when the customer is still mid-collection.

---

## 6. Tool schemas — code/prompt sync

Two tool schemas live alongside the prompt. Neither is auto-linked; you must edit both sides when changing enums.

### Escalation (`notify_project_manager`)

The tool schema in `lib/escalation.ts` has five `reason` enums:

```
customer_dissatisfied  ←→  rule #4 bullet 1 (不满、抱怨、不耐烦)
out_of_scope           ←→  rule #4 bullet 5 (超出知识库范围)
commercial             ←→  rule #4 bullet 2 (报价/合同/退款/范围变更)
explicit_request       ←→  rule #4 bullet 3 (明确要求"找人")
unresolved_after_3_rounds ←→  rule #4 bullet 4 (追问 3 轮以上)
```

If you add a sixth reason to the tool, you must also add a sixth bullet to rule #4. If you remove one, do both. There is no compile-time check.

### File review (`review_customer_files`)

The tool schema in `lib/file-review.ts` has ten `scope` enums and a required `request` string. Each scope drives `referencesForScope()`, which picks which Markdown files under `standards/customer-file-review/references/` get inlined into the tool_result:

```
overall          → all 9 module references (start-here + preparation + 7 modules)
preparation      → 01-preparation-rules.md
brand_assets     → 03-brand-assets.md
homepage         → 04-homepage.md
product_category → 05-product-category.md
product_detail   → 06-product-detail.md
about_us         → 07-about-us.md
solutions        → 08-solutions.md
case_library     → 09-case-library.md
images           → 01-preparation-rules.md + 03 + 04 + 06 (image-bearing modules)
```

The fixed files (`workflow.md`, `status-definitions.md`, `report-template.md`) are always included, so the model always sees the status vocabulary (`符合 / 缺失 / 需确认 / 可优化`) and the report shape.

Triple sync surface: if you add an eleventh scope, you must (1) add the enum value in `fileReviewTool.input_schema`, (2) add an entry to `referencesForScope()`, (3) add the matching `references/*.md` if it's a new module, and (4) optionally mention the new scope in rule #7's parenthetical example list. The prompt doesn't enumerate scopes — it relies on the tool schema's `description` — so rule #7 only needs editing if you want to nudge model choice.

---

## 7. Post-escalation override (dynamic)

After a tool call fires, `route.ts` calls `markEscalated(sessionId)`. On the **next** request, `buildSystemPrompt({..., escalated: true})` appends this block at the very end:

```
═══════════════════════════════
【当前状态】本会话已升级给项目经理。你只做：共情回应、信息收集、补充提问、提醒"PM 会主动联系"。
不要再尝试独立解决问题，也不要重复调用 notify_project_manager。
```

Three deliberate choices:

- **Appended at the bottom.** Last thing the model reads before responding. Recency bias works for us when expressing state changes.
- **Says "不要再尝试独立解决".** Without this, the model might keep offering solutions even after the tool fired — defeating the point of escalation.
- **Says "不要重复调用 notify_project_manager".** Without this, the model often re-fires the tool on every subsequent angry message, polluting the log.

Verified in AC #10: post-escalation, customer said "帮我换成蓝色的", 小鹏 recorded the request and forwarded to PM without trying to execute it herself.

---

## 8. Customer/stage block

Between persona and scripts:

```
═══════════════════════════════
【当前服务的客户】
- 公司：${config.demoCustomer.displayName}
- 对接人：${config.demoCustomer.contact}
- 当前项目阶段：${stageName ? `${stageName}（${stageId}）` : '客户尚未明确，请通过对话判断或委婉询问'}
```

The stage line branches:
- If `stageId` is set → "首页设计（homepage）"
- If unset (customer clicked 跳过 or hasn't chosen) → instruction to ask gently

Stage info lives in the customer block, not the rules block. That's intentional: 小鹏 uses it as context to interpret questions, not as a hard constraint that overrides judgment when the customer wanders cross-stage.

---

## 9. What is NOT enforced (and why)

Things I considered adding and rejected:

- **Format templates per stage** (e.g., "always end with a question in homepage"). Over-constrains, makes responses sound stamped.
- **Keyword blocklist beyond `亲～哦`**. The persona's positive examples crowd out bad patterns naturally.
- **"Must mention X" per stage**. Would force 小鹏 to always say "本周内交付" in homepage even when the question is about something unrelated. Bad UX.
- **Output length caps**. Sonnet 4 already self-limits to a few hundred Chinese chars per turn; an explicit cap would feel artificial.
- **Forced tool result wording**. Rule #5 says "回复中应包含这层意思" but doesn't force exact text. Verified the model paraphrases in 小鹏's voice ("我已经将您的反馈和当前情况完整同步给您的项目经理…") which is more natural than a stamped phrase.

---

## 10. Cost per turn

Approximate token cost per user message:

| Component | Tokens (approx) |
|---|---|
| Persona (csr.md) | 1500 |
| Customer/stage block | 50 |
| Stage scripts (filtered) | 100–400 |
| Full QA bank | 1000 |
| Behavior rules 1–7 | 500 |
| Escalated block (conditional) | 80 |
| Conversation history | grows per turn |
| **Subtotal system** | **~3100** |

At Sonnet-4 input pricing (~$3/M tokens), the system prompt alone costs ~$0.009 per turn. A 20-turn conversation is ~$0.18 baseline + output + history.

Tool round trips add input cost on top:

- **Escalation turn**: roughly doubles input (system prompt re-sent for the post-tool continuation).
- **File-review turn**: heaviest path. The tool_result includes the file inventory, extracted content (capped at `maxExtractCharsPerFile = 6000` chars × up to `maxFilesPerReview = 40` files), the workflow / status / template trio, and the scope's reference Markdown(s). A typical `overall` review against ~10 files sends 15–40 K input tokens just for the tool_result — multiples of the base system prompt. Sub-scope reviews (`homepage`, `images`, etc.) load fewer references and are correspondingly cheaper.

**Easy 10× win**: mark persona + QA bank as `cache_control: { type: 'ephemeral' }`. The first request still pays full price; subsequent requests within 5 minutes read cached tokens at 1/10th cost. Single change in `lib/claude.ts`:

```ts
system: [
  { type: 'text', text: <persona + scripts + QA>, cache_control: { type: 'ephemeral' } },
  { type: 'text', text: <customer block + rules + escalated directive> },
]
```

Not done yet because SDK 0.32.1 supports it but I didn't want to add complexity for the demo. See `docs/ARCHITECTURE.md` "Known issues" for the SDK version note.

---

## 11. Drift risks

Things that work today but will get worse:

1. **QA bank scaling.** At 50+ entries, the unfiltered dump becomes expensive and noisy. Switch to embedding-based retrieval (top-K by similarity to the user's latest message). The `prompt.ts` interface accepts this — only `buildSystemPrompt` body changes.

2. **Stage-tone drift.** If PM's `homepage` script reads more formal than their `collection` script, 小鹏's voice shifts when stage changes. Mitigation: add a sentence in rule #2 like "tone stays consistent across stages regardless of script formality".

3. **Persona vs. script ambiguity.** `csr.md` casts 小鹏 as a strategic GEO / AI Search consultant; the xlsx scripts cast her as a delivery-phase checklist runner. If a customer in `seo` stage asks deep GEO strategy questions, the two roles can conflict. This is in the source materials, not the code; product team should pick a stance.

4. **No prompt-level test harness.** Manual testing covered the 13 ACs. For ongoing quality (especially after edits to the prompt), a fixtures file with `(question, expected-traits)` pairs + a model judge would catch regressions. Not in scope for MVP.

---

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — where `buildSystemPrompt` is called from
- [ESCALATION.md](ESCALATION.md) — the tool schema referenced by rule #4
- [FILE_REVIEW.md](FILE_REVIEW.md) — the tool schema referenced by rule #7, plus the standards corpus
- [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md) — where the persona / scripts / QA come from
