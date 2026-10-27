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

// A repo with one plugin, acme.standup-board, whose manifest has `version`.
function workspace(version: unknown = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "release-tag-"));
  roots.push(root);
  mkdirSync(join(root, "plugins", "acme.standup-board"), { recursive: true });
  const manifest = { id: "acme.standup-board", name: "Standup board", apiVersion: 1, version };
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
    expect(() => releaseTag("acme.standup-board@0.1.0", workspace(undefined))).toThrow(
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
