// wabifi.workspace.json marks the root of a plugin workspace and names its prefix: every
// plugin id made here starts with it (acme.standup-board). Wabifi desktop reads the same file
// to recognize the workspace; keys other than prefix are left for you and ignored.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MARKER = "wabifi.workspace.json";
// What the template ships. Well formed on purpose, so the desktop still finds the workspace
// and create-plugin can say what to change.
export const PLACEHOLDER = "your-prefix";
export const RESERVED = ["wabifi", "buzz", "block"];
const PREFIX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function workspacePrefix(root) {
  const file = join(root, MARKER);
  if (!existsSync(file)) {
    throw new Error(`This folder has no ${MARKER}, so it is not a plugin workspace: ${root}
Add one at its root that names your prefix: { "prefix": "acme" }.`);
  }
  let marker;
  try {
    marker = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  if (!isObject(marker) || typeof marker.prefix !== "string") {
    throw new Error(`${MARKER} must be a JSON object with your prefix, like { "prefix": "acme" }.`);
  }
  const { prefix } = marker;
  if (prefix.length < 2 || prefix.length > 31 || !PREFIX.test(prefix)) {
    throw new Error(`The prefix in ${MARKER} must be 2 to 31 lowercase letters or digits, starting with a letter. Single dashes may join them.`);
  }
  if (RESERVED.includes(prefix)) {
    throw new Error(`The prefix "${prefix}" is reserved. Set your own in ${MARKER}, like your team's or company's name.`);
  }
  if (prefix === PLACEHOLDER) {
    throw new Error(`Set your prefix in ${MARKER} first: replace "${PLACEHOLDER}" with a short name for you or your team, like acme.
Your plugin ids start with it: acme.standup-board.`);
  }
  return prefix;
}
