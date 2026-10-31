// The release workflows' layout. The plugin's build runs the developer's code and every
// dependency's install script, so it gets no write access; the job that holds write access and
// the OIDC token runs none of it. And the catalog accepts only a plugin.js attested by
// wabifi/plugin-template/.github/workflows/release.yml, which GitHub names as the signer only when
// a repo calls that workflow, so release.yml is reusable and a small caller runs it on a tag.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { TAG } from "./tag.mjs";

const workflows = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), ".github", "workflows");
const load = (file: string) => parse(readFileSync(join(workflows, file), "utf8"));
const all = readdirSync(workflows).filter((file) => /\.ya?ml$/.test(file)).map((file) => [file, load(file)] as const);

const release = load("release.yml");
const CALLER = "release-on-tag.yml";

type Step = { uses?: string; run?: string; id?: string; with?: Record<string, unknown>; env?: Record<string, unknown> };
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
