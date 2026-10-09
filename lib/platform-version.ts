import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedPlatformVersion: string | null = null;

export async function getPlatformVersion() {
  if (cachedPlatformVersion) return cachedPlatformVersion;

  const configuredVersion = process.env.DUELPLAY_BUILD_VERSION?.trim();
  if (configuredVersion) {
    cachedPlatformVersion = configuredVersion;
    return cachedPlatformVersion;
  }

  try {
    const buildId = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    if (buildId) {
      cachedPlatformVersion = buildId;
      return cachedPlatformVersion;
    }
  } catch {
    // During development or before a production build, use a stable fallback.
  }

  cachedPlatformVersion = process.env.NODE_ENV === "production" ? "unknown" : "development";
  return cachedPlatformVersion;
}
