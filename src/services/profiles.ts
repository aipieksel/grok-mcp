import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";

export type ProfileAccess = "read" | "write";

export interface ProfilePrincipal {
  id: string;
  access: ProfileAccess;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  description: string;
  instructions: string[];
  tokens: Array<{
    id: string;
    sha256: string;
    access: ProfileAccess;
  }>;
}

interface ProfileDocument {
  profiles?: unknown;
}

const PROFILE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function validProfileId(value: string): boolean {
  return PROFILE_ID.test(value);
}

export function hashBearerToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseProfile(value: unknown): WorkspaceProfile | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || !validProfileId(input.id)) return null;

  const tokens = Array.isArray(input.tokens)
    ? input.tokens.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const token = entry as Record<string, unknown>;
        if (
          typeof token.id !== "string" ||
          typeof token.sha256 !== "string" ||
          !SHA256.test(token.sha256) ||
          (token.access !== "read" && token.access !== "write")
        ) return [];
        return [{ id: token.id, sha256: token.sha256, access: token.access as ProfileAccess }];
      })
    : [];

  return {
    id: input.id,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : input.id,
    description: typeof input.description === "string" ? input.description.trim() : "",
    instructions: Array.isArray(input.instructions)
      ? input.instructions.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [],
    tokens
  };
}

export class ProfileRegistry {
  constructor(private readonly filePath: string) {}

  async list(): Promise<WorkspaceProfile[]> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8")) as ProfileDocument;
      const values = Array.isArray(raw.profiles) ? raw.profiles : [];
      return values.map(parseProfile).filter((profile): profile is WorkspaceProfile => profile !== null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get(id: string): Promise<WorkspaceProfile | null> {
    if (!validProfileId(id)) return null;
    return (await this.list()).find((profile) => profile.id === id) ?? null;
  }

  async authenticate(profile: WorkspaceProfile, bearerToken: string): Promise<ProfilePrincipal | null> {
    const candidate = Buffer.from(hashBearerToken(bearerToken), "hex");
    for (const token of profile.tokens) {
      const expected = Buffer.from(token.sha256, "hex");
      if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
        return { id: token.id, access: token.access };
      }
    }
    return null;
  }
}
