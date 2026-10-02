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

Validated v0.4.0 baseline: 125 core tests, 28 browser tests, production build, Linux unpacked packaging and full Electron smoke pass. The packaged main-process bundle was checked against the tested build; the bundled VRM was checked against its source hash.

The desktop smoke test opens temporary Electron windows on your normal display and uses an isolated profile under the system temporary directory. It verifies real local HTTP calls through IPC, VRM/VRMA loading, model lists, semantic recall, sentence ordering, synthetic-microphone interruption, archive round-trips, and persistence across restarts without a keyring. It also verifies an authorized reminder across restart, typing deferral, cancellation, activity logs, immediate autonomy pause, and real plugin installation/settings, encrypted token/grant persistence and removal. It then closes its windows and removes its own test data. File/confirmation dialogs are stubbed. The test does not use your credentials or app profile. A real display (or an X virtual framebuffer) is recommended: Electron's Ozone headless backend crashed during validation here. Live Telegram connectivity and actual vision/ASR/TTS quality still need validation with your bot and providers.

The desktop smoke also checks the conversation archive through real IPC: old sessions remain readable after starting fresh, image payloads load only on request, foreign-character queries are rejected, and the settings history browser opens an archived thread and image.

The extended MCP desktop smoke configures and launches the local fixture through real IPC (with its native trust dialog stubbed), grants an ask-each-time tool, approves it in Settings, and verifies the tool result reaches the fixture LLM. It then restarts Electron, checks connection/secret/grant persistence, exercises emergency stop and removes the fixture configuration. App shutdown waits for managed subprocess cleanup. The ESM main-process build includes a `createRequire` shim for bundled CommonJS dependencies used by the SDK's subprocess transport.

See [PLAN.MD](../PLAN.MD) for architecture, sprint checklists, limitations, and the validation record.
