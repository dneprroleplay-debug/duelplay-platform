import { prisma } from "@/lib/prisma";
import { siteConfig } from "@/lib/config/site";

import { validateSiteSocialLinks, type SiteSocialLinks } from "@/lib/site-social-links-policy";
export { validateSiteSocialLinks } from "@/lib/site-social-links-policy";

export const DEFAULT_SITE_SOCIAL_LINKS: SiteSocialLinks = {
  discord: siteConfig.socialLinks.discord,
  steamGroup: siteConfig.socialLinks.steamGroup,
  telegram: siteConfig.socialLinks.telegram,
  supportUrl: siteConfig.support.ticketUrl,
  supportEmail: siteConfig.socialLinks.supportEmail,
};

export async function getSiteSocialLinks(): Promise<SiteSocialLinks> {
  const row = await prisma.siteSettings.findUnique({ where: { key: "socialLinks" }, select: { value: true } }).catch(() => null);
  const stored = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value as Record<string, unknown> : null;
  if (!stored) return DEFAULT_SITE_SOCIAL_LINKS;
  const merged = { ...DEFAULT_SITE_SOCIAL_LINKS, ...stored };
  const checked = validateSiteSocialLinks(merged);
  return checked.ok ? checked.value : DEFAULT_SITE_SOCIAL_LINKS;
}
