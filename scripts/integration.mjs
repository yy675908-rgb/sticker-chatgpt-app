import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

const port = 18123;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(path.join(os.tmpdir(), "sticker-mcp-test-"));
const accessKey = "test_sticker_key_2026";
const child = spawn(process.execPath, ["server.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, STICKER_ACCESS_KEY: accessKey },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start. Logs:\n${logs}`);
}

function request(client, method, params, schema) {
  return client.request({ method, params }, schema);
}

let transport;
try {
  await waitForServer();
  const client = new Client({ name: "sticker-integration-test", version: "1.0.0" });
  transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/${accessKey}`));
  await client.connect(transport);

  const tools = await request(client, "tools/list", {}, ListToolsResultSchema);
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, [
    "delete_sticker",
    "open_sticker_library",
    "save_sticker",
    "toggle_sticker_favorite",
    "update_sticker",
  ]);

  const resources = await request(client, "resources/list", {}, ListResourcesResultSchema);
  assert(resources.resources.some((resource) => resource.uri === "ui://sticker/library.html"));
  const widget = await request(
    client,
    "resources/read",
    { uri: "ui://sticker/library.html" },
    ReadResourceResultSchema,
  );
  assert(widget.contents[0]?.text?.includes("表情库还是空的"));

  const call = (name, args = {}) => request(
    client,
    "tools/call",
    { name, arguments: args },
    CallToolResultSchema,
  );

  let result = await call("open_sticker_library");
  assert.deepEqual(result.structuredContent?.stickers, []);

  result = await call("save_sticker", {
    fileId: "file_test_001",
    fileName: "cat.png",
    mimeType: "image/png",
    title: "猫猫",
    tags: ["开心", "猫猫", "开心"],
  });
  assert.equal(result.structuredContent?.stickers?.length, 1);
  let sticker = result.structuredContent.stickers[0];
  assert.deepEqual(sticker.tags, ["开心", "猫猫"]);

  result = await call("update_sticker", {
    id: sticker.id,
    title: "猫猫开心",
    tags: ["开心"],
  });
  sticker = result.structuredContent.stickers[0];
  assert.equal(sticker.title, "猫猫开心");

  result = await call("toggle_sticker_favorite", { id: sticker.id });
  sticker = result.structuredContent.stickers[0];
  assert.equal(sticker.favorite, true);

  result = await call("delete_sticker", { id: sticker.id });
  assert.deepEqual(result.structuredContent?.stickers, []);

  console.log("MCP integration checks passed.");
} finally {
  if (transport) await transport.close().catch(() => {});
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(dataDir, { recursive: true, force: true });
}
