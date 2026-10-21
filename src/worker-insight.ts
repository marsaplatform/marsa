/**
 * What a Worker is (0.15.1): type, language/stack and MCP tool count. Declared metadata
 * from the deploy wins; otherwise heuristics on the stored code; for MCP servers a cached,
 * read-only live probe (initialize + tools/list) fills in the tool count.
 */
import { readHealthExpect, readHealthPath } from "./worker-health.js";

export type WorkerKind = "mcp" | "web" | "other";
export const WORKER_KINDS: WorkerKind[] = ["mcp", "web", "other"];
export const WORKER_LANGUAGES = ["typescript", "javascript", "python", "unknown"] as const;
export type WorkerLanguage = (typeof WORKER_LANGUAGES)[number];

/** Declared by the deployer (all optional). */
export interface WorkerMeta {
  kind?: WorkerKind;
  language?: Exclude<WorkerLanguage, "unknown">;
  framework?: string;
  toolsCount?: number;
  /** Id of the team's space that documents this Worker. */
  spaceSlug?: string;
  /** 0.16.0: health check path (plain GET) and expected statuses ("2xx", "200-399"). */
  healthPath?: string;
  healthExpect?: string;
}

export class MetaError extends Error {}

const FRAMEWORK_RE = /^[a-z0-9][a-z0-9 .+_-]{0,29}$/i;

/** undefined = keep; null = clear. Unknown keys are refused so typos are visible. */
export function readMeta(raw: unknown): WorkerMeta | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new MetaError("meta must be an object");
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).find(
    (k) =>
      ![
        "kind",
        "language",
        "framework",
        "toolsCount",
        "spaceSlug",
        "healthPath",
        "healthExpect",
      ].includes(k),
  );
  if (extra) throw new MetaError(`meta.${extra.slice(0, 30)} is not supported`);
  const out: WorkerMeta = {};
  if (o.kind !== undefined) {
    const k = o.kind === "site" || o.kind === "api" ? "web" : o.kind;
    if (!WORKER_KINDS.includes(k as WorkerKind))
      throw new MetaError('meta.kind: "mcp", "web" (site/API) or "other"');
    out.kind = k as WorkerKind;
  }
  if (o.language !== undefined) {
    const l = typeof o.language === "string" ? o.language.toLowerCase() : "";
    const norm = l === "ts" ? "typescript" : l === "js" ? "javascript" : l === "py" ? "python" : l;
    if (!["typescript", "javascript", "python"].includes(norm))
      throw new MetaError('meta.language: "typescript", "javascript" or "python"');
    out.language = norm as WorkerMeta["language"];
  }
  if (o.framework !== undefined) {
    if (typeof o.framework !== "string" || !FRAMEWORK_RE.test(o.framework))
      throw new MetaError("meta.framework: up to 30 letters, digits, spaces or . + _ -");
    out.framework = o.framework;
  }
  if (o.toolsCount !== undefined) {
    if (
      !Number.isInteger(o.toolsCount) ||
      (o.toolsCount as number) < 0 ||
      (o.toolsCount as number) > 500
    )
      throw new MetaError("meta.toolsCount: an integer 0-500");
    out.toolsCount = o.toolsCount as number;
  }
  if (o.spaceSlug !== undefined) {
    if (typeof o.spaceSlug !== "string" || !/^[a-z0-9-]{1,64}$/i.test(o.spaceSlug))
      throw new MetaError("meta.spaceSlug: the id of one of your spaces");
    out.spaceSlug = o.spaceSlug;
  }
  try {
    if (o.healthPath !== undefined && o.healthPath !== "")
      out.healthPath = readHealthPath(o.healthPath);
    if (o.healthExpect !== undefined && o.healthExpect !== "")
      out.healthExpect = readHealthExpect(o.healthExpect);
  } catch (e) {
    throw new MetaError(`meta.${(e as Error).message}`);
  }
  return out;
}

export interface Detected {
  kind: WorkerKind;
  language: WorkerLanguage;
  framework: string | null;
  /** The code serves /mcp (string marker or the MCP SDK). */
  mcp: boolean;
}

const MCP_RE =
  /["'`]\/mcp\b|modelcontextprotocol|"tools\/list"|'tools\/list'|McpServer|jsonrpc["']?\s*:\s*["']2\.0/;
// Hono, even minified: its error strings survive bundling.
const HONO_RE = /Context is not finalized|\bnew Hono\b|from ["']hono["']|hono\/|getPath\(|"x-hono/;
const ITTY_RE = /itty-router|\bAutoRouter\b/;
const TS_RE = /\/\/ src\/[^\n]*\.ts\b|\.ts["']\)|__decorateClass|__name\(/;

/** Best guess from the code alone. */
export function detectFromCode(code: string | null | undefined): Detected {
  if (!code) return { kind: "other", language: "unknown", framework: null, mcp: false };
  const mcp = MCP_RE.test(code);
  const hasFetch =
    /\bfetch\s*[(:]|\bfetch\s*\(/.test(code) || /export\s*\{[^}]*as default/.test(code);
  const framework = HONO_RE.test(code) ? "hono" : ITTY_RE.test(code) ? "itty-router" : null;
  const language: WorkerLanguage = TS_RE.test(code)
    ? "typescript"
    : /pyodide|__python__/.test(code)
      ? "python"
      : "javascript";
  return { kind: mcp ? "mcp" : hasFetch ? "web" : "other", language, framework, mcp };
}

export interface Insight extends Detected {
  /** Where each value came from. */
  source: {
    kind: "declared" | "code";
    language: "declared" | "code";
    tools: "declared" | "probe" | "none";
  };
  toolsCount: number | null;
  toolNames: string[];
  endpoint: string | null;
  probe: ProbeResult | null;
}

export interface ProbeResult {
  at: string;
  ok: boolean;
  status: number | null;
  tools: string[];
  /** e.g. "protected" when the server asks for a key. */
  note?: string;
}

/** Merge declared metadata, code heuristics and the last probe. */
export function insightOf(
  meta: WorkerMeta | undefined,
  code: string | null | undefined,
  url: string,
  probe: ProbeResult | null,
): Insight {
  const d = detectFromCode(code);
  const kind = meta?.kind ?? d.kind;
  const language = meta?.language ?? d.language;
  const framework = meta?.framework ?? d.framework;
  const tools = probe?.ok ? probe.tools : [];
  const toolsCount = meta?.toolsCount ?? (probe?.ok ? tools.length : null);
  return {
    kind,
    language,
    framework,
    mcp: kind === "mcp",
    source: {
      kind: meta?.kind ? "declared" : "code",
      language: meta?.language ? "declared" : "code",
      tools: meta?.toolsCount !== undefined ? "declared" : probe?.ok ? "probe" : "none",
    },
    toolsCount,
    toolNames: tools,
    endpoint: kind === "mcp" && url ? `${url.replace(/\/$/, "")}/mcp` : null,
    probe,
  };
}

/** "TypeScript + Hono", "JavaScript", "Unknown". */
export function stackLabel(i: { language: WorkerLanguage; framework: string | null }): string {
  const lang = {
    typescript: "TypeScript",
    javascript: "JavaScript",
    python: "Python",
    unknown: "Unknown",
  }[i.language];
  const fw = i.framework ? i.framework.replace(/^hono$/i, "Hono") : "";
  return fw ? `${lang} + ${fw}` : lang;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Read-only MCP probe: initialize, then tools/list (following a session id if the server
 * returns one). Short timeout; never calls a tool.
 */
export async function probeMcp(
  endpoint: string,
  fetchFn: FetchFn,
  now: () => number,
  timeoutMs = 4000,
): Promise<ProbeResult> {
  const at = new Date(now()).toISOString();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "marsa-spaces-probe/1 (read-only tools/list)",
  };
  const parse = async (r: Response) => {
    const text = await r.text();
    const json = text.trim().startsWith("{")
      ? text
      : (text
          .split("\n")
          .find((l) => l.startsWith("data:"))
          ?.slice(5) ?? "{}");
    try {
      return JSON.parse(json) as { result?: { tools?: { name: string }[] } };
    } catch {
      return {};
    }
  };
  try {
    const init = await fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "marsa-spaces-probe", version: "1" },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (init.status === 401 || init.status === 403)
      return { at, ok: false, status: init.status, tools: [], note: "protected" };
    if (!init.ok) return { at, ok: false, status: init.status, tools: [] };
    await parse(init);
    const sid = init.headers.get("mcp-session-id");
    const h2 = {
      ...headers,
      ...(sid ? { "mcp-session-id": sid } : {}),
      "mcp-protocol-version": "2025-06-18",
    };
    await fetchFn(endpoint, {
      method: "POST",
      headers: h2,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);
    const list = await fetchFn(endpoint, {
      method: "POST",
      headers: h2,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!list.ok) return { at, ok: false, status: list.status, tools: [] };
    const body = await parse(list);
    const tools = (body.result?.tools ?? []).map((t) => String(t.name)).slice(0, 500);
    return { at, ok: Array.isArray(body.result?.tools), status: list.status, tools };
  } catch {
    return { at, ok: false, status: null, tools: [], note: "timeout" };
  }
}

/** Probe results per Worker and version, kept for `ttlMs`; background refresh, few at a time. */
export class ProbeCache {
  private readonly map = new Map<string, ProbeResult>();
  private readonly running = new Set<string>();
  constructor(
    private readonly fetchFn: FetchFn,
    private readonly now: () => number,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly maxParallel = 3,
  ) {}
  private key(id: string, version: number | null | undefined) {
    return `${id}@${version ?? 0}`;
  }
  get(id: string, version: number | null | undefined): ProbeResult | null {
    return this.map.get(this.key(id, version)) ?? null;
  }
  fresh(id: string, version: number | null | undefined): boolean {
    const p = this.get(id, version);
    return !!p && this.now() - Date.parse(p.at) < this.ttlMs;
  }
  /** Start a probe in the background when nothing fresh is cached. */
  touch(id: string, version: number | null | undefined, endpoint: string): void {
    const k = this.key(id, version);
    if (this.fresh(id, version) || this.running.has(k) || this.running.size >= this.maxParallel)
      return;
    void this.refresh(id, version, endpoint);
  }
  async refresh(
    id: string,
    version: number | null | undefined,
    endpoint: string,
  ): Promise<ProbeResult> {
    const k = this.key(id, version);
    this.running.add(k);
    try {
      const r = await probeMcp(endpoint, this.fetchFn, this.now);
      this.map.set(k, r);
      return r;
    } finally {
      this.running.delete(k);
    }
  }
}
