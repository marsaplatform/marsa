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

## Teams (optional)

If the operator gave you a team key, add the header X-Team-Key: <team key> to POST ${base}/api/sites. The site then belongs to that team (it may get the data/files backend and be listed in the public directory at ${base}/api/directory). Never put the team key in a page. A wrong key answers 401 INVALID_TEAM_KEY; omit the header to upload as a guest.

## Limits on this instance

- ttlHours: ${config.minTtlHours}-${config.maxTtlHours} (default ${config.defaultTtlHours}); a link never outlives created + ${config.maxTtlHours}h
- ${config.maxFiles} files, ${mb(config.maxFileBytes)} MB per file, ${mb(config.maxSiteBytes)} MB per site
- ${config.uploadsPerHour} uploads per hour per IP
- Rejected: server scripts and executables (.php, .py, .sh, .exe, ...). Dotfiles are dropped.
- Pages run in a browser sandbox: no cookies or localStorage; fetch() to CORS-enabled public APIs works.

## Optional data/files backend

${
  config.backend.guestAccess
    ? "Every site may use it."
    : "Only sites uploaded with the key of a team that has backend access may use it; other sites get 403 BACKEND_NOT_ALLOWED."
}

${
  config.cloudflare
    ? `Enabled on this instance. Per site, deleted with it. Writes need the edit token; reads are ${config.backend.publicRead ? "public while the site is live" : "token-only"}.

- PUT ${base}/api/sites/<id>/kv/<key> with {"value": <any JSON>} (max ${Math.round(config.backend.maxValueBytes / 1024)} KB, ${config.backend.maxKeys} keys); GET/DELETE the same URL; GET ${base}/api/sites/<id>/kv lists keys
- POST ${base}/api/sites/<id>/files (multipart field "file"); GET ${base}/api/sites/<id>/files lists; GET/DELETE ${base}/api/sites/<id>/files/<fileId>
- In pages: <script src="/sdk.js"></script> then marsa.kv.get(key), marsa.files.list(). Never put the edit token in a page.`
    : "Not enabled on this instance: the /api/sites/<id>/kv and /files routes answer 503 BACKEND_NOT_CONFIGURED. Static publishing works normally."
}

## Errors

JSON {"error": {"code", "message", "path"?}}. Codes: EMPTY_UPLOAD, INVALID_REQUEST, INVALID_PATH, ZIP_SLIP_REJECTED, INVALID_ZIP, FILE_TOO_LARGE, SITE_TOO_LARGE, TOO_MANY_FILES, BLOCKED_FILE_TYPE (415), RATE_LIMITED (429, see Retry-After), NOT_FOUND, EXPIRED (410), INVALID_TEAM_KEY (401), BACKEND_NOT_ALLOWED (403), BACKEND_NOT_CONFIGURED (503). Fix the files and retry.

## Docs

- [API reference](${base}/docs/api)
- [Guide for AI agents](${base}/docs/agents)
- [Data & files backend](${base}/docs/backend)
- [Teams and the public directory](${base}/docs/teams)
- [OpenAPI spec](${base}/openapi.json)
`;
}
