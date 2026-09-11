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
| Retrieval            | Recent-message budget + optional cached embeddings + lexical fallback | Character-scoped cosine retrieval; configurable compatible embedding provider added in sprint 1.5                     |
| Secrets              | OS-backed Electron safeStorage; persistent local AES-GCM fallback     | Keys remain in main process; local fallback key has owner-only file permissions and is identified in Settings         |
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

First-sprint limitations (historical; voice and retrieval upgrades are implemented below):

- Complete reply text is generated before TTS starts. Sentence-level synthesis queues, streaming audio, automatic voice activity detection and full-duplex interruption are future voice refinements.
- Mouth movement follows audio amplitude, not phoneme visemes. Animation selection currently loops each clip; a gesture controller and blends keyed to emotions are future refinements.
- Retrieval is keyword based, not semantic embeddings. No automatic conversation summarizer is implemented. Full history stays available on disk; the UI shows up to 200 messages from the current session.
- Memory and settings share a single-user JSON store with synchronous atomic writes; migrate to SQLite/FTS (and optionally vectors) before very large archives or multi-user operation. Archive imports are capped at 50 MB.
- The `.bak` file can temporarily retain deleted data. Neither conversations nor their backup are encrypted. Credentials have a separate OS-backed protection path.
- Browser mode is an explicitly labeled visual preview. Desktop features require Electron.
- Provider connectivity and enabled/configured status are different; the UI does not claim a connection is healthy until a test succeeds.
- No background actions, plugin execution, MCP calls, Telegram integration or game control are implemented yet.

## Sprint 1.5 — natural voice and semantic memory

Implemented and validated (2026-09-09):

- [x] Diagnose false post-TTS error: a still-attached error callback runs when cleanup clears the audio source.
- [x] Replace session-only credentials with persistent OS encryption or an explicitly labeled local AES-GCM vault; preserve locked legacy keys.
- [x] Add model discovery for LLM, ASR, TTS and embeddings with manual model IDs retained.
- [x] Add microphone gain, local input meter/test, input/output selection and device refresh.
- [x] Add local energy VAD, onset buffering, pause/minimum speech duration controls and hands-free listening.
- [x] Add generation-aware interruption for speech, queued sentences and in-flight LLM requests.
- [x] Add sentence-buffered speech and pull-based HTTP audio streaming with MSE playback and buffered container fallback.
- [x] Add semantic vector cache, cosine recall, provider/model invalidation, edit/delete invalidation and explicit rebuild.
- [x] Validate schema migration, key persistence, post-playback cleanup and cancellation regressions.
- [x] Validate model discovery, streamed playback, microphone controls and semantic retrieval end to end.
- [x] Update run instructions and limitations; production build passes.
- [x] Refresh the unpacked Linux build with sprint 1.5 in `release/linux-unpacked/`.

Verification: 24 core tests, 5 browser tests, and the desktop smoke pass. The browser test plays a real MP3 before EOF, tests completed/interrupted cleanup and drives VAD through the actual AudioWorklet using synthetic speech. The desktop test uses a disposable profile with its keyring disabled, verifies saved credentials after restart, exercises model discovery and embedding HTTP calls, checks sentence order, and interrupts a reply with synthetic microphone input. It confirms the queued second sentence is discarded and the new transcription receives a reply. No paid providers or user credentials were used.

Current operating details and remaining manual checks:

- Existing sprint-1 settings/memories migrate automatically. Re-enter a formerly session-only key once and save it; it will then persist. Legacy ciphertext stays intact when its keyring is locked.
- Without a keyring, the credential decryption key lives beside the encrypted vault. This protects against casual disclosure/other OS users, not processes running as your user; Settings identifies this mode. OS encryption remains preferred.
- Model discovery uses each provider's catalog; compatible APIs do not consistently declare model capabilities, so the returned list is not artificially filtered into inferred model types. Manual IDs remain supported.
- Hands-free VAD is explicitly started/stopped from the microphone button and never enabled at launch. VAD is local energy detection with hysteresis, configurable minimum voice/pause timing, and pre-roll sufficient for the configured onset duration. It is not speaker recognition or a neural speech/noise classifier.
- Set sensitivity and test the chosen microphone/speakers on the target device. Headphones or appropriate echo settings may be needed to prevent the avatar's speaker audio from triggering barge-in.
- Audio is downsampled to 16 kHz mono WAV. Individual utterances cap at 60 seconds. A stopped or disconnected microphone releases its stream; voice/session changes also stop capture/playback.
- TTS streams through MSE when its container is supported (tested with MP3). Unsupported containers buffer before playback. The provider must send bytes incrementally for true streaming latency; synthesis requests are queued per sentence.
- Semantic memory requires its own enabled embedding provider and key. The vector cache is scoped by provider/model/content; each turn indexes up to 32 missing documents. Run the explicit index build for a large existing archive. Embedding or indexing failures fall back to keyword recall with a notice.
- Embedding quality, multilingual recall, real server latency, device availability, acoustic echo and physical permission prompts still need verification on the user's actual setup. Base TTS playback was reported working by the user; the new streaming path was validated with fixtures.

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

- Memory consolidation/summarization, richer retrieval evaluation and scalable vector storage.
- Streaming transcription and neural VAD; sentence-buffered TTS, energy VAD, barge-in and device selection landed in sprint 1.5.
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
