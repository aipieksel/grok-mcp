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

const tags = z.array(z.string().trim().min(1).max(100)).max(50).optional();
const metadata = z.record(z.string().max(100), jsonValue).optional();

export const workspaceModule: GrokModule = {
  name: "workspace",
  description: "Generic profile-scoped storage and retrieval.",
  register(server, context) {
    if (!context.workspace || !context.profile || !context.principal) return;
    const repository = context.workspace;

    server.registerTool(
      "save",
      {
        description: "Create or replace a record inside this profile's workspace. Content may be plain text or any JSON value.",
        inputSchema: z.object({
          id: z.string().trim().min(1).max(128).optional(),
          title: z.string().trim().max(500).optional(),
          content: jsonValue,
          tags,
          metadata
        })
      },
      async (input) => {
        if (context.principal?.access !== "write") {
          return { isError: true, content: [{ type: "text", text: "This token has read-only access." }] };
        }
        try {
          const record = await repository.save({
            ...(input.id ? { id: input.id } : {}),
            ...(input.title ? { title: input.title } : {}),
            content: input.content,
            ...(input.tags ? { tags: input.tags } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {})
          });
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                saved: true,
                profile: context.profile?.id,
                id: record.id,
                title: record.title,
                tags: record.tags,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt
              }, null, 2)
            }]
          };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Save failed." }] };
        }
      }
    );

    server.registerTool(
      "get",
      {
        description: "Retrieve one complete record from this profile's workspace by ID.",
        inputSchema: z.object({ id: z.string().trim().min(1).max(128) })
      },
      async ({ id }) => {
        try {
          const record = await repository.get(id);
          if (!record) return { isError: true, content: [{ type: "text", text: `Record not found: ${id}` }] };
          return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Get failed." }] };
        }
      }
    );

    server.registerTool(
      "list",
      {
        description: "List record summaries in this profile's workspace, newest first.",
        inputSchema: z.object({
          tags,
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0)
        })
      },
      async ({ tags: requestedTags, limit, offset }) => ({
        content: [{ type: "text", text: JSON.stringify(await repository.list({
          ...(requestedTags ? { tags: requestedTags } : {}),
          limit,
          offset
        }), null, 2) }]
      })
    );

    server.registerTool(
      "search",
      {
        description: "Search titles, content, tags, and metadata inside this profile's workspace.",
        inputSchema: z.object({
          query: z.string().trim().min(1).max(500),
          limit: z.number().int().min(1).max(100).default(20)
        })
      },
      async ({ query, limit }) => ({
        content: [{ type: "text", text: JSON.stringify(await repository.search(query, limit), null, 2) }]
      })
    );
  }
};
