export function createServerManagerRequestHeaders(input: {
  secret: string;
  method: string;
  path: string;
  body?: string;
  now?: number;
  nonce?: string;
}): Record<string, string>;

export function verifyServerManagerRequestSignature(input: {
  secret: string;
  timestamp: string | null | undefined;
  nonce: string | null | undefined;
  signature: string | null | undefined;
  method: string;
  path: string;
  body?: string;
  now?: number;
  maxClockSkewSeconds?: number;
}): boolean;
