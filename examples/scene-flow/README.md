# Scene Flow

Runtime multi-scene flow: a **menu**, **level 1** and **level 2** cycling
through `SceneManager` with a fade on every hop. Every other example lives in a
single scene; this one is about the machinery that takes a shipped game from
its title screen into (and between) levels.

Press Play: the menu appears over the shell backdrop. **Start** fades to
level 1 (black, 0.6 s), **Next level** fades to level 2 (white, 0.9 s),
**Back to menu** fades home (deep blue, 1.2 s). The footer at the bottom never
flinches — it belongs to the shell scene that survives every swap.

## How the scenes are addressed

The three flow scenes are **code-built `SceneConfig`s registered on
`SceneManager`**, not extra `.esscene` files. That is a deliberate choice:

- In the editor's Play realm only the **entry** `.esscene` is registered with
  the SceneManager (as the running snapshot). Sibling scene files are not
  switch targets there, so a `.esscene`-addressed flow could not be verified by
  pressing Play.
- In an **exported build** every cooked scene *is* registered by name (see
  `game.config.json` → `scenes`), and `switchTo('name')` lazily fetches it —
  that path exists, but it only kicks in after an export.
- Code-registered scenes behave identically in every realm — editor Play,
  exported web build, WeChat — and entities spawned through the scene's
  `SceneContext` are tracked, so unloading a scene despawns everything it
  created (whole widget subtrees included) with zero cleanup code.

The authored `main.esscene` stays loaded for the entire session as a
**persistent shell**: camera, backdrop, the UI `Canvas` and the footer label.
Flow scenes parent their UI under that Canvas and are swapped in and out above
it.

## Registration and the first load

```ts
export const registerScenesSystem = defineSystem(
    [Res(SceneManager), Res(UIEvents), GetWorld()],
    (scenes, events, world) => {
        scenes.register(menuScene(world, events, scenes));   // SceneConfig { name, setup, systems? }
        scenes.register(level1Scene(world, events, scenes));
        scenes.register(level2Scene(world, events, scenes));
        void scenes.load(SCENES.menu);
    },
    { name: 'RegisterScenesSystem' },
);
```

A `SceneConfig` names the scene and provides either `data`/`path` (serialized
scene JSON) or a `setup(ctx)` callback that builds entities in code. `ctx` is
the scene's `SceneContext`: `ctx.spawn()` creates an entity **owned by the
scene** — SceneManager despawns it (and its subtree) when the scene unloads.
`SceneConfig.systems` registers scene-scoped systems: here `bobSystem` is
installed when a level loads, only runs while that scene's status is
`running`, and is removed on unload — it never appears in `main.ts`.

## `load` vs `transitionTo` / `switchTo`

- **`load(name)`** brings a scene in and makes it active **without unloading
  anything**. The startup system uses it for the first hop so the shell scene
  stays resident underneath. (`loadAdditive` is the variant that keeps the
  current scene active too.)
- **`switchTo(name, options)`** unloads the currently active scene, then loads
  the target — optionally through a fade. This is what every button here calls.
- **`transitionTo(host, name, config)`** is the convenience wrapper over
  `switchTo`. It accepts either the `App` (host/embedding code — the thing
  that called `createWebApp`) or the SceneManager resource state, so systems
  can call it with what `Res(SceneManager)` gives them:

```ts
// host code, with an App in hand:
await transitionTo(app, 'level-1', { type: 'fade', duration: 0.6, color: { r: 0, g: 0, b: 0, a: 1 } });

// inside a system (this example's goTo helper) — identical semantics:
void transitionTo(scenes, 'level-1', { type: 'fade', duration: 0.6, color: { r: 0, g: 0, b: 0, a: 1 } });
```

A switch requested while a transition is already in flight is ignored (with a
console warning), so mashing a button during a fade is harmless.

## TransitionConfig

| Field      | Type     | Meaning                                                                                          |
| ---------- | -------- | ------------------------------------------------------------------------------------------------ |
| `type`     | `'fade'` | Transition kind. Fade is the built-in: overlay ramps to opaque, scenes swap, overlay ramps clear. |
| `duration` | `number` | Total seconds — half fading out, half fading in. The opaque hold stretches if the load is slower. |
| `color`    | `Color?` | Overlay color. Defaults to black (`RuntimeConfig.sceneTransitionColor`).                          |

The three hops each use a different config (`src/flow.ts`) so all the options
are visible in one run: `0.6 s` black, `0.9 s` white, `1.2 s` deep blue.

## Files

```
assets/
  scenes/main.esscene    # persistent shell: camera, backdrop, Canvas, footer
src/
  main.ts                # registers the startup system
  components.ts          # Bobber (platform motion)
  flow.ts                # scene names, one TransitionConfig per hop, goTo helper
  scenes/
    build.ts             # ctx-tracked UI root under the shell Canvas; platform/heading builders
    menu.ts              # title + Start button
    level1.ts            # green/blue platforms + Next level button
    level2.ts            # orange/purple platforms + Back to menu button
  systems/
    register.ts          # startup: register all scenes, load the menu
    bob.ts               # scene-scoped platform bobbing (SceneConfig.systems)
```
