// Checks a release tag, <id>@<version> (acme.standup-board@0.1.0), before the release workflow
// builds anything: the id must be a plugin in this repo and the version the one in its
// manifest.json. In the workflow it hands id and version to the next steps.
//
//   node scripts/release/tag.mjs acme.standup-board@0.1.0
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "../is-main.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TAG = /^([a-z][a-z0-9.-]*)@([0-9A-Za-z.+-]+)$/;

export function releaseTag(tag, root = repo) {
  const [, id, version] = tag.match(TAG) ?? [];
  if (!id) throw new Error(`"${tag}" is not a release tag. Tag a release as <id>@<version>, like acme.standup-board@0.1.0.`);
  const file = join(root, "plugins", id, "manifest.json");
  if (!existsSync(file)) throw new Error(`${tag}: there is no plugin ${id} here (no plugins/${id}/manifest.json).`);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (typeof manifest.version !== "string") throw new Error(`${tag}: plugins/${id}/manifest.json has no version.`);
  if (manifest.version !== version) {
    throw new Error(`${tag}: plugins/${id}/manifest.json has version ${JSON.stringify(manifest.version)}, not ${version}. Set the version there, commit, then tag that commit.`);
  }
  return { id, version };
}

if (isMain(import.meta.url)) {
  try {
    const { id, version } = releaseTag(process.argv[2] ?? "");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `id=${id}\nversion=${version}\n`);
    console.log(`Releasing ${id} ${version}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
