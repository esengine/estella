# Example architecture & conventions

Every example is a real Estella project, so it exercises the same loader, scene format
and build pipeline as a game a user would ship. Keep new examples consistent with the
layout below.

## Directory layout

```
<example>/
├── project.esproject          # manifest — how the launcher discovers & labels it
├── tsconfig.json              # standard TS config (paths → ./.esengine/sdk)
├── .gitignore                 # ignores node_modules, dist, .esengine/cache
├── thumbnail.png              # launcher gallery thumbnail (optional)
├── assets/
│   ├── scenes/main.esscene    # the default scene (entities + components)
│   ├── textures/*.png(+.meta)  # bitmap assets; each PNG has a .png.meta sidecar
│   ├── prefabs/*.esprefab     # reusable entity templates (optional)
│   ├── animations/*.esanim    # sprite-animation clips (optional)
│   └── audio/*.wav            # audio clips (optional)
└── src/
    ├── main.ts                # entry point — registers systems / startup logic
    ├── components.ts          # component definitions (defineComponent)
    └── systems/*.ts           # one system (or a small group) per file
```

`.esengine/` is **generated** (script cache, play realm, staged SDK) and is gitignored.
The one exception is `.esengine/asset-export.json`, a small committed config that marks
folders for always-export (see space-shooter).

## The manifest (`project.esproject`)

```jsonc
{
  "formatVersion": "1",
  "name": "Space Shooter",         // launcher title
  "description": "…one line…",     // launcher card subtitle
  "tag": "Game",                    // launcher category (Basics/ECS/Physics/UI/…)
  "version": "0.1.0",
  "defaultScene": "assets/scenes/main.esscene",
  "designResolution": { "width": 600, "height": 1080 },
  "spineVersion": "none"
}
```

`name`, `description` and `tag` drive how the example appears in *New Project →
Templates*. Every example should set all three.

## How work is placed: scene vs prefab vs code

- **Static entities → the scene.** Cameras, backgrounds, the player, UI, and any fixed
  level geometry live in `main.esscene` as entities with components.
- **Runtime-spawned, repeated entities → prefabs.** Bullets, enemies, pickups that are
  instantiated many times are authored once as `.esprefab` and spawned via `Prefabs`
  (see `space-shooter`). Per-spawn differences use prefab overrides.
- **Behaviour → systems.** Logic goes in `src/systems/*.ts`, registered in `main.ts`
  via `addStartupSystem` / `addSystemToSchedule`. Constants and shared resources go in a
  `resources.ts` (see `space-shooter`) so magic numbers aren't scattered.

Startup entities that must exist before the first frame use an `addStartupSystem`;
per-frame logic uses `Schedule.Update`.

## Asset references

- **Scenes/prefabs reference assets by stable UUID** — e.g. a Sprite's
  `"texture": "@uuid:…"`, resolved from the sidecar `assets/textures/foo.png.meta`.
  To replace art without touching the scene, **overwrite the PNG bytes under the same
  filename** — the `.meta` UUID is unchanged, so every reference stays valid. (Adjust the
  Sprite `size` if the new art's aspect ratio differs.)
- **Code references assets by project-relative path** — e.g.
  `insert(Sprite, { texture: 'assets/textures/gem.png' })`. No UUID needed; the loader
  resolves the path.

## Art policy

- Examples that use bitmap art use **Kenney CC0** assets (see [ASSETS.md](./ASSETS.md)) —
  public-domain, one cohesive style, safe to ship and reuse commercially.
- Concept demos (ECS, events, tweens, collision) render **colored primitives** on
  purpose: a plain square makes the system's behaviour legible in a way decorated art
  would obscure. Don't add textures to these just for polish.
- UI examples use the engine's built-in UI theme.

## Verifying an example

`node build-tools/tasks/check-examples.js` symlinks the built SDK into each example and
runs `tsc --noEmit` across all of them — run it after changing example source or the SDK
types. Visual/gameplay correctness (rendering, camera framing, tilemap tiles) should be
confirmed by opening the example in the editor and pressing Play.
