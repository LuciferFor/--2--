#!/usr/bin/env node
import { createRequire } from "node:module";

import { executeD2CommandEnvelope } from "../lib/command-gateway.mjs";

const require = createRequire(import.meta.url);
const { commandHelpJson, commandHelpText } = require("../lib/commands.cjs");

const rawArgs = process.argv.slice(2);
const json = takeFlag(rawArgs, "--json");
const senderQq = takeOption(rawArgs, "--sender-qq") || process.env.D2_SENDER_QQ || process.env.SENDER_QQ || "";
const baseUrl = takeOption(rawArgs, "--base-url") || process.env.D2_BACKEND_URL || process.env.D2_BASE_URL || "http://192.168.31.11:3011";
const timeoutMs = Number(takeOption(rawArgs, "--timeout-ms") || process.env.D2_TIMEOUT_MS || 120000);
const commandLine = rawArgs.join(" ").trim();

if (!commandLine || /^--?h(?:elp)?$/iu.test(commandLine) || commandLine === "--help") {
  if (json) {
    process.stdout.write(`${JSON.stringify({ success: true, type: "text", command: "help", commands: commandHelpJson() }, null, 2)}\n`);
  } else {
    process.stdout.write(`${commandHelpText()}\n`);
  }
  process.exit(0);
}

try {
  const envelope = await executeD2CommandEnvelope(
    {
      commandLine,
      senderQq,
      chatType: process.env.D2_CHAT_TYPE || "cli",
      chatId: process.env.D2_CHAT_ID || "",
    },
    {
      baseUrl,
      timeoutMs,
      shareUploadToken: process.env.D2_SHARE_UPLOAD_TOKEN || "",
    },
  );
  if (json) {
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    process.stdout.write(`${humanOutput(envelope)}\n`);
  }
  process.exit(envelope.success ? 0 : 1);
} catch (error) {
  const envelope = {
    success: false,
    type: "error",
    command: "",
    message: error?.message || "命运2命令执行失败。",
    imageBase64: "",
    imagePath: "",
    shareUrl: "",
    meta: { stack: String(error?.stack || error) },
  };
  process.stdout.write(json ? `${JSON.stringify(envelope, null, 2)}\n` : `${envelope.message}\n`);
  process.exit(1);
}

function humanOutput(envelope) {
  if (envelope.type === "image") {
    return [
      "已生成图片。",
      envelope.imagePath ? `imagePath: ${envelope.imagePath}` : "",
      `bytes: ${envelope.images?.[0]?.bytes || 0}`,
    ].filter(Boolean).join("\n");
  }
  if (envelope.type === "share") {
    return envelope.message || envelope.shareUrl || "已生成网页。";
  }
  return envelope.message || JSON.stringify(envelope);
}

function takeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return "";
  const value = args[index + 1] || "";
  args.splice(index, value ? 2 : 1);
  return value;
}
