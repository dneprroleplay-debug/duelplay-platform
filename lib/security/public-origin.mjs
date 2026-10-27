/**
 * Resolve DuelPlay's configured public origin. Never infer trust from Host,
 * X-Forwarded-Host, or request.url: those can describe an internal Coolify hop.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function getConfiguredPublicOrigin(env = process.env) {
  const configured = [
    env.DUELPLAY_PUBLIC_URL,
    env.DUELPLAY_API_URL,
    env.NEXT_PUBLIC_SITE_URL,
    env.NODE_ENV === "production" ? "https://duelplaygame.com" : env.NEXT_PUBLIC_APP_URL,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  if (!configured) return null;

  try {
    const parsed = new URL(configured.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
    if (env.NODE_ENV === "production" && isLocal) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Validate a browser Origin against the configured public origin.
 * requestUrl is intentionally not consulted because behind Coolify it may be
 * an internal http://container:3000 URL rather than the public HTTPS origin.
 * @param {string | null} originHeader
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [requestUrl] Untrusted/internal URL, intentionally ignored.
 * @returns {boolean}
 */
export function isAllowedPublicOrigin(originHeader, env = process.env, requestUrl) {
  void requestUrl;
  if (!originHeader || originHeader === "null") return false;
  let supplied;
  try {
    supplied = new URL(originHeader);
  } catch {
    return false;
  }

  if ((supplied.protocol !== "https:" && supplied.protocol !== "http:") || supplied.username || supplied.password) return false;
  // Origin headers serialize as an origin only: no path, query, fragment or trailing slash.
  if (originHeader !== supplied.origin) return false;

  const expected = getConfiguredPublicOrigin(env);
  return Boolean(expected && supplied.origin === expected);
}
