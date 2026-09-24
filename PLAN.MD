# evangelion_project — development plan

## Product direction

Build a personal desktop companion that listens, responds naturally, remembers, and inhabits an animated VRM avatar. Maintain a focused transparent companion window and a separate settings workspace. Use independently configurable OpenAI-compatible APIs for LLM, ASR, and TTS, with OpenRouter as the initial LLM provider.

“Consciousness” means an observable behavioral system: mood, boredom, relationship state, timers, and persistent intentions. It does not imply actual sentience. Sprint 2 implements opt-in proactive conversation and reminders; game actions remain later-sprint work.

## Architecture decisions

| Layer                | Foundation choice                                                            | Reason / extension path                                                                                               |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Desktop shell        | Electron, isolated preload, two windows                                      | Transparent avatar, native dialogs, microphone, future OS integrations                                                |
| UI                   | React, TypeScript, Vite, CSS                                                 | Shared types and independently organized settings / companion surfaces                                                |
| Avatar               | Three.js, three-vrm, three-vrm-animation                                     | Render supplied VRM and retarget supplied VRMA animations                                                             |
| Conversation runtime | Main-process TypeScript service                                              | One conversation pipeline that future Telegram and game adapters can call                                             |
| Providers            | OpenAI-compatible chat / ASR / TTS adapters                                  | Independent URLs, models and credentials; local and hosted backends                                                   |
| Memory               | Versioned local JSON with atomic replacement and previous-file backup        | Simple inspectable persistence with no native DB compilation; replace the store behind its boundary as scale requires |
| Retrieval            | Recent-message budget + optional cached embeddings + lexical fallback        | Character-scoped cosine retrieval; configurable compatible embedding provider added in sprint 1.5                     |
| Secrets              | OS-backed Electron safeStorage; persistent local AES-GCM fallback            | Keys remain in main process; local fallback key has owner-only file permissions and is identified in Settings         |
| Extensions           | Built-in plugin host, validated manifests/grants, channel port and event bus | Telegram network worker and shared runtime; arbitrary-code sandbox and MCP tools remain later work                    |

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

Current additional inputs: durable scheduler / Telegram text, images and voice / trusted interaction events
Later inputs: Minecraft observations
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

## Image attachments — post-sprint 1.5

- [x] Paperclip file picker, clipboard image paste, draft thumbnails and individual removal; support captions or image-only messages.
- [x] PNG/JPEG/WebP/GIF validation in renderer, IPC, persistence and archive schemas; four images maximum, 2 MB each. Browser decoding rejects corrupt local files before sending.
- [x] OpenAI-compatible multimodal `image_url` content parts through the existing LLM provider; retain plain-string content for text-only messages.
- [x] Persist attachments with chat history and include them in memory archives; preserve old text-only databases. Archive deduplication includes attachments.
- [x] Limit visual request context to the newest four images within recent text context, mark omitted older attachments, and isolate characters/sessions.
- [x] Keep image data out of text embeddings and automatic fact extraction; skip empty image-only text indexing.
- [x] Add protocol, validation, persistence, context-budget and browser interaction regressions. Extend the desktop smoke to cover real attachment UI → IPC → HTTP and archive/persistence.
- [x] Document vision-model requirements, privacy, limits and usage.

Verification: production build, 29 core tests, 8 browser tests and the extended Electron desktop smoke pass. New checks cover attachment selection/paste/removal, image-only sends, file limits, invalid formats, HTTP payload shape, follow-up image context, text-only embedding input, archive round-trip and persisted image data. Tests use a tiny local PNG and a mock provider, not user credentials or a paid vision model.

Remaining: live vision-provider quality testing with the user's chosen model; automatic resizing/compression, visual long-term retrieval and a scalable separate attachment store. Images are inline/base64 in the existing JSON store and exports; image-heavy archives can exceed the existing 50 MB import limit. This update does not refresh the unpacked release binary; use `npm run build` / `npm start`, `npm run dev`, or rebuild with `npm run package`.

## Line-by-line TTS — post-sprint 1.5

- [x] Add Speech delivery selector under Voice & audio: Sentence by sentence, Line by line, Full response.
- [x] Buffer complete lines across LLM deltas; preserve short sentences on the same line, handle CRLF/blank lines, and flush the final unfinished line once.
- [x] Keep audio streaming and interruption independent of delivery mode; reset pending text on interruption/settings changes.
- [x] Persist the line setting and preserve existing sentence/full-response preferences on migration.
- [x] Keep line chunks within the 12,000-character speech API limit without the sentence mode's short fallback.
- [x] Add regression tests for segmentation, settings persistence/migration, UI selection and real desktop synthesis ordering.

Verification: production build, 33 core tests, 8 browser tests and desktop smoke pass. Desktop checks confirm line mode sends multiple short sentences in one TTS request before LLM completion, flushes the final line once, and full-response mode sends one request only after completion. Existing sentence-mode/barge-in checks also pass. All providers were mocked; no paid calls were made.

Line means an explicit model-generated newline, not visual wrapping. A reply without newlines is spoken after completion. No system prompt changes are imposed. Local-model voice quality and latency still require listening with the user's own TTS provider. Manual replay continues to speak the whole saved reply. The unpacked release is not refreshed by this update; restart `npm run dev` or use the rebuilt `npm start` application.

## Sprint 2 — consciousness / autonomy

Goal: she can initiate appropriate conversation and follow through on scheduled intentions.

- [x] Durable state model for mood, boredom, energy, trust and affinity; bounded values with explainable deterministic update rules.
- [x] Five-second clock/event loop, user/session interaction events and idle drift; trusted event ingress is ready for the future permissioned plugin host (no plugins execute yet).
- [x] Proactive-message policy: separate opt-ins, cooldown, IANA-zone quiet hours, per-character daily attempt budget, busy deferral, immediate pause and global autonomy switch.
- [x] LLM scheduling tools: create/list/cancel reminders with exact ISO timestamps, IANA zones and persistent task IDs. LLM-created tasks require individual user approval.
- [x] Durable scheduler with overdue catch-up/missed policy and fail-closed recovery of ambiguous in-flight tasks. Power suspend/lock blocks actions; resume requires a new renderer heartbeat.
- [x] Main-process turn ownership plus companion presence/queued-speech gating; user turns preempt autonomous generation. Tagged autonomous deltas cannot contaminate a new user turn. External actions remain unavailable until later sprints.
- [x] Consciousness settings: state visibility/editor, bounds, initiative, schedules, approval/cancellation, immediate pause/resume and task outcomes.
- [x] Character-scoped bounded activity log: decision reasons, LLM request counts, provider-reported tokens/cost, cancellation/failure outcomes. Missing usage is explicit, not estimated; audio/embedding charges are excluded.
- [x] Mood-to-expression mapping and short one-shot greeting/peace-sign gestures with crossfades back to manual idle on interruption; expressive behavior can be disabled.
- [x] Fake-clock regressions: quiet hours/DST, approvals, cancellation, restart recovery, catch-up expiry, cooldown/day budgets, user priority and bounded tool loops.

Acceptance: an authorized scheduled reminder survives restart and fires once, can be cancelled, respects quiet hours and never interrupts an active user turn.

Implementation/validation (2026-09-12, v0.2.0): 49 core tests, 10 browser tests and the extended real-Electron desktop smoke pass. Desktop validation creates and authorizes a reminder, cancels a second task, restarts the app, confirms typing defers delivery, then confirms one saved reminder plus activity and immediate pause. Existing voice/image/VRM/archive tests still pass. Tests use disposable profiles and local mock providers, never user credentials or paid services.

Operating boundaries and remaining checks:

- All autonomous network calls are opt-in. The default time zone is UTC; configure it before enabling quiet-hours policies. State evolution and subtle expressions work locally even when proactive actions are off.
- Reminders are conversational only, one-time, future-within-one-year, and scoped to the active character. No tool can arm its own proposal or change permissions. Scheduling-enabled user chat uses up to four non-streaming LLM requests, so synthesis begins after the final answer; tool-disabled chat retains streaming.
- The app must be running with a visible, idle companion. Closed/minimized/hidden UI, typing/image drafts, any active mic, queued or playing speech, user turns, quiet hours, pause, suspend/lock and stale heartbeats defer actions. Manual pause is the busy indicator for other apps; no PC monitoring is added.
- Both reminders and openers consume the same per-character cooldown/daily attempt allowance. Pending overdue tasks inside the configurable window catch up when safe; older tasks become missed. Tasks left running by a crash become failed and are not replayed. This is at-most-once automatic attempts, not guaranteed delivery across a crash. Done means reply persisted, not audio heard.
- Behavior/tasks/activity persist in the existing plaintext JSON database and backup. Memory exports/imports deliberately exclude them, so archive imports cannot arm tasks. Clearing history preserves tasks/state; cancel reminders separately. Tasks cap at 2,000 retained entries; scalable task archival/retention is later work.
- Live model scheduling accuracy, local TTS quality, mood aesthetics and actual system suspend/lock behavior still need user-device verification. No claim of actual sentience or inferred user emotions is made.
- [x] Refresh the unpacked Linux release for Sprint 2 in `release/linux-unpacked/`; production source build is also available through `npm start` / `npm run dev`.

## Sprint 3 — plugin host and Telegram

Goal: the same character is available away from the desktop through one complete plugin.

- [x] Versioned plugin manifest validation, API compatibility, lifecycle, settings schema and enable/disable controls for the bundled catalog.
- [x] Explicit chat/shared-memory, image, voice and notification grants; adapters receive a narrow channel port, not database access or LLM/ASR/TTS credentials.
- [x] Failure-isolated event bus and channel abstraction around the existing conversation runtime. Telegram uses the same active-character session, short-term context, facts, semantic recall and optional fact extraction.
- [x] Trusted built-in execution strategy: Telegram HTTP in a dedicated worker with a 64 MB old-generation heap cap, four pending requests maximum, request/body/file limits, cancellation and redacted failures. This is not a sandbox for hostile code.
- [x] Telegram token in the existing vault; five-minute single-use random pairing commands; exact private user/chat allowlist bound to the selected character. Groups, bots and unpaired senders never reach providers or download attachments.
- [x] Text, captions, attached photos and PNG/JPEG/WebP/GIF image documents; OGG/Opus voice notes through configured ASR; optional MP3 voice replies through configured TTS.
- [x] Unicode-safe 4,000-character response chunks; serialized sends at least 1.1 seconds apart; 12 accepted incoming messages/minute; polling batches of 20; bounded reconnect/backoff and durable update cursor.
- [x] Single runtime turn owner. Telegram waits up to 60 seconds behind an existing turn; desktop receives the existing busy/stop behavior during Telegram generation. Remote deltas never feed desktop TTS. Session changes during pending media work fail closed.
- [x] Settings for bundled install/update/remove, token, grants, pairing/revocation, enable/disable/restart, optional voice/notifications and the latest 100 redacted diagnostics.
- [x] Authorized reminders/openers route to the paired channel when notification permission is enabled and connected, including with the avatar minimized. Existing autonomy opt-ins, approvals, pause, quiet hours, budgets, system suspend/lock and fresh busy presence still apply.

Acceptance: a paired user can chat from Telegram, recall a desktop fact, and receive a scheduled message; unpaired chats are rejected and disabling the plugin stops communication.

Implementation/validation (2026-09-22, v0.3.0): 72 core tests and 12 browser tests pass, production build passes, and the extended Electron smoke passes. Core tests include the real worker protocol with fixture HTTP, host → polling → pairing → shared runtime → reply, image/voice routing, grants, unauthorized senders, duplicate claims, encrypted token restart, Unicode chunking, reconnect limits, cancellation, shared desktop facts/history, concurrent turn ownership and remote reminders. Desktop smoke verifies actual installation/settings IPC, encrypted token/grant persistence across restart and removal while retaining shared memory. All network/provider tests use mocks; no real Telegram account or paid provider was contacted.

Operating boundaries and remaining work:

- The initial catalog contains only the bundled Telegram adapter. Install/update selects the version shipped with the app, disables it until explicitly enabled, and never downloads or executes arbitrary plugin files. Third-party code loading, marketplace discovery, signatures, hot updates and an OS-level hostile-code sandbox remain future work. MCP remains Sprint 4.
- One bot and one paired private account/character per app profile. Inactive-character messages are skipped with diagnostics, not redirected to another character. New desktop sessions also become Telegram's current session. Desktop conversations are not automatically mirrored to Telegram; only Telegram replies and opted-in autonomous messages are sent there.
- The app must remain running. Minimize it to stay connected; closing all windows quits on Linux/Windows. No tray/service/OS wake is implemented. Stop other pollers or remove an existing bot webhook yourself; the app never takes over another deployment automatically.
- Incoming photos/image documents use existing vision-model and 2 MB/image limits; photo size selection chooses a supported Telegram rendition. Albums are separate incoming messages/turns, not one combined album prompt. No arbitrary document, sticker, video, visual embedding or generated-image output support yet.
- Voice notes are capped at 60 seconds and 10 MB; the ASR endpoint must accept Telegram OGG/Opus. Voice replies are optional MP3 uploads after the text reply (up to the existing 12,000-character synthesis limit). Audio is not persisted locally; transcripts and images are retained in shared history/archives. Raw text is always delivered independently of optional speech success.
- Update cursors are persisted before work: crashes/cancellation may lose an accepted message, but never automatically replay an ambiguous turn. Messages older than 24 hours are skipped. Send timeouts/5xx are not retried because delivery may already have happened. Explicit 429 rejections retry at most twice (delays above 60 seconds fail closed); reconnection stops after eight consecutive failures, or immediately on authentication/conflict/long rate-limit errors, until manual restart.
- Disable/unpair/remove abort polling, downloads, in-flight remote generation and audio requests, and queued sends. Telegram may already have accepted a request before cancellation; previously delivered messages are not revoked. Shared messages/facts survive plugin removal. Token, pairing, grants, cursor and diagnostics are excluded from memory exports; local JSON backups can retain older non-secret plugin state.
- [ ] Live private-bot acceptance with the user's token, image-capable LLM and actual OGG-compatible ASR/MP3 TTS; verify Telegram delivery and voice quality on target devices.
- [x] Refresh the unpacked Linux release for Sprint 3 in `release/linux-unpacked/`; source build is also runnable with `npm start` or `npm run dev`.

## Automatic memory extraction fix — v0.3.1

- [x] Investigate the generic post-reply warning. The background extraction path used chat's 700-token cap/temperature 0.8 and required an exact JSON array, while discarding failure details. Recent local activity confirmed extraction responses/usage but did not retain enough information to identify the historical failure precisely.
- [x] Dedicated extraction settings: temperature 0.1, 2,048-token cap, OpenRouter-only request to disable optional reasoning; ordinary chat remains unchanged.
- [x] Validate arrays, facts-object envelopes and single fenced JSON responses; trim/deduplicate and retain at most three short strings. Never salvage partial JSON or persist reasoning/free-form output as a fact.
- [x] Detect token exhaustion from finish_reason even when content is empty; allow exactly one fresh retry for invalid/empty/truncated extraction, capped at 4,096 tokens. Do not retry HTTP/auth/quota failures. Preserve cancellation, source-message deletion and character scoping.
- [x] Actionable, redacted warnings and memory-failed activity; account for both attempts, disclose additional usage, and keep malformed output/credentials out of diagnostics. Do not automatically replay old failed extractions.
- [x] 93 core tests, production build and Electron regression smoke pass (2026-09-24), including 21 new extraction regressions using mock responses. No live provider calls or user-profile mutations were performed.
- [x] Refresh v0.3.1 unpacked Linux build in `release/linux-unpacked/`.
- [ ] Verify extraction against the user's live model after restart; original failed output was not retained, and no paid live requests were made during this fix.

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
