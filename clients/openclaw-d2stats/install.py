#!/usr/bin/env python3
"""Install the Destiny 2 OpenClaw plugin into ~/.openclaw.

All file IO is UTF-8. This plugin has no secrets; it only stores the backend URL
and default query settings in OpenClaw config.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil


DEFAULT_BASE_URL = "http://192.168.31.11:3011"


def copy_plugin(source_dir: Path, install_dir: Path) -> None:
    if install_dir.exists():
        shutil.rmtree(install_dir)
    ignore = shutil.ignore_patterns("node_modules", ".git", "__pycache__", "*.pyc")
    shutil.copytree(source_dir, install_dir, ignore=ignore)


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


def main() -> int:
    parser = argparse.ArgumentParser(description="Install Destiny 2 Stats OpenClaw plugin.")
    parser.add_argument("--openclaw-home", type=Path, default=Path.home() / ".openclaw")
    parser.add_argument("--source-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--install-dir", type=Path)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout-ms", type=int, default=10000)
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
    backup = update_openclaw_config(config_path, args)

    print(f"installed: {install_dir}")
    print(f"config: {config_path}")
    if backup:
        print(f"backup: {backup}")
    print("restart OpenClaw gateway for the plugin to take effect.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
