# DuelPlay translation architecture

- English (`EN`) is the single canonical UI source language.
- `LanguageContext` always exposes the English locale dictionary to components.
- The selected language only controls the global translation layer.
- `GlobalUiI18n` translates eligible visible text, placeholders, titles, aria labels and `<option>` labels.
- `EN` does not call DeepL for normal English UI text. Legacy Cyrillic text is translated to English only when encountered.
- `RU`, `UA` and `PL` use DeepL for missing phrases.
- Browser cache (`duelplay-i18n-cache-v7`) avoids repeat requests from the same browser.
- `TranslationCache` in PostgreSQL is the persistent translation memory shared across visitors and deployments. A phrase is paid for once per target language, then reused.
- DeepL requests are sent in chunks of up to 50 texts; the public route accepts up to 250 unique texts per request.
- A small centralized allow-list contains only values that must never be translated (brand, CS2/Steam/XP identifiers, map names, formats, player names marked with `data-player-name`, etc.).
- User-entered input values are never translated; placeholders are translated.

## Database deployment

After installing dependencies, apply the included migration before relying on the persistent cache:

```powershell
npx prisma migrate deploy
npx prisma generate
```

If the project is already using `prisma db push` as its deployment workflow, the new `TranslationCache` model is also included in the schema and will be created by that workflow.
