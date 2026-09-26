import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { hashBearerToken, validProfileId, type ProfileAccess, type WorkspaceProfile } from "./services/profiles.js";

interface ProfileDocument {
  profiles: WorkspaceProfile[];
}

const filePath = path.resolve(process.env.MCP_PROFILES_FILE || "./data/profiles.json");

async function readDocument(): Promise<ProfileDocument> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<ProfileDocument>;
    return { profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { profiles: [] };
    throw error;
  }
}

async function writeDocument(document: ProfileDocument): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
  await fs.chmod(filePath, 0o600);
}

function usage(): never {
  console.error("Usage: npm run profile -- create <profile> [name] | issue <profile> <bot> [read|write] | revoke <profile> <bot> | list");
  process.exit(2);
}

const [command, profileId, value, requestedAccess] = process.argv.slice(2);

if (command === "list") {
  const document = await readDocument();
  console.log(JSON.stringify(document.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    bots: profile.tokens.map((token) => ({ id: token.id, access: token.access }))
  })), null, 2));
} else if (command === "create") {
  if (!profileId || !validProfileId(profileId)) usage();
  const document = await readDocument();
  if (!document.profiles.some((profile) => profile.id === profileId)) {
    document.profiles.push({
      id: profileId,
      name: value?.trim() || profileId,
      description: "",
      instructions: [],
      tokens: []
    });
    await writeDocument(document);
  }
  console.log(`Profile ready: ${profileId}`);
} else if (command === "issue") {
  if (!profileId || !validProfileId(profileId) || !value?.trim()) usage();
  const access: ProfileAccess = requestedAccess === "read" ? "read" : "write";
  const document = await readDocument();
  const profile = document.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  const token = randomBytes(32).toString("hex");
  profile.tokens = [
    ...profile.tokens.filter((candidate) => candidate.id !== value),
    { id: value, sha256: hashBearerToken(token), access }
  ];
  await writeDocument(document);
  console.log(`Bot token issued for ${profileId}/${value} (${access}).`);
  console.log("Copy this token now; only its hash was saved:");
  console.log(token);
} else if (command === "revoke") {
  if (!profileId || !validProfileId(profileId) || !value?.trim()) usage();
  const document = await readDocument();
  const profile = document.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  const before = profile.tokens.length;
  profile.tokens = profile.tokens.filter((candidate) => candidate.id !== value);
  await writeDocument(document);
  console.log(before === profile.tokens.length ? "No matching bot token." : `Bot token revoked: ${profileId}/${value}`);
} else {
  usage();
}
