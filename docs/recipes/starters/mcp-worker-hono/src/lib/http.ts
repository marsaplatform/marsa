/**
 * The only way this Worker calls the outside world: a fixed User-Agent, a timeout and
 * a small retry on network errors, 429 and 5xx. Upstreams often block requests without
 * a User-Agent only in production.
 */
export const USER_AGENT = "my-mcp-worker/0.1 (+https://spaces.marsaplatform.com)";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 8000, retries = 2, fetchFn = fetch } = opts;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json", ...opts.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      last = new UpstreamError(`upstream answered ${res.status}`, res.status);
      if (res.status !== 429 && res.status < 500) throw last;
    } catch (err) {
      if (err instanceof UpstreamError && err.status !== null && err.status < 500 && err.status !== 429)
        throw err;
      last = err;
    }
    if (attempt < retries) await sleep(250 * 2 ** attempt);
  }
  throw last instanceof UpstreamError ? last : new UpstreamError(String((last as Error)?.message ?? last), null);
}
