# evangelion_project

A desktop AI companion with a transparent animated VRM window, separate settings, voice conversation, persistent memory, opt-in proactive conversation/reminders, and a private Telegram channel. Inspired by [AIRI](https://github.com/moeru-ai/airi); this is an independent implementation using your supplied `Eva.vrm` and `animations/*.vrma` assets. Current build: Sprint 3 / v0.3.1.

## Run

Requires Node.js 22.12+ (or a newer supported Node release), npm, and a desktop session with WebGL support.

```sh
npm install
npm run dev
```

On npm versions that block dependency install scripts, approve the pinned build-tool setup scripts and rebuild:

```sh
npm install-scripts approve esbuild electron-winstaller
npm rebuild esbuild electron-winstaller
```

Electron 44 downloads its runtime on first use, so the first launch needs network access if the binary is not cached. You can download it ahead of time with `node node_modules/electron/install.js`.

The first launch opens the companion and settings windows. The avatar window is frameless and transparent; drag its title bar to move it. The settings window can reopen the companion. Linux transparency and always-on-top behavior depend on the window manager/compositor, particularly on Wayland.

```sh
npm run build       # Type check, production renderer, main process and preload
npm start           # Launch the built desktop app
npm run package     # Create an unpacked app for your current platform in release/
npm run dev:ui      # Browser-only visual preview on http://127.0.0.1:5173
```

The browser preview renders the real avatar and settings, but cannot call providers, use desktop dialogs, or persist data. Its in-memory changes disappear on refresh. Use Electron for the complete application. During `npm run dev`, renderer changes hot reload; restart the command after changing main-process or preload code.

## First conversation

1. Open **Providers**. Enable the language model provider, enter your OpenRouter API key, and choose a model ID. The default API base is `https://openrouter.ai/api/v1`, with `openrouter/auto` as the initial routing model. Save, then use **Fetch models** and test the connection. Each service has its own model catalog; manual IDs remain available for servers without a compatible `/models` endpoint.
2. Configure ASR and TTS independently. Enter the base URL (including `/v1`, if required), model ID, optional API key, and TTS voice supported by your service. The initial localhost URLs are examples; no audio server is bundled or started. OpenRouter is the default for text generation, not an assumed audio backend.
3. Save settings and test each enabled service. Connection tests issue small real requests and may incur charges. Both voice chat and the ASR test send 16 kHz mono PCM WAV audio.
4. In **Voice & audio**, select microphone and speakers/headphones. **Refresh devices** requests permission to display device names; **Test microphone** shows a local-only level meter, and **Test output** plays a short quiet tone. Adjust microphone gain and the voice detection threshold for your setup.
5. Open the companion and type a message, or click the microphone to record and click again to send. With **Hands-free voice detection** enabled, clicking the microphone starts continuous local listening: speech is sent after the configured pause, and each utterance is capped at 60 seconds. Click the microphone again or press Stop to disable listening. Listening never starts automatically at launch.
6. With **Interrupt when I speak** enabled, detected speech cancels the current generation and queued audio before transcribing your new utterance. This operates while hands-free listening is enabled. Echo cancellation is on by default; headphones are recommended if speakers trigger unwanted interruptions.
7. **Speech delivery** offers **Sentence by sentence**, **Line by line**, and **Full response**. Sentence mode starts TTS at sentence boundaries. Line mode keeps short sentences together until an explicit newline (not visual wrapping), then synthesizes that line as one request; the unfinished last line is spoken when the reply ends. With no newlines, line mode waits for the full reply. This provides more context to local TTS models at the cost of some startup latency. Full response always waits for completion. Existing sentence/full-response settings are preserved. Exceptionally long lines split only at the speech API's 12,000-character limit.
8. **Stream speech audio** feeds incoming MP3 chunks to Media Source Extensions so playback can begin before the download finishes. The provider must actually stream its HTTP body for that latency benefit. Unsupported containers (such as WAV) use buffered playback. Audio streaming is independent of Speech delivery and works with all three modes. Manual **Read aloud** still synthesizes the whole saved reply.

Provider adapters and discovery use these OpenAI-compatible HTTP endpoints:

| Service         | Request                                                                           | Expected response                                                  |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| LLM             | `POST {base}/chat/completions`, JSON with model, messages, stream                 | SSE `choices[].delta.content`, or JSON `choices[].message.content` |
| ASR             | `POST {base}/audio/transcriptions`, multipart file/model/response_format/language | JSON `{ "text": "…" }`                                             |
| TTS             | `POST {base}/audio/speech`, JSON model/input/voice/speed/response_format          | MP3 audio bytes                                                    |
| Embeddings      | `POST {base}/embeddings`, JSON model/input/encoding_format                        | Float vectors in `data[].embedding`, ordered using `index`         |
| Model discovery | `GET {base}/models` (`/embeddings/models` for OpenRouter embeddings)              | `data[].id`                                                        |

Provider errors show an actionable status without reflecting potentially sensitive upstream response bodies. Requests time out after 90 seconds. Chat replies and transport/auth/quota failures are not automatically retried. Automatic fact extraction has the bounded format-recovery exception below.

### Automatic memory extraction

When enabled in Memory, this is a separate background LLM request after the chat reply is saved. It uses temperature 0.1 and a 2,048-token output cap; OpenRouter requests also ask to disable optional reasoning through its [reasoning parameter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). Ordinary chat settings are unchanged. Complete JSON arrays, `{"facts":[...]}` objects and a single JSON code block are accepted; facts remain validated, deduplicated and limited to three short strings. Partial JSON and reasoning text are never stored as facts.

Invalid, empty or token-truncated extraction output gets **one fresh attempt**, capped at 4,096 tokens. This can incur an additional LLM charge; both requests and reported usage appear in Consciousness activity. Unsupported JSON-mode/function-calling features are not required. HTTP failures are not retried. Cancellation and deleted source messages do not generate false extraction warnings or restore deleted facts. If extraction still fails, the warning and `memory-failed` activity entry identify the failure category without logging the model output, credentials or provider response body. Your chat reply and existing memories remain saved; add any missing fact manually. Failed past extractions are not replayed automatically.

## Image messages

Click the paperclip in the companion composer to choose images, or paste an image from the clipboard. Preview and remove attachments before sending; a text caption is optional. PNG, JPEG, WebP and GIF are accepted, up to four images per message and 2 MB per file. Larger files must be resized before attaching. Choose a vision-capable LLM in Providers: the model catalog is not filtered by vision support, and text-only models or providers with stricter image limits may reject the request.

Images use text-first `content` arrays with `image_url` data URLs through the existing chat-completions endpoint, following the [OpenRouter image-input format](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding). No public upload or separate image provider is needed. Selecting/pasting only reads the image locally; sending uploads it to your configured LLM service. The four newest images within the bounded recent conversation are included on subsequent turns, so follow-up questions can reference them; older omitted images are explicitly marked. Starting a new conversation stops including images from the previous session.

Attachments are stored inline with messages in `companion.json`, survive restarts and appear in chat history and memory exports. These images, including original metadata, are not encrypted or stripped; the normal database backup can retain deleted attachments until the next write. Treat archives as private. Base64 makes image-heavy histories larger, and the existing 50 MB archive import limit still applies. Deleting history also removes its attachments from the current database. Semantic indexing and automatic fact extraction use message text only, not image bytes; image-only turns skip both. Visual long-term retrieval, automatic resizing and a separate scalable attachment store remain future work.

## Characters, avatars, and memory

**Character cards** supports multiple names, taglines, personalities, system prompts, and VRM references. Choose a card and save to activate it. Conversations and facts are scoped to the active character. Custom avatars are copied into app storage, so moving the original file will not break them.

**Avatar studio** controls position, zoom, rotation, key light color/intensity, blinking, always-on-top, and all nine supplied animations. Manually selected animations loop. With expressive behavior enabled, the companion blends subtle happy/sad/relaxed expressions and short greeting/peace-sign gestures into idle animation on replies, returning to idle when interrupted. VRM 0.x and 1.x are loaded with `@pixiv/three-vrm`, and VRMA clips are retargeted to the loaded humanoid. Lip movement is audio amplitude based, not phoneme-level visemes.

**Memory** has three layers:

- A persistent current conversation, with a configurable recent-message window and a 24,000-character recent-context budget.
- Editable long-term facts, ranked by keyword relevance or semantic similarity.
- Persistent older user messages, recalled across sessions using the same retrieval mode. Recent conversation context is included regardless of retrieval mode.

For **semantic memory**, configure and enable the **Remember · Embeddings** provider. It has its own URL, model and API key (even if you use OpenRouter for both chat and embeddings). Then enable **Semantic memory** in Memory, save, and run **Build / update semantic index**. OpenRouter's initial embedding model is `openai/text-embedding-3-small`; compatible local embedding servers also work.

Embeddings are cached locally in `memory-vectors.json`, keyed by provider URL/model and memory content. Retrieval uses cosine similarity with a configurable minimum score and remains character-scoped. Editing/deleting facts, deleting history, or changing the embedding model invalidates affected vectors. Imports bring in source memories, not vectors: rebuild after a large import. Each turn incrementally indexes at most 32 missing documents and embeds its query; an explicit rebuild processes the whole active character archive in batches of 32. Old user messages are embedded up to their first 4,000 characters. This sends those memories and queries to your configured embedding service and may incur charges. If the service fails, the reply uses lexical recall and displays a notice.

Automatic remembering is off by default. Enabling it adds one LLM call after a completed turn to extract up to three explicitly stated user facts. These appear in Memory, where they can be corrected or deleted. A new conversation preserves facts and old messages. Deleting history removes that character's chat history after confirmation, while preserving facts.

Exports contain the saved active character's facts and all conversation sessions, without provider settings or API keys. Imports validate the archive and merge into the current character; exact duplicate facts and messages are skipped. Imported conversations are recalled as past sessions. Import/export uses native file dialogs.

## Consciousness, initiative and reminders (Sprint 2)

This is an inspectable **behavior simulation**, not actual sentience. Mood, boredom, energy, trust and affinity persist per character and influence tone and avatar expressions. The state editor explains each update rule and lets you adjust values and bounds. Absence does not lower relationship values. Idle drift is capped at six hours per update; no background LLM call is needed to update state.

1. In **Consciousness**, set your **IANA time zone** (default UTC; for example `Europe/Moscow`), quiet hours, cooldown and daily budget. Save changes.
2. Enable **autonomy** to permit scheduled reminders. Separately enable **conversation openers** if you want unsolicited chat. Both start off. Openers require the idle threshold, sufficient boredom and energy, and positive initiative. A default initiative of 40 means boredom must reach 60; it does not promise a message exactly at the idle threshold.
3. Create a reminder with an exact ISO timestamp containing `Z` or an offset, such as `2026-09-13T18:30:00+03:00`. Creating it in settings authorizes it. Times must be in the future and within one year. The task manager shows the persistent ID, UTC instant, supplied time-zone label, status and outcome. Cancel tasks there.
4. Optionally enable **LLM scheduling tools** and choose a tool-capable model. The model can propose, list and cancel reminders via the [OpenRouter-compatible function-calling protocol](https://openrouter.ai/docs/guides/features/tool-calling). **Every LLM-created task needs your approval in Consciousness before it is armed.** For compatibility, tools-enabled user replies use a bounded, non-streaming loop (at most four LLM requests); intermediate planning/tool JSON is never spoken. Disabling scheduling tools restores normal streamed chat. Autonomous turns cannot schedule more actions.
5. Keep the companion visible and idle for desktop delivery, or enable the paired Telegram notification channel described below. Typing or an image draft, recording/hands-free listening, generation, queued/playing audio, system lock/suspend, quiet hours and manual pause defer autonomous actions. Missing renderer heartbeats/minimization defer desktop delivery but do not prevent an available Telegram channel from delivering. Fresh busy presence still blocks Telegram notifications even if minimized. No desktop observation detects other apps: use **Pause autonomy** in the avatar title bar when busy elsewhere. Desktop input preempts an autonomous reply. Settings changes cancel an in-flight generation before applying.

The internal clock checks every five seconds while the app runs. It does not run when the app is closed or wake a sleeping/powered-off PC. Only the active character delivers actions. Cooldown and the local-calendar daily budget apply to both reminders and openers; failed attempts count too. Quiet hours may cross midnight; equal start/end means quiet all day. After resume/restart, pending reminders inside the catch-up window wait for a safe opportunity; older ones become `missed`. A task claimed before a crash becomes `failed`, never automatically replayed: at-most-once attempts avoid duplicate reminders but cannot guarantee delivery during a crash. Cancelled/failed/missed tasks can be recreated manually. `done` means the reply was saved, not that audio was heard.

The activity log records policy changes, reasons, task outcomes, LLM request counts and provider-reported tokens/costs. Missing usage is marked **not reported**, never estimated as free. Audio/embedding charges and provider connection tests are not part of this log. Memory extraction has separate request/usage events. State, tasks (maximum 2,000 retained), and a rolling 500-entry activity log live in `companion.json`; the settings UI shows the latest 100 character-scoped events. **Memory exports do not include tasks, behavior state or plugin configuration**, and importing memory cannot arm tasks or enable integrations. Deleting chat history does not cancel reminders or clear behavior; use the task manager/global pause for that. MCP and game/PC actions remain future sprints.

## Telegram and plugins (Sprint 3)

Telegram is another input/output channel for the same companion, not a separate chatbot. It uses the paired character's current desktop session, recent conversation, long-term facts, semantic retrieval and optional automatic fact extraction. Telegram messages (including attached images) appear in desktop history with a channel label and in memory exports. Desktop conversation is not automatically forwarded to the bot.

1. Create your own bot with Telegram's **@BotFather** and obtain its bot token. Use a dedicated bot with no other running poller/webhook. The adapter uses [Telegram's Bot API](https://core.telegram.org/bots/api#getupdates) long polling; no public inbound server is needed.
2. Open **Plugins & MCP → Install bundled Telegram**. Paste the token and explicitly grant **Chat — shared character history and memory**. Optionally grant images, voice and notifications. Enable Telegram, then click **Save Telegram configuration**. These controls apply immediately, separately from the ordinary Save changes button. A blank token field preserves the saved token; replacing it revokes pairing and resets the bot's cursor.
3. With the desired character selected and saved, click **Generate pairing command**. Send the exact `/start …` command privately to your bot within five minutes. Keep it secret: it authorizes the account that sends it. The command is single-use. Only that private user/chat ID is accepted, bound to the character selected when the code was generated. Groups, bots and unpaired senders are ignored without model calls or media downloads. Unpairing revokes access and disables the channel.
4. Send text, a photo or an image document (PNG/JPEG/WebP/GIF, up to 2 MB). Captions and image-only messages work; choose an image-capable LLM. For Telegram photos, the largest available rendition within the limit is selected. Albums are processed as separate messages, not one combined multimodal turn. Arbitrary documents, videos and stickers are not supported.
5. With the voice grant and ASR configured, send a voice note up to 60 seconds/10 MB. Your ASR must accept **OGG/Opus**; the app does not transcode it. Enable **Send voice replies in addition to text** to synthesize MP3 with your saved TTS configuration and upload it using [sendVoice](https://core.telegram.org/bots/api#sendvoice). The text reply arrives first; failed TTS does not discard it. Voice replies use at most 12,000 characters; original audio is not stored locally, but the transcript is retained.
6. To receive reminders/openers on Telegram, grant notifications and enable **Deliver autonomous messages to Telegram**, then configure/enable Consciousness. LLM-created reminders still require desktop approval. When connected, the channel receives autonomous output instead of desktop speech. Quiet hours, cooldown, budgets, pause, system suspend/lock and busy checks still apply. If Telegram is unavailable, normal desktop delivery may be used when its own presence checks pass.

Keep the app running and the paired character active. Minimize the avatar to stay connected; closing all windows quits on Linux/Windows. There is no background service, tray or OS wake yet. Switching to a different character does not share that character's memory with the paired account: incoming messages are skipped and logged until you switch back. New desktop conversations also change Telegram's current conversation. Telegram waits up to 60 seconds for an existing generation; desktop shows busy/stop during a remote generation. Remote text is never fed into desktop automatic speech.

**Disable immediately** stops polling and cancels pending downloads, remote generation, synthesis and sends. Requests already accepted by Telegram cannot be recalled. **Remove Telegram** removes its token, configuration, pairing and diagnostics, while preserving shared history/facts. Install/update uses only the version bundled with the application; updating disables the plugin until explicitly re-enabled. No marketplace, arbitrary file loading or third-party executable plugins are supported yet.

Diagnostics retain the latest 100 redacted entries. Messages are limited to 12 accepted inputs/minute; outgoing text is split into Unicode-safe 4,000-character chunks with at least 1.1 seconds between sends. Polling reconnects with bounded backoff, then stops after eight consecutive failures. Authentication errors, polling conflicts and rate-limit waits above 60 seconds require manual restart after correcting the cause. The app will not delete someone else's webhook automatically.

Update IDs are persisted **before** processing, so a crash or cancellation can lose an accepted message rather than replay it. Inputs older than 24 hours are skipped. Ambiguous send failures/timeouts are not retried; only explicit 429 rejections retry (at most twice, respecting waits up to 60 seconds). If delivery is uncertain, check the shared desktop history and resend manually. This is at-most-once automatic processing, not an exactly-once delivery guarantee.

For extension development, start with `src/shared/plugins.ts` (manifest/API version, capability/settings schemas, channel port), `electron/plugin-host.ts` (trusted built-in lifecycle and grants), and `electron/plugin-events.ts` (failure-isolated event bus). Telegram's network work runs in a worker with a 64 MB V8 old-generation heap limit, four concurrent RPC requests maximum, bounded response/file sizes and timeouts. Adapters do not receive direct memory-store access or LLM/ASR/TTS keys. **A Node worker is not a security sandbox for hostile code**; only app-shipped trusted adapters can be installed. MCP and Minecraft remain Sprint 4.

## Storage and boundaries

Application data lives in Electron's `userData` directory, normally:

- Linux: `~/.config/evangelion_project/`
- macOS: `~/Library/Application Support/evangelion_project/`
- Windows: `%APPDATA%/evangelion_project/`

`companion.json` stores settings, messages, facts, and session IDs. Writes replace the file atomically, retaining the preceding version in `companion.json.bak`. A corrupt database stops startup rather than silently resetting your data. Close the app before manually restoring its backup. Both files contain plaintext conversation data; the backup may retain recently deleted entries until the next write. Imported avatars live in `avatars/`.

API keys persist separately in `credentials.json`. When an OS keyring is available, Electron `safeStorage` encrypts them. Without a usable keyring (including Linux's `basic_text` backend), the app uses AES-256-GCM with a random local key in `credentials.key`. Both files use owner-only permissions on Unix. The local key lives beside the ciphertext, so this fallback protects against casual exposure and other OS users, not software running as your user or someone who can read both files. Providers shows the selected storage method. The renderer receives key-presence flags only; memory exports never contain keys.

Sprint-1 databases receive new defaults on load without resetting existing settings or memories. Legacy OS-encrypted credentials are preserved even when their keyring is locked; affected requests ask you to unlock the keyring or re-enter that key. Keys that were previously session-only must be entered once again, then saved. Audio and microphone pre-roll stay in memory and are not written to disk by this app.

LLM/ASR/TTS/embedding requests execute in the main process; Telegram HTTP runs in its dedicated worker. Renderer windows use a sandboxed preload, context isolation, disabled Node integration, a narrow validated IPC bridge, and restricted navigation. The avatar asset protocol serves only bundled animation names and imported avatar IDs. Telegram tokens use the same vault as provider keys. Pairing IDs, plugin grants, update cursor and diagnostics live in the plaintext local database and backup, not memory exports. No MCP servers, arbitrary plugin code or desktop control execute.

## Development and verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run test:desktop
```

If Chromium is already installed elsewhere, set `EVA_TEST_BROWSER` to its executable for UI tests. The 12 UI tests cover plugin settings/pairing controls, Consciousness, images, speech delivery, browser preview, fixture MP3 audio and synthetic microphone input. The 93 core tests include extraction JSON normalization, bounded recovery, truncation, redacted diagnostics and cancellation, plugin grants, vault persistence, pairing, unpaired rejection, image/voice routing, shared memory, concurrency, remote reminders, bounded retries, cancellation and the actual worker protocol with fixture HTTP, plus the earlier scheduling/memory/voice/image regressions. No real Telegram or paid provider is contacted.

The desktop smoke test opens temporary Electron windows on your normal display and uses an isolated profile under the system temporary directory. It verifies real local HTTP calls through IPC, VRM/VRMA loading, model lists, semantic recall, sentence ordering, synthetic-microphone interruption, archive round-trips, and persistence across restarts without a keyring. It also verifies an authorized reminder across restart, typing deferral, cancellation, activity logs, immediate autonomy pause, and real plugin installation/settings, encrypted token/grant persistence and removal. It then closes its windows and removes its own test data. File/confirmation dialogs are stubbed. The test does not use your credentials or app profile. A real display (or an X virtual framebuffer) is recommended: Electron's Ozone headless backend crashed during validation here. Live Telegram connectivity and actual vision/ASR/TTS quality still need validation with your bot and providers.

See [PLAN.MD](PLAN.MD) for architecture, sprint checklists, limitations, and the validation record.

## Reference material

- [AIRI](https://github.com/moeru-ai/airi): inspiration for the companion experience and extensible capabilities.
- [OpenRouter API reference](https://openrouter.ai/docs/api_reference/overview): compatible chat request and streaming formats.
- [OpenRouter embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request) and [embedding model discovery](https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models).
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage): platform keyring behavior and Linux fallback detection.
- [MediaSource](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API) and [audio output routing](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId).
- [three-vrm animation documentation](https://pixiv.github.io/three-vrm/docs/modules/three-vrm-animation.html): loading and retargeting VRMA clips.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) and [window styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles): renderer isolation and desktop transparency.

The provided VRM and animation files remain untouched. Their ownership and redistribution terms are separate from the application code; review their embedded metadata before distributing a build containing them.
