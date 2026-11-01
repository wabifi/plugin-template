// Checks the built dist/<id>/manifest.json before the release workflow uploads it, so a release the
// Wabifi Developers Console would refuse (no description, one over 280 bytes, a category Wabifi
// can't install) fails here, before it exists. The build ran the plugin's code, so the manifest
// checked is the one that ships, not the source tag.mjs read.
//
//   node scripts/release/check-manifest.mjs dist/acme.standup-board/manifest.json
import { readFileSync } from "node:fs";
import { isMain } from "../is-main.mjs";
import { manifestRefusal } from "./manifest.mjs";

export function checkManifest(file) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${file} isn't a JSON object.`);
  const refusal = manifestRefusal(manifest, file);
  if (refusal) throw new Error(refusal);
}

if (isMain(import.meta.url)) {
  try {
    checkManifest(process.argv[2] ?? "");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
