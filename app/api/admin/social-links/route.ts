import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditRequest } from "@/lib/admin";
import { requirePermission } from "@/lib/admin-rbac";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { getSiteSocialLinks, validateSiteSocialLinks } from "@/lib/site-social-links";

export async function GET() {
  try {
    await requirePermission("settings.content.manage");
    return NextResponse.json({ socialLinks: await getSiteSocialLinks() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
    if (error instanceof Error && error.message === "ADMIN_MFA_SETUP_REQUIRED") return NextResponse.json({ error: "Сначала настрой MFA администратора" }, { status: 403 });
    if (error instanceof Error && error.message === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: "Подтверди MFA администратора" }, { status: 403 });
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав для управления ссылками" }, { status: 403 });
    console.error("Admin social links GET failed", error);
    return NextResponse.json({ error: "Не удалось загрузить ссылки" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "ADMIN_SOCIAL_LINKS_PATCH", 20, 10 * 60_000));
    const access = await requirePermission("settings.content.manage");
    const body = await request.json().catch(() => null);
    const checked = validateSiteSocialLinks(body?.socialLinks);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

    const old = await getSiteSocialLinks();
    const row = await prisma.siteSettings.upsert({
      where: { key: "socialLinks" },
      update: { value: checked.value as Prisma.InputJsonValue, updatedBy: access.user.id, description: "Public social and support links" },
      create: { key: "socialLinks", value: checked.value as Prisma.InputJsonValue, updatedBy: access.user.id, description: "Public social and support links" },
    });
    await auditRequest(request, access.user.id, "CHANGE_SOCIAL_LINKS", "SITE_SETTING", row.id, { old, new: checked.value });
    return NextResponse.json({ ok: true, socialLinks: checked.value }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
    if (error instanceof Error && error.message === "ADMIN_MFA_SETUP_REQUIRED") return NextResponse.json({ error: "Сначала настрой MFA администратора" }, { status: 403 });
    if (error instanceof Error && error.message === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: "Подтверди MFA администратора" }, { status: 403 });
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав для управления ссылками" }, { status: 403 });
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много изменений. Попробуй позже." }, { status: 429 });
    console.error("Admin social links PATCH failed", error);
    return NextResponse.json({ error: "Не удалось сохранить ссылки" }, { status: 500 });
  }
}
