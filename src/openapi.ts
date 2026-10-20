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
      version: "0.2.0",
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
