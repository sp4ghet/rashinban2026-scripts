import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";
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

const builds = [
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
