/**
 * A tiny client for the parts of the Cloudflare REST API that Marsa Spaces
 * uses to publish team Workers: scripts, script secrets, workers.dev
 * subdomains, zone routes and DNS records. The API token is held in memory for
 * the duration of a call only and is never put in an error message.
 */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class CfError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codes: number[] = [],
  ) {
    super(message);
  }
}

interface CfEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
}

/** Error text from Cloudflare, cut short and scrubbed of anything token-shaped. */
function cfMessage(body: CfEnvelope<unknown> | null, status: number): string {
  const msgs = (body?.errors ?? [])
    .map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim())
    .filter(Boolean)
    .join("; ");
  return (msgs || `Cloudflare API error (HTTP ${status})`)
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, 300);
}

export interface CfAccess {
  token: string;
  accountId: string;
  zoneId?: string;
}

export interface ScriptUpload {
  code: string;
  compatibilityDate: string;
  vars: Record<string, string>;
}

/** Cloudflare's limit for one plain_text binding. */
export const CF_BINDING_MAX = 5 * 1024;

/**
 * Main module used when some vars are larger than a binding allows: it imports the
 * user's module and the large vars, and hands every handler an env that has them.
 */
export const WRAPPER_MODULE = `import * as user from "./user.js";
import big from "./marsa-vars.js";
export * from "./user.js";
const mod = user.default;
const withVars = (env) =>
  new Proxy(env ?? {}, {
    get: (t, k) => (Object.hasOwn(big, k) ? big[k] : Reflect.get(t, k)),
    has: (t, k) => Object.hasOwn(big, k) || Reflect.has(t, k),
  });
const out = {};
for (const k of Object.keys(mod ?? {})) {
  const v = mod[k];
  out[k] = typeof v === "function" ? (a, env, ctx) => v.call(mod, a, withVars(env), ctx) : v;
}
export default out;
`;

export class CloudflareWorkersApi {
  constructor(
    private readonly apiBase = "https://api.cloudflare.com/client/v4",
    private readonly fetchFn: FetchFn = (i, init) => fetch(i, init),
  ) {}

  private async call<T>(
    token: string,
    method: string,
    path: string,
    body?: BodyInit | object,
    allow404 = false,
  ): Promise<T | null> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    let payload: BodyInit | undefined;
    if (body instanceof FormData || typeof body === "string") payload = body;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await this.fetchFn(`${this.apiBase}${path}`, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new CfError(502, `could not reach Cloudflare (${(err as Error).name})`);
    }
    if (allow404 && res.status === 404) return null;
    const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
    if (!res.ok || json?.success === false) {
      throw new CfError(
        res.status,
        cfMessage(json, res.status),
        (json?.errors ?? []).map((e) => e.code ?? 0),
      );
    }
    return (json?.result ?? null) as T | null;
  }

  /** Token status ("active") via the user endpoint, falling back to the account one. */
  async verify(a: { token: string; accountId?: string }): Promise<string> {
    try {
      const r = await this.call<{ status: string }>(a.token, "GET", "/user/tokens/verify");
      return r?.status ?? "unknown";
    } catch (err) {
      if (!a.accountId) throw err;
      const r = await this.call<{ status: string }>(
        a.token,
        "GET",
        `/accounts/${a.accountId}/tokens/verify`,
      );
      return r?.status ?? "unknown";
    }
  }

  async zoneId(token: string, zoneName: string): Promise<{ id: string; accountId: string } | null> {
    const r = await this.call<{ id: string; account?: { id: string } }[]>(
      token,
      "GET",
      `/zones?name=${encodeURIComponent(zoneName)}`,
    );
    const z = r?.[0];
    return z ? { id: z.id, accountId: z.account?.id ?? "" } : null;
  }

  async accounts(token: string): Promise<{ id: string; name: string }[]> {
    return (await this.call<{ id: string; name: string }[]>(token, "GET", "/accounts")) ?? [];
  }

  /** True when the account has a Worker script with this name. */
  async scriptExists(a: CfAccess, script: string): Promise<boolean> {
    const r = await this.call<unknown>(
      a.token,
      "GET",
      `/accounts/${a.accountId}/workers/scripts/${script}/settings`,
      undefined,
      true,
    );
    return r !== null;
  }

  async putScript(a: CfAccess, script: string, s: ScriptUpload): Promise<void> {
    const form = new FormData();
    // Cloudflare caps one text binding at 5 KB. Larger vars ride in a generated
    // module and a tiny wrapper merges them into `env` before the user's handlers run.
    const small: [string, string][] = [];
    const large: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.vars)) {
      if (Buffer.byteLength(v) > CF_BINDING_MAX) large[k] = v;
      else small.push([k, v]);
    }
    const wrapped = Object.keys(large).length > 0;
    const metadata = {
      main_module: "worker.js",
      compatibility_date: s.compatibilityDate,
      bindings: small.map(([name, text]) => ({ type: "plain_text", name, text })),
      // Secrets are set separately and survive redeploys.
      keep_bindings: ["secret_text"],
      tags: ["marsa-spaces"],
    };
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      "metadata.json",
    );
    const mod = (name: string, body: string) =>
      form.append(name, new Blob([body], { type: "application/javascript+module" }), name);
    if (wrapped) {
      mod("worker.js", WRAPPER_MODULE);
      mod("user.js", s.code);
      mod("marsa-vars.js", `export default ${JSON.stringify(large)};\n`);
    } else {
      mod("worker.js", s.code);
    }
    await this.call(a.token, "PUT", `/accounts/${a.accountId}/workers/scripts/${script}`, form);
  }

  async putSecret(a: CfAccess, script: string, name: string, value: string): Promise<void> {
    await this.call(a.token, "PUT", `/accounts/${a.accountId}/workers/scripts/${script}/secrets`, {
      name,
      text: value,
      type: "secret_text",
    });
  }

  async deleteSecret(a: CfAccess, script: string, name: string): Promise<void> {
    await this.call(
      a.token,
      "DELETE",
      `/accounts/${a.accountId}/workers/scripts/${script}/secrets/${encodeURIComponent(name)}`,
      undefined,
      true,
    );
  }

  async deleteScript(a: CfAccess, script: string): Promise<void> {
    await this.call(
      a.token,
      "DELETE",
      `/accounts/${a.accountId}/workers/scripts/${script}?force=true`,
      undefined,
      true,
    );
  }

  /** Turn the script's workers.dev URL on; returns the account's workers.dev subdomain. */
  async enableWorkersDev(a: CfAccess, script: string): Promise<string> {
    await this.call(
      a.token,
      "POST",
      `/accounts/${a.accountId}/workers/scripts/${script}/subdomain`,
      {
        enabled: true,
      },
    );
    const r = await this.call<{ subdomain: string }>(
      a.token,
      "GET",
      `/accounts/${a.accountId}/workers/subdomain`,
    );
    if (!r?.subdomain) throw new CfError(502, "this account has no workers.dev subdomain");
    return r.subdomain;
  }

  async listRoutes(a: CfAccess): Promise<{ id: string; pattern: string; script?: string }[]> {
    return (
      (await this.call<{ id: string; pattern: string; script?: string }[]>(
        a.token,
        "GET",
        `/zones/${a.zoneId}/workers/routes`,
      )) ?? []
    );
  }

  async createRoute(a: CfAccess, pattern: string, script: string): Promise<string> {
    const r = await this.call<{ id: string }>(
      a.token,
      "POST",
      `/zones/${a.zoneId}/workers/routes`,
      {
        pattern,
        script,
      },
    );
    if (!r?.id) throw new CfError(502, "Cloudflare returned no route id");
    return r.id;
  }

  async deleteRoute(a: CfAccess, id: string): Promise<void> {
    await this.call(a.token, "DELETE", `/zones/${a.zoneId}/workers/routes/${id}`, undefined, true);
  }

  async dnsRecords(a: CfAccess, name: string): Promise<{ id: string; type: string }[]> {
    return (
      (await this.call<{ id: string; type: string }[]>(
        a.token,
        "GET",
        `/zones/${a.zoneId}/dns_records?name=${encodeURIComponent(name)}`,
      )) ?? []
    );
  }

  async createDns(a: CfAccess, name: string, comment: string): Promise<string> {
    const r = await this.call<{ id: string }>(a.token, "POST", `/zones/${a.zoneId}/dns_records`, {
      type: "AAAA",
      name,
      content: "100::",
      proxied: true,
      ttl: 1,
      comment,
    });
    if (!r?.id) throw new CfError(502, "Cloudflare returned no DNS record id");
    return r.id;
  }

  async deleteDns(a: CfAccess, id: string): Promise<void> {
    await this.call(a.token, "DELETE", `/zones/${a.zoneId}/dns_records/${id}`, undefined, true);
  }
}
