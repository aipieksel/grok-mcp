import { randomUUID } from "node:crypto";
import type { JsonValue, LedgerEvent } from "../types.js";
import { JsonFileStore } from "../storage/json-store.js";

interface LedgerDocument {
  events: LedgerEvent[];
}

export interface LedgerQuery {
  entityType?: string;
  entityId?: string;
  eventType?: string;
  limit: number;
  offset: number;
}

export interface EventLedger {
  initialize?(): Promise<void>;
  close?(): Promise<void>;
  record(input: {
    entityType: string;
    entityId: string;
    eventType: string;
    data?: Record<string, JsonValue>;
  }): Promise<LedgerEvent>;
  list(query: LedgerQuery): Promise<{ events: LedgerEvent[]; total: number }>;
  has(entityType: string, entityId: string, eventType: string): Promise<boolean>;
}

export class FileEventLedger implements EventLedger {
  private readonly store: JsonFileStore<LedgerDocument>;

  constructor(filePath: string) {
    this.store = new JsonFileStore(filePath, { events: [] });
  }

  async record(input: {
    entityType: string;
    entityId: string;
    eventType: string;
    data?: Record<string, JsonValue>;
  }): Promise<LedgerEvent> {
    const event: LedgerEvent = {
      id: randomUUID(),
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      occurredAt: new Date().toISOString(),
      ...(input.data ? { data: input.data } : {})
    };

    await this.store.update((document) => ({ events: [...document.events, event] }));
    return event;
  }

  async list(query: LedgerQuery): Promise<{ events: LedgerEvent[]; total: number }> {
    const { events } = await this.store.read();
    const filtered = events
      .filter((event) => !query.entityType || event.entityType === query.entityType)
      .filter((event) => !query.entityId || event.entityId === query.entityId)
      .filter((event) => !query.eventType || event.eventType === query.eventType)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    return { total: filtered.length, events: filtered.slice(query.offset, query.offset + query.limit) };
  }

  async has(entityType: string, entityId: string, eventType: string): Promise<boolean> {
    const { events } = await this.store.read();
    return events.some((event) => event.entityType === entityType && event.entityId === entityId && event.eventType === eventType);
  }
}
