import type { GrokModule } from "./types.js";

export const coreModule: GrokModule = {
  name: "core",
  description: "Server discovery and capability metadata.",
  register(server, context) {
    server.registerTool(
      "system_capabilities",
      {
        description: "Return Grok MCP server identity, configuration mode, and installed capability groups."
      },
      async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            name: "grok-mcp",
            version: "0.2.0",
            transport: "streamable-http",
            authMode: context.config.authMode,
            contentSource: context.config.content.source,
            ledgerDriver: context.config.ledger.driver,
            profile: context.profile?.id ?? null,
            principal: context.principal?.id ?? null,
            access: context.principal?.access ?? null,
            modules: context.workspace ? ["core", "workspace"] : ["core", "content", "ledger"]
          }, null, 2)
        }]
      })
    );
  }
};
