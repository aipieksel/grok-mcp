import path from "node:path";

export interface AppConfig {
  port: number;
  host: string;
  mcpPath: string;
  authMode: "none" | "bearer";
  bearerToken?: string;
  publicBaseUrl?: string;
  profilesFile: string;
  workspace: {
    root: string;
    maxRecordBytes: number;
  };
  content: {
    source: "file" | "remote";
    file: string;
    remoteUrl?: string;
    remoteBearerToken?: string;
    cacheTtlMs: number;
  };
  ledger: {
    driver: "file" | "postgres";
    file: string;
    databaseUrl?: string;
    table: string;
  };
}

function requiredWhen(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function safeIdentifier(value: string, fallback: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) ? value : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const authMode = env.AUTH_MODE === "bearer" ? "bearer" : "none";
  const contentSource = env.CONTENT_SOURCE === "remote" ? "remote" : "file";
  const ledgerDriver = env.LEDGER_DRIVER === "postgres" ? "postgres" : "file";

  const bearerToken = authMode === "bearer"
    ? requiredWhen(env.MCP_BEARER_TOKEN, "MCP_BEARER_TOKEN is required when AUTH_MODE=bearer")
    : undefined;
  const remoteUrl = contentSource === "remote"
    ? requiredWhen(env.CONTENT_REMOTE_URL, "CONTENT_REMOTE_URL is required when CONTENT_SOURCE=remote")
    : undefined;
  const databaseUrl = ledgerDriver === "postgres"
    ? requiredWhen(env.DATABASE_URL, "DATABASE_URL is required when LEDGER_DRIVER=postgres")
    : undefined;

  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || "0.0.0.0",
    mcpPath: env.MCP_PATH || "/mcp",
    authMode,
    ...(bearerToken ? { bearerToken } : {}),
    ...(env.PUBLIC_BASE_URL ? { publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, "") } : {}),
    profilesFile: path.resolve(env.MCP_PROFILES_FILE || "./data/profiles.json"),
    workspace: {
      root: path.resolve(env.MCP_WORKSPACE_ROOT || "./data/workspaces"),
      maxRecordBytes: Math.max(1_024, Number(env.MCP_MAX_RECORD_BYTES || 1_048_576))
    },
    content: {
      source: contentSource,
      file: path.resolve(env.CONTENT_FILE || "./data/content.json"),
      ...(remoteUrl ? { remoteUrl } : {}),
      ...(env.CONTENT_REMOTE_BEARER_TOKEN ? { remoteBearerToken: env.CONTENT_REMOTE_BEARER_TOKEN } : {}),
      cacheTtlMs: Math.max(0, Number(env.CONTENT_CACHE_TTL_SECONDS || 60) * 1000)
    },
    ledger: {
      driver: ledgerDriver,
      file: path.resolve(env.LEDGER_FILE || "./data/ledger.json"),
      ...(databaseUrl ? { databaseUrl } : {}),
      table: safeIdentifier(env.LEDGER_TABLE || "grok_mcp_events", "grok_mcp_events")
    }
  };
}
