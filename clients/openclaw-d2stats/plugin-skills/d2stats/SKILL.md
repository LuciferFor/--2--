# Destiny 2 Stats OpenClaw Skill

Use this skill when a user asks to query Destiny 2 stats, cards, QQ bindings, raid, dungeon, Grandmaster, PvP, career, heatmap, crafting pattern, catalyst progress, or OAuth-protected inventory/equipment management.

## Tool To Use

Prefer `destiny2_card_query` for all read-only Destiny 2 queries. It returns an image card rendered from backend JSON.

Use `destiny2_bind_qq` only when the user explicitly wants to bind a QQ number to a Bungie account, or when they ask for a binding link.

Use `destiny2_inventory_query` for `/仓库`, `/仓库搜索`, `/库存`, `/背包`, `/装备`, `/现有装备`, `/身上装备`, `/当前装备`, or when the user needs itemInstanceId/characterId before an equipment operation. It accepts QQ targets or the sender QQ in `qq`, and returns an image card. Use `view=vault` for full vault, `view=equipped` for currently equipped gear, `view=inventory` for carried inventory, and `view=search` for item searches.

Use `destiny2_item_action` for actual write operations such as `/转移`, `/锁定`, `/解锁`, `/套装`, or a clear request to equip/move a specific item. It only accepts QQ targets. Always call it once without `confirm=true` to produce the confirmation text, and only call again with `confirm=true` after the user explicitly confirms.

## Targets

Accept these target formats:

- QQ number, such as `607972716`.
- Bungie name, such as `Lucifer#8571`.
- Stable membership id, such as `3:4611686018494693796`.
- Bare long membership id; assume membership type `3` unless the tool config says otherwise.

If the user gives a QQ number and it is already bound, query directly. If it is not bound, return the 3-minute Bungie OAuth binding link from the tool result and include the Tencent warning text exactly as returned.

For every stat query except `/帮助`, always pass a target to the tool. A command alone such as `/raid`, `查下raid`, `/地牢`, `/宗师`, `/pvp`, `/生涯`, `/热力图`, `/锻造`, or `/催化` means "query the speaker's own Destiny 2 data" when the OpenClaw runtime exposes the sender QQ. Pass the sender QQ as `target`, `qq`, `senderQq`, `userId`, or `user_id`. If no sender QQ is available, ask the user to send a command like `/地牢 1665240495`.

Do not reinterpret `/raid`, `查下raid`, `查 raid`, or `突袭` as weekly featured raid / raid rotator / schedule information. In this skill those words mean the player's raid overview card. If the speaker QQ is unbound, call the tool with that QQ so it returns the Bungie OAuth binding link.

## Login / OAuth Behavior

- If the user says `查我`, `我的`, `绑定命运2`, or asks for any Destiny 2 query and the sender QQ is available, use that QQ as `target`, `qq`, `senderQq`, `userId`, or `user_id`.
- If OpenClaw exposes the sender QQ as a separate field, pass it as `qq` or `target`; do not call `destiny2_card_query` with only `command=/地牢`, `command=/raid`, `command=查下raid`, etc.
- If a QQ target is not bound, or the bound QQ has not completed Bungie OAuth login for an OAuth-only feature, return the 3-minute Bungie OAuth binding/login link from the tool result. Do not ask the user to manually provide a Bungie ID first.
- For OAuth-only features (`/催化`, `/仓库`, `/仓库搜索`, `/库存`, `/背包`, `/装备`, `/现有装备`, `/身上装备`, `/当前装备`, `/转移`, `/锁定`, `/解锁`, `/套装`), do not ask for BungieName or membershipId as a fallback. Tell the user to finish the QQ Bungie login link.
- If the sender QQ is not available and the user says `查我`, ask for their QQ number.

## Command Mapping

Map common Chinese commands to `destiny2_card_query`:

- `/帮助`, `菜单`: `card=help`, no target required.
- `/战绩`, `总览`: `card=summary`.
- `/生涯`: `card=career`.
- `/名片`: `card=namecard`.
- `/pvp`, `/试炼`, `/熔炉`: `card=pvp`.
- `/raid`, `查下raid`, `查 raid`, `/突袭`: `card=raid_overview`; default target is the speaker QQ, never the weekly raid rotator.
- `/地牢`, `/dungeon`: `card=dungeon_overview`.
- `/宗师`, `/gm`, `/日落`, `/夜幕`: `card=grandmasters`.
- `/热力图`, `/活跃`: `card=heatmap`.
- `/锻造`, `/图纸`: `card=crafting`.
- `/催化`: `card=catalysts`; only use QQ targets because catalyst progress requires OAuth.
- `/仓库`, `查仓库`: use `destiny2_inventory_query` with `view=vault` and `bucket=vault`; only use QQ targets. Large vaults are automatically split into multiple images to avoid QQ/NapCat rich-media upload failures.
- `/装备`, `/现有装备`, `/身上装备`, `/当前装备`, `我穿什么`: use `destiny2_inventory_query` with `view=equipped` and `bucket=equipped`; only use QQ targets.
- `/库存`: use `destiny2_inventory_query` with `view=overview` and `bucket=all`; only use QQ targets.
- `/背包`: use `destiny2_inventory_query` with `view=inventory` and `bucket=inventory`; only use QQ targets.
- `/仓库搜索`, `查仓库所有 XX`, `仓库里有哪些 XX`: use `destiny2_inventory_query` with `view=search`; if the user says warehouse/vault, pass `bucket=vault`. Pass only the cleaned item name or type as `q`; strip structural words such as `的`, `所有`, `全部`, `里`, `有哪些`, `有没有`. Normalize common aliases before calling: `微冲`/`SMG` -> `冲锋枪`, `喷子` -> `霰弹枪`, `筒子` -> `火箭发射器`.
- `/转移`, `/锁定`, `/解锁`, `/套装`, or an explicit "equip this item" request: use `destiny2_item_action`; only use QQ targets and require explicit confirmation before execution.
- `/武器`: `card=weapons`.
- `/最近`, `/活动`, `/战绩列表`: `card=activities`.
- `/单局`, `PGCR`: `card=activity` and pass `activityId`.

## Defaults

- Use `mode=all` unless the user clearly asks for raid, dungeon, trials, PvP, gambit, or another mode.
- For raid and dungeon overview, prefer default scan settings unless the user asks for faster or deeper scan.
- For Grandmaster, default `season=current`.
- For heatmap, default `range=all` and `timezone=Asia/Shanghai`.
- Do not expose backend JSON to normal users. Return the image or the concise text error from the tool.

## Safety

- Catalyst progress is private-ish OAuth data. Only query catalysts by QQ number that owns the OAuth binding.
- Do not query catalyst progress by arbitrary BungieName or membership id.
- Inventory, vault, equipment, lock state, and loadout actions are private OAuth capabilities. Only use them for the QQ owner; never use BungieName or membershipId for these tools.
- Never execute `destiny2_item_action` with `confirm=true` unless the user has just explicitly confirmed the operation. If the user gave only an item name, first run `destiny2_inventory_query` to show candidate items and ask which itemInstanceId to use.
- Do not offer dismantle/delete/mod/socket operations; this skill intentionally supports only safe DIM-like operations.
- Do not claim Bungie returns these images. The backend returns JSON and OpenClaw renders the image card.
- If a query fails because the Bungie API key or backend is broken, say the backend/Bungie API is unavailable and avoid inventing stats.
