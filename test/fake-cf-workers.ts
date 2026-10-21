/**
 * A mocked Cloudflare REST API for team Workers: scripts, secrets, routes, DNS,
 * zones, token verify and workers.dev. It also answers requests to deployed
 * hostnames (as if the Worker ran). Placeholder values only.
 */
export const CF_TOKEN = "cfTEST_token_value_0123456789_abcdefWXYZ";
export const CF_ACCOUNT = "0123456789abcdef0123456789abcdef";
export const CF_ZONE = "zone0123456789abcdef0123456789ab";
export const ZONE_NAME = "marsaplatform.test";

interface Script {
  code: string;
  /** Every module part of the upload (name -> source). */
  modules: Record<string, string>;
  vars: Record<string, string>;
  secrets: Map<string, string>;
  workersDev: boolean;
  tags: string[];
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  services?: Record<string, string>;
}

export class FakeCfWorkers {
  scripts = new Map<string, Script>();
  routes = new Map<string, { id: string; pattern: string; script: string }>();
  dns = new Map<
    string,
    { id: string; type: string; name: string; content: string; proxied: boolean }
  >();
  calls: { method: string; path: string }[] = [];
  tokenStatus = "active";
  failPutScript = false;
  accountOwned = false;
  /** 0.15.2: capabilities the fake token lacks (answers 403): analytics, observability, tail, kv, r2. */
  denied = new Set<string>();
  /** Hostnames that answer 500 (health "down"). */
  failing = new Set<string>();
  /** Per-script Workers Logs flag (script-settings PATCH). */
  observability = new Map<string, boolean>();
  /** Every GraphQL / telemetry body seen (to check nothing writes). */
  queries: { kind: string; body: unknown }[] = [];
  /** Rows the fake GraphQL returns (script, hour ISO, status, requests, errors, cpu µs). */
  analyticsRows: {
    script: string;
    hour: string;
    status: string;
    requests: number;
    errors: number;
    cpu: number;
  }[] = [];
  logEvents: unknown[] = [];
  private n = 0;

  constructor() {
    // Pre-existing resources Spaces must never touch.
    for (const name of [
      "marsa-atlas-mcp",
      "malja-mcp",
      "erx-mcp",
      "mail-worker",
      "team-sanad-taken",
    ]) {
      this.scripts.set(name, {
        code: "x",
        modules: { "worker.js": "x" },
        vars: {},
        secrets: new Map(),
        workersDev: false,
        tags: [],
      });
    }
    this.routes.set("r_pre", {
      id: "r_pre",
      pattern: `malja.${ZONE_NAME}/mcp*`,
      script: "malja-mcp",
    });
    this.dns.set("d_pre", {
      id: "d_pre",
      type: "AAAA",
      name: `sanad-busy.${ZONE_NAME}`,
      content: "100::",
      proxied: true,
    });
  }

  private id(p: string) {
    this.n++;
    return `${p}${this.n.toString().padStart(4, "0")}`;
  }
  private ok(result: unknown, status = 200) {
    return new Response(JSON.stringify({ success: true, errors: [], result }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  private bad(status: number, message: string, code = 10000) {
    return new Response(
      JSON.stringify({ success: false, errors: [{ code, message }], result: null }),
      {
        status,
        headers: { "content-type": "application/json" },
      },
    );
  }

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    if (url.host !== "api.cloudflare.com") return this.site(url);
    const path = url.pathname.replace(/^\/client\/v4/, "");
    this.calls.push({ method, path });
    const auth = new Headers(init.headers).get("authorization");
    if (auth !== `Bearer ${CF_TOKEN}`) return this.bad(403, "Authentication error");
    const json = async () => JSON.parse(String(init.body ?? "{}"));
    let m: RegExpMatchArray | null;
    if (path === "/user/tokens/verify") {
      // Like an account-owned token: the user endpoint refuses it.
      if (this.accountOwned) return this.bad(401, "Invalid API Token", 1000);
      return this.ok({ id: "tok", status: this.tokenStatus });
    }
    if (path === `/accounts/${CF_ACCOUNT}/tokens/verify`) {
      return this.ok({ id: "tok", status: this.tokenStatus });
    }
    if (path === "/zones" && method === "GET") {
      return this.ok(
        url.searchParams.get("name") === ZONE_NAME
          ? [{ id: CF_ZONE, name: ZONE_NAME, account: { id: CF_ACCOUNT } }]
          : [],
      );
    }
    if (path === "/accounts") return this.ok([{ id: CF_ACCOUNT, name: "Test" }]);
    const acc = `/accounts/${CF_ACCOUNT}/workers`;
    if (path === `${acc}/subdomain`) return this.ok({ subdomain: "marsa-test" });
    const deny = (k: string) => this.bad(403, `Authentication error (${k})`, 10000);
    if (path === "/graphql") {
      const b = await json();
      this.queries.push({ kind: "graphql", body: b });
      if (this.denied.has("analytics"))
        return new Response(
          JSON.stringify({
            data: null,
            errors: [{ message: "not authorized for that account", extensions: { code: "authz" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (/^\s*mutation/.test(b.query)) return this.bad(400, "no mutations");
      const scripts: string[] | undefined = b.variables?.scripts;
      const daily = /\bdate\b/.test(b.query) && !/datetimeHour/.test(b.query);
      const rows = this.analyticsRows
        .filter((r) => !scripts || scripts.includes(r.script))
        .map((r) => ({
          sum: { requests: r.requests, errors: r.errors },
          quantiles: { cpuTimeP50: r.cpu },
          dimensions: daily
            ? { scriptName: r.script, date: r.hour.slice(0, 10), status: r.status }
            : { scriptName: r.script, datetimeHour: r.hour, status: r.status },
        }));
      return new Response(
        JSON.stringify({
          data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } },
          errors: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (path === `${acc}/observability/telemetry/query`) {
      this.queries.push({ kind: "telemetry", body: await json() });
      if (this.denied.has("observability")) return deny("observability");
      return this.ok({ events: { events: this.logEvents, count: this.logEvents.length } });
    }
    if (path === `/accounts/${CF_ACCOUNT}/storage/kv/namespaces`)
      return this.denied.has("kv") ? deny("kv") : this.ok([]);
    if (path === `/accounts/${CF_ACCOUNT}/r2/buckets`)
      return this.denied.has("r2") ? deny("r2") : this.ok({ buckets: [] });
    if (path === `/zones/${CF_ZONE}` && method === "GET")
      return this.ok({ id: CF_ZONE, name: ZONE_NAME });
    if (path === `${acc}/scripts` && method === "GET")
      return this.ok([...this.scripts.keys()].map((id) => ({ id })));
    m = path.match(new RegExp(`^${acc}/scripts/([^/]+)/tails$`));
    if (m && method === "GET") return this.denied.has("tail") ? deny("tail") : this.ok([]);
    m = path.match(new RegExp(`^${acc}/scripts/([^/]+)/script-settings$`));
    if (m && method === "PATCH") {
      if (!this.scripts.has(m[1] as string)) return this.bad(404, "script not found", 10007);
      const b = await json();
      this.observability.set(m[1] as string, !!b.observability?.enabled);
      return this.ok({ observability: b.observability });
    }
    m = path.match(new RegExp(`^${acc}/scripts/([^/]+)/settings$`));
    if (m) {
      const sc = this.scripts.get(m[1] as string);
      if (!sc) return this.bad(404, "workers.api.error.script_not_found", 10007);
      return this.ok({
        bindings: [
          ...Object.entries(sc.vars).map(([name, text]) => ({ name, type: "plain_text", text })),
          ...[...sc.secrets.keys()].map((name) => ({ name, type: "secret_text" })),
          ...Object.entries(sc.services ?? {}).map(([name, service]) => ({
            name,
            type: "service",
            service,
          })),
        ],
      });
    }
    m = path.match(new RegExp(`^${acc}/scripts/([^/]+)/secrets(?:/([^/]+))?$`));
    if (m) {
      const s = this.scripts.get(m[1] as string);
      if (!s) return this.bad(404, "script not found", 10007);
      if (method === "PUT") {
        const b = await json();
        s.secrets.set(b.name, b.text);
        return this.ok({ name: b.name, type: "secret_text" });
      }
      if (method === "DELETE") {
        s.secrets.delete(decodeURIComponent(m[2] ?? ""));
        return this.ok(null);
      }
      if (method === "GET")
        return this.ok([...s.secrets.keys()].map((name) => ({ name, type: "secret_text" })));
    }
    m = path.match(new RegExp(`^${acc}/scripts/([^/]+)/subdomain$`));
    if (m) {
      const s = this.scripts.get(m[1] as string);
      if (!s) return this.bad(404, "script not found", 10007);
      s.workersDev = true;
      return this.ok({ enabled: true });
    }
    m = path.match(new RegExp(`^${acc}/scripts/([^/]+)$`));
    if (m) {
      const name = m[1] as string;
      if (method === "PUT") {
        if (this.failPutScript) return this.bad(400, "Uncaught SyntaxError", 10021);
        const form = init.body as FormData;
        const meta = JSON.parse(await (form.get("metadata") as Blob).text());
        const modules: Record<string, string> = {};
        for (const k of ["worker.js", "user.js", "marsa-vars.js"]) {
          const v = form.get(k);
          if (v && typeof v !== "string") modules[k] = await v.text();
        }
        const code = modules[meta.main_module] ?? "";
        const prev = this.scripts.get(name);
        const vars: Record<string, string> = {};
        const services: Record<string, string> = {};
        for (const b of meta.bindings ?? []) {
          if (b.type === "plain_text") vars[b.name] = b.text;
          else if (b.type === "service") {
            if (!this.scripts.has(b.service)) return this.bad(400, "service not found", 10143);
            services[b.name] = b.service;
          } else return this.bad(400, `binding type ${b.type}`, 10021);
        }
        this.scripts.set(name, {
          code,
          modules,
          vars,
          secrets: prev?.secrets ?? new Map(),
          workersDev: prev?.workersDev ?? false,
          tags: meta.tags ?? [],
          compatibilityDate: meta.compatibility_date,
          compatibilityFlags: meta.compatibility_flags ?? [],
          services,
        });
        return this.ok({ id: name });
      }
      if (method === "DELETE") {
        this.scripts.delete(name);
        return this.ok(null);
      }
    }
    const zone = `/zones/${CF_ZONE}`;
    if (path === `${zone}/workers/routes`) {
      if (method === "GET") return this.ok([...this.routes.values()]);
      const b = await json();
      if ([...this.routes.values()].some((r) => r.pattern === b.pattern))
        return this.bad(409, "duplicate route", 10020);
      const id = this.id("r_");
      this.routes.set(id, { id, pattern: b.pattern, script: b.script });
      return this.ok({ id });
    }
    m = path.match(new RegExp(`^${zone}/workers/routes/(.+)$`));
    if (m && method === "DELETE") {
      return this.routes.delete(m[1] as string)
        ? this.ok({ id: m[1] })
        : this.bad(404, "route not found");
    }
    if (path === `${zone}/dns_records`) {
      if (method === "GET") {
        const name = url.searchParams.get("name");
        return this.ok([...this.dns.values()].filter((r) => r.name === name));
      }
      const b = await json();
      const id = this.id("d_");
      this.dns.set(id, { id, type: b.type, name: b.name, content: b.content, proxied: b.proxied });
      return this.ok({ id });
    }
    m = path.match(new RegExp(`^${zone}/dns_records/(.+)$`));
    if (m && method === "DELETE") {
      return this.dns.delete(m[1] as string)
        ? this.ok({ id: m[1] })
        : this.bad(404, "record not found");
    }
    return this.bad(404, `no fake for ${method} ${path}`);
  };

  /** A request to a deployed hostname: answered if a route points at a live script. */
  private site(url: URL): Response {
    const route = [...this.routes.values()].find((r) => r.pattern === `${url.host}/*`);
    const dns = [...this.dns.values()].find((r) => r.name === url.host);
    if (!route || !dns || !this.scripts.has(route.script))
      return new Response("no route", { status: 522 });
    if (this.failing.has(url.host)) return new Response("boom", { status: 500 });
    return new Response(`hello from ${route.script}`, { status: 200 });
  }
}
