# Destiny 2 Stats OpenClaw Skill

Use this skill when a user asks to query Destiny 2 stats, cards, QQ bindings, raid, dungeon, Grandmaster, PvP, career, heatmap, crafting pattern, or catalyst progress.

## Tool To Use

Prefer `destiny2_card_query` for all read-only Destiny 2 queries. It returns an image card rendered from backend JSON.

Use `destiny2_bind_qq` only when the user explicitly wants to bind a QQ number to a Bungie account, or when they ask for a binding link.

## Targets

Accept these target formats:

- QQ number, such as `607972716`.
- Bungie name, such as `Lucifer#8571`.
- Stable membership id, such as `3:4611686018494693796`.
- Bare long membership id; assume membership type `3` unless the tool config says otherwise.

If the user gives a QQ number and it is already bound, query directly. If it is not bound, return the 3-minute Bungie OAuth binding link from the tool result and include the Tencent warning text exactly as returned.

## Command Mapping

Map common Chinese commands to `destiny2_card_query`:

- `/帮助`, `菜单`: `card=help`, no target required.
- `/战绩`, `总览`: `card=summary`.
- `/生涯`: `card=career`.
- `/名片`: `card=namecard`.
- `/pvp`, `/试炼`, `/熔炉`: `card=pvp`.
- `/raid`, `/突袭`: `card=raid_overview`.
- `/地牢`, `/dungeon`: `card=dungeon_overview`.
- `/宗师`, `/gm`, `/日落`, `/夜幕`: `card=grandmasters`.
- `/热力图`, `/活跃`: `card=heatmap`.
- `/锻造`, `/图纸`: `card=crafting`.
- `/催化`: `card=catalysts`; only use QQ targets because catalyst progress requires OAuth.
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
- Do not claim Bungie returns these images. The backend returns JSON and OpenClaw renders the image card.
- If a query fails because the Bungie API key or backend is broken, say the backend/Bungie API is unavailable and avoid inventing stats.
