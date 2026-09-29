const cache = new Map<string, Promise<void>>();

export function preloadImage(src: string): Promise<void> {
  const value = String(src || "").trim();

  if (!value || typeof window === "undefined") {
    return Promise.resolve();
  }

  const existing = cache.get(value);

  if (existing) {
    return existing;
  }

  const promise = new Promise<void>((resolve) => {
    const image = new window.Image();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    image.onload = finish;
    image.onerror = finish;
    image.decoding = "async";
    image.src = value;

    if (typeof image.decode === "function") {
      void image.decode().then(finish, () => {});
    }
  });

  cache.set(value, promise);

  return promise;
}

export async function preloadImages(srcs: string[]): Promise<void> {
  const unique = [
    ...new Set(
      srcs
        .map((src) => String(src || "").trim())
        .filter(Boolean)
    ),
  ];

  await Promise.all(unique.map(preloadImage));
}
