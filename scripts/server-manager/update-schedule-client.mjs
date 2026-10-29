import { createServerManagerRequestHeaders } from '../../lib/server-manager-request-signature.mjs';

export function createUpdateScheduleClient({ apiUrl, secret, fetchImpl = fetch, now = () => Date.now() }) {
  const baseUrl = String(apiUrl ?? '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('DUELPLAY_API_URL is required');
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('DUELPLAY_SERVER_MANAGER_SECRET is required');

  return async function request(path, { method = 'GET', body } = {}) {
    const normalizedMethod = method.toUpperCase();
    const bodyText = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const headers = createServerManagerRequestHeaders({ secret, method: normalizedMethod, path, body: bodyText, now: now() });
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: normalizedMethod,
      headers: { 'content-type': 'application/json', ...headers },
      ...(normalizedMethod === 'GET' || normalizedMethod === 'HEAD' ? {} : { body: bodyText }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      const details = text ? text.slice(0, 1000) : "<empty response body>";
      throw new Error(`DuelPlay schedule API returned HTTP ${response.status}${data.errorCode ? ` (${data.errorCode})` : ""}; response=${details}`);
    }
    return data;
  };
}
