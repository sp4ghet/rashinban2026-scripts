import * as esbuild from "esbuild";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");
const bundleRoot = "bundles/rashinban";

/** Every .ts file directly inside dir is its own entry point. */
function entries(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

const browserCommon = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: true,
};

/**
 * Tampermonkey userscripts: each tampermonkey/src/*.user.ts becomes
 * tampermonkey/<name>.user.js with its ==UserScript== header preserved as a
 * banner (esbuild would otherwise strip the comment block).
 */
function userscriptBuilds() {
  return entries("tampermonkey/src")
    .filter((f) => f.endsWith(".user.ts"))
    .map((entry) => {
      const header = readFileSync(entry, "utf8").match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0];
      if (!header) throw new Error(`${entry}: missing ==UserScript== header`);
      return {
        entryPoints: [entry],
        outfile: path.join("tampermonkey", path.basename(entry, ".ts") + ".js"),
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2020",
        banner: { js: header },
        legalComments: "none",
      };
    });
}

const builds = [
  ...userscriptBuilds(),
  {
    ...browserCommon,
    entryPoints: entries(`${bundleRoot}/src/graphics`),
    outdir: `${bundleRoot}/graphics`,
  },
  {
    ...browserCommon,
    entryPoints: entries(`${bundleRoot}/src/dashboard`),
    outdir: `${bundleRoot}/dashboard`,
  },
  {
    entryPoints: [`${bundleRoot}/src/extension/index.ts`],
    outdir: `${bundleRoot}/extension`,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    sourcemap: true,
  },
].filter((b) => b.entryPoints.length > 0);

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("esbuild watching for changes...");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log("build complete");
}
