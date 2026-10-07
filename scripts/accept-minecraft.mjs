// Explicit live integration runner. No application profile or provider access.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

if (process.env.EVA_MINECRAFT_LIVE !== "yes")
  throw new Error(
    "Explicit live-world consent required: EVA_MINECRAFT_LIVE=yes.",
  );
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), "eva-minecraft-acceptance-"));
try {
  const outfile = path.join(dir, "acceptance.cjs");
  await build({
    entryPoints: [path.join(root, "tests/live/minecraft-acceptance.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    banner: {
      js: `require = require("node:module").createRequire(${JSON.stringify(path.join(root, "package.json"))});`,
    },
  });
  const child = spawn(process.execPath, [outfile], {
    stdio: "inherit",
    env: process.env,
  });
  const stop = () => child.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
