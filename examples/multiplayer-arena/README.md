# Multiplayer Arena

Server-authoritative multiplayer **with client prediction** in ~130 lines: each
player steers a colored pawn inside an arena, replicated to every other player
— and your own pawn responds the moment a key goes down, no round trip.

## Run it

Open the project in the editor, then pick **2 Players (Listen Server)** (or 3/4)
from the Play-mode dropdown and press **Play**. Player 1 runs in the usual Game
view as the authority; each extra player gets its own `Game P#` tab. Click a
tab to give that player keyboard focus — WASD / arrows to move.

Plain **Single Player** Play works too: the same systems run offline.

## What it shows

- `Replicated` marks an entity for replication — the spawn carries every
  component (the sprite color included), and Transform's built-in `replicated`
  annotation streams the pose as binary deltas with snapshot interpolation.
- **One movement rule, both ends**: `applyMove` is the single function the
  authority runs per pawn AND the client's prediction function — the bounds
  clamp included, so even the arena walls are predicted.
- The authority consumes each connection's input queue with
  `server.tickInputOf(connection)` — exactly one command per fixed tick, the
  contract prediction replays against (`Replicated.owner` routes input to its
  pawn).
- Clients run one system: sample the keyboard, enable prediction lazily (the
  editor preview makes the connection itself, so `client.enablePrediction`
  happens in-game), and `client.sendInput(...)` once per fixed tick — idle
  moves included. Remote pawns stay smooth via snapshot interpolation; your
  own pawn bypasses it and moves instantly, reconciled against the
  authoritative state every tick.
- The same gameplay code ships unchanged against a real WebSocket server
  (`esengine/node` + `createHeadlessApp`).

## Dedicated server

The Play-mode preview runs the authority inside player 1's own process. That is
the right shape for developing and the wrong one for shipping — it needs
somebody's game to be running, and a connection there never drops.

`server/` is the shipping shape: the same project, headless, behind a real
WebSocket.

```sh
cd server
npm install          # ws, and esbuild to bundle with
npm start            # → [arena] listening on ws://127.0.0.1:8080 (60 Hz)
```

`run.mjs` bundles `server/main.ts` with `esengine` aliased at the SDK's headless
build (`index.node.js`), then runs it. The SDK and the engine wasm are taken as
a pair from what the editor staged in `.esengine/` — open the project in the
editor once, or pass `--sdk` / `--wasm` yourself. `--port`, `--host` and `--fps`
do what they look like.

**Nothing under `src/` is server-specific.** The server imports the project's
own `src/main.ts`, so the authority runs the very systems the browser runs, and
`flushPendingRegistrations` installs them through the same door the shipped web
runtime uses. The one thing this process says about itself is:

```ts
arena.hostPlays = false;   // nobody is at a keyboard here
```

A listen server hosts player 0 itself; a dedicated server owns no pawn. That
single flag is the whole difference, and `ProvisionPawnsSystem` reads it.

### What only a real server exercises

Two things the preview structurally cannot show, both handled here:

- **A connection that leaves.** The preview's players are MessagePorts that live
  as long as the session. A real socket closes, `detachConnection` drops the id,
  and `ProvisionPawnsSystem` retires that pawn on its next fixed tick — without
  it a long-running server fills with pawns nobody is steering.
- **An authority with no local player.** Everything in `src/` gates on
  `arena.hostPlays` or on `Net.role`, so the same file serves all three
  deployments: offline, listen server, dedicated.

`node tools/check-arena-server.mjs` in the engine repo asserts exactly that —
two real clients over a socket, input that moves and clamps, movement witnessed
by a third party, and a leaver whose pawn goes with them.

### What it does not do yet

A player who reconnects arrives as a **new connection id**, so they get a new
pawn rather than their old one back. Ownership is keyed on the connection
(`Replicated.owner`), and the SDK has no notion of a player identity that
outlives a socket — a stable id, a session token, and a reconnect window all
belong to the game for now. Worth knowing before you build a match around it.
