# Development and verification

[← Documentation](README.md) · [Project home](../README.md)

```sh
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run test:desktop
```

If Chromium is already installed elsewhere, set `EVA_TEST_BROWSER` to its executable for UI tests. The 24 UI tests cover live overview statistics and empty/character-switch states, the conversation archive (search, channels, on-demand images, pagination, stale responses, retry, empty states and non-destructive browsing), memory constellation selection, source filters/search, editing and failed saves, confirmed deletion, character isolation, bounded collections, responsive/reduced-motion behavior, recall controls and archives, plus plugin settings/pairing controls, Consciousness, images, speech delivery, browser preview, fixture MP3 audio and synthetic microphone input. The 102 core tests include full-archive statistics, archive query scoping, payload bounds, chronological ordering and IPC validation, extraction JSON normalization, bounded recovery, truncation, redacted diagnostics and cancellation, plugin grants, vault persistence, pairing, unpaired rejection, image/voice routing, shared memory, concurrency, remote reminders, bounded retries, cancellation and the actual worker protocol with fixture HTTP, plus the earlier scheduling/memory/voice/image regressions. No real Telegram or paid provider is contacted.

The desktop smoke test opens temporary Electron windows on your normal display and uses an isolated profile under the system temporary directory. It verifies real local HTTP calls through IPC, VRM/VRMA loading, model lists, semantic recall, sentence ordering, synthetic-microphone interruption, archive round-trips, and persistence across restarts without a keyring. It also verifies an authorized reminder across restart, typing deferral, cancellation, activity logs, immediate autonomy pause, and real plugin installation/settings, encrypted token/grant persistence and removal. It then closes its windows and removes its own test data. File/confirmation dialogs are stubbed. The test does not use your credentials or app profile. A real display (or an X virtual framebuffer) is recommended: Electron's Ozone headless backend crashed during validation here. Live Telegram connectivity and actual vision/ASR/TTS quality still need validation with your bot and providers.

The desktop smoke also checks the conversation archive through real IPC: old sessions remain readable after starting fresh, image payloads load only on request, foreign-character queries are rejected, and the settings history browser opens an archived thread and image.

See [PLAN.MD](../PLAN.MD) for architecture, sprint checklists, limitations, and the validation record.
