# Destiny 2 Stats OpenClaw Skill

Use this skill when a user asks to query Destiny 2 stats, cards, QQ bindings, raid, dungeon, Grandmaster, PvP, career, heatmap, crafting pattern, catalyst progress, OAuth-protected inventory/equipment management, DIM-like loadout optimization, or reading/saving/equipping Destiny 2 loadouts.

## Tool To Use

Prefer `destiny2_command` for every Destiny 2 request. It is the deterministic command gateway and accepts a single `commandLine` such as `--help`, `/d2help`, `--bind`, `/d2bind`, `--raid`, `--pvp`, `--dungeon`, `--gm`, `--vault`, `--equipped`, `--search --weapon-type 手炮 --rpm 120 --bucket vault`, `--item 极高反射`, `--perk-weapons 爆破专家,斩首武器 --weapon-type 冲锋枪`, `--catalyst 虫狙`, `--catalyst-info 挽歌`, `--loadouts`, or `--optimize --class warlock --stat 生命值=100 --stat 手雷=100`. Pass the speaker QQ as `senderQq` whenever the command line does not contain an explicit target.

For Destiny 2 weapon/item/perk/source/getting questions, use the D2 tool first. Do not browse the web or summarize third-party sites unless the user explicitly asks for online guides, third-party ratings, or web search.

The tools below are legacy compatibility tools. Use them only if `destiny2_command` is unavailable or if a caller explicitly asks for that specific tool.

Use `destiny2_card_query` for read-only Destiny 2 queries only as a legacy fallback. It returns an image card rendered from backend JSON.

Use `destiny2_bind_qq` only when the user explicitly wants to bind a QQ number to a Bungie account, or when they ask for a binding link.

Use `destiny2_inventory_query` for `/仓库`, `/仓库搜索`, `/库存`, `/背包`, `/装备`, `/现有装备`, `/身上装备`, `/当前装备`, or when the user needs itemInstanceId/characterId before an equipment operation. It accepts QQ targets or the sender QQ in `qq`, and returns an image card. Use `view=vault` for full vault, `view=equipped` for currently equipped gear, `view=inventory` for carried inventory, and `view=search` for item searches.

Use `destiny2_item_action` for actual write operations such as `/转移`, `/锁定`, `/解锁`, `/套装`, or a clear request to equip/move a specific item. It only accepts QQ targets. Always call it once without `confirm=true` to produce the confirmation text, and only call again with `confirm=true` after the user explicitly confirms.

Use `destiny2_loadout_optimize` for `/配装`, `三百套`, `生命值手雷武器有没有套装`, or DIM-like Armor 3.0 set questions. It only accepts QQ OAuth targets. If the user did not specify a class, call the tool with the sender QQ and no `className`; it will ask for `术士/猎人/泰坦`. If the user did not specify target stats, let the tool ask which Armor 3.0 stats to target. Do not invent the old recovery/discipline/strength default.

Use `destiny2_loadout_apply` only after a loadout optimizer result and an explicit confirmation such as `确认应用第 1 套`. It only equips armor from the same sender QQ's optimizer session; it does not change mods, sockets, subclass, or fragments.

Use `destiny2_loadout_manage` for reading, saving, equipping, clearing, or deleting loadouts: `/套装列表`, `读取我的配装`, `查看配装`, `游戏内配装`, `本地配装`, `保存当前装备为日落套`, `保存到游戏内第2槽`, `装备第2套`, `应用日落套`, or `删除日落套`. It only accepts QQ OAuth targets. Read operations (`list`/`show`) must return an image or share page; never summarize the counts in ordinary chat. Write operations must be called first without `confirm=true` to show confirmation, and only called again with `confirm=true` after explicit user confirmation.

## Targets

Accept these target formats:

- QQ number, such as `607972716`.
- Bungie name, such as `Lucifer#8571`.
- Stable membership id, such as `3:4611686018494693796`.
- Bare long membership id; assume membership type `3` unless the tool config says otherwise.

If the user gives a QQ number and it is already bound, query directly. If it is not bound, return the 3-minute Bungie OAuth binding link from the tool result and include the Tencent warning text exactly as returned.

For every stat query except `/d2help`/`命运2帮助` and explicitly public catalyst-effect lookup, always pass a target to the tool. A command alone such as `/raid`, `查下raid`, `/地牢`, `/宗师`, `/pvp`, `/生涯`, `/热力图`, `/锻造`, or `/催化` means "query the speaker's own Destiny 2 data" when the OpenClaw runtime exposes the sender QQ. Pass the sender QQ as `target`, `qq`, `senderQq`, `userId`, or `user_id`. If no sender QQ is available, ask the user to send a command like `/地牢 1665240495`.

Do not reinterpret `/raid`, `查下raid`, `查 raid`, or `突袭` as weekly featured raid / raid rotator / schedule information. In this skill those words mean the player's raid overview card. If the speaker QQ is unbound, call the tool with that QQ so it returns the Bungie OAuth binding link.

## Login / OAuth Behavior

- If the user says `查我`, `我的`, `绑定命运2`, or asks for any Destiny 2 query and the sender QQ is available, use that QQ as `target`, `qq`, `senderQq`, `userId`, or `user_id`.
- If OpenClaw exposes the sender QQ as a separate field, pass it as `qq` or `target`; do not call `destiny2_card_query` with only `command=/地牢`, `command=/raid`, `command=查下raid`, etc.
- If a QQ target is not bound, or the bound QQ has not completed Bungie OAuth login for an OAuth-only feature, return the 3-minute Bungie OAuth binding/login link from the tool result. Do not ask the user to manually provide a Bungie ID first.
- For OAuth-only features (`/催化`, `/仓库`, `/仓库搜索`, `/库存`, `/背包`, `/装备`, `/现有装备`, `/身上装备`, `/当前装备`, `/配装`, `三百套`, `/套装列表`, `读取配装`, `保存当前装备`, `应用配装`, `/转移`, `/锁定`, `/解锁`, `/套装`), do not ask for BungieName or membershipId as a fallback. Tell the user to finish the QQ Bungie login link.
- If the sender QQ is not available and the user says `查我`, ask for their QQ number.

## Command Mapping

Preferred mapping is now command-line based:

- `/d2help`, `/d2帮助`, `命运2帮助`, `d2菜单`: `destiny2_command` with `commandLine="--help"`.
- `/d2bind`, `/d2绑定`, `/绑定命运2`, `绑定棒鸡`: `--bind`; pass the speaker QQ as `senderQq` and return the 3-minute OAuth binding link directly.
- `/战绩`, `总览`: `--summary`.
- `/生涯`: `--career`.
- `/名片`: `--namecard`.
- `/pvp`, `/试炼`, `/熔炉`: `--pvp`.
- `/raid`, `查下raid`, `突袭`: `--raid`; default target is the speaker QQ, never weekly rotator info.
- `/地牢`, `/dungeon`: `--dungeon`.
- `/宗师`, `/gm`, `/日落`, `/夜幕`: `--gm`.
- `/热力图`, `/活跃`: `--heatmap`.
- `/锻造`, `/图纸`: `--crafting`.
- `/催化`, `查我的催化`: `--catalysts`.
- `查询下虫狙的催化`: `--catalyst 虫狙`.
- `查挽歌的催化效果`: `--catalyst-info 挽歌`.
- `查个武器，极高反射`, `查极高反射 perk`, `极高反射怎么获取`: `--item 极高反射`; this is public Bungie Manifest item data and does not require OAuth.
- `查爆破专家斩首武器的冲锋枪`, `哪些喷子能出斩首武器`, `/perk查询 爆破专家`: `--perk-weapons 爆破专家,斩首武器 --weapon-type 冲锋枪` or `--perk-weapons 斩首武器 --weapon-type 霰弹枪`; this is public Manifest roll-pool data and does not require OAuth. Multi-perk lookup uses AND.
- `查我的极高反射`, `仓库里的极高反射`: use inventory search (`--search 极高反射` plus `--bucket vault` when warehouse/vault is mentioned), because the user is asking about their own item copies.
- `查我的爆破专家武器`, `仓库里的斩首武器`: use inventory search, because the user is asking about their own rolled item copies, not all Manifest weapons that can roll the perk.
- `/仓库`: `--vault`.
- `/装备`, `/现有装备`, `/身上装备`, `/当前装备`: `--equipped`.
- `/背包`: `--inventory`.
- `查仓库所有微冲`: `--search --weapon-type 冲锋枪 --bucket vault`.
- `查仓库里的120射速手炮`: `--search --weapon-type 手炮 --rpm 120 --bucket vault`.
- `/配装`: `--optimize`; add `--class` and repeated `--stat 名称=数值` when known.
- `/套装列表`, `读取我的配装`: `--loadouts`.

Read commands must return an image or share page. OAuth-only commands return the short Bungie binding link when the QQ is not ready. Do not summarize "查到了" in ordinary chat when a command result lacks image/share output.

Legacy mapping to individual tools, only when `destiny2_command` is unavailable:

- `/d2help`, `/d2帮助`, `命运2帮助`, `d2菜单`: `card=help`, no target required.
- `/战绩`, `总览`: `card=summary`.
- `/生涯`: `card=career`.
- `/名片`: `card=namecard`.
- `/pvp`, `/试炼`, `/熔炉`: `card=pvp`.
- `/raid`, `查下raid`, `查 raid`, `/突袭`: `card=raid_overview`; default target is the speaker QQ, never the weekly raid rotator.
- `/地牢`, `/dungeon`: `card=dungeon_overview`.
- `/宗师`, `/gm`, `/日落`, `/夜幕`: `card=grandmasters`.
- `/热力图`, `/活跃`: `card=heatmap`.
- `/锻造`, `/图纸`: `card=crafting`.
- `/催化`, `查我的催化`, `查我的催化进度`: `card=catalysts`; only use QQ targets because catalyst progress requires OAuth.
- `查询下虫狙的催化`, `查挽歌催化`, `我的挽歌催化进度`: `card=catalyst_status` with the sender QQ as target and `q` set to the weapon name. This must return an image/share page showing whether the catalyst is visible/obtained/completed, current progress, objectives, and effect.
- `查挽歌的催化效果`, `挽歌催化是什么`: `card=catalyst_info` with `q` set to the weapon name; no target or OAuth is required because this is static public Manifest data. Only use this route when the user clearly asks for static effect/description and not their own status/progress/obtained state.
- `查个武器，极高反射`, `查极高反射 perk`, `极高反射来源`, `极高反射怎么获取`: `card=item_info` with `q` set to the item/weapon name; no target or OAuth is required because this is public Bungie Manifest data. Return an image/share page, not ordinary chat text.
- `查爆破专家斩首武器的冲锋枪`, `哪些霰弹枪能出爆破专家`, `/perk查询 爆破专家`: `card=perk_weapons` with `perks=["爆破专家", "斩首武器"]` and optional `weaponType`, `rpm`, `craftable`, `slot`, or `damageType`; no target or OAuth is required because this is public Bungie Manifest roll-pool data. Return an image/share page, not ordinary chat text.
- `/仓库`, `查仓库`: use `destiny2_inventory_query` with `view=vault` and `bucket=vault`; only use QQ targets. Large vaults are automatically split into multiple images to avoid QQ/NapCat rich-media upload failures.
- `/装备`, `/现有装备`, `/身上装备`, `/当前装备`, `我穿什么`: use `destiny2_inventory_query` with `view=equipped` and `bucket=equipped`; only use QQ targets.
- `/库存`: use `destiny2_inventory_query` with `view=overview` and `bucket=all`; only use QQ targets.
- `/背包`: use `destiny2_inventory_query` with `view=inventory` and `bucket=inventory`; only use QQ targets.
- `/仓库搜索`, `查仓库所有 XX`, `仓库里有哪些 XX`: use `destiny2_inventory_query` with `view=search`; if the user says warehouse/vault, pass `bucket=vault`. Prefer structured filters over stuffing the whole phrase into `q`: `120射速手炮`, `120rpm hc`, or `120 手炮` means `weaponType=手炮`, `rpm=120`, and `q=""`. Use `q` only for leftover item names or perk keywords. Normalize common aliases before calling: `微冲`/`SMG` -> `冲锋枪`, `喷子` -> `霰弹枪`, `筒子` -> `火箭发射器`, `HC`/`hand cannon` -> `手炮`.
- `/配装`, `三百套`, `生命值手雷武器有没有套装`: use `destiny2_loadout_optimize`; only use QQ targets. If class is missing, let the tool ask which class. If target stats are missing, let the tool ask for the Armor 3.0 stats and values. If the user says `术士/猎人/泰坦` after that, call again with the same sender QQ and `className`. Use current stat names `生命值 / 近战 / 手雷 / 超能 / 职业 / 武器`; accept old names only as aliases.
- `应用第 1 套`, `换上第 2 套`: use `destiny2_loadout_apply` only with the same sender QQ's recent `sessionId` and `buildId`; first ask/confirm unless the user has explicitly confirmed. Do not apply another user's session in group chat.
- `/套装列表`, `读取我的配装`, `查看配装`, `游戏内配装`, `本地配装`, `保存的配装`: use `destiny2_loadout_manage` with `operation=list`; this must return an image/share page showing Bungie game slots and local saved loadouts. If the tool fails to return an image/share page, report the tool error instead of saying it was sent.
- `保存当前装备为 XX`: use `destiny2_loadout_manage` with `operation=save_local`, `name=XX`; this saves to the robot local library by default and requires confirmation.
- `保存到游戏内第 N 槽`: use `destiny2_loadout_manage` with `operation=snapshot_bungie`, `loadoutIndex=N-1`, and `characterId` if known; if the tool asks for a characterId, first show/read loadouts or inventory so the user can choose.
- `装备第 N 套`: use `destiny2_loadout_manage` with `operation=equip_bungie`, `loadoutIndex=N-1`, and require confirmation. This refers to Bungie in-game Loadout slots.
- `应用 XX` or `套用 XX`: use `destiny2_loadout_manage` with `operation=apply_local`, `idOrName=XX`, and require confirmation. This refers to the robot local saved loadout library.
- `删除 XX`: use `destiny2_loadout_manage` with `operation=delete_local`, `idOrName=XX`, and require confirmation.
- `/转移`, `/锁定`, `/解锁`, `/套装`, or an explicit "equip this item" request: use `destiny2_item_action`; only use QQ targets and require explicit confirmation before execution.
- `/武器`: `card=weapons`.
- `查个武器 XX`, `XX perk`, `XX 来源`, `XX 怎么获取`: `card=item_info` with `q=XX`.
- `/最近`, `/活动`, `/战绩列表`: `card=activities`.
- `/单局`, `PGCR`: `card=activity` and pass `activityId`.

## Defaults

- Use `mode=all` unless the user clearly asks for raid, dungeon, trials, PvP, gambit, or another mode.
- For raid and dungeon overview, prefer default scan settings unless the user asks for faster or deeper scan.
- For Grandmaster, default `season=all` for "宗师总览/查宗师"; only use `season=current` when the user explicitly asks for the current season.
- For heatmap, default `range=all` and `timezone=Asia/Shanghai`.
- Do not expose backend JSON to normal users. Return the image or the concise text error from the tool.

## Safety

- Catalyst progress is private-ish OAuth data. Only query catalysts by QQ number that owns the OAuth binding.
- Do not query catalyst progress by arbitrary BungieName or membership id.
- Single-weapon catalyst status is also QQ OAuth data. Use `card=catalyst_status` for "某武器的催化" by default and return an image/share page, not a plain text summary.
- Static catalyst effect lookup is public Manifest data. Use `card=catalyst_info` only for explicit effect/description questions and return an image/share page, not a plain text summary.
- Public weapon/item/source lookup is public Manifest data. Use `destiny2_command --item <name>` or `card=item_info` before web search.
- Public Perk -> possible weapon lookup is also public Manifest data. Use `destiny2_command --perk-weapons <perk[,perk]>` or `card=perk_weapons` before web search. If the user says `我的/仓库/背包/身上`, use OAuth inventory search instead.
- Only use external web search when the user explicitly requests online guides, third-party ratings, or web pages.
- Inventory, vault, equipment, lock state, and loadout actions are private OAuth capabilities. Only use them for the QQ owner; never use BungieName or membershipId for these tools.
- Loadout optimization and apply are private OAuth capabilities. The search result can be shown to the QQ owner; the apply step must use that same QQ's session and explicit confirmation.
- Loadout management is also QQ OAuth only. `读取配装`/`查看配装`/`游戏内配装` must use `destiny2_loadout_manage`, not ordinary chat. Reading must be shown as an image or share page, never as a plain text summary. Local saved loadout apply only transfers/equips items; mods, fragments, shaders, ornaments, subclass, and cosmetic setup stay manual.
- Never execute `destiny2_item_action` with `confirm=true` unless the user has just explicitly confirmed the operation. If the user gave only an item name, first run `destiny2_inventory_query` to show candidate items and ask which itemInstanceId to use.
- Never execute `destiny2_loadout_apply` with `confirm=true` unless the user has just explicitly confirmed the optimizer build. It equips armor only; tell the user to manually apply the listed stat mods and fragments.
- Never execute `destiny2_loadout_manage` write operations with `confirm=true` unless the user has just explicitly confirmed the exact save/equip/apply/delete operation.
- Do not offer dismantle/delete/mod/socket operations; this skill intentionally supports only safe DIM-like operations.
- Do not claim Bungie returns these images. The backend returns JSON and OpenClaw renders the image card.
- If a query fails because the Bungie API key or backend is broken, say the backend/Bungie API is unavailable and avoid inventing stats.
