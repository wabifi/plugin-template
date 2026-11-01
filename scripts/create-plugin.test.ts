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

const DESCRIPTION = "Collects each person's standup notes in one board for the team.";
const CONSOLE_NEEDS = "The Wabifi Console needs a description in manifest.json before it accepts a release";
// scaffoldPlugin with a description, which a plugin needs before it's released.
const scaffold = (arg: string, root: string, options: { description?: unknown; category?: unknown } = {}) =>
  scaffoldPlugin(arg, root, { description: DESCRIPTION, ...options });
const nothingWritten = (root: string) => {
  expect(existsSync(join(root, "plugins"))).toBe(false);
  expect(existsSync(join(root, "directory"))).toBe(false);
};

describe("scaffoldPlugin", () => {
  it("makes plugins/<prefix>.<name> and its listing from a bare name", () => {
    const root = workspace();
    expect(scaffold("standup-board", root)).toEqual({ id: "acme.standup-board", name: "Standup board" });
    const plugin = join(root, "plugins", "acme.standup-board");
    for (const file of ["LICENSE", "core/summary.ts", "core/summary.test.ts", "desktop/tsconfig.json", "desktop/vite.config.ts"]) {
      expect(existsSync(join(plugin, file)), file).toBe(true);
    }
    expect(json(join(plugin, "manifest.json"))).toEqual({ id: "acme.standup-board", name: "Standup board", description: DESCRIPTION, apiVersion: 1, version: "0.1.0" });
    expect(json(join(plugin, "desktop", "package.json"))).toMatchObject({ private: true, scripts: { build: "tsc -p . && vite build" } });
    expect(readFileSync(join(plugin, "desktop", "src", "index.tsx"), "utf8")).toContain('import type { Context } from "@wabifi/author";');
    const listing = json(join(root, "directory", "acme.standup-board.json"));
    expect(listing).toMatchObject({ id: "acme.standup-board", type: "plugin", name: "Standup board", license: "MIT" });
    expect(listing).not.toHaveProperty("category");
  });

  it("takes a full id with the workspace's own prefix as is", () => {
    expect(scaffold("acme.standup-board", workspace()).id).toBe("acme.standup-board");
  });

  it("refuses a full id with another prefix, naming the workspace's prefix", () => {
    const root = workspace();
    expect(() => scaffold("other.standup-board", root)).toThrow(`This workspace's prefix is "acme"`);
    expect(existsSync(join(root, "plugins"))).toBe(false);
  });

  it.each(["Standup", "standup_board", "-standup", "standup-", "standup--board", "1standup", "acme.", "acme.Standup", "acme.standup.board"])(
    "refuses the name %j",
    (arg) => {
      expect(() => scaffold(arg, workspace())).toThrow("use a kebab-case name, like standup-board");
    },
  );

  it("refuses an id longer than 80 characters", () => {
    const root = workspace();
    expect(scaffold(`a${"b".repeat(74)}`, root).id).toHaveLength(80);
    expect(() => scaffold(`a${"b".repeat(75)}`, root)).toThrow("is 81 characters; a plugin id can have at most 80");
  });

  it.each([
    ["no marker", null, /has no wabifi\.workspace\.json/],
    ["a bad prefix", "acme-", /must be 2 to 31 lowercase letters or digits/],
    ["the placeholder", PLACEHOLDER, /Set your prefix in wabifi\.workspace\.json first/],
    ...RESERVED.map((prefix) => [`a reserved prefix`, prefix, /is reserved/] as const),
  ])("refuses %s before writing anything", (_case, prefix, message) => {
    const root = workspace({ prefix });
    expect(() => scaffold("standup-board", root)).toThrow(message);
    expect(existsSync(join(root, "plugins"))).toBe(false);
    expect(existsSync(join(root, "directory"))).toBe(false);
  });

  it("refuses a plugin or listing that already exists", () => {
    const root = workspace();
    scaffold("standup-board", root);
    expect(() => scaffold("standup-board", root)).toThrow("plugins/acme.standup-board/ already exists");
    mkdirSync(join(root, "directory"), { recursive: true });
    writeFileSync(join(root, "directory", "acme.retro.json"), "{}\n");
    expect(() => scaffold("retro", root)).toThrow("directory/acme.retro.json already exists");
  });

  it("copies the root LICENSE and names it in the listing, so changing the license is a one-file change", () => {
    const root = workspace({ license: APACHE });
    scaffold("standup-board", root);
    expect(readFileSync(join(root, "plugins", "acme.standup-board", "LICENSE"), "utf8")).toBe(APACHE);
    expect(json(join(root, "directory", "acme.standup-board.json")).license).toBe("Apache-2.0");
  });

  it("refuses a root LICENSE it cannot name, or none", () => {
    expect(() => scaffold("standup-board", workspace({ license: "All rights reserved.\n" }))).toThrow("Can't tell which license LICENSE is");
    expect(() => scaffold("standup-board", workspace({ license: null }))).toThrow("There is no LICENSE at the root");
  });

  it("starts new plugins under the template's own LICENSE: MIT, Cloud Kinetix, matching the package manifests", () => {
    const root = workspace({ license: readFileSync(join(repo, "LICENSE"), "utf8") });
    scaffold("standup-board", root);
    expect(json(join(root, "directory", "acme.standup-board.json")).license).toBe("MIT");
    expect(readFileSync(join(root, "plugins", "acme.standup-board", "LICENSE"), "utf8")).toContain("Copyright (c) 2026 Cloud Kinetix\n");
    for (const manifest of ["package.json", "packages/author/package.json"]) {
      expect(json(join(repo, manifest)).license, manifest).toBe("MIT");
    }
  });
});

describe("the description and category", () => {
  it("writes no description without one, as wabifi plugin new and Plugin Studio make plugins", () => {
    const root = workspace();
    expect(scaffoldPlugin("standup-board", root).id).toBe("acme.standup-board");
    expect(json(join(root, "plugins", "acme.standup-board", "manifest.json"))).toEqual({ id: "acme.standup-board", name: "Standup board", apiVersion: 1, version: "0.1.0" });
  });

  it.each([
    ["an empty description", ""],
    ["a blank description", "  \n\t "],
    ["a description that isn't text", 42],
  ])("refuses %s before writing anything, saying what to write", (_case, description) => {
    const root = workspace();
    expect(() => scaffoldPlugin("standup-board", root, { description })).toThrow(/describe acme\.standup-board in a sentence or two, or leave --description out/);
    nothingWritten(root);
  });

  it("refuses a description over the 280 bytes Wabifi desktop installs, counted in UTF-8", () => {
    const root = workspace();
    expect(() => scaffold("standup-board", root, { description: "é".repeat(141) })).toThrow("is 282 bytes; Wabifi takes at most 280");
    nothingWritten(root);
    expect(scaffold("standup-board", root, { description: `${"é".repeat(100)}${"a".repeat(80)}` }).id).toBe("acme.standup-board");
  });

  it("writes the description trimmed", () => {
    const root = workspace();
    scaffold("standup-board", root, { description: `  ${DESCRIPTION}\n` });
    expect(json(join(root, "plugins", "acme.standup-board", "manifest.json")).description).toBe(DESCRIPTION);
  });

  it("writes no discovery without a category", () => {
    const root = workspace();
    scaffold("standup-board", root);
    expect(json(join(root, "plugins", "acme.standup-board", "manifest.json"))).not.toHaveProperty("discovery");
  });

  it.each(["productivity", "communication", "data-and-forecasts", "project-management", "finance", "utilities", "examples"])(
    "writes the category %j as discovery.category",
    (category) => {
      const root = workspace();
      scaffold("standup-board", root, { category });
      const manifest = json(join(root, "plugins", "acme.standup-board", "manifest.json"));
      expect(manifest).toEqual({ id: "acme.standup-board", name: "Standup board", description: DESCRIPTION, apiVersion: 1, version: "0.1.0", discovery: { category } });
      expect(json(join(root, "directory", "acme.standup-board.json"))).not.toHaveProperty("category");
    },
  );

  it.each(["games", "Finance", "Data & forecasts", "other", "", 7])("refuses the category %j before writing anything, listing the ones there are", (category) => {
    const root = workspace();
    expect(() => scaffold("standup-board", root, { category })).toThrow(
      "isn't a category. Use one of productivity, communication, data-and-forecasts, project-management, finance, utilities or examples, or leave it out",
    );
    nothingWritten(root);
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
    expect(result.stderr.trim()).toBe('usage: pnpm create-plugin <name> [--description "What it does, in a sentence or two."] [--category <category>]');
  });

  it("says what it made and what comes next", () => {
    const result = cli(workspace(), "standup-board", "--description", DESCRIPTION);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Created plugins/acme.standup-board/ and directory/acme.standup-board.json.");
    expect(result.stdout).toContain("pnpm install && pnpm build && pnpm test");
    expect(result.stdout).not.toContain(CONSOLE_NEEDS);
  });

  it("takes --description and --category", () => {
    const root = workspace();
    const result = cli(root, "standup-board", "--description", DESCRIPTION, "--category", "project-management");
    expect(result.status).toBe(0);
    expect(json(join(root, "plugins", "acme.standup-board", "manifest.json"))).toMatchObject({ description: DESCRIPTION, discovery: { category: "project-management" } });
  });

  it("makes the plugin without a description, saying in one line that the Console needs one to release it", () => {
    const root = workspace();
    const result = cli(root, "standup-board");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.split("\n").filter((line) => line.includes(CONSOLE_NEEDS))).toHaveLength(1);
    expect(json(join(root, "plugins", "acme.standup-board", "manifest.json"))).not.toHaveProperty("description");
  });

  it("refuses an empty --description in plain words", () => {
    const root = workspace();
    const result = cli(root, "standup-board", "--description", "");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("describe acme.standup-board in a sentence or two");
    expect(result.stderr).not.toMatch(/^\s+at /m);
    nothingWritten(root);
  });

  it("refuses a category outside the list in plain words", () => {
    const root = workspace();
    const result = cli(root, "standup-board", "--description", DESCRIPTION, "--category", "games");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^"games" isn't a category\./);
    nothingWritten(root);
  });

  it("refuses an option it doesn't know", () => {
    const result = cli(workspace(), "standup-board", "--description", DESCRIPTION, "--tagline", "x");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("usage: pnpm create-plugin");
  });
});
