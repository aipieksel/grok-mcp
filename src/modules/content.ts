import * as z from "zod/v4";
import type { GrokModule } from "./types.js";

const listInput = z.object({
  type: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
  exclude_event_type: z.string().min(1).optional().describe("Exclude content IDs that already have this ledger event type."),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0)
});

export const contentModule: GrokModule = {
  name: "content",
  description: "Generic content discovery and retrieval.",
  register(server, context) {
    server.registerTool(
      "content_list",
      {
        description: "List generic content records. Can exclude records that already have a specified ledger event.",
        inputSchema: listInput
      },
      async ({ type, status, search, tags, exclude_event_type, limit, offset }) => {
        const page = await context.content.list({
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
          ...(search ? { search } : {}),
          ...(tags ? { tags } : {}),
          limit: exclude_event_type ? 100 : limit,
          offset: exclude_event_type ? 0 : offset
        });

        let items = page.items;
        if (exclude_event_type) {
          const checks = await Promise.all(items.map(async (item) => ({
            item,
            excluded: await context.ledger.has("content", item.id, exclude_event_type)
          })));
          items = checks.filter((entry) => !entry.excluded).map((entry) => entry.item).slice(offset, offset + limit);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ count: items.length, totalBeforeEventFilter: page.total, items }, null, 2)
          }]
        };
      }
    );

    server.registerTool(
      "content_get",
      {
        description: "Retrieve one complete content record by stable ID.",
        inputSchema: z.object({ id: z.string().min(1) })
      },
      async ({ id }) => {
        const item = await context.content.get(id);
        if (!item) return { isError: true, content: [{ type: "text", text: `Content not found: ${id}` }] };
        return { content: [{ type: "text", text: JSON.stringify(item, null, 2) }] };
      }
    );
  }
};
