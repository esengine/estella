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
