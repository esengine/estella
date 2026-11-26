---
section: Added
commits:
  - "feat(pipeline): describe a visual effect in metres and seconds, build it as a prefab of particle layers and a light, and read it back"
  - "feat(editor): vfx tools that write an effect as a prefab and show it at chosen moments without Play"
  - "fix(editor): carry a particle emitter's gradient, size curve and bursts to the engine when it is placed, created or restored"
---
**An AI agent can build visual effects through the editor's MCP tools and see them without Play.** The new `vfx` group
has two tools. `vfx_write` takes an effect described in metres and seconds and writes it as a prefab: one particle emitter
per layer (fire, smoke, embers, sparks, a flash), plus a light. A layer's colour is given as stops over its life, its
blending as add or alpha, and its texture by name. The tool draws the textures it names (glow, soft, smoke, spark, flame,
ring) into the project. A light that flickers or fades becomes a timeline that the prefab's root plays.

The answer shows the effect drawn by the engine at the moments asked for, with the number of live particles in each layer.
It also says how long a one-shot effect lasts and warns about a layer with no texture or a full emitter. `vfx_read` gives
the description back. The tool text includes working numbers for a campfire, an explosion, smoke, sparks, a magic burst, a
hit and dust.

**A particle emitter placed from a prefab now uses its colour gradient, size curve and burst schedule straight away.**
Before, an emitter created in the editor, placed from a prefab or brought back by undo drew in its start and end colours
and never released its scheduled bursts until the scene was reopened.
