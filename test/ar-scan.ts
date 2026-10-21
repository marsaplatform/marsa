/**
 * 0.16.0: find Latin-only text in Arabic pages. Skips code, pre, kbd, bdi, script, style,
 * anything marked dir="ltr" or translate="no", attributes, and a short list of names that
 * stay in Latin (brands, protocols, units).
 */
const SKIP = new Set([
  "code",
  "pre",
  "kbd",
  "script",
  "style",
  "samp",
  "var",
  "svg",
  "textarea",
  "option",
]);
export const LATIN_OK = new Set(
  (
    "Marsa Spaces MCP API APIs Workers Worker Cloudflare KV R2 JSON JSONL CSV HTTP HTTPS URL Webhook " +
    "GitHub TypeScript JavaScript Python Hono SDK OpenAPI llms.txt ZIP zip ms KB MB GB TB h d " +
    "v GET POST PUT PATCH DELETE ID OK SSE AI CLI DNS DPA Logs Analytics Zad Sanad Fikra Team AR EN " +
    "README SHA-256 SHA Bearer token initialize tools/list Ctrl ⌘K K Esc Enter"
  ).split(" "),
);

export function latinTextNodes(html: string, names: string[] = []): string[] {
  const extra = new Set(names);
  const out: string[] = [];
  const stack: { tag: string; skip: boolean }[] = [];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].startsWith("<!")) continue;
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const closing = m[1] === "/";
      const attrs = m[3] ?? "";
      const voidTag =
        /^(br|hr|img|input|meta|link|source|wbr|area|col|embed|param|track)$/.test(tag) ||
        attrs.endsWith("/");
      if (closing) {
        for (let i = stack.length - 1; i >= 0; i--)
          if (stack[i]?.tag === tag) {
            stack.length = i;
            break;
          }
      } else if (!voidTag) {
        const parentSkip = stack.at(-1)?.skip ?? false;
        stack.push({
          tag,
          skip:
            parentSkip ||
            SKIP.has(tag) ||
            /\bdir="ltr"/.test(attrs) ||
            /\btranslate="no"/.test(attrs) ||
            /\blang="en"/.test(attrs) ||
            /\bclass="[^"]*\b(ltr|mono|sr-only-ltr)\b/.test(attrs),
        });
      }
      continue;
    }
    const text = (m[4] ?? "").replace(/&[a-z]+;|&#\d+;/g, " ").trim();
    if (!text || stack.at(-1)?.skip) continue;
    if (/[\u0600-\u06FF]/.test(text)) continue;
    const words = text.match(/[A-Za-z][A-Za-z0-9_.'/-]*/g) ?? [];
    const bad = words.filter(
      (w) =>
        w.length > 1 &&
        !/^[A-Z0-9-]+$/.test(w) &&
        !/^v\d+$/.test(w) &&
        !w.includes(".") &&
        !w.startsWith("marsa_") &&
        !extra.has(w) &&
        !LATIN_OK.has(w) &&
        !LATIN_OK.has(w.replace(/[.]$/, "")),
    );
    if (bad.length) out.push(text.slice(0, 80));
  }
  return [...new Set(out)];
}
