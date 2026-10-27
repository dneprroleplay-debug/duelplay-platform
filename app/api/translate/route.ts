import { NextRequest, NextResponse } from "next/server";
import { translateTexts, DeepLTarget } from "@/lib/deepl";
import { prisma } from "@/lib/prisma";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";

const LANGUAGE_MAP: Record<string, DeepLTarget> = {
  UA: "UK",
  UK: "UK",
  EN: "EN",
  RU: "RU",
  PL: "PL",
};

const MAX_ITEMS = 250;
const DEEPL_BATCH_SIZE = 50;
const MAX_CONCURRENT_BATCHES = 2;
const MAX_TEXT_LENGTH = 500;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "TRANSLATE_API", 30, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      return NextResponse.json({ error: "Translation rate limit exceeded" }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[i18n] translation rate-limit persistence failed", error);
    return NextResponse.json({ error: "Translation service temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const body = await request.json().catch(() => null);

    const target = LANGUAGE_MAP[String(body?.target || "").toUpperCase()];
    const texts = Array.isArray(body?.texts) ? body.texts : [];

    if (!target) {
      return NextResponse.json(
        { error: "Invalid target language" },
        { status: 400 }
      );
    }

    if (texts.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: "Too many texts" },
        { status: 400 }
      );
    }

    const cleanTexts: string[] = texts
      .map((value: unknown) => String(value ?? "").trim())
      .filter((value: string) => value.length > 0 && value.length <= MAX_TEXT_LENGTH);

    const uniqueTexts: string[] = [...new Set<string>(cleanTexts)];

    const translationsMap = new Map<string, string>();

    for (let start = 0; start < uniqueTexts.length; start += DEEPL_BATCH_SIZE * MAX_CONCURRENT_BATCHES) {
      const batches: string[][] = [];
      for (let offset = 0; offset < MAX_CONCURRENT_BATCHES; offset += 1) {
        const batch = uniqueTexts.slice(
          start + offset * DEEPL_BATCH_SIZE,
          start + (offset + 1) * DEEPL_BATCH_SIZE,
        );
        if (batch.length) batches.push(batch);
      }

      const results = await Promise.all(batches.map((batch) => translateTexts(batch, target)));
      for (const result of results) {
        for (const [source, translated] of result.entries()) {
          translationsMap.set(source, translated);
        }
      }
    }

    const translations = uniqueTexts.map((text) => ({
      text,
      translated: translationsMap.get(text) || text,
    }));

    return NextResponse.json(
      { translations },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error) {
    console.error("[i18n] translation request failed after rate-limit check", error);

    return NextResponse.json(
      { error: "Translation service unavailable" },
      { status: 503 }
    );
  }
}
