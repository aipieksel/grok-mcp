# grok-mcp

Maintained by [aipieksel](https://github.com/aipieksel). Upstream credits and licenses remain with their respective authors.

grok-mcp is a server that lets a Grok MCP client work with content and records you control. It exposes a small set of tools for finding content, recording workflow events, and saving profile-scoped notes. That gives an assistant a defined data boundary and a reliable history of what happened, instead of asking it to remember prior actions.

Connect a content source, start the HTTP server, and give the MCP endpoint to a client. A content request can exclude items with a matching ledger event, while profile tokens keep each bot's saved records in its own workspace. One example is tracking articles already posted to X; the server does not post them itself. Additional capabilities can be added as independent modules.

## How it works

1. A client calls the `/mcp` endpoint and discovers the available tools.
2. The content module reads local or remote JSON; the ledger records events about specific items.
3. Optional bot profiles use their own tokens and storage area for `save`, `get`, `list`, and `search`.

## Current modules

- `core` — server identity and capability discovery.
- `content` — generic articles/pages/docs/content catalog with file or remote JSON sources.
- `ledger` — generic event history for deterministic workflow state such as `published_to_x`, `processed`, `reviewed`, or any future event.
- `workspace` — generic profile-scoped records for any bot or subject area.

The content module can exclude records that already have a matching ledger event. This lets Grok request content that has never been published to X without putting X-specific logic in the server core.

## Architecture

```text
Grok
  |
  | Streamable HTTP / MCP
  v
/mcp
  |
  +-- core module
  +-- content module ----> ContentRepository
  |                         +-- local JSON
  |                         +-- remote JSON API
  |
  +-- ledger module -----> EventLedger
                            +-- JSON adapter (default)
                            +-- replaceable storage adapter
```

See `docs/architecture.md` for extension rules and scaling direction.

## Tools

- `system_capabilities`
- `content_list`
- `content_get`
- `ledger_record`
- `ledger_list`
- `ledger_has`
- `save` *(profile endpoints only)*
- `get` *(profile endpoints only)*
- `list` *(profile endpoints only)*
- `search` *(profile endpoints only)*

## Bot profiles and generic storage

A profile gives one or more bots a shared, isolated workspace without exposing a server filesystem path. For example:

- Onboarding: `GET https://mcp.example.com/connect/seo`
- MCP: `https://mcp.example.com/mcp/seo`
- Storage: `<MCP_WORKSPACE_ROOT>/seo/records/`

The onboarding response contains connection instructions but never a credential. Give each bot its bearer token separately. Tokens are stored in the profile configuration only as SHA-256 hashes and may be `read` or `write` scoped.

Copy `data/profiles.example.json` to the private path configured by `MCP_PROFILES_FILE`, replace the example hash, and keep that file outside Git. Profile IDs are lowercase URL-safe slugs. Every record operation is bound to the authenticated profile; clients cannot choose an operating-system path.

`save` accepts an optional stable `id`, optional `title`, arbitrary JSON-compatible `content`, optional `tags`, and optional `metadata`. This keeps the contract flexible enough for research, briefs, reports, notes, or other bot output. `get`, `list`, and `search` return only records from the same profile.

Generate a strong token and its stored hash without placing the raw token in the profile file:

```bash
TOKEN=$(openssl rand -hex 32)
printf '%s' "$TOKEN" | shasum -a 256
```

Store only the hash in `profiles.json`; place the raw token in the bot's secret manager.

For routine administration, build once and use the included command:

```bash
npm run build
npm run profile -- create seo "SEO"
npm run profile -- issue seo competitor-research-bot write
npm run profile -- issue seo reporting-bot read
npm run profile -- list
npm run profile -- revoke seo competitor-research-bot
```

`issue` prints the raw token once and stores only its hash. Reissuing the same bot ID replaces its previous credential.

## Content contract

```json
{
  "id": "cheap-linux-vps-guide",
  "type": "article",
  "title": "Cheap Linux VPS Guide",
  "url": "https://example.com/blog/cheap-linux-vps-guide/",
  "excerpt": "A practical guide to choosing a Linux VPS.",
  "body": "Optional full content.",
  "status": "published",
  "publishedAt": "2026-08-22T00:00:00Z",
  "tags": ["vps", "linux"],
  "metadata": {
    "site": "main"
  }
}
```

The server does not care whether a record is a blog post, page, guide, announcement, video, document, product, or another type.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

- Health: `GET http://localhost:3000/health`
- MCP: `http://localhost:3000/mcp`

Deploy the service publicly over HTTPS and use the public `/mcp` URL in Grok's custom connector.

## Content sources

Default:

```env
CONTENT_SOURCE=file
CONTENT_FILE=./data/content.json
```

Or point Grok MCP at a provider-neutral JSON endpoint:

```env
CONTENT_SOURCE=remote
CONTENT_REMOTE_URL=https://api.example.com/grok/content
CONTENT_REMOTE_BEARER_TOKEN=
```

The remote endpoint may return either an array or `{ "items": [...] }`.

## First X workflow

1. Grok calls `content_list` with `type: "article"`, `status: "published"`, and `exclude_event_type: "published_to_x"`.
2. Grok calls `content_get` for the chosen record.
3. Grok creates/publishes the X post using the X capability you connect later.
4. Only after successful publication, Grok records:

```json
{
  "entityType": "content",
  "entityId": "cheap-linux-vps-guide",
  "eventType": "published_to_x",
  "data": {
    "xPostId": "...",
    "xPostUrl": "..."
  }
}
```

The same ledger can track LinkedIn, newsletters, SEO review, indexing, approvals, translations, ingestion, or any other workflow.

## Add a capability

Create a new module under `src/modules/`, implement `GrokModule`, and add it to `src/modules/index.ts`. Keep provider integrations behind service/adaptor interfaces rather than embedding them inside MCP tool handlers.

## Docker

```bash
docker compose up --build -d
```

## Security

`AUTH_MODE=bearer` is supported when the client can send an Authorization header. When the connector only accepts a URL, keep the MCP endpoint behind an appropriate gateway/reverse proxy policy or use `AUTH_MODE=none` only where that exposure is intentional.

Do not store secrets in content metadata or ledger payloads.

Profile endpoints always require a matching profile token, even if the legacy root MCP endpoint is configured with `AUTH_MODE=none`. Tokens are compared using constant-time checks. Profile IDs and record IDs are validated, records are atomically written beneath the configured workspace root, and per-record size limits are enforced.

## Protocol

Built on the MCP TypeScript SDK v2 and the modern Streamable HTTP handler.

## Rights

The owner-original source is licensed under [MIT](LICENSE). Preserve dependency notices.
