import { NextRequest } from "next/server";

export function isServerManagerRequest(request: NextRequest | Request) {
  const secret = process.env.DUELPLAY_SERVER_MANAGER_SECRET;
  return Boolean(secret && request.headers.get("x-duelplay-server-secret") === secret);
}
