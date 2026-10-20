import { APP_NAME } from "./brand.js";
import type { Config } from "./config.js";

/** Plain-text instructions for AI agents, served at /llms.txt (https://llmstxt.org). */
export function llmsTxt(config: Config): string {
  const base = config.publicUrl;
  const mb = (b: number) => Math.round(b / (1024 * 1024));
  return `# ${APP_NAME}

> ${APP_NAME} publishes static files (HTML, CSS, JS, images) to a public, expiring link with one HTTP call. No account or API key: the response includes an edit token that manages the site.

Use it when you have produced a web page, HTML report, dashboard or prototype that a person should open in a browser. Return the link instead of pasting HTML.

## Publish

1. Put the files in a folder with index.html at the top level. Use relative links only.
2. Never include secrets, API keys or personal data: anyone with the link can view it.
3. Zip the folder contents and POST it:

    (cd OUT_DIR && zip -qr ../site.zip .)
    curl -s -X POST "${base}/api/sites?ttlHours=${config.defaultTtlHours}" -H "Content-Type: application/zip" --data-binary @site.zip

   Or send JSON: POST ${base}/api/sites with {"ttlHours": ${config.defaultTtlHours}, "files": [{"path": "index.html", "content": "<h1>Hi</h1>"}]} (binary files: add "encoding": "base64").

4. The 201 response is JSON: {"id", "url", "expiresAt", "editToken", ...}. Give the user "url" and "expiresAt". Keep "id" and "editToken" private.

## Manage (header: Authorization: Bearer <editToken>)

- Replace files: PUT ${base}/api/sites/<id> (same body formats)
- Change expiry: PATCH ${base}/api/sites/<id> with {"ttlHours": N}
- Delete: DELETE ${base}/api/sites/<id>

## Limits on this instance

- ttlHours: ${config.minTtlHours}-${config.maxTtlHours} (default ${config.defaultTtlHours}); a link never outlives created + ${config.maxTtlHours}h
- ${config.maxFiles} files, ${mb(config.maxFileBytes)} MB per file, ${mb(config.maxSiteBytes)} MB per site
- ${config.uploadsPerHour} uploads per hour per IP
- Rejected: server scripts and executables (.php, .py, .sh, .exe, ...). Dotfiles are dropped.
- Pages run in a browser sandbox: no cookies or localStorage; fetch() to CORS-enabled public APIs works.

## Errors

JSON {"error": {"code", "message", "path"?}}. Codes: EMPTY_UPLOAD, INVALID_REQUEST, INVALID_PATH, ZIP_SLIP_REJECTED, INVALID_ZIP, FILE_TOO_LARGE, SITE_TOO_LARGE, TOO_MANY_FILES, BLOCKED_FILE_TYPE (415), RATE_LIMITED (429, see Retry-After), NOT_FOUND, EXPIRED (410). Fix the files and retry.

## Docs

- [API reference](${base}/docs/api)
- [Guide for AI agents](${base}/docs/agents)
- [OpenAPI spec](${base}/openapi.json)
`;
}
