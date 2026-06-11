#!/usr/bin/env node
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const IS_MAIN = require.main === module;
let WebSocket;

const ONEBOT_URL = process.env.ONEBOT_URL || "http://127.0.0.1:3000";
const ONEBOT_WS = process.env.ONEBOT_WS || "ws://127.0.0.1:3000";
const ONEBOT_TOKEN = process.env.ONEBOT_TOKEN || "openclaw-onebot";
const AGENT_MODEL = process.env.ONEBOT_AGENT_MODEL || "";
const LOG_FILE = process.env.BRIDGE_LOG || "/home/node/.cache/openclaw-onebot/bridge.log";
const LOCK_TTL_MS = 180000;
const D2_DIRECT_REPLAY_TTL_MS = 10 * 60 * 1000;
const WORKSPACE = "/home/node/.openclaw/workspace";
const IMAGEGEN_SCRIPT = `${WORKSPACE}/skills/codex-local-imagegen/scripts/enqueue_generate_with_codex.sh`;
const IMAGE_SEND_SCRIPT = `${WORKSPACE}/skills/codex-local-imagegen/scripts/send_onebot_image.sh`;
const D2_PLUGIN_CORE = "/home/node/.openclaw/plugins/d2stats/lib/core.mjs";
const D2_PLUGIN_COMMAND_GATEWAY = process.env.D2_PLUGIN_COMMAND_GATEWAY || "/home/node/.openclaw/plugins/d2stats/lib/command-gateway.mjs";
const D2_DIRECT_OUT_DIR = "/tmp/openclaw-d2-direct-cards";
const DEEPSEEK_DELEGATE_SCRIPT = `${WORKSPACE}/skills/deepseek-delegate/scripts/delegate_reply.js`;
const IMAGE_PROMPT_DIR = `${WORKSPACE}/skills/codex-local-imagegen/queue/prompts`;
const IMAGE_LOG_DIR = "/home/node/.cache/openclaw-onebot/imagegen";
const DEEPSEEK_LOG_DIR = "/home/node/.cache/openclaw-onebot/deepseek-delegate";
const IMAGE_WATCH_DIR = `${WORKSPACE}/generated`;
const IDENTITY_IMAGE = `${WORKSPACE}/IDENTITY.png`;
const GROUP_CONTEXT_ONLY_USER_IDS = new Set([
  "2847147576", // 月见绫音: participate in the private-style group chat without owner privileges.
]);
const OWNER_USER_IDS = new Set(["1665240495", "3793341814"]);
const PRIVATE_STYLE_GROUP_IDS = new Set(["1059950729"]);
const AIMEMORY_DIRECT_CONTEXT_BRIDGE = "aimemory-onebot-direct-context-bridge";
const AIMEMORY_ENV_FILE = process.env.AIMEMORY_ENV_FILE || "/home/node/.openclaw/aimemory.env";

function shanghaiDateStamp(date = new Date()) {
  const shanghaiMs = date.getTime() + 8 * 60 * 60 * 1000;
  return new Date(shanghaiMs).toISOString().slice(0, 10).replace(/-/g, "");
}

function privateSessionKey(userId) {
  return `qq-private-v3-${shanghaiDateStamp()}-${userId}`;
}

function parseEnvFile(file) {
  const values = {};
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
  } catch (_) {
    // AIMemory is optional for the bridge; missing env file should not block chat.
  }
  return values;
}

function aimemoryConfig() {
  const fileEnv = parseEnvFile(AIMEMORY_ENV_FILE);
  const get = (key, fallback = "") => process.env[key] || fileEnv[key] || fallback;
  return {
    enabled: get("AIMEMORY_BRIDGE_CONTEXT", "1") !== "0",
    baseUrl: get("AIMEMORY_BASE_URL", "http://192.168.31.11:10011").replace(/\/+$/, ""),
    apiKey: get("AIMEMORY_API_KEY"),
    agentId: get("AIMEMORY_AGENT_ID", "feiye-31-11"),
    deviceId: get("AIMEMORY_DEVICE_ID", ""),
    topK: Number(get("AIMEMORY_TOP_K", "8")) || 8,
    maxChars: Number(get("AIMEMORY_MAX_CHARS", "3000")) || 3000,
    timeoutMs: Number(get("AIMEMORY_TIMEOUT_MS", "5000")) || 5000,
  };
}

async function fetchAimemoryContext(query) {
  const value = String(query || "").trim();
  if (!value) return "";
  const cfg = aimemoryConfig();
  if (!cfg.enabled || !cfg.apiKey) return "";
  if (typeof fetch !== "function") {
    log("aimemory-context-skip", "fetch_unavailable", AIMEMORY_DIRECT_CONTEXT_BRIDGE);
    return "";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(`${cfg.baseUrl}/v1/memories/context`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        agent_id: cfg.agentId,
        ...(cfg.deviceId ? { device_id: cfg.deviceId } : {}),
        query: value.slice(-1500),
        top_k: cfg.topK,
        max_chars: cfg.maxChars,
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      log("aimemory-context-error", response.status, String(body.detail || response.statusText || "").slice(0, 160));
      return "";
    }
    const contextText = String(body.context_text || "").trim();
    const itemCount = Array.isArray(body.items) ? body.items.length : 0;
    log("aimemory-context", "agent", cfg.agentId, "device", cfg.deviceId || "-", "items", itemCount, "chars", contextText.length);
    return contextText;
  } catch (err) {
    log("aimemory-context-error", err?.name || "Error", String(err?.message || err).slice(0, 160));
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function withAimemoryContext(prompt, query) {
  const contextText = await fetchAimemoryContext(query || prompt);
  if (!contextText) return prompt;
  return `${contextText}

??????:
${prompt}`;
}

const STARTED_AT_SEC = Math.floor(Date.now() / 1000);
const HISTORY_GRACE_SEC = Number(process.env.ONEBOT_HISTORY_GRACE_SEC || "10");
const GROUP_SILENT = process.env.ONEBOT_GROUP_SILENT !== "0";

if (IS_MAIN) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.mkdirSync(IMAGE_PROMPT_DIR, { recursive: true });
  fs.mkdirSync(IMAGE_LOG_DIR, { recursive: true });
  fs.mkdirSync(DEEPSEEK_LOG_DIR, { recursive: true });
  fs.mkdirSync(IMAGE_WATCH_DIR, { recursive: true });
}

const active = new Set();
const recent = new Map();
const lanes = new Map();
const groupMemberNameCache = new Map();
const recentD2DirectQueries = new Map();
let reconnectMs = 1000;

const D2_COMMANDS = loadD2Commands();

function loadD2Commands() {
  const candidates = [
    path.join(__dirname, "../lib/commands.cjs"),
    "/home/node/.openclaw/plugins/d2stats/lib/commands.cjs",
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {}
  }
  return null;
}

async function importD2CommandGateway() {
  const candidates = [
    D2_PLUGIN_COMMAND_GATEWAY,
    path.join(__dirname, "../lib/command-gateway.mjs"),
  ].filter(Boolean);
  let lastError;
  for (const candidate of candidates) {
    try {
      return await import(pathToFileURL(candidate).href);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("D2 command gateway is unavailable");
}

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map(String).join(" ")}\n`;
  process.stdout.write(line);
}

function remember(key) {
  recent.set(key, Date.now());
  for (const [k, ts] of recent) {
    if (Date.now() - ts > LOCK_TTL_MS) recent.delete(k);
  }
}

function onebot(action, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params || {});
    const req = http.request(`${ONEBOT_URL}/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        authorization: `Bearer ${ONEBOT_TOKEN}`,
      },
      timeout: 30000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("onebot request timeout")));
    req.end(body);
  });
}

function parseOnebotData(response, action) {
  let parsed;
  try {
    parsed = JSON.parse(response?.body || "{}");
  } catch (err) {
    throw new Error(`${action} returned invalid JSON: ${err.message}`);
  }
  if (response?.statusCode && response.statusCode >= 400) {
    throw new Error(`${action} HTTP ${response.statusCode}: ${response.body || ""}`);
  }
  if (parsed.retcode != null && parsed.retcode !== 0) {
    throw new Error(`${action} retcode ${parsed.retcode}: ${parsed.message || parsed.wording || ""}`);
  }
  return parsed.data ?? parsed;
}

function extractText(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    if (value.trim()) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => extractText(item, out));
    return out;
  }
  if (typeof value !== "object") return out;

  if (typeof value.text === "string") extractText(value.text, out);
  if (typeof value.finalAssistantVisibleText === "string") extractText(value.finalAssistantVisibleText, out);
  if (typeof value.finalAssistantRawText === "string") extractText(value.finalAssistantRawText, out);
  if (value.type === "text" && value.content) extractText(value.content, out);
  return out;
}

function extractMediaUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    for (const line of value.split(/\r?\n/)) {
      const match = /^MEDIA:(.+)$/u.exec(line.trim());
      if (match && match[1].trim()) out.push(match[1].trim());
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => extractMediaUrls(item, out));
    return out;
  }
  if (typeof value !== "object") return out;

  if (typeof value.mediaUrl === "string") out.push(value.mediaUrl);
  if (Array.isArray(value.mediaUrls)) {
    value.mediaUrls.filter((url) => typeof url === "string").forEach((url) => out.push(url));
  }
  if (value.media && typeof value.media === "object") extractMediaUrls(value.media, out);
  if (value.parts && typeof value.parts === "object") extractMediaUrls(value.parts, out);
  if (value.details && typeof value.details === "object") extractMediaUrls(value.details, out);
  if (Array.isArray(value.content)) extractMediaUrls(value.content, out);
  return out;
}

function uniqueMediaUrls(values) {
  const seen = new Set();
  return values
    .map((url) => String(url || "").trim())
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function isLikelyBase64ImageData(value) {
  return typeof value === "string"
    && value.length > 100
    && /^[A-Za-z0-9+/]+={0,2}$/u.test(value.replace(/\s+/gu, ""));
}

function imageExtensionFromMime(mimeType = "") {
  const lower = String(mimeType || "").toLowerCase();
  if (lower.includes("jpeg") || lower.includes("jpg")) return ".jpg";
  if (lower.includes("webp")) return ".webp";
  if (lower.includes("gif")) return ".gif";
  return ".png";
}

function writeInlineImage(data, mimeType = "image/png") {
  const clean = String(data || "").replace(/\s+/gu, "");
  const bytes = Buffer.from(clean, "base64");
  if (!bytes.length) return "";
  const dir = path.join("/tmp", "openclaw-onebot-media");
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash("md5").update(bytes).digest("hex").slice(0, 16);
  const file = path.join(dir, `media-${Date.now()}-${hash}${imageExtensionFromMime(mimeType)}`);
  fs.writeFileSync(file, bytes);
  return file;
}

function extractInlineImageFiles(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => extractInlineImageFiles(item, out));
    return out;
  }
  if (typeof value !== "object") return out;

  const type = String(value.type || "").toLowerCase();
  const mimeType = String(value.mimeType || value.contentType || value.media_type || "");
  const data = value.data || value.base64;
  if ((type === "image" || mimeType.startsWith("image/")) && isLikelyBase64ImageData(data)) {
    const file = writeInlineImage(data, mimeType || "image/png");
    if (file) out.push(file);
  }

  if (typeof value.image_url === "string" && value.image_url.startsWith("data:image/")) {
    const match = /^data:([^;,]+);base64,(.+)$/u.exec(value.image_url);
    if (match) {
      const file = writeInlineImage(match[2], match[1]);
      if (file) out.push(file);
    }
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") extractInlineImageFiles(child, out);
  }
  return out;
}

function uniqueImagePaths(values) {
  const seen = new Set();
  return values
    .map((file) => String(file || "").trim())
    .filter((file) => {
      if (!file || seen.has(file)) return false;
      seen.add(file);
      return true;
    });
}

function cleanAgentText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/^MEDIA:/u.test(line.trim()))
    .join("\n")
    .trim();
}


async function runAgent(sessionKey, prompt, options = {}) {
  const agentPrompt = options.skipAimemory ? prompt : await withAimemoryContext(prompt, options.memoryQuery);
  return new Promise((resolve, reject) => {
    const args = [
      "agent",
      "--session-key", sessionKey,
      "--message", agentPrompt,
      "--json",
      "--timeout", "180",
    ];
    if (AGENT_MODEL) args.splice(5, 0, "--model", AGENT_MODEL);
    execFile("openclaw", args, {
      cwd: "/home/node/.openclaw/workspace",
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_PORT: process.env.OPENCLAW_GATEWAY_PORT || "18789",
      },
      timeout: 240000,
      maxBuffer: 20 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      try {
        const start = stdout.indexOf("{");
        const parsed = JSON.parse(start >= 0 ? stdout.slice(start) : stdout);
        const payloads = parsed?.payloads || parsed?.result?.payloads || [];
        const meta = parsed?.result?.meta || parsed?.meta || {};
        const mediaUrls = uniqueMediaUrls(extractMediaUrls([payloads, meta, parsed?.result, parsed]));
        const imagePaths = uniqueImagePaths(extractInlineImageFiles([payloads, meta, parsed?.result, parsed]));
        let text = cleanAgentText(extractText(payloads).join("\n"));
        if (!text) {
          text = cleanAgentText(extractText([
            meta.finalAssistantVisibleText,
            meta.finalAssistantRawText,
            parsed?.finalAssistantVisibleText,
            parsed?.finalAssistantRawText,
          ]).join("\n"));
        }
        if (!text && mediaUrls.length === 0 && imagePaths.length === 0) {
          log("agent-empty-output", sessionKey, JSON.stringify({
            runId: parsed?.runId,
            status: parsed?.status,
            summary: parsed?.summary,
            stopReason: meta?.stopReason || meta?.completion?.stopReason,
            livenessState: meta?.livenessState,
          }).slice(0, 700));
        }
        resolve({ text, mediaUrls, imagePaths });
      } catch (parseErr) {
        parseErr.stdout = stdout;
        parseErr.stderr = stderr;
        reject(parseErr);
      }
    });
  });
}

function compactionFailureText(err) {
  return [err?.message, err?.stderr, err?.stdout]
    .filter(Boolean)
    .map(String)
    .join("\n");
}

function isSessionCompactionFailure(err) {
  const text = compactionFailureText(err);
  return /transcript compaction failed|Summarization failed|Turn prefix summarization failed|provider_error_4xx/u.test(text);
}

function canonicalSessionKey(sessionKey) {
  const value = String(sessionKey || "").trim();
  return value.startsWith("agent:") ? value : `agent:main:${value}`;
}

function resetOpenClawSessionIndex(sessionKey) {
  const fullKey = canonicalSessionKey(sessionKey);
  const sessionsDir = "/home/node/.openclaw/agents/main/sessions";
  const sessionsPath = path.join(sessionsDir, "sessions.json");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
  } catch (err) {
    log("session-reset-read-failed", fullKey, err.message);
    return false;
  }
  const entry = data?.[fullKey];
  if (!entry) {
    log("session-reset-missing", fullKey);
    return false;
  }
  const sessionId = entry.sessionId || entry.id || entry.session?.id || "";
  const stamp = new Date().toISOString().replace(/[:.]/gu, "").replace(/-/gu, "");
  const backupDir = path.join(sessionsDir, "reset-backups", `${stamp}-${fullKey.replace(/[^A-Za-z0-9_.-]+/gu, "_")}`);
  fs.mkdirSync(backupDir, { recursive: true });
  try {
    fs.copyFileSync(sessionsPath, path.join(backupDir, "sessions.json.before"));
    fs.writeFileSync(path.join(backupDir, "entry.json"), JSON.stringify({ key: fullKey, entry }, null, 2));
    if (sessionId) {
      for (const suffix of [".jsonl", ".trajectory.jsonl"]) {
        const file = path.join(sessionsDir, `${sessionId}${suffix}`);
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
      }
    }
  } catch (err) {
    log("session-reset-backup-warning", fullKey, err.message);
  }
  delete data[fullKey];
  const tmp = `${sessionsPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, sessionsPath);
  log("session-reset", fullKey, sessionId || "-", backupDir);
  return true;
}

async function runAgentWithSessionRecovery(sessionKey, prompt, options = {}) {
  try {
    return await runAgent(sessionKey, prompt, options);
  } catch (err) {
    if (!isSessionCompactionFailure(err)) throw err;
    log("session-compaction-failure", sessionKey, compactionFailureText(err).slice(0, 300));
    resetOpenClawSessionIndex(sessionKey);
    return await runAgent(sessionKey, prompt, { ...options, skipAimemory: true });
  }
}

async function recoverEmptyPrivateReply(sessionKey) {
  const recoveryPrompt = [
    "上一轮 QQ 桥接没有收到可发送正文。",
    "不要调用工具，不要 sessions_spawn，不要 sessions_yield。",
    "如果刚才已有工具或子代理结果，直接转述给对方；如果还没有结果，就直接说明已收到但还在等待。",
    "只输出一段可以发到 QQ 私聊里的正文。",
  ].join("\n");
  try {
    return await runAgent(sessionKey, recoveryPrompt, { skipAimemory: true });
  } catch (err) {
    log("empty-recovery-error", sessionKey, err.message, (err.stderr || err.stdout || "").slice(0, 700));
    return "";
  }
}

function segmentText(segment) {
  if (!segment) return "";
  if (typeof segment === "string") return segment;
  if (segment.type === "text") return segment.data?.text || "";
  if (segment.type === "at") return `[@${segment.data?.qq || ""}]`;
  if (segment.type === "image") {
    const file = segment.data?.file || "";
    const url = segment.data?.url || "";
    const meta = [file && `file=${file}`, url && `url=${url}`].filter(Boolean).join(" ");
    return meta ? `[图片 ${meta}]` : "[图片]";
  }
  if (segment.type === "face") return `[表情:${segment.data?.id || ""}]`;
  if (segment.type === "reply") return "";
  return `[${segment.type || "消息"}]`;
}

function messageContentText(message, raw = "") {
  if (Array.isArray(message)) return message.map(segmentText).join("").trim();
  if (typeof message === "string") return message.trim();
  if (raw) return String(raw).trim();
  return "";
}

function eventText(event) {
  return messageContentText(event.message, event.raw_message);
}

async function groupMemberName(groupId, userId) {
  const qq = String(userId || "").trim();
  if (!groupId || !qq || qq === "all") return qq;
  const key = `${groupId}:${qq}`;
  if (groupMemberNameCache.has(key)) return groupMemberNameCache.get(key);
  try {
    const data = parseOnebotData(await onebot("get_group_member_info", {
      group_id: groupId,
      user_id: qq,
      no_cache: false,
    }), "get_group_member_info");
    const name = senderName(data) || qq;
    groupMemberNameCache.set(key, name);
    return name;
  } catch (err) {
    log("member-name-error", groupId, qq, err.message);
    groupMemberNameCache.set(key, qq);
    return qq;
  }
}

async function segmentTextFull(event, segment) {
  if (!segment || typeof segment === "string" || segment.type !== "at") return segmentText(segment);
  const qq = String(segment.data?.qq || "").trim();
  if (!qq) return "[@]";
  if (qq === "all") return "[@全体成员(all)]";
  if (event.message_type !== "group") return `[@${qq}]`;
  const name = await groupMemberName(event.group_id, qq);
  return `[@${name}(${qq})]`;
}

async function eventTextFull(event) {
  if (!Array.isArray(event.message)) return eventText(event);
  const parts = [];
  for (const segment of event.message) {
    parts.push(await segmentTextFull(event, segment));
  }
  return parts.join("").trim();
}

function mentionedQqs(event) {
  if (!Array.isArray(event.message)) return [];
  return event.message
    .filter((seg) => seg?.type === "at")
    .map((seg) => String(seg.data?.qq || "").trim())
    .filter(Boolean);
}

function shouldIgnoreGroupMentionedOthers(event) {
  if (event.message_type !== "group") return false;
  const qqs = mentionedQqs(event);
  if (!qqs.length) return false;
  return !qqs.some((qq) => qq === "all" || qq === String(event.self_id));
}

function replySegment(event) {
  if (!Array.isArray(event.message)) return null;
  return event.message.find((seg) => seg?.type === "reply") || null;
}

function replyMessageId(event) {
  const seg = replySegment(event);
  return String(seg?.data?.id || seg?.data?.message_id || event?.reply?.message_id || "").trim();
}

function senderName(sender = {}) {
  return String(sender.card || sender.nickname || sender.user_id || "").trim();
}

function formatQuotedMessage(data, id) {
  const body = messageContentText(data?.message, data?.raw_message) || "[非文本消息]";
  const who = senderName(data?.sender || {});
  const prefix = who ? `${who}: ` : "";
  const compact = String(body).replace(/\s+/g, " ").trim();
  const clipped = Array.from(compact).slice(0, 500).join("");
  return `引用消息 ${id}: ${prefix}${clipped}${compact.length > clipped.length ? "..." : ""}`;
}

async function quotedContext(event) {
  const id = replyMessageId(event);
  if (!id) return "";

  if (event.reply) {
    return formatQuotedMessage(event.reply, id);
  }

  try {
    const data = parseOnebotData(await onebot("get_msg", { message_id: id }), "get_msg");
    return formatQuotedMessage(data, id);
  } catch (err) {
    log("quote-fetch-error", id, err.message);
    return `引用消息 ${id}: [原消息获取失败]`;
  }
}

function withQuotedContext(text, quote) {
  const body = String(text || "").trim() || "[非文本消息]";
  if (!quote) return body;
  return [
    `[${quote}]`,
    body,
  ].join("\n");
}

function withSenderContext(event, text) {
  const qq = String(event?.user_id || "").trim();
  const body = String(text || "").trim() || "[非文本消息]";
  if (!qq) return body;
  return `[QQ:${qq}] ${body}`;
}

function imageInfo(event) {
  if (!Array.isArray(event.message)) return "";
  return event.message
    .filter((seg) => seg?.type === "image")
    .map((seg) => {
      const data = seg.data || {};
      return [
        data.file && `file=${data.file}`,
        data.url && `url=${data.url}`,
        data.summary && `summary=${data.summary}`,
        data.sub_type && `sub_type=${data.sub_type}`,
      ].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" | ");
}

function hasImageSegment(event) {
  return Array.isArray(event.message) && event.message.some((seg) => seg?.type === "image");
}

function hasTextSegment(event) {
  if (Array.isArray(event.message)) {
    return event.message.some((seg) => seg?.type === "text" && String(seg.data?.text || "").trim());
  }
  return Boolean(String(event.raw_message || event.message || "").trim());
}

function hasMention(event) {
  if (!Array.isArray(event.message)) return false;
  return event.message.some((seg) => seg?.type === "at" && String(seg.data?.qq) === String(event.self_id));
}

function shouldIgnoreGroupNotMentionedSelf(event) {
  return event.message_type === "group" && !hasMention(event);
}

function isOwnerPrivateStyleGroupMessage(event) {
  return event.message_type === "group"
    && PRIVATE_STYLE_GROUP_IDS.has(String(event.group_id))
    && OWNER_USER_IDS.has(String(event.user_id));
}

function isPrivateStyleGroupMessage(event) {
  return event.message_type === "group"
    && PRIVATE_STYLE_GROUP_IDS.has(String(event.group_id));
}

function isContextOnlyPrivateStyleGroupMessage(event) {
  return isPrivateStyleGroupMessage(event)
    && GROUP_CONTEXT_ONLY_USER_IDS.has(String(event.user_id));
}

function isPureSelfMention(event) {
  if (event.message_type !== "group" || !Array.isArray(event.message) || !hasMention(event)) return false;
  return event.message.every((seg) => {
    if (!seg) return true;
    if (seg.type === "at") return String(seg.data?.qq) === String(event.self_id);
    if (seg.type === "text") return !String(seg.data?.text || "").trim();
    return seg.type === "reply";
  });
}

function imageTarget(event) {
  if (event.message_type === "group") {
    return { kind: "group", id: String(event.group_id), requester: String(event.user_id), mention: "来啦" };
  }
  return { kind: "private", id: String(event.user_id), requester: "", mention: "" };
}

function isImageGenerationRequest(text) {
  const value = String(text || "").trim();
  if (!value || value === "[图片]") return false;
  const lower = value.toLowerCase();
  if (/\b(image_grok|grok-imagine|grok)\b/i.test(lower)) return false;
  if (/[?？]/.test(value) && /(为什么|怎么|咋|啥|什么|哪|是不是|吗|么)/.test(value)) return false;
  if (/(为什么|怎么|咋|啥|什么|哪|没发|发到|发给).{0,24}(图|图片)/.test(value)) return false;
  if (/^(这|这个|那|那个|刚才|上面).{0,24}(出|生成|做|画).{0,8}(图|图片).{0,8}[吗么?？]?$/.test(value)) return false;
  if (/(生图|出张图|出一张图|再出张|再出一张|画张图|画一张|生成图片|生成一张|来一张|整一张)/.test(value)) return true;
  if (/(给我|帮我|麻烦|请|现在让你).{0,12}(出|画|生成|做|来|整).{0,16}(你自己|绯夜|鸦羽|hiya|karasuba|图|图片|画像|头像|插画|立绘|壁纸)/i.test(value)) return true;
  return /^(小夜啊[,，]?)?(再)?(出|画|生成|做|来|整)(一|1)?张.{0,16}(你自己|绯夜|鸦羽|hiya|karasuba|图|图片|画像|头像|插画|立绘|壁纸)/i.test(value);
}

function requestedExistingImage(text) {
  const value = String(text || "");
  const match = value.match(/([A-Za-z0-9_.-]+\.(?:png|jpe?g|webp))/i);
  if (!match) return "";
  const name = path.basename(match[1]);
  const candidates = [
    path.join(IMAGE_WATCH_DIR, name),
    path.join(WORKSPACE, name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return "";
}

function wantsHiyaReference(text) {
  return /你自己|你的图|绯夜|鸦羽|hiya|karasuba|吸血鬼|和服|红眼|银白/i.test(String(text || ""));
}

function isDeepSeekDelegateRequest(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (/\bdeepseek\b|DeepSeek|深度求索|V4\s*Flash/i.test(value)) return true;
  if (/(子代理|子agent|子Agent|代理).{0,16}(回复|回|答|反击|处理|接|怼)/i.test(value)) return true;
  if (/(甩给|丢给|交给|扔给).{0,16}(子代理|DeepSeek|deepseek|V4\s*Flash)/i.test(value)) return true;
  if (/(亲|舔|摸|揉|蹭|咬|含|吸).{0,8}(奶|胸|乳|腿|屁股|臀|内裤|下面|下体|私处|敏感|身体)/i.test(value)) return true;
  if (/(奶子|胸部|乳房|内裤|下面|下体|私处|涩涩|色色|做爱|性爱|性交|裸|脱衣|露出|发情|调教)/i.test(value)) return true;
  return false;
}

function imagePromptFromRequest(event, text, useReference) {
  const base = String(text || "").trim();
  if (useReference) {
    return [
      "Use the attached reference image as the strict face and identity reference for Karasuba Hiya.",
      "Create a high quality anime illustration of Karasuba Hiya according to the user's request.",
      "",
      `User request: ${base || "出一张鸦羽绯夜自己的图"}`,
      "",
      "Hard requirements:",
      "- Preserve the reference face shape and identity as closely as possible.",
      "- Adult pale vampire woman, silver-white long straight hair with blunt bangs, crimson glowing eyes, cold expression.",
      "- Black long kimono, dark red accents, elegant dangerous gothic Japanese atmosphere.",
      "- No text, no watermark, no UI, no extra characters.",
    ].join("\n");
  }
  return [
    "Create a high quality image according to the user's QQ request.",
    `User request: ${base}`,
    "No text, no watermark, no UI unless explicitly requested.",
  ].join("\n");
}

function imageJobEnv() {
  return {
    ...process.env,
    PATH: `/app/node_modules/.bin:${process.env.PATH || ""}`,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    CODEX_IMAGEGEN_CODEX_HOME: "/home/node/.openclaw/agents/main/agent/codex-home",
    CODEX_IMAGEGEN_WORKDIR: WORKSPACE,
    CODEX_IMAGEGEN_WATCH_DIR: IMAGE_WATCH_DIR,
    CODEX_IMAGEGEN_MAX_WORKERS: process.env.CODEX_IMAGEGEN_MAX_WORKERS || "2",
    CODEX_IMAGEGEN_MODEL: process.env.CODEX_IMAGEGEN_MODEL || "gpt-5.5",
    ONEBOT_URL,
    ONEBOT_TOKEN,
    ONEBOT_SHARED_DIR: "/home/node/Napcat/shared",
    ONEBOT_CONTAINER_SHARED_DIR: "/home/node/Napcat/shared",
    OPENCLAW_CONFIG_PATH: "/home/node/.openclaw/openclaw.json",
    SEND_DEDUPE_WINDOW_SECONDS: process.env.SEND_DEDUPE_WINDOW_SECONDS || "0",
    ONEBOT_SEND_RETRIES: process.env.ONEBOT_SEND_RETRIES || "12",
    ONEBOT_SEND_RETRY_DELAY_SECONDS: process.env.ONEBOT_SEND_RETRY_DELAY_SECONDS || "5",
  };
}

function enqueueImageJob(event, text) {
  const target = imageTarget(event);
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const outputName = `qq_${target.kind}_${target.id}_${stamp}`;
  const promptPath = path.join(IMAGE_PROMPT_DIR, `${outputName}.prompt.txt`);
  const useReference = wantsHiyaReference(text) && fs.existsSync(IDENTITY_IMAGE);
  fs.writeFileSync(promptPath, imagePromptFromRequest(event, text, useReference), "utf8");

  const args = [promptPath, outputName];
  if (useReference) args.push(IDENTITY_IMAGE);
  args.push(target.kind, target.id, target.requester, target.mention);

  const logPath = path.join(IMAGE_LOG_DIR, `${outputName}.enqueue.log`);
  const out = fs.openSync(logPath, "a");
  const child = spawn(IMAGEGEN_SCRIPT, args, {
    cwd: WORKSPACE,
    env: imageJobEnv(),
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  fs.closeSync(out);
  log("image-job", outputName, target.kind, target.id, `ref=${useReference}`, `log=${logPath}`);
}

function sendExistingImage(event, imagePath) {
  const target = imageTarget(event);
  const logPath = path.join(IMAGE_LOG_DIR, `send-existing-${Date.now()}.log`);
  const out = fs.openSync(logPath, "a");
  const child = spawn(IMAGE_SEND_SCRIPT, [imagePath, target.kind, target.id, target.requester, target.mention], {
    cwd: WORKSPACE,
    env: imageJobEnv(),
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  fs.closeSync(out);
  log("image-send-existing", imagePath, target.kind, target.id, `log=${logPath}`);
}

function sendExistingImageConfirmed(event, imagePath) {
  return new Promise((resolve, reject) => {
    const target = imageTarget(event);
    execFile(IMAGE_SEND_SCRIPT, [imagePath, target.kind, target.id, target.requester, target.mention], {
      cwd: WORKSPACE,
      env: imageJobEnv(),
      timeout: 300000,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      let parsed = {};
      try {
        parsed = JSON.parse(String(stdout || "{}").trim() || "{}");
      } catch (_) {
        parsed = { raw: String(stdout || "").trim() };
      }
      if (!parsed.message_id) {
        reject(new Error(`image send returned no message_id: ${String(stdout || stderr || "").slice(0, 500)}`));
        return;
      }
      log("image-send-confirmed", imagePath, target.kind, target.id, parsed.message_id);
      resolve(parsed);
    });
  });
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeTempImageFile(imagePath) {
  if (!imagePath) return;
  const allowedRoots = [
    D2_DIRECT_OUT_DIR,
    "/tmp/openclaw-onebot-media",
    "/tmp/openclaw-d2stats-media",
  ].map((root) => path.resolve(root));
  const resolved = path.resolve(String(imagePath));
  const isAllowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  if (!isAllowed) return;
  try {
    fs.unlinkSync(resolved);
    log("temp-image-deleted", resolved);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      log("temp-image-delete-error", resolved, err.message);
    }
  }
}

function cleanupD2ResultMedia(result) {
  const details = result?.details || {};
  removeTempImageFile(details.mediaPath);
  const media = Array.isArray(details.media) ? details.media : [];
  for (const item of media) {
    removeTempImageFile(item?.mediaPath);
  }
}

function deepSeekSessionKey(event) {
  if (event.message_type === "group") return `deepseek-delegate-group-${event.group_id}`;
  if (event.message_type === "private") return `deepseek-delegate-private-${event.user_id}`;
  return "deepseek-delegate";
}

function runDeepSeekDelegate(event, text) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DEEPSEEK_DELEGATE_SCRIPT)) {
      reject(new Error(`DeepSeek delegate script missing: ${DEEPSEEK_DELEGATE_SCRIPT}`));
      return;
    }

    const targetId = String(event.group_id || event.user_id || "unknown");
    const context = event.message_type === "group" ? "QQ group" : "QQ private";
    const stamp = `${Date.now()}-${event.message_id || "event"}`.replace(/[^A-Za-z0-9_.-]/g, "_");
    const messagePath = path.join(DEEPSEEK_LOG_DIR, `${stamp}.message.txt`);
    const logPath = path.join(DEEPSEEK_LOG_DIR, `${stamp}.log`);
    fs.writeFileSync(messagePath, text || "[非文本消息]", "utf8");

    const args = [
      "--context", context,
      "--requester", String(event.user_id || "unknown"),
      "--target", targetId,
      "--message-file", messagePath,
      "--session-key", deepSeekSessionKey(event),
    ];
    const images = imageInfo(event);
    if (images) args.push("--image-info", images);

    execFile(DEEPSEEK_DELEGATE_SCRIPT, args, {
      cwd: WORKSPACE,
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_PORT: process.env.OPENCLAW_GATEWAY_PORT || "18789",
      },
      timeout: 240000,
      maxBuffer: 20 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      fs.writeFileSync(logPath, [
        `args=${JSON.stringify(args)}`,
        `exit=${err ? (err.code || 1) : 0}`,
        "STDOUT:",
        stdout || "",
        "STDERR:",
        stderr || "",
      ].join("\n"), "utf8");

      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        err.logPath = logPath;
        reject(err);
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function buildPrompt(event, text) {
  if (isOwnerPrivateStyleGroupMessage(event)) {
    return [
      "这是主人指定的 QQ 例外群。主人在这个群里和你聊天时，要像私聊一样亲近、自然、暧昧地回应。",
      "不要因为这是群聊就冷淡、机械确认、强行压短，按主人的情绪和语境正常接话。",
      "仍然只回应主人，不要泄露隐私，不要承认自己是机器人。",
      "群消息用 [QQ:号码] 标出真实发送者；只有 QQ 1665240495 和 3793341814 是主人。",
      "",
      text || "[非文本消息]",
    ].join("\n");
  }
  if (event.message_type === "group") {
    return text || "[非文本消息]";
  }
  return text || "[非文本消息]";
}

function buildContextOnlyPrompt(event, text) {
  return text || "[非文本消息]";
}

function shouldIgnoreEvent(event) {
  if (event.time && Number(event.time) < STARTED_AT_SEC - HISTORY_GRACE_SEC) return true;
  return false;
}

function shouldIgnoreGroupImage(event) {
  return event.message_type === "group" && hasImageSegment(event) && !hasTextSegment(event);
}

function shouldIgnoreGroupSmallTalk(event, text) {
  if (event.message_type !== "group" || hasMention(event)) return false;
  const value = String(text || "").trim();
  if (!value) return true;
  return /^(6+|1|这|那|好+|嗯+|哦+|啊+|啊？|啊\?|哈+|哈哈+|笑死|草+|牛+|确实|不是|对|离谱|绷不住|[?？!！。,.，、]+)$/i.test(value);
}

function shouldStopPrivateStyleContextChat(event, text) {
  if (!isContextOnlyPrivateStyleGroupMessage(event)) return false;
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  return /(先这样|先到这|到这儿|到这里|不多说|不聊了|停下|收声|夜深了|晚安|睡了|休息吧|改天再聊)/.test(value);
}

function shouldSendFullGroupReply(message, reply) {
  const text = String(message || "").trim();
  if (!text) return false;
  if (replyMediaUrls(reply).length > 0 || replyImagePaths(reply).length > 0) return true;
  if (/\n\s*[-*\u2022]/u.test(text)) return true;
  if (/https?:\/\/|\/api\/d2\/bind\/|OAuth|请在3分钟|绑定|登录|链接/iu.test(text)) return true;
  const fullReplyKeywords = [
    "\u547d\u8fd02",
    "Destiny",
    "\u4ed3\u5e93",
    "\u5e93\u5b58",
    "\u88c5\u5907",
    "\u6b66\u5668",
    "\u62a4\u7532",
    "\u6218\u7ee9",
    "\u5730\u7262",
    "\u7a81\u88ad",
    "\u5b97\u5e08",
    "\u50ac\u5316",
    "\u953b\u9020",
    "\u70ed\u529b\u56fe",
    "\u7ed1\u5b9a\u8d26\u53f7",
    "lucifer#8571",
  ];
  return fullReplyKeywords.some((keyword) => text.includes(keyword));
}

function trimGroupReply(message) {
  const compact = String(message || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (Array.from(compact).length <= 80) return compact;
  return `${Array.from(compact).slice(0, 80).join("")}\u2026`;
}

function isNoReplyMarker(message) {
  const compact = String(message || "")
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[\s。！？!?，,；;、.]+/g, "")
    .toUpperCase();
  return compact === "NO_REPLY" || /^(NO_REPLY)+$/.test(compact);
}

function replyText(reply) {
  if (reply && typeof reply === "object" && !Array.isArray(reply)) {
    return String(reply.text || "");
  }
  return String(reply || "");
}

function replyMediaUrls(reply) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return [];
  return uniqueMediaUrls(Array.isArray(reply.mediaUrls) ? reply.mediaUrls : []);
}

function replyImagePaths(reply) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return [];
  return uniqueImagePaths(Array.isArray(reply.imagePaths) ? reply.imagePaths : []);
}

function isD2CardMediaUrl(url) {
  return /\/api\/d2\/cards\//u.test(String(url || ""));
}

function mediaExtension(url, contentType = "") {
  const lowerType = String(contentType || "").toLowerCase();
  if (lowerType.includes("png")) return ".png";
  if (lowerType.includes("jpeg") || lowerType.includes("jpg")) return ".jpg";
  if (lowerType.includes("webp")) return ".webp";
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const ext = path.extname(pathname);
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return ext;
  } catch (_) {}
  return ".png";
}

async function downloadMediaUrl(mediaUrl) {
  if (typeof fetch !== "function") throw new Error("fetch unavailable for media download");
  const response = await fetch(mediaUrl);
  if (!response.ok) throw new Error(`media download HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("media download returned empty body");
  const dir = path.join("/tmp", "openclaw-onebot-media");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `media-${Date.now()}-${Math.random().toString(16).slice(2)}${mediaExtension(mediaUrl, contentType)}`);
  fs.writeFileSync(file, bytes);
  return file;
}

async function sendMediaReply(event, mediaUrl) {
  let file = "";
  try {
    file = await downloadMediaUrl(mediaUrl);
    await sendExistingImageConfirmed(event, file);
    log("media-reply-image", event.message_type, event.group_id || event.user_id, mediaUrl, file);
  } catch (err) {
    log("media-reply-error", event.message_type, event.group_id || event.user_id, mediaUrl, err.message);
  } finally {
    removeTempImageFile(file);
  }
}

async function sendImagePathReply(event, imagePath) {
  try {
    await sendExistingImageConfirmed(event, imagePath);
    log("inline-image-reply", event.message_type, event.group_id || event.user_id, imagePath);
  } catch (err) {
    log("inline-image-reply-error", event.message_type, event.group_id || event.user_id, imagePath, err.message);
  } finally {
    removeTempImageFile(imagePath);
  }
}



function normalizeD2Text(text) {
  return String(text || "")
    .replace(/\[??[^\]]*\]/gu, " ")
    .replace(/\[@[^\]]*\]/gu, " ")
    .replace(/@\S+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasAnyD2Word(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.some((word) => lower.includes(String(word).toLowerCase()));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const D2_DIRECT_KEYWORDS = [
  "\u547d\u8fd02", "destiny 2", "destiny2", "d2", "bungie", "\u68d2\u9e21", "\u6218\u7ee9", "\u5730\u7262", "\u7a81\u88ad", "raid", "\u914d\u88c5", "\u4e09\u767e", "\u4e09\u767e\u5957", "loadout", "build",
  "\u5b97\u5e08", "\u65e5\u843d", "\u591c\u5e55", "gm", "\u70ed\u529b\u56fe", "\u6d3b\u8dc3", "\u953b\u9020", "\u56fe\u7eb8",
  "\u50ac\u5316", "\u4ed3\u5e93", "\u5e93\u5b58", "\u80cc\u5305", "\u88c5\u5907", "equipped", "\u6b66\u5668", "\u540d\u7247", "\u751f\u6daf",
  "pvp", "\u7194\u7089", "\u8bd5\u70bc", "\u6700\u8fd1", "\u6d3b\u52a8", "\u5355\u5c40", "pgcr",
  "perk", "perks", "\u6765\u6e90", "\u51fa\u5904", "\u600e\u4e48\u83b7\u53d6", "\u54ea\u91cc\u51fa", "\u600e\u4e48\u5f97", "\u5982\u4f55\u83b7\u5f97", "\u662f\u4ec0\u4e48\u6b66\u5668",
];

const D2_INVENTORY_SEARCH_WORDS = [
  "\u51b2\u950b\u67aa", "\u5fae\u51b2", "\u5fae\u51b2\u67aa", "\u5fae\u578b\u51b2\u950b\u67aa", "smg", "submachine",
  "\u624b\u70ae", "hand cannon", "handcannon", "hc",
  "\u55b7\u5b50", "\u9730\u5f39", "\u9730\u5f39\u67aa", "shotgun",
  "\u81ea\u52a8\u6b65\u67aa", "\u81ea\u52a8", "auto rifle", "autorifle",
  "\u8109\u51b2\u6b65\u67aa", "\u8109\u51b2", "pulse rifle", "pulserifle",
  "\u65a5\u5019\u6b65\u67aa", "\u65a5\u5019", "scout rifle", "scoutrifle",
  "\u72d9\u51fb\u6b65\u67aa", "\u72d9\u51fb\u67aa", "\u72d9\u51fb", "sniper rifle", "sniperrifle", "sniper",
  "\u878d\u5408\u6b65\u67aa", "\u878d\u5408\u67aa", "\u878d\u5408", "fusion rifle", "fusionrifle",
  "\u7ebf\u6027\u878d\u5408\u6b65\u67aa", "\u7ebf\u878d", "\u7ebf\u6027\u878d\u5408", "linear fusion", "linearfusion",
  "\u69b4\u5f39\u53d1\u5c04\u5668", "\u69b4\u5f39", "grenade launcher", "grenadelauncher",
  "\u706b\u7bad\u53d1\u5c04\u5668", "\u706b\u7bad\u7b52", "\u706b\u7bad", "\u7b52\u5b50", "rocket launcher", "rocketlauncher",
  "\u673a\u67aa", "machine gun", "machinegun", "mg",
  "\u5251", "\u5200\u5251", "sword",
  "\u5f13", "bow",
  "\u624b\u67aa", "sidearm",
];

const D2_INVENTORY_WEAPON_TYPE_ALIASES = [
  { canonical: "\u51b2\u950b\u67aa", terms: ["\u51b2\u950b\u67aa", "\u5fae\u51b2", "\u5fae\u51b2\u67aa", "\u5fae\u578b\u51b2\u950b\u67aa", "smg", "submachine gun", "submachinegun", "submachine"] },
  { canonical: "\u624b\u70ae", terms: ["\u624b\u70ae", "hc", "hand cannon", "handcannon"] },
  { canonical: "\u9730\u5f39\u67aa", terms: ["\u9730\u5f39\u67aa", "\u9730\u5f39", "\u55b7\u5b50", "shotgun"] },
  { canonical: "\u81ea\u52a8\u6b65\u67aa", terms: ["\u81ea\u52a8\u6b65\u67aa", "\u81ea\u52a8", "ar", "auto rifle", "autorifle"] },
  { canonical: "\u8109\u51b2\u6b65\u67aa", terms: ["\u8109\u51b2\u6b65\u67aa", "\u8109\u51b2", "pulse rifle", "pulserifle", "pulse"] },
  { canonical: "\u65a5\u5019\u6b65\u67aa", terms: ["\u65a5\u5019\u6b65\u67aa", "\u65a5\u5019", "scout rifle", "scoutrifle", "scout"] },
  { canonical: "\u72d9\u51fb\u6b65\u67aa", terms: ["\u72d9\u51fb\u6b65\u67aa", "\u72d9\u51fb\u67aa", "\u72d9\u51fb", "\u72d9", "sniper rifle", "sniperrifle", "sniper"] },
  { canonical: "\u878d\u5408\u6b65\u67aa", terms: ["\u878d\u5408\u6b65\u67aa", "\u878d\u5408\u67aa", "\u878d\u5408", "fusion rifle", "fusionrifle", "fusion"] },
  { canonical: "\u7ebf\u6027\u878d\u5408\u6b65\u67aa", terms: ["\u7ebf\u6027\u878d\u5408\u6b65\u67aa", "\u7ebf\u6027\u878d\u5408", "\u7ebf\u878d", "linear fusion rifle", "linear fusion", "linearfusion", "linear"] },
  { canonical: "\u69b4\u5f39\u53d1\u5c04\u5668", terms: ["\u69b4\u5f39\u53d1\u5c04\u5668", "\u69b4\u5f39", "gl", "grenade launcher", "grenadelauncher"] },
  { canonical: "\u706b\u7bad\u53d1\u5c04\u5668", terms: ["\u706b\u7bad\u53d1\u5c04\u5668", "\u706b\u7bad\u7b52", "\u706b\u7bad", "\u7b52\u5b50", "rocket launcher", "rocketlauncher", "rocket"] },
  { canonical: "\u673a\u67aa", terms: ["\u673a\u67aa", "mg", "machine gun", "machinegun"] },
  { canonical: "\u5251", terms: ["\u5251", "\u5200\u5251", "sword"] },
  { canonical: "\u5f13", terms: ["\u5f13", "bow"] },
  { canonical: "\u624b\u67aa", terms: ["\u624b\u67aa", "sidearm"] },
];

const D2_INVENTORY_SEARCH_KEYWORDS = [
  "\u6211\u7684", "\u6211", "\u67e5\u8be2", "\u67e5\u4e00\u4e0b", "\u67e5\u4e0b", "\u67e5", "\u770b\u770b", "\u770b",
  "\u6709\u54ea\u4e9b", "\u54ea\u4e9b", "\u6709\u6ca1\u6709", "\u627e", "\u641c", "\u641c\u7d22",
];

const D2_KNOWN_PERK_SEARCH_TERMS = [
  "爆破专家", "斩首武器", "辉耀炽热", "萤火虫", "蜻蜓", "狂乱", "重建", "重组", "维持生计",
  "快速命中", "滑射", "首发射击", "精准连击", "不法之徒", "杀戮弹匣", "多杀弹匣",
  "肾上腺素成瘾", "泉源", "渗透", "诱导推销", "嫉妒刺客", "切勿靠近", "禅意时刻",
  "测距仪", "风暴之眼", "移动目标", "自动装填枪套", "丰盈满溢", "金中藏弹",
  "冰冷弹匣", "伏特子弹", "失衡弹药", "动能震颤",
];

const D2_LOADOUT_HINT_WORDS = [
  "\u914d\u88c5", "\u5957\u88c5", "\u4e09\u767e", "\u4e09\u767e\u5957", "\u51d1", "\u80fd\u51d1", "\u8fbe\u5230", "\u6709\u6ca1\u6709", "\u80fd\u4e0d\u80fd",
  "loadout", "build",
];

const D2_LOADOUT_STATS = [
  ["mobility", ["\u6b66\u5668", "\u767e\u6b66", "weapon", "weapons", "\u673a\u52a8", "\u6a5f\u52d5", "\u654f\u6377", "\u767e\u654f", "mobility"]],
  ["resilience", ["\u751f\u547d\u503c", "\u751f\u547d", "\u767e\u547d", "health", "hp", "\u97e7\u6027", "\u97cc\u6027", "\u97e7", "\u767e\u97e7", "resilience"]],
  ["recovery", ["\u804c\u4e1a", "\u8077\u696d", "\u804c\u4e1a\u6280\u80fd", "\u767e\u804c", "class", "\u6062\u590d", "\u6062\u5fa9", "\u56de\u590d", "\u767e\u6062", "recovery"]],
  ["discipline", ["\u624b\u96f7", "\u767e\u96f7", "grenade", "grenades", "\u7eaa\u5f8b", "\u7d00\u5f8b", "\u767e\u7eaa", "discipline"]],
  ["intellect", ["\u8d85\u80fd", "\u5927\u62db", "\u767e\u8d85", "super", "\u667a\u6167", "\u667a\u529b", "\u767e\u667a", "intellect"]],
  ["strength", ["\u8fd1\u6218", "\u8fd1\u6230", "\u767e\u8fd1", "melee", "\u529b\u91cf", "\u767e\u529b", "strength"]],
];

const D2_DIRECT_REPLAY_WORDS = [
  "\u53d1\u51fa\u6765", "\u53d1\u51fa\u6765\u554a", "\u6ca1\u53d1\u56fe", "\u6ca1\u56fe", "\u56fe\u5462", "\u56fe\u7247\u5462",
  "\u518d\u53d1\u4e00\u6b21", "\u91cd\u53d1", "\u518d\u6765\u4e00\u6b21", "\u518d\u6765\u5f20", "\u91cd\u65b0\u53d1",
];

function inferD2DirectCard(text) {
  const value = normalizeD2Text(text);
  const itemInfoIntent = hasD2ItemInfoIntent(value);
  const personalItemInfoIntent = hasD2PersonalItemInfoIntent(value);
  const perkWeaponsIntent = hasD2PerkWeaponsIntent(value);
  if (
    !value ||
    (!hasAnyD2Word(value, D2_DIRECT_KEYWORDS) &&
      !hasAnyD2Word(value, D2_INVENTORY_SEARCH_WORDS) &&
      !hasD2LoadoutIntent(value) &&
      !hasD2LoadoutManageIntent(value) &&
      !perkWeaponsIntent &&
      !itemInfoIntent &&
      !personalItemInfoIntent)
  ) return null;
  if (hasAnyD2Word(value, ["\u5e2e\u52a9", "\u83dc\u5355", "help", "\u6307\u4ee4", "\u547d\u4ee4"])) return "help";
  if (hasD2LoadoutManageIntent(value)) return "loadout_manage";
  if (hasD2LoadoutIntent(value)) return "loadout_optimizer";
  if (personalItemInfoIntent) return "inventory";
  if (perkWeaponsIntent) return "perk_weapons";
  if (hasAnyD2Word(value, ["\u4ed3\u5e93\u641c\u7d22", "\u4ed3\u5e93", "\u5e93\u5b58", "\u80cc\u5305", "\u73b0\u6709\u88c5\u5907", "\u8eab\u4e0a\u88c5\u5907", "\u5f53\u524d\u88c5\u5907", "\u6211\u7a7f\u4ec0\u4e48", "\u67e5\u88c5\u5907", "\u88c5\u5907", "inventory", "vault", "equipped"])) return "inventory";
  if (hasAnyD2Word(value, D2_INVENTORY_SEARCH_WORDS) && hasAnyD2Word(value, D2_INVENTORY_SEARCH_KEYWORDS)) return "inventory";
  if (hasAnyD2Word(value, ["\u50ac\u5316", "catalyst"])) return inferD2CatalystCard(value);
  if (hasAnyD2Word(value, ["\u953b\u9020", "\u56fe\u7eb8", "craft", "pattern"])) return "crafting";
  if (hasAnyD2Word(value, ["\u5b97\u5e08", "\u65e5\u843d", "\u591c\u5e55", "grandmaster", "gm"])) return "grandmasters";
  if (hasAnyD2Word(value, ["\u5730\u7262", "dungeon"])) return "dungeon_overview";
  if (hasAnyD2Word(value, ["\u7a81\u88ad", "raid"])) return "raid_overview";
  if (hasAnyD2Word(value, ["\u70ed\u529b\u56fe", "\u6d3b\u8dc3", "heatmap"])) return "heatmap";
  if (hasAnyD2Word(value, ["\u751f\u6daf", "career"])) return "career";
  if (hasAnyD2Word(value, ["\u540d\u7247", "namecard"])) return "namecard";
  if (hasAnyD2Word(value, ["pvp", "\u7194\u7089", "\u8bd5\u70bc", "trials", "crucible"])) return "pvp";
  if (itemInfoIntent) return "item_info";
  if (hasAnyD2Word(value, ["\u6b66\u5668", "weapon"])) return "weapons";
  if (hasAnyD2Word(value, ["\u5355\u5c40", "pgcr"])) return "activity";
  if (hasAnyD2Word(value, ["\u6700\u8fd1\u4e00\u628a", "\u6700\u8fd1\u6d3b\u52a8", "latest"])) return "latest_activity";
  if (hasAnyD2Word(value, ["\u6d3b\u52a8", "\u6218\u7ee9\u5217\u8868", "\u6700\u8fd1"])) return "activities";
  if (hasAnyD2Word(value, ["\u8d44\u6599", "\u89d2\u8272", "profile"])) return "profile";
  if (hasAnyD2Word(value, ["\u6218\u7ee9", "\u603b\u89c8", "\u547d\u8fd02", "destiny 2", "destiny2", "d2"])) return "summary";
  return null;
}

function hasD2ItemInfoIntent(text) {
  const value = normalizeD2Text(text);
  if (!extractD2ItemInfoQuery(value)) return false;
  if (hasAnyD2Word(value, ["\u6211\u7684", "\u4ed3\u5e93", "\u80cc\u5305", "\u8eab\u4e0a", "\u5f53\u524d\u88c5\u5907", "\u5df2\u88c5\u5907"])) {
    return false;
  }
  return hasAnyD2Word(value, ["\u67e5\u4e2a\u6b66\u5668", "\u6b66\u5668\u67e5\u8be2", "\u67e5\u6b66\u5668", "\u6b66\u5668\u8d44\u6599", "\u7269\u54c1\u67e5\u8be2", "perk", "perks", "\u6765\u6e90", "\u51fa\u5904", "\u600e\u4e48\u83b7\u53d6", "\u54ea\u91cc\u51fa", "\u600e\u4e48\u5f97", "\u5982\u4f55\u83b7\u5f97", "\u662f\u4ec0\u4e48\u6b66\u5668", "\u662f\u4ec0\u4e48", "\u597d\u4e0d\u597d\u7528", "\u597d\u7528\u5417"]);
}

function hasD2PersonalItemInfoIntent(text) {
  const value = normalizeD2Text(text);
  if (!extractD2ItemInfoQuery(value)) return false;
  if (hasAnyD2Word(value, ["\u6548\u679c", "\u6765\u6e90", "\u51fa\u5904", "\u600e\u4e48\u83b7\u53d6", "\u54ea\u91cc\u51fa", "\u600e\u4e48\u5f97", "\u5982\u4f55\u83b7\u5f97", "\u662f\u4ec0\u4e48"])) return false;
  return hasAnyD2Word(value, ["\u6211\u7684", "\u4ed3\u5e93", "\u80cc\u5305", "\u8eab\u4e0a", "\u5f53\u524d\u88c5\u5907", "\u5df2\u88c5\u5907"]);
}

function extractD2ItemInfoQuery(text) {
  return normalizeD2Text(text)
    .replace(/^\/+/u, "")
    .replace(/(@\S+\s*)+/gu, " ")
    .replace(/\u547d\u8fd02|destiny\s*2|destiny2|d2stats|d2|\u67e5\u4e2a\u6b66\u5668|\u6b66\u5668\u67e5\u8be2|\u67e5\u6b66\u5668|\u6b66\u5668\u8d44\u6599|\u7269\u54c1\u67e5\u8be2|\u67e5\u8be2\u4e00\u4e0b|\u67e5\u8be2\u4e0b|\u67e5\u8be2|\u67e5\u4e00\u4e0b|\u67e5\u4e00\u67e5|\u67e5\u4e0b|\u67e5\u770b|\u5e2e\u6211\u67e5|\u5e2e\u5fd9\u67e5|\u770b\u4e00\u4e0b|\u770b\u4e0b|\u770b\u770b|\u67e5|\u6211\u9700\u8981|\u9700\u8981|\u8fd9\u4e2a|\u4e00\u4e0b|\u4e00\u4e2a|\u7684|perk|perks|\u6765\u6e90|\u51fa\u5904|\u600e\u4e48\u83b7\u53d6|\u54ea\u91cc\u51fa|\u600e\u4e48\u5f97|\u5982\u4f55\u83b7\u5f97|\u662f\u4ec0\u4e48\u6b66\u5668|\u662f\u4ec0\u4e48|\u4ec0\u4e48|\u597d\u4e0d\u597d\u7528|\u597d\u7528\u5417|\u8bc4\u4ef7|\u8d44\u6599/giu, " ")
    .replace(/[，,：:、。？?！!；;]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasD2PerkWeaponsIntent(text) {
  const value = normalizeD2Text(text);
  if (!value || hasD2PersonalItemInfoIntent(value)) return false;
  const params = d2PerkWeaponParamsFromText(value);
  if (!params.perks.length) return false;
  if (params.weaponType || params.rpm || params.craftable !== undefined) return true;
  return hasAnyD2Word(value, ["perk查询", "查询perk", "特性查询", "能出", "可出", "可以出", "会出", "带", "有哪些武器", "哪些武器", "什么武器", "枪械", "特性", "词条"]);
}

function d2PerkWeaponParamsFromText(text) {
  const rawText = normalizeD2Text(text);
  const perks = d2UniquePerkTerms(d2PerkTermsFromNaturalText(rawText));
  const weaponType = d2InventoryWeaponTypeFromText(rawText);
  const rpm = d2InventoryRpmFromText(rawText, Boolean(weaponType));
  const craftable = hasAnyD2Word(rawText, ["可锻造", "图纸"]) ? true : undefined;
  return {
    perks,
    ...(weaponType ? { weaponType } : {}),
    ...(rpm ? { rpm } : {}),
    ...(craftable !== undefined ? { craftable } : {}),
    limit: 50,
  };
}

function d2PerkTermsFromNaturalText(text) {
  const known = [];
  let working = normalizeD2Text(text);
  for (const term of [...D2_KNOWN_PERK_SEARCH_TERMS].sort((a, b) => b.length - a.length)) {
    if (working.includes(term)) {
      known.push(term);
      working = working.replace(new RegExp(escapeRegExp(term), "gu"), " ");
    }
  }
  if (known.length) return known;
  const cleaned = cleanD2PerkWeaponQuery(working);
  return cleaned.split(/[,，、+＋&＆/|]|\s+(?:和|与|以及)\s+/gu).map(cleanD2PerkWeaponQuery).filter((term) => term.length >= 2);
}

function cleanD2PerkWeaponQuery(value) {
  let cleaned = normalizeD2Text(value)
    .replace(/^\/+/u, "")
    .replace(/命运2|destiny\s*2|destiny2|d2stats|d2|perk查询|查询perk|特性查询|查询一下|查询下|查询|查一下|查一查|查下|查看|帮我查|帮忙查|看一下|看下|看看|查|哪些|有哪些|什么|所有|全部|可滚|能出|可出|可以出|会出|有|带|的|枪械|枪|perk|perks|特性|词条/giu, " ")
    .replace(/[，,：:、。？?！!；;]+/gu, " ");
  const weaponType = d2InventoryWeaponTypeFromText(cleaned);
  if (weaponType) cleaned = stripD2InventoryWeaponTypeTerms(cleaned, weaponType);
  return cleaned.replace(/\s+/gu, " ").trim();
}

function d2UniquePerkTerms(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = String(value || "").trim();
    const key = cleaned.replace(/\s+/gu, "").toLowerCase();
    if (!cleaned || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function inferD2CatalystCard(text) {
  const value = normalizeD2Text(text);
  const q = extractD2CatalystInfoQuery(value);
  if (
    /^\/?\s*\u50ac\u5316\s*$/u.test(value) ||
    (!q && hasAnyD2Word(value, ["\u6211\u7684", "\u8d26\u53f7", "\u5e10\u865f", "\u8fdb\u5ea6", "\u9032\u5ea6", "\u5b8c\u6210", "\u72b6\u6001", "\u72c0\u614b", "\u5168\u91cf", "\u5168\u90e8", "\u6240\u6709", "\u5217\u8868", "qq", "oauth"]))
  ) {
    return "catalysts";
  }
  if (
    q &&
    hasAnyD2Word(value, ["\u6548\u679c", "\u662f\u4ec0\u4e48", "\u4ec0\u4e48", "\u8bf4\u660e", "\u4ecb\u7ecd"]) &&
    !hasAnyD2Word(value, ["\u6211\u7684", "\u8fdb\u5ea6", "\u9032\u5ea6", "\u5b8c\u6210", "\u83b7\u5f97", "\u7372\u5f97", "\u6709\u6ca1\u6709", "\u6709\u6ca1", "\u72b6\u6001", "\u72c0\u614b"])
  ) {
    return "catalyst_info";
  }
  return q ? "catalyst_status" : "catalysts";
}

function extractD2CatalystInfoQuery(text) {
  return normalizeD2Text(text)
    .replace(/^\/+/u, "")
    .replace(/(@\S+\s*)+/gu, " ")
    .replace(/\u50ac\u5316\u5242|\u50ac\u5316\u6548\u679c|\u50ac\u5316\u8fdb\u5ea6|\u50ac\u5316|\u6548\u679c|\u67e5\u8be2\u4e00\u4e0b|\u67e5\u8be2\u4e0b|\u67e5\u8be2|\u67e5\u4e00\u4e0b|\u67e5\u4e0b|\u67e5\u770b|\u5e2e\u6211\u67e5|\u5e2e\u5fd9\u67e5|\u770b\u4e00\u4e0b|\u770b\u4e0b|\u770b\u770b|\u67e5|\u6211\u9700\u8981|\u9700\u8981|\u6211\u7684|\u6211|\u6709\u6ca1\u6709|\u6709\u6ca1|\u662f\u5426|\u662f\u4ec0\u4e48|\u4ec0\u4e48|\u7684|\u547d\u8fd02|destiny\s*2|d2/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasD2LoadoutIntent(text) {
  const value = normalizeD2Text(text);
  if (!value) return false;
  if (hasAnyD2Word(value, ["\u914d\u88c5", "\u4e09\u767e", "\u4e09\u767e\u5957", "loadout", "build"])) return true;
  const mentionedStats = d2LoadoutMentionedStats(value);
  if (mentionedStats.length >= 2 && (hasAnyD2Word(value, D2_LOADOUT_HINT_WORDS) || /\b100\b/u.test(value))) return true;
  if (mentionedStats.length >= 1 && hasAnyD2Word(value, ["\u5957\u88c5", "\u51d1"])) return true;
  return false;
}

function hasD2LoadoutManageIntent(text) {
  const value = normalizeD2Text(text);
  if (!value) return false;
  return hasAnyD2Word(value, [
    "\u5957\u88c5\u5217\u8868", "\u914d\u88c5\u5217\u8868", "\u8bfb\u53d6\u914d\u88c5", "\u67e5\u770b\u914d\u88c5", "\u67e5\u770b\u6211\u7684\u914d\u88c5", "\u67e5\u914d\u88c5", "\u6211\u7684\u914d\u88c5",
    "\u6e38\u620f\u5185\u914d\u88c5", "\u672c\u5730\u914d\u88c5", "\u4fdd\u5b58\u7684\u914d\u88c5", "\u4fdd\u5b58\u914d\u88c5", "\u5df2\u4fdd\u5b58\u914d\u88c5",
    "\u4fdd\u5b58\u5f53\u524d\u88c5\u5907", "\u4fdd\u5b58\u5f53\u524d\u914d\u88c5", "\u4fdd\u5b58\u5230\u6e38\u620f\u5185", "\u4fdd\u5b58\u5230\u7b2c", "\u4fdd\u5b58\u4e3a",
    "\u88c5\u5907\u7b2c", "\u5e94\u7528", "\u5957\u7528", "\u5220\u9664\u914d\u88c5", "\u5220\u6389\u914d\u88c5", "\u6e05\u7a7a\u7b2c", "\u6e05\u7a7a\u6e38\u620f\u5185",
    "loadout list", "list loadout", "save loadout", "equip loadout", "apply loadout", "delete loadout", "clear loadout",
  ]);
}

function extractD2DirectTarget(text, event, card) {
  const value = normalizeD2Text(text);
  if (card === "help" || card === "item_info" || card === "catalyst_info" || card === "perk_weapons") return "";
  if (card === "activity") {
    const activity = /(?:activityId|pgcr)?\D*([0-9]{8,20})/iu.exec(value);
    return activity ? activity[1] : "";
  }
  const membership = /\b([0-9]{1,3})[:\/\s]+([0-9]{8,30})\b/u.exec(value);
  if (membership) return `${membership[1]}:${membership[2]}`;
  const bungieName = /([^\s?,?;]+#[0-9]{1,4})/u.exec(value);
  if (bungieName) return bungieName[1];
  const withoutBotMention = value.replace(new RegExp(String(event.self_id || "") || "^$", "gu"), " ");
  const qq = /\b([0-9]{5,15})\b/u.exec(withoutBotMention);
  if (qq) return qq[1];
  return String(event.user_id || "");
}

function d2InventoryBaseQueryText(text, target) {
  let value = normalizeD2Text(text);
  const removeParts = [target, ...["\u4ed3\u5e93\u641c\u7d22", "\u4ed3\u5e93", "\u5e93\u5b58", "\u80cc\u5305", "\u73b0\u6709\u88c5\u5907", "\u8eab\u4e0a\u88c5\u5907", "\u5f53\u524d\u88c5\u5907", "\u6211\u7a7f\u4ec0\u4e48", "\u67e5\u88c5\u5907", "\u88c5\u5907", "inventory", "vault", "equipped", "\u547d\u8fd02", "\u5e2e\u6211", "\u6211\u7684", "\u6211", "\u67e5\u8be2", "\u67e5\u4e00\u4e0b", "\u67e5\u4e00\u67e5", "\u67e5\u4e0b", "\u67e5\u6211", "\u67e5\u770b", "\u67e5", "\u770b\u770b", "\u770b", "\u641c\u7d22", "\u641c\u4e00\u4e0b", "\u641c", "\u5bfb\u627e", "\u627e\u4e00\u4e0b", "\u627e"]];
  for (const part of removeParts) {
    if (!part) continue;
    value = value.replace(new RegExp(String(part).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), " ");
  }
  return value;
}

function extractInventoryQuery(text, target) {
  return extractInventorySearchParts(text, target).q;
}

function extractInventorySearchParts(text, target) {
  const baseText = d2InventoryBaseQueryText(text, target);
  const weaponType = d2InventoryWeaponTypeFromText(baseText);
  const rpm = d2InventoryRpmFromText(baseText, Boolean(weaponType));
  let queryText = baseText;
  if (weaponType) {
    queryText = stripD2InventoryWeaponTypeTerms(queryText, weaponType);
  }
  if (rpm) {
    queryText = stripD2InventoryRpmTerms(queryText, rpm);
  }
  const q = cleanD2InventoryQuery(queryText);
  return {
    q,
    ...(weaponType ? { weaponType } : {}),
    ...(rpm ? { rpm } : {}),
  };
}

function d2InventoryWeaponTypeFromText(text) {
  const value = normalizeD2Text(text);
  if (!value) return "";
  for (const alias of D2_INVENTORY_WEAPON_TYPE_ALIASES) {
    if (alias.terms.some((term) => d2InventoryTextHasTerm(value, term))) {
      return alias.canonical;
    }
  }
  return "";
}

function d2InventoryTextHasTerm(text, term) {
  const value = normalizeD2Text(text);
  const normalizedTerm = normalizeD2Text(term);
  if (!value || !normalizedTerm) return false;
  return value.includes(normalizedTerm) || value.replace(/\s+/gu, "").includes(normalizedTerm.replace(/\s+/gu, ""));
}

function d2InventoryRpmFromText(text, hasWeaponType) {
  const value = normalizeD2Text(text);
  const explicit = /(?:^|[^\d])([1-9][0-9]{1,3})\s*(?:rpm|r\/m|射速|每分钟发射数|每分钟发射|发\/分)/iu.exec(value);
  const explicitValue = d2InventoryRpmValue(explicit?.[1]);
  if (explicitValue) return explicitValue;
  if (!hasWeaponType) return 0;
  const numbers = [...value.matchAll(/(?:^|[^\d])([1-9][0-9]{1,3})(?!\d)/giu)]
    .map((match) => d2InventoryRpmValue(match[1]))
    .filter(Boolean);
  return numbers.length === 1 ? numbers[0] : 0;
}

function d2InventoryRpmValue(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2000 ? number : 0;
}

function stripD2InventoryWeaponTypeTerms(text, weaponType) {
  const alias = D2_INVENTORY_WEAPON_TYPE_ALIASES.find((entry) => entry.canonical === weaponType);
  return (alias?.terms || [weaponType]).reduce((value, term) => {
    const pattern = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/gu, "\\s*");
    return value.replace(new RegExp(pattern, "giu"), " ");
  }, text);
}

function stripD2InventoryRpmTerms(text, rpm) {
  return String(text || "")
    .replace(new RegExp(`${rpm}\\s*(?:rpm|r\\/m|射速|每分钟发射数|每分钟发射|发\\/分)`, "giu"), " ")
    .replace(new RegExp(`${rpm}`, "gu"), " ");
}

function extractInventoryQueryLegacy(text, target) {
  let value = d2InventoryBaseQueryText(text, target);
  return cleanD2InventoryQuery(value);
}

function cleanD2InventoryQuery(value) {
  let cleaned = String(value || "")
    .replace(/^[\/!?#\uFF1F]+|[\/!?#\uFF1F]+$/gu, " ")
    .replace(/[^\p{L}\p{N}#]+/gu, " ");
  const noiseWords = ["\u6240\u6709\u7684", "\u5168\u90e8\u7684", "\u7684\u6240\u6709", "\u7684\u5168\u90e8", "\u6240\u6709", "\u5168\u90e8", "\u5168\u90fd", "\u91cc\u7684", "\u91cc\u9762", "\u91cc", "\u4e2d\u7684", "\u4e2d", "\u6709\u54ea\u4e9b", "\u54ea\u4e9b", "\u6709\u6ca1\u6709", "\u6709\u65e0", "\u4e00\u5171", "\u8bf7\u95ee", "\u8bf7", "\u7ed9\u6211", "\u4e0b", "\u4e00\u4e0b", "\u7684", "\u672f\u58eb", "\u730e\u4eba", "\u6cf0\u5766", "warlock", "hunter", "titan"];
  for (const word of noiseWords) {
    cleaned = cleaned.replace(new RegExp(String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), " ");
  }
  cleaned = cleaned.replace(/\s+/gu, " ").trim();
  if (!/[0-9A-Za-z\u4e00-\u9fff]/u.test(cleaned)) return "";
  return normalizeD2InventorySearchAlias(cleaned);
}

function normalizeD2InventorySearchAlias(value) {
  const compact = String(value || "").replace(/\s+/gu, "").toLowerCase();
  if (!compact) return "";
  const aliases = {"\u5fae\u51b2": "\u51b2\u950b\u67aa", "\u5fae\u51b2\u67aa": "\u51b2\u950b\u67aa", "\u5fae\u578b\u51b2\u950b\u67aa": "\u51b2\u950b\u67aa", "smg": "\u51b2\u950b\u67aa", "submachinegun": "\u51b2\u950b\u67aa", "submachine": "\u51b2\u950b\u67aa", "\u55b7\u5b50": "\u9730\u5f39\u67aa", "\u9730\u5f39": "\u9730\u5f39\u67aa", "shotgun": "\u9730\u5f39\u67aa", "\u7b52\u5b50": "\u706b\u7bad\u53d1\u5c04\u5668", "\u706b\u7bad": "\u706b\u7bad\u53d1\u5c04\u5668", "\u706b\u7bad\u7b52": "\u706b\u7bad\u53d1\u5c04\u5668", "rocket": "\u706b\u7bad\u53d1\u5c04\u5668", "rocketlauncher": "\u706b\u7bad\u53d1\u5c04\u5668", "\u69b4\u5f39": "\u69b4\u5f39\u53d1\u5c04\u5668", "gl": "\u69b4\u5f39\u53d1\u5c04\u5668", "grenadelauncher": "\u69b4\u5f39\u53d1\u5c04\u5668", "\u624b\u70ae": "\u624b\u70ae", "hc": "\u624b\u70ae", "handcannon": "\u624b\u70ae", "\u8109\u51b2": "\u8109\u51b2\u6b65\u67aa", "pulse": "\u8109\u51b2\u6b65\u67aa", "pulserifle": "\u8109\u51b2\u6b65\u67aa", "\u65a5\u5019": "\u65a5\u5019\u6b65\u67aa", "scout": "\u65a5\u5019\u6b65\u67aa", "scoutrifle": "\u65a5\u5019\u6b65\u67aa", "\u81ea\u52a8": "\u81ea\u52a8\u6b65\u67aa", "ar": "\u81ea\u52a8\u6b65\u67aa", "autorifle": "\u81ea\u52a8\u6b65\u67aa", "\u72d9": "\u72d9\u51fb\u6b65\u67aa", "\u72d9\u51fb": "\u72d9\u51fb\u6b65\u67aa", "\u72d9\u51fb\u67aa": "\u72d9\u51fb\u6b65\u67aa", "sniper": "\u72d9\u51fb\u6b65\u67aa", "sniperrifle": "\u72d9\u51fb\u6b65\u67aa", "\u878d\u5408": "\u878d\u5408\u6b65\u67aa", "\u878d\u5408\u67aa": "\u878d\u5408\u6b65\u67aa", "fusion": "\u878d\u5408\u6b65\u67aa", "fusionrifle": "\u878d\u5408\u6b65\u67aa", "\u7ebf\u878d": "\u7ebf\u6027\u878d\u5408\u6b65\u67aa", "\u7ebf\u6027\u878d\u5408": "\u7ebf\u6027\u878d\u5408\u6b65\u67aa", "linear": "\u7ebf\u6027\u878d\u5408\u6b65\u67aa", "linearfusion": "\u7ebf\u6027\u878d\u5408\u6b65\u67aa", "\u673a\u67aa": "\u673a\u67aa", "mg": "\u673a\u67aa", "machinegun": "\u673a\u67aa", "\u5200\u5251": "\u5251", "\u5251": "\u5251", "sword": "\u5251", "\u5f13": "\u5f13", "bow": "\u5f13", "\u624b\u67aa": "\u624b\u67aa", "sidearm": "\u624b\u67aa"};
  return aliases[compact] || value;
}

function d2InventoryView(text) {
  const value = normalizeD2Text(text);
  if (hasAnyD2Word(value, ["\u4ed3\u5e93\u641c\u7d22", "search"])) return "search";
  if (hasAnyD2Word(value, ["\u4ed3\u5e93", "vault"])) return "vault";
  if (hasAnyD2Word(value, ["\u73b0\u6709\u88c5\u5907", "\u8eab\u4e0a\u88c5\u5907", "\u5f53\u524d\u88c5\u5907", "\u6211\u7a7f\u4ec0\u4e48", "\u67e5\u88c5\u5907", "\u88c5\u5907", "equipped"])) return "equipped";
  if (hasAnyD2Word(value, ["\u80cc\u5305"])) return "inventory";
  return "overview";
}

function d2InventoryBucket(text, view) {
  const value = normalizeD2Text(text);
  if (view === "vault") return "vault";
  if (view === "equipped") return "equipped";
  if (view === "inventory") return "inventory";
  if (view === "search" && hasAnyD2Word(value, ["\u4ed3\u5e93", "vault"])) return "vault";
  if (view === "search" && hasAnyD2Word(value, ["\u80cc\u5305"])) return "inventory";
  if (view === "search" && hasAnyD2Word(value, ["\u88c5\u5907", "equipped"])) return "equipped";
  return "all";
}

function d2LoadoutClassName(text) {
  const value = normalizeD2Text(text);
  if (hasAnyD2Word(value, ["\u672f\u58eb", "warlock"])) return "warlock";
  if (hasAnyD2Word(value, ["\u730e\u4eba", "hunter"])) return "hunter";
  if (hasAnyD2Word(value, ["\u6cf0\u5766", "titan"])) return "titan";
  return "";
}

function d2LoadoutTargetStats(text) {
  const value = normalizeD2Text(text);
  const result = {};
  for (const [key, aliases] of D2_LOADOUT_STATS) {
    if (!hasAnyD2Word(value, aliases)) continue;
    result[key] = d2LoadoutTargetValue(value, aliases);
  }
  return result;
}

function d2LoadoutManageParams(text, target) {
  const value = normalizeD2Text(text);
  const operation = d2LoadoutManageOperation(value);
  const params = { target, operation };
  const index = d2LoadoutIndexFromText(value);
  if (index !== undefined) {
    params.loadoutIndex = index;
  }
  const name = operation === "list" ? "" : d2LoadoutNameFromText(value, operation);
  if (name) {
    if (operation === "apply_local" || operation === "delete_local" || operation === "show") {
      params.idOrName = name;
    } else {
      params.name = name;
    }
  }
  if (hasAnyD2Word(value, ["\u8986\u76d6", "overwrite"])) {
    params.overwrite = true;
  }
  return params;
}

function d2DirectFallbackMessage(card, operation, rawMessage) {
  const message = String(rawMessage || "\u547d\u8fd02\u67e5\u8be2\u6ca1\u6709\u8fd4\u56de\u53ef\u53d1\u9001\u5185\u5bb9\u3002");
  if (/https?:\/\/|\u7ed1\u5b9a|\u767b\u5f55|\u7f51\u9875|\u94fe\u63a5/u.test(message)) {
    return message;
  }
  const isLoadoutRead = card === "loadout_manage" && ["list", "show"].includes(String(operation || "list"));
  if (card === "catalyst_info") {
    return `\u6ca1\u6709\u751f\u6210\u50ac\u5316\u6548\u679c\u56fe\u7247\uff1a${message}`;
  }
  if (card === "item_info") {
    return `\u6ca1\u6709\u751f\u6210\u6b66\u5668\u8be6\u60c5\u56fe\u7247\uff1a${message}`;
  }
  if (card === "perk_weapons") {
    return `\u6ca1\u6709\u751f\u6210 Perk \u53cd\u67e5\u56fe\u7247\uff1a${message}`;
  }
  if (card === "catalyst_status") {
    return `\u6ca1\u6709\u751f\u6210\u50ac\u5316\u56fe\u7247\uff1a${message}`;
  }
  return isLoadoutRead
    ? `\u6ca1\u6709\u751f\u6210\u914d\u88c5\u56fe\u7247\uff1a${message}`
    : `\u6ca1\u6709\u751f\u6210\u56fe\u7247\uff1a${message}`;
}

function d2LoadoutManageOperation(text) {
  const value = normalizeD2Text(text);
  if (hasAnyD2Word(value, ["\u6e05\u7a7a", "clear"])) return "clear_bungie";
  if (hasAnyD2Word(value, ["\u4fdd\u5b58\u5230\u6e38\u620f\u5185", "\u4fdd\u5b58\u5230\u7b2c", "snapshot"])) return "snapshot_bungie";
  if (hasAnyD2Word(value, ["\u4fee\u6539\u6e38\u620f\u5185", "\u91cd\u547d\u540d\u6e38\u620f\u5185", "rename"])) return "rename_bungie";
  if (hasAnyD2Word(value, ["\u5220\u9664", "\u5220\u6389", "delete"])) return "delete_local";
  if (hasAnyD2Word(value, ["\u5e94\u7528", "\u5957\u7528", "apply"])) return "apply_local";
  if (hasAnyD2Word(value, ["\u88c5\u5907\u7b2c", "equip loadout"])) return "equip_bungie";
  if (hasAnyD2Word(value, ["\u4fdd\u5b58\u5f53\u524d", "\u4fdd\u5b58\u4e3a", "save loadout"])) return "save_local";
  if (hasAnyD2Word(value, ["\u5957\u88c5\u5217\u8868", "\u914d\u88c5\u5217\u8868", "\u8bfb\u53d6\u914d\u88c5", "\u6e38\u620f\u5185\u914d\u88c5", "\u672c\u5730\u914d\u88c5", "\u4fdd\u5b58\u7684\u914d\u88c5", "\u4fdd\u5b58\u914d\u88c5", "\u5df2\u4fdd\u5b58\u914d\u88c5"])) return "list";
  if (hasAnyD2Word(value, ["\u663e\u793a", "\u67e5\u770b", "show"]) && d2LoadoutNameFromText(value, "show")) return "show";
  return "list";
}

function d2LoadoutIndexFromText(text) {
  const value = normalizeD2Text(text);
  const match = /(?:第|槽|slot\s*)\s*([0-9一二三四五六七八九十]+)/iu.exec(value) || /([0-9一二三四五六七八九十]+)\s*(?:槽|套|slot)/iu.exec(value);
  if (!match) return undefined;
  const number = d2ChineseNumber(match[1]);
  if (!Number.isInteger(number) || number <= 0) return undefined;
  return Math.max(0, Math.min(9, number - 1));
}

function d2ChineseNumber(value) {
  const text = String(value || "").trim();
  if (/^[0-9]+$/u.test(text)) return Number(text);
  const map = { "\u4e00": 1, "\u4e8c": 2, "\u4e09": 3, "\u56db": 4, "\u4e94": 5, "\u516d": 6, "\u4e03": 7, "\u516b": 8, "\u4e5d": 9, "\u5341": 10 };
  if (map[text]) return map[text];
  if (text === "\u5341") return 10;
  return 0;
}

function d2LoadoutNameFromText(text, operation) {
  let value = normalizeD2Text(text);
  const patterns = [
    /保存当前(?:装备|配装)?为\s*([^\s，。,.]+)/u,
    /保存为\s*([^\s，。,.]+)/u,
    /应用\s*([^\s，。,.]+)/u,
    /套用\s*([^\s，。,.]+)/u,
    /删除(?:配装)?\s*([^\s，。,.]+)/u,
    /查看\s*([^\s，。,.]+)/u,
    /show\s+([^\s，。,.]+)/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) {
      return cleanD2LoadoutName(match[1]);
    }
  }
  if (operation === "apply_local" || operation === "delete_local") {
    value = value
      .replace(/^(?:应用|套用|删除|删掉|配装|套装|我的|帮我|请|查|看)+/gu, " ")
      .replace(/(?:配装|套装)$/gu, " ");
    return cleanD2LoadoutName(value);
  }
  return "";
}

function cleanD2LoadoutName(value) {
  return String(value || "")
    .replace(/[\/!?#\uFF1F]+/gu, " ")
    .replace(/^(?:我的|本地|配装|套装|第[0-9一二三四五六七八九十]+套)+/gu, " ")
    .replace(/(?:配装|套装|确认)$/gu, " ")
    .trim();
}

function d2LoadoutMentionedStats(text) {
  const value = normalizeD2Text(text);
  return D2_LOADOUT_STATS
    .filter(([, aliases]) => hasAnyD2Word(value, aliases))
    .map(([key]) => key);
}

function d2LoadoutTargetValue(text, aliases) {
  const value = normalizeD2Text(text);
  for (const alias of aliases) {
    const escaped = String(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`${escaped}\\s*(?:\\+|到|达|达到|要|需要|=|：|:)?\\s*([0-9]{1,3})`, "iu"),
      new RegExp(`([0-9]{1,3})\\s*(?:\\+)?\\s*${escaped}`, "iu"),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(value);
      if (!match) continue;
      const number = Number(match[1]);
      if (Number.isFinite(number)) return Math.max(0, Math.min(200, Math.trunc(number)));
    }
  }
  return 100;
}

function d2DirectMode(text) {
  const value = normalizeD2Text(text);
  if (hasAnyD2Word(value, ["\u8bd5\u70bc", "trials"])) return "trials";
  if (hasAnyD2Word(value, ["pvp", "\u7194\u7089", "crucible"])) return "pvp";
  if (hasAnyD2Word(value, ["\u667a\u8c0b", "gambit"])) return "gambit";
  if (hasAnyD2Word(value, ["\u7a81\u88ad", "raid"])) return "raid";
  if (hasAnyD2Word(value, ["\u5730\u7262", "dungeon"])) return "dungeon";
  return "all";
}

function d2ReplayKey(event) {
  return laneKey(event);
}

function isD2DirectReplayRequest(text) {
  if (D2_COMMANDS?.isReplayRequest?.(text)) return true;
  const value = normalizeD2Text(text);
  if (!value) return false;
  return hasAnyD2Word(value, D2_DIRECT_REPLAY_WORDS);
}

function getRecentD2DirectQuery(event) {
  const key = d2ReplayKey(event);
  const entry = recentD2DirectQueries.get(key);
  if (!entry) return null;
  if (Date.now() - Number(entry.at || 0) > D2_DIRECT_REPLAY_TTL_MS) {
    recentD2DirectQueries.delete(key);
    return null;
  }
  return entry;
}

function rememberD2DirectQuery(event, invocation) {
  if (!invocation || invocation.card === "help") return;
  recentD2DirectQueries.set(d2ReplayKey(event), {
    at: Date.now(),
    card: invocation.card,
    target: invocation.target,
    params: { ...(invocation.params || {}) },
  });
}

function buildD2DirectInvocation(event, text) {
  const gatewayInvocation = D2_COMMANDS?.buildCommandInvocationFromText?.(event, text);
  if (gatewayInvocation) return gatewayInvocation;

  const card = inferD2DirectCard(text);
  if (!card) return null;
  const target = extractD2DirectTarget(text, event, card);
  if (card !== "help" && card !== "catalyst_info" && card !== "item_info" && card !== "perk_weapons" && !target) return null;
  if (card === "catalyst_info") {
    const q = extractD2CatalystInfoQuery(text);
    if (!q) return null;
    return { card, target: "", params: { card, q } };
  }
  if (card === "item_info") {
    const q = extractD2ItemInfoQuery(text);
    if (!q) return null;
    return { card, target: "", params: { card, q } };
  }
  if (card === "perk_weapons") {
    const perkParams = d2PerkWeaponParamsFromText(text);
    if (!perkParams.perks.length) return null;
    return { card, target: "", params: { card, ...perkParams } };
  }
  if (card === "catalyst_status") {
    const q = extractD2CatalystInfoQuery(text);
    if (!q) return null;
    return { card, target, params: { target, card, q } };
  }
  const params = card === "help"
    ? { card }
    : card === "activity"
      ? { card, activityId: target }
      : { target, card, mode: d2DirectMode(text) };
  if (card === "heatmap") {
    params.range = hasAnyD2Word(text, ["\u6700\u8fd1", "recent"]) ? "recent" : "year";
    if (params.range === "year") {
      const year = /\b(20[0-9]{2})\b/u.exec(text);
      params.year = year ? Number(year[1]) : new Date().getFullYear();
    } else {
      params.pages = 2;
    }
  }
  if (card === "raid_overview") {
    const deep = hasAnyD2Word(text, ["\u6df1", "\u5b8c\u6574", "\u8be6\u7ec6"]);
    params.historyPages = deep ? 5 : 2;
    params.pgcrLimit = deep ? 100 : 30;
  }
  if (card === "dungeon_overview") {
    const deep = hasAnyD2Word(text, ["\u6df1", "\u5b8c\u6574", "\u8be6\u7ec6"]);
    params.historyPages = 5;
    params.pgcrLimit = deep ? 100 : 50;
  }
  if (card === "grandmasters") {
    params.historyPages = 5;
    params.pgcrLimit = 30;
  }
  if (card === "inventory") {
    let view = d2InventoryView(text);
    const searchParts = extractInventorySearchParts(text, target);
    const hasStructuredSearch = Boolean(searchParts.q || searchParts.weaponType || searchParts.rpm || searchParts.slot || searchParts.damageType || searchParts.perk);
    if (hasStructuredSearch) {
      view = "search";
    }
    const bucket = d2InventoryBucket(text, view);
    return { card, target, params: { target, ...searchParts, view, bucket } };
  }
  if (card === "loadout_manage") {
    return {
      card,
      target,
      params: d2LoadoutManageParams(text, target),
    };
  }
  if (card === "loadout_optimizer") {
    return {
      card,
      target,
      params: {
        target,
        className: d2LoadoutClassName(text),
        targetStats: d2LoadoutTargetStats(text),
        includeCurrentSubclassFragments: true,
        simulateStatMods: true,
        limit: 3,
      },
    };
  }
  return { card, target, params };
}

async function executeD2DirectInvocation(event, invocation, options = {}) {
  const { card, target } = invocation;
  log("d2-direct-start", event.message_type, event.group_id || event.user_id, event.user_id, card, target || "-", options.replay ? "replay" : "fresh");
  try {
    const config = { baseUrl: "http://192.168.31.11:3011", timeoutMs: 120000, shareUploadToken: process.env.D2_SHARE_UPLOAD_TOKEN || "p4OS4jG5KnA0e0Idtd3dyb2IcsedjmJ9GYdi21lK7MM" };
    const gateway = await importD2CommandGateway();
    const { result, envelope } = await gateway.executeD2CommandInvocation(invocation, config);
    if (envelope?.type === "image" && Array.isArray(envelope.images) && envelope.images.length) {
      fs.mkdirSync(D2_DIRECT_OUT_DIR, { recursive: true });
      const files = [];
      for (let index = 0; index < envelope.images.length; index += 1) {
        const part = envelope.images[index];
        const file = path.join(D2_DIRECT_OUT_DIR, `d2-${card}-${Date.now()}-${index + 1}-${crypto.randomBytes(4).toString("hex")}.png`);
        fs.writeFileSync(file, Buffer.from(String(part.imageBase64), "base64"));
        files.push(file);
        try {
          await sendExistingImageConfirmed(event, file);
          log("d2-direct-image", event.message_type, event.group_id || event.user_id, card, file, `${index + 1}/${envelope.images.length}`, part.bytes || envelope?.meta?.bytes || "-");
        } finally {
          removeTempImageFile(file);
        }
        if (index < envelope.images.length - 1) {
          await sleepMs(1400);
        }
      }
      cleanupD2ResultMedia(result);
      rememberD2DirectQuery(event, invocation);
      return true;
    }
    const rawMessage = envelope?.message || "\u547d\u8fd02\u67e5\u8be2\u6ca1\u6709\u8fd4\u56de\u53ef\u53d1\u9001\u5185\u5bb9\u3002";
    const message = ["share", "bind_link", "confirmation", "text"].includes(String(envelope?.type || ""))
      ? rawMessage
      : d2DirectFallbackMessage(card, invocation.params?.operation, rawMessage);
    cleanupD2ResultMedia(result);
    await sendReply(event, message);
    log("d2-direct-text", event.message_type, event.group_id || event.user_id, card, envelope?.type || "text", JSON.stringify(message).slice(0, 200));
    return true;
  } catch (err) {
    log("d2-direct-error", event.message_type, event.group_id || event.user_id, card, target || "-", err.message, String(err.stack || "").slice(0, 500));
    await sendReply(event, `\u547d\u8fd02\u67e5\u8be2\u5931\u8d25\uff1a${err.message || "\u672a\u77e5\u9519\u8bef"}`);
    return true;
  }
}

async function handleD2DirectRequest(event, text) {
  if (isD2DirectReplayRequest(text)) {
    const replay = getRecentD2DirectQuery(event);
    if (replay) {
      return executeD2DirectInvocation(event, replay, { replay: true });
    }
  }
  const invocation = buildD2DirectInvocation(event, text);
  if (!invocation) return false;
  return executeD2DirectInvocation(event, invocation);
}

async function sendReply(event, reply) {
  const mediaUrls = replyMediaUrls(reply);
  const imagePaths = replyImagePaths(reply);
  const d2CardMediaOnly = mediaUrls.some(isD2CardMediaUrl);
  let message = replyText(reply).trim();
  if ((!message || isNoReplyMarker(message)) && mediaUrls.length === 0 && imagePaths.length === 0) return;

  if (message && !isNoReplyMarker(message) && !d2CardMediaOnly) {
    if (event.message_type === "group") {
      if (!isPrivateStyleGroupMessage(event) && String(event.user_id) !== "1665240495") {
        message = message.split("??").join("???");
      }
      if (!isPrivateStyleGroupMessage(event) && !shouldSendFullGroupReply(message, reply)) {
        message = trimGroupReply(message);
      }
      if (!isNoReplyMarker(message) && message) {
        const data = parseOnebotData(await onebot("send_group_msg", { group_id: event.group_id, message }), "send_group_msg");
        log("sent-group-msg", event.group_id, data?.message_id || "");
      }
    } else if (event.message_type === "private") {
      const data = parseOnebotData(await onebot("send_private_msg", { user_id: event.user_id, message }), "send_private_msg");
      log("sent-private-msg", event.user_id, data?.message_id || "");
    }
  }

  for (const mediaUrl of mediaUrls) {
    await sendMediaReply(event, mediaUrl);
  }
  for (const imagePath of imagePaths) {
    await sendImagePathReply(event, imagePath);
  }
}

async function handleEvent(event) {
  if (event.post_type !== "message") return;
  if (!["private", "group"].includes(event.message_type)) return;
  if (String(event.user_id) === String(event.self_id)) return;
  if (GROUP_SILENT && shouldIgnoreGroupNotMentionedSelf(event) && !isOwnerPrivateStyleGroupMessage(event) && !isContextOnlyPrivateStyleGroupMessage(event)) {
    log("ignored-group-not-mentioned-self", event.group_id || "", event.user_id || "", event.message_id || "", mentionedQqs(event).join(","));
    return;
  }
  if (shouldIgnoreEvent(event)) {
    log("ignored-group-sender", event.group_id || "", event.user_id || "", event.message_id || "");
    return;
  }
  if (shouldIgnoreGroupImage(event) && !isContextOnlyPrivateStyleGroupMessage(event)) {
    log("ignored-group-image", event.group_id || "", event.user_id || "", event.message_id || "");
    return;
  }
  if (shouldIgnoreGroupMentionedOthers(event) && !isContextOnlyPrivateStyleGroupMessage(event)) {
    log("ignored-group-mentioned-others", event.group_id || "", event.user_id || "", event.message_id || "", mentionedQqs(event).join(","));
    return;
  }

  const id = event.message_id || `${event.time}:${event.message_type}:${event.group_id || event.user_id}:${event.user_id}:${event.raw_message || ""}`;
  if (recent.has(id) || active.has(id)) {
    log("dedupe-skip", event.message_type, event.group_id || event.user_id, event.user_id, id);
    return;
  }
  remember(id);
  active.add(id);

  const text = await eventTextFull(event);
  const quoted = await quotedContext(event);
  const agentText = withSenderContext(event, withQuotedContext(text, quoted));
  if (isPureSelfMention(event)) {
    log("group-pure-self-mention", event.group_id || "", event.user_id || "", event.message_id || "");
    await sendReply(event, "在。");
    active.delete(id);
    return;
  }
  if (shouldIgnoreGroupSmallTalk(event, text) && !isOwnerPrivateStyleGroupMessage(event) && !isContextOnlyPrivateStyleGroupMessage(event)) {
    log("ignored-group-smalltalk", event.group_id || "", event.user_id || "", event.message_id || "", JSON.stringify(text).slice(0, 120));
    active.delete(id);
    return;
  }
  if (shouldStopPrivateStyleContextChat(event, text)) {
    log("context-user-stop", event.message_type, event.group_id || event.user_id, event.user_id, event.message_id || "", JSON.stringify(text).slice(0, 160));
    active.delete(id);
    return;
  }
  const sessionKey = event.message_type === "group"
    ? `qq-group-v4-calm-${event.group_id}`
    : privateSessionKey(event.user_id);

  log("inbound", event.message_type, event.group_id || event.user_id, event.user_id, JSON.stringify(agentText).slice(0, 500));
  try {
    if (isContextOnlyPrivateStyleGroupMessage(event)) {
      const reply = await runAgentWithSessionRecovery(sessionKey, buildContextOnlyPrompt(event, agentText), { skipAimemory: true });
      log("context-user-reply", event.message_type, event.group_id || event.user_id, event.user_id, event.message_id || "", JSON.stringify(reply).slice(0, 300));
      await sendReply(event, reply);
      return;
    }
    const existingImage = requestedExistingImage(text);
    if (existingImage) {
      try {
        await sendExistingImageConfirmed(event, existingImage);
      } finally {
        removeTempImageFile(existingImage);
      }
      return;
    }
    if (isImageGenerationRequest(text)) {
      enqueueImageJob(event, text);
      return;
    }
    if (isDeepSeekDelegateRequest(text)) {
      const reply = await runDeepSeekDelegate(event, agentText);
      log("deepseek-reply", event.message_type, event.group_id || event.user_id, JSON.stringify(reply).slice(0, 500));
      await sendReply(event, reply);
      return;
    }
    if (await handleD2DirectRequest(event, text)) {
      return;
    }
    let reply = await runAgentWithSessionRecovery(sessionKey, buildPrompt(event, agentText), { memoryQuery: agentText, skipAimemory: event.message_type !== "private" });
    if (!replyText(reply).trim() && replyMediaUrls(reply).length === 0 && event.message_type === "private") {
      log("empty-private-recover", event.user_id, sessionKey);
      reply = await recoverEmptyPrivateReply(sessionKey);
    }
    log("agent-reply", event.message_type, event.group_id || event.user_id, JSON.stringify(reply).slice(0, 500));
    await sendReply(event, reply);
  } catch (err) {
    log("error", err.message, (err.stderr || err.stdout || "").slice(0, 1000));
  } finally {
    active.delete(id);
  }
}

function laneKey(event) {
  if (event?.message_type === "group") return `group:${event.group_id}`;
  if (event?.message_type === "private") return `private:${event.user_id}`;
  return "system";
}

function queueEvent(event) {
  const key = laneKey(event);
  const prev = lanes.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => handleEvent(event))
    .catch((err) => log("lane-error", key, err.message));
  const tracked = next.finally(() => {
    if (lanes.get(key) === tracked) lanes.delete(key);
  });
  lanes.set(key, tracked);
}

function connect() {
  if (!WebSocket) {
    WebSocket = require("/home/node/Napcat/opt/QQ/resources/app/app_launcher/napcat/node_modules/ws");
  }
  const ws = new WebSocket(ONEBOT_WS, {
    headers: { authorization: `Bearer ${ONEBOT_TOKEN}` },
  });
  ws.on("open", () => {
    reconnectMs = 1000;
    log("connected", ONEBOT_WS);
  });
  ws.on("message", (data) => {
    try {
      const event = JSON.parse(data.toString());
      queueEvent(event);
    } catch (err) {
      log("bad-message", err.message);
    }
  });
  ws.on("error", (err) => log("ws-error", err.message));
  ws.on("close", (code, reason) => {
    log("closed", code, reason.toString());
    setTimeout(connect, reconnectMs);
    reconnectMs = Math.min(reconnectMs * 2, 30000);
  });
}

if (IS_MAIN) {
  connect();
} else {
  module.exports = {
    buildD2DirectInvocation,
    cleanD2InventoryQuery,
    d2InventoryBucket,
    d2InventoryView,
    d2DirectFallbackMessage,
    d2LoadoutManageParams,
    d2LoadoutTargetStats,
    executeD2DirectInvocation,
    extractInventoryQuery,
    handleD2DirectRequest,
    inferD2DirectCard,
    isD2DirectReplayRequest,
    normalizeD2InventorySearchAlias,
    shouldSendFullGroupReply,
    trimGroupReply,
  };
}
