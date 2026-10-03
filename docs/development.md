# Development and verification

[← Documentation](README.md) · [Project home](../README.md)

```sh
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run test:desktop
```

If Chromium is already installed elsewhere, set `EVA_TEST_BROWSER` to its executable for UI tests. The UI suite covers MCP connection forms, grants, one-time approvals and emergency stop; live overview statistics; the conversation archive; memory constellation/library controls; Telegram pairing; Consciousness; images; speech delivery; browser preview; fixture MP3 audio and synthetic microphone input. Core tests cover these features' data/permission boundaries, extraction recovery, provider adapters, shared memory, scheduling, Telegram and the MCP transport/tool pipeline. No live MCP service, real Telegram account or paid provider is contacted.

MCP integration tests launch `tests/fixtures/mcp-server.mjs` with Node and create disposable loopback HTTP servers. The suite needs permission to spawn that process and bind localhost. It verifies real SDK negotiation, stdio and Streamable HTTP (JSON and SSE responses), secret injection, bounded responses and cancellation, alongside mocked grants, approval expiry, session isolation, metadata invalidation and redacted audit tests. Restricted sandboxes may need explicit permission to run these tests.

v0.4.1 adds 18 Minecraft core tests and two settings UI tests: **143 core tests and 30 browser tests pass**, along with the production build, full desktop smoke and optional packaged Minecraft smoke. Core tests use simulated game state; ordinary test commands do not connect to Minecraft. The Linux unpacked main/worker bundles and avatar match source. See [PLAN.MD](../PLAN.MD) for the live-test record and remaining acceptance work.

The desktop smoke test opens temporary Electron windows on your normal display and uses an isolated profile under the system temporary directory. It verifies real local HTTP calls through IPC, VRM/VRMA loading, model lists, semantic recall, sentence ordering, synthetic-microphone interruption, archive round-trips, and persistence across restarts without a keyring. It also verifies an authorized reminder across restart, typing deferral, cancellation, activity logs, immediate autonomy pause, and real plugin installation/settings, encrypted token/grant persistence and removal. It then closes its windows and removes its own test data. File/confirmation dialogs are stubbed. The test does not use your credentials or app profile. A real display (or an X virtual framebuffer) is recommended: Electron's Ozone headless backend crashed during validation here. Live Telegram connectivity and actual vision/ASR/TTS quality still need validation with your bot and providers.

The desktop smoke also checks the conversation archive through real IPC: old sessions remain readable after starting fresh, image payloads load only on request, foreign-character queries are rejected, and the settings history browser opens an archived thread and image.

The extended MCP desktop smoke configures and launches the local fixture through real IPC (with its native trust dialog stubbed), grants an ask-each-time tool, approves it in Settings, and verifies the tool result reaches the fixture LLM. It then restarts Electron, checks connection/secret/grant persistence, exercises emergency stop and removes the fixture configuration. App shutdown waits for managed subprocess cleanup. The ESM main-process build includes a `createRequire` shim for bundled CommonJS dependencies used by the SDK's subprocess transport.

v0.4.8 integration UI verification: **213 core tests, 31 browser tests**, production/package build and isolated desktop smoke pass. The new integration hub has coverage for preserving drafts across views, tool search/category/permission filters, keyboard navigation, narrow layouts, global emergency stop and auto-opening approvals. Desktop and narrow screenshots were reviewed. Tests use fixture servers and disposable profiles, not live Minecraft or Telegram connections.

## Optional live Minecraft smoke

Only run against a world whose owner permits joining and movement. Build the app first, open a Java 26.1 LAN world, then explicitly opt in:

```sh
EVA_MINECRAFT_LIVE=yes EVA_MC_PLAYER=YourPlayerName node scripts/smoke-minecraft.mjs
```

The script defaults to `127.0.0.1:25556`; `EVA_MC_PORT` changes the port. It uses an isolated temporary app profile and fixture LLM, joins as `EvaCompanion`, observes inventory/state, saves a temporary landmark, follows the supplied player, verifies concurrent chat and stop, then emergency-disconnects. Omit `EVA_MC_PLAYER` to skip following. Block edits and public chat remain disabled. It closes the app and removes its own profile afterward; it does not alter your saved application settings. Native trust dialogs are stubbed only in this test.

With explicit permission to issue read-only operator queries, set `EVA_MC_LOOKUP=yes` and `EVA_MC_PLAYER` to a player beyond entity tracking range. This additionally requires a real operator-sourced coordinate response, then allows up to two minutes for actual follow arrival. The world owner must enable cheats and grant the bot the required permission first. Since v0.4.6, the harness explicitly blocks mining, building and public chat before requesting any movement; this also disables terrain-changing navigation. Legacy configuration booleans alone are no longer permission controls.

Set `EVA_TEST_EXECUTABLE` to the unpacked app executable to repeat the same test against a packaged build. The packaged worker loads Mineflayer and its data files from production dependencies and uses Electron's Node runtime, not a separately installed executable.

**Packaged-test safety:** use v0.4.2 or later. v0.4.1 ignored `EVA_TEST_DATA_DIR` when packaged, allowing fixture settings/history to reach the normal profile. Both smoke harnesses now verify the actual `userData` and `sessionData` paths before fixture operations, and the app applies the override before opening storage in all builds. Do not run the old packaged smoke against a v0.4.1 binary.

`node scripts/smoke-isolation.mjs` verifies an isolated settings write without connecting to Minecraft or any provider; `EVA_TEST_EXECUTABLE` selects a packaged executable. Optionally set `EVA_TEST_GUARD_PROFILE` to a closed app's `companion.json` to assert that its SHA-256 stays unchanged. The guard reads only; it never edits the normal profile.

v0.4.2 verification: **148 core tests**, production build, full desktop regression smoke and packaged isolation smoke pass. The guarded normal profile was unchanged by the packaged test. The renderer's only v0.4.2 change is its version label; the 30-test UI result above is from v0.4.1.

v0.4.3 verification: **154 core tests, 30 UI tests**, production/package build, full desktop smoke and packaged live Minecraft smoke pass. Following tests now require observed proximity within four blocks, not merely a running job; both source and packaged live trials traversed terrain and reached the player. The UI tests also cover resetting legacy movement limits and granting everyday tools without enabling public chat or block edits.

v0.4.4 verification: **167 core tests, 30 UI tests**, production/package build and desktop smoke pass. Packaged live testing obtained operator coordinates from about 302 blocks away, followed to within four blocks and emergency-disconnected. Styled 26.1 NBT replies, stale-coordinate labels, command timeout/cancellation, distant waypoints and Free play gates/materials have regression coverage. No destructive Free play behavior was live-tested.

See [PLAN.MD](../PLAN.MD) for architecture, sprint checklists, limitations, and the validation record.

### Bounded physics diagnostic

Close the app before using the same bot account. With permission to join and move, compile and run the 90-second diagnostic below. It uses the app's follow engine and velocity compatibility plugin, prints physics tick/position-packet counts and received/applied knockback, and never loads an app profile. It disables block changes, public chat and operator commands. A nearby player can hit Eva and walk away to exercise knockback and following. Printed coordinates/player names are local diagnostic output.

```sh
npx esbuild scripts/diagnose-minecraft.mjs --bundle --platform=node --format=cjs --external:mineflayer --external:mineflayer-pathfinder --external:vec3 --outfile=test-results/minecraft-diagnostic.cjs
EVA_MINECRAFT_LIVE=yes EVA_MC_PLAYER=YourPlayerName node test-results/minecraft-diagnostic.cjs
```

The offline physics regressions exercise the installed Mineflayer entity handler and actual lpVec3 codec; watchdog tests simulate a stalled worker without joining any world. The diagnostic is for development only, not a process users need to launch to play.

v0.4.5 verification: **175 core tests, 30 UI tests**, production/package build and full desktop smoke pass. Packaged Minecraft smoke passed while the player was already nearby. A separate baseline diagnostic traversed roughly 41 blocks; the patched app engine maintained healthy physics and correctly waited beside the stationary player. The original intermittent stall was not reproduced and no live hit was received; do not interpret this as live knockback acceptance. See the explicit pending item in PLAN.MD.

v0.4.6 verification: **183 core tests, 30 UI tests**, production/package build and isolated desktop smoke pass. New coverage exercises default-allowed Minecraft actions, legacy-flag migration, explicit blocks/Ask and indirect navigation/lookup, stable blocked tool names, permission refresh, external-MCP isolation, and quiet-chat instructions for ordinary/autonomous replies. No live mining/building or real-provider conversation-style evaluation was performed; the live harness now explicitly blocks edits/chat before any movement.

v0.4.7 verification: **213 core tests, 30 UI tests**, production/package build and isolated desktop smoke pass. The 17 new gameplay tools have simulated-world coverage for inventory quantities/slots, equipment, eating, sleep/wake, combat targeting/death/cancellation, interactions, crafting counts, container/furnace inventory updates and window cleanup, pending-operation fences and action replacement/results. The settings test covers all 26 tool controls and expandable action results. Sleep/riding physics checks and default-Allow/explicit-Block behavior have regressions. Live gameplay acceptance remains pending: no live Minecraft connection or world changes were made for this release. The optional movement-only smoke now blocks **every mutating tool except movement/follow**, not only mining/building/chat; do not remove those explicit grants when testing against a world with movement-only permission.
