# Video Puzzle

A tile-swap puzzle whose tiles are live regions of **one playing video**.

![tag:Gameplay](https://img.shields.io/badge/tag-Gameplay-green)

## What it shows

The mechanism, more than the game: **one decoded video stream feeding many
surfaces**. The scene's `Preview` entity carries `Sprite + Video` — the engine
decodes `assets/video/clip.mp4` into a live GPU texture and keeps that
sprite's `texture` handle current. Every puzzle piece simply **shares the same
texture handle** and picks its region with the Sprite's `uvOffset`/`uvScale`
(the same convention atlas frames use: `v = 0` is the image's bottom row).

No per-piece decoding, no extra API: the video system updates the one texture
in place each frame, so a handle written once keeps every piece live.

```
Preview (Sprite + Video)      Piece (slot r,c)
  texture ── decoded frame ──▶  texture   = preview.texture
                                uvOffset  = { x: c/N, y: 1 − (r+1)/N }
                                uvScale   = { x: 1/N, y: 1/N }
```

## How to play

Click a tile to select it (gold tint), click another to swap which video
region each shows. When every tile is back in its home slot the board turns
green — click anywhere to deal a new shuffle. The corner preview always shows
the complete video for reference.

## Why the Preview entity matters

Beyond UX, it is the architectural anchor: the `Video` component's `source`
ref makes the clip **reachable** to the asset cook (script-only string refs
are culled from builds), and its presence tells the WeChat exporter to ship
the `videodec` wasm decoder. Declarative data drives the pipeline; the script
only arranges who samples the result.

## Systems

| system | job |
|--------|-----|
| `SpawnBoardSystem` | one-time: spawn N×N pieces with a solvable shuffle |
| `ShareVideoTextureSystem` | mirror the preview's live texture handle onto every piece |
| `SwapTilesSystem` | click-to-select, click-to-swap, win detection, re-deal |

Works identically on web/desktop (`<video>` hardware decode) and WeChat
(engine-owned MPEG-1 wasm decoder) — the texture-handle contract is the same
on every backend.
