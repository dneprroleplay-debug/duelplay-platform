# DuelPlay v30 — Unified UI language pass

- Added a centralized `lib/ui-i18n.ts` translation bridge for hard-coded UI text that bypassed the existing locale dictionaries.
- Added `GlobalUiI18n` to the root layout so dynamically rendered text, placeholders, titles and aria-labels are normalized to the selected RU/UA/EN/PL language.
- Control Center (`/admin/operations`) now uses the same centralized translation bridge instead of its private translation object.
- Kept the existing locale dictionaries and `useLanguage()` API intact for all already-localized sections.
- Added `scripts/i18n-audit.mjs` for future hard-coded English UI audits.

Validation note: this artifact was not build-validated in the container because dependencies are not included in the ZIP. Run `npx tsc --noEmit --pretty false` and `npm run build` locally after replacing the project files.
