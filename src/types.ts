export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ContentItem {
  id: string;
  type: string;
  title: string;
  url?: string;
  excerpt?: string;
  body?: string;
  status?: string;
  publishedAt?: string;
  updatedAt?: string;
  tags?: string[];
  metadata?: Record<string, JsonValue>;
}

export interface LedgerEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  occurredAt: string;
  data?: Record<string, JsonValue>;
}

export interface WorkspaceRecord {
  id: string;
  title?: string;
  content: JsonValue;
  tags: string[];
  metadata: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRecordSummary {
  id: string;
  title?: string;
  tags: string[];
  metadata: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}
