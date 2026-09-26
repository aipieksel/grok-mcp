import type { McpServer } from "@modelcontextprotocol/server";
import type { AppConfig } from "../config.js";
import type { ContentRepository } from "../services/content.js";
import type { EventLedger } from "../services/ledger.js";
import type { ProfilePrincipal, WorkspaceProfile } from "../services/profiles.js";
import type { WorkspaceRepository } from "../services/workspace.js";

export interface AppContext {
  config: AppConfig;
  content: ContentRepository;
  ledger: EventLedger;
  workspace?: WorkspaceRepository;
  profile?: WorkspaceProfile;
  principal?: ProfilePrincipal;
}

export interface GrokModule {
  name: string;
  description: string;
  register(server: McpServer, context: AppContext): void;
}
