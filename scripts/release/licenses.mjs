import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NOTICE_NAMES = ["LICENSE", "NOTICE", "NOTICE.md", "THIRD-PARTY-NOTICES.txt"];
const PREFIX = "/* wabifi-plugin-licenses:v1\n";
const SUFFIX = "\n*/\n";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// The licenses create-plugin can name in a listing, by how their standard text starts (as
// on choosealicense.com).
const LICENSE_TITLES = [
  ["MIT License", "MIT"],
  ["Apache License Version 2.0", "Apache-2.0"],
  ["BSD 2-Clause License", "BSD-2-Clause"],
  ["BSD 3-Clause License", "BSD-3-Clause"],
  ["ISC License", "ISC"],
  ["Mozilla Public License Version 2.0", "MPL-2.0"],
  ["This is free and unencumbered software released into the public domain.", "Unlicense"],
  ["BSD Zero Clause License", "0BSD"],
];
export const LICENSES = LICENSE_TITLES.map(([, id]) => id);

// The SPDX id of a LICENSE text, or undefined when it starts like none of LICENSES.
export function licenseId(text) {
  const start = text.trim().replace(/\s+/g, " ");
  return LICENSE_TITLES.find(([title]) => start.startsWith(title))?.[1];
}

export function noticesProblems(notices) {
  if (!Array.isArray(notices)) return ["notices must be an array containing LICENSE text"];
  const problems = [];
  const names = new Set();
  for (const [index, notice] of notices.entries()) {
    if (!object(notice) || !NOTICE_NAMES.includes(notice.name) || Object.keys(notice).some((key) => !["name", "text"].includes(key))) {
      problems.push(`notices[${index}] must have a supported name and text only`);
      continue;
    }
    if (names.has(notice.name)) problems.push(`notices has duplicate ${notice.name}`);
    names.add(notice.name);
    if (typeof notice.text !== "string" || !notice.text.trim()) problems.push(`notices[${index}].text must be non-empty`);
  }
  if (!names.has("LICENSE")) problems.push("notices must include LICENSE text");
  return problems;
}

function metadataProblems(metadata) {
  if (!object(metadata)) return ["license metadata must be an object"];
  return [
    ...(typeof metadata.license === "string" && metadata.license.trim() ? [] : ["license metadata needs a non-empty license"]),
    ...noticesProblems(metadata.notices),
    ...(Object.keys(metadata).some((key) => !["license", "notices"].includes(key)) ? ["license metadata has unknown fields"] : []),
  ];
}

// plugins/<id>/LICENSE (required) and any NOTICE files next to it, with the listing's license id.
export function readPluginLicenses(pluginDir, license) {
  const notices = NOTICE_NAMES.filter((name) => name === "LICENSE" || existsSync(join(pluginDir, name)))
    .map((name) => ({ name, text: readFileSync(join(pluginDir, name), "utf8") }));
  const metadata = { license, notices };
  const problems = metadataProblems(metadata);
  if (problems.length) throw new Error(problems.join("\n"));
  return metadata;
}

// The license texts go into plugin.js itself, as a comment ahead of the code.
export function embedPluginLicenses(code, metadata) {
  const problems = metadataProblems(metadata);
  if (problems.length) throw new Error(problems.join("\n"));
  const json = JSON.stringify(metadata).replaceAll("/", "\\u002f").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return PREFIX + json + SUFFIX + code;
}
