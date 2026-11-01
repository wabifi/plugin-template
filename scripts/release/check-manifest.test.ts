import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkManifest } from "./check-manifest.mjs";

const script = join(resolve(dirname(fileURLToPath(import.meta.url))), "check-manifest.mjs");
const NEEDS = "The Wabifi Console needs a description in manifest.json before it accepts a release: a sentence or two on what the plugin does, which Plugins shows.";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// A built dist/acme.standup-board/manifest.json in a temp dir, with `fields` over a valid one.
function built(fields: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "check-manifest-"));
  dirs.push(dir);
  const file = join(dir, "manifest.json");
  const manifest = { id: "acme.standup-board", name: "Standup board", description: "Collects each person's standup notes in one board for the team.", apiVersion: 1, ...fields };
  writeFileSync(file, JSON.stringify(manifest));
  return file;
}

describe("checkManifest", () => {
  it("passes a built manifest the Console takes", () => {
    expect(() => checkManifest(built())).not.toThrow();
    expect(() => checkManifest(built({ discovery: { category: "project-management" } }))).not.toThrow();
  });

  it.each([
    ["no description", undefined],
    ["a blank description", "  "],
    ["a description that isn't text", 42],
  ])("fails %s, saying the Console needs one", (_case, description) => {
    const file = built({ description });
    expect(() => checkManifest(file)).toThrow(`${file} has no description. ${NEEDS}`);
  });

  it("fails a description over 280 bytes of UTF-8", () => {
    const file = built({ description: "é".repeat(141) });
    expect(() => checkManifest(file)).toThrow(`${file} has a description of 282 bytes; Wabifi takes at most 280. Shorten it to a sentence or two.`);
  });

  it("fails a category Wabifi can't install", () => {
    expect(() => checkManifest(built({ discovery: { category: "Finance" } }))).toThrow("can't be installed with that category");
  });

  it("fails a file that isn't a JSON object", () => {
    const file = built();
    writeFileSync(file, "[]");
    expect(() => checkManifest(file)).toThrow(`${file} isn't a JSON object.`);
  });
});

describe("node scripts/release/check-manifest.mjs", () => {
  const cli = (file: string) => spawnSync(process.execPath, [script, file], { encoding: "utf8" });

  it("exits 0 on a manifest the Console takes", () => {
    const result = cli(built());
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("fails in plain words, without a stack trace, before a release exists", () => {
    const result = cli(built({ description: undefined }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(NEEDS);
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });
});
