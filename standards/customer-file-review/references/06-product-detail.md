# 06 Product Detail Pages / 产品详情页

Source PDF: `../source-pdfs/06-产品详情页 · 填写规范.pdf`

## Scope

Product detail materials are usually the largest workload. The customer provides core product facts and original images in the language they are most comfortable using. The service team handles target-language product naming, introduction polishing, long-tail keyword research, image renaming, compression, and alt text.

## Required Items

| Item | Requirement | Evidence to Check |
|---|---|---|
| Product detail form/table | One row per core product, especially for first launch products. | `06-产品详情【填写表】` or equivalent spreadsheet. |
| Category | Category matching the product category table. | Product row field. |
| Product name | Product name in any customer-preferred language. | Product row field. |
| Model | Product model number. | Product row field. |
| Product introduction | 200-400 words or equivalent detail in any customer-preferred language. | Product row field. |
| Selling points | Multiple real selling points. | Product row field. |
| Usage scenarios | Typical industry/application/use. | Product row field. |
| Specifications | Precise key-value specs where possible. | Product row field. |
| Image folder name | Folder name corresponding to the product image folder. | Product row field plus folder path. |
| Main image filename | Main product image inside the folder. | Product row field plus image file. |
| Product images | At least 3 clear images per product; width should not be below `900px` when measurable. | Files under `06-产品详情/<category>/<product>/` or equivalent. |

## Required Items for A-Type Rebuild

| Item | Requirement |
|---|---|
| Old product URL list | Provide old product URLs and indicate how each should be handled. |
| Updated product images | Old low-resolution images must be replaced or supplemented. |

## Recommended Items

| Item | Recommendation |
|---|---|
| Product manual/spec sheet | Optional PDF filename in the product row. |
| Benefit-oriented selling points | Feature -> Advantage -> Benefit is preferred, but the service team can complete benefits if the customer provides the feature. |

## Specification Format

Use line-separated key-value pairs when possible:

```text
Capacity: 500ml
Material: 304 Food-grade Stainless Steel
Insulation: 12h Hot / 24h Cold
Lid Type: Flip-top, BPA-free
Weight: 320g | MOQ: 500 pcs
Logo Options: Laser Engraving / Silk Screen / UV Print
```

## Review Notes

- If a product has fewer than 3 images, mark that product's image requirement `缺失`.
- If dimensions cannot be measured, mark resolution `需确认`.
- Do not mark missing URL slug, title, meta, or keywords as a customer gap.
