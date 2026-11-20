---
section: Fixed
commits:
  - fix(editor): nothing is drawn over a running game outside Inspect
---
**A game running in the viewport is no longer covered by editor labels.** The edit readout at the bottom left (selection count, zoom and cursor of the edit view, on by default) stayed over the running game, and a selected entity's name stayed over it after the moment its outline flashes. Outside Inspect (F8) the game's picture now carries nothing of the editor's but that brief outline, as in UE's Play In Editor; the FPS panel, when turned on, stays. In Inspect the outline, name and live camera are drawn as before.
