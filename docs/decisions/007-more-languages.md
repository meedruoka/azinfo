# 007: Five more languages, and right-to-left

- **Status:** Implemented on `main` after 0.1.2; not released (no store submission without the owner's go-ahead). Translations are machine-quality
  drafts, waiting for native review (as in 005).
- **Date:** 2026-11-20

## Decision

1. **Cover the world's ten most spoken languages** (by total speakers, Ethnologue-style ranking):
   English, Mandarin, Hindi, Spanish, French, Arabic, Bengali, Portuguese, Russian, Urdu. azinfo
   already had English, Mandarin (`zh_CN`), Spanish, French and Portuguese (`pt_BR`). Added:
   **Hindi (`hi`), Bengali (`bn`), Russian (`ru`), Arabic (`ar`)**.
2. **Urdu is replaced by Indonesian (`id`).** Urdu isn't in Chrome's list of supported extension
   locales, and Chrome ignores unsupported locale folders. Indonesian is supported and ranks
   around tenth too. azinfo now ships 15 languages.
3. **Right-to-left (Arabic).** Overrides decision 005's "no right-to-left". Each UI sets `dir`
   from Chrome's predefined `@@bidi_dir` message: the popup and options page on `<html>`, the
   panel on its own root inside the shadow root (the portal's direction doesn't leak in, and the
   panel stays bottom-right). The CSS uses logical properties (`inset-inline-end`,
   `margin-inline-start`, `text-align: end`…) so everything mirrors without separate rules.
   Resource names and types keep their own direction (`unicode-bidi: plaintext`), and the
   meter lines isolate the amount and the share in `<bdi>`: Arabic money formatting starts with
   a right-to-left mark, which otherwise reorders "452.17 US$ · 36%".
4. **Plurals.** `tp()` picks `_one` or `_other`. Russian and Arabic have more plural forms, so
   their `_other` texts are phrased with the count after a colon ("…: 3") instead of an inflected
   noun, which reads correctly for any number.
5. **Kept in English**, as in 005: azinfo, Azure, Microsoft, Azure Advisor, Cost Management
   Reader, App Service plan, `organizations`, `common`, example tenant domains, and everything
   that comes from Azure.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Tests: every locale has the same keys and substitutions as English; the manifest summary stays under 132 characters | Automated |
| 2 | `check:manifest` expects all 15 locales in both builds | Automated |
| 3 | Arabic layout: popup, options page and panel mirror correctly | Panel and popup checked 2026-11-20 on the screenshot page (`?scene=…&lang=ar`), then **passed 2026-11-21 in Edge set to Arabic** with the 0.1.3 test build (reported by the user). An earlier "still English" was an old local package without the new languages |
| 4 | Native review of the five new languages | Pending |
| 5 | Store listings in the new languages | Pending |
