import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { devPluginId, parseInstall, revisionCounter } from "./dev.mjs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "dev-"));
  roots.push(dir);
  return dir;
}

const installed = `Installed acme.x revision 9f2c01ab (enabled)
Profile: s1a (/Users/a/Library/Application Support/com.wabifi.desktop.dev/profiles/s1a), chosen by the running app
App: com.wabifi.desktop.dev (pid 41, instance 41-7dQe1x)
App: com.wabifi.desktop (pid 52, instance 52-03aaZk)
Active: acme.x 9f2c01ab in com.wabifi.desktop.dev (pid 41)
`;

describe("devPluginId", () => {
  it("puts the workspace's prefix before a bare name", () => {
    const root = tempDir();
    writeFileSync(join(root, "wabifi.workspace.json"), JSON.stringify({ prefix: "acme" }));
    expect(devPluginId("standup-board", root)).toBe("acme.standup-board");
  });

  it("takes a full id, or a folder under plugins/, as is", () => {
    const root = tempDir();
    mkdirSync(join(root, "plugins", "standup"), { recursive: true });
    expect(devPluginId("acme.standup-board", root)).toBe("acme.standup-board");
    expect(devPluginId("standup", root)).toBe("standup");
  });

  it("says why a bare name has no id outside a workspace", () => {
    expect(() => devPluginId("standup-board", tempDir())).toThrow(/has no wabifi\.workspace\.json/);
  });
});

describe("parseInstall", () => {
  it("reads the revision and every app instance from wabifi's install output", () => {
    expect(parseInstall(installed)).toEqual({ revision: "9f2c01ab", instances: ["41-7dQe1x", "52-03aaZk"] });
  });
});

describe("revisionCounter", () => {
  it("counts distinct revisions per app instance, across watcher restarts, and from zero in a new instance", () => {
    const dir = join(tempDir(), "wabifi-dev");
    const count = revisionCounter(dir);
    expect(count(["a"], "acme.x:r1")).toBe(1);
    expect(count(["a"], "acme.y:r2")).toBe(2);
    expect(count(["a"], "acme.y:r2")).toBe(2);
    expect(revisionCounter(dir)(["a"], "acme.x:r3")).toBe(3);
    expect(count(["b"], "acme.x:r3")).toBe(1);
    expect(count(["a", "b"], "acme.x:r4")).toBe(4);
  });
});
