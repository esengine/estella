# REARCH — Editor Automation & Observation Surface (toward an editor MCP)

## Why

Two needs converge on the same architecture:

1. **Verification is blocked at the pixel surface.** Logic and state can be verified
   headlessly today (the Spine 3.8 module load + animate test runs the real
   `spine38.wasm` in node and asserts a bone advances). But "does it actually
   rasterize on screen" cannot be observed without a human looking at the editor —
   the headless test path has no GL context, and an external agent cannot reach the
   live Electron renderer. Every render-correctness change ends in a manual smoke
   test.
2. **A future editor MCP** wants exactly the same thing: a clean, typed surface an
   agent can call to open a project, mutate a scene, drive a frame, and read back
   what happened — including the rendered pixels.

The answer to both is one canonical, transport-agnostic **EditorControlSurface**
(command + query + observation), plus the two primitives that make render
verification meaningful and reachable: a deterministic engine **step**, and a
**headless render host** that owns a real WebGL2 context. The MCP server is then a
thin transport adapter over that surface — not a parallel API.

## Diagnosis — the programmatic surface that exists today

| Layer | Where | What it gives | Gap |
|---|---|---|---|
| Mutations | `desktop/src/engine/SceneCommands.ts` | `addEntity` / `deleteEntity` / `duplicateEntity` / `renameEntity` / `setField` / `setEntityXY` / `beginGesture` / `endGesture`; dual-writes World + `SceneModel`; every edit undoable via `EditorHistory` | No `setComponent` (add/remove a whole component), no asset-ref set helper |
| Reads | `desktop/src/engine/SceneQuery.ts` | `worldVersion` / `readSceneTree` / `readEntity` / `readInspector` / `getFieldValue` | — |
| Truth | `desktop/src/engine/SceneModel.ts` | JSON-first `SceneData` (lossless: unknown components, `@uuid:` refs, `visible:false` entities); `serialize()` | — |
| Engine bridge | `desktop/src/engine/EngineHost.ts` (renderer) | owns `module`, **WebGL2 `canvas`**, live `World`; `setRunMode(isPlaying,isPaused)`; `getResource` | Loop is Emscripten rAF (`app.run()`) — **no deterministic `step(dt)`**; capture is whatever frame rAF landed on |
| Picking / transforms | `desktop/src/engine/ViewportController.ts` | `pickEntity` / `getEntityScreenRect` / `getEntityXY` / `canvasToWorld` | — |
| Telemetry | `desktop/src/engine/StatsStore.ts` | `{ fps, entities, cursor }` (sampled, not per-frame) | No draw-call / batch stats; no per-entity render state |
| Asset load | `desktop/src/engine/SceneLoader.ts` | `loadInto(app, sceneUrl, manifestUrl)` — resolves `@uuid:` → texture handles, spawns | — |
| Transport | `desktop/electron/{main,preload}.ts` | pure `ipcMain.handle` + `estella://` protocol | **No local server**; nothing an external process can attach to |
| Headless test | `desktop/tests/**`, `tests/helpers/loadWasm.ts` | constructs `App` + `Registry` in **pure node, no canvas** | **No GL → cannot rasterize → cannot pixel-verify** |

The command/query core is already correct and already unit-tested. What's missing is
(a) a single composed entry point over it, (b) the two render primitives, and
(c) a transport an agent can reach.

## Target architecture

```
 Consumers
 ─────────
   React UI (existing)      vitest (logic/state)        Agent / editor MCP client
        │                          │                            │
        │ direct calls             │ direct calls         ┌─────▼──────────────┐
        │ (renderer)               │ (in-proc)            │  Editor MCP server │  P2
        │                          │                      │  main process      │
        │                          │                      │  Streamable HTTP   │  (attach to live editor)
        │                          │                      │  + stdio           │  (spawn headless host)
        │                          │                      └─────┬──────────────┘
        │                          │                            │ editor:rpc IPC
        ▼                          ▼                            ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  EditorControlSurface   — the ONE canonical programmatic API (renderer)   │  P1
 │                                                                            │
 │   Lifecycle    openProject · loadScene · saveScene · setRunMode · step     │
 │   Commands     addEntity · deleteEntity · setComponent · setField · …      │  (over SceneCommands)
 │   Queries      getSceneTree · getEntity · getInspector · getProjectInfo    │  (over SceneQuery / SceneModel)
 │   Observe      captureViewport · getEntityRenderState · getStats · pickAt  │  (over canvas/GL + ViewportController)
 └──────────────────────────────────────────────────────────────────────────┘
        │                 │                    │
        ▼                 ▼                    ▼
   SceneCommands     SceneQuery/Model     EngineHost (canvas, WebGL2, World, step)
```

### The EditorControlSurface (P1) — one API, four pillars

A new renderer-side module `desktop/src/engine/EditorControlSurface.ts` that **composes
the existing modules** — it adds no new truth, it is the single front door.

- **Lifecycle** — `openProject(root)`, `loadScene(rel)`, `saveScene()`,
  `setRunMode({playing,paused})`, and the new **`step(frames, dt)`** (see below).
- **Commands** — pass-throughs to `SceneCommands` plus two small additions the agent
  needs that the UI does today by other means: `setComponent(entity, type, data)` /
  `removeComponent(entity, type)` (add/remove a whole component), and
  `setAssetRef(entity, type, key, uuid)` (set a `@uuid:` ref via `SceneModel`, the way
  the inspector's asset picker does). Everything stays undoable.
- **Queries** — pass-throughs to `SceneQuery` + `SceneModel.serialize()` +
  `getProjectInfo()` (root, scene list, build/schema-cache status).
- **Observe** — the verification-closing pillar:
  - `captureViewport({region?, maxWidth?}) → { png: Uint8Array, w, h }` — read the
    WebGL2 framebuffer (`gl.readPixels` into a canvas → PNG, or `canvas.toDataURL`).
    The agent literally sees the frame.
  - `getEntityRenderState(id) → { worldTransform, screenRect, visible, inFrustum }` —
    `ViewportController.getEntityScreenRect` + world transform. Cheap, deterministic,
    diff-friendly — often enough to verify without a screenshot.
  - `getStats() → { fps, entities, drawCalls?, batches? }` — `StatsStore` plus
    draw-call/batch counters surfaced from the renderer (small engine add).
  - `pickAt(x, y) → EntityId | null` — `ViewportController.pickEntity`.

The surface is **transport-agnostic**: the same object is called directly by the
React UI, in-process by a test, and (via IPC marshalling) by the MCP server. It is
directly unit-testable in the existing vitest harness.

### Determinism primitive — engine `step(dt)` (already exists)

Render verification is only meaningful if it is reproducible. Today the editor drives
`app.run()` (Emscripten rAF) — a capture reflects whatever frame rAF happened to be on.

**The primitive already exists: `App.tick(delta)` (`sdk/src/app.ts:465`).** `tick` does
the same lazy init `run()` does (SystemRunner, `Time` resource, `finishPlugins_`), then
`flushStartupSystems_()` + `runFrame_(delta)` — exactly one frame, with the supplied
delta, no wall-clock, **no rAF, no `'unwind'`**. `run()` is just that same setup plus a
self-driving `mainLoop` that computes wall-clock delta and `requestAnimationFrame`s
`runFrame_`. So the surface's `step(frames, dt)` is `for … await app.tick(dt)` — and the
headless host simply calls `tick()` N times **instead of** `run()`. **No engine/SDK
change.** Canonical recipe: `loadScene → setRunMode(play) → step(30, 1/60) →
captureViewport → assert`.

The same wall-clock-free drive serves the isolated play realm (REARCH_EDITOR_REALM
R0–R2). Most of the surface (commands, queries, lifecycle, `step` via `tick`) is also
testable in the existing **pure-node vitest** (which already constructs `App` + mocks
`EngineHost`); only `captureViewport` needs the WebGL2 window.

### Render host — where pixels actually rasterize

`captureViewport` needs a real **WebGL2** context. Two hosts provide the surface; pick
per task:

| Host | GL | Use | Notes |
|---|---|---|---|
| **Live editor** (renderer) | real WebGL2 | interactive / MCP-over-HTTP | the running GUI a human also uses |
| **Headless editor** (Electron `BrowserWindow {show:false}` / offscreen) | real WebGL2 (Chromium SwiftShader/ANGLE) | agent verification, CI, MCP-over-stdio | boots the editor with no visible window, drives the surface programmatically |
| pure-node vitest | **none** | logic/state only | keeps verifying World/command correctness; **cannot** pixel-verify |

The decisive choice: **the headless render host is a headless boot of the real editor**,
not a separate `headless-gl` rig. `headless-gl` (`gl` npm) is WebGL1-only — a dead end
for a WebGL2 engine. A `show:false` Electron window gives a real Chromium WebGL2
context, reuses the actual boot path (`createWebApp(..., wasmBaseUrl:'/wasm')`,
`registerContext`), and **doubles as the MCP-over-stdio host**. One host serves both
"my verification driver" and "the editor MCP transport."

## MCP mapping (P2) — tools, resources, transport

Grounded in MCP tool-design practice: dedicated typed tools (not a bash escape hatch)
so the editor can validate, gate, and audit each action; strict JSON schemas
(`additionalProperties:false`, explicit `required`); prescriptive descriptions that
state *when* to call.

- **Commands → MCP tools** (side effects, need gating). `editor_add_entity`,
  `editor_delete_entity`, `editor_set_component`, `editor_set_field`,
  `editor_load_scene`, `editor_set_run_mode`, `editor_step`.
- **Observations → MCP tools returning image content** — `editor_capture_viewport`
  returns an MCP **image content block**, so the agent sees the frame inline.
  `editor_get_render_state`, `editor_get_stats`, `editor_pick_at` return JSON.
- **Stable reads → MCP resources** (read-only, addressable, cacheable context, kept
  out of the tool list): `editor://scene/tree`, `editor://scene/{entity}/inspector`,
  `editor://project`. Parametric reads stay tools.

**Transport: Streamable HTTP as primary, stdio for headless.**
- **Streamable HTTP** — the editor's main process hosts `http://127.0.0.1:<port>/mcp`;
  an agent attaches to the **already-running** GUI. Right because the editor is a
  long-lived process a human also uses (stdio would force the client to own the editor
  as a subprocess).
- **stdio** — for `--headless` boots where the agent spawns the editor (CI, autonomous
  verification). Same surface, different framing.

Both bind localhost only and sit behind a **permission policy**:
- `read` — queries + observations always allowed.
- `write` — mutations gated; default off, enabled with `--allow-writes` or a UI toggle,
  so an agent cannot silently rewrite the user's project. Transient verification
  scenes (load → step → capture, no save) need only `read` + ephemeral mutation, never
  `saveScene`.
- Destructive/outward ops (`saveScene` overwrite, `openProject`) always require explicit
  opt-in.

The MCP server is `desktop/electron/mcp/` in the main process; it marshals each tool
call to the renderer surface over a new `editor:rpc` IPC channel pair and marshals the
result (PNG bytes → image content) back.

## Phases

- **P1 — EditorControlSurface + `step` + headless render host.**
  - `EditorControlSurface.ts` composing the existing modules (commands/queries/observe).
  - Engine `app.tick(dt)` manual-step entry; surface `step(frames, dt)`.
  - Headless editor boot (`show:false`) that instantiates the surface.
  - **Deliverable that closes the current gap:** a verification run that does
    `loadScene(spine 3.8 spineboy) → step(30,1/60) → captureViewport → assert the
    spine region is non-blank / matches a reference`. This pixel-verifies Spine S1
    (and every future render change) **without a human**. P1 is self-contained and
    immediately useful even before any MCP exists.
- **P2 — Editor MCP server.**
  - `desktop/electron/mcp/` MCP server (official SDK), Streamable HTTP + stdio.
  - Tools/resources per the mapping above; `capture_viewport` → image content.
  - `editor:rpc` IPC bridge main↔renderer; permission policy (`read` / `write`).
  - **Deliverable:** an agent connects to a live or headless editor and drives the
    full loop (open project · add a sprite/spine entity · set its asset · step · see
    the viewport · read the scene tree).

## Open risks

- ~~**WebGL2 in headless Electron**~~ — **RETIRED.** A `show:false` `BrowserWindow` gives
  a usable WebGL2 context with the engine's exact context options, and `gl.readPixels`
  returns the expected color. Evidence (de-risk spike, electron 42 on macOS):
  `{"ok":true,"version":"WebGL 2.0 (OpenGL ES 3.0 Chromium)","pixel":[255,0,0,255]}`.
  (`headless-gl` was never an option — WebGL1 only.) CI/Linux-headless still to confirm
  (SwiftShader fallback; `enable-unsafe-swiftshader` already wired in the spike).
- ~~**`step(dt)` vs the Emscripten main loop**~~ — **RETIRED.** `App.tick(delta)` already
  exists and shares `runFrame_` with `run()`'s `mainLoop`; the headless host calls
  `tick()` instead of `run()`, so there is no rAF loop to co-exist with. No engine change.
- **Capture determinism** — texture upload / async asset load must be settled before
  the captured frame; `loadScene` resolves textures before spawn, but verify nothing
  uploads lazily on first draw (one warm-up `step` before the asserted capture if so).
- **Pixel comparison** — reference-image diffing needs a tolerance (driver AA, SwiftShader
  vs hardware). Prefer structural assertions (region non-blank, bounding box, draw-call
  count, `getEntityRenderState`) over exact pixel equality where possible.

## Cross-links

- Determinism/host shares the wall-clock-free drive of REARCH_EDITOR_REALM (R0–R2,
  isolated play realm) — build the step primitive once.
- First consumer is the Spine rearch (REARCH_SPINE S1 pixel verification, then S2
  pixel-parity vs native 4.2) — the spineboy asset ships for 3.8/4.1/4.2 at the same
  example path, ideal for reference-image parity.
