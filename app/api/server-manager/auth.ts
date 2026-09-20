import { NextRequest } from "next/server";
import { secureSecretEqual } from "@/lib/secure-secret";

export function isServerManagerRequest(request: NextRequest | Request) {
  const secret = process.env.DUELPLAY_SERVER_MANAGER_SECRET;
  return secureSecretEqual(request.headers.get("x-duelplay-server-secret"), secret);
}
