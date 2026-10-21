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

If the operator gave you a team key, add the header X-Team-Key: <team key> to POST ${base}/api/sites. The site then belongs to that team (it may get the data/files backend and be listed in the public directory at ${base}/api/directory). Never put the team key in a page. A wrong key answers 401 INVALID_TEAM_KEY; omit the header to upload as a guest. Humans on the team sign in at ${base}/login with their own member account (invited by an owner; roles owner/editor/viewer) or with the team key (acts as owner) to manage the team's sites in a dashboard (publish, replace, extend, delete, browse KV and files).

## MCP per space

Each site has a Streamable HTTP MCP server at ${base}/mcp/s/<siteId>. Auth: Authorization: Bearer marsa_mcp_... (a per-site token a team member creates on the site page; read-only or read-write). Tools: get_site_info, list_files, read_file, replace_site_files (rw), and with the backend kv_list, kv_get, kv_put, kv_delete, list_uploads, upload_file, delete_file. For teams with Workers also list_workers, list_worker_versions, get_worker_version, worker_env, worker_status (ro) and deploy_worker, redeploy_worker, rollback_worker, delete_worker, set_worker_secret, set_worker_runtime, set_worker_links (rw).

## Run & observe Workers (teams with Workers)

- Declare what the code needs: "requiredEnv": ["API_KEY", …] on PUT ${base}/api/teams/<team>/workers/<name>. GET …/workers/<name>/env (MCP: worker_env) lists names, types and status: "missing" = declared but not set, "unset" = read in code without a default (info only). Values are never returned.
- Secrets: PUT …/workers/<name>/secrets/<NAME> {"value": "…"} (write-only, no redeploy; agent keys need workers:secrets) or MCP set_worker_secret. Plain vars: PUT|DELETE …/vars/<NAME>.
- Health: GET …/workers/<name>/health. Up = web Workers answer < 400 at the URL, MCP servers answer initialize (or < 500). Declare your own check with meta {"healthPath": "/health", "healthExpect": "2xx"}.
- Usage and errors: GET …/usage?range=24h|7d|30d and GET …/logs. MCP worker_status returns health, usage and recent errors in one call. Full log lines need Workers Logs on for that Worker and the operator's Cloudflare token to have "Account · Workers Observability: Edit (API: Write)" ("Read" alone answers 403); without it …/logs still returns analytics error counts.
- Every change is in the team's activity log: GET ${base}/api/teams/<team>/activity (team key; ?format=csv|jsonl).

## Limits on this instance

- ttlHours: ${config.minTtlHours}-${config.maxTtlHours} (default ${config.defaultTtlHours}); a link never outlives created + ${config.maxTtlHours}h
- Teams the admin allows can publish with ttlHours=permanent (no expiry); team quotas apply (default ${config.teamMaxSites} live sites, ${mb(config.teamMaxBytes)} MB per team)
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
- [Agent recipes](${base}/docs/recipes): step-by-step playbooks (MCP server on a Worker with a downloadable TypeScript + Hono starter at ${base}/api/recipes/mcp-server-on-worker/starter.zip, security rules, KV/files, bilingual project pages, protecting an MCP with keys, a self-hosted Python MCP, agent notes). As markdown: ${base}/api/recipes/<slug>?format=md\n- Agent notes: hit a problem? POST ${base}/api/teams/<team>/notes (team or agent key) or the MCP tool leave_note; the admin replies
- [Workers: deploy, run & observe](${base}/docs/workers)
- [Agent keys and invites](${base}/docs/agent-keys)
- [Data & files backend](${base}/docs/backend)
- [Teams and the public directory](${base}/docs/teams)
- [OpenAPI spec](${base}/openapi.json)
`;
}
