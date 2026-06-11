import { createRequire } from "node:module";

import {
  applyLoadoutOptimizer,
  bindQq,
  itemAction,
  manageLoadouts,
  queryCard,
  queryInventory,
  queryLoadoutOptimizer,
  resolveConfig,
} from "./core.mjs";

const require = createRequire(import.meta.url);
const {
  commandHelpJson,
  commandHelpText,
  parseCommandLine,
} = require("./commands.cjs");

export function parseD2Command(commandLine, context = {}) {
  return parseCommandLine(commandLine, context);
}

export async function executeD2Command(params = {}, rawConfig = {}, options = {}) {
  const config = resolveConfig(rawConfig);
  const commandLine = String(params.commandLine || params.command || "").trim();
  const context = {
    senderQq: params.senderQq || params.qq || params.userId || params.user_id,
    userId: params.userId || params.user_id,
    chatType: params.chatType,
    chatId: params.chatId,
  };
  const invocation = parseCommandLine(commandLine, context);
  if (!invocation) {
    return openClawResultFromEnvelope(errorEnvelope("unknown", "无法识别命运2命令，请使用 d2stats --help 查看命令。"));
  }
  const { envelope, result } = await executeD2CommandInvocation(invocation, config, options);
  return result || openClawResultFromEnvelope(envelope);
}

export async function executeD2CommandEnvelope(params = {}, rawConfig = {}, options = {}) {
  const config = resolveConfig(rawConfig);
  const commandLine = String(params.commandLine || params.command || "").trim();
  const context = {
    senderQq: params.senderQq || params.qq || params.userId || params.user_id,
    userId: params.userId || params.user_id,
    chatType: params.chatType,
    chatId: params.chatId,
  };
  const invocation = parseCommandLine(commandLine, context);
  if (!invocation) {
    return errorEnvelope("unknown", "无法识别命运2命令，请使用 d2stats --help 查看命令。");
  }
  const { envelope } = await executeD2CommandInvocation(invocation, config, options);
  return envelope;
}

export async function executeD2CommandInvocation(invocation, rawConfig = {}, options = {}) {
  const config = resolveConfig(rawConfig);
  if (invocation?.command === "help" || invocation?.card === "help") {
    const result = textResult(commandHelpText(), { status: "ok", kind: "command_help", commands: commandHelpJson() });
    return { result, envelope: normalizeD2ToolResult(result, invocation) };
  }

  let result;
  if (invocation.card === "inventory") {
    result = await queryInventory(invocation.params, config, options);
  } else if (invocation.card === "loadout_manage") {
    result = await manageLoadouts(invocation.params, config, options);
  } else if (invocation.card === "loadout_optimizer") {
    result = await queryLoadoutOptimizer(invocation.params, config, options);
  } else if (invocation.card === "loadout_apply") {
    result = await applyLoadoutOptimizer(invocation.params, config, options);
  } else if (invocation.card === "item_action") {
    result = await itemAction(invocation.params, config, options);
  } else if (invocation.card === "bind") {
    result = await bindQq(invocation.params, config, options);
  } else {
    result = await queryCard(invocation.params, config, options);
  }
  return { result, envelope: normalizeD2ToolResult(result, invocation) };
}

export function normalizeD2ToolResult(result, invocation = {}) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const details = result?.details || {};
  const command = invocation.command || invocation.card || "";
  const imageParts = content.filter((part) => part?.type === "image" && part.data);
  if (imageParts.length > 0) {
    const images = imageParts.map((part, index) => ({
      imageBase64: String(part.data || ""),
      mimeType: String(part.mimeType || "image/png"),
      bytes: Buffer.byteLength(String(part.data || ""), "base64"),
      imagePath: imagePathForIndex(details, index),
    }));
    return {
      success: true,
      type: "image",
      command,
      message: "",
      imageBase64: images[0]?.imageBase64 || "",
      imagePath: images[0]?.imagePath || "",
      shareUrl: "",
      images,
      meta: stripHeavyDetails(details),
    };
  }

  const text = content.map((part) => part?.text || "").filter(Boolean).join("\n").trim();
  if (details.kind === "command_help") {
    return {
      success: true,
      type: "text",
      command,
      message: text,
      imageBase64: "",
      imagePath: "",
      shareUrl: "",
      meta: stripHeavyDetails(details),
    };
  }
  if (details.kind === "share_page" || details.url || /\/d2\/share\/|\/api\/d2\/share/u.test(text)) {
    return {
      success: true,
      type: "share",
      command,
      message: text,
      imageBase64: "",
      imagePath: "",
      shareUrl: details.url || firstUrl(text),
      meta: stripHeavyDetails(details),
    };
  }
  if (details.kind === "oauth_bind_link" || /\/api\/d2\/bind\/|请在3分钟|OAuth|绑定/u.test(text)) {
    return {
      success: true,
      type: "bind_link",
      command,
      message: text,
      imageBase64: "",
      imagePath: "",
      shareUrl: firstUrl(text),
      meta: stripHeavyDetails(details),
    };
  }
  if (details.status === "confirmation_required") {
    return {
      success: true,
      type: "confirmation",
      command,
      message: text,
      imageBase64: "",
      imagePath: "",
      shareUrl: "",
      meta: stripHeavyDetails(details),
    };
  }
  if (["failed", "invalid_input", "render_failed", "disabled"].includes(String(details.status || ""))) {
    return errorEnvelope(command, text || "命运2命令执行失败。", details);
  }
  return {
    success: true,
    type: "text",
    command,
    message: text,
    imageBase64: "",
    imagePath: "",
    shareUrl: firstUrl(text),
    meta: stripHeavyDetails(details),
  };
}

function imagePathForIndex(details, index) {
  if (index === 0 && details?.mediaPath) return details.mediaPath;
  if (Array.isArray(details?.media)) return details.media[index]?.mediaPath || "";
  if (index === 0 && details?.media && !Array.isArray(details.media)) return details.media.mediaPath || "";
  return "";
}

function firstUrl(text) {
  const match = /https?:\/\/\S+/u.exec(String(text || ""));
  return match ? match[0] : "";
}

function stripHeavyDetails(details) {
  const copy = { ...(details || {}) };
  delete copy.media;
  delete copy.mediaPath;
  return copy;
}

function errorEnvelope(command, message, details = {}) {
  return {
    success: false,
    type: "error",
    command,
    message: message || "命运2命令执行失败。",
    imageBase64: "",
    imagePath: "",
    shareUrl: "",
    meta: stripHeavyDetails(details),
  };
}

function openClawResultFromEnvelope(envelope) {
  if (envelope.type === "image" && envelope.imageBase64) {
    return {
      content: [{ type: "image", data: envelope.imageBase64, mimeType: envelope.images?.[0]?.mimeType || "image/png" }],
      details: envelope,
    };
  }
  return textResult(envelope.message || JSON.stringify(envelope), envelope);
}

function textResult(text, details = {}) {
  return {
    content: [{ type: "text", text }],
    details,
  };
}
