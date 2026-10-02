# Storage and privacy

[← Documentation](README.md) · [Project home](../README.md)

Application data lives in Electron's `userData` directory, normally:

- Linux: `~/.config/evangelion_project/`
- macOS: `~/Library/Application Support/evangelion_project/`
- Windows: `%APPDATA%/evangelion_project/`

`companion.json` stores settings, messages, facts, and session IDs. Writes replace the file atomically, retaining the preceding version in `companion.json.bak`. A corrupt database stops startup rather than silently resetting your data. Close the app before manually restoring its backup. Both files contain plaintext conversation data; the backup may retain recently deleted entries until the next write. Imported avatars live in `avatars/`.

API keys persist separately in `credentials.json`. When an OS keyring is available, Electron `safeStorage` encrypts them. Without a usable keyring (including Linux's `basic_text` backend), the app uses AES-256-GCM with a random local key in `credentials.key`. Both files use owner-only permissions on Unix. The local key lives beside the ciphertext, so this fallback protects against casual exposure and other OS users, not software running as your user or someone who can read both files. Providers shows the selected storage method. The renderer receives key-presence flags only; memory exports never contain keys.

Sprint-1 databases receive new defaults on load without resetting existing settings or memories. Legacy OS-encrypted credentials are preserved even when their keyring is locked; affected requests ask you to unlock the keyring or re-enter that key. Keys that were previously session-only must be entered once again, then saved. Audio and microphone pre-roll stay in memory and are not written to disk by this app.

LLM/ASR/TTS/embedding requests execute in the main process; Telegram HTTP runs in its dedicated worker. Renderer windows use a sandboxed preload, context isolation, disabled Node integration, a narrow validated IPC bridge, and restricted navigation. The avatar asset protocol serves only bundled animation names and imported avatar IDs. Telegram tokens and MCP bearer tokens/environment secrets use the same vault as provider keys. Pairing IDs, plugin grants, MCP connection configuration/audits, update cursor and diagnostics live in the plaintext local database and backup, not memory exports. Do not put secrets in MCP executable arguments.

Explicitly trusted [MCP servers](mcp.md) can now execute tools. Local stdio servers run as unsandboxed programs with your OS account's access, not in the renderer sandbox; remote servers receive approved tool arguments. Tool grants constrain what the app dispatches, not what a local program can independently do. Tools start blocked; one-time approval and explicit standing grants are available. No marketplace, arbitrary in-process plugin loading or built-in desktop control is included.

The [bundled Minecraft adapter](minecraft.md) runs in an app-managed Electron utility process. It receives only game configuration and a minimal environment, not provider keys or a database handle. Observations and tool results may reach the configured LLM and appear in replies on the originating desktop/Telegram channel. Public game chat is separately disabled by default. Game configuration, the latest 100 jobs and up to 200 world landmarks live in the plaintext database/backup, outside memory exports. Microsoft authentication uses a process-memory-only cache; no Minecraft launcher credentials are read and no account tokens are persisted by the adapter. Reconnection may require signing in again.
