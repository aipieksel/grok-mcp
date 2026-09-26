import * as z from "zod/v4";
import type { JsonValue } from "../types.js";
import type { GrokModule } from "./types.js";

const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(jsonValue),
  z.record(z.string(), jsonValue)
]));

export const ledgerModule: GrokModule = {
  name: "ledger",
  description: "Generic workflow/event history and deduplication.",
  register(server, context) {
    server.registerTool(
      "ledger_record",
      {
        description: "Record a completed event against any entity. Use only after the external action has actually succeeded.",
        inputSchema: z.object({
          entityType: z.string().min(1),
          entityId: z.string().min(1),
          eventType: z.string().min(1),
          data: z.record(z.string(), jsonValue).optional()
        })
      },
      async ({ entityType, entityId, eventType, data }) => {
        const event = await context.ledger.record({
          entityType,
          entityId,
          eventType,
          ...(data ? { data } : {})
        });
        return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
      }
    );

    server.registerTool(
      "ledger_list",
      {
        description: "List recorded workflow events.",
        inputSchema: z.object({
          entityType: z.string().min(1).optional(),
          entityId: z.string().min(1).optional(),
          eventType: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0)
        })
      },
      async ({ entityType, entityId, eventType, limit, offset }) => {
        const result = await context.ledger.list({
          ...(entityType ? { entityType } : {}),
          ...(entityId ? { entityId } : {}),
          ...(eventType ? { eventType } : {}),
          limit,
          offset
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.registerTool(
      "ledger_has",
      {
        description: "Deterministically check whether an entity already has an event type.",
        inputSchema: z.object({
          entityType: z.string().min(1),
          entityId: z.string().min(1),
          eventType: z.string().min(1)
        })
      },
      async ({ entityType, entityId, eventType }) => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            exists: await context.ledger.has(entityType, entityId, eventType),
            entityType,
            entityId,
            eventType
          }, null, 2)
        }]
      })
    );
  }
};
