// The release workflows' layout. The plugin's build runs the developer's code and every
// dependency's install script, so it gets no write access; the job that holds write access and
// the OIDC token runs none of it. And the catalog accepts only a plugin.js attested by
// wabifi/plugin-template/.github/workflows/release.yml, which GitHub names as the signer only when
// a repo calls that workflow, so release.yml is reusable and a small caller runs it on a tag.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { TAG } from "./tag.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflows = join(repo, ".github", "workflows");
const load = (file: string) => parse(readFileSync(join(workflows, file), "utf8"));
const all = readdirSync(workflows).filter((file) => /\.ya?ml$/.test(file)).map((file) => [file, load(file)] as const);

const release = load("release.yml");
const CALLER = "release-on-tag.yml";

type Step = { name?: string; uses?: string; run?: string; id?: string; with?: Record<string, unknown>; env?: Record<string, unknown> };
type Job = { permissions?: unknown; steps?: Step[]; uses?: string; needs?: unknown; with?: Record<string, unknown> };

const jobs = (workflow: any): [string, Job][] => Object.entries(workflow.jobs ?? {});

// A job's token can write when its permissions (or, with none of its own, the workflow's) grant
// any write. With neither, GitHub's default token may write.
function writes(workflow: any, job: Job) {
  const permissions = job.permissions ?? workflow.permissions;
  if (permissions === undefined || permissions === "write-all") return true;
  return typeof permissions === "object" && Object.values(permissions ?? {}).includes("write");
}

// A step runs code from the repo when it checks it out, runs a package manager or node, or runs
// one of the repo's own files or actions.
// It sees only this file's steps, not what an action runs inside; the release job's exact list of
// actions covers that for the job that can write.
const RUNS_CODE = /(^|[\s;&|(`])(pnpm|npm|npx|node|yarn|bun|deno|corepack)(\s|$)|(^|[\s"'])\.{0,2}\/?scripts\/|\.\/[\w.-]/m;
const runsCode = (step: Step) =>
  Boolean(step.uses?.startsWith("actions/checkout@") || step.uses?.startsWith("./") || (step.run && RUNS_CODE.test(step.run)));

const writeJob = () => {
  const found = jobs(release).filter(([, job]) => writes(release, job));
  expect(found.map(([name]) => name)).toEqual(["release"]);
  return found[0][1];
};

describe("release.yml", () => {
  it("is a reusable workflow, called with the tag only", () => {
    expect(Object.keys(release.on)).toEqual(["workflow_call"]);
    expect(Object.keys(release.on.workflow_call.inputs)).toEqual(["tag"]);
    expect(release.on.workflow_call.inputs.tag).toMatchObject({ type: "string", required: true });
    expect(release.permissions).toEqual({});
  });

  it("builds with read access only, from the pushed commit, without keeping the checkout's token", () => {
    const build = release.jobs.build as Job;
    expect(build.permissions).toEqual({ contents: "read" });
    // The commit GitHub attests as the source, even if the tag moves before the job starts.
    const checkout = build.steps!.find((step) => step.uses?.startsWith("actions/checkout@"))!;
    expect(checkout.with).toMatchObject({ ref: "${{ github.sha }}", "persist-credentials": false });
    expect(build.steps!.some((step) => step.run && /pnpm install --frozen-lockfile/.test(step.run))).toBe(true);
    const upload = build.steps!.find((step) => step.uses?.startsWith("actions/upload-artifact@"))!;
    expect(String(upload.with!.path).trim().split("\n")).toEqual([
      "dist/${{ steps.tag.outputs.id }}/plugin.js",
      "dist/${{ steps.tag.outputs.id }}/manifest.json",
    ]);
    expect(Number(upload.with!["retention-days"])).toBeLessThanOrEqual(1);
    expect(Object.keys((build as any).outputs)).toEqual(["id", "version"]);
  });

  it("checks the built manifest's description before uploading it, so a release the Console would refuse never exists", () => {
    const steps = (release.jobs.build as Job).steps!;
    const built = steps.findIndex((step) => step.run?.includes("build") && step.run.includes("pnpm --filter"));
    const check = steps.findIndex((step) => step.name === MANIFEST_CHECK);
    const upload = steps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(built).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(built);
    expect(upload).toBeGreaterThan(check);
    expect(steps[check].env).toEqual({ ID: "${{ steps.tag.outputs.id }}" });
  });

  it("checks that a push of the tag started the run before anything else", () => {
    const [first] = (release.jobs.build as Job).steps!;
    expect(first.id).toBe("pushed");
    expect(first.env).toEqual({ TAG: "${{ inputs.tag }}", REF: "${{ github.ref }}" });
    expect(first.run).not.toContain("${{");
  });

  it("releases in a job that needs the build and holds the write permissions", () => {
    const job = writeJob();
    expect(job.needs).toBe("build");
    expect(job.permissions).toEqual({ contents: "write", "id-token": "write", attestations: "write" });
  });

  it("runs only the artifact download and the attestation in the job that can write", () => {
    const job = writeJob();
    const actions = job.steps!.flatMap((step) => (step.uses ? [step.uses.split("@")[0]] : []));
    expect(actions).toEqual(["actions/download-artifact", "actions/attest-build-provenance"]);
  });

  it("checks the build's id and version before any step uses them, and never puts them in a script", () => {
    const steps = writeJob().steps!;
    const check = steps.findIndex((step) => step.id === "check");
    expect(check).toBeGreaterThanOrEqual(0);
    steps.forEach((step, index) => {
      if (JSON.stringify(step).includes("needs.")) expect(index, JSON.stringify(step)).toBeGreaterThanOrEqual(check);
      if (step.run) expect(step.run).not.toContain("${{");
    });
    expect(steps[check].env).toEqual({ ID: "${{ needs.build.outputs.id }}", VERSION: "${{ needs.build.outputs.version }}" });
  });
});

describe("the release job's check of id and version", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  // Runs the check step's script as the runner would (bash -e), from an empty temp dir.
  function check(tag: string, id: string, version: string) {
    const script = writeJob().steps!.find((step) => step.id === "check")!.run!;
    const cwd = mkdtempSync(join(tmpdir(), "release-check-"));
    dirs.push(cwd);
    return spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH, TAG: tag, ID: id, VERSION: version },
    }).status;
  }

  it.each([
    ["acme.standup-board", "0.1.0"],
    ["a", "1.0.0-rc.1+build.5"],
    ["acme.standup-board", "0.1.0\n"],
    ["Acme.standup-board", "0.1.0"],
    ["../acme", "0.1.0"],
    ["acme/x", "0.1.0"],
    ["acme", "$(touch pwned)"],
    ["acme", "0.1 .0"],
    ["acme", ""],
    ["", "0.1.0"],
    ["acme@x", "0.1.0"],
    ["ácme", "0.1.0"],
    ["acme\nx", "0.1.0"],
  ])("passes id %j and version %j only when tag.mjs would", (id, version) => {
    const tag = `${id}@${version}`;
    expect(check(tag, id, version)).toBe(TAG.test(tag) ? 0 : 1);
  });

  it("fails an id and version that are not the tag's", () => {
    expect(check("acme.standup-board@0.1.0", "acme.standup-board", "0.2.0")).toBe(1);
    expect(check("acme.standup-board@0.1.0", "acme.retro", "0.1.0")).toBe(1);
  });
});

const MANIFEST_CHECK = "Check the built manifest's description";

describe("the build's check of the built manifest", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  // Runs the step's script as the runner would (bash -e) in a plugin repo's checkout: dist/acme.x/
  // holds the built manifest, and scripts/ is this template's when `scripts` is true.
  function checkBuilt(manifest: Record<string, unknown>, { scripts }: { scripts: boolean }) {
    const script = (release.jobs.build as Job).steps!.find((step) => step.name === MANIFEST_CHECK)!.run!;
    const cwd = mkdtempSync(join(tmpdir(), "release-manifest-"));
    dirs.push(cwd);
    mkdirSync(join(cwd, "dist", "acme.x"), { recursive: true });
    writeFileSync(join(cwd, "dist", "acme.x", "manifest.json"), JSON.stringify(manifest));
    if (scripts) cpSync(join(repo, "scripts"), join(cwd, "scripts"), { recursive: true });
    return spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH, ID: "acme.x" },
    });
  }

  const described = { id: "acme.x", name: "X", apiVersion: 1, description: "Counts things." };

  it("passes a manifest with a description and fails one without", () => {
    expect(checkBuilt(described, { scripts: true }).status).toBe(0);
    const { description: _, ...bare } = described;
    const run = checkBuilt(bare, { scripts: true });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("no description");
  });

  // Plugin repos call release.yml at main, and one made from an older copy of this template has no
  // check-manifest.mjs. Its release must still run: the Wabifi Console checks the description.
  it("still releases from a plugin repo whose scripts predate check-manifest.mjs", () => {
    const run = checkBuilt(described, { scripts: false });
    expect(run.status, run.stderr).toBe(0);
    const { description: _, ...bare } = described;
    expect(checkBuilt(bare, { scripts: false }).status).toBe(0);
  });
});

describe("the build's check that the tag started the run", () => {
  function pushed(ref: string, tag: string) {
    const script = (release.jobs.build as Job).steps!.find((step) => step.id === "pushed")!.run!;
    const cwd = mkdtempSync(join(tmpdir(), "release-pushed-"));
    try {
      return spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
        cwd,
        encoding: "utf8",
        env: { PATH: process.env.PATH, TAG: tag, REF: ref },
      }).status;
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  it.each([
    ["refs/tags/acme.standup-board@0.1.0", "acme.standup-board@0.1.0", 0],
    ["refs/tags/acme.standup-board@0.2.0", "acme.standup-board@0.1.0", 1],
    ["refs/heads/main", "acme.standup-board@0.1.0", 1],
    ["refs/heads/acme.standup-board@0.1.0", "acme.standup-board@0.1.0", 1],
    ["refs/tags/acme.standup-board@0.1.0", "", 1],
  ])("given ref %j and tag %j, exits %i", (ref, tag, status) => {
    expect(pushed(ref, tag)).toBe(status);
  });
});

describe("the release job's attach step", () => {
  // Runs the step's script against a stub gh that logs each call, from an empty temp dir. Console
  // reads a release's files from the webhook GitHub sends when it's published, so a new release
  // must be published with both files already attached.
  function attach(releaseExists: boolean) {
    const script = writeJob().steps!.find((step) => (step as { name?: string }).name?.startsWith("Attach"))!.run!;
    const dir = mkdtempSync(join(tmpdir(), "release-attach-"));
    try {
      const bin = join(dir, "bin");
      const log = join(dir, "gh.log");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "gh"),
        '#!/bin/bash\nprintf "%s\\n" "$*" >> "$GH_LOG"\nif [ "$1 $2" = "release view" ]; then exit "$VIEW_STATUS"; fi\n',
        { mode: 0o755 },
      );
      const run = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
        cwd: dir,
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          TAG: "acme.standup-board@0.1.0",
          ID: "acme.standup-board",
          VERSION: "0.1.0",
          GH_LOG: log,
          VIEW_STATUS: releaseExists ? "0" : "1",
        },
      });
      expect(run.status, run.stderr).toBe(0);
      return readFileSync(log, "utf8").trim().split("\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("creates a new release with plugin.js and manifest.json, so it's published with both", () => {
    const [view, create, ...rest] = attach(false);
    expect(view).toBe("release view acme.standup-board@0.1.0");
    expect(create).toMatch(/^release create acme\.standup-board@0\.1\.0 release\/plugin\.js release\/manifest\.json --verify-tag /);
    expect(rest).toEqual([]);
  });

  it("attaches both files to an existing release, then publishes it if a failed run left a draft", () => {
    expect(attach(true)).toEqual([
      "release view acme.standup-board@0.1.0",
      "release upload acme.standup-board@0.1.0 release/plugin.js release/manifest.json --clobber",
      "release edit acme.standup-board@0.1.0 --draft=false",
    ]);
  });
});

describe(CALLER, () => {
  it("calls plugin-template's release workflow on a tag push, with the tag and the three write permissions", () => {
    const caller = load(CALLER);
    expect(caller.on).toEqual({ push: { tags: ["*@*"] } });
    expect(caller.permissions).toEqual({});
    const [[, job], ...rest] = jobs(caller);
    expect(rest).toEqual([]);
    expect(job.uses).toMatch(/^wabifi\/plugin-template\/\.github\/workflows\/release\.yml@[\w.-]+$/);
    expect(job.permissions).toEqual({ contents: "write", "id-token": "write", attestations: "write" });
    expect(job.with).toEqual({ tag: "${{ github.ref_name }}" });
  });
});

// check.yml runs on pull requests and pushes, in this repo and in every repo made from it. The
// automatic review looks up the lockfile's packages with OSV-Scanner and notes any known advisory,
// so the check runs the same lookup and fails where the review would note one.
const CHECK = "check.yml";

describe(CHECK, () => {
  const check = load(CHECK);
  const steps = (job: string) => (check.jobs[job] as Job).steps!;

  it("runs on every pull request and every push to main, with read access only", () => {
    expect(check.on).toEqual({ pull_request: null, push: { branches: ["main"] } });
    expect(check.permissions).toEqual({});
    for (const [name, job] of jobs(check)) expect(job.permissions, name).toEqual({ contents: "read" });
  });

  it("installs from the lockfile and builds every plugin", () => {
    expect(steps("build").flatMap((step) => (step.run ? [step.run] : []))).toEqual(["pnpm install --frozen-lockfile", "pnpm build"]);
  });

  it("downloads one OSV-Scanner release, pinned by its digest", () => {
    const [{ env }] = steps("dependencies").filter((step) => step.run);
    expect(env!.URL).toMatch(/^https:\/\/github\.com\/google\/osv-scanner\/releases\/download\/v\d+\.\d+\.\d+\/osv-scanner_linux_amd64$/);
    expect(env!.SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  // Runs the lookup step's script as the runner would (bash -e), from an empty temp dir, with stub
  // curl and sha256sum. The stub curl's download is a stub scanner that logs its arguments.
  function lookup({ scan, sum }: { scan: number; sum: number }) {
    const step = steps("dependencies").find((step) => step.run)!;
    const dir = mkdtempSync(join(tmpdir(), "check-lookup-"));
    try {
      const bin = join(dir, "bin");
      const log = join(dir, "scanner.log");
      mkdirSync(bin);
      writeFileSync(join(dir, "stub-scanner"), '#!/bin/bash\nprintf "%s\\n" "$@" > "$SCAN_LOG"\nexit "$SCAN_STATUS"\n');
      writeFileSync(join(bin, "curl"), '#!/bin/bash\nwhile [ $# -gt 0 ]; do if [ "$1" = -o ]; then cp "$STUB_SCANNER" "$2"; fi; shift; done\n', { mode: 0o755 });
      writeFileSync(join(bin, "sha256sum"), '#!/bin/bash\ncat > /dev/null\nexit "$SUM_STATUS"\n', { mode: 0o755 });
      const run = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step.run!], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...(step.env as Record<string, string>),
          PATH: `${bin}:${process.env.PATH}`,
          RUNNER_TEMP: dir,
          STUB_SCANNER: join(dir, "stub-scanner"),
          SCAN_LOG: log,
          SCAN_STATUS: String(scan),
          SUM_STATUS: String(sum),
        },
      });
      const args = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : null;
      const config = existsSync(join(dir, "osv-scanner.toml")) ? readFileSync(join(dir, "osv-scanner.toml"), "utf8") : null;
      return { status: run.status, args, config, dir };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("scans pnpm-lock.yaml with a config that ignores nothing, and passes when no package has an advisory", () => {
    const { status, args, config, dir } = lookup({ scan: 0, sum: 0 });
    expect(status).toBe(0);
    expect(args).toEqual(["scan", "source", "--config", join(dir, "osv-scanner.toml"), "--lockfile", "pnpm-lock.yaml"]);
    expect(config).toBe("");
  });

  it("fails when a package has a known advisory", () => {
    expect(lookup({ scan: 1, sum: 0 }).status).toBe(1);
  });

  it("runs no scanner whose digest is not the pinned one", () => {
    const { status, args } = lookup({ scan: 0, sum: 1 });
    expect(status).not.toBe(0);
    expect(args).toBeNull();
  });
});

describe.each(all)("%s", (_file, workflow) => {
  it("gives no write access to a job that checks out or runs the repo's code", () => {
    for (const [name, job] of jobs(workflow)) {
      if ((job.steps ?? []).some(runsCode)) expect(writes(workflow, job), name).toBe(false);
    }
  });

  it("pins every action to a full commit SHA", () => {
    for (const [, job] of jobs(workflow)) {
      for (const step of job.steps ?? []) if (step.uses) expect(step.uses).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
  });
});
