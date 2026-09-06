import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getFeatureFlag } from "@/lib/platform-settings";
import { debitWallet } from "@/lib/wallet";
import { enforceRateLimit } from "@/lib/rate-limit";
import { pickWeightedCaseItem } from "@/lib/case-roll";
import { normalizeCaseRarity, rarityChancePercent } from "@/lib/case-rarity";
import { refreshEventMissionsForUser } from "@/lib/event-pass";
import { assertAbuseGuard, assertAccountCanPlay } from "@/lib/anti-fraud";
import { assertCaseEconomy } from "@/lib/case-economy";

const DEFAULT_CASES: Array<{ slug: string; name: string; description: string; price: number; imageUrl: string; items: Array<[string, string, string, number, number]> }> = [
  { slug: "starter", name: "Starter Case", description: "Быстрый шанс получить первый предмет DuelPlay.", price: 1, imageUrl: "/images/maps/mirage.jpg", items: [
    ["Pistol Core", "/case-items/common.svg", "Common", 0.50, 72], ["Emerald Fang", "/case-items/uncommon.svg", "Uncommon", 1.20, 20],
    ["Azure Strike", "/case-items/rare.svg", "Rare", 2.50, 6], ["Violet Pulse", "/case-items/epic.svg", "Epic", 5, 1], ["Gold Reaper", "/case-items/legendary.svg", "Legendary", 12, 1]
  ] },
  { slug: "neon", name: "Neon Duel Case", description: "Неоновый кейс с редкими наградами.", price: 3, imageUrl: "/images/maps/ancient.jpg", items: [
    ["Emerald Fang", "/case-items/uncommon.svg", "Uncommon", 1.50, 68], ["Azure Strike", "/case-items/rare.svg", "Rare", 3.50, 22],
    ["Violet Pulse", "/case-items/epic.svg", "Epic", 7, 7], ["Gold Reaper", "/case-items/legendary.svg", "Legendary", 15, 2], ["Neon Wolf", "/case-items/mythic.svg", "Mythic", 30, 1]
  ] },
  { slug: "premium", name: "Premium Arsenal", description: "Премиальный кейс для охотников за редкими предметами.", price: 10, imageUrl: "/images/maps/nuke.jpg", items: [
    ["Azure Strike", "/case-items/rare.svg", "Rare", 5, 65], ["Violet Pulse", "/case-items/epic.svg", "Epic", 12, 25],
    ["Gold Reaper", "/case-items/legendary.svg", "Legendary", 28, 9], ["Neon Wolf", "/case-items/mythic.svg", "Mythic", 80, 1]
  ] }
];

async function ensureCases() {
  for (const c of DEFAULT_CASES) {
    const existing = await prisma.duelCase.findUnique({ where: { slug: c.slug }, include: { items: true } });
    if (!existing) {
      assertCaseEconomy(c.price, c.items.map((x) => ({ value: x[3], weight: x[4] })));
      await prisma.duelCase.create({ data: { slug: c.slug, name: c.name, description: c.description, price: c.price, imageUrl: c.imageUrl, items: { create: c.items.map((x) => ({ name: x[0], imageUrl: x[1], rarity: x[2], value: x[3], weight: x[4] })) } } });
    } else {
      const legacy = c.slug === "starter" ? [50,28,14,6,2] : c.slug === "neon" ? [42,30,18,8,2] : [35,35,25,5];
      const legacyMatch = existing.items.length === legacy.length && existing.items.every((item, index) => Number(item.weight) === legacy[index]);
      if (legacyMatch) {
        await prisma.$transaction(c.items.map((x, index) => prisma.duelCaseItem.update({ where: { id: existing.items[index].id }, data: { name: x[0], imageUrl: x[1], rarity: x[2], value: x[3], weight: x[4] } })));
      }
      if (existing.imageUrl !== c.imageUrl || existing.description !== c.description) {
        await prisma.duelCase.update({ where: { id: existing.id }, data: { imageUrl: c.imageUrl, description: c.description } });
      }
    }
  }
  return prisma.duelCase.findMany({ where: { active: true }, include: { items: { orderBy: { value: "asc" } } }, orderBy: { price: "asc" } });
}

function resultPayload(item: { id: string; name: string; imageUrl: string; rarity: string; value: unknown }) {
  return { id: item.id, name: item.name, imageUrl: item.imageUrl, rarity: item.rarity, value: Number(item.value) };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const openingKey = String(request.nextUrl.searchParams.get("openingKey") || "").trim();
    if (openingKey) {
      if (!user) return NextResponse.json({ error: "Войдите в аккаунт", errorCode: "AUTH_REQUIRED" }, { status: 401 });
      if (openingKey.length > 200) return NextResponse.json({ error: "Invalid opening key" }, { status: 400 });
      const idempotencyKey = `${user.id}:${openingKey}`;
      const opening = await prisma.caseOpening.findUnique({
        where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
        include: { resultItem: true, case: { select: { slug: true } } },
      });
      if (!opening) return NextResponse.json({ found: false });
      return NextResponse.json({
        found: true,
        opening: { id: opening.id, slug: opening.case.slug, status: opening.status, completedAt: opening.completedAt },
        item: resultPayload(opening.resultItem),
      });
    }
    const cases = await ensureCases();
    return NextResponse.json(cases.map((c) => ({ ...c, price: Number(c.price), items: c.items.map((i) => ({ ...i, value: Number(i.value), rarityChance: rarityChancePercent(i.rarity, c.items.map((x) => ({ rarity: x.rarity, weight: x.weight }))) })) })));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось загрузить кейсы" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let requestClientKey = "";
  let requestedSlug = "";
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Войдите в аккаунт", errorCode: "AUTH_REQUIRED" }, { status: 401 });
    if (!(await getFeatureFlag("CASES", true))) return NextResponse.json({ error: "Cases are temporarily disabled" }, { status: 503 });

    const body = await request.json().catch(() => ({}));
    const slug = String(body.slug || "").trim();
    requestedSlug = slug;
    const clientKey = String(request.headers.get("idempotency-key") || body.idempotencyKey || "").trim();
    requestClientKey = clientKey;
    if (!clientKey || clientKey.length > 200) return NextResponse.json({ error: "A valid Idempotency-Key is required" }, { status: 400 });

    const cases = await ensureCases();
    const box = cases.find((c) => c.slug === slug && c.active);
    if (!box) return NextResponse.json({ error: "Кейс не найден" }, { status: 404 });
    const idempotencyKey = `${user.id}:${clientKey}`;
    const previous = await prisma.caseOpening.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
      include: { resultItem: true, case: { select: { slug: true } } },
    });
    if (previous) {
      if (previous.case.slug !== box.slug) return NextResponse.json({ error: "Этот Idempotency-Key уже использован для другого кейса", errorCode: "IDEMPOTENCY_KEY_REUSED" }, { status: 409 });
      return NextResponse.json({ ok: true, idempotent: true, item: resultPayload(previous.resultItem) });
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentCase = await tx.duelCase.findUnique({ where: { id: box.id }, include: { items: true } });
      if (!currentCase || !currentCase.active || currentCase.slug !== slug) throw new Error("CASE_CHANGED");
      const weightedItems = currentCase.items.map((i) => ({ ...i, weight: Number(i.weight) }));
      const economy = assertCaseEconomy(Number(currentCase.price), weightedItems);
      const roll = randomInt(1, economy.totalWeight + 1);
      const won = pickWeightedCaseItem(weightedItems, roll);
      await assertAccountCanPlay(tx,user.id);
      await assertAbuseGuard(tx, user.id, "CASE_OPEN");
      await enforceRateLimit(tx, user.id, "CASE_OPEN", 30, 60_000);
      await debitWallet(tx, user.id, economy.price, `case-tx:${idempotencyKey}`, "CASE_OPEN", `Открытие кейса · ${currentCase.name}`, currentCase.id);
      const opening = await tx.caseOpening.create({ data: { userId: user.id, caseId: currentCase.id, resultItemId: won.id, price: economy.price, status: "COMPLETED", idempotencyKey, completedAt: new Date() } });
      const inventory = await tx.inventoryItem.create({ data: { userId: user.id, caseId: currentCase.id, caseItemId: won.id, name: won.name, imageUrl: won.imageUrl, rarity: normalizeCaseRarity(won.rarity), value: won.value, status: "AVAILABLE" } });
      const activeEvents = await tx.event.findMany({ where: { status: { in: ["SCHEDULED", "ACTIVE"] }, startsAt: { lte: new Date() }, endsAt: { gt: new Date() }, eventPass: true }, select: { id: true } });
      for (const event of activeEvents) await refreshEventMissionsForUser(tx, user.id, event.id);
      const wallet = await tx.wallet.findUnique({ where: { userId: user.id }, select: { balance: true } });
      return { opening, inventory, balance: Number(wallet?.balance ?? 0) };
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 });

    return NextResponse.json({ ok: true, item: { ...result.inventory, value: Number(result.inventory.value) }, balance: result.balance });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "INSUFFICIENT_BALANCE") return NextResponse.json({ error: "Недостаточно средств. Пополните кошелёк.", errorCode: "INSUFFICIENT_BALANCE" }, { status: 400 });
    if (message === "CASE_RTP_TOO_HIGH") return NextResponse.json({ error: "Кейс временно недоступен: ожидаемая стоимость наград выше цены кейса", errorCode: "CASE_RTP_TOO_HIGH" }, { status: 409 });
    if (["INVALID_CASE_PRICE","INVALID_CASE_WEIGHT","INVALID_CASE_ITEM_VALUE","INVALID_CASE_ITEM_WEIGHT","CASE_EMPTY","CASE_CHANGED"].includes(message)) return NextResponse.json({ error: "Конфигурация кейса изменилась. Обновите страницу и попробуйте снова.", errorCode: message }, { status: 409 });
    if (message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много открытий. Попробуйте позже.", errorCode: "RATE_LIMITED" }, { status: 429 });
    if (["ACCOUNT_SUSPENDED","ACCOUNT_BANNED","ACCOUNT_DEACTIVATED"].includes(message)) return NextResponse.json({ error: "Аккаунт временно недоступен", errorCode: message }, { status: 403 });
    if (message.includes("CaseOpening_userId_idempotencyKey_key") || message.includes("Unique constraint failed")) {
      const user = await getCurrentUser();
      if (user) {
        // The transaction may have raced with an identical request. The committed result is authoritative.
        if (requestClientKey) {
          const key = `${user.id}:${requestClientKey}`;
          const existing = await prisma.caseOpening.findUnique({
            where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: key } },
            include: { resultItem: true, case: { select: { slug: true } } },
          });
          if (existing) {
            if (existing.case.slug !== requestedSlug) return NextResponse.json({ error: "Этот Idempotency-Key уже использован для другого кейса", errorCode: "IDEMPOTENCY_KEY_REUSED" }, { status: 409 });
            return NextResponse.json({ ok: true, idempotent: true, item: resultPayload(existing.resultItem) });
          }
        }
      }
    }
    console.error(e);
    return NextResponse.json({ error: "Не удалось открыть кейс" }, { status: 500 });
  }
}
