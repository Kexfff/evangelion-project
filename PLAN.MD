# evangelion_project — development plan

Updated: 2026-10-06 · Current release: **v0.4.15**

This is the active roadmap. Detailed implementation notes, past test results and incident records live in [development history](docs/development-history.md). Historical unchecked boxes there are not the current backlog.

## 1. Product and architecture

A local-first desktop companion with an animated VRM avatar, natural voice conversation, persistent memory and modular integrations. Separate transparent companion and settings windows. LLM, ASR and TTS use independently configured OpenAI-compatible APIs; OpenRouter is the initial LLM provider.

“Consciousness” is a behavioral simulation (mood, boredom, relationships, initiative and reminders), not a claim of sentience. Minecraft autonomy is independent of conversational initiative.

| Area | Current implementation |
| --- | --- |
| Desktop / UI | Electron; isolated preload and validated IPC; React, TypeScript, Vite |
| Avatar | Three.js, three-vrm and VRMA; default `AvatarSample_B.vrm`; custom avatars |
| Conversation / voice | Shared main-process runtime for desktop and Telegram; streaming chat, ASR, buffered/streaming TTS, energy VAD, barge-in, press-to-talk |
| Memory / credentials | Character-scoped JSON store with atomic writes/backup; facts, conversation archives, cached embeddings and lexical fallback; OS vault with labeled local AES-GCM fallback |
| Extensions | Shared plugin lifecycle; Telegram channel; stdio/Streamable HTTP MCP tools; app-managed Minecraft worker |
| Gameplay | `GameDirector` selects intentions; `GameCoordinator` plans/verifies steps; one worker owns physical actions; world journal, landmarks and persistent goal history |

Guides: [voice](docs/providers-and-voice.md), [memory](docs/characters-and-memory.md), [consciousness](docs/consciousness.md), [Telegram](docs/telegram.md), [MCP](docs/mcp.md), [Minecraft](docs/minecraft.md).

## 2. Delivered

“Implemented” does not mean every provider, device or live-world scenario has been accepted.

| Milestone | Delivered scope | Status |
| --- | --- | --- |
| Sprint 1 | Two-window app, chat/ASR/TTS, character cards, short/long-term memory, VRM/animations | Implemented |
| Sprint 1.5 + additions | Persistent credentials, model discovery, devices/gain, VAD/barge-in, streaming TTS, semantic recall, images, sentence/line/full-response speech | Implemented |
| Sprint 2 | Mood/relationship state, proactive conversation, approved persistent reminders, expression/gesture behavior | Implemented |
| Sprint 3 | Plugin foundation and Telegram text/images/voice with shared conversation and memory | Implemented; live Telegram acceptance open |
| UI / provider refinements | Fact constellation, searchable conversation archives, overview statistics, default avatar/docs refresh, resilient fact extraction, OpenRouter provider selection | Implemented |
| Sprint 4 + Minecraft mini-sprints | MCP, 26 gameplay tools, following/operator lookup, physics fixes, door-aware routes, goals/planning/verification, independent autonomy, manual join/plugin switch | Implemented foundation; live gameplay acceptance open |
| v0.4.13–0.4.14 | Reach/visibility-aware station approaches, alternate tables, progress-aware timeouts, per-table diagnostics | Implemented; obstructed-station acceptance open |
| v0.4.15 | Configurable hold/toggle press-to-talk, Right Shift default, capture ownership/cancellation, keybind test | App-focused delivered; global acceptance deferred |

**Latest recorded validation:** 341 core tests, 40 browser tests, typecheck, production/package build, isolated desktop smoke and packaged-isolation smoke passed for v0.4.15. Linux unpacked build: `release/linux-unpacked/`. These are prior recorded results, not a test rerun for this documentation edit.

**Live evidence:** movement/following and operator lookup at roughly 302 blocks were verified in authorized LAN tests. The user reports working chat/TTS, some newer game tools, and no more apparent freezing. This does not establish complete gameplay, physical-microphone or cross-platform acceptance.

Previously stale Sprint 4 TODOs for task planning, observed completion, shared action coordination, schedules and autonomous goal selection are implemented. Remaining gaps are separated below.

## 3. Next: acceptance and reliability

Suggested next mini-sprint: validate the existing Minecraft and voice features before expanding mechanics. These checks require the user's setup or a designated test world; this plan does not authorize live connections, paid calls or world changes.

### Minecraft

- [ ] **Navigation and stations:** enter a designated house through its door from both sides; route around walls to crafting tables/furnaces/storage; test multiple nearby tables and inspect approach diagnostics. Confirm progress resets the inactivity timer, while genuine stalls and the overall deadline stop work.
- [ ] **End-to-end crafting/building:** obtain missing prerequisites and craft a stone pickaxe; verify recipe output counts, bench placement, inventory changes, a small build and partial-failure reporting. Use a disposable/designated area for block changes.
- [ ] **Continuous autonomy:** with companion Consciousness disabled, complete several useful intentions without chat prompts. Check concurrent desktop/voice/Telegram chat, explicit user priority, Stop staying stopped, pause/resume reconciliation, budgets/backoff, world switches and no automatic rejoin.
- [ ] **Gameplay coverage:** finish a tool-by-tool live pass for dropping, beds, combat, equipment/food, storage and smelting. Include knockback while following; investigate freezing further only if it recurs.
- [ ] **Integration coverage:** add repeatable disposable-server tests alongside the existing simulated-world and MCP transport/failure fixtures; verify live Microsoft device-code login separately.

### Voice, providers and Telegram

- [ ] **Physical press-to-talk:** Right Shift in the focused companion, outside text fields; verify release-to-send, toggle, fast taps, silence, selected device, barge-in, Escape/blur cancellation and restart. App-focused is the user's chosen scope for now.
- [ ] **Provider/device quality:** verify real ASR/TTS latency, streaming and line-mode quality, permissions, echo handling, vision responses, extraction recovery and multilingual semantic recall with the user's chosen endpoints. Basic chat/TTS already works according to user feedback.
- [ ] **Telegram acceptance:** paired private-bot text/images/OGG voice, optional MP3 replies, shared recall, scheduled notifications and disable/unpair behavior on actual devices.
- [ ] **Companion autonomy:** validate live model scheduling, mood/expression presentation and actual lock/suspend behavior beyond simulated clocks and desktop fixtures.

Acceptance records should name the app version, scenario, observed result and remaining failure—not infer success from a “running” job or a passed fixture.

## 4. Remaining implementation backlog

Not all items belong in the next mini-sprint; choose scope after the acceptance pass.

### Gameplay depth

- [ ] Richer persistent multi-project records and resource targets beyond finite intentions and the bounded world journal.
- [ ] Dedicated host-verifiable sleep/combat goal-completion criteria; those tools already exist as execution steps.
- [ ] Deeper prerequisite/resource planning and recovery beyond the current incremental planner; improve from real-provider failures, not blind retries of uncertain actions.
- [ ] Automatic fishing, enchanting/anvils, full villager trading, vehicle steering and richer reactive combat.
- [ ] Automatic discovery/use of redstone mechanisms for closed iron doors; ordinary manually openable doors are already supported.
- [ ] Encrypted persistent Microsoft account sessions; current authentication tokens are memory-only.

### Memory, voice and presentation

- [ ] Conversation summarization/consolidation, retrieval evaluation, scalable SQLite/FTS/vector storage and task/archive retention.
- [ ] Image resizing/compression, separate attachment storage and visual long-term retrieval. Current inline images can push archives beyond the 50 MB import cap.
- [ ] Encrypted memory archives, retention/deletion controls and better backup management; plaintext backups may retain deleted data.
- [ ] Streaming transcription and neural VAD; current VAD is local energy detection, not speaker recognition.
- [ ] Richer gaze, facial mixing, phoneme visemes and gesture selection; blinking, amplitude-based mouth movement and basic emotion/one-shot gestures already exist.
- [ ] Portable character-card import/export and richer avatar metadata.
- [ ] Optional genuine embedding projection/similarity links; the existing fact-only constellation is intentionally artistic, as requested.
- [ ] CPU/GPU profiling, lazy avatar loading and reduced work while windows are hidden.

### Plugins, MCP and delivery

- [ ] Third-party plugin loading/discovery, signatures, updates and an actual hostile-code sandbox. Current bundled workers and local MCP programs are not such a sandbox.
- [ ] MCP OAuth, resources/prompts UI, sampling/elicitation, filesystem roots and broader validated schema support. Tools over stdio/Streamable HTTP are implemented; legacy HTTP+SSE is not.
- [ ] Telegram enhancements if needed: album grouping, additional media types and broader account/character routing. Current scope is one paired private account/character.
- [ ] Tray/background-service/OS-wake support; the app currently must remain running.
- [ ] Installable, signed platform releases; test transparency, audio permissions and always-on-top behavior on each supported OS/compositor.
- [ ] Obtain the bundled model's original source/license URL or license text **from the user/source**; retain existing embedded attribution without inventing a license.

## 5. Explicitly deferred

- **Raw DSML tool markup:** detection/recovery was deferred by the user. OpenRouter provider selection does not fix it; track it as a potential live-model reliability blocker.
- **Global press-to-talk on this desktop:** Niri 26.04/Wayland advertises the GNOME shortcut portal but rejected the live session. The user chose app-focused only. A Linux portal adapter exists; actual global press/release, consent/reassignment and overlay behavior still need acceptance on a working desktop. Windows/macOS global input is unimplemented. Do not add keyboard hooks, device permissions or compositor changes without a new decision.
- **General PC observation/control:** an optional future capability-gated integration, not part of Minecraft autonomy or the current sprint.

## 6. Guardrails and definition of done

- Minecraft is app-managed, Java Edition/LAN, manually joined. No separate user-run bot and no auto-rejoin. Game tools are allowed unless explicitly blocked/Ask; external MCP tools remain default-deny. Do not restore duplicate Minecraft permission gates.
- Keep one physical-action owner, observed completion, clear partial failures and cancellation. Stop pauses autonomous reselection. Restart/disconnect never blindly replays uncertain actions; explicit Resume reconciles the current world.
- Conversational and game autonomy remain independent. Normal chat stays responsive; routine job bookkeeping stays out of conversation. General external MCP tools are not available to proactive messages/reminders.
- Preserve character/world/session isolation, secrets boundaries and existing data. Test fixtures must use verified disposable profiles in source **and packaged** apps; never persist mock provider URLs into the normal profile (historical v0.4.2 incident).
- For code changes: targeted regressions, typecheck and relevant core/UI/desktop checks; rebuild packages when delivering an app update. Record live checks separately from mocked/synthetic ones. Provider-reported usage is not a guaranteed billing ceiling.
- Update this roadmap with completed/open work; put chronological detail in [development history](docs/development-history.md) and operating instructions in [docs](docs/README.md).
