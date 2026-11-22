---
section: Fixed
commits:
  - fix(editor): match animator clips and transition conditions to their types
  - fix(editor): make animation state playback overrides explicit
  - fix(animation): load sprite clips referenced by animator states
  - fix(animation): play sprite states without an authored player
  - fix(editor): show sprite controller guidance in the state inspector
---
**Animator states now load the sprite clips they play.** This includes clips used only after a transition or in a blend. Relative clip paths also survive packaging. In the graph, typing a sprite or timeline filename selects its player, and new transition conditions match the parameter type. State playback speed and wrap settings now reach the clip, including settings saved by earlier editors. The animation guide shows how to create each asset and play the initial state in a scene.

An Animator can now play a sprite clip and advance to the next state on its own. Add Sprite to the same entity to show the frames. Existing Sprite Animator components share the same playback clock and frame events. The highest contributing sprite layer selects the visible clip, and state hints appear beside their controls.
