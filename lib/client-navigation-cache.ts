const matchCache = new Map<string, {
  value: any;
  storedAt: number;
}>();

const profileCache = new Map<string, {
  value: any;
  storedAt: number;
}>();

const pendingMatches = new Map<string, Promise<any | null>>();
const pendingProfiles = new Map<string, Promise<any | null>>();

const MATCH_TTL = 15_000;
const PROFILE_TTL = 30_000;

function fresh<T>(
  entry: { value: T; storedAt: number } | undefined,
  ttl: number
) {
  if (!entry) return null;

  if (Date.now() - entry.storedAt >= ttl) {
    return null;
  }

  return entry.value;
}

export function getCachedMatch(id: string) {
  return fresh(matchCache.get(String(id)), MATCH_TTL);
}

export function cacheMatch(id: string, value: any) {
  if (!id || !value) return;

  matchCache.set(String(id), {
    value,
    storedAt: Date.now(),
  });
}

export function prefetchMatch(id: string) {
  const key = String(id || "");

  if (!key) return Promise.resolve(null);

  const cached = getCachedMatch(key);

  if (cached) {
    return Promise.resolve(cached);
  }

  const existing = pendingMatches.get(key);

  if (existing) {
    return existing;
  }

  const request = fetch(
    "/api/matches/" + encodeURIComponent(key),
    {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-store",
      },
    }
  )
    .then(async response => {
      if (!response.ok) return null;

      const data = await response.json();
      const value = data.match ?? data;

      if (!value) return null;

      cacheMatch(key, value);

      return value;
    })
    .catch(() => null)
    .finally(() => {
      pendingMatches.delete(key);
    });

  pendingMatches.set(key, request);

  return request;
}

export function getCachedPublicProfile(nickname: string) {
  return fresh(
    profileCache.get(String(nickname)),
    PROFILE_TTL
  );
}

export function cachePublicProfile(
  nickname: string,
  value: any
) {
  if (!nickname || !value) return;

  profileCache.set(String(nickname), {
    value,
    storedAt: Date.now(),
  });
}

export function prefetchPublicProfile(nickname: string) {
  const key = String(nickname || "");

  if (!key) return Promise.resolve(null);

  const cached = getCachedPublicProfile(key);

  if (cached) {
    return Promise.resolve(cached);
  }

  const existing = pendingProfiles.get(key);

  if (existing) {
    return existing;
  }

  const request = fetch(
    "/api/profile/" + encodeURIComponent(key),
    {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-store",
      },
    }
  )
    .then(async response => {
      if (!response.ok) return null;

      const value = await response.json();

      if (!value) return null;

      cachePublicProfile(key, value);

      return value;
    })
    .catch(() => null)
    .finally(() => {
      pendingProfiles.delete(key);
    });

  pendingProfiles.set(key, request);

  return request;
}
