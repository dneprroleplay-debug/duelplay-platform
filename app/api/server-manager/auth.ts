import { NextRequest } from "next/server";
import { secureSecretEqual } from "@/lib/secure-secret";
import { verifyServerManagerRequestSignature } from "@/lib/server-manager-request-signature.mjs";

export function isServerManagerRequest(request: NextRequest | Request) {
  const secret = process.env.DUELPLAY_SERVER_MANAGER_SECRET;
  return secureSecretEqual(request.headers.get("x-duelplay-server-secret"), secret);
}

export async function isFreshServerManagerRequest(request: NextRequest | Request) {
  const secret = process.env.DUELPLAY_SERVER_MANAGER_SECRET;
  if (!secureSecretEqual(request.headers.get("x-duelplay-server-secret"), secret) || !secret) return false;
  const body = ["GET", "HEAD"].includes(request.method.toUpperCase()) ? "" : await request.clone().text();
  if (body.length > 128_000) return false;
  const url = new URL(request.url);
  return verifyServerManagerRequestSignature({
    secret,
    timestamp: request.headers.get("x-duelplay-request-timestamp"),
    nonce: request.headers.get("x-duelplay-request-nonce"),
    signature: request.headers.get("x-duelplay-request-signature"),
    method: request.method,
    path: `${url.pathname}${url.search}`,
    body,
  });
}
