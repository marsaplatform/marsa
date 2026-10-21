import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

/**
 * Downloadable starter templates for built-in recipes (0.15.1). The files live in
 * docs/recipes/starters/<name>/ and are zipped once, in memory, on first request.
 */
export const RECIPE_STARTERS: Record<string, string> = {
  "mcp-server-on-worker": "mcp-worker-hono",
};

const SKIP = new Set(["node_modules", "dist", ".env", ".wrangler", ".DS_Store"]);

export interface Starter {
  name: string;
  files: { path: string; bytes: number }[];
  tree: string;
  zip: Buffer;
}

function startersDir(): string {
  return fileURLToPath(new URL("../docs/recipes/starters/", import.meta.url));
}

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const e of readdirSync(dir).sort()) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(root, p, out);
    else out.push(relative(root, p).split("\\").join("/"));
  }
  return out;
}

/** A plain-text tree like `tree` prints. */
export function treeOf(name: string, paths: string[]): string {
  type Node = Map<string, Node>;
  const root: Node = new Map();
  for (const p of paths) {
    let n = root;
    for (const part of p.split("/")) {
      if (!n.has(part)) n.set(part, new Map());
      n = n.get(part) as Node;
    }
  }
  const lines = [`${name}/`];
  const draw = (n: Node, pre: string) => {
    const keys = [...n.keys()].sort((a, b) => {
      const da = (n.get(a) as Node).size > 0;
      const db = (n.get(b) as Node).size > 0;
      return da === db ? a.localeCompare(b) : da ? -1 : 1;
    });
    keys.forEach((k, i) => {
      const last = i === keys.length - 1;
      const child = n.get(k) as Node;
      lines.push(`${pre}${last ? "└── " : "├── "}${k}${child.size ? "/" : ""}`);
      if (child.size) draw(child, `${pre}${last ? "    " : "│   "}`);
    });
  };
  draw(root, "");
  return lines.join("\n");
}

/** Minimal ZIP writer (deflate), enough for a few dozen text files. */
export function zipFiles(files: { path: string; data: Buffer }[], date = new Date()): Buffer {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, "utf8");
    const comp = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(8, 8);
    h.writeUInt16LE(dosTime, 10);
    h.writeUInt16LE(dosDate, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(f.data.length, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    local.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime, 12);
    c.writeUInt16LE(dosDate, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

const cache = new Map<string, Starter | null>();

/** The starter of a recipe, or null. Files sit under `<name>/` inside the zip. */
export function starterFor(slug: string, dir = startersDir()): Starter | null {
  const name = RECIPE_STARTERS[slug];
  if (!name) return null;
  const key = `${dir}:${name}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const root = join(dir, name);
  if (!existsSync(root)) {
    cache.set(key, null);
    return null;
  }
  const paths = walk(root);
  const files = paths.map((p) => ({ path: p, data: readFileSync(join(root, p)) }));
  const s: Starter = {
    name,
    files: files.map((f) => ({ path: f.path, bytes: f.data.length })),
    tree: treeOf(name, paths),
    zip: zipFiles(files.map((f) => ({ path: `${name}/${f.path}`, data: f.data }))),
  };
  cache.set(key, s);
  return s;
}
