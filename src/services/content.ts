import fs from "node:fs/promises";
import type { ContentItem } from "../types.js";

export interface ContentQuery {
  type?: string;
  status?: string;
  search?: string;
  tags?: string[];
  limit: number;
  offset: number;
}

export interface ContentRepository {
  list(query: ContentQuery): Promise<{ items: ContentItem[]; total: number }>;
  get(id: string): Promise<ContentItem | null>;
}

function normalizePayload(payload: unknown): ContentItem[] {
  const value = payload as { items?: unknown };
  const items = Array.isArray(payload) ? payload : value && Array.isArray(value.items) ? value.items : [];
  return items.filter((item): item is ContentItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<ContentItem>;
    return typeof candidate.id === "string" && typeof candidate.type === "string" && typeof candidate.title === "string";
  });
}

function applyQuery(items: ContentItem[], query: ContentQuery): { items: ContentItem[]; total: number } {
  const needle = query.search?.trim().toLowerCase();
  const requiredTags = query.tags?.map((tag) => tag.toLowerCase());

  const filtered = items.filter((item) => {
    if (query.type && item.type !== query.type) return false;
    if (query.status && item.status !== query.status) return false;
    if (requiredTags?.length) {
      const tags = new Set((item.tags || []).map((tag) => tag.toLowerCase()));
      if (!requiredTags.every((tag) => tags.has(tag))) return false;
    }
    if (needle) {
      const haystack = [item.title, item.excerpt, item.body, item.url, ...(item.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  return { total: filtered.length, items: filtered.slice(query.offset, query.offset + query.limit) };
}

export class FileContentRepository implements ContentRepository {
  constructor(private readonly filePath: string) {}

  private async all(): Promise<ContentItem[]> {
    const raw = await fs.readFile(this.filePath, "utf8");
    return normalizePayload(JSON.parse(raw) as unknown);
  }

  async list(query: ContentQuery) {
    return applyQuery(await this.all(), query);
  }

  async get(id: string) {
    return (await this.all()).find((item) => item.id === id) || null;
  }
}

export class RemoteContentRepository implements ContentRepository {
  private cache: { expiresAt: number; items: ContentItem[] } | null = null;

  constructor(
    private readonly url: string,
    private readonly bearerToken: string | undefined,
    private readonly cacheTtlMs: number
  ) {}

  private async all(): Promise<ContentItem[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.items;

    const response = await fetch(this.url, {
      ...(this.bearerToken
        ? { headers: { Authorization: `Bearer ${this.bearerToken}` } }
        : {}),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Remote content source returned HTTP ${response.status}`);

    const items = normalizePayload(await response.json());
    this.cache = { items, expiresAt: Date.now() + this.cacheTtlMs };
    return items;
  }

  async list(query: ContentQuery) {
    return applyQuery(await this.all(), query);
  }

  async get(id: string) {
    return (await this.all()).find((item) => item.id === id) || null;
  }
}
