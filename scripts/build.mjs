import { build } from "esbuild";
await build({
  entryPoints: ["electron/main.ts"],
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
});
await build({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});
