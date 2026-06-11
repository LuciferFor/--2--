#!/usr/bin/env python3
"""Install the Destiny 2 OpenClaw plugin into ~/.openclaw.

All file IO is UTF-8. This plugin has no secrets; it only stores the backend URL
and default query settings in OpenClaw config.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil


DEFAULT_BASE_URL = "http://192.168.31.11:3011"


def copy_plugin(source_dir: Path, install_dir: Path) -> None:
    if install_dir.exists():
        shutil.rmtree(install_dir)
    ignore = shutil.ignore_patterns("node_modules", ".git", "__pycache__", "*.pyc")
    shutil.copytree(source_dir, install_dir, ignore=ignore)
    harden_permissions(install_dir)
    for executable in (install_dir / "bin").glob("*.mjs"):
        executable.chmod(0o755)


def copy_plugin_skills(source_dir: Path, openclaw_home: Path, skill_id: str = "d2stats") -> Path | None:
    skills_source = source_dir / "plugin-skills" / skill_id
    if not skills_source.exists():
        return None
    install_dir = openclaw_home / "plugin-skills" / skill_id
    if install_dir.exists():
        shutil.rmtree(install_dir)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc")
    shutil.copytree(skills_source, install_dir, ignore=ignore)
    harden_permissions(install_dir)
    return install_dir


def harden_permissions(path: Path) -> None:
    """OpenClaw blocks plugins if the install path is world-writable."""
    if os.name == "nt":
        return
    for child in path.rglob("*"):
        child.chmod(0o755 if child.is_dir() else 0o644)
    path.chmod(0o755)


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def backup_file(path: Path) -> Path | None:
    if not path.exists():
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    backup = path.with_name(f"{path.name}.bak-d2stats-{stamp}")
    shutil.copy2(path, backup)
    return backup


def update_openclaw_config(config_path: Path, args: argparse.Namespace) -> Path | None:
    config = load_json(config_path)
    backup = backup_file(config_path)
    plugins = config.setdefault("plugins", {})
    entries = plugins.setdefault("entries", {})
    entry = entries.setdefault("d2stats", {})
    entry["enabled"] = True
    plugin_config = entry.setdefault("config", {})
    plugin_config.update(
        {
            "enabled": True,
            "baseUrl": args.base_url,
            "timeoutMs": args.timeout_ms,
            "defaultCard": args.default_card,
            "defaultMode": args.default_mode,
            "defaultMembershipType": args.default_membership_type,
            "logging": True,
        }
    )

    allow = plugins.get("allow")
    if isinstance(allow, list) and "d2stats" not in allow:
        allow.append("d2stats")

    write_json(config_path, config)
    return backup


def install_onebot_helpers(source_dir: Path, openclaw_home: Path) -> None:
    tools_dir = openclaw_home / "workspace" / "tools" / "onebot"
    bridge_source = source_dir / "onebot" / "bridge-onebot-openclaw.cjs"
    if bridge_source.exists() and tools_dir.exists():
        bridge_target = tools_dir / "bridge-onebot-openclaw.js"
        backup_file(bridge_target)
        shutil.copy2(bridge_source, bridge_target)
        if os.name != "nt":
            bridge_target.chmod(0o755)
    patch_onebot_sidecar(tools_dir / "openclaw-onebot-sidecar.mjs")


def patch_onebot_sidecar(sidecar_path: Path) -> bool:
    if not sidecar_path.exists():
        return False
    text = sidecar_path.read_text(encoding="utf-8")
    has_existing_d2_hook = "D2_DIRECT_HOOK_START" in text

    top_needle = 'const { ReplyChunkSender, sendOneBotFileToCapturedTarget, sendOneBotMessageToCapturedTarget } = await importFromPlugin("dist/outbound.js");\n'
    hook_top = r'''
const D2_PLUGIN_ROOT = process.env.D2STATS_PLUGIN_ROOT || "/home/node/.openclaw/plugins/d2stats";
const D2_DIRECT_IMAGE_DIR = process.env.D2_DIRECT_IMAGE_DIR || "/tmp/openclaw-d2-direct-cards";
const D2_DIRECT_SHARE_TOKEN = process.env.D2_SHARE_UPLOAD_TOKEN || "p4OS4jG5KnA0e0Idtd3dyb2IcsedjmJ9GYdi21lK7MM";
let d2BridgeModule = null;
let d2CommandGatewayModule = null;
'''

    function_needle = "async function handleOneBotMessage(message) {\n"
    hook_functions = r'''
// D2_DIRECT_HOOK_START
const D2_DIRECT_TERMS = [
  "\u547d\u8fd0", "\u7a81\u88ad", "\u5730\u7262", "\u4ed3\u5e93", "\u5e93\u5b58", "\u80cc\u5305", "\u88c5\u5907",
  "\u8eab\u4e0a", "\u5f53\u524d\u88c5\u5907", "\u50ac\u5316", "\u866b\u72d9", "\u633d\u6b4c", "\u5b97\u5e08", "\u65e5\u843d",
  "\u591c\u5e55", "\u8bd5\u70bc", "\u7194\u7089", "\u70ed\u529b\u56fe", "\u953b\u9020", "\u914d\u88c5", "\u5957\u88c5",
  "\u6b66\u5668", "\u6b66\u5668\u67e5\u8be2", "\u6b66\u5668\u8d44\u6599", "perk", "perks", "\u6765\u6e90", "\u51fa\u5904", "\u600e\u4e48\u83b7\u53d6", "\u54ea\u91cc\u51fa", "\u600e\u4e48\u5f97", "\u5982\u4f55\u83b7\u5f97",
  "d2", "d2help", "d2\u5e2e\u52a9", "\u547d\u8fd02\u5e2e\u52a9", "\u547d\u8fd02\u83dc\u5355",
  "d2bind", "d2\u7ed1\u5b9a", "\u7ed1\u5b9a\u547d\u8fd02", "\u547d\u8fd02\u7ed1\u5b9a", "\u767b\u5f55\u547d\u8fd02", "\u547d\u8fd02\u767b\u5f55", "\u68d2\u9e21\u7ed1\u5b9a", "\u7ed1\u5b9a\u68d2\u9e21"
];

function looksLikeD2DirectText(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  if (/destiny\s*2|\bd2\b|raid|dungeon|catalyst|loadout|pvp/iu.test(value)) return true;
  return D2_DIRECT_TERMS.some((term) => value.includes(term));
}

async function loadD2DirectModules() {
  if (!d2BridgeModule) {
    d2BridgeModule = require(path.join(D2_PLUGIN_ROOT, "onebot", "bridge-onebot-openclaw.cjs"));
  }
  if (!d2CommandGatewayModule) {
    d2CommandGatewayModule = await import(pathToFileURL(path.join(D2_PLUGIN_ROOT, "lib", "command-gateway.mjs")).href);
  }
  return { bridge: d2BridgeModule, gateway: d2CommandGatewayModule };
}

function loadD2StatsConfig() {
  const root = readJson(CONFIG_PATH, {});
  const configured = root?.plugins?.entries?.d2stats?.config || {};
  const merged = {
    enabled: true,
    baseUrl: "http://192.168.31.11:3011",
    timeoutMs: 120000,
    defaultCard: "summary",
    defaultMode: "all",
    defaultMembershipType: 3,
    shareUploadToken: D2_DIRECT_SHARE_TOKEN,
    ...configured,
  };
  merged.timeoutMs = Math.max(Number(merged.timeoutMs || 0), 120000);
  if (!merged.shareUploadToken) merged.shareUploadToken = D2_DIRECT_SHARE_TOKEN;
  return merged;
}

function d2EventFromOneBot(message, target) {
  return {
    message_type: target.kind === "group" ? "group" : "private",
    user_id: Number(message?.user_id || target.id),
    group_id: target.kind === "group" ? Number(target.id) : undefined,
  };
}

async function executeD2DirectTool(invocation, core, config) {
  const card = invocation.card;
  if (card === "inventory") return core.queryInventory(invocation.params, config);
  if (card === "loadout_manage") return core.manageLoadouts(invocation.params, config);
  if (card === "loadout_optimizer") return core.queryLoadoutOptimizer(invocation.params, config);
  return core.queryCard(invocation.params, config);
}

function d2TextParts(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((part) => part?.type === "text" && typeof part.text === "string" && part.text.trim())
    .map((part) => part.text.trim());
}

function d2ImageParts(result) {
  return (Array.isArray(result?.content) ? result.content : []).filter((part) => part?.type === "image" && part.data);
}

function shouldSendRawD2Text(result, text) {
  const kind = result?.details?.kind || result?.details?.status;
  return kind === "share_page" || kind === "oauth_bind_link" || /https?:\/\/\S+/iu.test(String(text || ""));
}

async function sendD2DirectImage(config, target, part, card, index, total) {
  fs.mkdirSync(D2_DIRECT_IMAGE_DIR, { recursive: true });
  const file = path.join(D2_DIRECT_IMAGE_DIR, `d2-${card}-${Date.now()}-${index + 1}-${crypto.randomBytes(4).toString("hex")}.png`);
  fs.writeFileSync(file, Buffer.from(String(part.imageBase64 || part.data || ""), "base64"));
  try {
    const message = [{ type: "image", data: { file: `file://${file}` } }];
    const client = currentClient ?? new OneBotClient(config, logger);
    const messageId = await sendOneBotMessageToCapturedTarget(client, config, target, message, logger);
    logger.info(`d2-direct-image ${target.kind}:${target.id} card=${card} ${index + 1}/${total} message_id=${messageId || "(none)"}`);
    return messageId;
  } finally {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
}

function cleanupD2DirectResultMedia(result) {
  const paths = [];
  const details = result?.details || {};
  if (typeof details.mediaPath === "string") paths.push(details.mediaPath);
  if (details.media && typeof details.media.mediaPath === "string") paths.push(details.media.mediaPath);
  if (Array.isArray(details.media)) {
    for (const item of details.media) {
      if (typeof item?.mediaPath === "string") paths.push(item.mediaPath);
    }
  }
  for (const file of new Set(paths)) {
    if (!file.startsWith("/tmp/openclaw-d2stats-media/")) continue;
    try { fs.rmSync(file, { force: true }); } catch {}
  }
}

async function tryHandleD2Direct(config, target, message, text) {
  if (!looksLikeD2DirectText(text)) return false;
  let modules;
  try {
    modules = await loadD2DirectModules();
  } catch (error) {
    logger.warn(`d2-direct load failed: ${error.message || String(error)}`);
    return false;
  }
  const event = d2EventFromOneBot(message, target);
  const invocation = modules.bridge.buildD2DirectInvocation(event, text);
  if (!invocation) return false;

  logger.info(`d2-direct-start ${target.kind}:${target.id} user=${event.user_id} card=${invocation.card} target=${invocation.target || "-"}`);
  let result;
  try {
    const executed = await modules.gateway.executeD2CommandInvocation(invocation, loadD2StatsConfig());
    result = executed?.result;
    const envelope = executed?.envelope || {};
    const images = envelope.type === "image" && Array.isArray(envelope.images) ? envelope.images : [];
    if (images.length > 0) {
      for (let index = 0; index < images.length; index += 1) {
        await sendD2DirectImage(config, target, images[index], invocation.card, index, images.length);
        if (index < images.length - 1) await sleep(1200);
      }
      cleanupD2DirectResultMedia(result);
      return true;
    }

    const rawText = String(envelope.message || d2TextParts(result).join("\n") || "\u547d\u8fd02\u67e5\u8be2\u6ca1\u6709\u8fd4\u56de\u53ef\u53d1\u9001\u5185\u5bb9\u3002").trim();
    const outgoing = ["share", "bind_link", "confirmation", "text"].includes(String(envelope.type || "")) || shouldSendRawD2Text(result, rawText)
      ? rawText
      : modules.bridge.d2DirectFallbackMessage(invocation.card, invocation.params?.operation, rawText);
    cleanupD2DirectResultMedia(result);
    await sendAssistantText(config, target, outgoing);
    logger.info(`d2-direct-text ${target.kind}:${target.id} card=${invocation.card} ${JSON.stringify(outgoing).slice(0, 220)}`);
    return true;
  } catch (error) {
    cleanupD2DirectResultMedia(result);
    const messageText = `\u547d\u8fd02\u67e5\u8be2\u5931\u8d25\uff1a${error?.message || "\u672a\u77e5\u9519\u8bef"}`;
    await sendAssistantText(config, target, messageText);
    logger.error(`d2-direct-error ${target.kind}:${target.id} card=${invocation.card} ${error?.stack || error?.message || String(error)}`);
    return true;
  }
}
// D2_DIRECT_HOOK_END
'''

    if has_existing_d2_hook:
        if "command-gateway.mjs" in text and "executeD2CommandInvocation" in text and "d2help" in text and "d2bind" in text:
            return False
        start = text.find("// D2_DIRECT_HOOK_START")
        end = text.find("// D2_DIRECT_HOOK_END", start)
        if start < 0 or end < 0:
            return False
        backup_file(sidecar_path)
        end += len("// D2_DIRECT_HOOK_END")
        if "let d2CommandGatewayModule = null;" not in text:
            if "let d2CoreModule = null;" in text:
                text = text.replace("let d2CoreModule = null;", "let d2CommandGatewayModule = null;", 1)
            elif "let d2BridgeModule = null;" in text:
                text = text.replace("let d2BridgeModule = null;", "let d2BridgeModule = null;\nlet d2CommandGatewayModule = null;", 1)
        text = text[:start] + hook_functions.strip("\n") + text[end:]
        sidecar_path.write_text(text, encoding="utf-8")
        return True

    backup_file(sidecar_path)
    handle_old = """  const preparedText = await prepareInboundPromptText(config, decision, message, target);
  queueInboundForDispatch(config, sessionKey, target, { decision, message, preparedText });
}"""
    handle_new = """  const preparedText = await prepareInboundPromptText(config, decision, message, target);
  const directText = String(decision.text || decision.promptText || preparedText || "").trim();
  if (await tryHandleD2Direct(config, target, message, directText)) return;
  queueInboundForDispatch(config, sessionKey, target, { decision, message, preparedText });
}"""

    if top_needle not in text or function_needle not in text or handle_old not in text:
        return False
    text = text.replace(top_needle, top_needle + hook_top, 1)
    text = text.replace(function_needle, hook_functions + "\n" + function_needle, 1)
    text = text.replace(handle_old, handle_new, 1)
    sidecar_path.write_text(text, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Install Destiny 2 Stats OpenClaw plugin.")
    parser.add_argument("--openclaw-home", type=Path, default=Path.home() / ".openclaw")
    parser.add_argument("--source-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--install-dir", type=Path)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout-ms", type=int, default=60000)
    parser.add_argument("--default-card", default="summary")
    parser.add_argument("--default-mode", default="all")
    parser.add_argument("--default-membership-type", type=int, default=3)
    args = parser.parse_args()

    openclaw_home = args.openclaw_home.expanduser().resolve()
    install_dir = (args.install_dir or openclaw_home / "plugins" / "d2stats").expanduser().resolve()
    config_path = (args.config or openclaw_home / "openclaw.json").expanduser().resolve()
    source_dir = args.source_dir.expanduser().resolve()

    if not (source_dir / "openclaw.plugin.json").exists():
        raise SystemExit(f"source-dir is not a d2stats OpenClaw plugin: {source_dir}")

    copy_plugin(source_dir, install_dir)
    skills_dir = copy_plugin_skills(source_dir, openclaw_home)
    backup = update_openclaw_config(config_path, args)
    install_onebot_helpers(source_dir, openclaw_home)

    print(f"installed: {install_dir}")
    if skills_dir:
        print(f"skills: {skills_dir}")
    print(f"config: {config_path}")
    if backup:
        print(f"backup: {backup}")
    print("restart OpenClaw gateway for the plugin to take effect.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
