# evangelion_project — development plan

## Product direction

Build a personal desktop companion that listens, responds naturally, remembers, and inhabits an animated VRM avatar. Maintain a focused transparent companion window and a separate settings workspace. Use independently configurable OpenAI-compatible APIs for LLM, ASR, and TTS, with OpenRouter as the initial LLM provider.

“Consciousness” means an observable behavioral system: mood, boredom, relationship state, timers, and persistent intentions. It does not imply actual sentience. Sprint 2 implements opt-in proactive conversation and reminders; game actions remain later-sprint work.

## Architecture decisions

| Layer                | Foundation choice                                                             | Reason / extension path                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Desktop shell        | Electron, isolated preload, two windows                                       | Transparent avatar, native dialogs, microphone, future OS integrations                                                           |
| UI                   | React, TypeScript, Vite, CSS                                                  | Shared types and independently organized settings / companion surfaces                                                           |
| Avatar               | Three.js, three-vrm, three-vrm-animation                                      | Render supplied VRM and retarget supplied VRMA animations                                                                        |
| Conversation runtime | Main-process TypeScript service                                               | One conversation pipeline that future Telegram and game adapters can call                                                        |
| Providers            | OpenAI-compatible chat / ASR / TTS adapters                                   | Independent URLs, models and credentials; local and hosted backends                                                              |
| Memory               | Versioned local JSON with atomic replacement and previous-file backup         | Simple inspectable persistence with no native DB compilation; replace the store behind its boundary as scale requires            |
| Retrieval            | Recent-message budget + optional cached embeddings + lexical fallback         | Character-scoped cosine retrieval; configurable compatible embedding provider added in sprint 1.5                                |
| Secrets              | OS-backed Electron safeStorage; persistent local AES-GCM fallback             | Keys remain in main process; local fallback key has owner-only file permissions and is identified in Settings                    |
| Extensions           | Shared lifecycle registry, separate channel/tool interfaces, permissioned MCP | Telegram channel plus stdio/Streamable HTTP tool providers; bundled Minecraft adapter and hostile-code sandbox remain later work |

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
Current additional outputs: permissioned MCP tools for user-requested conversations
Later outputs: persistent game jobs / approved autonomous game actions
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

## Memory workspace refinement — v0.3.2

- [x] Replace the utilitarian memory tab with a constellation hero, selected-memory preview, source-colored cards and a dedicated add/edit composer.
- [x] Draw up to 36 recently updated facts locally with SVG/CSS, no dependencies or provider calls. Clearly label positions/links as artistic, not embedding similarities; do not invent sample memories or include chat history in the illustration.
- [x] Search, source filters, counts, recently updated ordering and paginated display (12 facts at a time). Empty/no-result guidance, keyboard-selectable stars, responsive layout and reduced-motion support.
- [x] Preserve character scoping, immediate fact saves, import/export and history actions. Add inline deletion confirmation and retain drafts after failed saves.
- [x] Separate everyday controls from expandable recall tuning; explain save behavior, embedding-provider setup, indexing prerequisites and private archives. Leave storage and retrieval algorithms unchanged.
- [x] Validation (2026-09-25): 93 core tests, all 17 browser tests (including five new memory tests), production build and Electron regression smoke pass. Reviewed desktop/narrow screenshots, checked layouts at 1,000/760/480 px and reduced-motion behavior; refreshed `release/linux-unpacked/` as v0.3.2. Tests used fixtures and an isolated desktop profile, not live providers or user memories.
- [ ] Optional future refinement: a genuine embedding projection with similarity-backed links. The current constellation intentionally prioritizes appearance over analytical information.

## Conversation archive refinement — v0.3.3

- [x] Separate Saved facts and Conversation history views inside Memory; retain the fact-only constellation unchanged.
- [x] Read-only archive browser for all saved sessions of the active character, independent of the companion window's 200-message/current-session snapshot. Show conversation/message totals, dated previews, active-chat and Desktop/Telegram labels.
- [x] Search message text and image names, filter channels, read matching messages or expand their full conversation context. Paginate session summaries and messages in fixed 20-item pages, oldest-first within a conversation.
- [x] Retrieve image bytes only when explicitly opened; routine history queries return attachment names only. Keep renderer payloads bounded and IPC inputs validated; reject stale character requests and ignore stale async responses.
- [x] Keep browsing separate from the active chat; preserve existing new-conversation, export and native-confirmed history deletion behavior. Add empty/loading/error/retry states and keyboard-accessible, responsive transcript panels.
- [x] No storage migration, memory deletion, provider calls or changes to semantic recall.
- [x] Validation (2026-09-25): all 100 core tests, 22 browser tests, production build and extended Electron smoke pass. Real IPC checks cover archived sessions after starting a new chat, lazy image loading and foreign-character rejection; the settings UI opens the archived thread/image. Reviewed desktop/narrow screenshots and refreshed `release/linux-unpacked/` as v0.3.3. All tests used fixtures/disposable profiles; existing user memories and assets were untouched.

## Overview statistics refinement — v0.3.4

- [x] Replace the outdated “A space that grows with you” roadmap with a compact “Your story so far” statistics card; preserve the other overview sections.
- [x] Show saved conversation, message and attached-image totals for the saved active character, including past sessions and Desktop/Telegram. Count both user and assistant messages; do not count empty sessions or other characters. No provider requests, schema migration or memory changes.
- [x] Supply lightweight totals in desktop/browser snapshots; update on state changes, show honest zeroes for empty archives and dashes when statistics are unavailable. Responsive layout and source/scope labels.
- [x] Validation (2026-09-26): 102 core tests, 24 browser tests, production build and extended desktop smoke pass. Verified full-archive totals after starting a fresh conversation, live character updates, empty/unavailable states and narrow layouts; visually reviewed the overview screenshot. Refreshed `release/linux-unpacked/` as v0.3.4. Tests used fixtures/disposable profiles; user memories and assets were not changed.

## Default avatar and documentation refresh — v0.3.5

- [x] Use the supplied `AvatarSample_B.vrm` in desktop development, browser preview and packaged resources. Retain `builtin:eva` for existing saved characters; leave custom avatars, settings and memories unchanged.
- [x] Update the bundled-avatar control and test fixtures; replace the old model-size assertion with an exact SHA-256 asset comparison. Keep the provided VRM binary and all animations unchanged.
- [x] Move the detailed README material into topic guides in `docs/`, with an index, relative navigation and a compact project front page. Keep the development plan at the repository root.
- [x] Record embedded VRoid attribution and permissions in `docs/assets.md`; do not infer a named license from `licenseName: Other` and an empty license URL.
- [x] Validation (2026-10-02): 102 core tests, 24 browser tests (including the new model and all nine animations), production build and full Electron smoke pass. Verified 52 local documentation links and exact source/packaged VRM hashes; refreshed `release/linux-unpacked/` as v0.3.5 with no old model in its assets. The smoke harness now waits for renderer initialization before changing voice settings after restart, waits for actual synthesis requests, and reports fixture-only diagnostics on failure. No application audio behavior or user data was changed.
- [ ] Add the model's original source/license URL or license text when supplied.

## Sprint 4 — MCP and Minecraft

Goal: controlled observation and action in a Minecraft world.

- [x] Step 1: shared plugin lifecycle registry; Telegram-specific behavior extracted into a channel plugin; separate channel and tool interfaces, preserving Telegram configuration/history/credentials.
- [x] MCP client lifecycle, stdio and Streamable HTTP transports, SDK version negotiation and explicit reconnect after failure (no automatic action replay).
- [x] Server configuration, vault-backed secret injection, bounded tool discovery, input/output schema validation, timeouts and cancellation.
- [x] Tool permissions (blocked / ask each time / explicitly allowed), one-call desktop approvals, definition-fingerprinted grants, redacted persistent audit log and emergency stop.
- [x] Existing LLM tool loop generalized for async MCP tools, advertised-tool allowlist, failed-tool retry suppression, bounded rounds/results/definitions, visible pending approvals and activity outcomes. Long-running task progress remains with game jobs below.
- [x] Bundled Mineflayer adapter for Java 26.1 exposing observation, chat, navigation, inventory and bounded collect/build actions.
- [x] Configure game address, account/authentication, world label/dimension, movement/action limits and explicit reconnect after failure. Microsoft authentication is implemented but not live-verified.
- [ ] Task planning with explicit completion criteria; reconcile expected game state with real observations.
- [ ] Coordinate game actions, voice, Telegram and internal tasks through the same arbiter.
- [ ] Integration tests against a disposable local Minecraft server and simulated MCP failures.

Acceptance: join an authorized test world, describe nearby state, follow the user and complete a small build task; emergency stop cancels tool execution promptly.

### Steps 1–2 — plugin and MCP foundation (v0.4.0)

Target confirmed with the user: **Minecraft Java Edition, LAN world**. This increment implements plugin/MCP foundations only; it does not connect to Minecraft, host a game server, or implement autonomous game jobs.

- [x] Settings → Plugins & MCP: add/edit/remove stdio or Streamable HTTP connections, native trust confirmation, connect/disconnect, credential replacement, discovered tool permissions, exact one-time call approvals, emergency stop and audit history. Browser preview cannot execute programs or contact MCP services.
- [x] New connections and edited connections are disabled; all tools start blocked. Connections bind to a character; calls recheck active character/session, grants and connection before dispatch. Description/schema changes cannot reuse old grants.
- [x] Local programs have an explicit unsandboxed trust warning. Only configured secrets and the SDK's minimal environment are supplied. HTTP uses an exact configured HTTPS/loopback endpoint, no redirects or embedded URL credentials. External servers receive no provider keys or direct database handles.
- [x] Emergency stop cancels pending approvals/calls and persists disabled connections. Quit waits for managed direct-child cleanup. External effects already accepted cannot be rolled back; generic MCP cancellation is cooperative.
- [x] Existing profiles receive an empty MCP configuration without changing Telegram, memories or settings. MCP secrets/grants/audits stay out of memory archives. Connection removal preserves shared memory and audit history.
- [x] Documentation: [MCP guide](docs/mcp.md) covers setup, trust, architecture, supported schema subset, limits and remaining work.

Verification (2026-10-02): **125 core tests, 28 browser tests, production build, and the extended Electron smoke pass.** Coverage includes real stdio and Streamable HTTP JSON/SSE fixtures, schema validation, grants/approval expiry, cancellation, session isolation, metadata invalidation, pre-MCP profile compatibility, encrypted credential persistence, redaction and shared-runtime dispatch. Desktop smoke verifies the native-trust/IPC path, local subprocess discovery, one-call Settings approval, LLM tool results, restart persistence, emergency stop and removal, alongside all previous Telegram/voice/memory/VRM checks. Reviewed the MCP Settings screenshot; verified 59 local documentation links. Refreshed `release/linux-unpacked/` as v0.4.0 and verified its main bundle matches the validated build and its VRM matches the source asset. Dependency audit reports zero vulnerabilities after compatible transitive patches. No live MCP service, user credentials, Telegram account, paid provider or Minecraft world was used; tests used fixtures and disposable profiles.

Boundaries: tools only; no OAuth flow, resources/prompts UI, sampling/elicitation, hostile-code sandbox, marketplace, or arbitrary in-process extensions. Local external servers must already be installed; their runtimes are not bundled. The future built-in Minecraft adapter will be app-managed and bundled. Schema references/regex/formats are currently rejected; discovery fails closed. Tools are exposed only to user-initiated chat, not proactive/scheduled messages. Tool-enabled turns produce a final non-streaming answer; background jobs and the game/conversation coordinator remain below.

Next steps:

- [x] Bundled Mineflayer MCP adapter: Java LAN connection/authentication, observation and following; no separate user-run bot/MCP process.
- [x] Persistent game-job history and action ownership independent of conversation turns; bounded collection/building, world-scoped landmarks and observed completion checks. Interrupted jobs are not resumed/replayed.
- [ ] Authorized autonomous gameplay and broader Minecraft server integration tests; basic game-specific permissions/limits landed in v0.4.1.

### Minecraft adapter and bounded jobs — v0.4.1

- [x] Bundle Mineflayer 4.39.0 / pathfinder 2.4.5 with an Electron utility-process MCP adapter; packaged users need no separate Node installation, bot process or generic MCP executable setup.
- [x] Minecraft settings: host/port, distinct account name, offline/Microsoft authentication, world label/dimension, trusted follow target, movement radius, job deadline, public-chat flag, block-edit area and block-count cap. Movement, public chat and block changes default off; MCP tool grants independently default blocked.
- [x] Eight bounded tools: observe (nearby entities/blocks, position, inventory, health and limits), move, follow, public chat, collect, explicit-block build, job status and stop. No slash commands, arbitrary code, combat, chest interaction or game-chat command ingress.
- [x] One game-action owner independent of conversation turns. Prompt job IDs, observable progress/outcomes and latest 100 persisted jobs. Arrival, inventory gain and final build state are verified; failures may be partial and never automatically replay. Restart marks active jobs interrupted.
- [x] Stop controls in Settings and the companion; emergency disconnect, job deadlines, low-health/dimension/boundary guards, grant-change cancellation and session/lock/suspend cleanup. Navigation disables digging/scaffolding/door opening and avoids known hazards; it is not a guarantee against environmental side effects.
- [x] Up to 200 character/world/endpoint/dimension-scoped landmarks, injected into ordinary connected chat separately from personal facts. Desktop/Telegram share the existing runtime and memory. Landmarks/jobs remain outside memory exports.
- [x] Microsoft device-code flow with memory-only authentication cache, no reads/writes to launcher credentials. Minimal child environment, no provider keys/database access, bounded transport and redacted connection failures.
- [x] Core and browser tests for safe defaults, MCP schema compatibility, limits, exclusive ownership, stop/timeout, chat restrictions, simulated builds/collection, false-completion rejection, interrupted-job recovery, landmark scope and settings controls.
- [x] Live acceptance on the user's authorized same-computer Java 26.1 LAN world at `127.0.0.1:25556`: joined as `EvaCompanion`, observed state/inventory, followed `Lexxass`, handled another chat while following, stopped and emergency-disconnected. No digging, placing or public game chat. Source-mode testing used a temporary profile; packaged testing incorrectly used the normal profile (see v0.4.2 correction below).
- [x] [Minecraft guide](docs/minecraft.md) documents setup, two-layer permissions, lifecycle, job semantics, privacy and limitations.
- [x] Production build, full desktop regression smoke and packaged live Minecraft smoke pass. Refreshed `release/linux-unpacked/` as v0.4.1; packaged main/worker bundles and avatar match source. Production dependency audit reports zero vulnerabilities.
- [ ] Disposable live server/area acceptance for collection and a small build, including partial failures. Current block-action coverage uses simulated worlds; the user explicitly prohibited block changes in their LAN world.
- [ ] Live Microsoft-account authentication test. Tokens intentionally do not persist; encrypted persistent account sessions remain future work.
- [ ] Autonomous LLM game planning, scheduled game goals and a richer shared game/conversation/task coordinator. Current long-running jobs are user-requested; proactive messages/reminders still cannot invoke external tools.

Validation (2026-10-03): **143 core tests and 30 browser tests pass**, including 18 Minecraft core cases and two settings UI cases. Real Electron testing confirms the app-managed adapter connects to Java 26.1 and moves without holding the conversation lock. The unpacked release also joins, starts/stops a follow job, handles concurrent fixture chat and emergency-disconnects using its bundled runtime/dependencies. The smoke harness waits for the asynchronously opened Settings window in packaged mode. Reviewed the Minecraft settings screenshot and verified 68 local documentation links. **Correction:** the original claim that the normal user profile was untouched was wrong; packaged smoke testing ignored the temporary-directory override and changed settings/history in the normal profile. No block changes were requested. Full Sprint 4 acceptance remains open until live building and autonomous coordination are validated.

### Packaged smoke isolation repair — v0.4.2

- [x] Diagnose `ECONNREFUSED 127.0.0.1:34383`: the packaged test's fixture LLM URL was persisted in the normal profile because `EVA_TEST_DATA_DIR` was honored only when `!app.isPackaged`. This was not a Minecraft-port or rendering failure.
- [x] Apply isolated userData and Chromium sessionData before locks, Store, vault or windows for both source and packaged apps. Reject relative/missing directories and normal-profile targets (including symlink aliases), rather than silently falling back.
- [x] Both smoke harnesses assert the actual Electron data paths before writing fixture settings, chatting or joining a world. Add a no-network packaged isolation smoke with an optional read-only normal-profile hash guard.
- [x] With the user's confirmation and app closed, create a separate timestamped backup and restore only the LLM URL to `https://openrouter.ai/api/v1`, automatic speech and automatic memory extraction. Model, credentials, other providers, messages and facts were not changed by the repair. The ordinary backup also contained the bad URL, so the prior URL/settings could not be inferred from it.
- [x] Retain the 12 identified fixture chat messages and test game records rather than deleting any history without permission. Minecraft configuration/grants were also affected by the packaged tests; they should be reviewed in Settings before reconnecting.
- [x] Five new profile-isolation cases; **148 core tests pass**.
- [x] Rebuilt v0.4.2 in `release/linux-unpacked/`; production build, packaged isolation smoke and full desktop regression smoke pass. Packaged fixture settings were written only into the temporary profile, and the repaired normal `companion.json` retained the same SHA-256 before/after. No live provider or Minecraft connection was used for this repair's verification.

### Minecraft follow repair and simpler movement — v0.4.3

- [x] Diagnose concrete navigation defects: the follow loop replaced its dynamic goal every second (resetting pathfinding), limited searches to one second, prohibited normal jumping/sprinting/swimming and allowed only one-block drops. The user's failed job retained only a generic message, so its precise original failure cannot be recovered. Their saved test configuration also retained a 32-block leash and 30-second timeout.
- [x] Keep one dynamic follow goal per tracked entity; allow normal sprint/jump/swim movement and standard four-block drops, with a five-second incremental path-search budget. Navigation still does not dig/place blocks. Honor pathfinder's block-grid arrival tolerance when checking for stuck movement.
- [x] Wait for temporary missing player tracking; reacquire entities without restarting a valid goal. Allow an explicit player name, case-insensitive configured-name matching, or automatic selection of the sole other player. Report missing-player, leash and stuck-route reasons; preserve internal action failures and map known pathfinder errors without exposing arbitrary upstream error text.
- [x] Default movement on, radius `0` (no leash), timeout `0` (until stopped). Preserve existing saved values; **Use companion movement defaults** explicitly resets old limits before saving. **Enable everyday controls** grants only observe/move/follow/status/stop once, without per-action popups; public chat and block edits remain separate. Individual grants are expandable.
- [x] Show live follow distance/waiting state in job history, and omit meaningless `0/—` progress for following. Keep Stop, disconnect and failed-job cleanup.
- [x] Strengthen live smoke: require actual observed proximity within four blocks of the player, not merely a running job. In the authorized source-app LAN test Eva travelled approximately 32 blocks from Y=71 to Y=67 and reached `Lexxass`, while handling concurrent chat; stopped and emergency-disconnected without requesting block edits or public chat. Verified temporary-profile paths before test settings writes.
- [x] Six new core regressions plus updated settings tests; **154 core tests pass**. Original failure reason was not retrospectively invented; no changes were made to the user's saved app profile in this increment.
- [x] Final verification: **154 core tests, 30 UI tests, production build and full desktop smoke pass**. Refreshed `release/linux-unpacked/` as v0.4.3; main and worker bundles match the tested build. Packaged live smoke also verified arrival beside Lexxass after roughly 29 blocks of travel and a two-block descent, concurrent chat, stop and emergency disconnect. Tests used checked disposable profiles and fixture providers; no block-edit/public-chat commands were sent.

### Free play and distant coordinates — v0.4.4

- [x] Explicit Free play preset: movement/public chat/block edits on, no movement or build-area fence, no job timer, up to 1,024 collected blocks/job. One-time **Enable all game tools** grants the implemented Minecraft tools without per-action approval. Existing profile values are preserved until saved; operator lookup is separately enabled.
- [x] Terrain-changing navigation (digging, scaffolding, towers, doors) only when Free play and block edits are both enabled. Nonzero build fences still constrain pathfinder breaking/placement. Registered materials replace the small block lists in Free play; building uses inventory, empty destinations and sneak placement against solid supports. Build requests remain batched at 128 placements and existing transport limits.
- [x] Free play replaces a current game job with a new requested action, does not stop solely for low health, and respawns after death without replaying the previous job. Stop/disconnect and resource bounds remain. This is not autonomous LLM gameplay, crafting/combat/chest management or arbitrary command/code execution.
- [x] Player coordinate observations no longer inherit the 16-block nearby-entity display cutoff. Track timestamped positions per connection and label vanished entities as last-seen rather than current.
- [x] `locate_player` tool and optional operator lookup approved by the user: fixed `/data get entity <literal-name> Pos` and `Dimension` queries, matching structured vanilla system responses, bounded styled-text parsing for Java 26.1, finite coordinate validation, timeout/cancellation, five-second cache and no raw server-error forwarding. No selectors, arbitrary commands or automatic operator elevation.
- [x] Follow toward fresh server-reported or explicitly stale last-seen coordinates while the entity is untracked; reacquire dynamic following when visible. Explain missing operator permission, unknown coordinates, different dimension and unreachable routes. No fabricated positions or teleportation.
- [x] Core/UI coverage for Free play's independent block gate, optional terrain boundary, new materials, action replacement, tracked/last-seen/operator positions, styled replies, chat spoof rejection, timeout/cancellation, distant waypoint following and preset/grant controls. **167 core tests and 30 UI tests pass**; production/package build passes.
- [x] Packaged live acceptance: the server returned operator-sourced coordinates for Lexxass approximately **302 blocks away**, then Eva walked from `(-981.5, 66, 271.5)` to `(-1141.5, 64, 524.5)` and reached within four blocks of the player. Concurrent chat, stop and emergency disconnect passed. An initial parser failure revealed 26.1 styled NBT punctuation components and was fixed/tested before this successful run. Live tests kept Free play, block edits and public chat disabled; only operator coordinate reads and movement were authorized. No application-profile writes outside checked temporary test profiles.
- [x] Final release refreshed in `release/linux-unpacked/` as v0.4.4; production/package build, **167 core tests, 30 UI tests and full desktop regression smoke pass**. Free play digging/building/respawn remain simulation-verified or implementation-only, not destructive live-world acceptance. Last-seen locations are session-only, and the final status refinement retains a fresh operator source label for its five-second cache window.

### Physics and misleading running status — v0.4.5

- [x] Confirmed a 26.1 velocity-unit mismatch in the installed dependencies: the protocol's lpVec3 codec already decodes blocks/tick, but Mineflayer 4.39's entity handler divides by 8,000 again. Add a version-scoped post-handler compatibility plugin for knockback and spawn velocities, without modifying node_modules or sending server commands. Legacy protocols retain their original conversion.
- [x] Companion overlay displays the actual job detail, including waiting beside a player, rather than only “follow in progress.” Add an independent eight-second physics-tick/invalid-number check and a ten-second main-process worker heartbeat. Corrupt snapshots no longer silently leave stale running state. Stop/disconnect with an explicit reason; never replay jobs automatically.
- [x] Add real dependency/codec regressions for decoded knockback, repeated packets, spawn velocity and legacy velocity; test stationary-vs-stalled physics, invalid axes, worker silence, invalid snapshots and timer cleanup. Full core suite: **175 tests pass**. Production/package build passes. No saved configuration changes or new gameplay permission restrictions.
- [x] Bounded movement-only live diagnostics: baseline Mineflayer travelled approximately 41 blocks uphill to Lexxass; the app's patched follow engine then held a correct “With Lexxass; following when they move” state at about 20 physics ticks/second. The originally reported follow stall was **not reproduced**; no hit packet arrived during these runs, so physical knockback remains packet-test-verified, not live-hit-verified. No blocks changed, public chat sent or operator queries issued.
- [x] Final verification: **175 core tests, 30 UI tests**, production/package build and full desktop smoke pass. Packaged Minecraft smoke passed join, nearby-player follow state, concurrent chat, Stop and emergency disconnect in a checked temporary profile; Eva was already near the player, so that run does not establish new travel or reproduce the stall. Refreshed `release/linux-unpacked/` as v0.4.5. The existing saved 30-second job limit is preserved (set it to `0` in settings for continuous follow).
- [ ] Live hit-and-move acceptance remains pending user interaction; the original intermittent follow stall still needs reproduction if it persists after this update.

### Minecraft freedom and quiet gameplay — v0.4.6

- [x] Replace the contradictory two-layer Minecraft permission flow with one source of truth: known bundled game tools default to Allow; explicit Blocked/Ask choices still apply, persist across bundled definition updates and same-character connection saves, and take effect in the running worker. External MCP servers remain default-deny/fingerprint-bound; unknown tools and non-bundled endpoints cannot inherit Minecraft's exception.
- [x] Retire the separate movement, block-edit, public-chat and Free play UI switches. Derive worker capabilities from tool choices. Terrain-changing navigation requires both block tools set to Allow (not Ask); blocked lookup cannot trigger operator queries indirectly through follow. Stop existing actions on permission changes; preserve the original movement anchor when reconfiguring navigation.
- [x] One-time migration removes legacy gates and fences/timer, including the old 30-second test limit, and selects 1,024 blocks per collection. Preserve explicit tool blocks and user-selected optional limits after migration. This runs through normal app storage at startup; no manual edits to the live profile were made.
- [x] Keep job bookkeeping out of ordinary chat: system context and action/tool text ask for quiet background execution, no job IDs/status narration or unsolicited repetitive reminders, brief natural acknowledgements, and only relevant verified outcomes/blockers. UI status and Stop remain available. This is prompt-level behavior, not a guarantee of every model's phrasing.
- [x] Regression coverage for default-allowed mining despite legacy flags, explicit denial/restoring Allow, indirect navigation/coordinate-lookup restrictions, reconnect/definition/save persistence, one-time migration, external-MCP isolation and quiet context (including autonomous messages). **183 core tests and 30 UI tests pass.** Update movement-only live smoke to explicitly block terrain edits/public chat before any action under the new defaults.
- [x] Production/package build and isolated desktop smoke pass; refreshed `release/linux-unpacked/` as v0.4.6. Live mining/building and real-provider conversational phrasing were not exercised in this increment; no world changes were made during development.

### Everyday Minecraft gameplay — v0.4.7

- [x] Add 17 bundled tools (26 total): inventory inspection, loaded-block search, exact-quantity/slot dropping, hand/off-hand/armor equipment, eating/drinking, sleeping/waking, targeted melee hit/fight, entity interaction/mount/dismount, block interaction, held-item use/release, gaze, exact-block digging, recipe discovery/crafting, storage transfers and furnace management.
- [x] Keep all new tools allowed unless explicitly blocked; preserve existing choices and external MCP isolation. Automatic terrain navigation requires all relevant block-edit/interaction tools set to Allow. No duplicate gameplay permission switches.
- [x] Enrich observation with entity IDs/types, sleep/riding/time/game-mode state. Store structured action results and expose them in job status and expandable settings details; preserve quiet conversational instructions. Distinguish inputs sent from verified inventory/block/sleep/death outcomes, with no fabricated delivery, projectile-hit or kill claims.
- [x] Serialize replacements through action cleanup and pending protocol operations; bound inventory/window operations, release held use on cancellation, close storage/furnace windows (including late opens), and avoid implicit item tossing when unequipping a full inventory. Recognize sleeping/riding in the physics monitor.
- [x] Simulated regressions cover quantities, equipment/food, beds, combat/death/lost targets/cancellation, interactions, recipe output counts, window-local inventory changes, furnace operations, aborted/late windows, operation fencing, engine replacement/results, default grants and permission controls. Movement-only live smoke explicitly blocks every other mutating tool before any action.
- [x] Validation: **213 core tests, 30 UI tests**, production/package build and isolated desktop smoke pass. Refreshed `release/linux-unpacked/` as v0.4.7. Updated gameplay guide and settings tool descriptions/results. Real-provider action sequencing remains unverified; the prompt explicitly requires completion checks between dependent actions and does not promise an autonomous continuation after the tool turn ends.
- [ ] Live gameplay acceptance in a disposable/designated world: dropping, sleep, combat, crafting, storage and smelting. No live world changes or real-provider gameplay tests were performed in this increment.
- [ ] Further gameplay: automatic fishing, enchanting/anvils, full villager trade selection, vehicle steering, recursive resource/crafting plans, reactive combat and resumable autonomous game goals.

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
