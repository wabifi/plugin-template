import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// import.meta.url is a real path and argv[1] is as typed. Comparing them directly makes a
// script run from a symlinked checkout (or a macOS tmp dir) exit 0 having done nothing.
export const isMain = (metaUrl) => Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(metaUrl);
