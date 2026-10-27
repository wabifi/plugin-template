import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import { distManifest } from "./scripts/release/manifest.mjs";
import { embedPluginLicenses, readPluginLicenses } from "./scripts/release/licenses.mjs";

// Builds plugins/<id>/desktop to dist/<id>/{manifest.json, plugin.js}: one
// self-contained API v1 module, the only shape Wabifi desktop's Load from folder accepts.
export function desktopPlugin(desktopDir: string) {
  const pluginDir = dirname(desktopDir);
  const id = basename(pluginDir);
  const manifest = JSON.parse(readFileSync(resolve(pluginDir, "manifest.json"), "utf8"));
  if (manifest.id !== id) throw new Error(`manifest id ${manifest.id} must match folder ${id}`);
  const shipped = distManifest(manifest);
  const listing = JSON.parse(readFileSync(resolve(pluginDir, "../../directory", `${id}.json`), "utf8"));
  const licenses = readPluginLicenses(pluginDir, listing.license);
  return defineConfig({
    publicDir: false,
    oxc: { jsx: { runtime: "classic" } },
    build: {
      outDir: resolve(pluginDir, "../../dist", id),
      emptyOutDir: true,
      lib: { entry: resolve(desktopDir, "src/index.tsx"), formats: ["es"], fileName: () => "plugin.js" },
      rolldownOptions: { output: { codeSplitting: false } },
    },
    plugins: [
      {
        name: "wabifi-api-v1",
        enforce: "pre",
        resolveId(source) {
          if (/^react(?:-dom)?(?:\/|$)/.test(source) || source === "@wabifi/author" || source.startsWith("@deepseek-ai/cordis")) {
            throw new Error(`${source}: Wabifi supplies host capabilities through ctx; use type-only imports`);
          }
        },
        generateBundle(_options, bundle) {
          const outputs = Object.values(bundle);
          const chunk = outputs[0];
          if (outputs.length !== 1 || chunk?.type !== "chunk" || chunk.imports.length) {
            throw new Error("API v1 requires one self-contained JS module, without separate assets");
          }
          if (!chunk.exports.includes("apply")) throw new Error("Export apply(ctx)");
          chunk.code = embedPluginLicenses(chunk.code, licenses);
          // The desktop rejects unknown manifest fields, so distManifest leaves out this repo's own (version).
          this.emitFile({ type: "asset", fileName: "manifest.json", source: `${JSON.stringify(shipped, null, 2)}\n` });
        },
      },
    ],
  });
}
