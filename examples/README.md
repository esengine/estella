# Estella Examples

Each folder here is a **complete, self-contained Estella project** — the same format
the editor creates for a new game. The launcher discovers them automatically (any
folder with a `project.esproject` shows up in *New Project → Templates*), so these
double as the starter templates.

To try one: open the folder in the Estella editor, or copy it as the starting point
for your own game.

## Catalog

| Example | Tag | What it shows |
| --- | --- | --- |
| **hello-world** | Basics | A minimal project — rotating, color-pulsing sprites. |
| **ecs-basics** | ECS | Spawn, move, bounce and expire entities: the core ECS loop. |
| **event-system** | ECS | Decoupled gameplay with typed events — collect, score, react. |
| **scene-flow** | Basics | Runtime scene flow — menu → level 1 → level 2 through `SceneManager` fade transitions, over a persistent shell scene. |
| **save-load** | Basics | Versioned persistence — `SaveManager` save/load with a live v1→v2 migration, plus raw `Storage` preferences. |
| **playable-ad** | Platform | A responsive CC0 space fleet game with Mintegral start/close, completion, retry and user-gesture install controls. |
| **record-share** | Platform | Record a run, mark highlights, share the clip with the mini-game recorder — the share button hides where the host cannot share. |
| **timers-demo** | Basics | `TimerManager` delays, intervals and handles — pause/resume/cancel/reset plus `timeScale`, replacing hand-rolled `time.delta` accumulators. |
| **sprite-rendering** | Rendering | Draw sprites with rotation, tint and flipping. A SortingGroup shows a subtree taking over its members' layers. |
| **sprite-animation** | Animation | Frame animation via `.esanim` clips with an idle/walk switcher. |
| **spine-demo** | Animation | A Spine skeleton cycling idle/walk/run/jump/shoot (1-5 to switch). |
| **dragonbones-demo** | Animation | A DragonBones armature crossfading stand/walk/jump/fall (1-4 to switch), with two figures sharing one parsed skeleton. |
| **tween-animation** | Animation | Ease positions, scales and colors over time. |
| **cutscene** | Animation | A code-free cutscene: an FSM state plays a timeline via the built-in `timeline.play` / `timeline.finished` names, then hands over to gameplay (R to replay). |
| **input-demo** | Input | Keyboard, mouse and pointer input with a motion trail. |
| **mobile-controls** | Input | A CC0 pixel-art training room with an authored multi-touch joystick, attack button, tilt and device controls. |
| **input-actions** | Input | Named, rebindable actions (`defineInputMap`) across keyboard + gamepad, plus swipe/pinch gestures with a mouse bridge. |
| **audio-demo** | Audio | One-shot SFX and a beat visualizer driven by playback. |
| **collision-layers** | Physics | Layer-based collision filtering between groups of bodies. |
| **physics-playground** | Physics | Drop balls and crates into a rigid-body sandbox. |
| **physics-spinner** | Physics | Revolute joints and continuous rotation. |
| **particle-demo** | Effects | A configurable particle emitter with additive blending. |
| **trail-demo** | Effects | The built-in `TrailRenderer` — comet, mouse-follow and dash trails with distinct width/color/blend configs, plus `Trail.clear` on teleport. |
| **postprocess-effects** | Effects | Full-screen post-processing: bloom, vignette, color grading. |
| **lighting-2d** | Rendering | Dynamic 2D lights and soft shadow casters over `Sprite.lit` surfaces. |
| **effects-gallery** | Rendering | The built-in material effect templates — hit flash, outline, dissolve, pixelate, UV scroll — with params driven from code. |
| **render-texture** | Rendering | Render-to-texture — a live minimap painted with the `Draw` API into a `RenderTexture`, resolution cycling on R. |
| **texture-canvas** | Rendering | Compose a picture at run time — a blank `TextureCanvas`, textures pasted in at pixel positions, the result shown on a `Sprite`. |
| **drawing-demo** | Rendering | The three drawing tiers — immediate `Draw` radar overlay, retained `Graphics` vector star, procedural `Mesh2D` ribbon. |
| **wilds** | Rendering | A lake under mountains at dusk — a generated `Terrain` from a heightmap, `Water` with measured depth and shore foam, `Foliage` grass and pines swaying in the wind, and clouds that cast shadows. Everything is made from numbers by `tools/build.mjs`. |
| **worldgen** | Rendering | A world laid out by rules as you walk through it — `WorldGen` biomes, groves and rock groups composed by recipe, copper to mine, `WorldZone`s keeping a home and a road clear, over ground without end. |
| **video-playback** | Rendering | Play a video on a Sprite with the declarative `Video` component — "a Sprite whose texture is alive". |
| **tilemap-demo** | Tilemap | Two scenes: a Tiled `.tmj` import and an engine-native `.estileset` — multi-tileset, parallax, animated water, per-tile collision. |
| **ui-controls** | UI | Every built-in widget, authored in the scene: button, toggle, toggle group, slider, progress, dropdown, text input, a modal and a scroll view. |
| **ui-interaction** | UI | Dragging, focus and pointer interaction. |
| **ui-layout** | UI | Flexbox-style responsive UI layout. |
| **ui-list** | UI | A virtualized list and grid — `createListView`, live data, `scrollToIndex`. |
| **ui-controller** | UI | Shared UI controllers + declarative per-page gears: a tab bar, an `$interaction` button, and a tweened popup. |
| **ui-events** | UI | Visual event binding — `EventBinding` rows wire a button's `click` to a named action (`ui.setPage`), on another entity by name, and via `fsm.fire` into a `.esfsm`. `src/main.ts` is empty. |
| **chat** | UI | A chat log — virtualized ListView + TextInput composer with two-way binding. |
| **rich-text** | UI | A live rich-text playground — type markup (and 中文 via IME) into a TextInput and watch a `Text` render bold/italic/color/font-size runs. |
| **enemy-ai** | AI | A state machine drives enemies to patrol, sense the player, and chase via A* navigation. |
| **camera-follow** | Gameplay | The camera director — `FollowTarget` damping + dead zone, `shakeCamera` impacts, `setViewTarget` blends to an overview camera. |
| **multiplayer-arena** | Networking | Server-authoritative multiplayer with client prediction: each player steers a replicated pawn, own-pawn input applies instantly ('2 Players' in the Play dropdown runs listen server + client). `server/` runs the same project headless behind a real WebSocket. |
| **platformer** | Game | A tiny platformer — run, jump and collect coins. |
| **video-puzzle** | Game | A tile-swap puzzle whose tiles are live regions of ONE playing video — texture-handle sharing + per-piece `uvOffset`/`uvScale`. |
| **space-shooter** | Game | A vertical shmup with prefabs, a HUD and a difficulty ramp. |
| **celestial-heights** | Game | The flagship action-RPG vertical slice — the project the release argues from. Not bundled with the editor (size); see `docs/REARCH_CELESTIAL_HEIGHTS.md`. |

## Art & assets

Examples that render bitmap art use **[Kenney](https://kenney.nl) CC0 (public-domain)
assets** — see [ASSETS.md](./ASSETS.md) for the exact packs. CC0 means no attribution
is required and you may reuse these examples (art included) in commercial games, which
keeps them consistent with Estella's Apache-2.0 license.

The concept demos (ECS, events, tweens, collision, spinner) intentionally render with
**colored primitives** rather than art — a plain colored square is the clearest way to
show *what the system is doing*, and it's the same convention most engine examples use.
The UI examples use the engine's built-in UI theme.

**Exception — `spine-demo`.** It ships Esoteric Software's *Spineboy* under the **Spine
Runtimes License** (not CC0). Using Spine at all requires your own Spine Editor license,
so this asset is not free to reuse the way the CC0 art is — see [ASSETS.md](./ASSETS.md).

## Structure & conventions

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the layout every example follows and the
conventions to keep them consistent.

## Visual quality

Upgrade examples incrementally, prioritizing 2D input, sprites/animation, tilemaps, UI and audio before specialized 3D showcases. Mobile Controls establishes the first art baseline: a coherent palette, readable objectives, editable scenery, textured controls and immediate interaction feedback.

Use original project art or assets with an explicitly verified redistribution license. Keep the source URL, asset version and license in each example, include only assets it uses, and keep editable originals when drawing controls. Validate the rendered project and interactions in hidden editor and packaged Web/mini-game checks after art changes.
