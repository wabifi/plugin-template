import { categoryList } from "./categories.mjs";

// The manifest keys a Wabifi desktop loads, and the one place that says so.
//
// The set is the desktop plugin manager's Manifest (description, discovery,
// host.commands[].maxInputBytes, host.processes, host.mcp, host.files) plus Wabifi's own
// dataSchema and needs. The desktop denies unknown keys, so a key missing here is a plugin that
// builds and then cannot be installed.
const TOP = ["id", "name", "apiVersion", "description", "discovery", "host", "dataSchema", "needs"];
const HOST = ["commands", "networkOrigins", "processes", "mcp", "files"];
const COMMAND = ["id", "program", "args", "maxInputBytes", "maxOutputBytes"];
const PROCESS = ["id", "program", "args", "bundled"];

// The longest description the desktop installs, in bytes of UTF-8 (its Manifest::validate). The
// description is what Plugins shows, and the Wabifi Developers Console refuses a release without one.
export const DESCRIPTION_MAX_BYTES = 280;
export const CONSOLE_NEEDS_DESCRIPTION =
  "The Wabifi Console needs a description in manifest.json before it accepts a release: a sentence or two on what the plugin does, which Plugins shows.";

export const hasDescription = (description) => typeof description === "string" && description.trim() !== "";
export const utf8Bytes = (text) => Buffer.byteLength(text, "utf8");

// The desktop's valid_id, which discovery.category must pass for the plugin to install.
const validId = (value) => typeof value === "string" && value.length <= 80 && /^[a-z][a-z0-9]*([.-][a-z0-9]+)*$/.test(value);

// Why the Wabifi Developers Console would refuse a release of `manifest` (the file at `path`), or
// null: it needs a description of at most 280 bytes, and a category, if any, the desktop installs.
export function manifestRefusal(manifest, path) {
  if (!hasDescription(manifest.description)) return `${path} has no description. ${CONSOLE_NEEDS_DESCRIPTION}`;
  const bytes = utf8Bytes(manifest.description);
  if (bytes > DESCRIPTION_MAX_BYTES) {
    return `${path} has a description of ${bytes} bytes; Wabifi takes at most ${DESCRIPTION_MAX_BYTES}. Shorten it to a sentence or two.`;
  }
  const category = isObject(manifest.discovery) ? manifest.discovery.category : undefined;
  if (category != null && !validId(category)) {
    return `${path} has the category ${JSON.stringify(category)}, and the plugin can't be installed with that category. Use one of ${categoryList}, or leave it out.`;
  }
  return null;
}

// Keys of plugins/<id>/manifest.json that this repo reads and the desktop must never see.
export const REPO_ONLY = ["version"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function unknownKeys(object, allowed, path) {
  return isObject(object) ? Object.keys(object).filter((key) => !allowed.includes(key)).map((key) => `${path}${key}`) : [];
}

// Every key the desktop would reject, as a path (`host.processes[0].cwd`).
export function unknownManifestFields(manifest) {
  const host = isObject(manifest) ? manifest.host : undefined;
  const list = (value) => (Array.isArray(value) ? value : []);
  return [
    ...unknownKeys(manifest, TOP, ""),
    ...unknownKeys(host, HOST, "host."),
    ...list(host?.commands).flatMap((command, index) => unknownKeys(command, COMMAND, `host.commands[${index}].`)),
    ...list(host?.processes).flatMap((process, index) => unknownKeys(process, PROCESS, `host.processes[${index}].`)),
  ];
}

// plugins/<id>/manifest.json as it goes into dist/: the repo-only keys removed.
export const shippedManifest = (manifest) => Object.fromEntries(Object.entries(manifest).filter(([key]) => !REPO_ONLY.includes(key)));

// A key the desktop would refuse stops the build by name instead of surfacing at install.
export function distManifest(manifest) {
  const shipped = shippedManifest(manifest);
  const unknown = unknownManifestFields(shipped);
  if (unknown.length) throw new Error(`manifest.json has fields a Wabifi build refuses: ${unknown.join(", ")}`);
  return shipped;
}
