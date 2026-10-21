/**
 * Evidence file validation for match disputes.
 *
 * The platform stores uploaded evidence as a data URL inside
 * `MatchEvidence.fileUrl` (there is no object storage for evidence), or as an
 * external https reference. Both forms are bounded and the mime type of an
 * uploaded file must be compatible with the declared evidence type.
 */
export const EVIDENCE_TYPES = ["IMAGE", "VIDEO", "LOG_FILE", "DEMO_REPLAY"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** 4 MB of binary data is roughly 5.6 MB of base64. */
export const EVIDENCE_MAX_BASE64_CHARS = 6 * 1024 * 1024;
export const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;

const EVIDENCE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
  "video/mp4", "video/webm",
  "text/plain", "application/json", "application/zip", "application/x-zip-compressed",
]);

const TYPE_MIME_PREFIX: Record<EvidenceType, string[]> = {
  IMAGE: ["image/"],
  VIDEO: ["video/"],
  LOG_FILE: ["text/", "application/json"],
  DEMO_REPLAY: ["application/zip", "application/x-zip-compressed", "video/", "application/octet-stream", "text/"],
};

export type EvidenceValidation =
  | { ok: true; storage: "data" | "link" }
  | { ok: false; code: "INVALID" | "UNSUPPORTED_TYPE" | "TOO_LARGE" };

export function isEvidenceType(value: string): value is EvidenceType {
  return (EVIDENCE_TYPES as readonly string[]).includes(value);
}

export function validateEvidenceFile(fileUrl: string, type: string): EvidenceValidation {
  const url = String(fileUrl || "").trim();
  const kind = String(type || "").trim().toUpperCase();
  if (!url || !isEvidenceType(kind)) return { ok: false, code: "INVALID" };
  const dataUrl = url.match(/^data:([a-z0-9.+/-]+);base64,(.*)$/i);
  if (dataUrl) {
    const mime = dataUrl[1].toLowerCase();
    if (!EVIDENCE_MIME_TYPES.has(mime)) return { ok: false, code: "UNSUPPORTED_TYPE" };
    if (!TYPE_MIME_PREFIX[kind].some((prefix) => mime.startsWith(prefix))) return { ok: false, code: "UNSUPPORTED_TYPE" };
    if (dataUrl[2].length > EVIDENCE_MAX_BASE64_CHARS) return { ok: false, code: "TOO_LARGE" };
    return { ok: true, storage: "data" };
  }
  if (!/^https:\/\//i.test(url) || url.length > 2048) return { ok: false, code: "INVALID" };
  return { ok: true, storage: "link" };
}
