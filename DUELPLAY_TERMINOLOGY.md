# DuelPlay terminology

English is the canonical source language. `lib/duelplay-terminology.ts` contains deliberate product translations for important gaming/product terms.

Global DOM translation checks this dictionary before DeepL. This prevents context-sensitive terms such as `Case` or `Chat` from becoming literal machine translations.

Add a term here only when its DuelPlay meaning should be controlled. All other UI text can continue through the normal translation cache/DeepL flow.
