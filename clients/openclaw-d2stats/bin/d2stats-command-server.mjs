#!/usr/bin/env node
import http from "node:http";

import { executeD2CommandEnvelope } from "../lib/command-gateway.mjs";

const host = process.env.D2_COMMAND_HOST || "127.0.0.1";
const port = Number(process.env.D2_COMMAND_PORT || 3013);
const baseUrl = process.env.D2_BACKEND_URL || process.env.D2_BASE_URL || "http://192.168.31.11:3011";
const timeoutMs = Number(process.env.D2_TIMEOUT_MS || 120000);
const shareUploadToken = process.env.D2_SHARE_UPLOAD_TOKEN || "";

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { success: true, service: "d2stats-command", uptimeSeconds: Math.floor(process.uptime()) });
    }
    if (request.method === "GET" && url.pathname === "/help") {
      const { commandHelpJson, commandHelpText } = await importCommands();
      if (url.searchParams.get("format") === "json") {
        return sendJson(response, 200, { success: true, commands: commandHelpJson() });
      }
      return sendText(response, 200, commandHelpText());
    }
    if (request.method === "POST" && url.pathname === "/execute") {
      const body = await readJson(request);
      const envelope = await executeD2CommandEnvelope(body, { baseUrl, timeoutMs, shareUploadToken });
      return sendJson(response, envelope.success ? 200 : 400, envelope);
    }
    return sendJson(response, 404, { success: false, type: "error", message: "Not found" });
  } catch (error) {
    return sendJson(response, 500, {
      success: false,
      type: "error",
      command: "",
      message: error?.message || "命运2命令服务错误。",
      imageBase64: "",
      imagePath: "",
      shareUrl: "",
      meta: {},
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`d2stats-command listening on http://${host}:${port}\n`);
});

async function importCommands() {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("../lib/commands.cjs");
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error.message}`));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}
