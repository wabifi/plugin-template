import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(repo, ".claude/skills/wabifi-plugin-authoring/SKILL.md");

// The skill's first fenced block: the doc it points at, then the headings it names.
function pointer() {
  const block = readFileSync(skill, "utf8").match(/```\n([\s\S]*?)```/)?.[1] ?? "";
  const [doc, ...headings] = block.trim().split("\n");
  return { doc, headings };
}

describe("wabifi-plugin-authoring skill", () => {
  it("names only headings that exist in the doc it points at", () => {
    const { doc, headings } = pointer();
    expect(headings).toContain("## Agents");
    const lines = readFileSync(join(repo, doc), "utf8").split("\n");
    expect(headings.filter((heading) => !lines.includes(heading))).toEqual([]);
  });
});
