import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { neon } from "@neondatabase/serverless";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const VERSION = "0.2.0";
const WIDGET_URI = "ui://sticker/library.html";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const widgetHtml = fs.readFileSync(
  path.join(__dirname, "public", "sticker-widget.html"),
  "utf8",
);

const accessKey = process.env.STICKER_ACCESS_KEY?.trim() || "";
if (accessKey && !/^[A-Za-z0-9_-]{12,128}$/.test(accessKey)) {
  throw new Error(
    "STICKER_ACCESS_KEY must be 12-128 characters using only letters, numbers, _ or -.",
  );
}
const mcpPath = accessKey ? `/mcp/${accessKey}` : "/mcp";

const databaseUrl = process.env.DATABASE_URL?.trim() || "";
const sql = databaseUrl ? neon(databaseUrl) : null;
let schemaReady;

const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const dataFile = path.join(dataDir, "stickers.json");
if (!sql) fs.mkdirSync(dataDir, { recursive: true });

async function ensureSchema() {
  if (!sql) return;
  schemaReady ||= sql`
    CREATE TABLE IF NOT EXISTS sticker_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await schemaReady;
}

async function readDatabase() {
  if (sql) {
    await ensureSchema();
    const rows = await sql`
      SELECT data
      FROM sticker_state
      WHERE id = 'global'
      LIMIT 1
    `;
    const data = rows[0]?.data;
    return data && typeof data === "object" ? data : { users: {} };
  }

  try {
    const raw = fs.readFileSync(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { users: {} };
  } catch (error) {
    if (error?.code === "ENOENT") return { users: {} };
    console.error("Failed to read sticker database:", error);
    return { users: {} };
  }
}

async function writeDatabase(database) {
  if (sql) {
    await ensureSchema();
    const payload = JSON.stringify(database);
    await sql`
      INSERT INTO sticker_state (id, data, updated_at)
      VALUES ('global', ${payload}::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `;
    return;
  }

  const tempFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(database, null, 2), "utf8");
  fs.renameSync(tempFile, dataFile);
}

function getSubject(meta) {
  return meta?.["openai/subject"] || meta?.["openai/session"] || "private-owner";
}

function normalizeTags(tags = []) {
  return [
    ...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean)),
  ].slice(0, 20);
}

function getUserStickers(database, subject) {
  database.users ||= {};
  database.users[subject] ||= [];
  return database.users[subject];
}

function publicSticker(sticker) {
  return {
    id: sticker.id,
    fileId: sticker.fileId,
    fileName: sticker.fileName,
    mimeType: sticker.mimeType,
    title: sticker.title,
    tags: sticker.tags,
    favorite: sticker.favorite,
    createdAt: sticker.createdAt,
    updatedAt: sticker.updatedAt,
  };
}

function reply(stickers, message = "") {
  return {
    content: message ? [{ type: "text", text: message }] : [],
    structuredContent: { stickers: stickers.map(publicSticker) },
  };
}

const stickerOutputSchema = {
  stickers: z.array(
    z.object({
      id: z.string(),
      fileId: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
      title: z.string(),
      tags: z.array(z.string()),
      favorite: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
};

function createStickerServer() {
  const server = new McpServer({
    name: "sticker-library",
    version: VERSION,
  });

  registerAppResource(
    server,
    "Sticker Library",
    WIDGET_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description:
        "Private sticker library UI for uploading, tagging, searching, favoriting, and sending images.",
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
            },
            "openai/widgetDescription":
              "A private, initially empty sticker library. The user can upload images, add tags, favorite, search, and send a selected sticker into the conversation.",
            "openai/widgetPrefersBorder": false,
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "open_sticker_library",
    {
      title: "Open Sticker Library",
      description:
        "Open the user's private sticker library. Use when the user asks to open, browse, search, manage, or send a saved sticker or reaction image.",
      inputSchema: {},
      outputSchema: stickerOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/toolInvocation/invoking": "Opening stickers…",
        "openai/toolInvocation/invoked": "Sticker library opened",
      },
    },
    async (_args, context) => {
      const database = await readDatabase();
      return reply(getUserStickers(database, getSubject(context?._meta)));
    },
  );

  registerAppTool(
    server,
    "save_sticker",
    {
      title: "Save Sticker",
      description:
        "Save one ChatGPT file-library image as a sticker with an optional title and tags.",
      inputSchema: {
        fileId: z.string().min(1),
        fileName: z.string().optional(),
        mimeType: z.string().optional(),
        title: z.string().max(80).optional(),
        tags: z.array(z.string().max(30)).max(20).optional(),
      },
      outputSchema: stickerOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI, visibility: ["app"] },
        "openai/toolInvocation/invoking": "Saving sticker…",
        "openai/toolInvocation/invoked": "Sticker saved",
      },
    },
    async (args, context) => {
      const database = await readDatabase();
      const stickers = getUserStickers(
        database,
        getSubject(context?._meta),
      );
      const existing = stickers.find((item) => item.fileId === args.fileId);
      const now = new Date().toISOString();

      if (existing) {
        existing.fileName = args.fileName || existing.fileName;
        existing.mimeType = args.mimeType || existing.mimeType;
        existing.title = args.title?.trim() || existing.title;
        existing.tags = normalizeTags(args.tags ?? existing.tags);
        existing.updatedAt = now;
      } else {
        stickers.unshift({
          id: randomUUID(),
          fileId: args.fileId,
          fileName: args.fileName || "sticker",
          mimeType: args.mimeType || "image/*",
          title: args.title?.trim() || "",
          tags: normalizeTags(args.tags),
          favorite: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      await writeDatabase(database);
      return reply(stickers, existing ? "Sticker updated." : "Sticker saved.");
    },
  );

  registerAppTool(
    server,
    "update_sticker",
    {
      title: "Update Sticker",
      description: "Update a saved sticker's title and tags.",
      inputSchema: {
        id: z.string().min(1),
        title: z.string().max(80).optional(),
        tags: z.array(z.string().max(30)).max(20).optional(),
      },
      outputSchema: stickerOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI, visibility: ["app"] },
      },
    },
    async (args, context) => {
      const database = await readDatabase();
      const stickers = getUserStickers(
        database,
        getSubject(context?._meta),
      );
      const sticker = stickers.find((item) => item.id === args.id);
      if (!sticker) return reply(stickers, "Sticker not found.");

      if (typeof args.title === "string") sticker.title = args.title.trim();
      if (Array.isArray(args.tags)) sticker.tags = normalizeTags(args.tags);
      sticker.updatedAt = new Date().toISOString();

      await writeDatabase(database);
      return reply(stickers, "Sticker updated.");
    },
  );

  registerAppTool(
    server,
    "toggle_sticker_favorite",
    {
      title: "Toggle Sticker Favorite",
      description: "Favorite or unfavorite a saved sticker.",
      inputSchema: { id: z.string().min(1) },
      outputSchema: stickerOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI, visibility: ["app"] },
      },
    },
    async ({ id }, context) => {
      const database = await readDatabase();
      const stickers = getUserStickers(
        database,
        getSubject(context?._meta),
      );
      const sticker = stickers.find((item) => item.id === id);
      if (!sticker) return reply(stickers, "Sticker not found.");

      sticker.favorite = !sticker.favorite;
      sticker.updatedAt = new Date().toISOString();

      await writeDatabase(database);
      return reply(
        stickers,
        sticker.favorite ? "Favorited." : "Removed from favorites.",
      );
    },
  );

  registerAppTool(
    server,
    "delete_sticker",
    {
      title: "Delete Sticker",
      description:
        "Remove one sticker from this library. This does not delete the original file from the user's ChatGPT file library.",
      inputSchema: { id: z.string().min(1) },
      outputSchema: stickerOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI, visibility: ["app"] },
      },
    },
    async ({ id }, context) => {
      const database = await readDatabase();
      const subject = getSubject(context?._meta);
      const stickers = getUserStickers(database, subject);
      const next = stickers.filter((item) => item.id !== id);
      database.users[subject] = next;

      await writeDatabase(database);
      return reply(
        next,
        next.length === stickers.length
          ? "Sticker not found."
          : "Sticker removed.",
      );
    },
  );

  return server;
}

const port = Number(process.env.PORT || 8000);
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.type("text/plain").send(
    `Sticker MCP server is running (${sql ? "Neon" : "local file"} storage).`,
  );
});

app.all(mcpPath, async (req, res) => {
  const server = createStickerServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(
    `Sticker MCP server listening on port ${port} with ${
      sql ? "Neon" : "local file"
    } storage.`,
  );
});
