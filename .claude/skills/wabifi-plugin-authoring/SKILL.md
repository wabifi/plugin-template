---
name: wabifi-plugin-authoring
description: Use when making, changing, building, installing, testing or releasing a Wabifi desktop plugin in this workspace, from a one-line description ("make a plugin that…") to a plugin running in the live app. Covers wabifi plugin new, pnpm create-plugin, pnpm dev, the wabifi CLI (wabifi plugin install/status --wait), a plugin that does not load, where to keep a plugin's source, and releasing by tag.
---

# Wabifi plugin authoring

Follow the "Agents" section of `docs/authoring.md` in this repo, from the top. It is the
single source for this work; this skill only points at it. These are its headings, and a
test (`scripts/skill.test.ts`) fails if one disappears:

```
docs/authoring.md
## Agents
### Where to work
### The wabifi CLI
### Starting the app
### The commands
### The done-check
### Restarting the app
### Finishing
## The workspace prefix
## The plugin contract (Wabifi desktop, API v1)
## Pages that non-developers can use
## Releasing
```
