import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { releaseTag } from "./tag.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

// A repo with one plugin, acme.standup-board, whose manifest has `version` (none when null), a
// description, and `fields` over those.
function workspace(version: string | null = "0.1.0", fields: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "release-tag-"));
  roots.push(root);
  mkdirSync(join(root, "plugins", "acme.standup-board"), { recursive: true });
  const manifest = {
    id: "acme.standup-board",
    name: "Standup board",
    description: "Collects each person's standup notes in one board for the team.",
    apiVersion: 1,
    ...(version === null ? {} : { version }),
    ...fields,
  };
  writeFileSync(join(root, "plugins", "acme.standup-board", "manifest.json"), JSON.stringify(manifest));
  return root;
}

describe("releaseTag", () => {
  it("passes a tag whose version is the plugin's manifest version", () => {
    expect(releaseTag("acme.standup-board@0.1.0", workspace())).toEqual({ id: "acme.standup-board", version: "0.1.0" });
  });

  it("fails a version that differs from the manifest's", () => {
    expect(() => releaseTag("acme.standup-board@0.2.0", workspace())).toThrow(
      'plugins/acme.standup-board/manifest.json has version "0.1.0", not 0.2.0',
    );
  });

  it("fails when the manifest has no version", () => {
    expect(() => releaseTag("acme.standup-board@0.1.0", workspace(null))).toThrow(
      "plugins/acme.standup-board/manifest.json has no version",
    );
  });

  it("fails an id that is not a plugin here", () => {
    expect(() => releaseTag("acme.retro@0.1.0", workspace())).toThrow("there is no plugin acme.retro");
  });

  it.each(["acme.standup-board", "0.1.0", "@0.1.0", "acme.standup-board@", "Acme.standup-board@0.1.0", "acme.standup-board@0.1.0@1", "../acme@0.1.0", "acme/x@0.1.0", "acme.standup-board@0.1 .0"])(
    "fails %j, which is not <id>@<version>",
    (tag) => {
      expect(() => releaseTag(tag, workspace())).toThrow("is not a release tag");
    },
  );
});

describe("releaseTag and the manifest Wabifi installs", () => {
  // The Wabifi Developers Console refuses the same release (CLO-794), and the desktop wouldn't install it.
  it.each([
    ["no description", undefined],
    ["an empty description", ""],
    ["a blank description", "  \n "],
    ["a description that isn't text", 42],
  ])("fails %s, saying what to write", (_case, description) => {
    expect(() => releaseTag("acme.standup-board@0.1.0", workspace("0.1.0", { description }))).toThrow(
      "acme.standup-board@0.1.0: plugins/acme.standup-board/manifest.json needs a description: a sentence or two on what the plugin does, shown in Plugins.",
    );
  });

  it("fails a description over 280 bytes of UTF-8, and passes one of exactly 280", () => {
    expect(() => releaseTag("acme.standup-board@0.1.0", workspace("0.1.0", { description: "é".repeat(141) }))).toThrow(
      "plugins/acme.standup-board/manifest.json has a description of 282 bytes; Wabifi takes at most 280.",
    );
    expect(releaseTag("acme.standup-board@0.1.0", workspace("0.1.0", { description: `${"é".repeat(100)}${"a".repeat(80)}` })).id).toBe("acme.standup-board");
  });

  it.each([undefined, null, { tags: ["standup"] }, { category: "project-management" }, { category: "games" }])("passes the discovery %j", (discovery) => {
    expect(releaseTag("acme.standup-board@0.1.0", workspace("0.1.0", { discovery })).id).toBe("acme.standup-board");
  });

  it.each(["Finance", "Data & forecasts", "", "finance_tools", 7])("fails the category %j, which Wabifi can't install", (category) => {
    expect(() => releaseTag("acme.standup-board@0.1.0", workspace("0.1.0", { discovery: { category } }))).toThrow(
      "can't be installed with that category. Use one of productivity, communication, data-and-forecasts, project-management, finance, utilities or examples, or leave it out.",
    );
  });
});

describe("node scripts/release/tag.mjs", () => {
  // Runs this repo's scripts/ from a copy at `root`, which then holds the plugin.
  function cli(root: string, tag: string, env: Record<string, string> = {}) {
    cpSync(join(repo, "scripts"), join(root, "scripts"), { recursive: true });
    return spawnSync(process.execPath, [join(root, "scripts", "release", "tag.mjs"), tag], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: "", ...env },
    });
  }

  it("writes the id and version for the next steps of the workflow", () => {
    const root = workspace();
    const output = join(root, "github-output");
    writeFileSync(output, "earlier=1\n");
    const result = cli(root, "acme.standup-board@0.1.0", { GITHUB_OUTPUT: output });
    expect(result.status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("earlier=1\nid=acme.standup-board\nversion=0.1.0\n");
  });

  it("fails in plain words, without a stack trace", () => {
    const result = cli(workspace(), "acme.standup-board@0.2.0");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^acme\.standup-board@0\.2\.0: plugins\/acme\.standup-board\/manifest\.json has version/);
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });
});
