# Gameplay depth — v0.4.17

[← Minecraft](minecraft.md) · [Roadmap](../PLAN.MD) · [Live acceptance](minecraft-acceptance.md)

## World projects

Open **Settings → Plugins & MCP → Minecraft → World projects** while joined. Give a project a title, purpose and up to eight resource targets, one `item_id quantity` per line:

```text
oak_log 16
cobblestone 32
```

Cards show current carried stock, not reserved materials, completed buildings or chest contents. **Work on targets** queues one verified goal. Active projects inform independent activity selection when enabled; saving never enables autonomy or starts actions. Eva can also save projects requested in chat using `game_project`.

Pause excludes a project from future selection; Archive hides it by default. Neither cancels an already-running goal: use goal controls or Stop. Last outcomes/verification dates are historical. Editing targets clears the old verification date. Projects persist across conversations/restarts, scoped to character, endpoint, world label, bot account and dimension. There is a 100-record bound; projects are not part of personal fact-memory exports.

## Planning and completion

`plan_resources` analyzes a **total inventory stock** target, accounting for yields, shared ingredients and leftovers. It returns ordered crafting operations and missing acquisition leaves. Search is capped at six levels, 256 expansions and 12 recipes per item; alternatives are advisory, not necessarily optimal. Chest reservations, smelting, harvesting tools, travel and pickup are not modeled. The LLM still plans actions, checks outcomes and recomputes after changes.

Goals accept `{"kind":"sleep"}` and `{"kind":"defeat","entityUuid":"observed UUID"}` alongside existing criteria. Only a matching successful sleep/combat action establishes its event witness. Disappearance and sent attacks do not establish defeat. Witnesses persist when old step details are pruned. Projects and these criteria remain independent of companion Consciousness.

## New tools

| Tool | Behavior and limits |
| --- | --- |
| `fish` | Equips a rod, casts toward nearby water and automatically reels. Requires a free slot. Verifies gains; can approach a newly spawned nearby drop once and return to shore. Stops on uncertainty. Unrelated simultaneous pickups cannot be definitively excluded. |
| `enchant_item` | Inserts a selected unenchanted item, inspects offers or applies choice 0–2 with enough XP/lapis. Verifies returned enchanted metadata. Correctly remaps inventory/window slots. Java 26.1 enchantments may display as `id:N`; unavailable hints are not predicted. |
| `anvil_item` | Uses Minecraft's output/cost preview for rename, repair or combine, in the chosen left/right order. Inspection returns inputs; **re-read inventory slots before applying**. Verifies output metadata/quantity. No legacy local anvil calculation. |
| `trade_villager` | Inspects offers, then executes an index with expected input IDs/output ID, maximum unit prices and a bounded count. Checks each operation and verifies output quantity/metadata. Same-name upgrades work when metadata differs; identical input/output fingerprints cannot be gain-verified. Wandering traders remain unsupported. |
| `steer_vehicle` | Sends mounted left/forward input for up to five seconds, releasing it on completion/Stop. Reports displacement, not arrival; stationary input fails. Does **not** implement boat client physics, rail routing or vehicle-specific navigation. |

`attack_entity` adds expected UUID, `equipBest` (material-tier sword/axe selection, not an enchantment optimizer), `retreatHealth` (0 disables) and optional `retreatTo`. Withdrawal is not defeat. No guessed attacker or unrelated target is selected; default combat behavior is unchanged.

New mechanics use the existing single action owner, MCP choices, cancellation and pending-I/O fence. No second permission layer: bundled tools remain allowed unless explicitly blocked/Ask.

## Remaining scope

Automatic iron-door mechanism discovery, encrypted persistent Microsoft sessions, vehicle navigation and richer defense. Live anvil repair/combine, upgraded/two-input trades and sustained from-empty autonomous project work also need acceptance. One prepared arena run does not establish complete survival competence.
