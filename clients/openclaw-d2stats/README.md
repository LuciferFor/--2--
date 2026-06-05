# OpenClaw Destiny 2 Stats Plugin

Adds OpenClaw tools:

- `destiny2_card_query`: fetches Destiny 2 JSON data, renders an HTML card inside OpenClaw, then returns it as a PNG image tool result. It supports `help`, `summary`, `career`, `profile`, `namecard`, `pvp`, `weapons`, `crafting`, `catalysts`, `grandmasters`, `raid_overview`, `dungeon_overview`, `heatmap`, `activities`, `latest_activity`, and `activity`.
- `destiny2_bind_qq`: creates a QQ -> Bungie membership binding. If no Bungie target is provided, it returns a 3-minute Bungie OAuth binding link.
- `destiny2_inventory_query`: queries the QQ OAuth owner's inventory/vault/equipped items and returns an image card. It supports `view=vault`, `view=equipped`, `view=inventory`, `view=overview`, and `view=search`.
- `destiny2_item_action`: safely transfers, equips, bulk-equips, locks/unlocks, or equips an in-game loadout after explicit confirmation.
- `destiny2_loadout_optimize`: searches the QQ OAuth owner's armor for DIM-like Armor 3.0 builds. It uses the current stat labels `生命值 / 近战 / 手雷 / 超能 / 职业 / 武器`; old labels such as `韧性` are accepted only as input aliases.
- `destiny2_loadout_apply`: applies an optimizer build after explicit confirmation. It equips armor only and leaves mods/fragments as manual instructions.

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

Every stat card except the help menu needs a target. For example:

```text
/地牢 1665240495
/raid Lucifer#8571
/战绩 3:4611686018494693796
```

If an OpenClaw adapter exposes the sender QQ separately, pass it as `qq`,
`senderQq`, `userId`, `user_id`, or `target`. A command-only chat message such
as `/raid`, `查下raid`, `/地牢`, or `/生涯` should query the speaker's own
Destiny 2 data by using that sender QQ. In this plugin, `raid` means the
player's raid overview card; it is not weekly featured raid / rotator schedule
information.

When a QQ number is not bound, `destiny2_card_query` calls the backend OAuth start
endpoint and returns the binding link text instead of asking the user to provide
JSON or backend details.

It also accepts command aliases such as `/帮助`, `/战绩`, `/生涯`, `/pvp`,
`/raid`, `/地牢`, `/宗师`, `/gm`, `/日落`, `/夜幕`, `/热力图`, `/名片`, `/最近`, `/活动`, `/武器`, `/锻造`, `/催化`, and `/资料`.

Catalyst progress is intentionally QQ OAuth only. Use `card=catalysts` or `/催化`
with a QQ number; direct `BungieName#1234` and `membershipType:membershipId`
targets are rejected because catalyst progress comes from private Bungie
`Records` / `Collectibles` components.

Inventory and equipment operations are also QQ OAuth only. Use `/仓库` for a full
vault long image, `/装备` or `/当前装备` for the currently equipped gear by
character, `/背包` for carried inventory, and `/仓库搜索` to identify
itemInstanceId/characterId. Natural language searches should pass structured
conditions when possible: `120射速手炮` becomes `weaponType=手炮`, `rpm=120`,
with `q` left empty unless an item name or perk keyword remains. Common aliases
include `微冲`/`SMG` -> `冲锋枪`, `喷子` -> `霰弹枪`, `筒子` -> `火箭发射器`,
and `HC`/`hand cannon` -> `手炮`.
Write operations such as `/转移`, `/锁定`, `/解锁`, `/套装`, or equipping a
specific item must be confirmed before execution.

Loadout optimization is QQ OAuth only. Use `/配装`, `三百套`, or natural language
such as `生命值手雷武器有没有套装`. If the class is missing, ask for `术士`,
`猎人`, or `泰坦`; if the target stats are missing, ask which Armor 3.0 stats and
values to target. Then call `destiny2_loadout_optimize` with the same sender QQ.
The tool displays only the current Armor 3.0 names `生命值 / 近战 / 手雷 / 超能 / 职业 / 武器`;
legacy terms such as `机动 / 韧性 / 恢复 / 纪律 / 智慧 / 力量` remain input aliases.
Applying a result requires the returned `sessionId` + `buildId` and explicit
confirmation, and only equips the recommended armor.

Card rendering does not call backend `/api/d2/cards/*.png` endpoints. The plugin
uses `/api/d2/profile`, `/summary`, `/career`, `/pvp`, `/raids`,
`/dungeons`, `/grandmasters`, `/heatmap`, `/namecard`, `/activities`, `/pgcr`, `/weapons`, `/craftables`, `/catalysts/qq`, and `/loadout-optimizer/qq`,
then owns the HTML/CSS layout itself.
