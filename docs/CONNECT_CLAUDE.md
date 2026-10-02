# Connect Claude to Community Intel

The MCP endpoint is `https://<your-app>.vercel.app/api/mcp`. It accepts a secret token in one of two ways:

* as a header, `Authorization: Bearer <token>` (Claude Code, Claude Desktop config, MCP Inspector);
* inside the URL, `https://<your-app>.vercel.app/api/mcp/<token>`, for the **Add custom connector** dialog in the
  Claude apps, which takes only a URL (section 3c).

Tokens live in the `MCP_TOKENS` environment variable as `label:sha256` pairs, so each person or device gets its own
token and any one can be revoked by deleting its entry. A token used inside a URL appears in Vercel's request logs;
give it its own label so it can be revoked without affecting the others.

Every step that changes Vercel settings is yours to perform, after reading it.

---

## 1. Create a token

```bash
node scripts/hash-key.mjs        # prints a new token and its sha256
```

Keep the token safe (a password manager). In Vercel, set `MCP_TOKENS=<label>:<sha256>` (comma-separate several, e.g.
`laptop:<sha>,desktop:<sha>`) for Preview and Production, then redeploy.

## 2. Check the server

```bash
curl -i -X POST https://<your-app>.vercel.app/api/mcp      # expect 401
npx @modelcontextprotocol/inspector --cli --server-url https://<your-app>.vercel.app/api/mcp   --transport http --header "Authorization: Bearer <token>" --method tools/list
```

## 3a. Claude Code

```bash
claude mcp add --transport http community-intel https://<your-app>.vercel.app/api/mcp   --header "Authorization: Bearer <token>"
```

Then run `/mcp` inside Claude Code to confirm `community-intel` is connected.

## 3b. Claude Desktop

Settings → Developer → Edit Config, then add (needs Node installed):

```json
{
  "mcpServers": {
    "community-intel": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-app>.vercel.app/api/mcp",
               "--header", "Authorization: Bearer ${MCP_TOKEN}"],
      "env": { "MCP_TOKEN": "<token>" }
    }
  }
}
```

Restart Claude Desktop; the tools appear under the tools menu.

## 3c. Claude app or claude.ai: "Add custom connector"

Settings → Connectors → **Add custom connector**:

* **Name:** `Community Intel`
* **MCP server URL:** `https://<your-app>.vercel.app/api/mcp/<token>`

Leave everything else empty and click **Continue**. The connector then appears in the chat's tools menu. Treat the
full URL like a password.

## Revoking a token

Remove its `label:sha256` entry from `MCP_TOKENS` in Vercel and redeploy. Other tokens keep working.

---

## 10 questions to try

1. "Which brands do we track, and how fresh is each channel's data?"
2. "How did JOOLA's monthly mention volume trend since May, compared with Selkirk and CRBN?"
3. "What was JOOLA's share of voice each month this summer?"
4. "Compare JOOLA, Selkirk, CRBN and Six Zero over the last 90 days: volume, negative %, crises and top complaint."
5. "What are the top complaints in JOOLA product reviews, and are any of them rising month by month?"
6. "Show me the most-liked negative Instagram comments about JOOLA from the last month."
7. "Were there any unusual weekly spikes in negative sentiment for any brand since July?"
8. "Are more people switching to JOOLA or away from it, and which brands do they come from and go to?"
9. "Which topics are growing fastest for JOOLA on Instagram, and where does JOOLA's share of each topic stand vs competitors?"
10. "Give me weekly negative % for JOOLA vs Selkirk on Reddit since May, and tell me which data caveats apply."
