import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldPlugin } from "./create-plugin.mjs";
import { PLACEHOLDER, RESERVED } from "./workspace.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIT = "MIT License\n\nCopyright (c) 2026 the authors of this repository\n\nPermission is hereby granted, free of charge, ...\n";
const APACHE = "\n                                 Apache License\n                           Version 2.0, January 2004\n                        http://www.apache.org/licenses/\n";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

// A workspace root with a marker naming `prefix` (none when null) and a root LICENSE (none when null).
function workspace({ prefix = "acme" as string | null, license = MIT as string | null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "create-plugin-"));
  roots.push(root);
  if (prefix !== null) writeFileSync(join(root, "wabifi.workspace.json"), JSON.stringify({ prefix }));
  if (license !== null) writeFileSync(join(root, "LICENSE"), license);
  return root;
}

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("scaffoldPlugin", () => {
  it("makes plugins/<prefix>.<name> and its listing from a bare name", () => {
    const root = workspace();
    expect(scaffoldPlugin("standup-board", root)).toEqual({ id: "acme.standup-board", name: "Standup board" });
    const plugin = join(root, "plugins", "acme.standup-board");
    for (const file of ["LICENSE", "core/summary.ts", "core/summary.test.ts", "desktop/tsconfig.json", "desktop/vite.config.ts"]) {
      expect(existsSync(join(plugin, file)), file).toBe(true);
    }
    expect(json(join(plugin, "manifest.json"))).toEqual({ id: "acme.standup-board", name: "Standup board", apiVersion: 1, version: "0.1.0" });
    expect(json(join(plugin, "desktop", "package.json"))).toMatchObject({ private: true, scripts: { build: "tsc -p . && vite build" } });
    expect(readFileSync(join(plugin, "desktop", "src", "index.tsx"), "utf8")).toContain('import type { Context } from "@wabifi/author";');
    const listing = json(join(root, "directory", "acme.standup-board.json"));
    expect(listing).toMatchObject({ id: "acme.standup-board", type: "plugin", name: "Standup board", license: "MIT" });
    expect(listing).not.toHaveProperty("category");
  });

  it("takes a full id with the workspace's own prefix as is", () => {
    expect(scaffoldPlugin("acme.standup-board", workspace()).id).toBe("acme.standup-board");
  });

  it("refuses a full id with another prefix, naming the workspace's prefix", () => {
    const root = workspace();
    expect(() => scaffoldPlugin("other.standup-board", root)).toThrow(`This workspace's prefix is "acme"`);
    expect(existsSync(join(root, "plugins"))).toBe(false);
  });

  it.each(["Standup", "standup_board", "-standup", "standup-", "standup--board", "1standup", "acme.", "acme.Standup", "acme.standup.board"])(
    "refuses the name %j",
    (arg) => {
      expect(() => scaffoldPlugin(arg, workspace())).toThrow("use a kebab-case name, like standup-board");
    },
  );

  it("refuses an id longer than 80 characters", () => {
    const root = workspace();
    expect(scaffoldPlugin(`a${"b".repeat(74)}`, root).id).toHaveLength(80);
    expect(() => scaffoldPlugin(`a${"b".repeat(75)}`, root)).toThrow("is 81 characters; a plugin id can have at most 80");
  });

  it.each([
    ["no marker", null, /has no wabifi\.workspace\.json/],
    ["a bad prefix", "acme-", /must be 2 to 31 lowercase letters or digits/],
    ["the placeholder", PLACEHOLDER, /Set your prefix in wabifi\.workspace\.json first/],
    ...RESERVED.map((prefix) => [`a reserved prefix`, prefix, /is reserved/] as const),
  ])("refuses %s before writing anything", (_case, prefix, message) => {
    const root = workspace({ prefix });
    expect(() => scaffoldPlugin("standup-board", root)).toThrow(message);
    expect(existsSync(join(root, "plugins"))).toBe(false);
    expect(existsSync(join(root, "directory"))).toBe(false);
  });

  it("refuses a plugin or listing that already exists", () => {
    const root = workspace();
    scaffoldPlugin("standup-board", root);
    expect(() => scaffoldPlugin("standup-board", root)).toThrow("plugins/acme.standup-board/ already exists");
    mkdirSync(join(root, "directory"), { recursive: true });
    writeFileSync(join(root, "directory", "acme.retro.json"), "{}\n");
    expect(() => scaffoldPlugin("retro", root)).toThrow("directory/acme.retro.json already exists");
  });

  it("copies the root LICENSE and names it in the listing, so changing the license is a one-file change", () => {
    const root = workspace({ license: APACHE });
    scaffoldPlugin("standup-board", root);
    expect(readFileSync(join(root, "plugins", "acme.standup-board", "LICENSE"), "utf8")).toBe(APACHE);
    expect(json(join(root, "directory", "acme.standup-board.json")).license).toBe("Apache-2.0");
  });

  it("refuses a root LICENSE it cannot name, or none", () => {
    expect(() => scaffoldPlugin("standup-board", workspace({ license: "All rights reserved.\n" }))).toThrow("Can't tell which license LICENSE is");
    expect(() => scaffoldPlugin("standup-board", workspace({ license: null }))).toThrow("There is no LICENSE at the root");
  });
});

describe("pnpm create-plugin", () => {
  // Runs this repo's scripts/ from a copy at `root`, so the CLI finds root's marker.
  function cli(root: string, ...args: string[]) {
    cpSync(join(repo, "scripts"), join(root, "scripts"), { recursive: true });
    return spawnSync(process.execPath, [join(root, "scripts", "create-plugin.mjs"), ...args], { cwd: root, encoding: "utf8" });
  }

  it("refuses in plain words, without a stack trace", () => {
    const result = cli(workspace({ prefix: null }), "standup-board");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^This folder has no wabifi\.workspace\.json/);
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });

  it("says how to use it when given no name", () => {
    const result = cli(workspace());
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("usage: pnpm create-plugin <name>");
  });

  it("says what it made and what comes next", () => {
    const result = cli(workspace(), "standup-board");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Created plugins/acme.standup-board/ and directory/acme.standup-board.json.");
    expect(result.stdout).toContain("pnpm install && pnpm build && pnpm test");
  });
});
