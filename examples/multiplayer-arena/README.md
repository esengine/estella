# Multiplayer Arena

Server-authoritative multiplayer in ~100 lines: each player steers a colored
pawn inside an arena, replicated to every other player.

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
- The authority is the only simulator: `movePawnsSystem` integrates every pawn,
  reading the local keyboard for the host and `server.inputOf(connection)` for
  remote players (`Replicated.owner` routes input to its pawn).
- Clients run one system: sample the keyboard, `client.sendInput(...)` once per
  fixed tick. Everything they see — their own pawn included — is replicated,
  authoritative state.
- The same gameplay code ships unchanged against a real WebSocket server
  (`esengine/node` + `createHeadlessApp`).
