import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Wabifi desktop is built on an upstream app whose name this template does not show. The
// vendored author types carry that app's license and notice inside their archive, which is
// where the name stays: the lockfile pins the archive and packages/author re-exports it under
// its package name, so their contents are exempt, as is this file. plugins/ and directory/
// hold your own plugins and are not checked.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM = /buzz/i;

const contentExempt = (path: string) =>
  ["pnpm-lock.yaml", "scripts/brand.test.ts"].includes(path) || path.startsWith("packages/author/") || /^vendor\/[^/]+\.tgz$/.test(path);

function files() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repo, encoding: "utf8" })
    .split("\0")
    .filter((path) => path && !/^(plugins|directory)\//.test(path) && existsSync(join(repo, path)));
}

describe("the upstream app's name", () => {
  it("is in no file name", () => {
    expect(files().filter((path) => UPSTREAM.test(path))).toEqual([]);
  });

  it("is in no file outside the exempt ones", () => {
    const hits = files()
      .filter((path) => !contentExempt(path))
      .flatMap((path) =>
        readFileSync(join(repo, path), "utf8")
          .split("\n")
          .flatMap((line, index) => (UPSTREAM.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});
