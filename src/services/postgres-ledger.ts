import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { JsonValue, LedgerEvent } from "../types.js";
import type { EventLedger, LedgerQuery } from "./ledger.js";

interface EventRow {
  id: string;
  entity_type: string;
  entity_id: string;
  event_type: string;
  occurred_at: Date | string;
  data: Record<string, JsonValue> | null;
}

function mapRow(row: EventRow): LedgerEvent {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    occurredAt: new Date(row.occurred_at).toISOString(),
    ...(row.data ? { data: row.data } : {})
  };
}

export class PostgresEventLedger implements EventLedger {
  private readonly pool: Pool;

  constructor(
    databaseUrl: string,
    private readonly table: string
  ) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id uuid PRIMARY KEY,
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        event_type text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        data jsonb
      )
    `);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_entity_idx ON ${this.table} (entity_type, entity_id)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_event_idx ON ${this.table} (event_type, occurred_at DESC)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_dedupe_idx ON ${this.table} (entity_type, entity_id, event_type)`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async record(input: {
    entityType: string;
    entityId: string;
    eventType: string;
    data?: Record<string, JsonValue>;
  }): Promise<LedgerEvent> {
    const id = randomUUID();
    const result = await this.pool.query<EventRow>(
      `INSERT INTO ${this.table} (id, entity_type, entity_id, event_type, data)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, entity_type, entity_id, event_type, occurred_at, data`,
      [id, input.entityType, input.entityId, input.eventType, input.data ? JSON.stringify(input.data) : null]
    );
    return mapRow(result.rows[0]!);
  }

  async list(query: LedgerQuery): Promise<{ events: LedgerEvent[]; total: number }> {
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      values.push(value);
      where.push(`${column} = $${values.length}`);
    };

    add("entity_type", query.entityType);
    add("entity_id", query.entityId);
    add("event_type", query.eventType);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await this.pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${this.table} ${clause}`, values);
    const pageValues = [...values, query.limit, query.offset];
    const rows = await this.pool.query<EventRow>(
      `SELECT id, entity_type, entity_id, event_type, occurred_at, data
       FROM ${this.table} ${clause}
       ORDER BY occurred_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pageValues
    );

    return {
      total: Number(countResult.rows[0]?.count || 0),
      events: rows.rows.map(mapRow)
    };
  }

  async has(entityType: string, entityId: string, eventType: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM ${this.table}
        WHERE entity_type = $1 AND entity_id = $2 AND event_type = $3
      ) AS exists`,
      [entityType, entityId, eventType]
    );
    return result.rows[0]?.exists === true;
  }
}
