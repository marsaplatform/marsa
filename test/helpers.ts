import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SiteStore } from "../src/store.js";
import { VisitCounter } from "../src/visits.js";
import { MemoryBackend } from "./fake-backend.js";

export const ADMIN = "test-admin-token-0123456789abcdef";
export const BASE = "https://spaces.test";
export const ORIGIN = { origin: BASE };
export const HOUR = 3600_000;

/** A tiny browser: keeps cookies, sends Origin on POSTs, never follows redirects. */
export class Browser {
  jar = new Map<string, string>();
  constructor(
    private readonly app: { request: (p: string, i?: RequestInit) => Promise<Response> | Response },
  ) {}
  private cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  private keep(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = (pair ?? "").indexOf("=");
      const k = (pair ?? "").slice(0, i);
      const v = (pair ?? "").slice(i + 1);
      if (/max-age=0/i.test(c) || v === "") this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  async get(path: string, headers: Record<string, string> = {}) {
    return this.keep(
      await this.app.request(path, { headers: { cookie: this.cookie(), ...headers } }),
    );
  }
  async post(
    path: string,
    body: Record<string, string> | FormData,
    headers: Record<string, string> = ORIGIN,
  ) {
    const init: RequestInit = { method: "POST", headers: { cookie: this.cookie(), ...headers } };
    if (body instanceof FormData) init.body = body;
    else {
      init.body = new URLSearchParams(body).toString();
      (init.headers as Record<string, string>)["content-type"] =
        "application/x-www-form-urlencoded";
    }
    return this.keep(await this.app.request(path, init));
  }
  /** The CSRF token embedded in a page. */
  async csrf(path: string) {
    const html = await (await this.get(path)).text();
    const m = /name="_csrf" value="([^"]+)"/.exec(html);
    if (!m?.[1]) throw new Error(`no csrf token on ${path}`);
    return m[1];
  }
}

/** A fresh app on a temp dir with a controllable clock and an in-memory backend. */
export async function makeApp(env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "marsa-t-"));
  const clock = { now: Date.parse("2026-01-01T00:00:00Z") };
  const config = loadConfig({
    DATA_DIR: dir,
    PUBLIC_URL: BASE,
    ADMIN_TOKEN: ADMIN,
    SESSION_SECRET: "s".repeat(40),
    ...env,
  });
  const store = new SiteStore(config.dataDir);
  await store.init();
  const backend = new MemoryBackend();
  const visits = new VisitCounter(config.dataDir, config.visits, () => clock.now);
  const app = createApp({ config, store, backend, visits, now: () => clock.now });
  const api = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  const admin = (method: string, path: string, body?: unknown) =>
    api(method, `/api/admin${path}`, body, { authorization: `Bearer ${ADMIN}` });
  const createTeam = async (name: string, flags: Record<string, unknown> = {}) => {
    const res = await admin("POST", "/teams", { name, ...flags });
    if (res.status !== 201) throw new Error(`createTeam ${res.status}`);
    return (await res.json()) as { team: { id: string; permanent: boolean }; key: string };
  };
  const publish = async (
    key: string | null,
    html = "<title>Page</title><h1>x</h1>",
    query = "",
    extra: object[] = [],
  ) =>
    api(
      "POST",
      `/api/sites${query}`,
      { files: [{ path: "index.html", content: html }, ...extra] },
      key ? { "x-team-key": key } : {},
    );
  const signIn = async (key: string, prefix = "") => {
    const b = new Browser(app);
    const csrf = await b.csrf(`${prefix}/login`);
    const res = await b.post(`${prefix}/login`, { _csrf: csrf, key });
    return { b, res };
  };
  const adminBrowser = async () => {
    const b = new Browser(app);
    const csrf = await b.csrf("/admin/login");
    await b.post("/admin/login", { _csrf: csrf, token: ADMIN });
    return b;
  };
  const cleanup = () => rm(dir, { recursive: true, force: true });
  return {
    app,
    api,
    admin,
    createTeam,
    publish,
    signIn,
    adminBrowser,
    store,
    backend,
    visits,
    clock,
    config,
    dir,
    cleanup,
  };
}
