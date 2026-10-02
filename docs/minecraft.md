# Minecraft companion

[← Documentation](README.md) · [Project home](../README.md)

The app includes a managed Mineflayer adapter for **Minecraft Java 26.1**, initially targeting LAN worlds. v0.4.3 fixes follow navigation and makes everyday movement less restrictive. The packaged app supplies the runtime and dependencies: you only run Evangelion Project and Minecraft, not a separate bot or MCP server. This is a game-protocol client, not screen capture or keyboard automation.

## Join your world

1. Open your own Java world to LAN and note its current port. Only connect where you have permission.
2. Open **Settings → Plugins & MCP → Minecraft**. Set host (`127.0.0.1` for the same computer), port (initial default `25556`), bot name and authentication. For a normal offline-auth LAN world, use a distinct bot name such as `EvaCompanion`. Online-auth servers require a Microsoft account entitled to play Java Edition; enter the account identifier and follow the displayed device-code instructions at `microsoft.com/link`. Account tokens are session-only. Microsoft login has not yet been live-tested in this release.
3. Give the world a recognizable label and select the allowed dimension. This label is your organizational identifier, not a server-verified world identity. Use a different label when reusing the same LAN address for another world.
4. Movement is enabled in new configurations, with **no leash or timeout** (`0` for both). For an existing configuration, click **Use companion movement defaults** before saving to remove old limits. Enter a **Preferred player** if desired; otherwise the tool can name a player, or select the only other online player automatically. Public chat and block changes can remain off.
5. **Save Minecraft settings**, then **Join world**, and accept the native confirmation. Saving disconnects the adapter and resets its tool grants.
6. Once tools are discovered, click **Enable everyday controls**. This grants observation, movement, following, job status and stop without further approval popups; it does not grant public chat or block edits. Individual permissions remain in an expandable section. **Ask every time** is available when you want desktop confirmation. Your LLM must support tool calls.

Try “Look around in Minecraft,” then “Follow me in Minecraft.” Desktop voice/text and paired Telegram requests use the same character, memories and game-action owner. A Telegram request needing one-time approval still needs someone at the desktop. The app does not listen for instructions from Minecraft players or forward your private conversation to public game chat automatically.

## Jobs and controls

Available tools: `observe`, `move_to`, `follow_player`, `say_in_game`, `collect_blocks`, `build_blocks`, `job_status`, and `stop_action`. Observation includes position, health, food, nearby entities, sampled nearby blocks, inventory and configured limits; it is not a full world map.

Movement/collection/build calls return a job ID immediately. A single background job owns movement while ordinary chat and speech remain available. The settings panel shows progress and recent outcomes; a running job also exposes **Stop game action** in the companion. Starting a job is not proof of completion: movement checks arrival, collection checks block removal and inventory gain, and building checks placed blocks and the final structure.

- **Stop action / Stop game action:** cancel the game job without disconnecting or ending your conversation. Stopping a chat reply alone does not stop a job already accepted by the game adapter.
- **Leave world:** disconnect and disable startup for this connection.
- **Emergency stop tools:** cancel chat/tool requests, stop/disconnect adapters and persistently disable their startup. Reconnect explicitly to resume.

Jobs stop on a configured nonzero time limit, low health, a dimension change, an optional leash boundary, session change, system lock/suspend, settings lifecycle changes or disconnection. Changing a Minecraft tool grant stops its active job. App restart marks old running jobs interrupted; they are never replayed. An enabled connection can rejoin on app startup or after ordinary settings changes, but a failed connection requires explicit reconnect. Neither stop nor disconnect rolls back actions already performed. LAN world changes cannot be reliably identified from the endpoint alone.

Following keeps a persistent dynamic pathfinding goal instead of restarting its route every second. The job panel reports distance or waiting/path problems. If Minecraft temporarily stops sending the player's entity, Eva waits up to 30 seconds for tracking to return; if she makes no movement toward an unreached goal for 20 seconds, she reports a stuck route instead of pretending to keep progressing. Minecraft does not reveal far-away players' coordinates merely because their names appear in the player list; move nearer/in the same dimension or give a known waypoint first. No fixed follow duration applies when timeout is `0`.

## Block changes: explicit opt-in

Navigation uses normal sprinting, jumping, swimming and pathfinder's standard four-block drop allowance. It never digs, scaffolds or opens doors. It still avoids known hazards such as lava; this is not a guarantee against environmental damage, collisions or changes caused by other players.

Collection/building additionally require **Block changes**, an explicit build-area center/radius, a per-job block limit, movement permission and the corresponding MCP grant. Block changes remain off by default and are not enabled by the everyday-controls button. These controls are separate from unrestricted ordinary movement.

Collection supports a small whitelist (dirt, cobblestone, stone and selected logs), refuses unsupported targets, and requires a suitable harvesting tool when necessary. Building takes a bounded, explicit list of coordinates/materials; it only fills empty cells with supported blocks from inventory against simple non-interactive supports. It does not craft materials, replace occupied cells, access chests, fight mobs, execute slash commands or run arbitrary code. A failed multi-block job can leave a partial result; it is not retried automatically.

## Memory and architecture

Use **World landmarks** to save the bot's current location under a short name. Landmarks are separate from personal facts and scoped by character, world label, endpoint and dimension. Matching landmarks are supplied to ordinary chat while connected. If the LAN port changes, landmarks from the previous endpoint are not automatically recalled. The latest 100 jobs and up to 200 landmarks persist locally; neither is part of memory export/import.

The adapter is a bundled MCP server inside an Electron utility process. `minecraft-transport.ts` manages its lifetime, `minecraft-worker.ts` owns the connection, `minecraft-engine.ts` owns bounded jobs, and `minecraft-plugin.ts` coordinates state and persistence through the existing MCP permissions/audit layer. It receives no provider credentials. Personal conversation and semantic memory remain in the shared runtime, not in the bot process.

This increment supports user-requested jobs, not autonomous LLM gameplay. Proactive/scheduled game planning, resumable multi-step goals, crafting/combat, richer world memory and a disposable-server build acceptance test remain on the [plan](../PLAN.MD).

Validated on the user's Java 26.1 LAN world: joining, observation, inventory, following/movement, concurrent conversation, stopping and emergency disconnect. No blocks were changed and no public messages sent. Collection/building are covered by simulated-world tests, not a live building trial.
