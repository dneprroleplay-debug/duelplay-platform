"use client";

import { useEffect, useRef } from "react";
import { useLanguage } from "./LanguageContext";
import type { UiLanguage } from "../../lib/ui-i18n";
import { translateDuelPlayTerm } from "../../lib/duelplay-terminology";
import { translateCanonicalUi } from "../../lib/locale-i18n";

type TranslationResult = { text: string; translated: string };
type ProcessedText = { source: string; translated: string };

const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT)$/i;
const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label", "aria-description"] as const;

// One small, auditable allow-list for values that must never be translated.
// Everything else is eligible for translation. Add exceptions here only when
// the product intentionally uses a fixed technical/proper name.
const NON_TRANSLATABLE_EXACT = new Set([
  "DUELPLAY", "CS2", "Steam", "USD", "EUR", "PLN", "UAH", "XP", "ELO", "K/D", "REP", "HS%", "Lv", "LV", "Lv.", "LIVE",
  "Counter-Strike 2", "Mirage", "W", "L", "Dust2", "Dust 2", "Ancient", "Train", "Overpass", "Inferno", "Nuke", "Anubis", "Aim Redline", "Aim Dust2", "Pool Day (Classic)", "1v1 Aim Map", "1v1 - Remastered", "1v1 Oasis", "1v1 v3", "1v1 Arena", "1v1 Anubis Aim", "Aim Halloween 1v1",
  "1x1", "1X1", "1v1", "1V1", "1×1", "1х1", "1Х1", "1С...1", "1C...1",
]);

function shouldSkipElement(element: HTMLElement | null) {
  if (!element) return true;
  if (SKIP_TAGS.test(element.tagName)) return true;
  if (element.closest("[data-no-i18n]")) return true;
  if (element.closest("[data-player-name]")) return true;
  if (element.closest("[data-brand]")) return true;
  if (element.closest("[data-home-intro]")) return true;
  return false;
}

const MANUAL_MARKETING_TRANSLATIONS: Record<string, Partial<Record<UiLanguage, string>>> = {
  "Prove you are the best.": { RU: "Докажи, что ты лучший.", UA: "Доведи, що ти найкращий.", PL: "Udowodnij, że jesteś najlepszy." },
  "Take the pot.": { RU: "Забери банк.", UA: "Забери банк.", PL: "Zgarnij pulę." },
  "JOINED.\nWON.\nCLAIMED.": { RU: "ЗАШЕЛ.\nПОБЕДИЛ.\nЗАБРАЛ.", UA: "ЗАЙШОВ.\nПЕРЕМІГ.\nЗАБРАВ.", PL: "WSZEDŁEŚ.\nWYGRAŁEŚ.\nODEBRAŁEŚ." },
  "One opponent, one match, and the entire pot goes to the winner. Prove your skill in the duel.": {
    RU: "Один соперник, один матч и весь банк достается победителю. Докажи свой скилл в дуэли.",
    UA: "Один суперник, один матч — і весь банк отримує переможець. Доведи свій скіл у дуелі.",
    PL: "Jeden przeciwnik, jeden mecz, a całą pulę zgarnia zwycięzca. Udowodnij swój skill w pojedynku."
  },
};

function manualTranslation(text: string, target: UiLanguage) {
  const value = text.trim();
  if (target === "EN") return value;
  return MANUAL_MARKETING_TRANSLATIONS[value]?.[target] || null;
}

function isProtectedUiValue(text: string) {
  const value = text.trim();
  if (NON_TRANSLATABLE_EXACT.has(value)) return true;
  if (/^\d+\s*[×xхХvV]\s*XP$/i.test(value)) return true;
  if (/^\d+\s*[xXхХсСcC]\s*\.{2,}\s*\d+$/i.test(value)) return true;
  if (/^\d+\s*[×xхХvV]\s*\d+$/i.test(value)) return true;
  if(/^\s*Lv\.?\s*\d+(?:\s*[·•].*)?$/i.test(value)) return true;
  if (/^[$€£₴]?\d+(?:[.,]\d+)?(?:\s*[+±-]\s*\d+)?$/.test(value)) return true;
  return false;
}

function shouldTranslateText(text: string, target: UiLanguage) {
  const value = text.trim();
  if (!value || value.length > 500) return false;
  if (!/[A-Za-zА-Яа-яЁёІіЇїЄєҐґ]/.test(value)) return false;
  if (isProtectedUiValue(value)) return false;
  // EN is the canonical language. Normally English needs no API call, but the
  // legacy codebase still contains a few Cyrillic strings; translate those only.
  if (target === "EN" && !/[А-Яа-яЁёІіЇїЄєҐґ]/.test(value)) return false;
  return true;
}

function preserveWhitespace(source: string, translated: string) {
  const leading = source.match(/^\s*/)?.[0] || "";
  const trailing = source.match(/\s*$/)?.[0] || "";
  return `${leading}${translated}${trailing}`;
}

export default function GlobalUiI18n() {
  const { language } = useLanguage();
  const lang = language as UiLanguage;
  const processed = useRef(new WeakMap<Node, ProcessedText>());
  const cache = useRef(new Map<string, string>());
  const cacheLoaded = useRef(false);
  const running = useRef(false);
  const rerunAfterCurrent = useRef(false);
  const scheduled = useRef(false);

  useEffect(() => {
    // A fresh map is required for every selected language. The DOM itself is
    // recreated from the English source after a reload, so we never translate
    // Polish -> Ukrainian or Ukrainian -> Russian by accident.
    processed.current = new WeakMap<Node, ProcessedText>();

    let disposed = false;
    let timer: number | null = null;

    if (!cacheLoaded.current) {
      try {
        const saved = window.localStorage.getItem("duelplay-i18n-cache-v12");
        if (saved) {
          const parsed = JSON.parse(saved) as Record<string, string>;
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "string" && value.length <= 2000) cache.current.set(key, value);
          }
        }
      } catch {}
      cacheLoaded.current = true;
    }

    const persistCache = () => {
      try {
        window.localStorage.setItem(
          "duelplay-i18n-cache-v12",
          JSON.stringify(Object.fromEntries(cache.current.entries()))
        );
      } catch {}
    };

    const translateBatch = async (texts: string[]) => {
      if (!texts.length || disposed) return new Map<string, string>();
      const out = new Map<string, string>();
      const missing: string[] = [];

      for (const text of texts) {
        const key = `${lang}:${text}`;
        const cached = cache.current.get(key);
        if (cached) out.set(text, cached);
        else missing.push(text);
      }

      // The API route persists the same cache in the database, so the first
      // visitor pays for a new phrase and later visitors reuse it.
      for (let start = 0; start < missing.length; start += 250) {
        if (disposed) break;
        const chunk = missing.slice(start, start + 250);
        try {
          const response = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: lang, texts: chunk }),
          });
          if (!response.ok) continue;
          const data = (await response.json()) as { translations?: TranslationResult[] };
          for (const item of data.translations || []) {
            if (!item?.text || !item?.translated) continue;
            cache.current.set(`${lang}:${item.text}`, item.translated);
            out.set(item.text, item.translated);
          }
        } catch {}
      }
      return out;
    };

    const translatePage = async () => {
      if (disposed) return;
      if (running.current) {
        rerunAfterCurrent.current = true;
        return;
      }
      running.current = true;
      rerunAfterCurrent.current = false;

      try {
        const pending = new Map<string, Node[]>();
        const pendingAttributes = new Map<string, Array<{ element: HTMLElement; attribute: (typeof TRANSLATABLE_ATTRIBUTES)[number] }>>();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;

        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (shouldSkipElement(parent)) continue;
          const current = node.nodeValue || "";
          if (!shouldTranslateText(current, lang)) continue;

          const previous = processed.current.get(node);
          if (previous && current === previous.translated) continue;
          const source = previous && current === previous.source ? previous.source : current;
          const canonical = translateCanonicalUi(lang, source);
          if (canonical) {
            const normalized = canonical.trim();
            node.nodeValue = preserveWhitespace(current, canonical);
            processed.current.set(node, { source, translated: normalized });
            continue;
          }
          const terminology = translateDuelPlayTerm(lang, source);
          if (terminology) {
            const normalized = terminology.trim();
            node.nodeValue = preserveWhitespace(current, terminology);
            processed.current.set(node, { source, translated: normalized });
            continue;
          }
          const manual = manualTranslation(source, lang);
          if (manual) {
            node.nodeValue = preserveWhitespace(current, manual);
            processed.current.set(node, { source, translated: manual });
            continue;
          }

          if (lang === "EN") {
            // English is canonical; only legacy non-English text reaches here.
            const list = pending.get(source.trim()) || [];
            list.push(node);
            pending.set(source.trim(), list);
            continue;
          }

          const key = `${lang}:${source.trim()}`;
          const cached = cache.current.get(key);
          if (cached) {
            node.nodeValue = preserveWhitespace(current, cached);
            processed.current.set(node, { source, translated: cached });
            continue;
          }

          const list = pending.get(source.trim()) || [];
          list.push(node);
          pending.set(source.trim(), list);
        }

        const elements = document.body.querySelectorAll<HTMLElement>("*");
        for (const element of elements) {
          if (shouldSkipElement(element)) continue;
          for (const attribute of TRANSLATABLE_ATTRIBUTES) {
            const current = element.getAttribute(attribute);
            if (!current || !shouldTranslateText(current, lang) || isProtectedUiValue(current)) continue;
            const source = element.getAttribute(`data-i18n-source-${attribute}`) || current;
            const canonical = translateCanonicalUi(lang, source);
            if (canonical) {
              element.setAttribute(attribute, canonical);
              element.setAttribute(`data-i18n-source-${attribute}`, source);
              continue;
            }

            if (lang !== "EN") {
              const cached = cache.current.get(`${lang}:${source.trim()}`);
              if (cached) {
                element.setAttribute(attribute, cached);
                element.setAttribute(`data-i18n-source-${attribute}`, source);
                continue;
              }
            }

            const list = pendingAttributes.get(source.trim()) || [];
            list.push({ element, attribute });
            pendingAttributes.set(source.trim(), list);
          }
        }

        const all = [...new Set([...pending.keys(), ...pendingAttributes.keys()])];
        const translations = await translateBatch(all);

        for (const [source, nodes] of pending) {
          const translated = lang === "EN" ? translations.get(source) : translations.get(source);
          if (!translated) continue;
          for (const textNode of nodes) {
            if (!textNode.parentElement || shouldSkipElement(textNode.parentElement)) continue;
            const current = textNode.nodeValue || "";
            if (current !== translated) textNode.nodeValue = preserveWhitespace(current, translated);
            processed.current.set(textNode, { source, translated });
          }
        }

        for (const [source, targets] of pendingAttributes) {
          const translated = translations.get(source);
          if (!translated) continue;
          for (const target of targets) {
            if (!target.element.isConnected || shouldSkipElement(target.element)) continue;
            target.element.setAttribute(target.attribute, translated);
            target.element.setAttribute(`data-i18n-source-${target.attribute}`, source);
          }
        }

        if (all.length && lang !== "EN") persistCache();
      } catch (error) {
        console.error("[GlobalUiI18n]", error);
      } finally {
        running.current = false;
        scheduled.current = false;
        if (rerunAfterCurrent.current && !disposed) schedule();
      }
    };

    function schedule() {
      if (disposed) return;
      if (running.current) {
        rerunAfterCurrent.current = true;
        return;
      }
      if (scheduled.current) return;
      scheduled.current = true;
      timer = window.setTimeout(() => {
        timer = null;
        void translatePage();
      }, 50);
    }

    void translatePage();
    const observer = new MutationObserver(() => schedule());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [lang]);

  return null;
}
