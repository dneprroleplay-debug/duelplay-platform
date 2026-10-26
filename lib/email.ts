import { createHash, randomBytes } from "node:crypto";

export function generateVerificationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = randomBytes(8);
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function generateResetToken() {
  return randomBytes(32).toString("hex");
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function sendEmail(params: { from: string; to: string; subject: string; html: string; text: string }) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_NOT_CONFIGURED");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: params.from, to: [params.to], subject: params.subject, html: params.html, text: params.text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RESEND_FAILED:${res.status}:${body}`);
  }
  return res.json();
}
