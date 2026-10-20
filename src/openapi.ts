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
  return {
    openapi: "3.1.0",
    info: {
      title: `${APP_NAME} API`,
      version: "0.3.0",
      description: `${APP_TAGLINE} Upload static files and get an expiring, shareable link. No account: the edit token returned at creation manages the site.`,
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: config.publicUrl }],
    components: {
      securitySchemes: {
        editToken: { type: "http", scheme: "bearer", description: "The site's edit token." },
        adminToken: { type: "http", scheme: "bearer", description: "The instance ADMIN_TOKEN." },
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
          parameters: [{ name: "ttlHours", in: "query", schema: { type: "number" } }],
          requestBody: uploadBody,
          responses: {
            "201": {
              description: "Created",
              content: json({ $ref: "#/components/schemas/CreatedSite" }),
            },
            "400": err("Invalid upload"),
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
}
