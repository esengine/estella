# Save & Load

A tiny collect-the-coins game whose whole point is persistence: `SaveManager`
gives you named save slots with **schema versioning + migration on load**, and
raw `Storage` handles the lightweight key/value cases (preferences) that don't
deserve an envelope.

## Controls

| Input               | Action                                          |
| ------------------- | ----------------------------------------------- |
| Arrows / WASD       | Move the player square                          |
| **Save**            | Write score + position + collected coins (v2)   |
| **Load**            | Read the slot back, migrating old saves forward |
| **Clear**           | Delete the slot                                 |
| **Save as v1**      | Write the slot as an *old build* would have     |
| **Toggle**          | Flip the player color — a raw `Storage` pref    |

Collect some coins, **Save**, collect more (or reload the page), then **Load**:
score, player position and the collected-coin set all snap back. Coins are a
pure projection of the collected set (`coins.ts`), so load/clear never need a
special respawn path — the sync system reconciles the world from state.

## SaveManager, option by option

```ts
export const saves = new SaveManager({
    version: SAVE_VERSION,   // current schema version stamped into every save
    migrations,              // { 1: v1→v2, 2: v2→v3, … } chain, keyed by source version
    keyPrefix: 'save-load:', // slot "demo" → storage key "save-load:demo"
});
```

- **`version`** (required) — the schema version of what `save()` writes *today*.
  Every save is stored as an envelope `{ version, data, savedAt }`, so a load
  always knows which shape it is looking at.
- **`migrations`** — a record where `migrations[n]` upgrades data from version
  `n` to `n + 1`. On `load()`, an older save is run forward step by step
  (`migrateSaveData`) until it reaches `version`. A missing step, or a save
  *newer* than the current build, throws instead of silently corrupting.
- **`storage`** — the backend, defaulting to the engine's `Storage` (which maps
  to `localStorage` on web, the platform store elsewhere). Inject a stub in
  tests.
- **`now`** — clock for the `savedAt` stamp, defaulting to `Date.now`. Inject
  for deterministic tests.
- **`keyPrefix`** — namespace for slot keys (default `save:`). This example uses
  `save-load:` so its slots can't collide with another project's.

The instance methods used here: `save(slot, data)`, `load<T>(slot)` (returns
`null` for an empty/unreadable slot), `remove(slot)`, `savedAt(slot)`; `has()`
also exists.

## The migration story

Shipped games evolve their save shape. Without versioning, the first update
that renames a field bricks every existing save. So:

- **v1** of this game stored `{ points, playerX, playerY }` — flat fields, and
  it didn't track which coins were collected at all.
- **v2** (current) stores `{ score, player: { x, y }, collected: number[] }`.

`save.ts` registers one migration:

```ts
const migrations: Record<number, SaveMigration> = {
    1: (raw) => {
        const d = raw as SaveDataV1;
        return { score: d.points, player: { x: d.playerX, y: d.playerY }, collected: [] };
    },
};
```

Nothing calls this directly. `load()` reads the envelope, sees `version: 1 <
SAVE_VERSION`, and applies `migrations[1]` (then `[2]`, `[3]`, … if the gap
were wider) before handing the data back — the game only ever sees the current
shape. Note the v1 migration has to *invent* a value for `collected` (empty):
choosing sensible defaults for data old saves never had is the essence of
writing a migration.

**Try it live:** press **Save as v1** (it writes a genuine v1 envelope straight
through `Storage`, exactly as an old build would have), then **Load** — the
status line reports `Loaded v1 save — migrated to v2`.

## Raw Storage for preferences

The player-color toggle skips SaveManager entirely:

```ts
Storage.getBoolean('save-load:pref:alt-color', false);
Storage.setBoolean('save-load:pref:alt-color', value);
```

`Storage` is typed key/value (`getString`/`getNumber`/`getBoolean`/`getJSON` +
setters, `has`, `remove`) — right for a single preference read at startup,
where an envelope and migrations would be ceremony. Rule of thumb: gameplay
state that will outlive schema changes → `SaveManager`; independent scalar
settings → `Storage`.

## Files

```
assets/
  scenes/main.esscene    # camera, player square, HUD panel (labels + empty button rows)
src/
  main.ts                # registers the systems
  components.ts          # Player, Coin
  state.ts               # module game state + coin spots
  save.ts                # schema (v1/v2), migration, SaveManager, color pref
  systems/
    move.ts              # arrow-key movement, clamped to the play area
    coins.ts             # coins as a projection of state; pickup; pulse
    build.ts             # buttons → SaveManager calls; applies the color pref
    hud.ts               # score/status labels track game state
```
