// The manifest keys a Wabifi desktop loads, and the one place that says so.
//
// The set is block/buzz-app's Manifest (upstream crates/plugin-manager/src/lib.rs: description,
// discovery, host.commands[].maxInputBytes, host.processes, host.mcp, host.files) plus Wabifi's own
// dataSchema and needs. The desktop denies unknown keys, so a key missing here is a plugin that
// builds and then cannot be installed.
const TOP = ["id", "name", "apiVersion", "description", "discovery", "host", "dataSchema", "needs"];
const HOST = ["commands", "networkOrigins", "processes", "mcp", "files"];
const COMMAND = ["id", "program", "args", "maxInputBytes", "maxOutputBytes"];
const PROCESS = ["id", "program", "args", "bundled"];

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
