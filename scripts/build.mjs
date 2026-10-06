import { build } from "esbuild";
await build({
  entryPoints: ["electron/main.ts", "electron/telegram-worker.ts"],
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron", "dbus-next"],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
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
await build({
  entryPoints: ["electron/minecraft-worker.ts"],
  outfile: "dist-electron/minecraft-worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["mineflayer", "mineflayer-pathfinder", "vec3"],
});
