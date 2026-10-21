import { APP_NAME, APP_TAGLINE } from "./brand.js";
import type { Config } from "./config.js";
import { addMorePaths } from "./openapi-more.js";

const json = (schema: object) => ({ "application/json": { schema } });
const err = (description: string) => ({
  description,
  content: json({ $ref: "#/components/schemas/Error" }),
});

const uploadBody = {
  required: true,
  content: {
    "application/zip": { schema: { type: "string", format: "binary" } },
    "application/json": { schema: { $ref: "#/components/schemas/FilesUpload" } },
    "multipart/form-data": {
      schema: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string", format: "binary" } },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Relative path for each entry of `files`, same order.",
          },
          ttlHours: { type: "number" },
        },
        required: ["files"],
      },
    },
  },
};

const readNote =
  "Public while the site is live when BACKEND_PUBLIC_READ=true (default); otherwise needs the edit token. Answers 503 BACKEND_NOT_CONFIGURED when the instance has no backend.";
const keyParam = {
  name: "key",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
};
const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const site = (description: string) => ({
  description,
  content: json({ $ref: "#/components/schemas/Site" }),
});

/** OpenAPI 3.1 description of the public API, served at /openapi.json. */
export function openapi(config: Config) {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: `${APP_NAME} API`,
      version: "0.16.0",
      description: `${APP_TAGLINE} Upload static files and get an expiring, shareable link. No account: the edit token returned at creation manages the site. Teams can also sign in in a browser at /login (team key) to manage their sites; the admin signs in at /admin/login. Those browser routes use session cookies and are not part of this API. Each site also has an MCP server (Streamable HTTP, JSON-RPC) at /mcp/s/{siteId} with per-site bearer tokens; see /docs/mcp.`,
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: config.publicUrl }],
    components: {
      securitySchemes: {
        editToken: { type: "http", scheme: "bearer", description: "The site's edit token." },
        adminToken: { type: "http", scheme: "bearer", description: "The instance ADMIN_TOKEN." },
        teamKey: {
          type: "apiKey",
          in: "header",
          name: "X-Team-Key",
          description:
            "Optional team key (from the admin). Attaches a new site to its team. Authorization: Bearer <team key> also works. An agent key (marsa_agent_…) works wherever the team key does, limited to its scopes (403 INSUFFICIENT_SCOPE otherwise); see /docs/agent-keys.",
        },
      },
      schemas: {
        FileInput: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string", example: "index.html" },
            content: { type: "string" },
            encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" },
          },
        },
        FilesUpload: {
          type: "object",
          required: ["files"],
          properties: {
            ttlHours: {
              description: `${config.minTtlHours}-${config.maxTtlHours}, or "permanent" (teams allowed to)`,
              oneOf: [
                { type: "number", minimum: config.minTtlHours, maximum: config.maxTtlHours },
                { type: "string", enum: ["permanent"] },
              ],
            },
            permanent: { type: "boolean", description: 'Same as ttlHours: "permanent"' },
            files: { type: "array", items: { $ref: "#/components/schemas/FileInput" } },
          },
        },
        Site: {
          type: "object",
          properties: {
            id: { type: "string" },
            url: { type: "string", format: "uri" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            expiresAt: {
              type: "string",
              format: "date-time",
              description: "9999-12-31T00:00:00.000Z for permanent sites",
            },
            permanent: { type: "boolean", description: "No expiry (team sites only)" },
            fileCount: { type: "integer" },
            totalBytes: { type: "integer" },
            title: { type: "string", description: "<title> of index.html, if any" },
            team: {
              type: ["object", "null"],
              description: "The team the site was uploaded under; null for guest uploads.",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                backend: { type: "boolean" },
              },
            },
            files: {
              type: "object",
              additionalProperties: {
                type: "object",
                properties: { size: { type: "integer" }, mime: { type: "string" } },
              },
            },
          },
        },
        CreatedSite: {
          allOf: [
            { $ref: "#/components/schemas/Site" },
            {
              type: "object",
              properties: {
                editToken: {
                  type: "string",
                  description: "Shown once. Keep it to manage the site.",
                },
              },
            },
          ],
        },
        Team: {
          type: "object",
          properties: {
            id: { type: "string", example: "t_k3v9x2mq" },
            name: { type: "string" },
            backend: { type: "boolean", description: "May its sites use KV/files?" },
            directory: { type: "boolean", description: "Listed in /api/directory?" },
            permanent: { type: "boolean", description: "May publish permanent sites?" },
            maxSites: { type: "integer", description: "Quota override (unset = server default)" },
            maxMb: {
              type: "integer",
              description: "Quota override in MB (unset = server default)",
            },
            quota: {
              type: "object",
              properties: { sites: { type: "integer" }, mb: { type: "integer" } },
              description: "Effective quota",
            },
            keyPrefix: { type: "string", description: "First characters of the key" },
            liveSites: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        TeamInput: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 80 },
            backend: { type: "boolean", default: false },
            directory: { type: "boolean", default: true },
            permanent: { type: "boolean", description: "Default: same as backend" },
            maxSites: { type: ["integer", "null"], description: "null or 0 = server default" },
            maxMb: { type: ["integer", "null"], description: "null or 0 = server default" },
          },
        },
        TeamWithKey: {
          type: "object",
          properties: {
            team: { $ref: "#/components/schemas/Team" },
            key: { type: "string", description: "The team key. Shown only in this response." },
          },
        },
        Directory: {
          type: "object",
          properties: {
            generatedAt: { type: "string", format: "date-time" },
            featured: {
              type: "array",
              items: { type: "string" },
              description:
                "Site ids spotlighted on the home page: FEATURED_SITES that are live, else the newest page.",
            },
            teams: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  sites: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        url: { type: "string", format: "uri" },
                        createdAt: { type: "string", format: "date-time" },
                        expiresAt: { type: "string", format: "date-time" },
                        cover: {
                          type: "string",
                          nullable: true,
                          description:
                            "Same-origin URL (/covers/<id>?v=…) of the site's own cover image, or null.",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "BLOCKED_FILE_TYPE" },
                message: { type: "string" },
                path: { type: "string" },
              },
            },
          },
        },
      },
    },
    paths: {
      "/api/teams/{team}/workers": {
        get: {
          summary: "List the team's Workers",
          operationId: "listWorkers",
          description:
            "Team Workers (see /docs/workers). Needs the team key; {team} is the team slug or id. 0.16.0: each Worker has varNames; plain var values (vars) are deprecated here and leave the list at the Sunset date (see the Deprecation/Sunset headers and deprecations[]); includeValues=1 (workers:deploy) keeps them.",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            {
              name: "includeValues",
              in: "query",
              schema: { type: "string", enum: ["1"] },
              description: "Return plain var values (needs workers:deploy)",
            },
          ],
          responses: { "200": { description: "Workers and quota" } },
        },
        post: {
          summary: "Create a Worker",
          operationId: "createWorker",
          description:
            'JSON {"name","code","vars"?,"secrets"?}. code is one ES module. Spaces deploys it to Cloudflare as team-<slug>-<name> at https://<slug>-<name>.<zone>.',
          security: [{ teamKey: [] }],
          parameters: [{ name: "team", in: "path", required: true, schema: { type: "string" } }],
          responses: { "201": { description: "Deployed" } },
        },
      },
      "/api/teams/{team}/workers/{name}": {
        put: {
          summary: "Create or redeploy a Worker",
          operationId: "putWorker",
          description:
            'JSON {"code","vars"?,"secrets"?,"compatibilityDate"?,"compatibilityFlags"?,"bindings"?} or the raw script as application/javascript. Omitted vars and runtime settings are kept; secrets are write-only (null removes one). compatibilityFlags is allowlisted (global_fetch_strictly_public, nodejs_compat, nodejs_als). bindings are service bindings to Workers of the same team only: [{"name":"NEWS","worker":"news"}]; 409 WORKER_BOUND when deleting a Worker another one binds to.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Redeployed" }, "201": { description: "Created" } },
        },
        get: {
          summary: "One Worker, with a live check",
          operationId: "getWorker",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "The Worker" } },
        },
        delete: {
          summary: "Delete a Worker (route, DNS record, script)",
          operationId: "deleteWorker",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "204": { description: "Deleted" } },
        },
      },
      "/api/teams/{team}/workers/{name}/versions": {
        get: {
          summary: "Stored versions of a Worker (newest first, last 10)",
          operationId: "listWorkerVersions",
          description: "No code; secret names only. Agent keys need workers:read.",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Versions" } },
        },
      },
      "/api/teams/{team}/workers/{name}/versions/{n}/code": {
        get: {
          summary: "Download the code of a stored version",
          operationId: "getWorkerVersionCode",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "n", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: { "200": { description: "The script (text/javascript)" } },
        },
      },
      "/api/teams/{team}/workers/{name}/runtime": {
        post: {
          summary: "Set compatibility date/flags and same-team service bindings",
          operationId: "setWorkerRuntime",
          description:
            'JSON {"compatibilityDate"?: "YYYY-MM-DD"|null, "compatibilityFlags"?: [..], "bindings"?: [{"name","worker"}]}. Redeploys the newest stored code with them (a new version); the bound Workers are not changed. 409 NO_STORED_VERSION when nothing is stored yet.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Redeployed" },
            "400": { description: "Invalid flag, date or binding" },
          },
        },
      },
      "/api/teams/{team}/workers/{name}/links": {
        post: {
          summary: "Declare a Worker's type/stack, source repo and Space page (no redeploy)",
          operationId: "setWorkerLinks",
          description:
            'JSON {"meta"?: {"kind": "mcp"|"web"|"other", "language"?, "framework"?, "toolsCount"?, "spaceSlug"?}|null, "repo"?: {"url": "https://github.com/org/repo", "branch"?, "commitSha"?}|null, "spaceId"?: string|null}. Omit a field to keep it, null clears it. The same `meta` and `repo` are accepted on deploy (PUT …/workers/{name}). Repos are checked read-only on GitHub (public/private/not found, synced/behind).',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Saved" },
            "400": { description: "Invalid meta, repo, or a space of another team" },
          },
        },
      },
      "/api/teams/{team}/workers/{name}/env": {
        get: {
          summary: "A Worker's vars & secrets: names, types, status (never values)",
          operationId: "getWorkerEnv",
          description:
            'Live bindings from Cloudflare merged with Spaces\' record: name, kind (var/secret/system/binding/missing), Cloudflare type, status (set/empty/missing), last updated and by whom. "missing" lists names declared in requiredEnv or used as env.X in the code that are not set. No value is ever returned. Scope workers:read.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/teams/{team}/workers/{name}/secrets/{secret}": {
        put: {
          summary: "Set or rotate one secret (write-only, no redeploy)",
          operationId: "setWorkerSecret",
          description:
            'JSON {"value": "…"} (≤5 KB). The value goes to Cloudflare and is never returned or shown. Names: letters, digits, _; MARSA_* is reserved. Recorded in the activity log (name only). Scope workers:secrets or workers:deploy. 60 changes/hour per team. MCP: set_worker_secret.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "secret", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
        delete: {
          summary: "Delete one secret",
          operationId: "deleteWorkerSecret",
          description:
            "Removes the secret from the Worker (no redeploy). Scope workers:secrets or workers:deploy.",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "secret", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/teams/{team}/workers/{name}/vars/{var}": {
        put: {
          summary: "Set one plain var (redeploys the newest stored code)",
          operationId: "setWorkerVar",
          description: 'JSON {"value": "…"}. Creates a new version. Scope workers:deploy.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "var", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
        delete: {
          summary: "Delete one plain var (redeploys)",
          operationId: "deleteWorkerVar",
          description: "Scope workers:deploy.",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "var", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/teams/{team}/workers/{name}/health": {
        get: {
          summary: "Uptime, latency and incidents from Spaces' health checks",
          operationId: "getWorkerHealth",
          description:
            "Checks run every few minutes (GET of the URL, or MCP initialize for MCP servers without their own auth). Two failures in a row = down; one notification on down and one on recovery.",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
        post: {
          summary: "Turn health checks on/off, or check now",
          operationId: "editWorkerHealth",
          description:
            'JSON {"enabled"?: boolean, "check"?: true}. Scope workers:deploy. Manual checks: 12/hour.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/teams/{team}/workers/{name}/logs": {
        get: {
          summary: "Recent errors (24h): analytics error counts + Workers Logs lines when on",
          operationId: "getWorkerLogs",
          description:
            "Messages are scrubbed of secret-like strings and URLs lose their query string. ?refresh=1 skips the 5-minute cache.",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
        post: {
          summary: "Turn Workers Logs (Cloudflare observability) on/off",
          operationId: "editWorkerLogs",
          description:
            'JSON {"enabled": boolean}. Changes script settings only (no new code). Scope workers:deploy.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/teams/{team}/workers/{name}/usage": {
        get: {
          summary: "Requests, errors and CPU (24h/7d/30d) and requests per end-user key",
          operationId: "getWorkerUsage",
          description:
            "?range=24h|7d|30d. From Cloudflare GraphQL analytics (cached 5 min) and Spaces' own rate-limit counters.",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/teams/{team}/notes": {
        post: {
          summary: "Leave a note for the platform admin (agent feedback)",
          operationId: "leaveNote",
          description:
            'Team key or any agent key. JSON {"severity": "info"|"bug"|"blocker"|"suggestion", "message": "…" (≤2000), "stage"?: "deploy"|"build"|"runtime"|"recipe"|"other", "category"?, "target"?: {"type": "space"|"worker"|"mcp"|"recipe", "id"}, "version"?, "agent"?}. Secrets are removed; 30 notes/hour per key; blockers notify the admin. MCP: leave_note.',
          security: [{ teamKey: [] }],
          parameters: [{ name: "team", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "201": { description: "Stored" },
            "400": { description: "Invalid note" },
            "429": { description: "Rate limited" },
          },
        },
        get: {
          summary: "The team's notes with status and the admin's reply",
          operationId: "listNotes",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["open", "ack", "resolved"] },
            },
          ],
          responses: { "200": { description: "Notes, newest first" } },
        },
      },
      "/api/recipes/{slug}/starter.zip": {
        get: {
          summary: "Download a recipe's starter template (zip)",
          operationId: "getStarterZip",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "application/zip" },
            "404": { description: "No starter" },
          },
        },
      },
      "/api/recipes/{slug}/starter": {
        get: {
          summary: "A recipe's starter template: name, zip URL, file tree and file list",
          operationId: "getStarter",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Starter info" },
            "404": { description: "No starter" },
          },
        },
      },
      "/api/teams/{team}/workers/{name}/redeploy": {
        post: {
          summary: "One-click redeploy of the newest stored version",
          operationId: "redeployWorker",
          description:
            'Optional JSON {"note"}. Secrets are kept. 409 NO_STORED_VERSION when nothing is stored yet.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Redeployed" } },
        },
      },
      "/api/teams/{team}/workers/{name}/rollback": {
        post: {
          summary: "Roll a Worker back to a stored version",
          operationId: "rollbackWorker",
          description:
            'JSON {"version": n, "note"?}. Recorded as a new version; returns missingSecrets.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Rolled back" } },
        },
      },
      "/api/teams/{team}/sites": {
        get: {
          summary: "The team's live sites",
          operationId: "listTeamSites",
          description: "Team key, or an agent key with spaces:read.",
          security: [{ teamKey: [] }],
          parameters: [{ name: "team", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Sites" } },
        },
      },
      "/api/recipes": {
        get: {
          summary: "List agent recipes",
          operationId: "listRecipes",
          description:
            "Built-in and platform recipes; with a team or agent key (any scope), the team's own too. ?lang=ar|en.",
          parameters: [
            { name: "lang", in: "query", schema: { type: "string", enum: ["en", "ar"] } },
          ],
          responses: {
            "200": { description: "Recipes (slug, title, summary, version, tags, langs)" },
          },
        },
      },
      "/api/recipes/{slug}": {
        get: {
          summary: "Read a recipe",
          operationId: "getRecipe",
          description: "JSON with markdown, or text/markdown with ?format=md. ?lang=ar|en.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "lang", in: "query", schema: { type: "string", enum: ["en", "ar"] } },
            { name: "format", in: "query", schema: { type: "string", enum: ["md"] } },
          ],
          responses: { "200": { description: "Recipe" }, "404": { description: "Not found" } },
        },
      },
      "/api/teams/{team}/recipes/{slug}": {
        put: {
          summary: "Create or update a team recipe",
          operationId: "putTeamRecipe",
          description:
            'Team key, or an agent key with spaces:write. JSON {"title_en","title_ar","summary_en","summary_ar","body_en","body_ar","tags"} (markdown, 64 KB per language). Each save bumps the version.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Saved" },
            "409": { description: "Slug used by a built-in or platform recipe" },
          },
        },
        delete: {
          summary: "Delete a team recipe",
          operationId: "deleteTeamRecipe",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "204": { description: "Deleted" } },
        },
      },
      "/api/teams/{team}/workers/{name}/keys": {
        get: {
          summary: "A Worker's end-user API keys, settings and usage",
          operationId: "listUserKeys",
          description: "Team key, or an agent key with workers:read. Secrets are never returned.",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Settings + keys" } },
        },
        post: {
          summary: "Create an end-user API key for a Worker",
          operationId: "createUserKey",
          description:
            'Team key, or an agent key with workers:deploy. JSON {"label","email"?,"expiresInDays"?,"perMinute"?,"perDay"?,"tools"?}. Returns the key (msk_…) once.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "201": { description: "Created" } },
        },
      },
      "/api/teams/{team}/workers/{name}/keys/settings": {
        put: {
          summary: "Require API keys for a Worker; default limits",
          operationId: "setUserKeySettings",
          description:
            'JSON {"required": bool, "perMinute"?, "perDay"?}. The first time keys are required, Spaces sets the Worker secrets MARSA_KEYS_URL and MARSA_KEYS_SECRET.',
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Settings" } },
        },
      },
      "/api/teams/{team}/workers/{name}/keys/{id}": {
        delete: {
          summary: "Revoke an end-user API key",
          operationId: "revokeUserKey",
          security: [{ teamKey: [] }],
          parameters: [
            { name: "team", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Revoked" } },
        },
      },
      "/api/keys/verify": {
        post: {
          summary: "Check an end-user key (called by the Worker)",
          operationId: "verifyUserKey",
          description:
            'Authorization: Bearer <MARSA_KEYS_SECRET>. JSON {"key","tool"?,"uses"?}. Answers 200 with {allow, status (200/401/403/429), code, remaining, tools, cacheSeconds, retryAfter?}.',
          responses: {
            "200": { description: "Decision" },
            "401": { description: "Unknown verifier" },
          },
        },
      },
      "/api/teams/{team}/agent-keys": {
        get: {
          summary: "List agent keys and open invite links (team key only)",
          operationId: "listAgentKeys",
          security: [{ teamKey: [] }],
          parameters: [{ name: "team", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Keys (never secrets)" } },
        },
        post: {
          summary: "Create an agent key (team key only)",
          operationId: "createAgentKey",
          description:
            'JSON {"name","description"?,"scopes":[…],"expiresInDays": 1-365}. Scopes: workers:read, workers:deploy, spaces:read, spaces:write, kv:read, kv:write, mcp. The key is returned once.',
          security: [{ teamKey: [] }],
          parameters: [{ name: "team", in: "path", required: true, schema: { type: "string" } }],
          responses: { "201": { description: "Created" } },
        },
      },
      "/api/teams/{team}/agent-invites": {
        post: {
          summary: "Create a one-time agent invite link (24 h, team key only)",
          operationId: "createAgentInvite",
          security: [{ teamKey: [] }],
          parameters: [{ name: "team", in: "path", required: true, schema: { type: "string" } }],
          responses: { "201": { description: "Invite URL" } },
        },
      },
      "/agent-invite/{token}/claim": {
        post: {
          summary: "Claim an agent invite: returns the agent key once",
          operationId: "claimAgentInvite",
          parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "201": { description: "The key" },
            "404": { description: "Invalid, used or expired" },
          },
        },
      },
      "/api/teams/{team}/notifications": {
        get: {
          summary: "The team's notifications (team key only)",
          operationId: "listNotifications",
          security: [{ teamKey: [] }],
          parameters: [{ name: "team", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Notifications and the unread count" } },
        },
      },
      "/api/teams/{team}/webhook": {
        put: {
          summary: "Set the team webhook (team key only)",
          operationId: "setWebhook",
          description: 'JSON {"url"} (https, public host). Returns the signing secret once.',
          security: [{ teamKey: [] }],
          parameters: [{ name: "team", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Saved" } },
        },
      },
      "/api/sites": {
        post: {
          summary: "Create a site",
          operationId: "createSite",
          description:
            "No auth needed (guest upload). Send X-Team-Key to attach the site to a team.",
          security: [{}, { teamKey: [] }],
          parameters: [
            {
              name: "ttlHours",
              in: "query",
              schema: { type: "string" },
              description: 'Hours, or "permanent"',
            },
            { name: "permanent", in: "query", schema: { type: "string", enum: ["1", "true"] } },
          ],
          requestBody: uploadBody,
          responses: {
            "201": {
              description: "Created",
              content: json({ $ref: "#/components/schemas/CreatedSite" }),
            },
            "400": err("Invalid upload"),
            "401": err("INVALID_TEAM_KEY"),
            "413": err("Too large / too many files"),
            "415": err("Blocked file type"),
            "429": err("Rate limited"),
          },
        },
      },
      "/api/sites/{id}": {
        parameters: [idParam],
        get: {
          summary: "Get site metadata",
          operationId: "getSite",
          security: [{ editToken: [] }],
          responses: {
            "200": site("OK"),
            "404": err("Not found or bad token"),
            "410": err("Expired"),
          },
        },
        put: {
          summary: "Replace all files",
          operationId: "replaceSite",
          security: [{ editToken: [] }],
          requestBody: uploadBody,
          responses: {
            "200": site("Updated"),
            "404": err("Not found or bad token"),
            "410": err("Expired"),
          },
        },
        patch: {
          summary: "Change the expiry, or make the site permanent",
          operationId: "extendSite",
          security: [{ editToken: [] }],
          description:
            'Body { "ttlHours": N } sets a timed expiry (a permanent site becomes timed again; its ceiling counts from now). { "permanent": true } removes the expiry if the team may.',
          requestBody: {
            content: json({
              type: "object",
              properties: { ttlHours: { type: "number" }, permanent: { type: "boolean" } },
            }),
          },
          responses: {
            "200": site("Updated"),
            "403": err("PERMANENT_NOT_ALLOWED"),
            "404": err("Not found or bad token"),
            "410": err("Expired"),
          },
        },
        delete: {
          summary: "Delete now",
          operationId: "deleteSite",
          security: [{ editToken: [] }],
          responses: { "204": { description: "Deleted" }, "404": err("Not found or bad token") },
        },
      },
      "/api/sites/{id}/kv": {
        parameters: [idParam],
        get: {
          summary: "List KV keys (optional backend)",
          operationId: "kvList",
          description: readNote,
          responses: {
            "200": {
              description: "Keys",
              content: json({
                type: "object",
                properties: { keys: { type: "array", items: { type: "string" } } },
              }),
            },
            "503": err("Backend not configured"),
          },
        },
      },
      "/api/sites/{id}/kv/{key}": {
        parameters: [idParam, keyParam],
        get: {
          summary: "Get a KV value (optional backend)",
          operationId: "kvGet",
          description: readNote,
          responses: {
            "200": {
              description: "Value",
              content: json({ type: "object", properties: { key: { type: "string" }, value: {} } }),
            },
            "404": err("Key or site not found"),
            "503": err("Backend not configured"),
          },
        },
        put: {
          summary: "Set a KV value (optional backend)",
          operationId: "kvSet",
          security: [{ editToken: [] }],
          requestBody: {
            required: true,
            content: json({ type: "object", required: ["value"], properties: { value: {} } }),
          },
          responses: {
            "200": { description: "Stored" },
            "413": err("Value too large / too many keys"),
            "503": err("Backend not configured"),
          },
        },
        delete: {
          summary: "Delete a KV value (optional backend)",
          operationId: "kvDelete",
          security: [{ editToken: [] }],
          responses: {
            "204": { description: "Deleted" },
            "404": err("Not found"),
            "503": err("Backend not configured"),
          },
        },
      },
      "/api/sites/{id}/files": {
        parameters: [idParam],
        get: {
          summary: "List backend files (optional backend)",
          operationId: "filesList",
          description: readNote,
          responses: { "200": { description: "Files" }, "503": err("Backend not configured") },
        },
        post: {
          summary: "Upload a backend file (optional backend)",
          operationId: "filesUpload",
          security: [{ editToken: [] }],
          parameters: [
            {
              name: "name",
              in: "query",
              schema: { type: "string" },
              description: "File name for a raw body upload.",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                    name: { type: "string" },
                  },
                },
              },
              "application/octet-stream": { schema: { type: "string", format: "binary" } },
            },
          },
          responses: {
            "201": { description: "Uploaded" },
            "413": err("Too large / too many files"),
            "415": err("Blocked file type"),
            "503": err("Backend not configured"),
          },
        },
      },
      "/api/sites/{id}/files/{fileId}": {
        parameters: [
          idParam,
          { name: "fileId", in: "path", required: true, schema: { type: "string" } },
        ],
        get: {
          summary: "Download a backend file (optional backend)",
          operationId: "filesGet",
          description: readNote,
          responses: {
            "200": { description: "File bytes" },
            "404": err("Not found"),
            "503": err("Backend not configured"),
          },
        },
        delete: {
          summary: "Delete a backend file (optional backend)",
          operationId: "filesDelete",
          security: [{ editToken: [] }],
          responses: {
            "204": { description: "Deleted" },
            "404": err("Not found"),
            "503": err("Backend not configured"),
          },
        },
      },
      "/api/config": {
        get: {
          summary: "Instance limits",
          operationId: "getConfig",
          responses: { "200": { description: "Limits", content: json({ type: "object" }) } },
        },
      },
      "/api/admin/sites": {
        get: {
          summary: "List all sites (admin)",
          operationId: "adminListSites",
          security: [{ adminToken: [] }],
          responses: {
            "200": { description: "OK" },
            "401": err("Bad token"),
            "404": err("Admin disabled"),
          },
        },
      },
      "/api/admin/sites/{id}": {
        parameters: [idParam],
        patch: {
          summary: "Make a team site permanent, or revoke it (admin)",
          operationId: "adminSetPermanent",
          security: [{ adminToken: [] }],
          description:
            "Revoking gives the site MAX_TTL_HOURS from now. Guest sites can never be permanent.",
          requestBody: {
            content: json({
              type: "object",
              required: ["permanent"],
              properties: { permanent: { type: "boolean" } },
            }),
          },
          responses: {
            "200": site("Updated"),
            "403": err("Guest site"),
            "404": err("Not found"),
          },
        },
        delete: {
          summary: "Delete any site (admin)",
          operationId: "adminDeleteSite",
          security: [{ adminToken: [] }],
          responses: {
            "204": { description: "Deleted" },
            "401": err("Bad token"),
            "404": err("Not found"),
          },
        },
      },
      "/api/directory": {
        get: {
          summary: "Public directory of live team sites, grouped by team",
          operationId: "getDirectory",
          description:
            "Only teams with directory=true and their unexpired sites. Never guest uploads, tokens or keys. Cached 30 s.",
          responses: {
            "200": { description: "OK", content: json({ $ref: "#/components/schemas/Directory" }) },
          },
        },
      },
      "/covers/{id}": {
        get: {
          summary: "Cover image of a site in the public directory",
          operationId: "getCover",
          description:
            "A raster image (PNG, JPEG, WebP, AVIF, GIF, max 2 MB) that is already part of the site: cover.* at its root, else a local og:image, else the first local <img>. A listed site without one gets the drawn placeholder as a self-contained SVG. 404 when the site is not listed.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The image, or the SVG placeholder" },
            "304": { description: "Not modified (ETag)" },
            "404": { description: "No cover" },
          },
        },
      },
      "/api/admin/teams": {
        get: {
          summary: "List teams (admin)",
          operationId: "adminListTeams",
          security: [{ adminToken: [] }],
          responses: {
            "200": {
              description: "OK",
              content: json({
                type: "object",
                properties: {
                  teams: { type: "array", items: { $ref: "#/components/schemas/Team" } },
                },
              }),
            },
            "401": err("Bad token"),
            "404": err("Admin disabled"),
          },
        },
        post: {
          summary: "Create a team (admin)",
          operationId: "adminCreateTeam",
          security: [{ adminToken: [] }],
          requestBody: {
            required: true,
            content: json({ $ref: "#/components/schemas/TeamInput" }),
          },
          responses: {
            "201": {
              description: "Created",
              content: json({ $ref: "#/components/schemas/TeamWithKey" }),
            },
            "400": err("Invalid name or flags"),
            "401": err("Bad token"),
          },
        },
      },
      "/api/admin/teams/{teamId}": {
        parameters: [{ name: "teamId", in: "path", required: true, schema: { type: "string" } }],
        patch: {
          summary: "Rename a team or toggle backend / directory (admin)",
          operationId: "adminUpdateTeam",
          security: [{ adminToken: [] }],
          requestBody: {
            required: true,
            content: json({ $ref: "#/components/schemas/TeamInput" }),
          },
          responses: {
            "200": { description: "Updated" },
            "400": err("Invalid name or flags"),
            "404": err("No such team"),
          },
        },
        delete: {
          summary: "Delete a team: 7-day trash first (admin)",
          operationId: "adminDeleteTeam",
          description:
            "0.16.0: saves an export, turns the team's Workers off and moves the team to the trash for 7 days (keys and sessions stop working). Restore with POST /api/admin/trash/{teamId}/restore. purge=now deletes it for good at once.",
          security: [{ adminToken: [] }],
          parameters: [
            {
              name: "confirm",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "The team's name (or id), typed again",
            },
            {
              name: "sites",
              in: "query",
              schema: { type: "string", enum: ["delete"] },
              description: "Also delete the team's sites when it is purged",
            },
            {
              name: "purge",
              in: "query",
              schema: { type: "string", enum: ["now"] },
              description: "Skip the grace period",
            },
          ],
          responses: {
            "200": { description: "In the trash (or purged)" },
            "400": err("CONFIRM_MISMATCH"),
            "404": err("No such team"),
          },
        },
      },
      "/api/admin/teams/{teamId}/export": {
        parameters: [{ name: "teamId", in: "path", required: true, schema: { type: "string" } }],
        get: {
          summary: "Export a team as a zip (admin)",
          operationId: "adminExportTeam",
          security: [{ adminToken: [] }],
          responses: {
            "200": { description: "application/zip (no passwords, key hashes or secrets)" },
            "404": err("No such team"),
          },
        },
      },
      "/api/admin/trash": {
        get: {
          summary: "Deleted teams in their grace period (admin)",
          operationId: "adminListTrash",
          security: [{ adminToken: [] }],
          responses: { "200": { description: "{teams:[{team,deletedAt,purgeAfter,…}]}" } },
        },
      },
      "/api/admin/trash/{teamId}": {
        parameters: [{ name: "teamId", in: "path", required: true, schema: { type: "string" } }],
        delete: {
          summary: "Delete a trashed team for good now (admin)",
          operationId: "adminPurgeTeam",
          security: [{ adminToken: [] }],
          parameters: [
            { name: "confirm", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Purged" },
            "400": err("CONFIRM_MISMATCH"),
            "404": err("Not in the trash"),
          },
        },
      },
      "/api/admin/trash/{teamId}/export": {
        parameters: [{ name: "teamId", in: "path", required: true, schema: { type: "string" } }],
        get: {
          summary: "The export saved when the team was deleted (admin)",
          operationId: "adminTrashExport",
          security: [{ adminToken: [] }],
          responses: { "200": { description: "application/zip" }, "404": err("No export") },
        },
      },
      "/api/admin/trash/{teamId}/restore": {
        parameters: [{ name: "teamId", in: "path", required: true, schema: { type: "string" } }],
        post: {
          summary: "Restore a deleted team (admin)",
          operationId: "adminRestoreTeam",
          security: [{ adminToken: [] }],
          responses: { "200": { description: "Restored" }, "404": err("Not in the trash") },
        },
      },
      "/api/admin/backups": {
        get: {
          summary: "Backup status (admin)",
          operationId: "adminBackups",
          security: [{ adminToken: [] }],
          responses: {
            "200": {
              description: "{enabled,where,offsite,last,lastOk,kept,nextDue,restoreTest,…}",
            },
          },
        },
      },
      "/api/admin/backups/run": {
        post: {
          summary: "Take an encrypted backup now (admin)",
          operationId: "adminRunBackup",
          security: [{ adminToken: [] }],
          responses: {
            "200": { description: "The run" },
            "502": err("The backup failed (or backups are off)"),
          },
        },
      },
      "/api/admin/backups/test-restore": {
        post: {
          summary: "Restore the newest backup into a scratch folder and check it (admin)",
          operationId: "adminTestRestore",
          security: [{ adminToken: [] }],
          responses: { "200": { description: "{ok,files?,error?}" } },
        },
      },
      "/api/admin/sessions/end-all": {
        post: {
          summary: "End every admin session (admin)",
          operationId: "adminEndSessions",
          security: [{ adminToken: [] }],
          responses: { "200": { description: "Ended" } },
        },
      },
      "/api/admin/teams/{teamId}/rotate": {
        parameters: [{ name: "teamId", in: "path", required: true, schema: { type: "string" } }],
        post: {
          summary: "Replace a team's key (admin)",
          operationId: "adminRotateTeamKey",
          security: [{ adminToken: [] }],
          responses: {
            "200": {
              description: "New key",
              content: json({ $ref: "#/components/schemas/TeamWithKey" }),
            },
            "404": err("No such team"),
          },
        },
      },
      "/api/admin/sweep": {
        post: {
          summary: "Delete expired sites now (admin)",
          operationId: "adminSweep",
          security: [{ adminToken: [] }],
          responses: { "200": { description: "Removed ids" } },
        },
      },
    },
  };
  addMorePaths(spec.paths as unknown as Record<string, Record<string, unknown>>);
  // Every backend route can also answer 403 when the site's team has no backend access.
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!/\/(kv|files)/.test(path)) continue;
    for (const op of Object.values(item as Record<string, { responses?: object }>)) {
      if (op && typeof op === "object" && "responses" in op && op.responses) {
        Object.assign(op.responses, {
          "403": err("BACKEND_NOT_ALLOWED: the site isn't in a team with backend access"),
        });
      }
    }
  }
  return spec;
}
