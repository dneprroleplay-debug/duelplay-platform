import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const API = "https://api-free.deepl.com/v2/translate";

export type DeepLTarget = "UK" | "EN" | "RU" | "PL";

// Process-local cache avoids a database round-trip for phrases requested again
// during the same server lifetime. TranslationCache is the persistent layer.
const cache = new Map<string, string>();

function key(target: DeepLTarget, source: string) {
  return `${target}:${source}`;
}

function sourceHash(source: string) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

async function loadPersistentCache(texts: string[], target: DeepLTarget) {
  const missing = texts.filter((text) => !cache.has(key(target, text)));
  if (!missing.length) return;

  try {
    const rows = await prisma.translationCache.findMany({
      where: {
        target,
        sourceHash: { in: missing.map(sourceHash) },
      },
      select: { source: true, translated: true },
    });
    for (const row of rows) cache.set(key(target, row.source), row.translated);
  } catch (error) {
    // The cache must never break translation or any page if the migration has
    // not been deployed yet. The API simply falls back to DeepL.
    console.error("[DeepL] persistent cache read failed", error);
  }
}

export async function translateTexts(
  texts: string[],
  target: DeepLTarget
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueTexts = [...new Set(texts.map((text) => text.trim()).filter(Boolean))];
  if (uniqueTexts.length === 0) return result;

  await loadPersistentCache(uniqueTexts, target);

  const missingTexts = uniqueTexts.filter((text) => {
    const cached = cache.get(key(target, text));
    if (cached) {
      result.set(text, cached);
      return false;
    }
    return true;
  });

  if (missingTexts.length === 0) return result;

  const body = new URLSearchParams();
  for (const text of missingTexts) body.append("text", text);
  body.set("target_lang", target);

  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    console.error("[DeepL] DEEPL_API_KEY is missing");
    return result;
  }

  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[DeepL]", res.status, errorText);
    return result;
  }

  const data = (await res.json()) as { translations?: Array<{ text?: string }> };
  const translations = data.translations || [];
  const rows: Array<{ target: DeepLTarget; sourceHash: string; source: string; translated: string }> = [];

  missingTexts.forEach((source, index) => {
    const translated = translations[index]?.text;
    if (!translated) return;
    cache.set(key(target, source), translated);
    result.set(source, translated);
    rows.push({ target, sourceHash: sourceHash(source), source, translated });
  });

  if (rows.length) {
    try {
      await prisma.translationCache.createMany({ data: rows, skipDuplicates: true });
    } catch (error) {
      // A concurrent request may have inserted the same phrase. Translation
      // itself succeeded, so a cache write failure is non-fatal.
      console.error("[DeepL] persistent cache write failed", error);
    }
  }

  return result;
}

export async function translateText(text: string, target: DeepLTarget) {
  const result = await translateTexts([text], target);
  return result.get(text) || text;
}
