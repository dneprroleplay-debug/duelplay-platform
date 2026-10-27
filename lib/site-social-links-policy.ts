export type SiteSocialLinks = {
  discord: string;
  steamGroup: string;
  telegram: string;
  supportUrl: string;
  supportEmail: string;
};

const URL_FIELDS = ["discord", "steamGroup", "telegram", "supportUrl"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSiteSocialLinks(raw: unknown): { ok: true; value: SiteSocialLinks } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Некорректный формат настроек." };
  const input = raw as Record<string, unknown>;
  const value = {} as SiteSocialLinks;
  for (const key of URL_FIELDS) {
    const candidate = typeof input[key] === "string" ? input[key].trim() : "";
    if (!candidate || candidate.length > 500) return { ok: false, error: `Поле «${key}» обязательно и должно быть не длиннее 500 символов.` };
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error("invalid");
      value[key] = url.toString();
    } catch {
      return { ok: false, error: `Поле «${key}» должно содержать корректную ссылку HTTPS.` };
    }
  }
  const email = typeof input.supportEmail === "string" ? input.supportEmail.trim() : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: "Укажи корректный email поддержки." };
  value.supportEmail = email;
  return { ok: true, value };
}
