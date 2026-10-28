# Wabifi plugin template

A workspace for your own Wabifi desktop plugins: the build setup, the tests and a release
workflow. Build a small plugin, run it in your own Wabifi app, then release it from your repo.

## Before you start

- Wabifi for Mac, signed in to at least one community.
- The `wabifi` command: in Wabifi, open Plugins and click New plugin, then choose Link wabifi.
  `which wabifi` then finds it in `~/.local/bin`.
- Node.js 24 and pnpm.
- A GitHub account. Your plugins live in your own public repo.

## Create your workspace

```bash
gh repo create acme-labs/acme-plugins --public --template wabifi/plugin-template --clone
cd acme-plugins
```

Open `wabifi.workspace.json` and set `prefix` to the one you chose in Console. Every plugin id
in this workspace starts with it, like `acme.standup-board`. A prefix is 2 to 31 lowercase
letters or digits, starting with a letter; single dashes may join them. Until you replace
`your-prefix`, creating a plugin stops and says so.

New plugins get a copy of the `LICENSE` file at the top: MIT, with Cloud Kinetix as the
copyright holder. Put your own name there, or replace it with another license's standard
text (`docs/authoring.md` lists which).

## Create a plugin

```bash
wabifi plugin new standup-board
```

This makes `plugins/acme.standup-board/`, with `manifest.json` (its id, name and version),
`LICENSE` and your code in `desktop/src/index.tsx`, plus `directory/acme.standup-board.json`,
what people read about the plugin first. Replace that file's placeholder tagline, chips and
description with your own.

`wabifi plugin new` runs this repo's `pnpm create-plugin` and records the plugin as made on
this Mac, which is what lets Wabifi run your build unsigned. `pnpm create-plugin standup-board`
on its own makes the same files without that record.

## Run it in Wabifi

```bash
pnpm install && pnpm build && pnpm test
wabifi plugin install dist/acme.standup-board --enable --wait
```

The install waits until Wabifi reports the plugin active. Plugins you make run only on this
Mac, unsigned, and show "Made by you". Nobody else gets them until you share or publish.

## Edit with live reload

```bash
pnpm dev standup-board
```

Each save builds the plugin, installs it and waits until the app reports the new revision
active. A build or load error is printed in full, and it keeps watching.

## Release it

Set `version` in `plugins/acme.standup-board/manifest.json` (a new plugin starts at `0.1.0`;
raise it for every later release). Commit it, with `pnpm-lock.yaml` if it changed, and push.
Then push a tag named after the plugin and that version:

```bash
git tag acme.standup-board@0.1.0
git push origin acme.standup-board@0.1.0
```

The release workflow checks the tag against the manifest, builds `plugin.js` on a
GitHub-hosted runner, attests it to your commit, and attaches `plugin.js` and `manifest.json`
to a GitHub Release named after the tag. The attestation needs a public repository. From
Console you then submit the release to the catalog or share it with one community.

Plugins aren't sandboxed: they run with the member's account, on their Mac. Ask only for the
access a plugin needs.

## What's here

- `docs/authoring.md`: the plugin contract, the manifest and listing fields, pages for people
  who aren't developers, testing, releasing, and the path for coding agents.
- `.claude/skills/wabifi-plugin-authoring/`: points coding agents at that guide.
- `scripts/`: `create-plugin`, `dev`, the release tag check, and their tests.
- `vendor/`: the type definitions behind `@wabifi/author`, under their own license.

## License

MIT, copyright Cloud Kinetix, in `LICENSE`. The type definitions in `vendor/` keep their own
license and notices.
