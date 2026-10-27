# Authoring a plugin

The path from nothing to a plugin that builds and tests cleanly, in a workspace whose
prefix is `acme`:

```bash
wabifi plugin new my-tool      # scaffolds plugins/acme.my-tool/ + directory/acme.my-tool.json
pnpm install && pnpm build && pnpm test
```

Both are green out of the box. Then replace the scaffold's placeholder tagline, chips and
description in `directory/acme.my-tool.json` and write the real thing.

## Layout

```
wabifi.workspace.json  # this workspace's prefix
LICENSE                # the license new plugins copy
plugins/acme.my-tool/
  manifest.json        # the plugin's id, name, apiVersion, version
  LICENSE              # full license text; embedded in plugin.js
  NOTICE               # optional; NOTICE.md and THIRD-PARTY-NOTICES.txt are also embedded
  core/                # platform-free logic + its Vitest tests
  desktop/             # the Wabifi desktop UI, built to dist/<id>/{manifest.json, plugin.js}
directory/acme.my-tool.json   # the listing: what people read about the plugin
```

Anything that needs `host.runCommand` or `browser.View` runs only in the desktop app: keep it
in `desktop/`, out of `core/`.

## The workspace prefix

Every plugin id in this workspace is `<prefix>.<name>`, and `wabifi.workspace.json` names the
prefix:

```json
{
  "prefix": "acme"
}
```

A prefix is 2 to 31 lowercase letters or digits, starting with a letter; single dashes may join
them (`acme-labs`). Wabifi's own prefixes are reserved. The template ships `your-prefix`, which
`pnpm create-plugin` refuses until you set yours.

`pnpm create-plugin standup-board` makes `acme.standup-board`. A full id works too when it starts
with this workspace's prefix (`acme.standup-board`); one with another prefix is refused.

## The plugin contract (Wabifi desktop, API v1)

`desktop/src/index.tsx` is the entry point. It must:

- export `apply(ctx)` — the host calls it with its capabilities (`ctx.react`,
  `ctx.pages`, sessions, …), and
- export `inject` — the list of those capabilities the plugin uses,
- build to **one self-contained `plugin.js`**: no runtime imports of `react`,
  `@wabifi/author` or Cordis. They arrive through `ctx`; import them type-only. The build
  (`vite.desktop.ts`) refuses anything else, and refuses a bundle with separate assets.

`tsc -p .` runs before `vite build`, so a type error fails the build.

`inject` must be a plain list of string literals. The app refuses a plugin that asks for more
with `ctx.inject()` while it runs.

## License and notices

Put the plugin's complete license text in `plugins/<id>/LICENSE`, and name the same license in
`license` in `directory/<id>.json`, as a single SPDX identifier. Keep any required attribution
and third-party notices in `NOTICE`, `NOTICE.md` or `THIRD-PARTY-NOTICES.txt` beside it. The
build embeds these texts in a JSON comment at the top of `plugin.js`, so they travel with the
code. Do not add licensing keys to `manifest.json`: Wabifi rejects unknown manifest fields.

A new plugin copies the root `LICENSE`, and its listing names that license. The template ships
MIT; to start new plugins under another license, replace the root `LICENSE` with the standard
text of one of MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, Unlicense or 0BSD.
`pnpm create-plugin` refuses a root `LICENSE` it can't tell apart. A plugin that already exists
keeps its own `LICENSE` and listing until you change both.

## Keeping data

Inject `storage` and use `ctx.storage` rather than the webview's `localStorage` or
IndexedDB, which every plugin and the app share:

```ts
export const inject = ["storage"];
export async function apply(ctx) {
  await ctx.storage.set("draft", { text: "hi" });                  // this community
  await ctx.storage.set("theme", "dark", { scope: "identity" });   // every community
}
```

The host keeps it under the plugin's own folder, separate by publisher, signed-in
person and community; it survives an update and is not deleted when the plugin is
removed. One value is limited to 1 MiB and one plugin to 50 MiB per person.

A plugin that already saved data in `localStorage` can move it with
`await ctx.storage.adoptLocalStorage(["draft", "settings"])`: each named key is copied
once (JSON if it parses, otherwise the raw string) and removed from `localStorage`.
Keys already in plugin storage and values over 1 MiB are skipped and reported. Declare
`dataSchema` in the manifest when the stored shape changes, so a later update can
compare versions.

## manifest.json

| field | meaning |
|---|---|
| `id` | `<prefix>.<name>`, immutable once installed; the same as the plugin's folder name. |
| `name` | the display name. Keep it equal to `name` in `directory/<id>.json`. |
| `apiVersion` | `1`. The only shape the Wabifi desktop loads from a folder. |
| `version` | semver. Raise it before each release: the release tag is `<id>@<version>`. It stays in this repo; the build leaves it out of `dist/<id>/manifest.json`. |
| `description` | optional, 1–280 bytes: what the plugin does, in one line. |
| `discovery` | optional `{ "category": "finance", "tags": ["accounting"] }`: hints for where the plugin is shelved. `category` is a lowercase id; `tags` has at most 16. Unknown keys under `discovery` are ignored. |
| `host` | optional block declaring what the plugin needs from the person's computer: `commands` (each `id`, `program`, `args`, optional `maxInputBytes`, `maxOutputBytes`), `networkOrigins`, `processes` (long-lived programs: `id`, `program`, `args`, `bundled`), `mcp` (serve MCP to the agents it runs) and `files` (read files and folders with the person's own access, without starting a program). Ask only for what the plugin uses. |
| `dataSchema` | optional non-negative integer: the version of the data the plugin stores. The host records it beside the data as `schema.json` and in the install receipt; raise it when the shape changes. |
| `needs` | optional list of what the plugin needs on the person's computer: `ai`, `agents` (the Wabifi Agents app), `web-search` and `pack:<id>`, each at most once. Wabifi checks and prepares them before the plugin runs, in the order listed, so a `pack:<id>` that Wabifi Agents runs comes after `ai` and `agents`; a value it does not know marks the plugin as needing a newer Wabifi. |

A Wabifi build older than a key refuses a manifest that has it. `pnpm build` stops on a key no
Wabifi build loads and names it; the app checks the values (lengths, ids, origins) when the
plugin is installed.

## The listing text

`directory/<id>.json` is the listing: what people read about the plugin before they install it.
All of it is public.

| field | meaning |
|---|---|
| `schema`, `id` | `1`, and the plugin's id (the file's name). |
| `type` | `plugin`. |
| `name` | equal to the manifest's `name`. |
| `status` | `available`, `preview` or `retired`. |
| `tagline` | one line: what the plugin does. |
| `chips` | short labels: which app, what it does. |
| `description` | plain paragraphs: what it does, what it reads and what it sends. |
| `publisher` | `{ "name": "…" }`: you or your team. The scaffold puts the prefix here; write your real name. |
| `license` | a single SPDX identifier, matching `plugins/<id>/LICENSE`. |
| `platforms` | `{ "desktop": true, "phone": "none" }`. |
| `models` | optional `[{ "model": "…", "provider": "…" }]`: the models a plugin sets up, if any. Each provider is also one of its `services`. |
| `services` | optional `[{ "name": "GitHub", "use": "Reads your open pull requests …" }]`: every outside service it sends to or reads from, and why. |
| `detailsUrl` | optional. An `https` URL with the plugin's long-form page. |
| `needs` | optional. The same list as the manifest's `needs`: the listing's is read before install, the manifest's after. |

What a desktop plugin can access is not written here: it is read from the plugin's
`export const inject = [...]`.

## Pages that non-developers can use

A plugin's page is used by someone who is not a developer and has no terminal, log or second
attempt to fall back on. Build it so every state it can reach is readable on its own.

### Observed views

Create a `session.observe` view and dispose it in **one** effect. React StrictMode runs mount
effects twice (run, clean up, run again) in the app's dev build: a view made with `useMemo` is
disposed by the first cleanup, the second run's `refresh()` does nothing, and the page sits on
"Loading…" forever while dropping live events.

```tsx
const [view, setView] = React.useState<ReturnType<Session["observe"]>>();
React.useEffect(() => {
  const observed = session.observe([{ kinds: [9], "#h": [channelId] }]);
  setView(observed);
  return () => observed.dispose();
}, [session, channelId]);
React.useEffect(() => {
  if (view) void view.refresh();
}, [view]);
```

Never `const view = React.useMemo(() => session.observe(...), [...])` with the refresh in one
effect and `view.dispose` in another. Guard every use of `view` for `undefined`.

### Multi-step actions

For an action with several steps (create a channel, add an agent, send a message), await each
step and confirm it worked before starting the next. If a step fails, stop and show a
plain-language error with a **Retry** button that resumes from that step and reuses whatever
was already created. Never leave an endless spinner: any "waiting for the first reply" state
says, after about 45 seconds and in plain words, that this is taking longer than usual, and
offers Retry. It keeps waiting, and a reply that arrives later still shows (see "Waiting for
an agent's reply").

```tsx
setStep("Creating the channel…");
const channel = existing ?? (await session.channelCreation.create({ name, visibility: "open" }));
setStep("Adding the assistant…");
await session.memberAdditions.add(channel, assistant.pubkey);
```

### Waiting for an agent's reply

A page that sends its agent a request and shows the reply has to cope with an agent that
answers late, so it follows these rules. The 45-second notice above is only a notice: the page
keeps waiting after it.

1. Keep listening for the reply for as long as the page shows the request. After a while
   show "This is taking longer than usual", but don't stop listening and don't hide a
   reply that arrives after it. An agent that answers at 46 seconds still gets its answer shown.
2. When the reply shows, free the button. The person can send another request right away; it
   never stays on "…is searching…" once the answer is there.
3. Show the reply as readable text, never raw markdown. Either render headings, lists, bold
   and links yourself without parsing HTML (no `dangerouslySetInnerHTML`), letting through only
   `http` and `https` links that open with `rel="noopener noreferrer"`, or tell the agent in
   its prompt to answer in plain text.
4. Show the reply without the agent's leading mention of the person who asked. An agent that
   finished the work is told to @mention the delegator by display name, which can contain
   spaces ("@Alice Smith"), so the reply can start with it, alone on its own line or before
   the answer. Drop `@` plus the person's exact display name when it leads the reply; never
   just the first word. The reply's `p` tags carry the person's pubkey, so strip only when
   the reply's `mentions` include `session.viewer`, and take the name from
   `session.names.resolve(session.viewer)`.
5. Accept the reply wherever the agent puts it. Agents are told to answer in the request's
   thread, and some answer in the channel instead, so read both. `session.messages.send`
   returns the request's event id; keep it, and treat as the reply the agent's first message
   in the channel after the request, or its first reply in that request's thread. Never read
   only `channels.window(channelId).rows`: those are top-level messages, and a page that reads
   only them waits forever for an agent that answers in the thread.

   ```tsx
   const requestId = session.messages.send(channelId, text, [agent.pubkey]);
   const thread = session.thread(channelId, requestId);
   const read = () => {
     const fromThread = thread
       .snapshot()
       .replies.find((row) => row.authorId === agent.pubkey);
     // Window rows are oldest first. Look only after this request's own row, so an answer to
     // an earlier request is never taken for this one.
     const rows = session.channels.window(channelId).rows;
     const at = rows.findIndex((row) => row.id === requestId);
     const fromChannel =
       at < 0 ? undefined : rows.slice(at + 1).find((row) => row.authorId === agent.pubkey);
     const reply = fromThread ?? fromChannel;
     // An agent that finished this work mentions the person back by display name, which can
     // contain spaces ("@Alice Smith"). The reply's p tags name the person: strip "@" plus
     // that exact name only when they do, never just the first word.
     const withoutMention = (row: (typeof rows)[number]) => {
       const name = session.viewer ? session.names.resolve(session.viewer) : undefined;
       return name &&
         session.viewer &&
         row.mentions.includes(session.viewer) &&
         row.content.startsWith(`@${name}`)
         ? row.content.slice(name.length + 1).trim()
         : row.content;
     };
     if (reply) show(withoutMention(reply));
   };
   const offThread = thread.subscribe(read);
   const offChannel = session.channels.subscribeWindow(channelId, read);
   // The thread view starts idle: load it now, and again while waiting, so a reply the live
   // feed missed still arrives.
   void thread.refresh();
   const timer = setInterval(() => void thread.refresh(), 10_000);
   const stop = () => {
     offThread();
     offChannel();
     clearInterval(timer);
     thread.dispose();
   };
   ```

   Call `stop()` once the reply shows, when the person sends a new request, and when the page
   unmounts, so no thread view or timer outlives its request.
6. Test it: drive the page with a reply that arrives after the notice, with a reply in the
   request's thread and one in the channel, and with two requests in a row, and check every
   reply shows and the button is free between them. Also check that a reply that starts with
   the person's mention renders without it (use a display name with a space).

### Inputs

Use plain `<input>`, `<select>` and `<textarea>` (the host draws them as a visible box). A
placeholder is an example and must read as one — start it with "e.g." ("e.g. Kyoto"). Mark
optional fields "(optional)".

```tsx
<input placeholder="e.g. Kyoto" />
<input placeholder="Trip length in days (optional)" />
```

### Buttons

A disabled button always shows why, right next to it ("Pick a country first"). Every click
shows feedback within a second — a label like "Sending…", then the next state, for example
"Travel scout is searching…".

```tsx
<button type="button" disabled={!city}>Find the forecast</button>
{!city && <span style={muted}>Pick a city first</span>}
```

### Words

No technical terms in the UI: no "Claude Code", model ids, provider names, file paths,
"environment", "harness" or JSON. Say "Claude" for Claude, "assistant" for the agent, and
describe what happens in the reader's words.

### Models

A plugin that creates an agent creates it with Claude Sonnet (`model: "sonnet"`) as the
recommended default and leaves the choice to the person: Wabifi shows a model picker above
the plugin's page (Claude, or a local model on this computer). Never build a model or engine
picker into the plugin, and never ask for an API key or a model id. Web search comes with
every agent Wabifi starts.

Create the agent with `ctx.agentControl.create(id, session.scope, session.viewer, edit)`.
Pass `session.scope` exactly as the session hands it: Wabifi takes the community from it.
Never parse, split or rebuild the scope (it is not a URL; it ends in the member's key). If
`create` throws, show its message as it is and offer a retry; it is already in plain words,
and the page must never show the scope or a key. Before calling the plugin done, test the
create path once with a scope shaped like `wss://relay.example.com:<64 hex characters>`:
the plugin passes it through unchanged and recovers from a failed create with a retry.

Wabifi loads its assistant list just after it starts. Before you read it for a harness or an
agent, `await ctx.agentControl.whenReady?.()`, then read `ctx.agentControl.snapshot()`. Use
`snapshot().data` only once it is there: in those first seconds the snapshot is still loading,
and a plugin that reads it too early tells the person Claude isn't set up when it is. The
create-path test covers a snapshot that is still loading: the plugin waits for readiness, then
creates.

A plugin's agent starts when its plugin needs it: its page is open or a mention wakes it. It
sleeps once the page has closed and it has been idle for two minutes. It never starts with the
app, and `setStartOnAppLaunch` and `publishProfile` do nothing: don't call them, and don't add a
setup step or a status check for them. `session.memberAdditions.add(channel, pubkey)` adds the
member and starts nothing, so start the agent with `control.action(id, "start")` first.

## Testing

`pnpm test` runs every `plugins/*/core/**/*.test.ts`, `plugins/*/desktop/**/*.test.ts` and
`scripts/**/*.test.ts` under Vitest. The scaffold's first test sits in `core/`; keep
platform-free logic there and test it there. A desktop page is tested with a colocated
`desktop/**/*.test.ts` that mounts it under `React.StrictMode` with a fake `ctx`; start that
file with `// @vitest-environment jsdom` (jsdom, React and React DOM are already installed).
Real UI behavior is proven by installing the build into the Wabifi desktop: see "Agents".

## Agents

The path for a coding agent (Claude Code, Codex or another) from a one-line description to a
plugin running in the person's Wabifi desktop. The plugin is not done until the app says so:
see "The done-check".

### Where to work

A git worktree of this repo at `.worktrees/plugin-<name>`, on branch `plugin/<name>`,
made from the main checkout:

```bash
git worktree add .worktrees/plugin-my-tool -b plugin/my-tool origin/main
cd .worktrees/plugin-my-tool && pnpm install
```

Never a temp or scratch directory (`$TMPDIR`, `/tmp`, an agent's run folder): an agent's
scratch space is deleted when its run ends, and the plugin's source goes with it.
`.worktrees/` is git-ignored. One plugin per worktree: two worktrees building the same id
install over each other.

### The wabifi CLI

`wabifi` installs a build into the Wabifi desktop that is running, and tells you whether it
loaded. It comes with the app, so it matches the app's version: agents the app starts have it
on `PATH`, and Plugins → New plugin offers to link `~/.local/bin/wabifi` for other shells
(Link wabifi; the arrow next to New plugin links or unlinks it later). If `wabifi` is not
found, ask the person to link it there, or pass `--wabifi <path>` to `pnpm dev`.

It picks the app itself: from `--profile`/`--home`, else the one running desktop. With
desktops running on two profiles it refuses and lists them; choose with `--profile`. Every
command prints the profile it used and each app loading it.

Release builds of Wabifi run an unsigned plugin only when `wabifi plugin new` made it on this
Mac. `install` says which it is: "Made on this Mac" runs; "Not made on this Mac" is refused,
and `--wait` reports the refusal as a load error.

### Starting the app

A Wabifi desktop must be running and signed in, or nothing loads: ask the person to open it
before you install. `wabifi plugin status` shows which app it found.

### The commands

```bash
wabifi plugin new my-tool                      # pnpm create-plugin, recorded as made on this Mac
pnpm install && pnpm build && pnpm test       # install links the new plugin in
wabifi plugin install dist/acme.my-tool --enable --wait
pnpm dev my-tool                               # the same three steps on every save
```

`wabifi plugin new` runs `pnpm create-plugin` and records the plugin's folder, so release
builds run what `install` takes from its `dist/` unsigned, and the app marks it "Made by you".
It refuses temp folders and agent run folders.

`install --enable --wait` prints `Installed <id> revision <sha256> (enabled)`, the profile
and app lines, then `Active: <id> <revision> in <app> (pid N)` once the app has loaded it.
Installing over an enabled plugin swaps it in the running app within about a second, with
no reload.

`pnpm dev <name>` (or the full id) watches `plugins/<id>/`. On each save it runs the plugin's
build (`tsc`, then vite), installs the result and waits until it is active. A build failure,
a load error or a timeout is printed in full and it keeps watching; a refusal (two profiles,
no app running) stops it. Run it in the background and read its output after each save.

Exit codes of `wabifi plugin install --wait` and `wabifi plugin status --wait`:

| code | meaning |
|---|---|
| 0 | every app on the target reports the revision active, in a report newer than the install |
| 1 | error or refusal: two profiles running, revision not installed, replaced or disabled |
| 2 | the plugin threw on load; stderr has `Error: <id> <rev> failed to load in <app> (pid N): <error>`. If `<error>` is `Plugin loading timed out`, the app stalled (see "Restarting the app"): install again |
| 3 | timed out (default 30 s; `--timeout S`) |

Don't pipe its output through `head`: the CLI exits 101 on the broken pipe.

### The done-check

```bash
wabifi plugin status <id> --wait <revision>    # exit 0, with an Active: line
```

`<revision>` is the sha from the `Installed` line. "It built" and "it installed" are not
done. When a change is done, run this on its revision; a non-zero exit is the next thing to
fix.

### Restarting the app

Every revision the app loads stays in its memory until it restarts: browser modules cannot
be unloaded. `pnpm dev` counts the distinct revisions it has loaded into each app instance, failed
ones included, and from 200 on it says to restart Wabifi. The count lives in the repo's
git directory (`wabifi-dev/<instance>.json`), so it carries across watcher restarts and
worktrees; installs run by hand are not counted.

Measured on 2026-10-15, screen locked, installing distinct ~37 KB revisions into one app
instance:

| revisions loaded | webview footprint | time to `Active:` |
|---|---|---|
| 0 | 118 MB | |
| 100 | 118 MB | median 1.1 s throughout |
| 200 | 153 MB | |
| 400 | 176 MB | |

Nothing slowed or broke by 400; each revision held about 0.15 MB, about four times its
bundle. 200 caps that at about 35 MB for a plugin of that size; a much larger bundle holds
proportionally more, so restart sooner. On a locked screen the whole webview sometimes
pauses for up to a minute, at any revision count. `--wait` then times out (exit 3)
saying the app "has not reported", or it fails with `Plugin loading timed out` — that is
the app, not the plugin; `pnpm dev` waits 90 s and says STALLED. Wait on the same
revision again.

### Finishing

Write the real tagline, chips and description in `directory/<id>.json`, run `pnpm test`, and
commit on `plugin/<name>`, `pnpm-lock.yaml` included: adding a plugin changes it, and the
release workflow installs from it as it is. Then merge into `main` the way this repo takes
changes. Releasing is a separate step ("Releasing").

## Releasing

A release is a tag named after the plugin and its version, `<id>@<version>`:

```bash
# raise "version" in plugins/acme.my-tool/manifest.json, then commit and push it
git tag acme.my-tool@0.2.0
git push origin acme.my-tool@0.2.0
```

`.github/workflows/release.yml` runs on that tag, on a GitHub-hosted runner:

1. `node scripts/release/tag.mjs <tag>` checks that the plugin exists and that its manifest
   has that version. Run it yourself before tagging.
2. `pnpm install --frozen-lockfile`, then the plugin's build.
3. It attests `dist/<id>/plugin.js` to the tagged commit (GitHub build provenance). Anyone can
   check a download with `gh attestation verify plugin.js --repo <owner>/<repo>`.
4. It attaches `plugin.js` and `manifest.json` to the GitHub Release named after the tag,
   creating the release if it doesn't exist.

On GitHub Free, Pro and Team plans the attestation step needs a public repository. Another
workflow can run the same release with `uses: <owner>/<repo>/.github/workflows/release.yml@<ref>`,
the input `tag`, and `contents`, `id-token` and `attestations` write permissions.
