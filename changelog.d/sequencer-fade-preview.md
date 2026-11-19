---
section: Added
commits:
  - feat(editor): the Sequencer previews a timeline's screen fade over the scene view
---
**A timeline's fade shows while it is authored.** With the Sequencer on a timeline, the ScreenFade at the playhead is drawn over the scene view and the camera preview in its colour and amount, as UE's viewport shows a Fade track; the scene's own value is left as it was. Before, a fade was seen only in play, and the preview showed nothing but the keyed number.
