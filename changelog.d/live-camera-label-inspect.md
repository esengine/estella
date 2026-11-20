---
section: Fixed
commits:
  - fix(editor): the live-camera label is drawn over the game only in Inspect
---
**The live-camera label no longer covers a running game.** The label naming the camera a game looks through (and the blend under way) was drawn in the top-right corner of the viewport and the game window whenever the game ran, over whatever HUD the game puts there. It is now drawn only in Inspect (F8), with the rest of the play overlay; while playing, the Outliner still marks the live camera.
