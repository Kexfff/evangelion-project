# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Local-first Electron desktop companion ("Eva"): VRM avatar in a transparent window, streaming LLM chat, ASR/TTS voice, persistent per-character memory, and integrations (Telegram, MCP tools, an app-managed Minecraft Java bot). Providers are user-configured OpenAI-compatible APIs (OpenRouter is the primary LLM target). Requires Node 22.13+ (uses built-in `node:sqlite`).

`PLAN.MD` is the active roadmap and current-status record. `docs/development-history.md` holds per-release notes and validation evidence. `docs/` has feature guides and states exact limitations.

## Commands

```sh
npm run dev            # builds electron/ with esbuild, starts Vite on 127.0.0.1:5173, launches Electron with EVA_DEV_URL
npm run dev:ui         # Vite only: browser preview mode (no providers/credentials/persistence)
npm run typecheck      # tsc --noEmit + syntax check of the plain-JS audio worklet
npm run build          # typecheck + vite build (dist/) + scripts/build.mjs (dist-electron/)
npm test               # vitest core tests (tests/**/*.test.ts, node env)
npx vitest run tests/mcp.test.ts -t "name"   # single core test file / test
npm run test:ui        # Playwright against dev:ui (tests/ui/*.spec.ts), 1 worker
npx playwright test tests/ui/memory.spec.ts  # single UI spec
npm run test:desktop   # build + scripts/smoke-desktop.mjs (real Electron windows, isolated temp profile)
npm run package        # build + electron-builder --dir → release/linux-unpacked/
npm run format         # prettier (there is no linter)
```

- UI tests need `npx playwright install chromium`, or `EVA_TEST_BROWSER=/path/to/chromium`.
- Run GUI suites and Electron smoke tests serially. Running them in parallel breaks synthetic-audio timing.
- The desktop smoke needs a real display or Xvfb. Electron's Ozone headless backend crashes.
- MCP tests spawn `tests/fixtures/mcp-server.mjs` and bind loopback HTTP ports, so restricted sandboxes may need permission.
- Live Minecraft scripts (`test:minecraft:live`, `scripts/smoke-minecraft.mjs`, `scripts/diagnose-minecraft.mjs`) join a real world. They need explicit `EVA_MINECRAFT_LIVE=yes` and permission from the world owner. Never run them, or make paid provider calls, without the user's authorization. See `docs/development.md` and `docs/minecraft-acceptance.md`.

## Architecture

**Process layout.** `scripts/build.mjs` bundles separate entry points:
- `electron/main.ts` → ESM main process. A `createRequire` banner supports bundled CommonJS deps. `electron` and `dbus-next` stay external.
- `electron/preload.ts` → `preload.cjs`. It exposes `window.eva` (the `Bridge` interface in `src/shared/schema.ts`) via `contextBridge`.
- `electron/telegram-worker.ts` → a `worker_threads` worker for Telegram network I/O (heap-capped; it isolates work but is not a sandbox).
- `electron/minecraft-worker.ts` → CJS, run as an Electron `utilityProcess`. Mineflayer stays external, loaded from production deps. The main process talks to it over MCP JSON-RPC (`electron/minecraft-transport.ts`).

The renderer (`src/`) is one Vite/React app serving two windows. `src/main.tsx` picks `Companion` (`?window=companion`, transparent avatar window) or `Settings`.

**IPC contract.** Adding a renderer↔main call touches four places that must stay in sync:
1. The `Bridge` type in `src/shared/schema.ts`.
2. `electron/preload.ts` (`ipcRenderer.invoke("eva:<channel>")`).
3. The `handle("<channel>", …)` registration in `electron/main.ts`. This wrapper rejects callers that are not a trusted top-level frame, and arguments are parsed with zod schemas from `src/shared/*`.
4. The browser-preview stub in `src/bridge.ts`, typically `desktopOnly`.

State reaches the renderer as `RuntimeEvent`s (`{type: "state", state: Snapshot}` etc.) through `src/useCompanion.ts`.

**`src/shared/`** holds zod schemas, types and pure logic imported by both the main process and the renderer: settings, history, MCP, Minecraft, autonomy, game goals, speech cues. Validation lives here so both sides agree.

**Main-process core:**
- `CompanionRuntime` (`electron/runtime.ts`) owns conversation turns for *both* desktop and Telegram. It also owns memory extraction/indexing, autonomy (`autonomy.ts`: openers, reminders, mood) and the `OpenAICompatibleProvider` (`providers.ts`). Its `snapshot()`/`broadcast()` methods build the state pushed to the UI. Plugins attach hooks to it (`tools`, `gameContext`, `pluginSnapshot`, `remote`).
- `Store` (`electron/store.ts`) is the character-scoped JSON database, validated by zod and written atomically with a backup. Mutate it via `store.update(fn)`, then call `runtime.broadcast()`. `MemoryLibrary`/`SemanticMemory` keep the SQLite FTS5/vector index for hybrid recall. Attachments are content-addressed (`attachments.ts`). Secrets go through `CredentialVault` (OS keyring via `safeStorage`, with a labeled AES-GCM fallback).
- `PluginHost` (`electron/plugin-host.ts`) wires the `PluginRegistry` lifecycle (`plugin-lifecycle.ts`) to `TelegramPlugin`, `McpPlugin` and `MinecraftPlugin`. Minecraft is exposed as an app-managed MCP connection, so it shares the MCP permission/grant/approval pipeline. A plugin's enabled setting is separate from its session-only connection/join state; keep them separate.
- Gameplay layering: `GameDirector` (durable policy, budgets, intention selection; never acts) → `GameCoordinator` (plans/verifies goal steps) → the Minecraft worker, which has exclusive ownership of physical actions (`minecraft-engine.ts`, `minecraft-actions.ts`, etc.). Foreground chat takes priority for provider time but never cancels movement.

**Test profile isolation.** `EVA_TEST_DATA_DIR` (an absolute, pre-created disposable directory) redirects `userData`/`sessionData` before any storage opens, including in packaged builds (`electron/test-profile.ts`). Smoke harnesses assert this. Never point tests at the user's real profile.

## Conventions

- Consciousness/mood is a behavior simulation, not sentience. The docs and UI must not claim otherwise. Docs keep "implemented" separate from "live-accepted".
- Release bump (each commit is `vX.Y.Z.` plus a summary):
  - Update the version in `package.json`/`package-lock.json`, `electron/minecraft-transport.ts`, `electron/minecraft-worker.ts` (MCP client/server names) and the label in `src/components/Settings.tsx`.
  - Add a row and validation note to `PLAN.MD`.
  - Add an entry to `docs/development-history.md`.
  - Update the relevant feature doc.
