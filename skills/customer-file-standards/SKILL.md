---
name: customer-file-standards
description: Review customer-provided B2B website materials against the reusable customer file standards pack. Use when asked to check, audit, analyze, validate, or summarize whether a customer folder, uploaded materials package, spreadsheet, images, PDFs, or website content files meet the required preparation standards for brand assets, homepage, product category pages, product detail pages, about us, solutions, or case library content.
---

# Customer File Standards

## Overview

Use this skill to review a customer materials folder against the vendor-neutral standards pack in `standards/customer-file-review/`. The standards pack is the source of truth; this Codex skill is only a thin adapter.

## Required Workflow

1. Start only from an explicit review request. Do not infer that analysis should run just because files were uploaded.
2. Open `standards/customer-file-review/workflow.md`.
3. Open `standards/customer-file-review/status-definitions.md` and `standards/customer-file-review/report-template.md`.
4. Use `standards/customer-file-review/scripts/inventory_customer_files.py` on the customer folder when local filesystem access is available.
5. Read only the relevant module references from `standards/customer-file-review/references/`.
6. Compare customer evidence against the standards and produce the customer-facing bilingual report.

## Evidence Rules

- Cite concrete file paths, folder paths, spreadsheet field names, or quoted customer-provided text for every finding.
- Mark uncertainty as `需确认`; do not turn absence of evidence into a strict failure unless the reviewed folder clearly lacks a required item.
- Use Markdown references by default. Open `standards/customer-file-review/source-pdfs/` only when the Markdown is unclear, incomplete, or suspected to have conversion errors.

## Output

Default to the bilingual report format in `report-template.md`. Keep wording suitable for a customer-facing service agent or PM follow-up.
