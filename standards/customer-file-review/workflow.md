# Customer File Review Workflow

Use this workflow when a user explicitly asks an agent to review customer-provided website materials against the standards.

## Start Condition

Start analysis only from an explicit review request, such as:

- `Please review /path/to/customer-folder against the customer file standards.`
- `请根据客户资料标准检查这个客户文件夹：/path/to/customer-files`

Do not start automatically after upload, sync, or folder discovery.

## Source Order

1. Use this workflow, `status-definitions.md`, and `report-template.md`.
2. Select relevant Markdown references from `references/`.
3. Inventory the customer folder with `scripts/inventory_customer_files.py` when filesystem access is available.
4. Use `source-pdfs/` only if the Markdown reference is unclear, incomplete, or suspected to have conversion errors.

## Module Selection

Map customer folder names and file content to these references:

| Module | Reference |
|---|---|
| Overall orientation and project type | `references/00-start-here.md` |
| General preparation and image rules | `references/01-preparation-rules.md` |
| Brand assets | `references/03-brand-assets.md` |
| Homepage | `references/04-homepage.md` |
| Product category pages | `references/05-product-category.md` |
| Product detail pages | `references/06-product-detail.md` |
| About us | `references/07-about-us.md` |
| Solutions | `references/08-solutions.md` |
| Case library | `references/09-case-library.md` |

There is no `02` standard in this pack. Do not invent requirements for it.

## Review Steps

1. Identify the customer folder, project type if stated (`A 类` rebuild or `B 类` new site), and modules present.
2. Build a file inventory. Capture paths, file types, dimensions for images, and names of likely forms/spreadsheets.
3. Read the relevant reference files. For each module, separate required items from recommended items.
4. Compare evidence against the standards:
   - Required present and usable: `符合`
   - Required absent or clearly insufficient: `缺失`
   - Evidence ambiguous or needs customer confirmation: `需确认`
   - Present but can be improved: `可优化`
5. Cite evidence for every finding. Use file paths, folder paths, spreadsheet fields, or short quoted customer text.
6. Write the bilingual customer-facing report using `report-template.md`.

## Review Boundaries

- Do not perform SEO keyword research, rewrite copy, translate full content, or judge commercial claims unless asked separately.
- Do not claim image quality is acceptable from filename alone. If dimensions are unavailable or image content cannot be viewed, mark `需确认`.
- Do not require SEO naming from the customer; the standards say the service team handles SEO renaming.
- Do not require copy in any specific language; customer drafts in their preferred language are acceptable unless a specific professional term must be confirmed.
- Do not expose internal implementation details such as scripts or source PDFs in the customer-facing report.
