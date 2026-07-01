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
| **hello-world** | Basics | The smallest project — one rotating, color-pulsing sprite. |
| **ecs-basics** | ECS | Spawn, move, bounce and expire entities: the core ECS loop. |
| **event-system** | ECS | Decoupled gameplay with typed events — collect, score, react. |
| **sprite-rendering** | Rendering | Draw sprites with rotation, tint and flipping. |
| **sprite-animation** | Animation | Frame animation via `.esanim` clips with an idle/walk switcher. |
| **tween-animation** | Animation | Ease positions, scales and colors over time. |
| **input-demo** | Input | Keyboard, mouse and pointer input with a motion trail. |
| **audio-demo** | Audio | One-shot SFX and a beat visualizer driven by playback. |
| **collision-layers** | Physics | Layer-based collision filtering between groups of bodies. |
| **physics-playground** | Physics | Drop balls and crates into a rigid-body sandbox. |
| **physics-spinner** | Physics | Revolute joints and continuous rotation. |
| **particle-demo** | Effects | A configurable particle emitter with additive blending. |
| **postprocess-effects** | Effects | Full-screen post-processing: bloom, vignette, color grading. |
| **tilemap-demo** | Tilemap | A tile level painted from a tileset atlas, drawn by the tilemap layer. |
| **ui-controls** | UI | Buttons, sliders, toggles and progress bars. |
| **ui-interaction** | UI | Dragging, focus and pointer interaction. |
| **ui-layout** | UI | Flexbox-style responsive UI layout. |
| **platformer** | Game | A tiny platformer — run, jump and collect coins. |
| **space-shooter** | Game | A vertical shmup with prefabs, a HUD and a difficulty ramp. |

## Art & assets

Examples that render bitmap art use **[Kenney](https://kenney.nl) CC0 (public-domain)
assets** — see [ASSETS.md](./ASSETS.md) for the exact packs. CC0 means no attribution
is required and you may reuse these examples (art included) in commercial games, which
keeps them consistent with Estella's Apache-2.0 license.

The concept demos (ECS, events, tweens, collision, spinner) intentionally render with
**colored primitives** rather than art — a plain colored square is the clearest way to
show *what the system is doing*, and it's the same convention most engine examples use.
The UI examples use the engine's built-in UI theme.

## Structure & conventions

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the layout every example follows and the
conventions to keep them consistent.
