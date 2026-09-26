import { createServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { loadConfig } from "./config.js";
import { createGrokMcpServer } from "./mcp.js";
import type { AppContext } from "./modules/types.js";
import { FileContentRepository, RemoteContentRepository } from "./services/content.js";
import { FileEventLedger, type EventLedger } from "./services/ledger.js";
import { PostgresEventLedger } from "./services/postgres-ledger.js";
import { ProfileRegistry, type ProfilePrincipal, type WorkspaceProfile } from "./services/profiles.js";
import { FileWorkspaceRepository } from "./services/workspace.js";

const config = loadConfig();

const content = config.content.source === "remote"
  ? new RemoteContentRepository(
      config.content.remoteUrl!,
      config.content.remoteBearerToken,
      config.content.cacheTtlMs
    )
  : new FileContentRepository(config.content.file);

const ledger: EventLedger = config.ledger.driver === "postgres"
  ? new PostgresEventLedger(config.ledger.databaseUrl!, config.ledger.table)
  : new FileEventLedger(config.ledger.file);

await ledger.initialize?.();

const context: AppContext = { config, content, ledger };
const handler = createMcpHandler(() => createGrokMcpServer(context));
const mcpNodeHandler = toNodeHandler(handler);
const profiles = new ProfileRegistry(config.profilesFile);
const profileHandlers = new Map<string, {
  sdk: ReturnType<typeof createMcpHandler>;
  node: ReturnType<typeof toNodeHandler>;
}>();

function handlerFor(profile: WorkspaceProfile, principal: ProfilePrincipal) {
  const key = `${profile.id}:${principal.id}:${principal.access}`;
  const existing = profileHandlers.get(key);
  if (existing) return existing.node;
  const workspace = new FileWorkspaceRepository(
    config.workspace.root,
    profile.id,
    config.workspace.maxRecordBytes
  );
  const profileContext: AppContext = { ...context, profile, principal, workspace };
  const sdk = createMcpHandler(() => createGrokMcpServer(profileContext));
  const created = { sdk, node: toNodeHandler(sdk) };
  profileHandlers.set(key, created);
  return created.node;
}

function bearer(req: import("node:http").IncomingMessage): string {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : "";
}

function publicBaseUrl(req: import("node:http").IncomingMessage): string {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const forwarded = req.headers["x-forwarded-proto"];
  const protocol = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || "http";
  return `${protocol}://${req.headers.host || "localhost"}`;
}

function unauthorized(res: import("node:http").ServerResponse): void {
  res.writeHead(401, {
    "content-type": "application/json",
    "www-authenticate": "Bearer"
  });
  res.end(JSON.stringify({ error: "unauthorized" }));
}

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "grok-mcp",
        version: "0.2.0",
        ledgerDriver: config.ledger.driver,
        contentSource: config.content.source
      }));
      return;
    }

    const connectMatch = url.pathname.match(/^\/connect\/([a-z0-9-]+)\/?$/);
    if (connectMatch) {
      if (req.method !== "GET") {
        res.writeHead(405, { allow: "GET", "content-type": "application/json" });
        res.end(JSON.stringify({ error: "method_not_allowed" }));
        return;
      }
      const profile = await profiles.get(connectMatch[1]!);
      if (!profile) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "profile_not_found" }));
        return;
      }
      res.writeHead(200, {
        "cache-control": "public, max-age=60",
        "content-type": "application/json",
        "x-content-type-options": "nosniff"
      });
      res.end(JSON.stringify({
        version: 1,
        profile: {
          id: profile.id,
          name: profile.name,
          description: profile.description
        },
        mcp: {
          url: `${publicBaseUrl(req)}${config.mcpPath}/${profile.id}`,
          transport: "streamable-http",
          authentication: {
            type: "bearer",
            token: "Supply the profile token separately; it is never returned by this URL."
          }
        },
        tools: ["save", "get", "list", "search"],
        instructions: [
          "Connect to the MCP URL using the separately supplied bearer token.",
          `Everything saved through that connection is confined to the ${profile.id} workspace.`,
          "Save useful completed work with sources in the content or metadata.",
          ...profile.instructions
        ]
      }, null, 2));
      return;
    }

    const escapedMcpPath = config.mcpPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const profileMatch = url.pathname.match(new RegExp(`^${escapedMcpPath}/([a-z0-9-]+)/?$`));
    if (profileMatch) {
      const profile = await profiles.get(profileMatch[1]!);
      if (!profile) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "profile_not_found" }));
        return;
      }
      const principal = await profiles.authenticate(profile, bearer(req));
      if (!principal) {
        unauthorized(res);
        return;
      }
      if (!req.method || !req.url) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
        return;
      }
      await handlerFor(profile, principal)(req as typeof req & { method: string; url: string }, res);
      return;
    }

    if (url.pathname !== config.mcpPath) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    if (config.authMode === "bearer" && bearer(req) !== config.bearerToken) {
      unauthorized(res);
      return;
    }

    if (!req.method || !req.url) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_request" }));
      return;
    }

    await mcpNodeHandler(req as typeof req & { method: string; url: string }, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal_server_error" }));
  }
});

httpServer.listen(config.port, config.host, () => {
  console.log(`grok-mcp listening on http://${config.host}:${config.port}${config.mcpPath}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close();
  await handler.close();
  await Promise.all([...profileHandlers.values()].map(({ sdk }) => sdk.close()));
  await ledger.close?.();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
