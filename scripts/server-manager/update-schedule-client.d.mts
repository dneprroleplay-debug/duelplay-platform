export function createUpdateScheduleClient(input: {
  apiUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): (path: string, options?: { method?: string; body?: unknown }) => Promise<Record<string, unknown>>;
