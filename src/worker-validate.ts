/**
 * 0.17.0: check a team Worker's code BEFORE it goes to Cloudflare, so a broken upload is a
 * clear 400 instead of a deploy that fails later (or a Worker that answers 502).
 *
 * esbuild parses the module in memory (nothing is written, nothing is fetched):
 * - syntax errors → SYNTAX_ERROR with line and column;
 * - imports of files or npm packages that are not in the upload → MISSING_MODULE (Spaces
 *   uploads ONE module; bundle first, e.g. `esbuild --bundle --format=esm`);
 * - no default export in any form → NOT_A_MODULE. `export default …`,
 *   `export { x as default }`, `export { x as "default" }` and `export { default } from …`
 *   (of an allowed module) are all fine.
 * Runtime modules are allowed: `cloudflare:*`, `node:*` and bare Node built-ins (the
 * last two need the nodejs_compat flag at runtime).
 */
import { builtinModules } from "node:module";

export class CodeError extends Error {
  constructor(
    readonly code: "SYNTAX_ERROR" | "MISSING_MODULE" | "NOT_A_MODULE",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));
/** A specifier the Workers runtime provides (no bundling needed). */
export function isRuntimeModule(spec: string): boolean {
  if (spec.startsWith("cloudflare:") || spec.startsWith("node:")) return true;
  const base = spec.split("/")[0] ?? spec;
  return BUILTINS.has(spec) || BUILTINS.has(base);
}

export interface CodeCheck {
  /** Names the module exports ("default" is always among them when the check passes). */
  exports: string[];
  /** Runtime imports seen (cloudflare:*, node:*), for information. */
  runtimeImports: string[];
  /** esbuild was available (false = only the old pattern check ran). */
  parsed: boolean;
}

type Esbuild = typeof import("esbuild");
let esb: Promise<Esbuild | null> | null = null;
const loadEsbuild = () => {
  esb ??= import("esbuild").catch(() => null);
  return esb;
};

const DEFAULT_RE =
  /export\s+default\b|export\s*\{[^}]*\bas\s+["']?default\b|export\s*\{\s*default\b/;

/** Validate one ES module. Throws CodeError; resolves with what was found. */
export async function checkWorkerCode(code: string): Promise<CodeCheck> {
  const es = await loadEsbuild();
  if (!es) {
    if (!DEFAULT_RE.test(code)) throw notModule();
    return { exports: ["default"], runtimeImports: [], parsed: false };
  }
  const missing: { spec: string; line: number | null }[] = [];
  const runtime = new Set<string>();
  let result: Awaited<ReturnType<Esbuild["build"]>>;
  try {
    result = await es.build({
      stdin: { contents: code, loader: "js", sourcefile: "worker.js" },
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      metafile: true,
      logLevel: "silent",
      outfile: "worker.out.js",
      plugins: [
        {
          name: "marsa-imports",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) => {
              if (a.kind === "entry-point") return undefined;
              if (isRuntimeModule(a.path)) runtime.add(a.path);
              else missing.push({ spec: a.path, line: null });
              return { path: a.path, external: true };
            });
          },
        },
      ],
    });
  } catch (err) {
    const first = (
      err as {
        errors?: {
          text: string;
          location?: { line: number; column: number; lineText?: string } | null;
        }[];
      }
    ).errors?.[0];
    if (first) {
      const loc = first.location;
      throw new CodeError(
        "SYNTAX_ERROR",
        `code: ${first.text}${loc ? ` (line ${loc.line}, column ${loc.column + 1})` : ""}`,
        loc
          ? { line: loc.line, column: loc.column + 1, lineText: (loc.lineText ?? "").slice(0, 160) }
          : {},
      );
    }
    throw new CodeError("SYNTAX_ERROR", "code: could not be parsed as an ES module");
  }
  if (missing.length) {
    const specs = [...new Set(missing.map((m) => m.spec))];
    throw new CodeError(
      "MISSING_MODULE",
      `code imports ${specs
        .slice(0, 5)
        .map((s) => `"${s}"`)
        .join(", ")}${specs.length > 5 ? ` and ${specs.length - 5} more` : ""}, which ${
        specs.length === 1 ? "is" : "are"
      } not part of the upload. Spaces deploys ONE module: bundle it first (esbuild --bundle --format=esm).`,
      { missing: specs },
    );
  }
  const out = Object.values(result.metafile?.outputs ?? {})[0];
  const exports = out?.exports ?? [];
  if (!exports.includes("default")) throw notModule();
  return { exports, runtimeImports: [...runtime].sort(), parsed: true };
}

function notModule() {
  return new CodeError(
    "NOT_A_MODULE",
    'code must be an ES module with a default export: "export default { fetch(request, env) { … } }" or esbuild\'s "export { worker as default }"',
  );
}
