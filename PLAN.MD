# evangelion_project — development plan

Updated: 2026-10-08 · Current release: **v0.4.17** · Roadmap target: **v0.5**

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
| v0.4.13–0.4.14 | Reach/visibility-aware station approaches, alternate tables, progress-aware timeouts, per-table diagnostics | Implemented; controlled-world station acceptance passed in v0.4.16 |
| v0.4.15 | Configurable hold/toggle press-to-talk, Right Shift default, capture ownership/cancellation, keybind test | App-focused delivered; global acceptance deferred |
| v0.4.16 | Live-found door/arrival fixes, server-synchronized crafting and exact output verification; repeatable opt-in gameplay/autonomy acceptance | Controlled-world core checks passed; extended acceptance below |
| v0.4.17 | World projects/resource targets, event-verified sleep/defeat goals, recipe prerequisites, fishing, enchanting/anvils, villager trading and bounded steering/combat options | First Gameplay depth increment; live station/trade/fishing checks passed; remaining scope below |

**Latest validation:** v0.4.17 typecheck, 373 core/40 browser regressions, Linux package, standalone desktop smoke, packaged profile-isolation and packaged live Minecraft worker smoke. Exact scenarios and the initial concurrent desktop-smoke timeout are recorded in [acceptance results](docs/minecraft-acceptance.md). Linux unpacked build: `release/linux-unpacked/`.

**Live evidence:** v0.4.16 verified door entry/exit, obstructed stations, crafting/building, storage/smelting, combat, sleep/wake, food and follow/knockback on the authorized test world. Three real-provider autonomous intentions completed with Consciousness off in 8 requests; Stop stayed stopped. Prior operator lookup reached roughly 302 blocks. This does not establish complete survival, physical-microphone or cross-platform acceptance.

Previously stale Sprint 4 TODOs for task planning, observed completion, shared action coordination, schedules and autonomous goal selection are implemented. Remaining gaps are separated below.

## 3. v0.5 roadmap — ordered mini-sprints

User-confirmed priority: **Minecraft → Gameplay depth → Plugins, MCP and delivery → Memory, voice and presentation → Voice, providers and Telegram**. Work through these mini-sprints in order; optional items remain optional. The v0.5 goal is reliable, deeper gameplay, extensible delivery, and a more polished companion, with final real-device/provider acceptance.

Live checks require the user's setup or a designated test world; this plan does not authorize live connections, paid calls or world changes. Acceptance records should name the app version, scenario, observed result and remaining failure—not infer success from a “running” job or a passed fixture.

### 3.1 Minecraft — reliability delivered; extended acceptance open

Goal: validate the existing Minecraft foundation end to end, fix observed reliability failures and make the checks repeatable before expanding gameplay.

- [x] **Navigation and stations:** live doorway traversal both ways without wall damage, wall detours to stations, enclosed-table fallback and approach diagnostics. Fixed door waypoint height/corner stalls and station arrival tolerance. Progress/inactivity/overall deadlines remain regression-tested.
- [x] **Scripted crafting/building:** live harvesting, stone pickaxe, exact recipe quantities, bench creation/placement/use, small build and preserved partial-failure effects in a prepared arena. Fixed optimistic crafting with server synchronization and per-operation output checks.
- [x] **Bounded real-provider autonomy:** three separately selected/completed intentions with Consciousness off; Stop stays stopped. 8/10 authorized requests, approximately $0.006 reported. Priority, pause/resume, budgets/backoff, world isolation and no-auto-rejoin remain covered by deterministic tests.
- [x] **Core gameplay acceptance:** live drops, beds/wake, confirmed enemy death, equipment/food, storage transfers, completed smelting and follow/knockback/Stop. No physics freeze observed during these checks.
- [x] **Repeatable integration checks:** opt-in disposable-world runner plus isolated real-provider mode; packaged app-managed MCP worker join/observe/disconnect smoke. Instructions and exact evidence: [Minecraft acceptance](docs/minecraft-acceptance.md).
- [ ] **Extended acceptance:** from-empty autonomous prerequisite gathering/survival; concurrent real desktop/voice/Telegram interaction and priority/pause/world-switch scenarios; remaining tool variants and Microsoft device-code login. Do not infer these from the bounded arena run. No further paid runs are authorized by the completed ten-request test allowance.

### 3.2 Gameplay depth — first increment delivered; continue here

Goal: extend Eva's survival skills and longer-term projects, with stronger resource planning, recovery and verifiable outcomes.

- [x] **Persistent projects/resource targets:** character/world/account-scoped records, active/paused/archived states, current-stock cards, editing and linked goal outcomes. Active projects inform the independent director; creating one never enables autonomy or starts work by itself. UI and `game_project` chat tool; data survives restart without action replay.
- [x] **Host-verifiable sleep/defeat criteria:** successful matching worker action evidence, UUID-bound enemy identity, durable witnesses separate from bounded step history. Lost tracking, an attack packet or old unrelated jobs cannot establish defeat.
- [x] **Crafting prerequisite analysis:** `plan_resources` accounts for recipe output quantities, shared ingredients, carried stock and leftovers. Bounded recursive search reports acquisition leaves/table needs; planner is instructed to recompute after changes. No invented smelting, drops or blind mutation retries.
- [x] **New mechanics:** automatic fishing/reeling with inventory checks and nearby-drop pickup/return; enchanting; server-previewed anvil rename/repair/combine; offer inspection and bounded villager trades with input/price checks and per-operation metadata/output verification. 32 bundled Minecraft tools. Basic enchanting, rename, trades and fishing passed live; limits in [Gameplay depth](docs/gameplay-depth.md).
- [x] **Steering/combat primitives:** bounded mounted steering releases input on Stop and reports displacement; optional melee gear selection, health-triggered stopping/explicit retreat, and UUID target checks. Tested primitives, not complete vehicle physics or automatic attacker selection.
- [ ] **Finish advanced mechanics acceptance:** anvil repair/combine and upgrade/two-input trades in the live world; wandering traders; vehicle-specific steering/physics and useful navigation; richer observed-attacker defense/shield/ranged tactics. Do not infer these from rename/ordinary-trade or mocked steering tests.
- [ ] **Survival/project planning acceptance:** from-empty resource/tool/station acquisition and sustained multi-project progression with a real provider; refine alternatives/recovery from observed failures. Current resource planner is advisory and bounded, not an optimal reservation system or smelting/trade planner. No paid-provider requests were made in v0.4.17 acceptance.
- [ ] Automatic discovery/use of redstone mechanisms for closed iron doors; ordinary manually openable doors are already supported.
- [ ] Encrypted persistent Microsoft account sessions; current authentication tokens are memory-only.

### 3.3 Plugins, MCP and delivery

Goal: make integrations extensible and distribution practical, with explicit trust boundaries, broader MCP support and installable releases.

- [ ] Third-party plugin loading/discovery, signatures, updates and an actual hostile-code sandbox. Current bundled workers and local MCP programs are not such a sandbox.
- [ ] MCP OAuth, resources/prompts UI, sampling/elicitation, filesystem roots and broader validated schema support. Tools over stdio/Streamable HTTP are implemented; legacy HTTP+SSE is not.
- [ ] Telegram enhancements if needed: album grouping, additional media types and broader account/character routing. Current scope is one paired private account/character.
- [ ] Tray/background-service/OS-wake support; the app currently must remain running.
- [ ] Installable, signed platform releases; test transparency, audio permissions and always-on-top behavior on each supported OS/compositor.
- [ ] Obtain the bundled model's original source/license URL or license text **from the user/source**; retain existing embedded attribution without inventing a license.

### 3.4 Memory, voice and presentation

Goal: improve long-term recall and data management, make voice/avatar interaction more natural, and reduce resource use.

- [ ] Conversation summarization/consolidation, retrieval evaluation, scalable SQLite/FTS/vector storage and task/archive retention.
- [ ] Image resizing/compression, separate attachment storage and visual long-term retrieval. Current inline images can push archives beyond the 50 MB import cap.
- [ ] Encrypted memory archives, retention/deletion controls and better backup management; plaintext backups may retain deleted data.
- [ ] Streaming transcription and neural VAD; current VAD is local energy detection, not speaker recognition.
- [ ] Richer gaze, facial mixing, phoneme visemes and gesture selection; blinking, amplitude-based mouth movement and basic emotion/one-shot gestures already exist.
- [ ] Portable character-card import/export and richer avatar metadata.
- [ ] Optional genuine embedding projection/similarity links; the existing fact-only constellation is intentionally artistic, as requested.
- [ ] CPU/GPU profiling, lazy avatar loading and reduced work while windows are hidden.

### 3.5 Voice, providers and Telegram

Goal: finish v0.5 acceptance on real microphones, chosen providers and Telegram devices, including companion initiative and scheduling.

- [ ] **Physical press-to-talk:** Right Shift in the focused companion, outside text fields; verify release-to-send, toggle, fast taps, silence, selected device, barge-in, Escape/blur cancellation and restart. App-focused is the user's chosen scope for now.
- [ ] **Provider/device quality:** verify real ASR/TTS latency, streaming and line-mode quality, permissions, echo handling, vision responses, extraction recovery and multilingual semantic recall with the user's chosen endpoints. Basic chat/TTS already works according to user feedback.
- [ ] **Telegram acceptance:** paired private-bot text/images/OGG voice, optional MP3 replies, shared recall, scheduled notifications and disable/unpair behavior on actual devices.
- [ ] **Companion autonomy:** validate live model scheduling, mood/expression presentation and actual lock/suspend behavior beyond simulated clocks and desktop fixtures.

## 4. Explicitly deferred

- **Raw DSML tool markup:** detection/recovery was deferred by the user. OpenRouter provider selection does not fix it; track it as a potential live-model reliability blocker.
- **Global press-to-talk on this desktop:** Niri 26.04/Wayland advertises the GNOME shortcut portal but rejected the live session. The user chose app-focused only. A Linux portal adapter exists; actual global press/release, consent/reassignment and overlay behavior still need acceptance on a working desktop. Windows/macOS global input is unimplemented. Do not add keyboard hooks, device permissions or compositor changes without a new decision.
- **General PC observation/control:** an optional future capability-gated integration, not part of Minecraft autonomy or the current sprint.

## 5. Guardrails and definition of done

- Minecraft is app-managed, Java Edition/LAN, manually joined. No separate user-run bot and no auto-rejoin. Game tools are allowed unless explicitly blocked/Ask; external MCP tools remain default-deny. Do not restore duplicate Minecraft permission gates.
- Keep one physical-action owner, observed completion, clear partial failures and cancellation. Stop pauses autonomous reselection. Restart/disconnect never blindly replays uncertain actions; explicit Resume reconciles the current world.
- Conversational and game autonomy remain independent. Normal chat stays responsive; routine job bookkeeping stays out of conversation. General external MCP tools are not available to proactive messages/reminders.
- Preserve character/world/session isolation, secrets boundaries and existing data. Test fixtures must use verified disposable profiles in source **and packaged** apps; never persist mock provider URLs into the normal profile (historical v0.4.2 incident).
- For code changes: targeted regressions, typecheck and relevant core/UI/desktop checks; rebuild packages when delivering an app update. Record live checks separately from mocked/synthetic ones. Provider-reported usage is not a guaranteed billing ceiling.
- Update this roadmap with completed/open work; put chronological detail in [development history](docs/development-history.md) and operating instructions in [docs](docs/README.md).
