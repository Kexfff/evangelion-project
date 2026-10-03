# Minecraft companion

[← Documentation](README.md) · [Project home](../README.md)

The app includes a managed Mineflayer adapter for **Minecraft Java 26.1**, initially targeting LAN worlds. Since v0.4.6, supported game actions are **allowed unless explicitly blocked**. The packaged app supplies the runtime and dependencies: you only run Evangelion Project and Minecraft, not a separate bot or MCP server. This is a game-protocol client, not screen capture or keyboard automation.

## Join your world

1. Open your own Java world to LAN and note its current port. Only connect where you have permission.
2. Open **Settings → Plugins & MCP → Minecraft**. Set host (`127.0.0.1` for the same computer), port (initial default `25556`), bot name and authentication. For a normal offline-auth LAN world, use a distinct bot name such as `EvaCompanion`. Online-auth servers require a Microsoft account entitled to play Java Edition; enter the account identifier and follow the displayed device-code instructions at `microsoft.com/link`. Account tokens are session-only. Microsoft login has not yet been live-tested in this release.
3. Give the world a recognizable label and select its initial dimension. This label is your organizational identifier, not a server-verified world identity. Use a different label when reusing the same LAN address for another world.
4. Enter a **Preferred player** if desired; otherwise the tool can name a player, or select the only other online player automatically. Movement and building have no default area fence or timeout (`0`). Optional limits remain available.
5. **Save Minecraft configuration**, then **Join world**, and accept the native confirmation. Saving disconnects the adapter but preserves explicit Minecraft tool choices for the same character.
6. Play. Tools default to **Allow without asking**. Use **Individual tool permissions** to block an action or require confirmation; **Enable all game tools** clears those blocks. Your LLM must support tool calls. Other MCP servers still default to Blocked.

Try “Look around in Minecraft,” then “Follow me in Minecraft.” Desktop voice/text and paired Telegram requests use the same character, memories and game-action owner. A Telegram request needing one-time approval still needs someone at the desktop. The app does not listen for instructions from Minecraft players or forward your private conversation to public game chat automatically.

## One permission system

There is no separate `modifyBlocks`, movement or public-chat switch to contradict an allowed tool. The bundled adapter derives its runtime capabilities from the tool choices. Changes take effect immediately and stop any active action; reconnecting is not required for permission changes. Explicit Blocked/Ask choices survive bundled tool-description updates and connection saves.

Normal operation includes movement, requested public game chat, mining, building, digging/scaffolding during navigation, registered Minecraft materials, replacing the current action with a new request, and respawning without replaying the old action. Low health alone does not stop gameplay. These actions can damage constructions or lose inventory, as ordinary gameplay can.

Stop and disconnect remain available. Optional nonzero movement/build radii still apply. Setting any of `collect_blocks`, `build_blocks`, `dig_block` or `interact_block` to Blocked/Ask disables automatic terrain-changing navigation, so following cannot bypass that choice. Direct gameplay follows each tool's permission. Public chat still requires an explicit user request; private conversations are not automatically forwarded. New bundled gameplay tools also default to Allow; existing explicit choices are preserved.

On first startup after upgrading to v0.4.6, the app retires legacy switches, clears the old movement/build fences and timer, and sets the collection cap to 1,024. Explicit tool blocks are preserved. The migration runs once; optional limits you set afterward remain saved.

This is freedom for **implemented game actions**, not an autonomous game planner or arbitrary JavaScript/operator commands. Build plans remain batched (up to 128 placements per call and the configured block count, also subject to MCP's argument-size limit); larger structures require multiple jobs. Existing blocks are not overwritten by placement. Collection verifies removal plus inventory gain; in Free play the gain may be a different drop item from the block name. Stateful/oriented or multi-cell blocks may fail final placement verification.

## Player coordinates beyond tracking range

Minecraft sends nearby entity positions, not a continuously updated position for every name in the player list. The cutoff is server-controlled, not a fixed 100-block application limit. Observation now shows every tracked player's coordinates separately from the short nearby-entity list, and remembers last-seen positions for this connection with timestamps and an explicit stale label.

For fresh distant coordinates, enable **Operator coordinate lookup** and save/rejoin. Enable LAN cheats and grant the bot account operator permission using your world's owner controls (for example `/op EvaCompanion` where supported). The application cannot grant this permission itself. Minecraft requires sufficient server permission for commands; see [Minecraft's command guide](https://www.minecraft.net/en-us/article/minecraft-commands).

Ask “Where is Lexxass?” or “Follow Lexxass.” The `locate_player` tool uses tracked coordinates when available, otherwise two fixed read-only commands: `/data get entity <player> Pos` and `/data get entity <player> Dimension`. It accepts only literal player names and matching structured vanilla system responses, including Java 26.1's styled NBT text; ordinary player chat cannot supply a lookup result. Lookups have short timeouts and a five-second cache. This setting does not permit arbitrary slash commands and works independently of public-chat permission.

Following approaches server-reported coordinates outside tracking range, then switches to normal dynamic entity following when the player comes into range. If only an old position is known, the job says it is approaching **last-seen** coordinates; it never claims they are fresh. Without operator access or a known waypoint, genuinely unknown distant coordinates cannot be recovered by increasing the bot's view distance. An obstructed route or a player in another dimension still needs a reachable route/portal; coordinate lookup is not teleportation.

## Jobs and controls

There are 26 tools in v0.4.7. Original tools: `observe`, `locate_player`, `move_to`, `follow_player`, `say_in_game`, `collect_blocks`, `build_blocks`, `job_status`, and `stop_action`. Observation includes position, health, food, time of day, game mode, sleeping/riding state, player locations, nearby entity IDs/types, sampled blocks, inventory and configured limits; it is not a full world map. The additional gameplay tools are described below.

Gameplay actions return a job ID immediately. A single background action owns movement, equipment and inventory windows while ordinary chat and speech remain available. A replacement waits for the previous action's cleanup and pending protocol operations before proceeding. Read-only observation/inventory/recipe searches do not replace an action. The settings panel shows progress and recent outcomes, with expandable structured **Action result** details also available through `job_status.result`; a running action exposes **Stop game action** in the companion. Starting an action is not proof of completion: movement checks arrival, collection checks block removal and inventory gain, and building checks placed blocks and the final structure.

- **Stop action / Stop game action:** cancel the game job without disconnecting or ending your conversation. Stopping a chat reply alone does not stop a job already accepted by the game adapter.
- **Leave world:** disconnect and disable startup for this connection.
- **Emergency stop tools:** cancel chat/tool requests, stop/disconnect adapters and persistently disable their startup. Reconnect explicitly to resume.

Jobs stop on a configured nonzero time limit, an optional leash boundary, session change, system lock/suspend, settings lifecycle changes or disconnection. Other dimensions are allowed and respawn creates a fresh engine without replaying a job. Changing a Minecraft tool permission stops its active job. App restart marks old running jobs interrupted; they are never replayed. An enabled connection can rejoin on app startup or after ordinary settings changes, but a failed connection requires explicit reconnect. Neither stop nor disconnect rolls back actions already performed. LAN world changes cannot be reliably identified from the endpoint alone.

Following keeps a persistent dynamic pathfinding goal instead of restarting its route every second. The job panel reports distance or waiting/path problems. Missing entities use operator/last-seen coordinates when available, otherwise Eva waits up to 30 seconds for tracking; if she makes no movement toward an unreached goal for 20 seconds, she reports a stuck route instead of pretending to keep progressing. No fixed follow duration applies when timeout is `0`.

The companion overlay also shows that detail (for example, “With Lexxass; following when they move”), not just a green “in progress” banner. Standing within the follow distance is normal. v0.4.5 corrects Mineflayer 4.39's legacy velocity scaling for 26.1 knockback packets. If physics ticks stop for eight seconds, coordinates become invalid, or the worker stops sending updates for ten seconds, the app stops/disconnects the affected job and reports a reconnect reason instead of retaining stale running state. This does not add movement or block-permission restrictions, and it does not repair every possible pathfinding/terrain incompatibility.

## Gameplay mechanics

Everyday gameplay tools added in v0.4.7:

| Activity                | Tools and behavior                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory and equipment | `inspect_inventory` lists slots/equipment; `drop_items` drops an exact quantity, optionally from a specific slot; `equip_item` equips hand/off-hand/armor or unequips with `item: null`.                                                                                                                                              |
| Food and rest           | `eat_food` consumes one specified food/drink or selects available food; `sleep` approaches a specified or nearby bed; `wake` gets up. Normal Minecraft sleep rules apply.                                                                                                                                                             |
| Combat                  | `attack_entity` targets an observed entity ID with the held weapon: one hit or a fight lasting up to 120 seconds. Equip a weapon first. A death event confirms defeat; a missing target does not. No automatic retaliation or target switching.                                                                                       |
| Interactions            | `interact_entity` right-clicks, mounts or dismounts; `interact_block` uses doors/buttons/levers or the held item on a block; `use_item` holds/releases main-hand use (bow, shield, throwable); `look_at` changes gaze. Input being sent does not prove an effect or projectile hit.                                                   |
| Materials and crafting  | `find_blocks` searches loaded chunks; `dig_block` breaks one exact block with the held tool; `get_recipes` reports ingredients/output/table requirements; `craft_item` performs a specified number of crafting operations using current ingredients and a nearby/specified table when needed. One operation can yield multiple items. |
| Storage and smelting    | `container` inspects/deposits/withdraws from supported storage; `furnace` inspects slots/progress, inserts input/fuel or takes a slot's contents from furnaces, smokers and blast furnaces. Inserting fuel/input is not smelting completion—inspect again later. Windows close after use.                                             |

Examples: “Drop four cobblestone for me,” “Equip your iron sword and fight that zombie,” “Eat something, then sleep in the nearest bed,” “Put eight coal in this furnace,” or “Check that chest.” Give coordinates or use observation/block search to disambiguate targets. These are LLM-driven tools, not hard-coded phrase commands; the model must sequence actions and check outcomes. Equipment does not auto-upgrade and crafting does not recursively gather missing ingredients.

Stopping releases held-item use, pathfinding and combat. Operations already sent to the server may finish or have partial effects; nothing is rolled back or automatically retried. An unsettled inventory operation prevents a new action from racing it. Sleeping and riding are recognized by the physics monitor, rather than mistaken for frozen walking physics.

Navigation uses sprinting, jumping, swimming, digging and inventory scaffolding when permitted by the tool choices. It avoids known hazards such as lava; this is not a guarantee against environmental damage, collisions or changes caused by other players.

Collection and building use registered materials, available inventory and suitable harvesting tools. An optional build radius applies only when nonzero. Build requests are batched rather than unbounded.

Building fills empty cells using inventory and solid supports, sneaking while placing. Occupied cells must first be cleared; a failed multi-block action can leave a partial result. This is not automatically retried. The LLM is instructed to keep job IDs, routine progress and status checks out of conversation, acknowledge naturally, and mention meaningful results or blockers only when relevant. Status remains visible in the UI.

## Memory and architecture

Use **World landmarks** to save the bot's current location under a short name. Landmarks are separate from personal facts and scoped by character, world label, endpoint and dimension. Matching landmarks are supplied to ordinary chat while connected. If the LAN port changes, landmarks from the previous endpoint are not automatically recalled. The latest 100 jobs and up to 200 landmarks persist locally; neither is part of memory export/import.

The adapter is a bundled MCP server inside an Electron utility process. `minecraft-transport.ts` manages its lifetime, `minecraft-worker.ts` owns the connection, `minecraft-engine.ts` owns background actions, `minecraft-actions.ts` implements gameplay operations, and `minecraft-plugin.ts` coordinates state and persistence through the existing MCP permissions/audit layer. It receives no provider credentials. Personal conversation and semantic memory remain in the shared runtime, not in the bot process.

This increment supports user-requested actions, not autonomous LLM gameplay. Proactive/scheduled game planning, resumable multi-step goals, fishing automation, enchanting, selecting/completing villager trades, vehicle steering, richer world memory and a disposable-server gameplay acceptance test remain on the [plan](../PLAN.MD). Entity interaction can open a trading interaction, but does not select or complete a trade.

The v0.4.7 gameplay additions are covered by simulated-game tests, not live-world acceptance. No world-changing actions were performed in the user's LAN world while developing these tools.

Validated on the user's Java 26.1 LAN world: joining, observation, inventory, following/movement, concurrent conversation, stopping and emergency disconnect. No blocks were changed and no public messages sent. Collection/building are covered by simulated-world tests, not a live building trial.

v0.4.4 packaged acceptance also retrieved operator coordinates with the player about **302 blocks away**, walked to that position and reacquired the player within four blocks. Free play block changes and respawning were not live-tested; those capabilities should first be tried in a disposable world.
