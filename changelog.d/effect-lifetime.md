---
section: Added
commits:
  - "feat(particle): EffectLifetime removes a one-shot effect once it has run its course"
  - "feat(pipeline): animated flame, smoke and fireball sheets for effects, and one-shots that remove themselves"
  - "feat(editor): vfx previews in front of a backdrop without the scene's air, with each layer's overdraw"
---
**One-shot effects can remove themselves, and the effect tools draw animated textures and report what an effect costs.**
The new `EffectLifetime` component removes its entity and everything under it after a number of seconds in a running game.
The time counts from when the entity first runs, stops while the game is paused and follows its time scale. The editor never
removes it. So a game can spawn an explosion at every hit and leave it to clean itself up. `vfx_write` adds the component to
every one-shot effect it writes.

Effects can now use three animated textures: `flame-sheet`, `smoke-sheet` and `fireball-sheet`. The flame sheet loops;
the smoke and fireball sheets play once over each particle's life. The frame count and speed are set automatically. The
preview shows the effect in front of a backdrop (grey by default, or dark, light or none), with the scene's fog and haze
taken out. Each frame reports how many times each layer's particles cover the screen: this overdraw is what an effect
costs on a phone, and the tool warns when it goes past 3.
