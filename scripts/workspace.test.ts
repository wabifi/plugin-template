import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PLACEHOLDER, RESERVED, workspacePrefix } from "./workspace.mjs";

const BAD_PREFIX =
  "The prefix in wabifi.workspace.json must be 2 to 31 lowercase letters or digits, starting with a letter. Single dashes may join them.";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

// A workspace root whose wabifi.workspace.json holds `marker` as is (a string) or as JSON.
function workspace(marker?: unknown) {
  const root = mkdtempSync(join(tmpdir(), "workspace-"));
  roots.push(root);
  if (marker !== undefined) {
    writeFileSync(join(root, "wabifi.workspace.json"), typeof marker === "string" ? marker : JSON.stringify(marker));
  }
  return root;
}

describe("workspacePrefix", () => {
  it("reads the prefix and ignores other keys", () => {
    expect(workspacePrefix(workspace({ prefix: "acme", $comment: "ours", team: { size: 3 } }))).toBe("acme");
  });

  it.each(["ab", "a1", "acme-labs", "a1-b2-c3", `a${"b".repeat(30)}`])("accepts %s", (prefix) => {
    expect(workspacePrefix(workspace({ prefix }))).toBe(prefix);
  });

  it("refuses a folder without the marker", () => {
    expect(() => workspacePrefix(workspace())).toThrow(/has no wabifi\.workspace\.json/);
  });

  it.each([["not json"], [[]], ["[]"], [{}], [{ prefix: 3 }], [{ prefix: null }]])("refuses the marker %j", (marker) => {
    expect(() => workspacePrefix(workspace(marker))).toThrow('wabifi.workspace.json must be a JSON object with your prefix, like { "prefix": "acme" }.');
  });

  it.each(["", "a", `a${"b".repeat(31)}`, "Acme", "1acme", "-acme", "acme-", "a--b", "ac_me", "ac.me", "ac me"])(
    "refuses the prefix %j in plain words",
    (prefix) => {
      expect(() => workspacePrefix(workspace({ prefix }))).toThrow(BAD_PREFIX);
    },
  );

  it("refuses each reserved prefix", () => {
    expect(RESERVED).toHaveLength(3);
    expect(RESERVED).toEqual(expect.arrayContaining(["wabifi", "block"]));
    for (const prefix of RESERVED) {
      expect(() => workspacePrefix(workspace({ prefix }))).toThrow(`The prefix "${prefix}" is reserved.`);
    }
  });

  it("refuses the template's placeholder, which is well formed so the desktop still finds the workspace", () => {
    expect(PLACEHOLDER).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    expect(() => workspacePrefix(workspace({ prefix: PLACEHOLDER }))).toThrow(
      `Set your prefix in wabifi.workspace.json first: replace "${PLACEHOLDER}"`,
    );
  });
});
