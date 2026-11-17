---
name: estella-workflow
description: How to get a task done in an Estella game project through the editor's MCP tools - open the project, write the acceptance first, build, verify until it passes. Read this before any other Estella skill and at the start of every Estella task.
---

# Working in Estella

Estella is a game engine with an editor. You drive the editor through its MCP tools; the editor holds the project, the open
scene and a running game. Everything below is about not losing a task to the four ways agents usually do: working on the
wrong world, waiting for a game that is not moving, reporting success without looking, and changes that never reach disk.

## The loop

1. **Know the project.** `get_workspace_session` says what is open. No project: `list_project_templates`, `create_project`,
   then `open_project` (it returns once the first scene is readable). `get_scene_tree` shows the scene.
2. **Write the acceptance first.** Put what "done" means in `acceptance/<task>.json` with `write_project_file`:
   ```json
   { "frames": 120,
     "inputs": [{ "frame": 10, "kind": "key_down", "code": "Space" }],
     "expect": [{ "entity": "Player", "component": "Transform", "field": "position.y", "op": "changed", "says": "the player jumps" }] }
   ```
   One expectation per thing the task asked for. `op` is `== != > >= < <= ~=` (with `tolerance`), `exists`, `absent`,
   `changed`, `unchanged`; `changed` compares with the value when play began, before any input.
3. **Build** with the tools (see the other Estella skills for each kind of work).
4. **Verify**: `verify { acceptance: "acceptance/<task>.json" }`. It checks that the scripts build, that the scene has no
   empty required field or dead reference, that nothing blocks a build, runs the game with your inputs, checks your
   expectations, fails on any error logged while it ran, and fails a game view that is one flat colour. Work until
   `pass` is true, fixing what each finding's `fix` says. Then look once with `screenshot { crop: "game" }`.
5. **Save**: `save_scene`. Scene edits are not on disk until then.

## Two worlds

- The **open scene** is what is saved: `search_entities`, `get_entity`, `set_field`, `apply_scene_ops`, `add_component`.
- The **running game** is a copy made when play starts and thrown away when it stops: `set_play`, `step`, `play_input`,
  `find_entities`, `inspect_entity`. A change made in the running game is gone at Stop; a change to the scene does not
  reach a game already running (stop and play again).
- The two number their entities differently: the Player is 6 in the scene and some large number in the running game.
  Every `entity` argument also takes a name, looked up in the world that tool acts on, so `{ "entity": "Player" }`
  works in both; a name two entities share is refused with their numbers (in the scene, a path such as
  `"HUD/ScoreText"` picks one).

## A running game does not move by itself

The editor window is not focused while you drive it, so the game runs at about one frame a second. Never wait or sleep for
it: `step { frames: 180 }` is three seconds of game time, deterministically. A key press from `play_input` lasts one frame;
`step 1` right after it. `get_play_state().fps` near 1 is the throttle, not a frozen game.

## Things that are easy to get wrong

- **Units**: the default scene is 100 world units to the metre (`builtin:cube` is 100 across). Sizes, speeds and forces
  follow that unless the project says otherwise.
- **Writing components from a script**: change them through `Mut(...)` in a `Query`, or with `world.set` / `world.insert` /
  `world.update`. A field changed on the object `world.get` returned is not seen by the engine (a label keeps its old text).
- **Scripts** live in `src/`, are TypeScript, and register their systems in `src/main.ts`. Run `check_scripts` after
  writing one; `verify` refuses to run a game whose scripts do not build.
- **Tools you do not see**: only everyday tools are listed at first. `enable_tools { groups: [...] }` lists more (look,
  assets, prefab, authoring, view, play, render, project, code, image, sound, terrain, modeling, device). A tool whose
  description ends with MORE has the rest in `tool_guide` topics: read the topic before doing what it covers.
- **Undo**: each call that changes the project is one undo step; `undo` takes the whole call back.

## When something fails

Read the failed check's findings in order; the first is usually the cause of the rest. The `estella-debugging` skill has
the order to look in.
