# 005: Languages

- **Status:** Implemented. The translations are machine-quality drafts, waiting for native review.
- **Date:** 2026-10-05

## Decision

1. **10 languages:** English (default), French, German, Spanish, Portuguese (Brazil), Italian,
   Dutch, Japanese, Chinese (Simplified) and Korean. Right-to-left languages (Arabic, Hebrew) are
   left out: the panel layout would need mirroring.
2. **Browser extension i18n** (`public/_locales/<lang>/messages.json`, `default_locale: "en"`).
   azinfo follows the browser's UI language, and Chrome falls back to English per missing
   message. No new dependency or permission. The manifest description is translated too (the
   store summary, max 132 characters, checked by a test).
3. `lib/i18n.ts`: `t(key, ...subs)` with typed keys, plus `tp()` for plurals (`_one` / `_other`
   picked by `Intl.PluralRules`). The English file is also bundled, so text never disappears
   where the browser API is missing (tests).
4. **Numbers, money, percentages and times** use the same UI language (`1 234,50 €`, `+12 %` in
   French).
5. **Kept in English on purpose:** product and role names (Azure Advisor, Cost Management Reader,
   App Service plan), values to type (`organizations`, `common`), and everything that comes from
   Azure: meter category names, Advisor tip text, and technical error messages.

## Guarded by tests

- Every language has exactly the English keys, the same `$1`…`$9` slots, and no stray `$`.
- Product and role names are still present in every language.
- No English text is left hard-coded in the panel, popup or options page (JSX text and readable
  attributes).
- `check:manifest` requires `default_locale`, the translated description and all 10 languages in
  the package.

## Still to do

| # | Item | Status |
|---|---|---|
| 1 | Native review: French (the user), then German and Japanese at least | Pending |
| 2 | Store listings: enter the translated name/summary/description per language in each store dashboard | Pending |
| 3 | Check whether Advisor returns tip text in the user's language when asked (`Accept-Language`) | Not checked |
