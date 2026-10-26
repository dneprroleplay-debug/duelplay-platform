const DEFAULT_SITE_URL = "https://duelplaygame.com/";
const DEFAULT_DISCORD_URL = "https://discord.gg/KBk8pQNhKj";
const DEFAULT_STEAM_GROUP_URL = "https://steamcommunity.com/groups/duelplay/";
const DEFAULT_TELEGRAM_URL = "https://t.me/DuelPlayGame";
const DEFAULT_SUPPORT_EMAIL = "support@duelplaygame.com";

function publicEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function publicEnvOr(value: string | undefined, fallback: string): string {
  return publicEnv(value) ?? fallback;
}

export const siteConfig = {
  name: "DuelPlay",
  url: publicEnvOr(process.env.NEXT_PUBLIC_SITE_URL, DEFAULT_SITE_URL),
  socialLinks: {
    discord: publicEnvOr(process.env.NEXT_PUBLIC_DISCORD_URL, DEFAULT_DISCORD_URL),
    steamGroup: publicEnvOr(process.env.NEXT_PUBLIC_STEAM_GROUP_URL, DEFAULT_STEAM_GROUP_URL),
    telegram: publicEnvOr(process.env.NEXT_PUBLIC_TELEGRAM_URL, DEFAULT_TELEGRAM_URL),
    supportEmail: publicEnvOr(process.env.NEXT_PUBLIC_SUPPORT_EMAIL, DEFAULT_SUPPORT_EMAIL),
  },
  support: {
    ticketUrl: publicEnvOr(process.env.NEXT_PUBLIC_SUPPORT_URL, DEFAULT_DISCORD_URL),
  },
} as const;
