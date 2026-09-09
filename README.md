# evangelion_project

A desktop AI companion with a transparent animated VRM window, a separate settings app, voice conversation, and local persistent memory. Inspired by [AIRI](https://github.com/moeru-ai/airi); this is an independent implementation using your supplied `Eva.vrm` and `animations/*.vrma` assets.

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

1. Open **Providers**. Enable the language model provider, enter your OpenRouter API key, and choose a model ID. The default API base is `https://openrouter.ai/api/v1`, with `openrouter/auto` as the initial routing model. Save, then test the connection.
2. Configure ASR and TTS independently. Enter the base URL (including `/v1`, if required), model ID, optional API key, and TTS voice supported by your service. The initial localhost URLs are examples; no audio server is bundled or started. OpenRouter is the default for text generation, not an assumed audio backend.
3. Save settings and test each enabled service. Connection tests issue small real requests and may incur charges. The ASR test sends a one-second silent WAV; the voice chat itself sends Chromium's recorded WebM/Opus or MP4. Your ASR backend must accept that recording format.
4. Open the companion and type a message. To speak, click the microphone, talk, and click it again to send. Microphone access must be granted by the OS. Recordings end automatically at 60 seconds. The stop button cancels capture, pending provider requests, or audio playback.
5. Replies stream into the conversation. With automatic speech enabled, the finished reply is synthesized and played aloud; its audio amplitude drives the avatar's mouth. This version synthesizes complete replies, so speech starts after text generation finishes.

The three adapters use these OpenAI-compatible HTTP endpoints:

| Service | Request                                                                           | Expected response                                                  |
| ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| LLM     | `POST {base}/chat/completions`, JSON with model, messages, stream                 | SSE `choices[].delta.content`, or JSON `choices[].message.content` |
| ASR     | `POST {base}/audio/transcriptions`, multipart file/model/response_format/language | JSON `{ "text": "…" }`                                             |
| TTS     | `POST {base}/audio/speech`, JSON model/input/voice/speed/response_format          | MP3 audio bytes                                                    |

Provider errors show an actionable status without reflecting potentially sensitive upstream response bodies. Requests time out after 90 seconds. No automatic retry spends additional credits after a failure.

## Characters, avatars, and memory

**Character cards** supports multiple names, taglines, personalities, system prompts, and VRM references. Choose a card and save to activate it. Conversations and facts are scoped to the active character. Custom avatars are copied into app storage, so moving the original file will not break them.

**Avatar studio** controls position, zoom, rotation, key light color/intensity, blinking, always-on-top, and all nine supplied animations. Animations loop in this sprint. VRM 0.x and 1.x are loaded with `@pixiv/three-vrm`, and VRMA clips are retargeted to the loaded humanoid. Lip movement is audio amplitude based, not phoneme-level visemes.

**Memory** has three layers:

- A persistent current conversation, with a configurable recent-message window and a 24,000-character recent-context budget.
- Editable long-term facts, ranked by keyword overlap with the current message; recent facts are used when overlap is tied.
- Persistent older user messages, retrieved by keyword relevance across previous sessions. This is lexical retrieval, not embeddings or a semantic vector database.

Automatic remembering is off by default. Enabling it adds one LLM call after a completed turn to extract up to three explicitly stated user facts. These appear in Memory, where they can be corrected or deleted. A new conversation preserves facts and old messages. Deleting history removes that character's chat history after confirmation, while preserving facts.

Exports contain the saved active character's facts and all conversation sessions, without provider settings or API keys. Imports validate the archive and merge into the current character; exact duplicate facts and messages are skipped. Imported conversations are recalled as past sessions. Import/export uses native file dialogs.

## Storage and boundaries

Application data lives in Electron's `userData` directory, normally:

- Linux: `~/.config/evangelion_project/`
- macOS: `~/Library/Application Support/evangelion_project/`
- Windows: `%APPDATA%/evangelion_project/`

`companion.json` stores settings, messages, facts, and session IDs. Writes replace the file atomically, retaining the preceding version in `companion.json.bak`. A corrupt database stops startup rather than silently resetting your data. Close the app before manually restoring its backup. Both files contain plaintext conversation data; the backup may retain recently deleted entries until the next write. Imported avatars live in `avatars/`.

API keys live separately in `credentials.json`, encrypted through Electron `safeStorage` using OS facilities. If secure storage is unavailable (including Linux's `basic_text` backend), keys stay in process memory and must be entered again next launch. The renderer receives key-presence flags only. Keys are sent only to the configured provider. Audio is held in memory; microphone recordings are not written to disk by this app.

All provider requests execute in the main process. Renderer windows use a sandboxed preload, context isolation, disabled Node integration, a narrow validated IPC bridge, and restricted navigation. The avatar asset protocol serves only bundled animation names and imported avatar IDs. No plugins, MCP servers, desktop access, or autonomous timers execute in sprint 1.

## Development and verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run test:desktop
```

If Chromium is already installed elsewhere, set `EVA_TEST_BROWSER` to its executable for UI tests. UI tests generate screenshots in `test-results/`. They use the browser preview and do not make paid provider requests. The 13 core tests exercise the store, memory boundaries, automatic fact extraction, streaming, HTTP payload contracts, and runtime cancellation using mocked provider responses.

The desktop smoke test opens temporary Electron windows on your normal display and uses an isolated profile under the system temporary directory. It verifies real local HTTP calls through IPC, VRM/VRMA loading, archive round-trips, confirmation logic, and persistence across restarts, then closes its windows and removes its own test data. File/confirmation dialogs are stubbed for the test. It does not use your credentials or app profile. A real display (or an X virtual framebuffer) is recommended: Electron's Ozone headless backend crashed during validation here.

See [PLAN.MD](PLAN.MD) for architecture, sprint checklists, limitations, and the validation record.

## Reference material

- [AIRI](https://github.com/moeru-ai/airi): inspiration for the companion experience and extensible capabilities.
- [OpenRouter API reference](https://openrouter.ai/docs/api_reference/overview): compatible chat request and streaming formats.
- [three-vrm animation documentation](https://pixiv.github.io/three-vrm/docs/modules/three-vrm-animation.html): loading and retargeting VRMA clips.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) and [window styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles): renderer isolation and desktop transparency.

The provided VRM and animation files remain untouched. Their ownership and redistribution terms are separate from the application code; review their embedded metadata before distributing a build containing them.
