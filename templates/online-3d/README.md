# Online 3D

A server-authoritative multiplayer 3D world, small enough to read in one sitting: every player steers a capsule across a lit ground, the server
decides where it is, and your own pawn answers the key the moment it goes down.

## Run it

Open the project in the editor, choose **2 Players (Listen Server)** (or 3 or 4) in the Play-mode menu and press **Play**. Player 1 is the authority in
the usual Game view, and each other player gets a `Game P#` tab. WASD or the arrow keys walk the pawn; the camera follows your own.

**Single Player** works too: the same systems run offline.

## Where things live

| File | What it holds |
| --- | --- |
| `src/shared/rules.ts` | The rules both ends run, with no engine in them: the speed, the world's edge, how keys become a direction. Anything a server must be able to refuse goes here. |
| `src/net.ts` | The pawn (one archetype both ends build it from), provisioning, the movement the server applies and the client predicts, the camera. |
| `src/main.ts` | Registers the systems on the fixed timestep. Nothing else. |
| `server/` | The dedicated server: the same project, headless, behind a real WebSocket. |

## Dedicated server

The Play-mode preview runs the authority inside player 1's own process. That is the right shape for developing and the wrong one for shipping.

```sh
cd server
npm install          # ws, and esbuild to bundle with
npm start            # ws://127.0.0.1:8080, 60 Hz
```

`run.mjs` bundles `server/main.ts` with `esengine` aliased at the SDK's headless build and runs it. The SDK and the engine wasm are taken as a pair
from what the editor staged in `.esengine/`, so open the project in the editor once, or pass `--sdk` and `--wasm`. `--port`, `--host` and `--fps`
do what they look like. Nothing under `src/` is server-specific: the one line this process says about itself is `online.hostPlays = false`.

## What a game of your own has to add

- **Who a player is.** Every connection here is anonymous, so a player who reconnects gets a new pawn. Pass `authenticate` to `startServer` (turning
  the client's `credentials` into a `playerId`) and `reconnect: true` to `Net.connect`, and a player who drops keeps their connection id, and so their
  pawn, for `reconnectGraceMs`. What the credentials are, and who checks them, is the game's.
- **What persists.** Nothing is saved. A world that outlives its players needs a store on the server, written from the authority's state.
- **Who may see what.** Every client sees every pawn. `esengine/replication` has interest management for a world too big for that.
