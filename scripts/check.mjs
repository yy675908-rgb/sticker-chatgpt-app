import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const widget = fs.readFileSync(path.join(root, "public", "sticker-widget.html"), "utf8");
const requiredServer = [
  "open_sticker_library",
  "save_sticker",
  "update_sticker",
  "toggle_sticker_favorite",
  "delete_sticker",
  "StreamableHTTPServerTransport",
  "STICKER_ACCESS_KEY",
];
const requiredWidget = [
  "uploadFile",
  "selectFiles",
  "getFileDownloadUrl",
  "callTool",
  "sendFollowUpMessage",
  "imageIds",
];
for (const token of requiredServer) {
  if (!server.includes(token)) throw new Error(`server.js missing ${token}`);
}
for (const token of requiredWidget) {
  if (!widget.includes(token)) throw new Error(`sticker-widget.html missing ${token}`);
}
if (!widget.startsWith("<!doctype html>")) throw new Error("Widget is not standalone HTML");
const inlineScript = widget.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!inlineScript) throw new Error("Widget inline script not found");
new vm.Script(inlineScript, { filename: "sticker-widget.inline.js" });
console.log("Static checks passed.");
