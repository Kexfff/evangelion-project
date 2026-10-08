# Minecraft acceptance

[← Minecraft guide](minecraft.md) · [Active plan](../PLAN.MD)

## Repeatable live checks

`npm run test:minecraft:live` is **opt-in** and never runs with `npm test`. It uses the production engine against a real Java 26.1 server, without opening the app, reading personal memory or using a provider by default.

Close Evangelion and other live runners first: they share the `EvaCompanion` identity. The server must be on loopback; `EVA_MC_PORT` defaults to `25556`.

Observation only—no setup commands or movement:

```sh
EVA_MINECRAFT_LIVE=yes npm run test:minecraft:live
```

For gameplay, use a **disposable world**, enable cheats, grant `EvaCompanion` operator access and designate a disposable **25×8×25** volume. This example uses floor origin `(-1040, 200, 310)`:

```sh
EVA_MINECRAFT_LIVE=yes EVA_MC_DISPOSABLE=yes \
EVA_MC_ARENA=-1040,200,310 npm run test:minecraft:live
```

The runner clears/rebuilds that volume, supplies materials and exercises door entry/exit, an enclosed versus accessible bench, recipe quantities, harvesting, crafting, bench placement/use, small/partial builds, storage, smelting, item drops, equipment, combat, sleep/wake, following, knockback and food. Assertions inspect positions, blocks, inventories and job outcomes. Temporary operator setup commands are test infrastructure, not new LLM tools or permissions.

The test **changes the world and Eva's inventory/spawn point**. It leaves the arena and crafted items for inspection. It temporarily changes difficulty/time and returns Eva to her starting position/mode on a healthy connection; an interrupted/disconnected run may need manual cleanup. `EvaTestTarget` is a temporary second player for follow/knockback testing. Do not use a valued save. The runner does not launch/download a Minecraft server or accept its EULA for you.

To repeat only follow/knockback/food in an existing arena, add `EVA_MC_SCENARIO=movement`. Set `EVA_MC_VERBOSE=yes` for path diagnostics. `EVA_MC_RETURN=x,y,z` can restore a known pre-test position after an interrupted run. Run live checks sequentially.

## Optional real-provider autonomy

This requires separate spending consent. After the arena exists, use:

```sh
EVA_MINECRAFT_LIVE=yes EVA_MC_DISPOSABLE=yes \
EVA_MC_ARENA=-1040,200,310 EVA_MC_SCENARIO=autonomy \
EVA_MC_PAID_REQUESTS=10 \
EVA_MC_PROVIDER_PROFILE=/absolute/path/to/evangelion_project \
npm run test:minecraft:live
```

The runner copies only LLM configuration and its encrypted local-vault entry/key into a temporary profile. Personal facts, conversations, Telegram credentials and external MCP connections are not copied. The source settings are checked for changes afterward; the temporary profile is removed. OS-keyring credentials need desktop-based acceptance instead.

Companion Consciousness is disabled. The real director/coordinator and MCP validation/policy layer choose and execute three separate inventory milestones through an in-process bridge to the live engine. This is **not** a test of Electron worker IPC; `scripts/smoke-minecraft.mjs` separately checks the managed worker in an isolated desktop profile. There is a hard cap of ten provider calls per invocation, no automatic retries, and a bounded test duration. Reported cost is not a billing guarantee. Repeating the command spends a new budget and needs renewed consent.

## Gameplay depth checks — v0.4.17, 2026-10-08

After the disposable arena exists, run the provider-free advanced-mechanics scenario with fresh live-world consent:

```sh
EVA_MINECRAFT_LIVE=yes EVA_MC_DISPOSABLE=yes \
EVA_MC_ARENA=-1040,200,310 EVA_MC_SCENARIO=depth \
npm run test:minecraft:live
```

This uses the existing arena's bedrock floor and adds an enchanting table, anvil, test villager, storage chest and small fishing pool within its volume. It supplies XP and items, recreates only its tagged test villager on repeated runs, and stores surplus test swords in the chest. These additions, XP and inventory changes remain; the client returns to its starting position/mode. It does not read a real app profile or make LLM requests.

The final v0.4.17 run passed: enchantment offer inspection and enchantment of a diamond sword with returned metadata verified; server-previewed anvil rename; current villager offers and two bread trades with six output items; storage of surplus equipment; automatic fishing/reeling followed by pickup and return to shore. Fishing gains included a water-bottle `potion` item; it is not a fish-only loot assertion. Prerequisite analysis correctly accounted for an existing wooden pickaxe and inventory toward a target of two.

Live failures exposed and fixed 26.1 structured item/enchantment components, player-to-window slot remapping, stale anvil input slots after preview, and catches landing short of the shore. Anvils now use the server's output preview rather than the library's legacy local calculation. Fishing verifies pickup and may approach a newly observed nearby drop once; a full inventory or uncertain pickup stops further casting. Ordinary tests cover cancellation, pending-operation fencing, price changes, missing output, UUID evidence and persisted project scope.

Validation: **373 core tests**, **40 browser tests**, plus a final three-test Minecraft/project UI rerun; typecheck and Linux unpacked packaging passed. Vehicle steering/low-health combat are fixture-tested, not live-certified. Anvil repair/combine, upgraded/two-input trades, wandering traders and sustained from-empty provider-driven survival remain open. This run did not use the previous paid-call allowance.

Desktop smoke passed when run alone, including synthetic voice/barge-in/PTT, provider fixtures, avatar, archives, plugins and MCP. An initial attempt alongside other desktop test instances timed out in synthetic barge-in; the isolated rerun passed without voice-code changes. Packaged profile-isolation passed with the normal profile's read-only hash guard unchanged. Packaged managed-worker smoke passed LAN join, observe, inventory, landmarks and emergency disconnect; no follow was requested. Eva was disconnected at the original position `(-1030.685, 54, 319.497)` after the checks. The new stations/pool, tagged villager, supplied XP/materials and chest of test swords remain in the authorized arena.

## Recorded v0.4.16 results — 2026-10-07

Validation passed: **353 core tests, 40 browser tests**, typecheck, Linux package build, isolated desktop smoke, packaged profile-isolation smoke and packaged live-worker smoke. Browser tests used the installed Chromium 1228 binary because Playwright's default 1243 binary was absent. Initial sandbox networking failures were rerun with loopback access.

On the authorized disposable LAN world, the live checks exposed and led to fixes for:

- Door waypoints snapped onto collision-shape tops after planning, plus diagonal corner stalls. Routes now preserve walk-through height and approach doors cardinally; either visible door half can be clicked.
- Station waypoints accepted at the edge of reach, although actual arrival was slightly short. Planning now leaves half a block of reach slack; the final visibility/reach check remains authoritative.
- Rapid crafting with optimistic inventory updates. Each crafting click is synchronized with the server and each operation's full recipe output is checked before continuing. Partial/uncertain effects are reported without replay.

Verified live: closed doorway both ways with the wall intact; enclosed table rejection and accessible-table fallback; full recipe quantities; stone harvesting/pickaxe crafting; crafting and placing a bench then using it; small build and retained partial build; storage round trip; completed smelting and output retrieval; drops/equipment; observed enemy death; sleep/wake; follow and moving-target reacquisition; damage plus approximately 0.54 blocks of knockback while following; Stop; eating with observed hunger recovery. These used a prepared arena and supplied materials, not a from-empty survival run. The food fixture temporarily uses Normal difficulty because Peaceful suppresses hunger loss.

Real OpenRouter autonomy completed a stone axe, shovel and hoe as three separate intentions with Consciousness off. **8 requests, 39,110 reported tokens, $0.005911 reported cost**; Stop prevented further selection. The normal application profile was unchanged. This bounded run does not establish unattended survival competence or concurrent real Telegram/voice acceptance.

Packaged-app live smoke verified managed-worker startup, tool observation, inventory/landmarks and emergency disconnect. No follow was requested in that particular smoke run; direct-engine movement checks are recorded separately. Remaining acceptance stays in [PLAN.MD](../PLAN.MD).
