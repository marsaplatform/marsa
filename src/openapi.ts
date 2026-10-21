import { APP_NAME, APP_TAGLINE } from "./brand.js";
import type { Config } from "./config.js";

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
      version: "0.15.0",
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
            "Team Workers (see /docs/workers). Needs the team key; {team} is the team slug or id.",
          security: [{ teamKey: [] }],
          parameters: [{ name: "team", in: "path", required: true, schema: { type: "string" } }],
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
            'JSON {"code","vars"?,"secrets"?} or the raw script as application/javascript. Omitted vars are kept; secrets are write-only (null removes one).',
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
          summary: "Delete a team (admin)",
          operationId: "adminDeleteTeam",
          security: [{ adminToken: [] }],
          parameters: [
            {
              name: "sites",
              in: "query",
              schema: { type: "string", enum: ["delete"] },
              description: "Also delete the team's sites",
            },
          ],
          responses: { "200": { description: "Deleted" }, "404": err("No such team") },
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
