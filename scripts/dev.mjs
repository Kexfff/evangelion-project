import { spawn } from "node:child_process";
import { createServer } from "vite";
import electronPath from "electron";
await import("./build.mjs");
const server = await createServer();
await server.listen();
const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: { ...process.env, EVA_DEV_URL: "http://127.0.0.1:5173" },
});
const close = async () => {
  child.kill();
  await server.close();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
child.on("error", async (error) => {
  console.error(error.message);
  await server.close();
  process.exit(1);
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
