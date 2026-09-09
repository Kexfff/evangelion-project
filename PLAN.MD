# evangelion_project — development plan

## Product direction

Build a personal desktop companion that listens, responds naturally, remembers, and inhabits an animated VRM avatar. Maintain a focused transparent companion window and a separate settings workspace. Use independently configurable OpenAI-compatible APIs for LLM, ASR, and TTS, with OpenRouter as the initial LLM provider.

“Consciousness” means a future observable behavioral system: mood, boredom, relationship state, timers, and persistent intentions. It does not imply actual sentience. Proactive conversation and game actions belong to later sprints.

## Architecture decisions

| Layer                | Foundation choice                                                     | Reason / extension path                                                                                               |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Desktop shell        | Electron, isolated preload, two windows                               | Transparent avatar, native dialogs, microphone, future OS integrations                                                |
| UI                   | React, TypeScript, Vite, CSS                                          | Shared types and independently organized settings / companion surfaces                                                |
| Avatar               | Three.js, three-vrm, three-vrm-animation                              | Render supplied VRM and retarget supplied VRMA animations                                                             |
| Conversation runtime | Main-process TypeScript service                                       | One conversation pipeline that future Telegram and game adapters can call                                             |
| Providers            | OpenAI-compatible chat / ASR / TTS adapters                           | Independent URLs, models and credentials; local and hosted backends                                                   |
| Memory               | Versioned local JSON with atomic replacement and previous-file backup | Simple inspectable persistence with no native DB compilation; replace the store behind its boundary as scale requires |
| Retrieval            | Recent-message budget + ranked facts + lexical past-message recall    | Useful without requiring a fourth embedding service; semantic retrieval is a later upgrade                            |
| Secrets              | OS-backed Electron safeStorage; session-only fallback                 | Never place raw persisted keys in renderer settings or exports                                                        |
| Extensions           | Typed plugin, capability, event, and scheduled-task contracts         | Establish boundaries now; implement the host and tool execution in later sprints                                      |

```text
Companion window                  Settings window
  microphone / text                 cards / providers / avatar / memory
  audio playback + VRM                         |
            \                                  /
             ------ validated preload IPC -----
                             |
                     CompanionRuntime
                    /        |        \
             ASR adapter  LLM adapter  TTS adapter
                             |
                  Store + memory retrieval
                             |
               local data + OS credential vault

Later inputs: Telegram / scheduler / Minecraft observations
Later outputs: permissioned plugin actions / MCP tools
```

## Sprint 1 — foundation

Implementation completed:

- [x] Application scaffold, dev runner, production build, unpacked packaging configuration.
- [x] Separate frameless transparent companion window and settings window; drag, minimize, close, reopen, always-on-top option.
- [x] Text conversation with streaming assistant replies and history panel.
- [x] Independent LLM, ASR and TTS provider configuration, saved keys, model IDs, voice ID, enable flags, connection tests.
- [x] OpenRouter default LLM configuration using Chat Completions.
- [x] Microphone capture, click-to-start/finish, 60-second capture limit, transcription to user message.
- [x] Automatic or manual speech playback; configurable voice speed and volume.
- [x] Cancellation, recording cleanup, request timeouts, visible errors, duplicate-turn rejection.
- [x] Persist current sessions, complete conversation history, character settings and long-term facts.
- [x] Configurable short-term context window with bounded text budget.
- [x] Character-scoped long-term fact retrieval and keyword retrieval from old conversations.
- [x] Optional automatic fact extraction using an additional LLM call; manual fact creation/editing/deletion.
- [x] Validated memory import/export, deduplication, fresh conversations, confirmed history deletion.
- [x] Multiple character cards: name, personality, system prompt and avatar reference.
- [x] Render the supplied `Eva.vrm`; load custom VRM files through a native picker.
- [x] Retarget and play all nine bundled VRMA animations; control framing, position, rotation and key lighting.
- [x] Natural blink timing and audio amplitude driven mouth movement.
- [x] Provider requests and keys confined to main process, sender-checked IPC, restricted asset protocol, sandboxed renderers.
- [x] Typed extension contracts; clear future-sprint screens for Consciousness and Plugins/MCP.
- [x] Setup documentation and architecture notes.
- [x] Core automated tests and production build.

Validation and remaining acceptance checks:

- [x] 13 core tests pass: disk restart, backup and validation, character isolation, recall/context bounds, SSE chunking and truncation, API payloads, redacted errors, successful turns, automatic fact extraction/deduplication, cancellation, failed-turn persistence.
- [x] TypeScript and production bundling pass.
- [x] Two browser smoke tests pass: supplied VRM textures, all nine VRMA clips, character settings, fact creation/editing/deletion, transparent stage, and no browser console errors.
- [x] Desktop smoke passes on the available Linux display: production renderer/preload, actual VRM/VRMA loading, real HTTP calls to local mock chat/ASR/TTS endpoints, key redaction, asset allowlist, memory archive export/import and deduplication, history-deletion confirmation, and restart persistence. Native dialogs are stubbed in this automated test; it uses a disposable profile.
- [x] Unpacked Linux x64 application built successfully in `release/linux-unpacked/`.
- [x] Dependency audit reports zero known vulnerabilities after upgrading Electron and esbuild.
- [ ] Live OpenRouter conversation with the user's credentials.
- [ ] Live ASR/TTS with the user's actual endpoints, supported voice/model IDs, and audio format.
- [ ] Physical microphone and speaker verification, including OS permission prompts.
- [ ] Desktop compositor transparency and always-on-top verification on target Linux/Windows/macOS systems.
- [ ] Installable, signed platform releases; current packaging target is an unpacked application.

Validation recorded on 2026-09-08. Automated desktop tests exercise request/response plumbing with fixture audio bytes; they do not establish speech quality, actual audio decoding/playback, or physical microphone behavior. Electron's headless Ozone backend crashed in this environment; the desktop smoke test passed using the normal display instead. Browser tests ran in headless Chromium with software WebGL.

Deliberate first-sprint limitations:

- Complete reply text is generated before TTS starts. Sentence-level synthesis queues, streaming audio, automatic voice activity detection and full-duplex interruption are future voice refinements.
- Mouth movement follows audio amplitude, not phoneme visemes. Animation selection currently loops each clip; a gesture controller and blends keyed to emotions are future refinements.
- Retrieval is keyword based, not semantic embeddings. No automatic conversation summarizer is implemented. Full history stays available on disk; the UI shows up to 200 messages from the current session.
- Memory and settings share a single-user JSON store with synchronous atomic writes; migrate to SQLite/FTS (and optionally vectors) before very large archives or multi-user operation. Archive imports are capped at 50 MB.
- The `.bak` file can temporarily retain deleted data. Neither conversations nor their backup are encrypted. Credentials have a separate OS-backed protection path.
- Browser mode is an explicitly labeled visual preview. Desktop features require Electron.
- Provider connectivity and enabled/configured status are different; the UI does not claim a connection is healthy until a test succeeds.
- No background actions, plugin execution, MCP calls, Telegram integration or game control are implemented yet.

## Sprint 2 — consciousness / autonomy

Goal: she can initiate appropriate conversation and follow through on scheduled intentions.

- [ ] Durable state model for mood, boredom, energy and relationship dimensions; bounded values with explainable update rules.
- [ ] Internal clock and event loop; combine user interactions, idle time and plugin events into decisions.
- [ ] Proactive-message policy: opt-in, cooldown, quiet hours, per-day budget, pause when the user is busy, and a global autonomy switch.
- [ ] LLM scheduling tools: create/list/cancel tasks with exact times, time zones and persistent task IDs.
- [ ] Scheduler survives restarts and sleep/wake, avoids duplicate execution, and handles overdue tasks explicitly.
- [ ] Shared action arbiter: prevent overlapping speech, user turns, reminders and external actions.
- [ ] Consciousness settings: state visibility, editable bounds, initiative level, schedules and task manager.
- [ ] Activity log showing why an action occurred, token/request cost and cancellation outcome.
- [ ] Mood-to-expression/gesture mapping and interruption-aware animation blending.
- [ ] Tests using a fake clock: quiet hours, cancellation, restart recovery, cooldowns and user priority.

Acceptance: an authorized scheduled reminder survives restart and fires once, can be cancelled, respects quiet hours and never interrupts an active user turn.

## Sprint 3 — plugin host and Telegram

Goal: the same character is available away from the desktop through one complete plugin.

- [ ] Versioned plugin manifest validation, API compatibility, lifecycle, settings schema and enable/disable controls.
- [ ] Explicit grants for capabilities; minimize the data and actions exposed to each plugin.
- [ ] Implement event bus and channel abstraction around the existing conversation runtime.
- [ ] Isolated plugin execution strategy, cancellation, bounded retries, resource limits and failure reporting.
- [ ] Telegram credentials in the vault; pairing flow and allowlisted user/chat IDs.
- [ ] Text and voice routing, shared character memory, message chunking, rate limits, reconnect/backoff and duplicate-update handling.
- [ ] Coherent turn ownership when desktop and Telegram send at the same time.
- [ ] Plugin installation/update/removal UI, diagnostics and test fixtures.

Acceptance: a paired user can chat from Telegram, recall a desktop fact, and receive a scheduled message; unpaired chats are rejected and disabling the plugin stops communication.

## Sprint 4 — MCP and Minecraft

Goal: controlled observation and action in a Minecraft world.

- [ ] MCP client lifecycle, stdio and Streamable HTTP transports, version negotiation and reconnect behavior.
- [ ] Server configuration, secret injection, tool discovery, schema validation, timeouts and cancellation.
- [ ] Tool permissions, clear confirmation policies for consequential actions, per-tool audit log and emergency stop.
- [ ] LLM tool-call loop with bounded steps, observation budgets and understandable progress.
- [ ] Minecraft adapter (evaluate Mineflayer for supported Java Edition versions) exposing observation, chat, navigation, inventory and simple build actions.
- [ ] Configure game address, account/authentication, allowed worlds, movement/action limits and reconnect policy.
- [ ] Task planning with explicit completion criteria; reconcile expected game state with real observations.
- [ ] Coordinate game actions, voice, Telegram and internal tasks through the same arbiter.
- [ ] Integration tests against a disposable local Minecraft server and simulated MCP failures.

Acceptance: join an authorized test world, describe nearby state, follow the user and complete a small build task; emergency stop cancels tool execution promptly.

## Later refinements

- Semantic memory retrieval and consolidation with configurable embedding provider.
- Sentence-buffered TTS, VAD, barge-in, streaming transcription and device selection.
- Richer gaze, facial expression mixing and one-shot gestures.
- Portable character-card import/export and richer avatar metadata support.
- Encrypted memory archives, retention controls and better backup management.
- CPU/GPU profiling, lazy avatar loading and reduced rendering when windows are hidden.
- Capability-gated desktop observation/control as an optional plugin after the permissioned host exists.

## Reference links

- [AIRI](https://github.com/moeru-ai/airi)
- [OpenRouter API](https://openrouter.ai/docs/api_reference/overview)
- [three-vrm animation](https://pixiv.github.io/three-vrm/docs/modules/three-vrm-animation.html)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
