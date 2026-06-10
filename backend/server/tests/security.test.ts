import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CACHE_ROOT_NAME,
  resolveWithinRoot,
  selectCacheRoot,
} from "../src/security/roots.ts";

describe("MCP roots", () => {
  test("selects exactly one named local root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "secure-root-"));
    try {
      const selected = await selectCacheRoot([
        { name: CACHE_ROOT_NAME, uri: new URL(`file://${directory}`).href },
      ]);
      expect(selected).toBe(await realpath(directory));
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("rejects path traversal", () => {
    expect(() => resolveWithinRoot("/tmp/allowed", "../outside")).toThrow("escapes");
  });
});
