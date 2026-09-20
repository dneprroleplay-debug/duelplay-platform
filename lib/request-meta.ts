import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

function firstIp(value: string | null | undefined) {
  const candidate = value?.split(",")[0]?.trim() ?? "";
  return candidate.length <= 128 ? candidate : candidate.slice(0, 128);
}

export function getClientIp(request: Request | NextRequest) {
  return (
    firstIp(request.headers.get("cf-connecting-ip")) ||
    firstIp(request.headers.get("x-real-ip")) ||
    firstIp(request.headers.get("x-forwarded-for")) ||
    "unknown"
  );
}

export function getRequestId(request: Request | NextRequest) {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : randomUUID();
}

export function getAuditContext(request: Request | NextRequest) {
  return {
    ipAddress: getClientIp(request),
    userAgent: (request.headers.get("user-agent") || "unknown").slice(0, 1000),
    requestId: getRequestId(request),
  };
}
