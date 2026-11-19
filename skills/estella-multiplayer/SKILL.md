---
name: estella-multiplayer
description: How to make an Estella game online - a server that owns the world, clients that predict their own player, who a player is, who sees what, what is saved, many servers for one world - and what to turn on when a crowd is too much. Read it before writing any networked game, server or MMO feature.
---

# Multiplayer

Start from the `online-3d` template (`list_project_templates`): a server-authoritative world where each player steers a
pawn, the server decides where it is, and your own pawn answers the key at once. Its README says where everything lives.
Build on it rather than wiring replication from nothing.

Everything networked is imported from `esengine/replication` (and `esengine/persist`, `esengine/zones`,
`esengine/metrics`), never from `esengine`: the root entry does not export it, and a wrong import fails at build time.

## The shape: one set of rules, two ends

- A component is replicated by naming its fields: `defineComponent('Hp', { hp: 100 }, { replicatedFields: ['hp'] })`.
  An entity is sent to clients when it has `Replicated` (`{ owner: connectionId }` makes it that player's).
- Movement and anything a server must be able to refuse lives in one function both ends run: the server applies each
  connection's input with it, the client predicts with it (`net.client.enablePrediction({ apply, smoothing })`). Keep
  it free of the keyboard and the clock; it gets the actions and `dt`.
- How a replicated entity is built on a client (mesh, material) is `registerReplicationArchetype(key, build)`, so the
  server sends a key and not a scene.
- The server: `app.getResource(Net).startServer(options)`, then `server.attachConnection(transport)` for each socket
  and `server.detachConnection(id)` when it closes. The template's `server/main.ts` does this over `ws`. A browser client
  connects with `Net.connect(new GameSocket({ url }), options)`.
- Game messages that are not state (a chat line, "open the shop") are `server.message(id, type, data)` /
  `server.onMessage(type, handler)` and `client.message` / `client.onMessage`.

## Who a player is

Anonymous by default: a player who reconnects is a stranger. Pass `authenticate: (credentials) => ({ playerId })` to
`startServer` (throw to refuse) and `credentials` plus `reconnect: true` to `connect`; a player who drops keeps their
connection id, and their pawn, for `reconnectGraceMs`. Spawn and retire pawns from `server.presentIds`, not from the
live sockets, or a reconnect finds its pawn gone. What the credentials are and who checks them is the game's.

## When a crowd is too much

Measure first (`server.stats`, or `esengine/metrics` for a `/metrics` page), then turn on what the numbers ask for,
cheapest first:

1. Interest: `server.setInterestProvider(radiusInterestProvider(radius))` sends each player only what is near.
2. `server.setInterestRefresh(4)` recomputes each view every 4th sample: much cheaper when everyone moves, and
   something walking into range arrives up to 3 samples late.
3. `server.setBandwidthBudget({ bytesPerSecond })` caps each player's stream and sends the most important first.
4. `quantizeReplicatedFields('Transform', { position: 1, rotation: 0.01 })` sends numbers as whole steps (here 1 cm at
   100 units a metre). Call it at startup on the server AND the client, before any connection: the handshake refuses
   a client whose steps differ, and a change after the first connection does nothing.
5. `startSocketWorker({ port })` (Node) moves the sockets off the simulation's thread.

## What is saved, and many servers

- `esengine/persist`: `PlayerPersistence` loads a player's record when they arrive and saves it as they play;
  `WorldPersistence` saves entities marked `Persistent`. Stores: `MemoryStore`, `FileStore`, or `StoreHub` +
  `RemoteStore` to share one between processes. Server-only: never import it in client code.
- `esengine/zones` splits a world too big for one process: `ZoneHost` moves players between zones and routes a login to
  the right one, `ZoneDirectory` knows which are up, and `zone.drain()` takes one down without kicking anybody.
- These are framework pieces with defaults and hooks. Guilds, trading, matchmaking and what a record holds are the
  game's, written on top of them.

## Prove it

Single Player runs the same systems offline: prove the rules there first with `step` and `play_probe`. A multiplayer
preview (Play menu, "2 Players (Listen Server)") is chosen by the person in the editor; once it runs, `find_entities`,
`inspect_entity` and `play_probe` take `frame` to pick the realm (0 is the host, 1 the first client). Check that a
client's ghost of another player moves, and that its own pawn is where the server says, not only that the host is
right. A client that cannot join is refused by `connect`, whose error names the mismatch (the component, the field and
both shapes, a quantization step among them): log it in the game and read it with `get_logs`.
