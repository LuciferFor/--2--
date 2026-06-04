# OpenClaw Destiny 2 Stats Plugin

Adds OpenClaw tools:

- `destiny2_card_query`: fetches Destiny 2 JSON data, renders an HTML card inside OpenClaw, then returns it as a PNG image tool result. It supports `help`, `summary`, `career`, `profile`, `namecard`, `pvp`, `weapons`, `crafting`, `catalysts`, `grandmasters`, `raid_overview`, `dungeon_overview`, `heatmap`, `activities`, `latest_activity`, and `activity`.
- `destiny2_bind_qq`: creates a QQ -> Bungie membership binding. If no Bungie target is provided, it returns a 3-minute Bungie OAuth binding link.
- `destiny2_inventory_query`: queries the QQ OAuth owner's inventory/vault/equipped items and returns an image card.
- `destiny2_item_action`: safely transfers, equips, bulk-equips, locks/unlocks, or equips an in-game loadout after explicit confirmation.

Default backend:

```text
http://192.168.31.11:3011
```

Install on the OpenClaw host:

```bash
cd /path/to/clients/openclaw-d2stats
python3 install.py --base-url http://YOUR_BACKEND_HOST:3011
docker restart openclaw-openclaw-gateway-1
```

The installer copies:

- the plugin to `~/.openclaw/plugins/d2stats`
- the skill instructions to `~/.openclaw/plugin-skills/d2stats/SKILL.md`
- the runtime config into `~/.openclaw/openclaw.json`

The tool accepts QQ numbers, `BungieName#1234`, `membershipType:membershipId`,
or a bare long membership ID using `defaultMembershipType`.

When a QQ number is not bound, `destiny2_card_query` calls the backend OAuth start
endpoint and returns the binding link text instead of asking the user to provide
JSON or backend details.

It also accepts command aliases such as `/帮助`, `/战绩`, `/生涯`, `/pvp`,
`/raid`, `/地牢`, `/宗师`, `/gm`, `/日落`, `/夜幕`, `/热力图`, `/名片`, `/最近`, `/活动`, `/武器`, `/锻造`, `/催化`, and `/资料`.

Catalyst progress is intentionally QQ OAuth only. Use `card=catalysts` or `/催化`
with a QQ number; direct `BungieName#1234` and `membershipType:membershipId`
targets are rejected because catalyst progress comes from private Bungie
`Records` / `Collectibles` components.

Inventory and equipment operations are also QQ OAuth only. Use `/仓库搜索` or
`/库存` first to identify itemInstanceId/characterId, then run `/装备`, `/转移`,
`/锁定`, `/解锁`, or `/套装`; write operations must be confirmed before execution.

Card rendering does not call backend `/api/d2/cards/*.png` endpoints. The plugin
uses `/api/d2/profile`, `/summary`, `/career`, `/pvp`, `/raids`,
`/dungeons`, `/grandmasters`, `/heatmap`, `/namecard`, `/activities`, `/pgcr`, `/weapons`, `/craftables`, and `/catalysts/qq`,
then owns the HTML/CSS layout itself.
