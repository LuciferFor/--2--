# OpenClaw Destiny 2 Stats Plugin

Adds two OpenClaw tools:

- `destiny2_card_query`: fetches public Destiny 2 JSON data, renders an HTML card inside OpenClaw, then returns it as a PNG image tool result.
- `destiny2_bind_qq`: creates a public QQ -> Bungie membership binding.

Default backend:

```text
http://192.168.31.11:3011
```

Install on the OpenClaw host:

```bash
cd /path/to/clients/openclaw-d2stats
python3 install.py
docker restart openclaw-openclaw-gateway-1
```

The tool accepts QQ numbers, `BungieName#1234`, `membershipType:membershipId`,
or a bare long membership ID using `defaultMembershipType`.

Card rendering does not call backend `/api/d2/cards/*.png` endpoints. The plugin
uses `/api/d2/profile`, `/summary`, `/raids`, `/activities`, `/pgcr`, and
`/weapons`, then owns the HTML/CSS layout itself.
