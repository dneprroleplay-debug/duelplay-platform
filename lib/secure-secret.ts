import { timingSafeEqual } from "node:crypto";

export function secureSecretEqual(candidate: string | null | undefined, expected: string | undefined) {
  if (!candidate || !expected) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
