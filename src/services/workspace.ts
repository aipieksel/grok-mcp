import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { JsonValue, WorkspaceRecord, WorkspaceRecordSummary } from "../types.js";
import { validProfileId } from "./profiles.js";

export interface SaveWorkspaceRecord {
  id?: string;
  title?: string;
  content: JsonValue;
  tags?: string[];
  metadata?: Record<string, JsonValue>;
}

export interface WorkspaceQuery {
  tags?: string[];
  limit: number;
  offset: number;
}

export interface WorkspaceRepository {
  save(input: SaveWorkspaceRecord): Promise<WorkspaceRecord>;
  get(id: string): Promise<WorkspaceRecord | null>;
  list(query: WorkspaceQuery): Promise<{ items: WorkspaceRecordSummary[]; total: number }>;
  search(query: string, limit: number): Promise<{ items: WorkspaceRecordSummary[]; total: number }>;
}

const RECORD_ID = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,126}[a-zA-Z0-9])?$/;

function assertRecordId(value: string): void {
  if (!RECORD_ID.test(value) || value === "." || value === "..") {
    throw new Error("Record IDs may contain only letters, numbers, dots, underscores, and hyphens.");
  }
}

function summary(record: WorkspaceRecord): WorkspaceRecordSummary {
  return {
    id: record.id,
    ...(record.title ? { title: record.title } : {}),
    tags: record.tags,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export class FileWorkspaceRepository implements WorkspaceRepository {
  private writeChain: Promise<void> = Promise.resolve();
  private readonly recordsDir: string;

  constructor(root: string, profileId: string, private readonly maxRecordBytes: number) {
    if (!validProfileId(profileId)) throw new Error("Invalid workspace profile ID.");
    this.recordsDir = path.join(root, profileId, "records");
  }

  private recordPath(id: string): string {
    assertRecordId(id);
    return path.join(this.recordsDir, `${id}.json`);
  }

  private async all(): Promise<WorkspaceRecord[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.recordsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      try {
        return JSON.parse(await fs.readFile(path.join(this.recordsDir, name), "utf8")) as WorkspaceRecord;
      } catch {
        return null;
      }
    }));
    return records.filter((record): record is WorkspaceRecord => record !== null);
  }

  async save(input: SaveWorkspaceRecord): Promise<WorkspaceRecord> {
    const id = input.id?.trim() || randomUUID();
    const filePath = this.recordPath(id);
    let result!: WorkspaceRecord;
    this.writeChain = this.writeChain.then(async () => {
      const existing = await this.get(id);
      const now = new Date().toISOString();
      result = {
        id,
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        content: input.content,
        tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
        metadata: input.metadata ?? {},
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      const serialized = `${JSON.stringify(result, null, 2)}\n`;
      if (Buffer.byteLength(serialized) > this.maxRecordBytes) {
        throw new Error(`Record exceeds the ${this.maxRecordBytes}-byte limit.`);
      }
      await fs.mkdir(this.recordsDir, { recursive: true, mode: 0o700 });
      const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, serialized, { mode: 0o600 });
      await fs.rename(temporary, filePath);
    });
    await this.writeChain;
    return result;
  }

  async get(id: string): Promise<WorkspaceRecord | null> {
    try {
      return JSON.parse(await fs.readFile(this.recordPath(id), "utf8")) as WorkspaceRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(query: WorkspaceQuery): Promise<{ items: WorkspaceRecordSummary[]; total: number }> {
    const tags = query.tags?.map((tag) => tag.toLowerCase());
    const records = (await this.all())
      .filter((record) => !tags?.length || tags.every((tag) => record.tags.some((candidate) => candidate.toLowerCase() === tag)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      total: records.length,
      items: records.slice(query.offset, query.offset + query.limit).map(summary)
    };
  }

  async search(query: string, limit: number): Promise<{ items: WorkspaceRecordSummary[]; total: number }> {
    const needle = query.trim().toLowerCase();
    const records = (await this.all())
      .filter((record) => JSON.stringify(record).toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { total: records.length, items: records.slice(0, limit).map(summary) };
  }
}
