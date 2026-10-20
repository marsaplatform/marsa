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
      version: "0.5.0",
      description: `${APP_TAGLINE} Upload static files and get an expiring, shareable link. No account: the edit token returned at creation manages the site.`,
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
            "Optional team key (from the admin). Attaches a new site to its team. Authorization: Bearer <team key> also works.",
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
            ttlHours: { type: "number", minimum: config.minTtlHours, maximum: config.maxTtlHours },
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
            expiresAt: { type: "string", format: "date-time" },
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
      "/api/sites": {
        post: {
          summary: "Create a site",
          operationId: "createSite",
          description:
            "No auth needed (guest upload). Send X-Team-Key to attach the site to a team.",
          security: [{}, { teamKey: [] }],
          parameters: [{ name: "ttlHours", in: "query", schema: { type: "number" } }],
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
          summary: "Change the expiry",
          operationId: "extendSite",
          security: [{ editToken: [] }],
          requestBody: {
            content: json({ type: "object", properties: { ttlHours: { type: "number" } } }),
          },
          responses: {
            "200": site("Updated"),
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
