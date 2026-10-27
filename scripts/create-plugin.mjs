// Scaffolds plugins/<id>/: manifest.json, the LICENSE, a core/ module with its first test and
// the desktop/ build, plus the plugin's listing in directory/<id>.json, so `pnpm build` and
// `pnpm test` see the plugin at once. Ids start with the prefix in wabifi.workspace.json.
//
//   pnpm create-plugin standup-board         # -> plugins/acme.standup-board/
//   pnpm create-plugin acme.standup-board    # a full id with this workspace's prefix works too
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./is-main.mjs";
import { LICENSES, licenseId } from "./release/licenses.mjs";
import { workspacePrefix } from "./workspace.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// The longest plugin id Wabifi desktop accepts.
const MAX_ID = 80;

// A kebab-case name, or a full id with this workspace's prefix.
export function pluginId(arg, prefix) {
  const dot = arg.indexOf(".");
  if (dot !== -1 && arg.slice(0, dot) !== prefix) {
    throw new Error(`"${arg}" has another prefix. This workspace's prefix is "${prefix}" (from wabifi.workspace.json), so its plugin ids start with "${prefix}.".`);
  }
  const name = dot === -1 ? arg : arg.slice(dot + 1);
  if (!NAME.test(name)) throw new Error(`"${arg}": use a kebab-case name, like standup-board`);
  const id = `${prefix}.${name}`;
  if (id.length > MAX_ID) throw new Error(`"${id}" is ${id.length} characters; a plugin id can have at most ${MAX_ID}`);
  return id;
}

// New plugins copy the root LICENSE and their listing names it, so it is the one file to
// change for another license.
function rootLicense(root) {
  const file = join(root, "LICENSE");
  if (!existsSync(file)) throw new Error("There is no LICENSE at the root of this workspace. New plugins copy it, so put one there.");
  const text = readFileSync(file, "utf8");
  const license = licenseId(text);
  if (!license) {
    throw new Error(`Can't tell which license LICENSE is. New plugins copy it and their listing names it, so start it with the standard text of one of these: ${LICENSES.join(", ")}.`);
  }
  return { text, license };
}

// "standup-board" -> "Standup board": first word capitalized.
const displayName = (name) => {
  const words = name.split("-").join(" ");
  return words[0].toUpperCase() + words.slice(1);
};

const manifest = (id, name) =>
  `${JSON.stringify({ id, name, apiVersion: 1, version: "0.1.0" }, null, 2)}\n`;

const core = `// Platform-free logic, tested next to this file. The desktop page imports it, so what the
// tests check is what ships. Anything that needs host.runCommand or browser.View is
// desktop-only: keep it out of here (see docs/authoring.md).
export function summary(id: string): string {
  return \`\${id} is running.\`;
}
`;

const coreTest = (id) => `import { describe, expect, it } from "vitest";
import { summary } from "./summary";

describe("summary", () => {
  it("says the plugin is running", () => {
    expect(summary("${id}")).toBe("${id} is running.");
  });
});
`;

const desktopPackage = (id) =>
  `${JSON.stringify(
    {
      name: `${id}-desktop`,
      private: true,
      type: "module",
      scripts: { build: "tsc -p . && vite build" },
    },
    null,
    2,
  )}\n`;

const desktopTsconfig = `{ "extends": "../../../tsconfig.json", "include": ["src"] }\n`;

const desktopViteConfig = `import { desktopPlugin } from "../../../vite.desktop.ts";

export default desktopPlugin(import.meta.dirname);
`;

const desktopEntry = (id, name) => `import type { Context } from "@wabifi/author";
import { summary } from "../../core/summary";

export const inject = ["react", "pages"];

export function apply(ctx: Context) {
  const React = ctx.react;
  ctx.pages.register({
    id: "main",
    title: "${name}",
    primary: true,
    component: function Page() {
      const [count, setCount] = React.useState(0);
      return (
        <section className="ui-card" style={{ padding: "var(--space-panel-inset)" }}>
          <h1>${name}</h1>
          <p>{summary("${id}")}</p>
          <button type="button" onClick={() => setCount(count + 1)}>
            Clicked {count} times
          </button>
        </section>
      );
    },
  });
}
`;

// The listing: what the plugin directory shows about the plugin. tagline, chips and
// description are placeholders, and the publisher is the prefix until you name yourself.
const listingText = (id, name, publisher, license) =>
  `${JSON.stringify(
    {
      schema: 1,
      id,
      type: "plugin",
      name,
      status: "preview",
      tagline: `What ${name} does, in one line.`,
      chips: ["Wabifi desktop", "what it does"],
      description: `What ${name} does, what it reads and what it sends.`,
      publisher: { name: publisher },
      license,
      platforms: { desktop: true, phone: "none" },
    },
    null,
    2,
  )}\n`;

export function scaffoldPlugin(arg, root = repo) {
  const prefix = workspacePrefix(root);
  const id = pluginId(arg, prefix);
  const license = rootLicense(root);
  const name = displayName(id.slice(prefix.length + 1));
  const dir = join(root, "plugins", id);
  if (existsSync(dir)) throw new Error(`plugins/${id}/ already exists`);
  const listing = join(root, "directory", `${id}.json`);
  if (existsSync(listing)) throw new Error(`directory/${id}.json already exists`);
  mkdirSync(join(dir, "core"), { recursive: true });
  mkdirSync(join(dir, "desktop", "src"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), manifest(id, name));
  writeFileSync(join(dir, "LICENSE"), license.text);
  writeFileSync(join(dir, "core", "summary.ts"), core);
  writeFileSync(join(dir, "core", "summary.test.ts"), coreTest(id));
  writeFileSync(join(dir, "desktop", "package.json"), desktopPackage(id));
  writeFileSync(join(dir, "desktop", "tsconfig.json"), desktopTsconfig);
  writeFileSync(join(dir, "desktop", "vite.config.ts"), desktopViteConfig);
  writeFileSync(join(dir, "desktop", "src", "index.tsx"), desktopEntry(id, name));
  mkdirSync(dirname(listing), { recursive: true });
  writeFileSync(listing, listingText(id, name, prefix, license.license));
  return { id, name };
}

if (isMain(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: pnpm create-plugin <name>");
    process.exit(1);
  }
  try {
    const { id } = scaffoldPlugin(arg);
    console.log(`Created plugins/${id}/ and directory/${id}.json.
Next:
  1. pnpm install && pnpm build && pnpm test   # all green out of the box
  2. Write the real tagline, chips and description in directory/${id}.json.
  3. docs/authoring.md has the plugin contract; README.md says how to release.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
