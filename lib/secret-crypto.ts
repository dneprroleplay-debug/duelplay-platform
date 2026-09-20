import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyFromEnv(): Buffer {
  const raw = process.env.DUELPLAY_MFA_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("MFA_ENCRYPTION_KEY_MISSING");
  return Buffer.from(raw, "hex");
}

export function encryptSecret(value: string): string {
  const key = keyFromEnv();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(value: string): string {
  const [version, ivHex, tagHex, cipherHex] = value.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !cipherHex) throw new Error("INVALID_ENCRYPTED_SECRET");
  const decipher = createDecipheriv("aes-256-gcm", keyFromEnv(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(cipherHex, "hex")), decipher.final()]).toString("utf8");
}
