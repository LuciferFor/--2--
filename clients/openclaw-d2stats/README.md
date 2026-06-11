# OpenClaw Destiny 2 Stats Plugin

Adds OpenClaw tools:

- `destiny2_command`: deterministic command gateway for all Destiny 2 requests. Prefer this tool over the legacy individual tools. It accepts command lines such as `--help`, `/d2help`, `--bind`, `/d2bind`, `--raid`, `--pvp`, `--dungeon`, `--gm`, `--vault`, `--equipped`, `--search --weapon-type 手炮 --rpm 120 --bucket vault`, `--item 极高反射`, `--perk-weapons 爆破专家,斩首武器 --weapon-type 冲锋枪`, `--catalyst 虫狙`, and `--loadouts`.
- `destiny2_card_query`: fetches Destiny 2 JSON data, renders an HTML card inside OpenClaw, then returns it as a PNG image tool result. It supports `help`, `summary`, `career`, `profile`, `namecard`, `pvp`, `weapons`, `crafting`, `catalysts`, `catalyst_status`, `catalyst_info`, `item_info`, `perk_weapons`, `grandmasters`, `raid_overview`, `dungeon_overview`, `heatmap`, `activities`, `latest_activity`, and `activity`.
- `destiny2_bind_qq`: creates a QQ -> Bungie membership binding. If no Bungie target is provided, it returns a 3-minute Bungie OAuth binding link.
- `destiny2_inventory_query`: queries the QQ OAuth owner's inventory/vault/equipped items and returns an image card. It supports `view=vault`, `view=equipped`, `view=inventory`, `view=overview`, and `view=search`.
- `destiny2_item_action`: safely transfers, equips, bulk-equips, locks/unlocks, or equips an in-game loadout after explicit confirmation.
- `destiny2_loadout_optimize`: searches the QQ OAuth owner's armor for DIM-like Armor 3.0 builds. It uses the current stat labels `生命值 / 近战 / 手雷 / 超能 / 职业 / 武器`; old labels such as `韧性` are accepted only as input aliases.
- `destiny2_loadout_apply`: applies an optimizer build after explicit confirmation. It equips armor only and leaves mods/fragments as manual instructions.
- `destiny2_loadout_manage`: reads in-game Loadout slots plus the robot's local saved loadout library, saves current gear locally, snapshots to Bungie slots, equips/clears Bungie slots, and applies/deletes local saved loadouts. Read operations return an image/share page; write operations require explicit confirmation.

Default backend:

```text
http://192.168.31.11:3011
```

Deterministic command gateway:

```bash
d2stats --help
d2stats --bind --sender-qq 1665240495
d2stats --raid --sender-qq 1665240495
d2stats --search --weapon-type 手炮 --rpm 120 --bucket vault --sender-qq 1665240495
d2stats --item 极高反射
d2stats --perk-weapons 爆破专家,斩首武器 --weapon-type 冲锋枪
D2_COMMAND_PORT=3013 d2stats-command
```

In QQ/OpenClaw chat, use `/d2help`, `/d2帮助`, or `命运2帮助` for the Destiny 2 command menu. `/help` is reserved by OpenClaw itself.

The local command service listens on `127.0.0.1:3013` by default and exposes:

- `GET /health`
- `GET /help`
- `GET /help?format=json`
- `POST /execute`

`POST /execute` accepts `{ "senderQq": "1665240495", "commandLine": "--raid" }` and returns a normalized envelope with `type=image|share|text|bind_link|confirmation|error`.

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

It also accepts command aliases such as `/d2help`, `/d2帮助`, `命运2帮助`, `/战绩`, `/生涯`, `/pvp`,
`/raid`, `/地牢`, `/宗师`, `/gm`, `/日落`, `/夜幕`, `/热力图`, `/名片`, `/最近`, `/活动`, `/武器`, `/锻造`, `/催化`, and `/资料`.

Catalyst progress is intentionally QQ OAuth only. Use `card=catalysts` or `/催化`
with a QQ number; direct `BungieName#1234` and `membershipType:membershipId`
targets are rejected because catalyst progress comes from private Bungie
`Records` / `Collectibles` components.
Single-weapon catalyst status is also QQ OAuth only. Use `card=catalyst_status`
with `q=虫狙`/`q=挽歌` or commands like `查询下虫狙的催化`; it returns whether
the catalyst is visible/obtained/completed, current progress, objectives, and
the catalyst effect in an image/share page.
Static exotic catalyst effect lookup is public. Use `card=catalyst_info` with
`q=挽歌`, or natural commands like `查挽歌的催化效果是什么`.

Public weapon/item details are also Manifest-only and do not require OAuth. Use
`card=item_info` or `d2stats --item 极高反射` for `查个武器，极高反射`,
`查极高反射 perk`, or `极高反射怎么获取`. The tool uses local Bungie
Manifest data first; use web search only when the user explicitly asks for
third-party guides or online ratings.

Public Perk -> possible weapon lookup is Manifest-only and does not require
OAuth. Use `card=perk_weapons` or
`d2stats --perk-weapons 爆破专家,斩首武器 --weapon-type 冲锋枪` for
`查爆破专家斩首武器的冲锋枪`, `哪些喷子能出斩首武器`, or
`/perk查询 爆破专家`. Multi-perk lookup is AND: the weapon's roll pool must
contain every requested perk. `查我的爆破专家武器` is different: it asks for
the player's own item copies and should use OAuth inventory search instead.

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

Loadout management is separate from optimization. Use `destiny2_loadout_manage`
for `/套装列表`, `读取我的配装`, `查看配装`, `游戏内配装`, `本地配装`,
`保存当前装备为日落套`, `保存到游戏内第2槽`, `装备第2套`, `应用日落套`,
and `删除日落套`. Read operations must return an image or share page showing
both Bungie in-game Loadout slots and locally saved loadouts; do not summarize
loadout counts in ordinary chat. `保存当前装备为 XX` saves to the local library
by default; only commands that explicitly say `游戏内` or `第 N 槽` write to
Bungie Loadout slots. Applying local saved loadouts only transfers/equips items;
mods, fragments, shaders, ornaments, and subclass setup remain manual.

Card rendering does not call backend `/api/d2/cards/*.png` endpoints. The plugin
uses `/api/d2/profile`, `/summary`, `/career`, `/pvp`, `/raids`,
`/dungeons`, `/grandmasters`, `/heatmap`, `/namecard`, `/activities`, `/pgcr`,
`/weapons`, `/craftables`, `/perk-weapons`, `/catalysts/qq`, `/loadout-optimizer/qq`, `/loadouts/qq`,
and `/saved-loadouts/qq`,
then owns the HTML/CSS layout itself.
