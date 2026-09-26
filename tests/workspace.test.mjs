import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProfileRegistry, hashBearerToken } from "../dist/services/profiles.js";
import { FileWorkspaceRepository } from "../dist/services/workspace.js";

test("profile tokens are scoped and compared by hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-mcp-profile-test-"));
  try {
    const file = join(root, "profiles.json");
    await writeFile(file, JSON.stringify({ profiles: [{
      id: "seo",
      name: "SEO",
      description: "",
      instructions: [],
      tokens: [{ id: "bot-a", sha256: hashBearerToken("secret-a"), access: "write" }]
    }] }));
    const registry = new ProfileRegistry(file);
    const profile = await registry.get("seo");
    assert.ok(profile);
    assert.deepEqual(await registry.authenticate(profile, "secret-a"), { id: "bot-a", access: "write" });
    assert.equal(await registry.authenticate(profile, "secret-b"), null);
    assert.equal(await registry.get("../seo"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace save, get, list, and search stay inside one profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-mcp-workspace-test-"));
  try {
    const repository = new FileWorkspaceRepository(root, "seo", 100_000);
    const saved = await repository.save({
      id: "technical-audit",
      title: "Technical audit",
      content: { summary: "Canonical tags need attention", sources: ["https://example.com/"] },
      tags: ["technical", "audit"],
      metadata: { bot: "bot-a" }
    });
    assert.equal(saved.id, "technical-audit");
    assert.deepEqual((await repository.get("technical-audit"))?.content, saved.content);
    assert.equal((await repository.list({ tags: ["technical"], limit: 20, offset: 0 })).total, 1);
    assert.equal((await repository.search("canonical", 20)).total, 1);
    await assert.rejects(() => repository.get("../outside"), /Record IDs/);
    assert.throws(() => new FileWorkspaceRepository(root, "../outside", 100_000), /profile ID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace rejects records above the configured limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-mcp-size-test-"));
  try {
    const repository = new FileWorkspaceRepository(root, "seo", 1_024);
    await assert.rejects(() => repository.save({ content: "x".repeat(2_000) }), /exceeds/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
