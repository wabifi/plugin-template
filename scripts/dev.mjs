// The dev loop: on each save under plugins/<id>/, build that plugin, install the build
// into the running Wabifi desktop and wait until the app reports the new revision active.
//
//   pnpm dev standup-board [--wabifi PATH] [--profile NAME] [--home PATH]
//
// A bare name gets the prefix in wabifi.workspace.json (acme.standup-board); a full id works too.
//
// Each cycle runs the plugin's own build script (tsc, then vite), so the loop is green
// only on what `pnpm build` and CI accept, and manifest.json edits reach dist/ too.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isMain } from "./is-main.mjs";
import { workspacePrefix } from "./workspace.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A revision count, measured with ~37 KB bundles (docs/authoring.md, "Restarting the app");
// weigh by bundle size if much larger plugins hit memory first.
export const RESTART_AFTER = 200;

// The plugin id `pnpm dev` was given: a full id or a folder under plugins/ as is, otherwise
// the workspace's prefix and the name.
export function devPluginId(arg, root = repo) {
  return existsSync(join(root, "plugins", arg)) || arg.includes(".") ? arg : `${workspacePrefix(root)}.${arg}`;
}

// `wabifi plugin install` stdout -> the installed revision and the app instances loading it.
export function parseInstall(stdout) {
  const revision = stdout.match(/^Installed \S+ revision ([0-9a-f]+) /m)?.[1];
  const instances = [...stdout.matchAll(/^App: .* \(pid \d+, instance (\S+)\)$/gm)].map((m) => m[1]);
  return { revision, instances };
}

// Counts the distinct plugin revisions each app instance has loaded, in one file per
// instance under dir, so the count survives restarting the watcher and spans worktrees.
// A restarted app is a new instance and starts from zero; identical bytes reuse the
// loaded module and count once.
export function revisionCounter(dir) {
  mkdirSync(dir, { recursive: true });
  return (instances, loaded) =>
    Math.max(
      0,
      ...instances.map((instance) => {
        const file = join(dir, `${instance}.json`);
        const seen = new Set(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);
        seen.add(loaded);
        writeFileSync(file, JSON.stringify([...seen]));
        return seen.size;
      }),
    );
}

function run(command, args, options = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit", cwd: options.cwd });
    const out = { stdout: "", stderr: "" };
    for (const stream of ["stdout", "stderr"]) {
      child[stream]?.on("data", (chunk) => {
        out[stream] += chunk;
        process[stream].write(chunk);
      });
    }
    child.on("error", (error) => done({ code: error.code === "ENOENT" ? 127 : 1, ...out }));
    child.on("close", (code) => done({ code: code ?? 1, ...out }));
  });
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { wabifi: { type: "string" }, profile: { type: "string" }, home: { type: "string" } },
  });
  const [arg] = positionals;
  if (!arg) fail("usage: pnpm dev <name or id> [--wabifi PATH] [--profile NAME] [--home PATH]");
  let id;
  try {
    id = devPluginId(arg);
  } catch (error) {
    fail(error.message);
  }
  const pluginDir = join(repo, "plugins", id);
  const desktopDir = join(pluginDir, "desktop");
  if (!existsSync(desktopDir)) fail(`plugins/${id}/desktop/ does not exist; scaffold with pnpm create-plugin`);
  const wabifi = values.wabifi ?? "wabifi";
  const target = [
    ...(values.home ? ["--home", values.home] : []),
    ...(values.profile ? ["--profile", values.profile] : []),
  ];

  const probe = await run(wabifi, [...target, "plugin", "status"], { capture: true });
  if (probe.code === 127) {
    fail(`${wabifi} not found. Wabifi desktop links it into ~/.local/bin (New plugin offers Link wabifi): have that folder on your PATH, or pass --wabifi <path>.`);
  }
  if (probe.code !== 0) process.exit(probe.code);
  if (/^App: none/m.test(probe.stdout)) fail("No running Wabifi desktop to load the plugin into. Start one, then rerun.");

  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repo, encoding: "utf8" }).trim();
  const count = revisionCounter(join(gitDir, "wabifi-dev"));
  async function cycle() {
    console.log(`\n— building ${id}`);
    if ((await run("pnpm", ["run", "build"], { cwd: desktopDir })).code !== 0) {
      return console.error(`\n✗ BUILD FAILED for ${id}. Fix it and save; still watching.`);
    }
    const install = await run(wabifi, [...target, "plugin", "install", join(repo, "dist", id), "--enable", "--wait", "--timeout", "90"], { capture: true });
    const { revision, instances } = parseInstall(install.stdout);
    if (install.code === 1 || !revision) fail(`wabifi refused or failed (exit ${install.code}, above). Stopped.`);
    // A revision that throws in apply() was still evaluated, so it counts too.
    const loaded = count(instances, `${id}:${revision}`);
    if (install.code === 0) console.log(`\n✓ ${id} ${revision} active. This app instance has loaded ${loaded} plugin revision(s) from pnpm dev.`);
    else if (install.code === 2 && /Plugin loading timed out/.test(install.stderr)) {
      console.error(`\n✗ STALLED: the app paused while loading ${id} ${revision}; not a bug in the plugin. Save again to retry, or run status --wait on it; still watching.`);
    } else if (install.code === 2) console.error(`\n✗ LOAD ERROR: ${id} ${revision} threw in the app (above). Fix it and save; still watching.`);
    else console.error(`\n✗ TIMED OUT: the app never reported ${id} ${revision} active (above, exit ${install.code}). Still watching.`);
    if (loaded >= RESTART_AFTER) {
      console.error(`! Restart Wabifi: it holds ${loaded} plugin revisions in memory, and each stays loaded until a restart. The loop carries on after the restart.`);
    }
  }

  let running = false;
  let pending = false;
  async function trigger() {
    if (running) return void (pending = true);
    running = true;
    do {
      pending = false;
      await cycle();
    } while (pending);
    running = false;
    console.log(`\nWatching plugins/${id}/ — Ctrl-C to stop.`);
  }
  let timer;
  watch(pluginDir, { recursive: true }, (_event, file) => {
    if (file?.split(/[\\/]/).includes("node_modules")) return;
    clearTimeout(timer);
    timer = setTimeout(trigger, 150);
  });
  await trigger();
}

if (isMain(import.meta.url)) await main();
